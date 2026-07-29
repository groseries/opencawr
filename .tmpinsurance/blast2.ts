import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";
const seedData = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const reb: Record<string, number> = JSON.parse(readFileSync(new URL("./rebased_ca.json", import.meta.url), "utf8"));
const { constants, vehicles, meta } = seedData;
const draws = meta.reference_engine?.draws ?? 1100, rseed = meta.reference_engine?.seed ?? 42;
const ratio = 1586 / 2150; // median rebased / median seed, used for the 6 unmatched cars
function run(vs: any[], mult?: number) {
  const res = new Map(vs.map((v) => [v.name, costPerMile(v, constants, { draws, seed: rseed, ...(mult !== undefined ? { insuranceMultiplier: mult } : {}) })]));
  const ranked = rankWithTiers(vs.map((v) => { const r: any = res.get(v.name)!; return { id: v.name, p50: r.p50, drawsCpm: r.drawsCpm } as RankableCar; }));
  return { res, ranked };
}
const base = run(vehicles);
const rebVs = vehicles.map((v: any) => ({ ...v, specs: { ...v.specs, full_coverage_ins_usd_yr: reb[v.name] ?? v.specs.full_coverage_ins_usd_yr * ratio } }));
function report(label: string, s: any) {
  const b = base.ranked.map((r: any) => r.id), n = s.ranked.map((r: any) => r.id);
  const pos = new Map(b.map((x: string, i: number) => [x, i]));
  let sum = 0, max = 0; n.forEach((x: string, i: number) => { const d = Math.abs(i - (pos.get(x) as number)); sum += d; max = Math.max(max, d); });
  const b10 = new Set(b.slice(0, 10)); let newIn = 0; for (const x of n.slice(0, 10)) if (!b10.has(x)) newIn++;
  let sd = 0, maxd = 0, maxn = "";
  for (const v of vehicles) { const a: any = base.res.get(v.name)!, c: any = s.res.get(v.name)!; const d = c.p50 - a.p50; sd += Math.abs(d); if (Math.abs(d) > Math.abs(maxd)) { maxd = d; maxn = v.name; } }
  const bt = new Map(base.ranked.map((r: any) => [r.id, r.tier])); let tc = 0;
  for (const r of s.ranked as any[]) if (bt.get(r.id) !== r.tier) tc++;
  console.log(`\n### ${label}`);
  console.log(`mean |Δp50| $${(sd / vehicles.length).toFixed(4)}/mi (${((sd / vehicles.length) / 0.42 * 100).toFixed(1)}% of a typical $0.42/mi) · max Δ $${maxd.toFixed(4)} (${maxn})`);
  console.log(`mean |rank move| ${(sum / vehicles.length).toFixed(2)} places · max ${max} · new entrants in top 10: ${newIn} · stat-tier changes ${tc}/${vehicles.length}`);
  console.log(`base top12: ${b.slice(0, 12).join(" | ")}`);
  console.log(`new  top12: ${n.slice(0, 12).join(" | ")}`);
  // biggest rank moves
  const moves = n.map((x: string, i: number) => [x, (pos.get(x) as number) + 1, i + 1] as [string, number, number]).sort((p, q) => Math.abs(q[1] - q[2]) - Math.abs(p[1] - p[2]));
  console.log(`biggest moves: ${moves.slice(0, 6).map((mv) => `${mv[0]} #${mv[1]}→#${mv[2]}`).join(", ")}`);
}
report("Re-based (HLDI×NAIC-CA), multiplier kept at 0.8", run(rebVs));
report("Re-based, multiplier set to 1.0 (base is now a true average)", run(rebVs, 1.0));
