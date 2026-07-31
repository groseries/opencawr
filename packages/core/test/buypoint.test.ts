import { describe, expect, it } from "vitest";
import { buyPointSweep, priceAtSweetSpot } from "../src/buypoint.js";
import type { SweepInputs } from "../src/buypoint.js";
import { deriveBuyYear } from "../src/feasibility.js";
import type { Constants, Vehicle } from "../src/types.js";
import { loadSeedData } from "./helpers.js";

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
    // holdMiles is set equal to eol_maintained_miles (1,000,000) so that
    // buyOdo + holdMiles saturates the eol_maintained_miles cap at every grid
    // point (0-50,000) — a legitimate numeric hold that reproduces the same
    // "sell = eol" arithmetic this fixture was built around (R10: the sweep
    // no longer defaults to "eol" itself, but a large-enough numeric hold can
    // still land on the cap).
    const vehicle = makeVehicle(); // first_year 2020, last_year 2025 → range [0, 50000]
    const constants = makeConstants();

    const result = buyPointSweep(
      vehicle,
      constants,
      { holdMiles: 1_000_000 },
      { step: 10_000 },
    );

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

    // Same saturation trick as the test above: holdMiles = eol_maintained_miles
    // makes sell = eol at every grid point, matching the hand-picked targets.
    const result = buyPointSweep(
      vehicle,
      constants,
      { holdMiles: 1_000_000 },
      { step: 10_000 },
    );

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

    const result = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    expect(result.grid).toEqual([{ odo: 0, p50: result.idealP50, year: 2025 }]);
    expect(result.idealOdo).toBe(0);
    expect(result.upperOdo).toBeNull();
  });

  it("R11: the grid never proposes a buy odometer below the vehicle's first curve point", () => {
    // first_year 2020, last_year 2025, am=10,000 → feasibleOdoRange lower bound
    // is 0 (a current-production vehicle), but the price curve's first
    // observation is at 15,000 mi — the grid must floor there, not at 0.
    const vehicle = makeVehicle({
      price_vs_odometer_usd: { "15000": 30_000, "50000": 20_000 },
    });
    const constants = makeConstants();

    const result = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    expect(result.grid[0]!.odo).toBe(15_000);
    for (const p of result.grid) {
      expect(p.odo).toBeGreaterThanOrEqual(15_000);
    }
    expect(result.idealOdo).toBeGreaterThanOrEqual(15_000);
  });

  it("regression: a feasible range lying entirely below the first curve point collapses to a single point instead of throwing", () => {
    // first_year/last_year make the year-implied feasible range [0, 20,000],
    // but the price curve's first observation is at 25,000 mi — the R11 floor
    // pushes lo up past hi, which must collapse to the single point at hi
    // (same class of degeneracy as the Porsche 996 case below), not invert.
    const vehicle = makeVehicle({
      first_year: 2023,
      last_year: 2025,
      eol_maintained_miles: 1_000_000,
      price_vs_odometer_usd: { "25000": 30_000, "50000": 20_000 },
    });
    const constants = makeConstants();

    expect(() =>
      buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 }),
    ).not.toThrow();

    const result = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    // 20,000 mi at 10,000 mi/yr implies model year 2023 — the oldest this
    // (2023-2025) car can be, so deriveBuyYear needs no clamping here.
    expect(result.grid).toEqual([{ odo: 20_000, p50: result.idealP50, year: 2023 }]);
    expect(result.idealOdo).toBe(20_000);
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
      buyPointSweep(
        vehicle,
        constants,
        { annualMiles: 20_000, holdMiles: 1_000_000 },
        { step: 10_000 },
      ),
    ).not.toThrow();

    const result = buyPointSweep(
      vehicle,
      constants,
      { annualMiles: 20_000, holdMiles: 1_000_000 },
      { step: 10_000 },
    );

    // 50,000 mi at 20,000 mi/yr implies 2022.5 -> 2023, past this car's last
    // production year, so deriveBuyYear clamps the point's year to 2020.
    expect(result.grid).toEqual([{ odo: 50_000, p50: result.idealP50, year: 2020 }]);
    expect(result.idealOdo).toBe(50_000);
    expect(result.upperOdo).toBeNull();
  });

  it("refuses an open-ended horizon: rejected by the type system, and by a runtime backstop for callers that bypass it", () => {
    // The primary gate is SweepInputs (holdMiles: number, not number | "eol") —
    // a typed caller cannot compile `buyPointSweep(v, c, { holdMiles: "eol" })`.
    // This test exercises the runtime backstop in buyPointSweep itself, which
    // exists for callers that bypass the type system (plain JS, an `any` cast).
    const vehicle = makeVehicle();
    const constants = makeConstants();

    expect(() =>
      buyPointSweep(vehicle, constants, { holdMiles: "eol" } as unknown as SweepInputs, {
        step: 10_000,
      }),
    ).toThrow(/numeric holdMiles/);
  });

  it("every grid point carries its implied model year, and idealYear is the ideal point's own", () => {
    // The year on each point is what lets modelYearRank be a view of THIS grid
    // rather than a second optimization — it must be deriveBuyYear's answer for
    // that point's odometer, not re-derived arithmetic.
    const vehicle = makeVehicle(); // 2020-2025, am 10,000, now_year 2025
    const constants = makeConstants();

    const result = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });

    for (const p of result.grid) {
      expect(p.year).toBe(deriveBuyYear(vehicle, p.odo, 10_000, 2025));
    }
    expect(result.grid.map((p) => p.year)).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
    const ideal = result.grid.find((p) => p.odo === result.idealOdo)!;
    expect(result.idealYear).toBe(ideal.year);
  });

  it("keepRowDraws is off by default and, when on, retains only the model-year view's own points", () => {
    // The Rankings path must not pay for draws it never reads, and the model-year
    // path must not hold the whole grid's draws to get tie tiers (R15). The
    // retained set is the year-band winners plus the grid's two ends — never one
    // array per grid point.
    const vehicle = makeVehicle({
      // 6 model years, an 11-point grid: the two counts are far enough apart that
      // "one per year" and "one per grid point" cannot be confused.
      eol_maintained_miles: 1_000_000,
      price_vs_odometer_usd: { "0": 50_000, "50000": 20_000 },
    });
    const constants = makeConstants();
    const opts = { step: 5_000, draws: 64 };

    const plain = buyPointSweep(vehicle, constants, { holdMiles: 1_000_000 }, opts);
    expect(plain.rowDraws).toBeUndefined();

    const kept = buyPointSweep(
      vehicle,
      constants,
      { holdMiles: 1_000_000 },
      { ...opts, keepRowDraws: true },
    );
    const years = vehicle.last_year - vehicle.first_year + 1;
    expect(kept.grid.length).toBe(11);
    expect(kept.rowDraws!.size).toBeLessThanOrEqual(years + 2);
    expect(kept.rowDraws!.size).toBeLessThan(kept.grid.length);
    // The sweet spot is always among them (it is its own band's winner), and each
    // retained entry is that point's full draw vector.
    expect(kept.rowDraws!.get(kept.idealOdo)!.length).toBe(64);
    for (const odo of kept.rowDraws!.keys()) {
      expect(kept.grid.some((p) => p.odo === odo)).toBe(true);
    }
    // Retaining draws must not change the sweep itself.
    expect(kept.grid.map((p) => p.p50)).toEqual(plain.grid.map((p) => p.p50));
    expect(kept.idealOdo).toBe(plain.idealOdo);
  });

  it("uses the rail's own numeric holding period, not a fixed default", () => {
    // A price curve with real variation (not the flat single-point fixture
    // above) so a different holdMiles genuinely reprices every grid point —
    // demonstrating holdMiles is threaded through to costPerMile, not ignored
    // in favor of some other fixed hold.
    const vehicle = makeVehicle({
      price_vs_odometer_usd: { "0": 40_000, "50000": 20_000, "100000": 0 },
      eol_maintained_miles: 1_000_000,
    });
    const constants = makeConstants();

    const short = buyPointSweep(vehicle, constants, { holdMiles: 20_000 }, { step: 10_000 });
    const long = buyPointSweep(vehicle, constants, { holdMiles: 80_000 }, { step: 10_000 });

    expect(short.grid.map((p) => p.p50)).not.toEqual(long.grid.map((p) => p.p50));
  });
});

/**
 * THE invariant the Rankings row exists on: at a fixed hold, the buy point a row
 * DISPLAYS and the buy point its money is PRICED AT are the same point. Until
 * 2026-07-30 they were not — the row showed the sweep's sweet spot beside money
 * priced at `vehicle.pinned_buy_odo` (68/71 seed vehicles disagreed on the
 * odometer at a 100k hold, 52/71 on the model year).
 */
describe("priceAtSweetSpot", () => {
  it("prices at the sweep's own answer: same odometer, same model year", () => {
    // Interior optimum (dip at 30k) so the sweet spot is neither grid end and a
    // caller pricing at some default could not land on it by accident.
    const vehicle = makeVehicle({
      eol_maintained_miles: 1_000_000,
      pinned_buy_odo: 12_345, // off every grid step, so the assertion below can't pass by luck
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
      const { sweep, priced } = priceAtSweetSpot(vehicle, constants, { holdMiles: 1_000_000 }, opts);
      expect(priced.buyOdo).toBe(sweep.idealOdo);
      expect(priced.impliedBuyYear).toBe(sweep.idealYear);
      expect(priced.buyOdo).not.toBe(vehicle.pinned_buy_odo); // not the old default
    }
  });

  it("refuses an open-ended horizon (R10), same runtime backstop as the sweep", () => {
    expect(() =>
      priceAtSweetSpot(makeVehicle(), makeConstants(), {
        holdMiles: "eol",
      } as unknown as SweepInputs),
    ).toThrow(/numeric holdMiles/);
  });

  it("the whole seed field, at the app's own hold and grid step: every car's displayed buy point IS its priced buy point", () => {
    // Field-wide, at the real data and the production calibration — the
    // browser-visible claim ("this model year, at this mileage, costs this
    // much") reduced to an assertion. A regression here means a Rankings row is
    // once again describing one buy point while quoting another's price.
    const { constants, vehicles } = loadSeedData();
    for (const v of vehicles) {
      const { sweep, priced } = priceAtSweetSpot(v, constants, {
        holdMiles: 100_000,
        annualMiles: 13_000,
        draws: 200, // the invariant is structural; draws only set the price's precision
        seed: 42,
      });
      expect(priced.buyOdo, v.name).toBe(sweep.idealOdo);
      expect(priced.impliedBuyYear, v.name).toBe(sweep.idealYear);
    }
  });
});
