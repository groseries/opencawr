/** Timing + blast-radius measurement for the sweet-spot pricing change. */
import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { buyPointSweep, feasibleSweepOdoRange } from "../packages/core/src/buypoint.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";
import { CALIBRATION } from "../packages/core/src/calibration.js";

const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c = d.constants;
const vehicles = d.vehicles as any[];

const BASE = {
  annualMiles: 13_000,
  discountRate: 0.07,
  gasUsdPerGal: 5.455,
  elecUsdPerKwh: c.elec_usd_per_kwh,
  insuranceMultiplier: 0.8,
  useTaxRate: 0.07,
  draws: 1100,
  seed: 42,
};
const HOLD = 100_000;
const inputs = { ...BASE, holdMiles: HOLD };

// --- grid size census
let gridPoints = 0;
for (const v of vehicles) {
  const [lo, hi] = feasibleSweepOdoRange(v, c, BASE.annualMiles);
  gridPoints += Math.floor((hi - lo) / CALIBRATION.sweepStepMiles) + 1;
}
console.log(`grid points across field: ${gridPoints} (avg ${(gridPoints / vehicles.length).toFixed(1)}/car)`);

// --- warm up
for (const v of vehicles.slice(0, 5)) costPerMile(v, c, inputs);

// --- rank pass at default buy odo (today's handleRank cost, one basis pair)
function rankPassDefault() {
  const t = performance.now();
  const res = vehicles.map((v) => ({ v, r: costPerMile(v, c, inputs) }));
  for (const field of ["p50", "p75"] as const) {
    rankWithTiers(res.map(({ v, r }): RankableCar => ({ id: v.name, p50: r[field], drawsCpm: r.drawsCpm })));
  }
  return { ms: performance.now() - t, res };
}

// --- sweep pass
function sweepPass() {
  const t = performance.now();
  const points = new Map<string, ReturnType<typeof buyPointSweep>>();
  for (const v of vehicles) points.set(v.name, buyPointSweep(v, c, inputs));
  return { ms: performance.now() - t, points };
}

// --- rank pass at ideal odo
function rankPassIdeal(points: Map<string, any>) {
  const t = performance.now();
  const res = vehicles.map((v) => ({
    v,
    r: costPerMile(v, c, { ...inputs, buyOdo: points.get(v.name)!.idealOdo }),
  }));
  for (const field of ["p50", "p75"] as const) {
    rankWithTiers(res.map(({ v, r }): RankableCar => ({ id: v.name, p50: r[field], drawsCpm: r.drawsCpm })));
  }
  return { ms: performance.now() - t, res };
}

const times = { rankDefault: [] as number[], sweep: [] as number[], rankIdeal: [] as number[] };
let lastDefault: any, lastSweep: any, lastIdeal: any;
for (let i = 0; i < 3; i++) {
  const a = rankPassDefault(); times.rankDefault.push(a.ms); lastDefault = a.res;
  const b = sweepPass(); times.sweep.push(b.ms); lastSweep = b.points;
  const cc = rankPassIdeal(b.points); times.rankIdeal.push(cc.ms); lastIdeal = cc.res;
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log(`rank pass @ default buyOdo: ${med(times.rankDefault).toFixed(0)} ms  (${times.rankDefault.map((x) => x.toFixed(0)).join("/")})`);
console.log(`full field sweep:            ${med(times.sweep).toFixed(0)} ms  (${times.sweep.map((x) => x.toFixed(0)).join("/")})`);
console.log(`rank pass @ idealOdo:        ${med(times.rankIdeal).toFixed(0)} ms  (${times.rankIdeal.map((x) => x.toFixed(0)).join("/")})`);
console.log(`combined (sweep + rank):     ${(med(times.sweep) + med(times.rankIdeal)).toFixed(0)} ms`);

// --- blast radius: ranking at default vs at idealOdo, P50 basis
function rankOrder(res: any[], field: "p50" | "p75") {
  const ranked = rankWithTiers(
    res.map(({ v, r }: any): RankableCar => ({ id: v.name, p50: r[field], drawsCpm: r.drawsCpm })),
  );
  return new Map(ranked.map((x) => [x.id, x.rank]));
}
for (const field of ["p50", "p75"] as const) {
  const oldO = rankOrder(lastDefault, field);
  const newO = rankOrder(lastIdeal, field);
  let moved = 0, maxMove = 0, maxName = "";
  const deltas: { name: string; from: number; to: number }[] = [];
  for (const [name, from] of oldO) {
    const to = newO.get(name)!;
    if (from !== to) moved++;
    const dd = Math.abs(from - to);
    if (dd > maxMove) { maxMove = dd; maxName = name; }
    deltas.push({ name, from, to });
  }
  console.log(`\n[${field}] rows that move: ${moved}/${vehicles.length}, max move ${maxMove} places (${maxName})`);
  const top5old = [...oldO].sort((a, b) => a[1] - b[1]).slice(0, 5).map((x) => x[0]);
  const top5new = [...newO].sort((a, b) => a[1] - b[1]).slice(0, 5).map((x) => x[0]);
  console.log(`  top5 old: ${top5old.join(", ")}`);
  console.log(`  top5 new: ${top5new.join(", ")}`);
  const biggest = [...deltas].sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to)).slice(0, 6);
  for (const b of biggest) console.log(`  ${b.name}: #${b.from} -> #${b.to}`);
}

// --- disagreement census (today's bug): displayed idealYear/idealOdo vs priced buyOdo
let odoDiff = 0, yearDiff = 0;
const worst: { name: string; pct: number; shown: string; priced: string }[] = [];
for (const { v, r } of lastDefault) {
  const sw = lastSweep.get(v.name)!;
  if (sw.idealOdo !== r.buyOdo) odoDiff++;
  if (sw.idealYear !== r.impliedBuyYear) yearDiff++;
  const ideal = lastIdeal.find((x: any) => x.v.name === v.name)!.r;
  worst.push({
    name: v.name,
    pct: Math.abs(ideal.p50 - r.p50) / r.p50,
    shown: `${sw.idealYear} @${Math.round(sw.idealOdo / 1000)}k`,
    priced: `${r.impliedBuyYear} @${Math.round(r.buyOdo / 1000)}k`,
  });
}
console.log(`\ntoday's disagreement: odometer differs ${odoDiff}/${vehicles.length}, model year differs ${yearDiff}/${vehicles.length}`);
for (const w of worst.sort((a, b) => b.pct - a.pct).slice(0, 5)) {
  console.log(`  ${w.name}: shown ${w.shown} vs priced ${w.priced} -> ${(w.pct * 100).toFixed(0)}% $/mi diff`);
}

// --- feasNote at the sweet spot: should never fire
import { impliedModelYear } from "../packages/core/src/feasibility.js";
let notes = 0;
for (const v of vehicles) {
  const sw = lastSweep.get(v.name)!;
  const y = Math.round(impliedModelYear(sw.idealOdo, BASE.annualMiles, c.now_year));
  if (y > v.last_year || y < v.first_year) {
    notes++;
    console.log(`  feasNote still fires at sweet spot: ${v.name} idealOdo=${sw.idealOdo} impliedYear=${y} range=${v.first_year}-${v.last_year}`);
  }
}
console.log(`\nfeasNote firings at sweet spot: ${notes}/${vehicles.length}`);
