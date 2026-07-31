import { describe, expect, it } from "vitest";
import { modelYearRank } from "../src/modelyear.js";
import { buyPointSweep } from "../src/buypoint.js";
import type { SweepInputs } from "../src/buypoint.js";
import type { Constants, Vehicle } from "../src/types.js";

/** Same zeroed-out fixture discipline as buypoint.test.ts: every non-
 *  depreciation component zeroed so costPerMile collapses to an exact,
 *  deterministic buyPrice / (eol_maintained_miles - buyOdo). */
function makeConstants(overrides: Partial<Constants> = {}): Constants {
  const zeroTier = { annual_prob_past_120k: 0, median_usd_per_event: 0 };
  return {
    annual_miles: 10_000,
    discount_rate_real: 0,
    gas_usd_per_gal: 0,
    elec_usd_per_kwh: 0,
    liability_only_usd_yr: 0,
    collision_premium_usd_yr: 0,
    comprehensive_premium_usd_yr: 0,
    insurance_cpi_escalator: 1,
    insurance_ref_book_usd: 1,
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
    ...overrides,
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

describe("modelYearRank", () => {
  it("reports each model year at its own cheapest odometer, one row per feasible year", () => {
    // first_year 2020, last_year 2025 -> 6 feasible years. am=10,000,
    // now_year=2025, step 10,000 -> exactly one grid point per year band:
    // 2025->0, 2024->10k, ..., 2020->50k.
    const vehicle = makeVehicle();
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    expect(result.points).toHaveLength(6);
    expect(result.points.map((p) => p.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    const byYear = new Map(result.points.map((p) => [p.year, p]));
    expect(byYear.get(2025)!.odo).toBe(0);
    expect(byYear.get(2020)!.odo).toBe(50_000);
    expect(result.points.every((p) => !p.clamped)).toBe(true);
  });

  it("a year's row is the cheapest point INSIDE that year's own band, not its band edge by default", () => {
    // A finer step than the band width (a band is `annualMiles` = 10,000 mi
    // wide) so one band holds several grid points. The R11 floor puts the grid
    // at 25k/27.5k/.../50k; 2022's band is (25,000, 35,000] (deriveBuyYear
    // rounds 2022.5 up to 2023 at exactly 25,000), so it holds 27.5k-35k. The
    // curve has a dip at 30,000 — strictly inside that band, and not at either
    // of its edges — which is what the row must report.
    const vehicle = makeVehicle({
      eol_maintained_miles: 1_000_000,
      price_vs_odometer_usd: {
        "25000": 120_000,
        "27500": 118_000,
        "30000": 90_000,
        "32500": 118_000,
        "35000": 120_000,
      },
    });
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 2_500 });

    const row2022 = result.points.find((p) => p.year === 2022)!;
    expect(row2022.odo).toBe(30_000);
    expect(row2022.clamped).toBe(false);
  });

  it("flat price curve: monotone cost in odometer, so newest year ranks cheapest and rank is a contiguous 1..N", () => {
    // Flat curve -> $/mi = price / (eol - odo), strictly increasing in odo,
    // so the newest year (odo=0) must rank #1 and the oldest (odo=50k) last.
    const vehicle = makeVehicle();
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    const byYear = new Map(result.points.map((p) => [p.year, p]));
    expect(byYear.get(2025)!.rank).toBe(1);
    expect(byYear.get(2020)!.rank).toBe(6);
    expect(result.bestYear).toBe(2025);
    expect(result.bestOdo).toBe(0);
    expect(new Set(result.points.map((p) => p.rank))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it("the best row IS the buy-point sweep's sweet spot — same year, same odometer, same P50", () => {
    // THE regression this unification exists to prevent: two answers to "when
    // should I buy this car" that can name different years. A curve with a
    // genuine interior optimum (dip at 30k, so neither end wins by default),
    // checked at the default calibration step and at a coarser one.
    const vehicle = makeVehicle({
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

    for (const opts of [{}, { step: 10_000 }, { step: 2_500 }]) {
      const sweep = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, opts);
      const rank = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, opts);
      const best = rank.points.find((p) => p.rank === 1)!;

      expect(rank.bestYear).toBe(sweep.idealYear);
      expect(rank.bestOdo).toBe(sweep.idealOdo);
      expect(rank.bestP50).toBe(sweep.idealP50);
      expect(best.year).toBe(sweep.idealYear);
      expect(best.odo).toBe(sweep.idealOdo);
      expect(best.p50).toBe(sweep.idealP50);
      // and no row can be cheaper than the sweep's own minimum
      for (const p of rank.points) expect(p.p50).toBeGreaterThanOrEqual(sweep.idealP50);
    }
  });

  /**
   * R15: ordering the years is not the same as being able to tell them apart.
   * One fixture covers both halves of the claim — a year whose draws overlap the
   * one above it lands in the SAME tier, a year that is genuinely cheaper does
   * not — so the two can't be tuned against each other.
   *
   * The dispersion is EOL noise (`eol_sigma_by_tier`), the only stochastic
   * component this zeroed fixture leaves on. It decorrelates the candidates
   * because the holding period binds for the newest years while end-of-life
   * binds for the oldest, so one shared EOL draw moves their costs differently —
   * which is exactly how the real field behaves.
   */
  describe("tie tiers (R15)", () => {
    const sigma = 0.15;
    const constants = makeConstants({
      eol_sigma_by_tier: { low: sigma, mid: sigma, high: sigma, sport: sigma },
    });
    // Prices fall smoothly with odometer EXCEPT at 30,000 mi, where a deep dip
    // makes 2022 unambiguously the cheapest year; 2019 and 2020 sit within 2% of
    // each other — both near enough to this vehicle's 150k EOL at this 100k hold
    // to land in the R20 resale-blend window, which is what ties them (moved from
    // 2020/2021 when R20 shipped: blending resale removed the extra dispersion the
    // old hard cliff added right at this boundary).
    const vehicle = makeVehicle({
      first_year: 2019,
      last_year: 2025,
      eol_maintained_miles: 150_000,
      price_vs_odometer_usd: {
        "0": 50_000,
        "10000": 45_500,
        "20000": 41_400,
        "30000": 20_000,
        "40000": 34_300,
        "50000": 31_200,
        "60000": 28_400,
        "70000": 25_800,
      },
    });
    const inputs = { holdMiles: 100_000 };

    it("two years whose draw distributions overlap land in the same tier", () => {
      const result = modelYearRank(vehicle, constants, inputs, { step: 10_000 });
      const byYear = new Map(result.points.map((p) => [p.year, p]));
      const a = byYear.get(2020)!;
      const b = byYear.get(2019)!;

      // Genuinely different points at genuinely different prices — this is not
      // the trivial case of two years sharing one grid point.
      expect(a.odo).not.toBe(b.odo);
      expect(a.p50).not.toBe(b.p50);
      expect(Math.abs(b.p50 - a.p50) / a.p50).toBeLessThan(0.02);
      // ...and the model still can't say which is cheaper: adjacent in rank,
      // one tier.
      expect(b.rank).toBe(a.rank + 1);
      expect(a.beatsNextProb).toBeLessThan(0.85);
      expect(a.tier).toBe(b.tier);
    });

    it("a clearly cheaper year does not share a tier with the rest", () => {
      const result = modelYearRank(vehicle, constants, inputs, { step: 10_000 });
      const winner = result.points.find((p) => p.year === 2022)!;

      expect(winner.rank).toBe(1);
      expect(winner.tier).toBe(1);
      expect(winner.beatsNextProb).toBeGreaterThanOrEqual(0.85);
      // Alone in tier 1: every other year is in a later tier.
      expect(result.points.filter((p) => p.tier === 1)).toHaveLength(1);
    });

    it("tiers annotate the ranking, they never reorder it", () => {
      const sweep = buyPointSweep(vehicle, constants, inputs, { step: 10_000 });
      const result = modelYearRank(vehicle, constants, inputs, { step: 10_000 });
      const byRank = [...result.points].sort((a, b) => a.rank - b.rank);

      // Rank 1 is still the sweep's own sweet spot, unchanged by the tier walk.
      expect(result.bestYear).toBe(sweep.idealYear);
      expect(result.bestOdo).toBe(sweep.idealOdo);
      expect(result.bestP50).toBe(sweep.idealP50);
      expect(byRank[0]!.tier).toBe(1);
      // Tiers are non-decreasing down the ranking and every row has one.
      for (let i = 1; i < byRank.length; i++) {
        expect(byRank[i]!.tier).not.toBeNull();
        expect(byRank[i]!.tier!).toBeGreaterThanOrEqual(byRank[i - 1]!.tier!);
      }
      // Last row has no next row to beat.
      expect(byRank[byRank.length - 1]!.beatsNextProb).toBeNull();
    });
  });

  it("marks a year clamped when NO feasible odometer falls in its own band (R11 curve floor)", () => {
    // Price curve's first observation is at 30,000 mi, so the grid runs
    // 30k/40k/50k -> bands 2022/2021/2020. 2023-2025's bands are entirely below
    // the floor: they cannot be priced at any mileage of their own.
    const vehicle = makeVehicle({
      price_vs_odometer_usd: { "30000": 30_000, "50000": 20_000 },
    });
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    const byYear = new Map(result.points.map((p) => [p.year, p]));
    for (const year of [2023, 2024, 2025]) {
      expect(byYear.get(year)!.clamped).toBe(true);
      expect(byYear.get(year)!.odo).toBe(30_000); // nearest feasible odometer
    }
    for (const year of [2020, 2021, 2022]) {
      expect(byYear.get(year)!.clamped).toBe(false);
    }
    // Every row still gets a tier: the sweep retains the draws for the points a
    // clamped row falls back to (the grid's ends), not just the band winners.
    expect(result.points.every((p) => p.tier !== null)).toBe(true);
    expect(byYear.get(2022)!.odo).toBe(30_000);
    expect(byYear.get(2020)!.odo).toBe(50_000);
  });

  it("a single-point feasible range prices every year identically (the degenerate case the UI refuses to call)", () => {
    // Same collapse as the two Porsche 996 rows: the whole production window
    // sits outside the feasible odometer range, so the grid is one point and
    // every year clamps onto it. The panel detects this by all odometers being
    // equal, so that property is what this pins.
    const vehicle = makeVehicle({
      first_year: 2015,
      last_year: 2020,
      eol_maintained_miles: 50_000,
    });
    const constants = makeConstants();

    const inputs = { annualMiles: 20_000, holdMiles: 1_000_000 };
    const result = modelYearRank(vehicle, constants, inputs, { step: 10_000 });
    const sweep = buyPointSweep(vehicle, constants, inputs, { step: 10_000 });

    expect(new Set(result.points.map((p) => p.odo))).toEqual(new Set([50_000]));
    expect(new Set(result.points.map((p) => p.p50)).size).toBe(1);
    // 2015-2019 are clamped: no odometer of their own is feasible. 2020 is not,
    // because deriveBuyYear clamps the single point's implied year (2022.5) into
    // the production window and lands it on 2020 — the newest/oldest band always
    // absorbs the odometers past the window's edge.
    expect(result.points.filter((p) => p.clamped).map((p) => p.year)).toEqual([
      2015, 2016, 2017, 2018, 2019,
    ]);
    expect(result.points.find((p) => p.year === 2020)!.clamped).toBe(false);
    // even here the two answers agree — the tie-break is the same point
    expect(result.bestOdo).toBe(sweep.idealOdo);
    expect(result.bestYear).toBe(sweep.idealYear);
    // The degenerate case is the limiting case of a tie tier (R15): identical
    // draws, so every year lands in tier 1 and none can be called cheapest.
    expect(result.points.every((p) => p.tier === 1)).toBe(true);
  });

  it("a single-year production run returns exactly one point", () => {
    const vehicle = makeVehicle({ first_year: 2025, last_year: 2025 });
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.year).toBe(2025);
    expect(result.points[0]!.rank).toBe(1);
    expect(result.bestYear).toBe(2025);
  });

  it("refuses an open-ended horizon: rejected by the type system, and by a runtime backstop", () => {
    const vehicle = makeVehicle();
    const constants = makeConstants();

    expect(() =>
      modelYearRank(vehicle, constants, { holdMiles: "eol" } as unknown as SweepInputs),
    ).toThrow(/numeric holdMiles/);
  });

  it("uses the rail's own numeric holding period, not a fixed default", () => {
    const vehicle = makeVehicle({
      price_vs_odometer_usd: { "0": 40_000, "50000": 20_000, "100000": 0 },
      eol_maintained_miles: 1_000_000,
    });
    const constants = makeConstants();

    const short = modelYearRank(vehicle, constants, { holdMiles: 20_000 }, { step: 10_000 });
    const long = modelYearRank(vehicle, constants, { holdMiles: 80_000 }, { step: 10_000 });

    expect(short.points.map((p) => p.p50)).not.toEqual(long.points.map((p) => p.p50));
  });
});
