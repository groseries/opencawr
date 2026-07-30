/**
 * R13 blast-radius measurement: compares the engine's live results (NAIC
 * value-scaled insurance) against opencawr_data.json's still-un-regenerated
 * `model_output` (the pre-R13 reference). Run BEFORE `npm run gen-reference`.
 */
import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { curveAt, parseCurve } from "../packages/core/src/curves.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";

const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c = d.constants;
const DRAWS = 1100, SEED = 42;

const res = new Map(d.vehicles.map((v: any) => [v.name, costPerMile(v, c, { draws: DRAWS, seed: SEED })]));
const ranked = rankWithTiers(
  d.vehicles.map((v: any): RankableCar => ({ id: v.name, p50: res.get(v.name)!.p50, drawsCpm: res.get(v.name)!.drawsCpm })),
);
const newRank = new Map(ranked.map((r) => [r.id, r]));
const oldRank = [...d.vehicles].sort((a: any, b: any) => a.model_output.cost_per_mile_p50 - b.model_output.cost_per_mile_p50);
const oldRankByName = new Map(oldRank.map((v: any, i) => [v.name, i + 1]));

// premiums: old = flat seed x mult; new = liab + physdmg x book/ref, per year, avg over median hold
const esc = c.insurance_cpi_escalator, mult = c.insurance_multiplier_USAA;
const liab = esc * c.liability_only_usd_yr * mult;
const phys = esc * (c.collision_premium_usd_yr + c.comprehensive_premium_usd_yr) * mult;
const am = c.annual_miles;
const rows = d.vehicles.map((v: any) => {
  const scrap = c.scrap_usd_by_body[v.body] ?? 400;
  const pc = parseCurve(v.price_vs_odometer_usd);
  const r = res.get(v.name)!;
  const T = (r.medianSellOdo - v.pinned_buy_odo) / am;
  const prem = (odo: number) => {
    const book = curveAt(pc, odo, scrap);
    return book > c.full_cov_threshold_usd ? liab + phys * (book / c.insurance_ref_book_usd) : liab;
  };
  let sum = 0, w = 0;
  for (let t = 1; t <= Math.ceil(T); t++) { const ww = Math.min(T - (t - 1), 1); sum += ww * prem(v.pinned_buy_odo + (t - 1) * am); w += ww; }
  const oldPrem = v.specs.full_coverage_ins_usd_yr * mult;
  return {
    name: v.name, oldPrem, newYr1: prem(v.pinned_buy_odo), newAvg: sum / w,
    oldP50: v.model_output.cost_per_mile_p50, newP50: r.p50,
    oldTier: v.model_output.stat_tier, newTier: newRank.get(v.name)!.tier,
    oldR: oldRankByName.get(v.name)!, newR: newRank.get(v.name)!.rank,
  };
});

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`premium (yr1)  median: $${med(rows.map((r:any)=>r.oldPrem)).toFixed(0)} -> $${med(rows.map((r:any)=>r.newYr1)).toFixed(0)} (${(100*(med(rows.map((r:any)=>r.newYr1))/med(rows.map((r:any)=>r.oldPrem))-1)).toFixed(1)}%)`);
console.log(`premium (hold-avg) median: $${med(rows.map((r:any)=>r.oldPrem)).toFixed(0)} -> $${med(rows.map((r:any)=>r.newAvg)).toFixed(0)} (${(100*(med(rows.map((r:any)=>r.newAvg))/med(rows.map((r:any)=>r.oldPrem))-1)).toFixed(1)}%)`);
const dp = rows.map((r:any)=>r.newP50-r.oldP50);
console.log(`p50 $/mi: mean ${mean(dp).toFixed(4)}, MAE ${mean(dp.map(Math.abs)).toFixed(4)}, max |Δ| ${Math.max(...dp.map(Math.abs)).toFixed(4)}, mean %|Δ| ${mean(rows.map((r:any)=>Math.abs(r.newP50/r.oldP50-1)*100)).toFixed(2)}%`);
const mv = rows.map((r:any)=>Math.abs(r.newR-r.oldR));
console.log(`rank move: mean ${mean(mv).toFixed(2)} places, max ${Math.max(...mv)}; unchanged ${mv.filter((x:number)=>x===0).length}/71`);
console.log(`distribution: ${[0,1,2,3,4,5,6,7].map((k)=>`${k}:${mv.filter((x:number)=>x===k).length}`).join(" ")} 8+:${mv.filter((x:number)=>x>=8).length}`);
console.log(`stat_tier changes: ${rows.filter((r:any)=>r.oldTier!==r.newTier).length}/71`);
const oldTop10 = oldRank.slice(0,10).map((v:any)=>v.name), newTop10 = ranked.slice(0,10).map((r)=>r.id);
console.log(`top10 retained: ${newTop10.filter((n)=>oldTop10.includes(n)).length}/10`);
console.log(`old top12: ${oldRank.slice(0,12).map((v:any)=>v.name).join(" | ")}`);
console.log(`new top12: ${ranked.slice(0,12).map((r)=>r.id).join(" | ")}`);
console.log("\nbiggest premium movers (yr1):");
for (const r of [...rows].sort((a:any,b:any)=>Math.abs(b.newYr1-b.oldPrem)-Math.abs(a.newYr1-a.oldPrem)).slice(0,10))
  console.log(`  ${r.name}: $${r.oldPrem.toFixed(0)} -> $${r.newYr1.toFixed(0)} (${(r.newYr1-r.oldPrem>0?"+":"")}${(r.newYr1-r.oldPrem).toFixed(0)})`);
console.log("\nbiggest rank movers:");
for (const r of [...rows].sort((a:any,b:any)=>Math.abs(b.newR-b.oldR)-Math.abs(a.newR-a.oldR)).slice(0,10))
  console.log(`  ${r.name}: #${r.oldR} -> #${r.newR} (${r.newR-r.oldR>0?"+":""}${r.newR-r.oldR}), $/mi ${r.oldP50.toFixed(4)} -> ${r.newP50.toFixed(4)}, tier ${r.oldTier}->${r.newTier}`);
