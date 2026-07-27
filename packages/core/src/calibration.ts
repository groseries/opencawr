/**
 * Reverse-engineered model parameters.
 *
 * The prototype source (build_v7.py) was lost before handoff. Every value here was
 * INFERRED by fitting the engine to the 71 golden model_output rows in
 * opencawr_data.json (2026-07-27 calibration; fleet MAE ≈ $0.007/mi on P50).
 * None of these is a sourced real-world figure — do not cite them as data.
 * If build_v7.py ever resurfaces, replace these with the prototype's true values.
 *
 * Values that ARE sourced live in opencawr_data.json's `constants` block, not here.
 */
export const CALIBRATION = {
  /** Maintenance rises past the curve's last age point at (last segment slope × this). */
  lateMaintSlopeMult: 3.5,

  /** Lognormal sigma on end-of-life miles. Spec §10 quotes σ=0.12; 0.07 is what
   *  actually reproduces the golden P05/P95 bands. Kept at the fitted value. */
  sigmaEol: 0.07,

  /** Lognormal noise on total insurance PV per draw. */
  sigmaIns: 0.05,

  /** Lognormal sigma on each major-repair event cost (median-preserving). */
  sigmaRepair: 0.33,

  /** Odometer threshold where the major-repair Poisson tail switches on (spec §2 "~120k"). */
  repairOdoThreshold: 120_000,

  /** EV pack failure: Bernoulli per ownership, cost incurred at a random time. */
  evPackFailureProb: 0.33,
  evPackCostUsd: 11_500,
  /** Failure time as a fraction of the holding period, uniform in this window. */
  battFailTimeFrac: [0.3, 0.9] as const,

  /** PHEV/hybrid battery treated as a flat reserve (added to every draw, discounted mid-life). */
  phevBatteryReserveUsd: 500,
  hybridBatteryReserveUsd: 1_000,

  /** The model-year reliability multiplier (landmine/caution/sweet-spot) applies to
   *  BOTH the repair event rate and the scheduled-maintenance curve (inferred). */
  yearMultOnMaintenance: true,

  /** Tie-tier walk: a car starts a new tier when the tier leader beats it with ≥ this prob. */
  tieTierBeatProb: 0.85,
} as const;
