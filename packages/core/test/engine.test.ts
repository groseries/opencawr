import { describe, expect, it } from "vitest";
import { curveAt, parseCurve } from "../src/curves.js";
import { costPerMile } from "../src/engine.js";
import { feasibleOdoRange, isFeasibleBuy } from "../src/feasibility.js";
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

  it("purchase price override flows through (Deal Analyzer hook)", () => {
    const modeled = costPerMile(bolt, constants, { seed: 1 });
    const overpaid = costPerMile(bolt, constants, { seed: 1, purchasePrice: modeled.buyPrice + 3000 });
    expect(overpaid.p50).toBeGreaterThan(modeled.p50);
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
