import { describe, expect, it } from "vitest";
import { costPerMile } from "../src/engine.js";
import { rankWithTiers, type RankableCar } from "../src/tiers.js";
import { loadSeedData } from "./helpers.js";

/**
 * Reference suite: the engine must reproduce opencawr_data.json's `model_output`
 * EXACTLY (same fixed seed and draw count that generated it). Any mismatch means the
 * model drifted; regenerating the reference (gen-reference-outputs.ts) is a deliberate,
 * reviewed numbers-change event — never a CI fix. The prototype's original numbers are
 * preserved as `model_output_prototype` and are historical, not asserted (ASSUMPTIONS.md).
 */
const { meta, constants, vehicles } = loadSeedData();
const draws = meta.reference_engine?.draws ?? 1100;
const seed = meta.reference_engine?.seed ?? 42;

const results = new Map(
  vehicles.map((v) => [v.name, costPerMile(v, constants, { draws, seed })]),
);
const ranked = rankWithTiers(
  vehicles.map((v): RankableCar => {
    const r = results.get(v.name)!;
    return { id: v.name, p50: r.p50, drawsCpm: r.drawsCpm };
  }),
);
const rankByName = new Map(ranked.map((r) => [r.id, r]));

// reference values are rounded on write: 4dp for $/mi, 3dp for probs, $1 for opp
const DP4 = 5.01e-5;
const DP3 = 5.01e-4;

describe("engine reproduces the reference outputs exactly", () => {
  for (const v of vehicles) {
    it(v.name, () => {
      const res = results.get(v.name)!;
      const rk = rankByName.get(v.name)!;
      const g = v.model_output;
      expect(Math.abs(res.p50 - g.cost_per_mile_p50)).toBeLessThanOrEqual(DP4);
      expect(Math.abs(res.p75 - g.p75)).toBeLessThanOrEqual(DP4);
      expect(Math.abs(res.p90 - g.p90_badluck)).toBeLessThanOrEqual(DP4);
      expect(Math.abs(res.p05 - g.band_p05)).toBeLessThanOrEqual(DP4);
      expect(Math.abs(res.p95 - g.band_p95)).toBeLessThanOrEqual(DP4);
      expect(rk.tier).toBe(g.stat_tier);
      expect(Math.abs((rk.beatsNextProb ?? 1) - g.beats_next_prob)).toBeLessThanOrEqual(DP3);
      expect(Math.abs(res.oppCostLifetimeUsd - g.opp_cost_lifetime_usd)).toBeLessThanOrEqual(0.51);
      expect(Math.abs(res.oppCostPerMi - g.opp_cost_per_mi)).toBeLessThanOrEqual(DP4);
    });
  }
});

describe("reference-set sanity", () => {
  it("prototype numbers are preserved for exactly the original 71, never fabricated for the rest", () => {
    // The 29 vehicles added in the 71→100 seed expansion (2026-08) never existed
    // in the lost prototype spreadsheet, so they must never gain one — a count
    // check catches both directions: a legacy vehicle silently losing its real
    // prototype, or a new vehicle silently gaining a fabricated one.
    const withPrototype = vehicles.filter((v) => v.model_output_prototype !== undefined);
    expect(withPrototype).toHaveLength(71);
  });

  // Window widened 6 → 8 for R16 (2026-08-16): fixing common random numbers moved the
  // Prius (hybrid) from rank 6 to 7 on a P50 change below 0.01 ¢/mi. It sits in a tie
  // tier with five cars inside 2 ¢/mi, so which of them prints 6th is not a claim this
  // reference set should be pinning. The 71→100 seed expansion (2026-08-17) adds more
  // real competitors into that same tie tier (e.g. Nissan Sentra) — same reasoning,
  // wider field.
  it("ranking stays in the prototype's ballpark (top tier is EV/hybrid/efficient sedans)", () => {
    const top8 = ranked.slice(0, 8).map((r) => r.id);
    expect(top8).toContain("Chevy Bolt EV");
    expect(top8).toContain("Toyota Prius (hybrid)");
  });

  it("every electrified car carries data-driven battery risk", () => {
    for (const v of vehicles) {
      if (v.etype !== "gas") expect(v.battery, v.name).toBeDefined();
      else expect(v.battery, v.name).toBeUndefined();
    }
  });
});
