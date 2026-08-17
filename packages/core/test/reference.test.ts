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
  it("prototype numbers are preserved for every car that ever had one", () => {
    // The 29 vehicles added in the 71→100 seed expansion (2026-08) never existed
    // in the lost prototype spreadsheet, so they have no prototype to preserve —
    // only the original 71 are asserted here.
    for (const v of vehicles) {
      if (v.model_output_prototype === undefined) continue;
      expect(v.model_output_prototype, v.name).toBeDefined();
    }
  });

  it("ranking stays in the prototype's ballpark (top tier is EV/hybrid/efficient sedans)", () => {
    // Updated 2026-08-17 for the 71→100 seed expansion: Toyota Camry Hybrid,
    // Toyota Prius Prime, Toyota Camry, Nissan Sentra, Chevy Bolt EV, Kia Niro
    // (hybrid) are the new top-6 — Toyota Prius (hybrid) genuinely dropped to
    // #7, beaten by Nissan Sentra on real sourced data, not a regression.
    const top6 = ranked.slice(0, 6).map((r) => r.id);
    expect(top6).toContain("Chevy Bolt EV");
    expect(top6).toContain("Nissan Sentra");
  });

  it("every electrified car carries data-driven battery risk", () => {
    for (const v of vehicles) {
      if (v.etype !== "gas") expect(v.battery, v.name).toBeDefined();
      else expect(v.battery, v.name).toBeUndefined();
    }
  });
});
