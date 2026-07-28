/**
 * Model parameters that are mechanics of the engine rather than per-vehicle data.
 *
 * Provenance: the prototype source (build_v7.py) is lost, but the spreadsheet
 * CAWR.xlsx documents the v2b model in its "Assumptions" and "Model & Method" tabs
 * (see ASSUMPTIONS.md at the repo root — the living ledger). Values below marked
 * DOCUMENTED come from those tabs; anything else is a labeled judgment call.
 * Per-vehicle/battery/dispersion values live in opencawr_data.json, not here.
 */
export const CALIBRATION = {
  /** DOCUMENTED: repair-cost lognormal sigma per event (median-preserving). */
  sigmaRepair: 0.5,

  /** DOCUMENTED: insurance noise Normal(1, 0.08) applied per year. */
  insuranceNoiseSigma: 0.08,

  /** DOCUMENTED: major-repair tail switches on past this odometer. */
  repairOdoThreshold: 120_000,

  /** DOCUMENTED: hazard ramp — event rate × (1 + (odo − threshold)/rampScale). */
  repairRampScaleMiles: 100_000,

  /** DOCUMENTED: calendar-age escalator ×(1 + rate·(age − startAge)⁺) on upkeep.
   *  JUDGMENT: applied to both scheduled maintenance and repair-event costs
   *  (the doc says "repairs"; we read the intent as upkeep broadly). Age is still
   *  odometer-derived (odo ÷ annual miles) — the prototype's own open limitation. */
  calAgeEscPerYr: 0.02,
  calAgeEscStartAge: 8,

  /** Fallback EOL dispersion when a tier is missing from constants.eol_sigma_by_tier. */
  sigmaEolFallback: 0.12,

  /** Tie-tier walk: a car starts a new tier when the tier leader beats it with ≥ this prob. */
  tieTierBeatProb: 0.85,
} as const;
