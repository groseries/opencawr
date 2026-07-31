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

  /** JUDGMENT: reduced-precision draws for the buy-point sweep (buypoint.ts) — the
   *  survey drawer's 400-draw reduction (ASSUMPTIONS.md §I) is the existing precedent
   *  for trading Monte Carlo precision for speed on a many-point grid search. */
  sweepDraws: 300,

  /** JUDGMENT: buy-point sweep grid step, in miles. 2,500 since the buy-point and
   *  model-year answers were unified (ASSUMPTIONS.md §B): the sweep's grid is now
   *  also the model-year panel's grid, and a model year's odometer band is only
   *  `annualMiles` wide (~13,000 mi at the default), so the previous 10,000-mile
   *  step gave ~1.3 samples per band — too coarse to say where inside a year the
   *  cheapest mileage sits. 2,500 gives ~5 per band. Costs ~4x the grid points
   *  (measured: 71-car field sweep 398 ms -> 1,510 ms in node), which is why
   *  `handleRank`, which absorbed the sweep, yields between chunks of cars. */
  sweepStepMiles: 2_500,

  /** JUDGMENT: "still worth buying" = within this fraction of the sweep's cheapest
   *  feasible P50 — sets the buy-point sweep's upper-mileage-limit tolerance. */
  worthwhileP50Tolerance: 0.05,

  /** JUDGMENT (reporting only — no cost math reads it): a Rankings row states that
   *  end of life curtails its holding period once this share of draws
   *  (`EngineResult.truncatedDrawFraction`) sold early. The threshold-free half of
   *  the rule needs no constant — when the MEDIAN miles fall short of the hold the
   *  row always says so — but that fires only above 50%, which would leave the
   *  Chevy Volt's 37%-curtailed 100k hold (median a full 100k, minority truncated,
   *  7.3% gap between its own two displayed columns) silent. A quarter is the
   *  smallest round "material minority" that covers it; measured over the seed
   *  field at the app's defaults it discloses on 10/71 cars at a 50k hold, 10/71 at
   *  100k and 46/71 at 150k, vs. 48/63/67 if any non-zero share qualified.
   *  See ASSUMPTIONS.md §I. */
  truncatedDrawDisclosureFraction: 0.25,
} as const;
