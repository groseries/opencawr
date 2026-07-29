import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";

const seed = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const { constants, vehicles, meta } = seed;
const draws = meta.reference_engine?.draws ?? 1100;
const rseed = meta.reference_engine?.seed ?? 42;

function run(mut: (v: any) => any) {
  const vs = vehicles.map(mut);
  const res = new Map(vs.map((v: any) => [v.name, costPerMile(v, constants, { draws, seed: rseed })]));
  const ranked = rankWithTiers(vs.map((v: any) => { const r: any = res.get(v.name)!; return { id: v.name, p50: r.p50, drawsCpm: r.drawsCpm } as RankableCar; }));
  return { res, ranked };
}

const base = run((v) => v);
// insurance share of the breakdown
let shares: Array<[string, number, number, number]> = [];
for (const v of vehicles) {
  const r: any = base.res.get(v.name)!;
  const b = r.breakdown;
  const total = Object.values(b).reduce((a: number, x: any) => a + x, 0) as number;
  shares.push([v.name, b.insurance, b.insurance / total, r.p50]);
}
shares.sort((a, b) => b[2] - a[2]);
console.log("=== insurance share of cost breakdown ===");
console.log("max", shares[0], "min", shares[shares.length - 1]);
const mean = shares.reduce((a, s) => a + s[2], 0) / shares.length;
console.log("mean share", mean.toFixed(4));
// rank components by mean share
const comps: Record<string, number> = {};
for (const v of vehicles) {
  const b: any = (base.res.get(v.name) as any).breakdown;
  const total = Object.values(b).reduce((a: number, x: any) => a + x, 0) as number;
  for (const k of Object.keys(b)) comps[k] = (comps[k] ?? 0) + (b[k] as number) / total / vehicles.length;
}
console.log("mean component shares:", Object.entries(comps).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${(v * 100).toFixed(1)}%`).join(" "));

// scenario helper
function scenario(name: string, f: (v: any) => number) {
  const s = run((v) => ({ ...v, specs: { ...v.specs, full_coverage_ins_usd_yr: f(v) } }));
  const baseOrder = base.ranked.map((r: any) => r.id);
  const newOrder = s.ranked.map((r: any) => r.id);
  const pos = new Map(baseOrder.map((n: string, i: number) => [n, i]));
  let maxMove = 0, sumAbsMove = 0, top10changed = 0;
  newOrder.forEach((n: string, i: number) => { const d = Math.abs(i - (pos.get(n) as number)); maxMove = Math.max(maxMove, d); sumAbsMove += d; });
  const b10 = new Set(baseOrder.slice(0, 10)); const n10 = new Set(newOrder.slice(0, 10));
  for (const n of n10) if (!b10.has(n)) top10changed++;
  // spearman-ish + p50 deltas
  let maxDp50 = 0, sumDp50 = 0;
  for (const v of vehicles) {
    const a: any = base.res.get(v.name)!, c: any = s.res.get(v.name)!;
    const d = c.p50 - a.p50; sumDp50 += Math.abs(d); if (Math.abs(d) > Math.abs(maxDp50)) maxDp50 = d;
  }
  // tier changes
  let tierChanged = 0;
  const bt = new Map(base.ranked.map((r: any) => [r.id, r.tier]));
  for (const r of s.ranked as any[]) if (bt.get(r.id) !== r.tier) tierChanged++;
  console.log(`\n--- ${name} ---`);
  console.log(`mean |Δp50| = $${(sumDp50 / vehicles.length).toFixed(4)}/mi, max Δp50 = $${maxDp50.toFixed(4)}/mi`);
  console.log(`mean |rank move| = ${(sumAbsMove / vehicles.length).toFixed(2)} places, max = ${maxMove}`);
  console.log(`new entrants in top 10 = ${top10changed}/10, stat-tier changes = ${tierChanged}/${vehicles.length}`);
  console.log(`base top10: ${baseOrder.slice(0, 10).join(" | ")}`);
  console.log(`new  top10: ${newOrder.slice(0, 10).join(" | ")}`);
}

const vals = vehicles.map((v: any) => v.specs.full_coverage_ins_usd_yr);
const med = vals.slice().sort((a: number, b: number) => a - b)[Math.floor(vals.length / 2)];
scenario("A: flat national (every car = NAIC-ish 1439 combined avg)", () => 1439);
scenario("B: flat at current median (2150) — pure spread-removal test", () => med);
scenario("C: uniform -20% level shift", (v) => v.specs.full_coverage_ins_usd_yr * 0.8);
// D: HLDI-like spread: keep median, widen spread x2 around it
scenario("D: 2x spread around current median", (v) => med + (v.specs.full_coverage_ins_usd_yr - med) * 2);
