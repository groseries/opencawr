import { describe, expect, it } from "vitest";
import { curveAt, parseCurve } from "../src/curves.js";
import { costPerMile } from "../src/engine.js";
import { feasibleOdoRange, isFeasibleBuy } from "../src/feasibility.js";
import type { Constants, Vehicle } from "../src/types.js";
import { loadSeedData } from "./helpers.js";

const { constants, vehicles } = loadSeedData();
const bolt = vehicles.find((v) => v.name === "Chevy Bolt EV")!;
const oldRanger = vehicles.find((v) => v.name === "Ford Ranger (old compact)")!;

describe("holding horizon (spec §3)", () => {
  it("finite hold sells at buy+hold, not EOL", () => {
    const res = costPerMile(bolt, constants, { holdMiles: 50_000, seed: 1 });
    expect(res.medianSellOdo).toBe(bolt.pinned_buy_odo + 50_000);
  });

  it("hold longer than any plausible life behaves like drive-to-death", () => {
    const a = costPerMile(bolt, constants, { holdMiles: 2_000_000, seed: 1 });
    const b = costPerMile(bolt, constants, { holdMiles: "eol", seed: 1 });
    expect(a.p50).toBeCloseTo(b.p50, 12);
  });

  it("short hold prices resale from the market curve (dep differs from drive-to-death)", () => {
    const short = costPerMile(bolt, constants, { holdMiles: 30_000, seed: 1 });
    const death = costPerMile(bolt, constants, { seed: 1 });
    expect(short.breakdown.depreciation).not.toBeCloseTo(death.breakdown.depreciation, 3);
  });

  it("rejects nonsense horizons", () => {
    expect(() => costPerMile(bolt, constants, { holdMiles: 0 })).toThrow(RangeError);
    expect(() => costPerMile(bolt, constants, { holdMiles: -5 })).toThrow(RangeError);
  });
});

describe("opportunity cost enters via discounting only (spec §2)", () => {
  it("r=0 runs cleanly and zeroes the opportunity-cost columns", () => {
    const res = costPerMile(bolt, constants, { discountRate: 0, seed: 1 });
    expect(res.oppCostLifetimeUsd).toBe(0);
    expect(Number.isFinite(res.p50)).toBe(true);
    expect(res.breakdown.energy).toBeGreaterThan(0);
  });

  it("higher r → larger opportunity-cost column", () => {
    const lo = costPerMile(bolt, constants, { discountRate: 0.03, seed: 1 });
    const hi = costPerMile(bolt, constants, { discountRate: 0.1, seed: 1 });
    expect(hi.oppCostLifetimeUsd).toBeGreaterThan(lo.oppCostLifetimeUsd);
  });
});

describe("two-sided feasibility (spec §4)", () => {
  it("low odometer on a discontinued car is infeasible (implied year past last year)", () => {
    expect(isFeasibleBuy(oldRanger, 20_000, 13_000, 2026)).toBe(false);
  });

  it("huge odometer on a recent car is infeasible (implied year before first year)", () => {
    const cx90 = vehicles.find((v) => v.name === "Mazda CX-90")!;
    expect(isFeasibleBuy(cx90, 200_000, 13_000, 2026)).toBe(false);
  });

  it("feasible window is ordered and two-sided", () => {
    const [lo, hi] = feasibleOdoRange(oldRanger, 13_000, 2026);
    expect(lo).toBeGreaterThan(0); // discontinued → can't be nearly new
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("price curve behavior (spec §2)", () => {
  it("extrapolates past the last point with the last slope, floored at scrap", () => {
    const pts = parseCurve({ "100000": 10_000, "150000": 8_000 });
    expect(curveAt(pts, 200_000, 500)).toBe(6_000); // slope continues
    expect(curveAt(pts, 400_000, 500)).toBe(500); // never below scrap
  });

  it("clamps flat below the first point instead of extrapolating leftward (R11)", () => {
    const pts = parseCurve({ "10000": 20_000, "50000": 15_000 });
    // Below the first point: clamped at the first point's value, not the
    // leftward-projected slope (which would give 20,000 + (0-10000)*slope = 21,250).
    expect(curveAt(pts, 0, 500)).toBe(20_000);
    expect(curveAt(pts, 5_000, 500)).toBe(20_000);
    expect(curveAt(pts, 10_000, 500)).toBe(20_000); // exactly at the first point
  });

  it("the floor still applies below the first point", () => {
    const pts = parseCurve({ "10000": 400, "50000": 300 });
    expect(curveAt(pts, 0, 500)).toBe(500); // first point's value (400) is below scrap
  });

  it("purchase price override flows through (Deal Analyzer hook)", () => {
    const modeled = costPerMile(bolt, constants, { seed: 1 });
    const overpaid = costPerMile(bolt, constants, { seed: 1, purchasePrice: modeled.buyPrice + 3000 });
    expect(overpaid.p50).toBeGreaterThan(modeled.p50);
  });
});

/** Same zeroed-out fixture discipline as buypoint.test.ts / modelyear.test.ts, so the
 *  lifetime-dollar total below has an exact closed form instead of Monte Carlo noise. */
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

describe("lifetime dollar total (reporting column)", () => {
  it("matches the closed form on a zeroed fixture", () => {
    // σ_eol = 0 and r = 0, so every draw is identical and the whole total is
    // exactly three hand-computable pieces:
    //   dep      = buyPrice 50,000 - resale 0 (driven to death → scrap, which is 0)
    //   use tax  = 10% × 50,000 = 5,000
    //   tires    = $0.05/mi × 990,000 mi = 49,500
    // over miles = eol 1,000,000 - buyOdo 10,000 = 990,000.
    const constants = makeConstants({
      use_tax_rate: 0.1,
      tires_usd_per_mi_by_body: { sedan: 0.05 },
    });
    const res = costPerMile(makeVehicle(), constants, { seed: 1 });

    expect(res.lifetimeMilesP50).toBe(990_000);
    expect(res.lifetimeCostUsdP50).toBeCloseTo(50_000 + 5_000 + 49_500, 6);
    expect(res.p50).toBeCloseTo(104_500 / 990_000, 12);
  });

  it("agrees with p50 × miles ONLY when the hold is short enough that miles don't vary", () => {
    // A fixed 100k hold sits well inside every draw's sampled life even at a wide
    // σ_eol, so `miles` is the same 100,000 on every draw and the ratio identity
    // does hold — this is what makes the column's own arithmetic check out at a
    // fixed hold (total ÷ miles ≈ the row's $/mi).
    const constants = makeConstants({
      eol_sigma_by_tier: { low: 0.5, mid: 0.5, high: 0.5, sport: 0.5 },
      tires_usd_per_mi_by_body: { sedan: 0.05 },
    });
    const res = costPerMile(makeVehicle(), constants, {
      seed: 42,
      draws: 999,
      holdMiles: 100_000,
    });

    expect(res.lifetimeMilesP50).toBe(100_000);
    expect(res.lifetimeCostUsdP50).toBeCloseTo(res.p50 * res.lifetimeMilesP50, 6);
  });

  it("regression: at 'eol' the total is NOT p50 × median miles", () => {
    // The whole reason this column is its own per-draw accumulation with its own
    // quantile. Wide σ_eol (miles vary hugely draw to draw) PLUS a repair tail (a
    // second, independent source of dollars) means the draw that lands on the
    // median $/mi is not the draw that lands on the median total — so the median of
    // the ratio is not the ratio of the medians. Computing this as `p50 × miles`
    // would misstate the total by several percent.
    const constants = makeConstants({
      eol_sigma_by_tier: { low: 0.5, mid: 0.5, high: 0.5, sport: 0.5 },
      reliability_tiers: {
        low: { annual_prob_past_120k: 0.05, median_usd_per_event: 3_000 },
        mid: { annual_prob_past_120k: 0, median_usd_per_event: 0 },
        high: { annual_prob_past_120k: 0, median_usd_per_event: 0 },
        sport: { annual_prob_past_120k: 0, median_usd_per_event: 0 },
      },
    });
    const res = costPerMile(makeVehicle(), constants, { seed: 42, draws: 999 });

    const naive = res.p50 * res.lifetimeMilesP50;
    const relGap = Math.abs(res.lifetimeCostUsdP50 - naive) / naive;
    expect(relGap).toBeGreaterThan(0.01); // measured 3.9% at this seed
    expect(res.lifetimeCostUsdP50).toBeGreaterThan(0);
  });
});

describe("end-of-life truncation of a fixed hold (reporting column)", () => {
  // σ_eol = 0, so every draw's end of life is exactly `eol_maintained_miles` and the
  // truncated fraction is 0 or 1 with nothing in between — the two ends of the signal.
  const shortLived = makeVehicle({ eol_maintained_miles: 100_000, pinned_buy_odo: 10_000 });

  it("is 0 when the hold fits inside every draw's life", () => {
    const res = costPerMile(shortLived, makeConstants(), { holdMiles: 50_000, seed: 1 });
    expect(res.truncatedDrawFraction).toBe(0);
    expect(res.lifetimeMilesP50).toBe(50_000);
  });

  it("is 1 when end of life arrives before the hold completes, and the miles say so", () => {
    const res = costPerMile(shortLived, makeConstants(), { holdMiles: 200_000, seed: 1 });
    expect(res.truncatedDrawFraction).toBe(1);
    // 100k eol - 10k buy odo: the hold the caller asked for is not achievable here.
    expect(res.lifetimeMilesP50).toBe(90_000);
  });

  it('is 0 at "eol", where selling at end of life IS the hold', () => {
    const res = costPerMile(shortLived, makeConstants(), { holdMiles: "eol", seed: 1 });
    expect(res.truncatedDrawFraction).toBe(0);
  });

  it("median miles fall short of the hold exactly when most draws are truncated", () => {
    // Wide σ_eol against a hold that lands near the median life: a genuinely partial
    // case, and the one the UI phrases as "N% of outcomes end before Xk mi".
    const constants = makeConstants({
      eol_sigma_by_tier: { low: 0.5, mid: 0.5, high: 0.5, sport: 0.5 },
    });
    for (const holdMiles of [60_000, 90_000, 120_000]) {
      const res = costPerMile(shortLived, constants, { holdMiles, seed: 42, draws: 999 });
      expect(res.truncatedDrawFraction).toBeGreaterThan(0);
      expect(res.truncatedDrawFraction).toBeLessThan(1);
      expect(res.lifetimeMilesP50 < holdMiles).toBe(res.truncatedDrawFraction > 0.5);
    }
  });
});

/** The distribution the Deal Analyzer's percentile line is scored against
 *  (`engine.worker.ts` `handleDeal`). The count itself is three lines of comparison
 *  in the worker; what it compares is a cost-model question, so it is pinned here. */
describe("deal scoring basis (Deal Analyzer percentile)", () => {
  const fracBelow = (draws: Float64Array, x: number) => {
    let below = 0;
    for (const v of draws) if (v < x) below++;
    return below / draws.length;
  };
  const scrap = constants.scrap_usd_by_body[bolt.body] ?? 400;
  const dealOdo = bolt.pinned_buy_odo + 40_000;
  const curvePrice = curveAt(parseCurve(bolt.price_vs_odometer_usd), dealOdo, scrap);
  const at = (o: Record<string, unknown>) =>
    costPerMile(bolt, constants, { holdMiles: 100_000, seed: 42, ...o });

  it("a listing priced at the curve lands mid-distribution AT ITS OWN odometer", () => {
    const baseline = at({ buyOdo: dealOdo });
    const deal = at({ buyOdo: dealOdo, purchasePrice: curvePrice });
    expect(fracBelow(baseline.drawsCpm, deal.p50)).toBeCloseTo(0.5, 2);
  });

  it("scoring that same listing at the DEFAULT buy point answers a different question", () => {
    // The bug fixed on 2026-07-30: the deal was scored against the car's
    // `pinned_buy_odo` draws while the UI said "at this odometer". A listing sitting
    // exactly on the modeled curve came back as anything but mid-distribution.
    const deal = at({ buyOdo: dealOdo, purchasePrice: curvePrice });
    const atDefault = fracBelow(at({}).drawsCpm, deal.p50);
    expect(Math.abs(atDefault - 0.5)).toBeGreaterThan(0.05);
  });

  it("paying more than the curve raises the percentile, paying less lowers it", () => {
    const baseline = at({ buyOdo: dealOdo });
    const over = at({ buyOdo: dealOdo, purchasePrice: curvePrice + 3_000 });
    const under = at({ buyOdo: dealOdo, purchasePrice: curvePrice - 3_000 });
    expect(fracBelow(baseline.drawsCpm, over.p50)).toBeGreaterThan(0.5);
    expect(fracBelow(baseline.drawsCpm, under.p50)).toBeLessThan(0.5);
  });
});

describe("live inputs re-run the engine (spec §4)", () => {
  it("annual mileage changes the answer", () => {
    const a = costPerMile(bolt, constants, { seed: 1, annualMiles: 8_000 });
    const b = costPerMile(bolt, constants, { seed: 1, annualMiles: 20_000 });
    expect(a.p50).not.toBeCloseTo(b.p50, 4);
  });

  it("gas price moves gas cars but not EVs", () => {
    const camry = vehicles.find((v) => v.name === "Toyota Camry")!;
    const g1 = costPerMile(camry, constants, { seed: 1, gasUsdPerGal: 3 });
    const g2 = costPerMile(camry, constants, { seed: 1, gasUsdPerGal: 6 });
    expect(g2.p50).toBeGreaterThan(g1.p50);
    const e1 = costPerMile(bolt, constants, { seed: 1, gasUsdPerGal: 3 });
    const e2 = costPerMile(bolt, constants, { seed: 1, gasUsdPerGal: 6 });
    expect(e1.p50).toBe(e2.p50);
  });
});

/** R20: resale blends toward scrap over the last stretch of modeled life instead of
 *  cliffing to scrap only exactly at EOL. σ_eol = 0 so every draw's EOL is exactly
 *  `eol_maintained_miles`, and r = 0 so dep = buyPrice - resale exactly (dfT = 1),
 *  which is what lets `resaleFromDep` back out the modeled resale from the reported
 *  depreciation column with no Monte Carlo noise. */
describe("resale blends toward scrap near EOL (R20)", () => {
  const priceCurve = { "0": 30_000, "500000": 5_000 }; // linear, slope -0.05 $/mi
  const eolMiles = 500_000;
  const vehicle = makeVehicle({
    price_vs_odometer_usd: priceCurve,
    eol_maintained_miles: eolMiles,
    pinned_buy_odo: 10_000,
  });
  const constants = makeConstants({ scrap_usd_by_body: { sedan: 1_000 } });

  function resaleFromDep(holdMiles: number | "eol") {
    const res = costPerMile(vehicle, constants, { holdMiles, seed: 1 });
    const miles = res.medianSellOdo - vehicle.pinned_buy_odo;
    const dep = res.breakdown.depreciation * miles;
    return res.buyPrice - dep;
  }

  it("well outside the blend window: full curve value, unchanged from today", () => {
    // sell = 300,000 is 200,000 mi short of EOL — outside the (0.25 × 500,000 =
    // 125,000 mi) blend window, so this must equal the raw curve value.
    const resale = resaleFromDep(300_000 - 10_000);
    expect(resale).toBeCloseTo(30_000 - 0.05 * 300_000, 6); // = 15,000
  });

  it("inside the blend window: interpolated between curve value and scrap", () => {
    // sell = 450,000 is 50,000 mi short of EOL, 40% of the way through the 125,000 mi
    // window (measured from its far edge) -> 40% of the way from curve value to scrap.
    const resale = resaleFromDep(450_000 - 10_000);
    const curveVal = 30_000 - 0.05 * 450_000; // 7,500
    const expected = 1_000 + 0.4 * (curveVal - 1_000); // 3,600
    expect(resale).toBeCloseTo(expected, 6);
  });

  it('at EOL ("eol" mode or a fixed hold truncated to it): flat scrap, same as today', () => {
    expect(resaleFromDep("eol")).toBeCloseTo(1_000, 6);
    expect(resaleFromDep(600_000 - 10_000)).toBeCloseTo(1_000, 6); // truncates to eolMiles
  });
});
