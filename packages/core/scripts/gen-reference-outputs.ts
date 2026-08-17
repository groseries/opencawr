/**
 * Regenerates every vehicle's `model_output` in opencawr_data.json from THIS engine
 * (the canonical v2b model — owner decision 2026-07-27, see ASSUMPTIONS.md §E1).
 *
 * The lost prototype's numbers are preserved as `model_output_prototype` the first
 * time this runs (revision-log ethos: keep old numbers, never delete).
 *
 * ⚠ Running this is a NUMBERS-CHANGE EVENT: the reference test asserts the engine
 * reproduces `model_output` exactly, so regenerate only for deliberate, reviewed
 * model changes — never to green a CI failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { costPerMile } from "../src/engine.js";
import { rankWithTiers, type RankableCar } from "../src/tiers.js";
import type { Constants, Vehicle } from "../src/types.js";

const DRAWS = 1100;
const SEED = 42;

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, "../../../opencawr_data.json");
type Row = Vehicle & {
  model_output: Record<string, number>;
  model_output_prototype?: Record<string, number>;
};
const data = JSON.parse(readFileSync(dataPath, "utf8")) as {
  meta: Record<string, unknown>;
  constants: Constants;
  vehicles: Row[];
};

const results = new Map(
  data.vehicles.map((v) => [v.name, costPerMile(v, data.constants, { draws: DRAWS, seed: SEED })]),
);
const ranked = rankWithTiers(
  data.vehicles.map((v): RankableCar => {
    const r = results.get(v.name)!;
    return { id: v.name, p50: r.p50, drawsCpm: r.drawsCpm };
  }),
);
const rankByName = new Map(ranked.map((r) => [r.id, r]));

const round = (x: number, dp: number) => Number(x.toFixed(dp));
const shifts: number[] = [];
for (const v of data.vehicles) {
  const res = results.get(v.name)!;
  const rk = rankByName.get(v.name)!;
  if (!v.model_output_prototype && v.model_output) v.model_output_prototype = v.model_output;
  if (v.model_output_prototype) shifts.push(res.p50 - v.model_output_prototype.cost_per_mile_p50);
  v.model_output = {
    cost_per_mile_p50: round(res.p50, 4),
    p75: round(res.p75, 4),
    p90_badluck: round(res.p90, 4),
    band_p05: round(res.p05, 4),
    band_p95: round(res.p95, 4),
    stat_tier: rk.tier,
    beats_next_prob: rk.beatsNextProb === null ? 1 : round(rk.beatsNextProb, 3),
    opp_cost_lifetime_usd: round(res.oppCostLifetimeUsd, 0),
    opp_cost_per_mi: round(res.oppCostPerMi, 4),
  };
}

data.meta.reference_engine = {
  note:
    "model_output regenerated from @opencawr/core (v2b model per ASSUMPTIONS.md); " +
    "prototype's original numbers preserved in model_output_prototype",
  generated: new Date().toISOString().slice(0, 10),
  draws: DRAWS,
  seed: SEED,
};

writeFileSync(dataPath, JSON.stringify(data, null, 1), "utf8");

// -- report --
const abs = shifts.map(Math.abs);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(
  `p50 shift vs prototype: mean ${mean(shifts).toFixed(4)}, MAE ${mean(abs).toFixed(4)}, ` +
    `max ${Math.max(...abs).toFixed(4)}`,
);
console.log("top 12 (new ranking, * = tier boundary):");
let lastTier = 0;
for (const r of ranked.slice(0, 12)) {
  const proto = data.vehicles.find((v) => v.name === r.id)!.model_output_prototype;
  console.log(
    `${r.tier !== lastTier ? "*" : " "} T${r.tier} #${r.rank} ${r.id} — ` +
      `$${r.p50.toFixed(4)}/mi (prototype ${proto ? `$${proto.cost_per_mile_p50}` : "n/a"})`,
  );
  lastTier = r.tier;
}
console.log(`wrote ${data.vehicles.length} reference outputs`);
