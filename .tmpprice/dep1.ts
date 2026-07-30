import { readFileSync } from "node:fs";
import { parseCurve, curveAt } from "../packages/core/src/index.js";
import type { Vehicle } from "../packages/core/src/types.js";
const d = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const A: Record<string, number> = JSON.parse(readFileSync(new URL("./accepted.json", import.meta.url), "utf8"));
const AM = d.constants.annual_miles;
const dep = (v: Vehicle, raw: Record<string, number>) => {
  const pts = parseCurve(raw), fl = 0;
  const p0 = curveAt(pts, 0, fl), p1 = curveAt(pts, AM, fl);
  return (p0 - p1) / p0;
};
console.log(["vehicle","dep0-13k BEFORE","dep0-13k AFTER"].join("\t"));
const b: number[] = [], a: number[] = [];
for (const v of d.vehicles as Vehicle[]) {
  if (A[v.name] === undefined) continue;
  const x = dep(v, v.price_vs_odometer_usd);
  const y = dep(v, { "0": A[v.name]!, ...v.price_vs_odometer_usd });
  b.push(x); a.push(y);
  console.log([v.name, (x*100).toFixed(2)+"%", (y*100).toFixed(2)+"%"].join("\t"));
}
const m=(xs:number[])=>xs.reduce((p,c)=>p+c,0)/xs.length;
console.log(`MEAN over ${a.length} anchored: BEFORE ${(m(b)*100).toFixed(2)}%  AFTER ${(m(a)*100).toFixed(2)}%`);
// whole field
const bf: number[] = [], af: number[] = [];
for (const v of d.vehicles as Vehicle[]) {
  bf.push(dep(v, v.price_vs_odometer_usd));
  af.push(dep(v, A[v.name]===undefined ? v.price_vs_odometer_usd : { "0": A[v.name]!, ...v.price_vs_odometer_usd }));
}
console.log(`MEAN over all ${bf.length}: BEFORE ${(m(bf)*100).toFixed(2)}%  AFTER ${(m(af)*100).toFixed(2)}%`);
