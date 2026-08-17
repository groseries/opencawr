import { describe, expect, it } from "vitest";
import { costPerMile } from "../src/engine.js";
import { loadSeedData } from "./helpers.js";

/**
 * With a fixed seed the engine is bit-identical to itself, forever. Combined with
 * reference.test.ts (exact reproduction of the stored model_output), any refactor
 * that shifts the numbers fails loudly and must go through a deliberate reference
 * regeneration (see gen-reference-outputs.ts).
 */
const { constants, vehicles } = loadSeedData();

describe("determinism", () => {
  it("same seed → bit-identical draws", () => {
    const v = vehicles[0]!;
    const a = costPerMile(v, constants, { seed: 7 });
    const b = costPerMile(v, constants, { seed: 7 });
    expect(Array.from(a.drawsCpm)).toEqual(Array.from(b.drawsCpm));
  });

  it("different seed → different draws, statistically same median", () => {
    const v = vehicles[0]!;
    const a = costPerMile(v, constants, { seed: 7 });
    const b = costPerMile(v, constants, { seed: 8 });
    expect(Array.from(a.drawsCpm)).not.toEqual(Array.from(b.drawsCpm));
    expect(Math.abs(a.p50 - b.p50)).toBeLessThan(0.01);
  });
});

/**
 * R16: two buy points of the SAME vehicle at the SAME seed must share nearly all
 * their randomness, so the paired DIFFERENCE is much tighter than either level.
 * This is what the buy-point sweep's argmin, `upperOdo`'s tolerance walk and the
 * model-year tie tiers all implicitly rely on. Before per-draw reseeding the
 * substreams desynchronized the first time a Poisson count or year count differed,
 * and pairing cancelled roughly nothing (measured: 12% on this very case, and
 * NEGATIVE on wider-spaced pairs — pairing made the comparison worse than the level).
 */
describe("common random numbers (R16)", () => {
  const sd = (a: Float64Array) => {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };

  /** Paired-difference SD ÷ level SD. Below 1 means pairing cancels noise; before the
   *  R16 fix this exceeded 1 on wider-spaced pairs — pairing made comparisons WORSE. */
  const pairedRatio = (name: string, odoA: number, odoB: number) => {
    const v = vehicles.find((x) => x.name === name)!;
    const a = costPerMile(v, constants, { holdMiles: 100_000, buyOdo: odoA, seed: 42 });
    const b = costPerMile(v, constants, { holdMiles: 100_000, buyOdo: odoB, seed: 42 });
    const levelSd = (sd(a.drawsCpm) + sd(b.drawsCpm)) / 2;
    return sd(a.drawsCpm.map((x, i) => x - b.drawsCpm[i]!)) / levelSd;
  };

  // One sweep grid step apart — the comparison buyPointSweep's argmin and upperOdo's
  // tolerance walk actually make, and where pairing should be at its strongest.
  // Measured 0.153 here; bound left well clear of it but far under the 1.0 that a
  // desynchronized stream produces.
  it("adjacent buy points cancel most of the level noise when paired", () => {
    expect(pairedRatio("Toyota Corolla", 55_000, 57_500)).toBeLessThan(0.25);
  });

  // Wide pairs share less by nature (different hold lengths, different repair-hazard
  // exposure), so the bound is looser — but this is the case that ran ABOVE 1.0 before
  // the fix, so it is the one that would catch a regression the tight pair might not.
  // Measured: Corolla 0.616, Elantra 0.584, Camry Hybrid 0.805.
  it("widely spaced buy points still cancel noise rather than adding it", () => {
    expect(pairedRatio("Toyota Corolla", 55_000, 80_000)).toBeLessThan(0.9);
    expect(pairedRatio("Hyundai Elantra", 45_000, 70_000)).toBeLessThan(0.9);
    expect(pairedRatio("Toyota Camry Hybrid", 60_000, 85_000)).toBeLessThan(0.9);
  });
});
