import { describe, expect, it } from "vitest";
import { buyPointSweep } from "../src/buypoint.js";
import type { Constants, Vehicle } from "../src/types.js";

/**
 * Synthetic fixture with every non-depreciation cost component zeroed out
 * (reliability tail off, no battery, zero insurance/registration/maintenance/
 * tires/use-tax/energy, r=0, sigma_eol=0) so `costPerMile` collapses to an
 * exact, deterministic `buyPrice / (eol_maintained_miles - buyOdo)` — letting
 * these tests assert exact P50s from a hand-picked price curve, rather than
 * fight Monte Carlo noise.
 */
function makeConstants(): Constants {
  const zeroTier = { annual_prob_past_120k: 0, median_usd_per_event: 0 };
  return {
    annual_miles: 10_000,
    discount_rate_real: 0,
    gas_usd_per_gal: 0,
    elec_usd_per_kwh: 0,
    liability_only_usd_yr: 0,
    full_cov_threshold_usd: 0,
    insurance_multiplier_USAA: 1,
    registration_usd_yr_FL: 0,
    monte_carlo_draws: 5,
    hassle_per_major_repair_usd: 0,
    now_year: 2025,
    year_reliability_multipliers: { landmine: 1, caution: 1, sweet_spot: 1, normal: 1 },
    tires_usd_per_mi_by_body: { sedan: 0 },
    scrap_usd_by_body: { sedan: 0 },
    reliability_tiers: { low: zeroTier, mid: zeroTier, high: zeroTier, sport: zeroTier },
    collision_deductible_usd: 0,
    eol_sigma_by_tier: { low: 0, mid: 0, high: 0, sport: 0 },
    use_tax_rate: 0,
    total_loss_rate_per_yr: 0,
    battery_event_frac_of_life: 0.65,
    ev_kwh_degradation_mult: 1,
    dcfc_elec_mult_ev: 1,
    dcfc_elec_mult_phev: 1,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    name: "Fixture Car",
    make: "Fixture",
    body: "sedan",
    etype: "gas",
    first_year: 2020,
    last_year: 2025,
    reliability_tier: "low",
    provenance: "curated",
    specs: {
      mpg_combined: 100,
      kwh_per_100mi: null,
      phev_gas_mpg: null,
      phev_utility_factor: null,
      seats: 5,
      cargo_cu_ft: 15,
      co2_g_per_mi: 0,
      full_coverage_ins_usd_yr: 0,
    },
    eol_maintained_miles: 1_000_000,
    pinned_buy_odo: 10_000,
    pinned_buy_year_est: 2024,
    price_vs_odometer_usd: { "0": 50_000 },
    maintenance_usd_per_yr_by_age: { "0": 0, "50": 0 },
    repair_cost_multiplier_by_make: 1,
    model_year_reliability: { bad: [], caution: [], good: [] },
    ...overrides,
  };
}

describe("buyPointSweep", () => {
  it("monotone-cost fixture: argmin sits at the range's cheapest end", () => {
    // Flat price curve (curveAt with a single point returns it for any x), so
    // total $/mi = price / (eol_maintained_miles - buyOdo) is strictly
    // increasing in buyOdo (shrinking denominator, constant numerator) — the
    // true argmin is unambiguously the feasible range's lower bound.
    const vehicle = makeVehicle(); // first_year 2020, last_year 2025 → range [0, 50000]
    const constants = makeConstants();

    const result = buyPointSweep(vehicle, constants, {}, { step: 10_000 });

    expect(result.grid.length).toBeGreaterThan(1);
    expect(result.idealOdo).toBe(0);
    expect(result.idealP50).toBe(Math.min(...result.grid.map((p) => p.p50)));
    // strictly increasing across the whole grid
    for (let i = 1; i < result.grid.length; i++) {
      expect(result.grid[i]!.p50).toBeGreaterThan(result.grid[i - 1]!.p50);
    }
  });

  it("tolerance walk stops at the first violation and does not jump a gap", () => {
    // Hand-picked price curve so total $/mi (= price / (1,000,000 - buyOdo))
    // comes out to an exact target at each 10k-mi grid node:
    //   0 → 0.20   10k → 0.10 (ideal)   20k → 0.104 (within 5% tol)
    //   30k → 0.11 (violates)           40k → 0.102 (dip back under tol — must be excluded)
    //   50k → 0.15
    const vehicle = makeVehicle({
      first_year: 2020, // range [0, 50000] at am=10000, now_year=2025
      last_year: 2025,
      eol_maintained_miles: 1_000_000,
      price_vs_odometer_usd: {
        "0": 200_000,
        "10000": 99_000,
        "20000": 101_920,
        "30000": 106_700,
        "40000": 97_920,
        "50000": 142_500,
      },
    });
    const constants = makeConstants();

    const result = buyPointSweep(vehicle, constants, {}, { step: 10_000 });

    expect(result.idealOdo).toBe(10_000);
    expect(result.idealP50).toBeCloseTo(0.1, 9);
    // Must stop at the 20k point (last one within tolerance before the 30k
    // violation) — NOT jump past the violation to the 40k dip.
    expect(result.upperOdo).toBe(20_000);
  });

  it("a single-point feasible range returns upperOdo: null", () => {
    // first_year === last_year === now_year collapses feasibleOdoRange to [0, 0].
    const vehicle = makeVehicle({ first_year: 2025, last_year: 2025 });
    const constants = makeConstants();

    const result = buyPointSweep(vehicle, constants, {}, { step: 10_000 });

    expect(result.grid).toEqual([{ odo: 0, p50: result.idealP50 }]);
    expect(result.idealOdo).toBe(0);
    expect(result.upperOdo).toBeNull();
  });

  it("regression: year-implied lower bound past eol_maintained_miles collapses to the capped point instead of throwing (Porsche 996 crash)", () => {
    // At high annual miles, a narrow-production-window, low-eol vehicle can have
    // feasibleOdoRange's lower bound (year-implied) exceed eol_maintained_miles —
    // uncapped this inverts the range (lo > hi) and `grid[idealIdx]!` throws on
    // an empty grid. rangeLo = (2025-2020)*20000 = 100,000 > eol_maintained_miles
    // (50,000), so the fix's `lo = min(max(0, rangeLo), hi)` must collapse this to
    // the single physically-capped point rather than crash.
    const vehicle = makeVehicle({
      first_year: 2015,
      last_year: 2020,
      eol_maintained_miles: 50_000,
    });
    const constants = makeConstants();

    expect(() =>
      buyPointSweep(vehicle, constants, { annualMiles: 20_000 }, { step: 10_000 }),
    ).not.toThrow();

    const result = buyPointSweep(vehicle, constants, { annualMiles: 20_000 }, { step: 10_000 });

    expect(result.grid).toEqual([{ odo: 50_000, p50: result.idealP50 }]);
    expect(result.idealOdo).toBe(50_000);
    expect(result.upperOdo).toBeNull();
  });
});
