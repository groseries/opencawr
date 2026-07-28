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
