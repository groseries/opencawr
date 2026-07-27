import { describe, expect, it } from "vitest";
import { costPerMile } from "../src/engine.js";
import { rankWithTiers, type RankableCar } from "../src/tiers.js";
import { OPP_COST_AUDIT_ROWS, loadManifest, loadSeedData } from "./helpers.js";

/**
 * Golden suite: the engine must reproduce opencawr_data.json's model_output.
 *
 * The prototype source (build_v7.py) was lost, so the engine is a calibrated
 * reverse-engineering; fidelity-manifest.json pins today's per-car agreement and
 * this suite fails if any refactor drifts beyond it. See DECISIONS.md.
 */
const { constants, vehicles } = loadSeedData();
const manifest = loadManifest();
const METRICS = [
  ["p50", "cost_per_mile_p50"],
  ["p75", "p75"],
  ["p90", "p90_badluck"],
  ["p05", "band_p05"],
  ["p95", "band_p95"],
] as const;

const results = new Map(
  vehicles.map((v) => [
    v.name,
    costPerMile(v, constants, { draws: manifest.draws, seed: manifest.seed }),
  ]),
);

describe("golden fidelity per car", () => {
  for (const v of vehicles) {
    it(v.name, () => {
      const res = results.get(v.name)!;
      const allowed = manifest.cars[v.name];
      expect(allowed, "car missing from fidelity manifest").toBeDefined();
      for (const [metric, goldenKey] of METRICS) {
        const delta = Math.abs(res[metric] - v.model_output[goldenKey]);
        expect(delta, `${metric} drifted beyond manifest allowance`).toBeLessThanOrEqual(
          allowed![metric]!,
        );
      }
    });
  }
});

describe("golden fidelity aggregate", () => {
  it("fleet MAE within manifest ceiling for every quantile", () => {
    for (const [metric, goldenKey] of METRICS) {
      const mae =
        vehicles.reduce(
          (s, v) => s + Math.abs(results.get(v.name)![metric] - v.model_output[goldenKey]),
          0,
        ) / vehicles.length;
      expect(mae, `fleet MAE ${metric}`).toBeLessThanOrEqual(manifest.fleetMaeMax[metric]!);
    }
  });
});

describe("opportunity-cost reporting columns", () => {
  for (const v of vehicles) {
    if (OPP_COST_AUDIT_ROWS.has(v.name)) continue; // known prototype inconsistency
    it(v.name, () => {
      const res = results.get(v.name)!;
      // formula recovered exactly: P × ((1+r)^T − 1); allow $20 for price-interp rounding
      expect(Math.abs(res.oppCostLifetimeUsd - v.model_output.opp_cost_lifetime_usd)).toBeLessThan(
        20,
      );
      expect(Math.abs(res.oppCostPerMi - v.model_output.opp_cost_per_mi)).toBeLessThan(0.0005);
    });
  }
});

describe("statistical tie tiers", () => {
  const cars: RankableCar[] = vehicles.map((v) => {
    const r = results.get(v.name)!;
    return { id: v.name, p50: r.p50, drawsCpm: r.drawsCpm };
  });
  const ranked = rankWithTiers(cars);
  const byName = new Map(ranked.map((r) => [r.id, r]));

  it("every car lands within ±1 tier of the golden stat_tier", () => {
    for (const v of vehicles) {
      const tier = byName.get(v.name)!.tier;
      expect(
        Math.abs(tier - v.model_output.stat_tier),
        `${v.name}: tier ${tier} vs golden ${v.model_output.stat_tier}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("beats-next probabilities agree with golden on average (MAE ≤ 0.08)", () => {
    // golden beats_next is defined against the golden ranking's neighbor; compare on ours
    const goldenByName = new Map(vehicles.map((v) => [v.name, v.model_output]));
    let sum = 0;
    let n = 0;
    for (const r of ranked) {
      if (r.beatsNextProb === null) continue;
      sum += Math.abs(r.beatsNextProb - goldenByName.get(r.id)!.beats_next_prob);
      n++;
    }
    expect(sum / n).toBeLessThanOrEqual(0.08);
  });
});
