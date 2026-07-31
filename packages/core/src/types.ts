/** Schema mirrors opencawr_data.json. */

export type EType = "gas" | "hybrid" | "ev" | "phev";
export type ReliabilityTierName = "low" | "mid" | "high" | "sport";
export type Provenance = "curated" | "proxied";

export interface VehicleSpecs {
  mpg_combined: number | null;
  kwh_per_100mi: number | null;
  phev_gas_mpg: number | null;
  phev_utility_factor: number | null;
  /** EPA electric-only range (mi), fresh-battery. PHEV only; feeds the mileage-dependent
   *  utility factor (see ASSUMPTIONS.md §B). Optional — absent means the fixed seed
   *  `phev_utility_factor` is used with no mileage sensitivity. */
  electric_range_mi?: number;
  seats: number;
  cargo_cu_ft: number;
  co2_g_per_mi: number;
  /** @deprecated Unprovenanced seed estimate, no longer read by the engine (R13,
   *  2026-07-29). Insurance is now NAIC state premium × value-scaling — see
   *  ASSUMPTIONS.md §A. Kept in the schema/data per the revision-log ethos
   *  (old numbers stay visible, never deleted); the pipeline still fills it. */
  full_coverage_ins_usd_yr: number;
}

export interface BatterySpec {
  failure_prob: number;
  pack_cost_usd: number;
  cost_sigma: number;
}

/** One model year's descriptive facts (R2) — see `Vehicle.model_year_detail`. */
export interface ModelYearDetail {
  /** e.g. "2.5L I4, Automatic (AM-S8), FWD" — EPA fueleconomy.gov-sourced
   *  displacement/cylinders/transmission/drive, `null` if EPA had no data
   *  for this make/model/year. */
  drivetrain: string | null;
  /** Proxy signal only — a year-over-year change in the EPA drivetrain
   *  descriptor or VClass. NOT a confirmed styling refresh/facelift; EPA
   *  data carries no styling signal at all. */
  specChangeFromPriorYear: boolean;
  /** Most-reported NHTSA complaint top-level category for this model year
   *  (e.g. "ENGINE"), pooled the same way as the reliability-tier derivation.
   *  `null` outside that derivation's query window or with zero complaints. */
  topComplaintCategory: string | null;
  /** That category's share of this year's complaints, in [0, 1]. `null` iff
   *  `topComplaintCategory` is `null`. */
  topComplaintShare: number | null;
}

export interface Vehicle {
  name: string;
  make: string;
  body: string;
  etype: EType;
  first_year: number;
  last_year: number;
  reliability_tier: ReliabilityTierName;
  provenance: Provenance;
  specs: VehicleSpecs;
  eol_maintained_miles: number;
  pinned_buy_odo: number;
  pinned_buy_year_est: number;
  price_vs_odometer_usd: Record<string, number>;
  maintenance_usd_per_yr_by_age: Record<string, number>;
  repair_cost_multiplier_by_make: number;
  model_year_reliability: { bad: number[]; caution: number[]; good: number[] };
  /** Per-model-year facts (R2), never read by the cost engine — purely
   *  descriptive, so adding/populating this touches no reference output.
   *  Keyed by model year; a year with no data (outside the pipeline's query
   *  window, or an EPA/NHTSA lookup gap) is simply absent. See
   *  docs/model-year-detail-methodology.md. */
  model_year_detail?: Record<string, ModelYearDetail>;
  /** Present on ev/phev/hybrid vehicles (data-driven battery risk). */
  battery?: BatterySpec;
  maintenance_curve_shared_with?: string[];
}

export interface ReliabilityTier {
  annual_prob_past_120k: number;
  median_usd_per_event: number;
}

export interface Constants {
  annual_miles: number;
  discount_rate_real: number;
  gas_usd_per_gal: number;
  elec_usd_per_kwh: number;
  /** NAIC liability average premium, CY2023 $/yr (pre-escalator, pre-multiplier). */
  liability_only_usd_yr: number;
  /** NAIC collision average premium, CY2023 $/yr (pre-escalator, pre-multiplier). */
  collision_premium_usd_yr: number;
  /** NAIC comprehensive average premium, CY2023 $/yr (pre-escalator, pre-multiplier). */
  comprehensive_premium_usd_yr: number;
  /** BLS CPI-U `CUUR0000SETE` escalator, CY2023 → snapshot date (ASSUMPTIONS.md §A). */
  insurance_cpi_escalator: number;
  /** Book value at which a car pays exactly the NAIC average collision+comprehensive
   *  premium; the own-vehicle half scales linearly against it (ASSUMPTIONS.md §A). */
  insurance_ref_book_usd: number;
  full_cov_threshold_usd: number;
  insurance_multiplier_USAA: number;
  registration_usd_yr_FL: number;
  monte_carlo_draws: number;
  hassle_per_major_repair_usd: number;
  now_year: number;
  year_reliability_multipliers: {
    landmine: number;
    caution: number;
    sweet_spot: number;
    normal: number;
  };
  tires_usd_per_mi_by_body: Record<string, number>;
  scrap_usd_by_body: Record<string, number>;
  reliability_tiers: Record<ReliabilityTierName, ReliabilityTier>;
  collision_deductible_usd: number;
  eol_sigma_by_tier: Record<ReliabilityTierName, number>;
  use_tax_rate: number;
  total_loss_rate_per_yr: number;
  battery_event_frac_of_life: number;
  ev_kwh_degradation_mult: number;
  dcfc_elec_mult_ev: number;
  dcfc_elec_mult_phev: number;
}

/** User-settable inputs (spec §4). Everything defaults from Constants / the vehicle. */
export interface EngineInputs {
  /** Purchase odometer. Default: vehicle.pinned_buy_odo. */
  buyOdo?: number;
  /** Actual price paid (Deal Analyzer). Default: modeled price curve at buyOdo. */
  purchasePrice?: number;
  /** Holding horizon in miles, or "eol" for drive-to-death (spec §3). Default "eol". */
  holdMiles?: number | "eol";
  annualMiles?: number;
  /** Real discount rate = market opportunity cost. Opportunity cost enters ONLY here (spec §2). */
  discountRate?: number;
  gasUsdPerGal?: number;
  elecUsdPerKwh?: number;
  /** Real full-coverage quote in $/yr. When set, used as-is (no multiplier, no
   *  value-scaling, no escalator) — it is the user's actual number, not an average.
   *  Default: the NAIC-based estimate below. */
  fullCoverageUsdYr?: number;
  /** NAIC state average premiums, CY2023 $/yr, one per coverage — regional prefills,
   *  NOT quotes: the escalator and the insurance multiplier both still apply.
   *  Defaults: the matching `constants.*` values. */
  liabilityUsdYr?: number;
  collisionUsdYr?: number;
  comprehensiveUsdYr?: number;
  insuranceMultiplier?: number;
  registrationUsdYr?: number;
  /** Sales/use tax rate on the purchase (state-specific). Default constants.use_tax_rate. */
  useTaxRate?: number;
  draws?: number;
  seed?: number;
}

export interface CostBreakdown {
  /** Expected (mean-across-draws) present-value $/mi by component. */
  depreciation: number;
  useTax: number;
  maintenance: number;
  insurance: number;
  registration: number;
  totalLoss: number;
  repairs: number;
  tires: number;
  battery: number;
  energy: number;
  total: number;
}

export interface EngineResult {
  p50: number;
  p75: number;
  p90: number;
  p05: number;
  p95: number;
  breakdown: CostBreakdown;
  /** Reporting columns only — opportunity cost is already inside the $/mi via discounting. */
  oppCostLifetimeUsd: number;
  oppCostPerMi: number;
  /** Raw simulated $/mi draws (for beat-probabilities and tie tiers). */
  drawsCpm: Float64Array;
  /** Resolved context */
  buyPrice: number;
  buyOdo: number;
  impliedBuyYear: number;
  feasible: boolean;
  medianSellOdo: number;
  /** Reporting column only — the median TOTAL dollars this car costs over the miles it is
   *  held, and the median miles that total spans. Nothing downstream of the $/mi depends on
   *  it; it is the same simulation reported in dollars instead of $/mi.
   *
   *  `lifetimeCostUsdP50` is its OWN quantile over the per-draw dollar totals
   *  (`cpm[i] * miles_i`), NOT `p50 * lifetimeMilesP50`. Each draw samples its own
   *  end-of-life, so `miles` varies draw to draw, and the median of a ratio is not the
   *  ratio of medians — the two agree only when miles are effectively constant (a fixed
   *  hold well inside every draw's life), and diverge at `holdMiles: "eol"`.
   *
   *  The miles are reported alongside because at `"eol"` two cars' totals span different
   *  lifespans and so are NOT comparable to each other in raw dollars (R10's unequal-lives
   *  problem, in dollars rather than $/mi). */
  lifetimeCostUsdP50: number;
  lifetimeMilesP50: number;
  /** Fraction of draws in [0,1] whose hold ended early because that draw's sampled
   *  end-of-life arrived before `buyOdo + holdMiles` — i.e. how often the requested
   *  holding period is not achievable for this car at this buy point. Always 0 at
   *  `holdMiles: "eol"`, where selling at end of life is the definition of the hold
   *  rather than a curtailment of it.
   *
   *  This is what makes `lifetimeMilesP50` fall short of the requested hold, and
   *  (together with the varying miles it implies) what skews `lifetimeCostUsdP50`
   *  away from `p50 × lifetimeMilesP50` — see that field's note. Reporting only;
   *  nothing in the cost math reads it. */
  truncatedDrawFraction: number;
}
