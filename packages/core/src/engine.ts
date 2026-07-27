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
 * Present-value cost per mile for `vehicle` bought at `buyOdo`, held for `holdMiles`
 * (or to end-of-life), Monte Carlo over: EOL miles, major-repair count/cost/timing,
 * insurance noise, and EV battery failure. Opportunity cost of capital enters ONLY
 * through discounting at `discountRate` — there is deliberately no separate capital
 * charge (spec §2; the prototype double-counted this and it was removed).
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
  const fullCov =
    (inputs.fullCoverageUsdYr ?? vehicle.specs.full_coverage_ins_usd_yr) * insMult;
  const liab = constants.liability_only_usd_yr;
  const reg = inputs.registrationUsdYr ?? constants.registration_usd_yr_FL;

  const scrap = constants.scrap_usd_by_body[vehicle.body] ?? 400;
  const tiresPerMi = constants.tires_usd_per_mi_by_body[vehicle.body] ?? 0.02;
  const priceCurve = parseCurve(vehicle.price_vs_odometer_usd);
  const maintCurve = parseCurve(vehicle.maintenance_usd_per_yr_by_age);
  const buyPrice = inputs.purchasePrice ?? curveAt(priceCurve, buyOdo, scrap);
  const tier = constants.reliability_tiers[vehicle.reliability_tier];

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
  const maintYm = CAL.yearMultOnMaintenance ? ym : 1;

  const epm = energyPerMile(vehicle, gas, elec);
  const lnr = Math.log(1 + r);
  const a0 = buyOdo / am; // odometer-implied age at purchase (prototype-faithful; spec §10)

  // Independent substreams per stochastic component, seeded off (seed, vehicle name).
  const base = hashString(vehicle.name) ^ (seed >>> 0);
  const rngEol = new Rng(base ^ 0x1111);
  const rngIns = new Rng(base ^ 0x2222);
  const rngRepN = new Rng(base ^ 0x3333);
  const rngRepC = new Rng(base ^ 0x4444);
  const rngBatt = new Rng(base ^ 0x5555);

  const cpm = new Float64Array(draws);
  const sums: CostBreakdown = {
    depreciation: 0,
    maintenance: 0,
    insurance: 0,
    registration: 0,
    repairs: 0,
    tires: 0,
    battery: 0,
    energy: 0,
    total: 0,
  };
  const sellOdos = new Float64Array(draws);

  for (let i = 0; i < draws; i++) {
    let eol = vehicle.eol_maintained_miles * Math.exp(CAL.sigmaEol * rngEol.normal());
    if (eol < buyOdo + am) eol = buyOdo + am; // at least a year of life
    const sell = holdMiles === "eol" ? eol : Math.min(buyOdo + holdMiles, eol);
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
    const ny = Math.ceil(T);
    for (let t = 1; t <= ny; t++) {
      const w = Math.min(T - (t - 1), 1);
      const df = Math.pow(1 + r, -t);
      maintPV += w * maintenanceAt(maintCurve, a0 + t, CAL.lateMaintSlopeMult) * maintYm * df;
      const book = curveAt(priceCurve, buyOdo + (t - 1) * am, scrap);
      insPV += w * (book > constants.full_cov_threshold_usd ? fullCov : liab) * df;
      regPV += w * reg * df;
    }
    insPV *= Math.exp(CAL.sigmaIns * rngIns.normal());

    // probabilistic major-repair tail past the odometer threshold
    const th = CAL.repairOdoThreshold;
    const pastMiles = Math.max(sell - Math.max(buyOdo, th), 0);
    const lambda = tier.annual_prob_past_120k * ym * (pastMiles / am);
    const nEvents = rngRepN.poisson(lambda);
    const tStart = Math.max(th - buyOdo, 0) / am;
    let repairPV = 0;
    const medCost = tier.median_usd_per_event * vehicle.repair_cost_multiplier_by_make;
    for (let k = 0; k < nEvents; k++) {
      const tt = tStart + rngRepC.next() * Math.max(T - tStart, 0);
      const cost =
        medCost * Math.exp(CAL.sigmaRepair * rngRepC.normal()) +
        constants.hassle_per_major_repair_usd;
      repairPV += cost * Math.pow(1 + r, -tt);
    }

    // battery (spec §2): EVs carry a Bernoulli pack-failure event; PHEV/hybrid a flat reserve
    let battPV = 0;
    if (vehicle.etype === "ev") {
      if (rngBatt.next() < CAL.evPackFailureProb) {
        const ft = rngBatt.uniform(CAL.battFailTimeFrac[0], CAL.battFailTimeFrac[1]) * T;
        battPV = CAL.evPackCostUsd * Math.pow(1 + r, -ft);
      } else {
        rngBatt.next(); // keep stream alignment regardless of branch
      }
    } else if (vehicle.etype === "phev") {
      battPV = CAL.phevBatteryReserveUsd * Math.pow(1 + r, -T / 2);
    } else if (vehicle.etype === "hybrid") {
      battPV = CAL.hybridBatteryReserveUsd * Math.pow(1 + r, -T / 2);
    }

    const tires = tiresPerMi * miles;
    // mean discount factor — energy is spent evenly over the hold (1 exactly when r=0)
    const avgDf = r === 0 ? 1 : (1 - dfT) / (T * lnr);
    const energy = epm * avgDf;

    const total =
      (dep + maintPV + insPV + regPV + repairPV + battPV + tires) / miles + energy;
    cpm[i] = total;

    sums.depreciation += dep / miles;
    sums.maintenance += maintPV / miles;
    sums.insurance += insPV / miles;
    sums.registration += regPV / miles;
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
  const detSell =
    holdMiles === "eol"
      ? vehicle.eol_maintained_miles
      : Math.min(buyOdo + holdMiles, vehicle.eol_maintained_miles);
  const detMiles = Math.max(detSell - buyOdo, am);
  const detT = detMiles / am;
  const oppCostLifetimeUsd = buyPrice * (Math.pow(1 + r, detT) - 1);

  const sortedSell = Float64Array.from(sellOdos).sort();

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
    medianSellOdo: quantileSorted(sortedSell, 0.5),
  };
}

export function energyPerMile(vehicle: Vehicle, gas: number, elec: number): number {
  const s = vehicle.specs;
  switch (vehicle.etype) {
    case "gas":
    case "hybrid":
      return gas / (s.mpg_combined ?? 25);
    case "ev":
      return ((s.kwh_per_100mi ?? 30) / 100) * elec;
    case "phev": {
      const uf = s.phev_utility_factor ?? 0.6;
      return (
        uf * ((s.kwh_per_100mi ?? 30) / 100) * elec +
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
