import { readFileSync } from "node:fs";
import { costPerMile, buyPointSweep } from "../packages/core/src/index.js";
import type { Vehicle, Constants } from "../packages/core/src/types.js";

const d = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const C: Constants = d.constants;
const MSRP: Record<string, number> = JSON.parse(
  readFileSync(new URL("./msrp.json", import.meta.url), "utf8"),
);

function anchored(v: Vehicle): Vehicle {
  const m = MSRP[v.name];
  if (m === undefined) return v;
  return { ...v, price_vs_odometer_usd: { "0": m, ...v.price_vs_odometer_usd } };
}

console.log("=== A. reference outputs (p50 at pinned_buy_odo, all 71) ===");
let maxd = 0, changed = 0;
for (const v of d.vehicles as Vehicle[]) {
  const a = costPerMile(v, C).p50;
  const b = costPerMile(anchored(v), C).p50;
  if (Math.abs(a - b) > 1e-12) { changed++; console.log("  CHANGED", v.name, a, b); }
  maxd = Math.max(maxd, Math.abs(a - b));
}
console.log(`  vehicles changed: ${changed}/71, max |delta p50| = ${maxd}`);

console.log("\n=== B. heatmap cell: buyOdo 10,000 / hold 100,000 ===");
console.log(["vehicle","p50 clamped","p50 anchored","delta $/mi","%"].join("\t"));
for (const v of d.vehicles as Vehicle[]) {
  if (!(v.name in MSRP)) continue;
  const inp = { buyOdo: 10000, holdMiles: 100000 };
  const a = costPerMile(v, C, inp).p50;
  const b = costPerMile(anchored(v), C, inp).p50;
  console.log([v.name, a.toFixed(4), b.toFixed(4), (b-a).toFixed(4), ((b/a-1)*100).toFixed(1)+"%"].join("\t"));
}

console.log("\n=== C. buyPointSweep argmin ===");
console.log(["vehicle","idealOdo clamped","idealOdo anchored","gridLo before","gridLo after"].join("\t"));
for (const v of d.vehicles as Vehicle[]) {
  if (!(v.name in MSRP)) continue;
  const s1 = buyPointSweep(v, C);
  const s2 = buyPointSweep(anchored(v), C);
  console.log([v.name, s1.idealOdo, s2.idealOdo, s1.grid[0]!.odo, s2.grid[0]!.odo].join("\t"));
}
