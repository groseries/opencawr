/**
 * Throw-away counterfactual copy of `costPerMile` for the R21 investigation.
 *
 * Line-for-line the shipped `packages/core/src/engine.ts` with three switches
 * added, all OFF by default. With every switch off it must be bit-identical to
 * the shipped engine — `verify.ts` asserts that across the whole seed field
 * before any number in the write-up is trusted.
 *
 *   levelize      divide PV dollars by the PV of miles (LCOE / EAC construction)
 *                 instead of by undiscounted miles, and fold energy in as PV
 *                 dollars on the SAME discrete end-of-year convention.
 *   discountTires charge tires as PV dollars (tiresPerMi x PV miles) instead of
 *                 nominal dollars (tiresPerMi x miles). Only observable when
 *                 `levelize` is on; off, both reduce to the same $/mi term.
 *   resaleCliff   restore the pre-R20 hard resale cliff at `sell >= eol`.
 *
 * Also returns the per-draw arrays the investigation needs (PV dollars, PV
 * miles, realized miles, horizon) so continuation/stand-in variants can be
 * computed outside the engine without re-running it.
 */
import { CALIBRATION as CAL } from "../packages/core/src/calibration.js";
import { curveAt, maintenanceAt, parseCurve } from "../packages/core/src/curves.js";
import { deriveBuyYear } from "../packages/core/src/feasibility.js";
import { Rng, hashString } from "../packages/core/src/rng.js";
import { quantileSorted } from "../packages/core/src/engine.js";
import type { Constants, EngineInputs, Vehicle } from "../packages/core/src/types.js";

export interface CfSwitches {
  levelize?: boolean;
  discountTires?: boolean;
  resaleCliff?: boolean;
}

export interface CfResult {
  p50: number;
  /** Per-draw $/mi on whichever metric the switches select. */
  cpm: Float64Array;
  /** Per-draw present-value dollars of the whole hold (numerator). */
  pvUsd: Float64Array;
  /** Per-draw present value of the miles driven (discrete, end-of-year). */
  pvMiles: Float64Array;
  /** Per-draw realized miles (nominal hold truncated at that draw's own EOL). */
  miles: Float64Array;
  /** Per-draw horizon in years. */
  years: Float64Array;
  truncatedDrawFraction: number;
  buyPrice: number;
  buyOdo: number;
}

export function costPerMileCf(
  vehicle: Vehicle,
  constants: Constants,
  inputs: EngineInputs = {},
  sw: CfSwitches = {},
): CfResult {
  const am = inputs.annualMiles ?? constants.annual_miles;
  const r = inputs.discountRate ?? constants.discount_rate_real;
  const gas = inputs.gasUsdPerGal ?? constants.gas_usd_per_gal;
  const elec = inputs.elecUsdPerKwh ?? constants.elec_usd_per_kwh;
  const draws = inputs.draws ?? constants.monte_carlo_draws;
  const seed = inputs.seed ?? 42;
  const buyOdo = inputs.buyOdo ?? vehicle.pinned_buy_odo;
  const holdMiles = inputs.holdMiles ?? "eol";
  const insMult = inputs.insuranceMultiplier ?? constants.insurance_multiplier_USAA;
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
  const tier = constants.reliability_tiers[vehicle.reliability_tier]!;
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

  const epm = energyPerMileLocal(vehicle, constants, gas, elec, am);
  const lnr = Math.log(1 + r);
  const a0 = buyOdo / am;
  const upkeepEsc = (age: number) =>
    1 + CAL.calAgeEscPerYr * Math.max(age - CAL.calAgeEscStartAge, 0);

  const detSell =
    holdMiles === "eol"
      ? vehicle.eol_maintained_miles
      : Math.min(buyOdo + holdMiles, vehicle.eol_maintained_miles);
  const detMiles = Math.max(detSell - buyOdo, am);
  const detT = detMiles / am;
  const avgDf = r === 0 ? 1 : (1 - Math.pow(1 + r, -detT)) / (detT * lnr);
  const energy = epm * avgDf;

  const base = hashString(vehicle.name) ^ (seed >>> 0);
  const rngEol = new Rng(base ^ 0x1111);
  const rngIns = new Rng(base ^ 0x2222);
  const rngRepN = new Rng(base ^ 0x3333);
  const rngRepC = new Rng(base ^ 0x4444);
  const rngBatt = new Rng(base ^ 0x5555);

  const cpm = new Float64Array(draws);
  const pvUsd = new Float64Array(draws);
  const pvMilesArr = new Float64Array(draws);
  const milesArr = new Float64Array(draws);
  const yearsArr = new Float64Array(draws);
  const useTax = taxRate * buyPrice;
  let truncatedDraws = 0;

  for (let i = 0; i < draws; i++) {
    let eol = vehicle.eol_maintained_miles * Math.exp(sigmaEol * rngEol.normal());
    if (eol < buyOdo + am) eol = buyOdo + am;
    const sell = holdMiles === "eol" ? eol : Math.min(buyOdo + holdMiles, eol);
    if (holdMiles !== "eol" && sell < buyOdo + holdMiles) truncatedDraws++;
    const miles = sell - buyOdo;
    const T = miles / am;
    const dfT = Math.pow(1 + r, -T);

    const curveResale = Math.max(curveAt(priceCurve, sell, scrap), scrap);
    let resale: number;
    if (sw.resaleCliff) {
      resale = sell >= eol ? scrap : curveResale;
    } else {
      const milesToEol = eol - sell;
      const blendMiles = CAL.resaleBlendWindowFraction * eol;
      resale =
        milesToEol >= blendMiles
          ? curveResale
          : scrap + (milesToEol / blendMiles) * (curveResale - scrap);
    }
    const dep = buyPrice - resale * dfT;

    let maintPV = 0;
    let insPV = 0;
    let regPV = 0;
    let lossPV = 0;
    let pvMiles = 0;
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
      insPV +=
        w * (full ? fullCov : liab) * (1 + CAL.insuranceNoiseSigma * rngIns.normal()) * df;
      regPV += w * reg * df;
      lossPV +=
        w *
        constants.total_loss_rate_per_yr *
        (full ? constants.collision_deductible_usd : book) *
        df;
      pvMiles += w * am * df;
    }

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

    let battPV = 0;
    if (vehicle.battery) {
      const failed = rngBatt.next() < vehicle.battery.failure_prob;
      const z = rngBatt.normal();
      if (failed) {
        const cost = vehicle.battery.pack_cost_usd * Math.exp(vehicle.battery.cost_sigma * z);
        battPV = cost * Math.pow(1 + r, -(constants.battery_event_frac_of_life * T));
      }
    }

    const tiresNominal = tiresPerMi * miles;
    const tiresPv = tiresPerMi * pvMiles;
    const nonTires = dep + useTax + maintPV + insPV + regPV + lossPV + repairPV + battPV;

    let total: number;
    if (sw.levelize) {
      const tires = sw.discountTires ? tiresPv : tiresNominal;
      // energy folded into the numerator as PV dollars on the denominator's own
      // discrete end-of-year convention, so energy/PV-miles collapses to `epm`.
      total = (nonTires + tires + epm * pvMiles) / pvMiles;
    } else {
      total = (nonTires + tiresNominal) / miles + energy;
    }

    cpm[i] = total;
    // PV dollars of the hold, on the numerator convention the switches select.
    pvUsd[i] = nonTires + (sw.discountTires ? tiresPv : tiresNominal) + epm * pvMiles;
    pvMilesArr[i] = pvMiles;
    milesArr[i] = miles;
    yearsArr[i] = T;
  }

  const sorted = Float64Array.from(cpm).sort();
  return {
    p50: quantileSorted(sorted, 0.5),
    cpm,
    pvUsd,
    pvMiles: pvMilesArr,
    miles: milesArr,
    years: yearsArr,
    truncatedDrawFraction: truncatedDraws / draws,
    buyPrice,
    buyOdo,
  };
}

/** Verbatim copy of the shipped `energyPerMile` (not exported per-file there in a
 *  form this copy can reuse without importing the shipped engine's own version —
 *  it is imported below instead; kept as a thin alias so the copy reads like the
 *  original). */
import { energyPerMile as energyPerMileShipped } from "../packages/core/src/engine.js";
function energyPerMileLocal(
  vehicle: Vehicle,
  constants: Constants,
  gas: number,
  elec: number,
  annualMiles: number,
): number {
  return energyPerMileShipped(vehicle, constants, gas, elec, annualMiles);
}
