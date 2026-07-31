import { CALIBRATION as CAL } from "./calibration.js";
import { curveAt, maintenanceAt, parseCurve } from "./curves.js";
import { deriveBuyYear, isFeasibleBuy } from "./feasibility.js";
import { Rng, hashString } from "./rng.js";
import type {
  Constants,
  CostBreakdown,
  EngineInputs,
  EngineResult,
  Vehicle,
} from "./types.js";

/**
 * THE cost engine (spec §2, §3, §8 — there is exactly one).
 *
 * Implements the v2b model documented in the prototype's assumption inventory
 * (see ASSUMPTIONS.md): present-value cost per mile with purchase use tax,
 * total-loss exposure, a mileage-ramping major-repair tail, a calendar-age
 * upkeep escalator, data-driven battery risk, and energy computed outside the
 * Monte Carlo. Opportunity cost of capital enters ONLY through discounting at
 * `discountRate` — deliberately no separate capital charge (the prototype
 * double-counted this once; proven and removed in v2b).
 */
export function costPerMile(
  vehicle: Vehicle,
  constants: Constants,
  inputs: EngineInputs = {},
): EngineResult {
  const am = inputs.annualMiles ?? constants.annual_miles;
  const r = inputs.discountRate ?? constants.discount_rate_real;
  const gas = inputs.gasUsdPerGal ?? constants.gas_usd_per_gal;
  const elec = inputs.elecUsdPerKwh ?? constants.elec_usd_per_kwh;
  const draws = inputs.draws ?? constants.monte_carlo_draws;
  const seed = inputs.seed ?? 42;
  const buyOdo = inputs.buyOdo ?? vehicle.pinned_buy_odo;
  const holdMiles = inputs.holdMiles ?? "eol";
  if (holdMiles !== "eol" && !(holdMiles > 0)) {
    throw new RangeError(`holdMiles must be positive or "eol", got ${holdMiles}`);
  }
  const insMult = inputs.insuranceMultiplier ?? constants.insurance_multiplier_USAA;
  // Insurance = NAIC state average premium split by what each coverage insures
  // (ASSUMPTIONS.md §A). Liability covers damage to OTHERS, so it does not scale
  // with this car's value and is charged flat. Collision + comprehensive cover THIS
  // car, so they scale linearly with its book value against `insurance_ref_book_usd`
  // — which is what makes the premium fall as the car depreciates. An explicit real
  // quote (`fullCoverageUsdYr`) bypasses all of it, including the multiplier.
  const esc = constants.insurance_cpi_escalator;
  const liab = esc * (inputs.liabilityUsdYr ?? constants.liability_only_usd_yr) * insMult;
  const physDmgAtRefBook =
    esc *
    ((inputs.collisionUsdYr ?? constants.collision_premium_usd_yr) +
      (inputs.comprehensiveUsdYr ?? constants.comprehensive_premium_usd_yr)) *
    insMult;
  const quoteUsdYr = inputs.fullCoverageUsdYr;
  const reg = inputs.registrationUsdYr ?? constants.registration_usd_yr_FL;
  const taxRate = inputs.useTaxRate ?? constants.use_tax_rate;

  const scrap = constants.scrap_usd_by_body[vehicle.body] ?? 400;
  const tiresPerMi = constants.tires_usd_per_mi_by_body[vehicle.body] ?? 0.02;
  const priceCurve = parseCurve(vehicle.price_vs_odometer_usd);
  const maintCurve = parseCurve(vehicle.maintenance_usd_per_yr_by_age);
  const buyPrice = inputs.purchasePrice ?? curveAt(priceCurve, buyOdo, scrap);
  const tier = constants.reliability_tiers[vehicle.reliability_tier];
  const sigmaEol =
    constants.eol_sigma_by_tier?.[vehicle.reliability_tier] ?? CAL.sigmaEolFallback;

  const buyYear = deriveBuyYear(vehicle, buyOdo, am, constants.now_year);
  const yearMults = constants.year_reliability_multipliers;
  const myr = vehicle.model_year_reliability;
  const ym = myr.bad.includes(buyYear)
    ? yearMults.landmine
    : myr.caution.includes(buyYear)
      ? yearMults.caution
      : myr.good.includes(buyYear)
        ? yearMults.sweet_spot
        : yearMults.normal;

  const epm = energyPerMile(vehicle, constants, gas, elec, am);
  const lnr = Math.log(1 + r);
  const a0 = buyOdo / am; // odometer-implied age (prototype limitation, see ASSUMPTIONS.md)
  const upkeepEsc = (age: number) =>
    1 + CAL.calAgeEscPerYr * Math.max(age - CAL.calAgeEscStartAge, 0);

  // deterministic median-EOL path: energy sits outside the Monte Carlo (documented)
  const detSell =
    holdMiles === "eol"
      ? vehicle.eol_maintained_miles
      : Math.min(buyOdo + holdMiles, vehicle.eol_maintained_miles);
  const detMiles = Math.max(detSell - buyOdo, am);
  const detT = detMiles / am;
  const avgDf = r === 0 ? 1 : (1 - Math.pow(1 + r, -detT)) / (detT * lnr);
  const energy = epm * avgDf;

  // Independent substreams per stochastic component, seeded off (seed, vehicle name).
  const base = hashString(vehicle.name) ^ (seed >>> 0);
  const rngEol = new Rng(base ^ 0x1111);
  const rngIns = new Rng(base ^ 0x2222);
  const rngRepN = new Rng(base ^ 0x3333);
  const rngRepC = new Rng(base ^ 0x4444);
  const rngBatt = new Rng(base ^ 0x5555);

  const cpm = new Float64Array(draws);
  const lifetimeUsd = new Float64Array(draws);
  const sums: CostBreakdown = {
    depreciation: 0,
    useTax: 0,
    maintenance: 0,
    insurance: 0,
    registration: 0,
    totalLoss: 0,
    repairs: 0,
    tires: 0,
    battery: 0,
    energy: 0,
    total: 0,
  };
  const sellOdos = new Float64Array(draws);
  const useTax = taxRate * buyPrice;
  // Draws whose hold ended early because this draw's sampled end-of-life arrived
  // first (see `truncatedDrawFraction`). Counted from `sell`, which is already
  // computed below — no extra RNG draw, so the substreams stay aligned.
  let truncatedDraws = 0;

  for (let i = 0; i < draws; i++) {
    let eol = vehicle.eol_maintained_miles * Math.exp(sigmaEol * rngEol.normal());
    if (eol < buyOdo + am) eol = buyOdo + am; // at least a year of life
    const sell = holdMiles === "eol" ? eol : Math.min(buyOdo + holdMiles, eol);
    if (holdMiles !== "eol" && sell < buyOdo + holdMiles) truncatedDraws++;
    sellOdos[i] = sell;
    const miles = sell - buyOdo;
    const T = miles / am;
    const dfT = Math.pow(1 + r, -T);

    // resale: market curve at the sell odometer, floored at scrap; scrap if driven to death
    const resale = sell >= eol ? scrap : Math.max(curveAt(priceCurve, sell, scrap), scrap);
    const dep = buyPrice - resale * dfT;

    // yearly operating costs, discounted at end of each (possibly partial) year
    let maintPV = 0;
    let insPV = 0;
    let regPV = 0;
    let lossPV = 0;
    const ny = Math.ceil(T);
    for (let t = 1; t <= ny; t++) {
      const w = Math.min(T - (t - 1), 1);
      const df = Math.pow(1 + r, -t);
      const age = a0 + t;
      maintPV += w * maintenanceAt(maintCurve, age, 1) * upkeepEsc(age) * df;
      const book = curveAt(priceCurve, buyOdo + (t - 1) * am, scrap);
      const full = book > constants.full_cov_threshold_usd;
      const fullCov =
        quoteUsdYr ?? liab + physDmgAtRefBook * (book / constants.insurance_ref_book_usd);
      // insurance noise: Normal(1, σ) per year (documented)
      insPV +=
        w * (full ? fullCov : liab) * (1 + CAL.insuranceNoiseSigma * rngIns.normal()) * df;
      regPV += w * reg * df;
      // total-loss exposure: deductible while covered, full book value when liability-only
      lossPV +=
        w *
        constants.total_loss_rate_per_yr *
        (full ? constants.collision_deductible_usd : book) *
        df;
    }

    // major-repair tail past the threshold, hazard ramping with mileage (documented)
    const th = CAL.repairOdoThreshold;
    const o0 = Math.max(Math.min(buyOdo, sell), th);
    const oe = Math.max(sell, th);
    const ramp = ((oe - th) ** 2 - (o0 - th) ** 2) / (2 * CAL.repairRampScaleMiles);
    const lambda = (tier.annual_prob_past_120k / am) * (oe - o0 + ramp);
    const nEvents = rngRepN.poisson(Math.max(lambda, 0));
    const tStart = Math.max(th - buyOdo, 0) / am;
    let repairPV = 0;
    const medCost = tier.median_usd_per_event * vehicle.repair_cost_multiplier_by_make * ym;
    for (let k = 0; k < nEvents; k++) {
      const tt = tStart + rngRepC.next() * Math.max(T - tStart, 0);
      const cost =
        medCost * upkeepEsc(a0 + tt) * Math.exp(CAL.sigmaRepair * rngRepC.normal()) +
        constants.hassle_per_major_repair_usd;
      repairPV += cost * Math.pow(1 + r, -tt);
    }

    // battery: data-driven Bernoulli failure × lognormal cost at ~65% of life
    let battPV = 0;
    if (vehicle.battery) {
      const failed = rngBatt.next() < vehicle.battery.failure_prob;
      const z = rngBatt.normal(); // always consume — keeps the stream aligned
      if (failed) {
        const cost = vehicle.battery.pack_cost_usd * Math.exp(vehicle.battery.cost_sigma * z);
        battPV = cost * Math.pow(1 + r, -(constants.battery_event_frac_of_life * T));
      }
    }

    const tires = tiresPerMi * miles;
    const total =
      (dep + useTax + maintPV + insPV + regPV + lossPV + repairPV + battPV + tires) / miles +
      energy;
    cpm[i] = total;
    // This draw's total in dollars. `energy` is already a $/mi and sits outside the
    // `/miles` division above, so multiplying the finished $/mi back by this draw's own
    // miles is both the whole total and, by construction, consistent with the $/mi.
    lifetimeUsd[i] = total * miles;

    sums.depreciation += dep / miles;
    sums.useTax += useTax / miles;
    sums.maintenance += maintPV / miles;
    sums.insurance += insPV / miles;
    sums.registration += regPV / miles;
    sums.totalLoss += lossPV / miles;
    sums.repairs += repairPV / miles;
    sums.tires += tiresPerMi;
    sums.battery += battPV / miles;
    sums.energy += energy;
    sums.total += total;
  }

  for (const k of Object.keys(sums) as (keyof CostBreakdown)[]) sums[k] /= draws;

  const sorted = Float64Array.from(cpm).sort();
  const q = (p: number) => quantileSorted(sorted, p);

  // Opportunity-cost reporting columns (deterministic median-EOL path).
  const oppCostLifetimeUsd = buyPrice * (Math.pow(1 + r, detT) - 1);
  const sortedSell = Float64Array.from(sellOdos).sort();
  const sortedLifetime = Float64Array.from(lifetimeUsd).sort();
  const medianSellOdo = quantileSorted(sortedSell, 0.5);

  return {
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p05: q(0.05),
    p95: q(0.95),
    breakdown: sums,
    oppCostLifetimeUsd,
    oppCostPerMi: oppCostLifetimeUsd / detMiles,
    drawsCpm: cpm,
    buyPrice,
    buyOdo,
    impliedBuyYear: buyYear,
    feasible: isFeasibleBuy(vehicle, buyOdo, am, constants.now_year),
    medianSellOdo,
    lifetimeCostUsdP50: quantileSorted(sortedLifetime, 0.5),
    // buyOdo is the same for every draw, so this is the median of the per-draw miles.
    lifetimeMilesP50: medianSellOdo - buyOdo,
    truncatedDrawFraction: truncatedDraws / draws,
  };
}

/** Energy $/mi incl. documented EV/PHEV degradation and DC-fast-charge premiums. */
export function energyPerMile(
  vehicle: Vehicle,
  constants: Constants,
  gas: number,
  elec: number,
  annualMiles: number,
): number {
  const s = vehicle.specs;
  switch (vehicle.etype) {
    case "gas":
    case "hybrid":
      return gas / (s.mpg_combined ?? 25);
    case "ev":
      return (
        ((s.kwh_per_100mi ?? 30) / 100) *
        constants.ev_kwh_degradation_mult *
        elec *
        constants.dcfc_elec_mult_ev
      );
    case "phev": {
      const ufSeed = s.phev_utility_factor ?? 0.6;
      const range = s.electric_range_mi;
      // Mileage-dependent utility factor, anchored to the seed value at baseline
      // annual_miles (J2841-shaped approximation, not J2841 itself — see ASSUMPTIONS.md
      // §B). Falls back to the fixed seed UF when electric_range_mi is absent.
      let uf = ufSeed;
      if (range != null) {
        const rangeEff = range / constants.ev_kwh_degradation_mult; // pack degradation shrinks range
        const ufRaw = (r: number, am: number) => 1 - Math.exp(-r / (am / 365));
        uf = Math.min(
          1,
          Math.max(
            0,
            ufSeed * (ufRaw(rangeEff, annualMiles) / ufRaw(range, constants.annual_miles)),
          ),
        );
      }
      return (
        uf *
          ((s.kwh_per_100mi ?? 30) / 100) *
          constants.ev_kwh_degradation_mult * // pack degradation raises electric consumption
          elec *
          constants.dcfc_elec_mult_phev +
        (1 - uf) * (gas / (s.phev_gas_mpg ?? 40))
      );
    }
  }
}

/** Linear-interpolation quantile on a pre-sorted array (matches numpy's default). */
export function quantileSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}
