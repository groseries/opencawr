import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
const seed = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const { constants, vehicles, meta } = seed;
const draws = meta.reference_engine?.draws ?? 1100, rseed = meta.reference_engine?.seed ?? 42;
const comps: Record<string, number> = {};
const rows: Array<[string, number, number]> = [];
for (const v of vehicles) {
  const r: any = costPerMile(v, constants, { draws, seed: rseed });
  const b: any = r.breakdown; const total = b.total;
  for (const k of Object.keys(b)) if (k !== "total") comps[k] = (comps[k] ?? 0) + b[k] / total / vehicles.length;
  rows.push([v.name, b.insurance, b.insurance / total]);
}
console.log("mean component shares of $/mi:", Object.entries(comps).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${(v*100).toFixed(1)}%`).join(" · "));
rows.sort((a,b)=>b[2]-a[2]);
console.log("insurance share — highest:", rows.slice(0,3).map(r=>`${r[0]} ${(r[2]*100).toFixed(1)}% ($${r[1].toFixed(4)}/mi)`).join(" | "));
console.log("insurance share — lowest :", rows.slice(-3).map(r=>`${r[0]} ${(r[2]*100).toFixed(1)}% ($${r[1].toFixed(4)}/mi)`).join(" | "));
console.log("median insurance share:", (rows[Math.floor(rows.length/2)][2]*100).toFixed(1)+"%");
