/** Schema mirrors opencawr_data.json. */

export type EType = "gas" | "hybrid" | "ev" | "phev";
export type ReliabilityTierName = "low" | "mid" | "high" | "sport";
export type Provenance = "curated" | "proxied";

export interface VehicleSpecs {
  mpg_combined: number | null;
  kwh_per_100mi: number | null;
  phev_gas_mpg: number | null;
  phev_utility_factor: number | null;
  seats: number;
  cargo_cu_ft: number;
  co2_g_per_mi: number;
  full_coverage_ins_usd_yr: number;
}

export interface BatterySpec {
  failure_prob: number;
  pack_cost_usd: number;
  cost_sigma: number;
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
  liability_only_usd_yr: number;
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
  /** Real full-coverage quote in $/yr. When set, used as-is (no multiplier applied).
   *  Default: vehicle.specs.full_coverage_ins_usd_yr × insuranceMultiplier. */
  fullCoverageUsdYr?: number;
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
}
