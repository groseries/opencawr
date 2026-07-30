import { readFileSync } from "node:fs";
import { costPerMile, buyPointSweep, parseCurve, curveAt } from "../packages/core/src/index.js";
import type { Vehicle, Constants } from "../packages/core/src/types.js";

const d = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const C: Constants = d.constants;
const A: Record<string, number> = JSON.parse(readFileSync(new URL("./accepted.json", import.meta.url), "utf8"));
const AM = C.annual_miles;

const anchored = (v: Vehicle): Vehicle =>
  A[v.name] === undefined ? v : { ...v, price_vs_odometer_usd: { "0": A[v.name]!, ...v.price_vs_odometer_usd } };

console.log("=== A. reference outputs: p50 at pinned_buy_odo, all 71 ===");
let maxd = 0, changed = 0;
for (const v of d.vehicles as Vehicle[]) {
  const a = costPerMile(v, C).p50, b = costPerMile(anchored(v), C).p50;
  if (Math.abs(a - b) > 1e-12) { changed++; console.log("  CHANGED", v.name, a, b); }
  maxd = Math.max(maxd, Math.abs(a - b));
}
console.log(`  vehicles changed: ${changed}/${d.vehicles.length}, max |delta p50| = ${maxd}`);

console.log("\n=== B. modeled year-one depreciation (price at 13,000 mi vs MSRP) ===");
console.log(["vehicle","MSRP@0","p@13k BEFORE","p@13k AFTER","dep1 BEFORE","dep1 AFTER"].join("\t"));
const dep: Array<[string, number, number]> = [];
for (const v of d.vehicles as Vehicle[]) {
  if (A[v.name] === undefined) continue;
  const m = A[v.name]!;
  const before = curveAt(parseCurve(v.price_vs_odometer_usd), AM, v.scrap_value_usd ?? 0);
  const after = curveAt(parseCurve(anchored(v).price_vs_odometer_usd), AM, v.scrap_value_usd ?? 0);
  dep.push([v.name, (m - before) / m, (m - after) / m]);
  console.log([v.name, m, Math.round(before), Math.round(after),
    (((m - before) / m) * 100).toFixed(1) + "%", (((m - after) / m) * 100).toFixed(1) + "%"].join("\t"));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`  MEAN yr-1 dep over anchored: BEFORE ${(mean(dep.map(x=>x[1]))*100).toFixed(2)}%  AFTER ${(mean(dep.map(x=>x[2]))*100).toFixed(2)}%`);

console.log("\n=== C. heatmap cell buyOdo 10,000 / hold 100,000 ===");
console.log(["vehicle","p50 before","p50 after","delta","%"].join("\t"));
for (const v of d.vehicles as Vehicle[]) {
  if (A[v.name] === undefined) continue;
  const inp = { buyOdo: 10000, holdMiles: 100000 };
  const a = costPerMile(v, C, inp).p50, b = costPerMile(anchored(v), C, inp).p50;
  if (Math.abs(b - a) < 1e-9) continue;
  console.log([v.name, a.toFixed(4), b.toFixed(4), (b - a).toFixed(4), (((b / a) - 1) * 100).toFixed(1) + "%"].join("\t"));
}

console.log("\n=== D. buyPointSweep: R10 fixed-hold check ===");
try { (buyPointSweep as any)(d.vehicles[0], C, { holdMiles: "eol" }); console.log("  !! eol ACCEPTED — R10 not in force"); }
catch (e) { console.log("  eol refused:", (e as Error).message.slice(0, 80)); }
for (const hold of [100000, 150000]) {
  let zero = 0, n = 0, moved = 0;
  const lines: string[] = [];
  for (const v of d.vehicles as Vehicle[]) {
    if (A[v.name] === undefined) continue;
    const a = buyPointSweep(v, C, { holdMiles: hold }), b = buyPointSweep(anchored(v), C, { holdMiles: hold });
    n++; if (b.idealOdo === 0) zero++;
    if (a.idealOdo !== b.idealOdo) { moved++; lines.push(`    ${v.name}: ${a.idealOdo} -> ${b.idealOdo}  (gridLo ${a.grid[0]!.odo} -> ${b.grid[0]!.odo})`); }
  }
  console.log(`  holdMiles=${hold}: argmin at 0 mi = ${zero}/${n}; argmin moved for ${moved}/${n}`);
  for (const l of lines) console.log(l);
}
