import { describe, expect, it } from "vitest";
import { costPerMile } from "../src/engine.js";
import { loadManifest, loadSeedData } from "./helpers.js";

/**
 * The real refactor guardrail: with a fixed seed the engine is bit-identical to
 * itself, forever. Any change to these numbers is a deliberate model change and
 * requires regenerating the fidelity manifest (see gen-fidelity-manifest.ts).
 */
const { constants, vehicles } = loadSeedData();
const manifest = loadManifest();

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

  it("every car's P50 matches its exact pinned snapshot (seed 42, default draws)", () => {
    for (const v of vehicles) {
      const res = costPerMile(v, constants, { seed: 42 });
      expect(res.p50, v.name).toBeCloseTo(manifest.exactP50Snapshots[v.name]!, 12);
    }
  });
});
