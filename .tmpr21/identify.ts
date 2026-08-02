/** Section 2 addendum: the per-bin argmin is noise, but is the COARSE claim
 *  ("today prefers a long hold, the levelized metric prefers a short one")
 *  stable across seeds? That is the statement the write-up publishes, so it
 *  gets its own test. */
import { readFileSync } from "node:fs";
import { costPerMileCf, type CfSwitches } from "./engine-cf.js";
import type { Constants, Vehicle } from "../packages/core/src/types.js";

const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c: Constants = d.constants;
const vehicles: Vehicle[] = d.vehicles;
const HOLDS: (number | "eol")[] = [25_000, 50_000, 75_000, 100_000, 125_000, 150_000, 175_000, 200_000, "eol"];
const SHORT = new Set(["25k", "50k", "75k", "100k"]);
const hlabel = (h: number | "eol") => (h === "eol" ? "eol" : `${h / 1000}k`);
const TODAY: CfSwitches = {};
const EAC: CfSwitches = { levelize: true, discountTires: true };
const SEEDS = [42, 7, 101, 202, 303, 404, 505, 606];

for (const [label, sw] of [["TODAY", TODAY], ["EAC", EAC]] as const) {
  const perSeedLong: number[] = [];
  let groupStable = 0;
  for (const v of vehicles) {
    const groups = new Set<string>();
    for (const s of SEEDS) {
      let best: [string, number] | null = null;
      for (const h of HOLDS) {
        const p = costPerMileCf(v, c, { holdMiles: h, draws: 400, seed: s }, sw).p50;
        if (!best || p < best[1]) best = [hlabel(h), p];
      }
      groups.add(SHORT.has(best![0]) ? "short" : "long");
    }
    if (groups.size === 1) groupStable++;
  }
  for (const s of SEEDS) {
    let long = 0;
    for (const v of vehicles) {
      let best: [string, number] | null = null;
      for (const h of HOLDS) {
        const p = costPerMileCf(v, c, { holdMiles: h, draws: 400, seed: s }, sw).p50;
        if (!best || p < best[1]) best = [hlabel(h), p];
      }
      if (!SHORT.has(best![0])) long++;
    }
    perSeedLong.push(long);
  }
  console.log(
    `${label}: vehicles whose long/short GROUP is identical across ${SEEDS.length} seeds: ${groupStable}/71; ` +
      `count preferring long per seed: [${perSeedLong.join(", ")}]`,
  );
}
