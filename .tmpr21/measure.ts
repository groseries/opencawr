/**
 * R21 — replacement-vehicle cost on the hold-length axis. Every number in
 * docs/investigations/2026-07-31-hold-length-replacement.md comes from here.
 * Run: npx tsx .tmpr21/measure.ts   (Node >= 20)
 *
 * Metrics compared, all on the SAME per-draw stream (common random numbers
 * within a vehicle x hold):
 *   TODAY   shipped $/mi — PV dollars / undiscounted miles
 *   F2      levelized as R10 option 2 specified it — PV dollars / PV miles,
 *           tires left nominal (which is what the shipped engine does)
 *   EAC     the same, with tires charged as PV dollars — i.e. a true
 *           repeat-the-identical-hold-forever equivalent annual cost
 */
import { readFileSync } from "node:fs";
import { costPerMileCf, type CfSwitches } from "./engine-cf.js";
import { quantileSorted } from "../packages/core/src/engine.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";
import type { Constants, Vehicle } from "../packages/core/src/types.js";

const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c: Constants = d.constants;
const vehicles: Vehicle[] = d.vehicles;
const am = c.annual_miles;
const r = c.discount_rate_real;

const DRAWS = 1_100;
const HOLDS: (number | "eol")[] = [
  25_000, 50_000, 75_000, 100_000, 125_000, 150_000, 175_000, 200_000, "eol",
];

const TODAY: CfSwitches = {};
const F2: CfSwitches = { levelize: true };
const EAC: CfSwitches = { levelize: true, discountTires: true };

const p50 = (a: Float64Array) => quantileSorted(Float64Array.from(a).sort(), 0.5);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const pct = (from: number, to: number) => (100 * (to - from)) / from;
const f = (x: number, n = 4) => x.toFixed(n);
const hlabel = (h: number | "eol") => (h === "eol" ? "eol" : `${h / 1000}k`);

function section(t: string) {
  console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
}

// ---------------------------------------------------------------------------
section("1. Effect size — fixed hold vs 'until it dies', at each car's pinned buy odo");
// ---------------------------------------------------------------------------
// Cached runs reused by several sections below.
const runs = new Map<string, ReturnType<typeof costPerMileCf>>();
const key = (v: string, h: number | "eol", m: string) => `${v}|${h}|${m}`;
for (const v of vehicles) {
  for (const h of HOLDS) {
    runs.set(key(v.name, h, "TODAY"), costPerMileCf(v, c, { holdMiles: h, draws: DRAWS, seed: 42 }, TODAY));
    runs.set(key(v.name, h, "F2"), costPerMileCf(v, c, { holdMiles: h, draws: DRAWS, seed: 42 }, F2));
    runs.set(key(v.name, h, "EAC"), costPerMileCf(v, c, { holdMiles: h, draws: DRAWS, seed: 42 }, EAC));
  }
}
const get = (v: string, h: number | "eol", m: string) => runs.get(key(v, h, m))!.p50;

console.log("% change from the fixed hold to 'eol' (negative = eol reads cheaper)");
console.log("hold  | TODAY mean  med    [min, max]        | EAC mean   med    [min, max]");
for (const h of [50_000, 100_000, 150_000] as const) {
  const t = vehicles.map((v) => pct(get(v.name, h, "TODAY"), get(v.name, "eol", "TODAY")));
  const e = vehicles.map((v) => pct(get(v.name, h, "EAC"), get(v.name, "eol", "EAC")));
  console.log(
    `${hlabel(h).padEnd(5)} | ${f(mean(t), 1).padStart(6)}% ${f(median(t), 1).padStart(6)}% ` +
      `[${f(Math.min(...t), 1)}, ${f(Math.max(...t), 1)}]`.padEnd(19) +
      ` | ${f(mean(e), 1).padStart(6)}% ${f(median(e), 1).padStart(6)}% ` +
      `[${f(Math.min(...e), 1)}, ${f(Math.max(...e), 1)}]`,
  );
}

// ---------------------------------------------------------------------------
section("2. Is 'which hold is cheapest' even identified today?");
// ---------------------------------------------------------------------------
// (a) seed stability of the argmin under TODAY vs EAC
const SEEDS = [42, 7, 101, 202, 303, 404, 505, 606, 777, 888, 909, 1234];
let stableToday = 0;
let stableEac = 0;
const distinctToday: number[] = [];
for (const v of vehicles) {
  const wToday = new Set<string>();
  const wEac = new Set<string>();
  for (const s of SEEDS) {
    let bt: [string, number] | null = null;
    let be: [string, number] | null = null;
    for (const h of HOLDS) {
      const t = costPerMileCf(v, c, { holdMiles: h, draws: 400, seed: s }, TODAY).p50;
      const e = costPerMileCf(v, c, { holdMiles: h, draws: 400, seed: s }, EAC).p50;
      if (!bt || t < bt[1]) bt = [hlabel(h), t];
      if (!be || e < be[1]) be = [hlabel(h), e];
    }
    wToday.add(bt![0]);
    wEac.add(be![0]);
  }
  distinctToday.push(wToday.size);
  if (wToday.size === 1) stableToday++;
  if (wEac.size === 1) stableEac++;
}
console.log(`argmin identical across ${SEEDS.length} seeds (400 draws):`);
console.log(`  TODAY ${stableToday}/${vehicles.length} vehicles, mean ${f(mean(distinctToday), 2)} distinct winners each`);
console.log(`  EAC   ${stableEac}/${vehicles.length} vehicles`);

// (b) best vs runner-up against Monte Carlo standard error
function seOfP50(cpm: Float64Array): number {
  // bootstrap-free normal approximation: se(median) ~ 1.2533 * sd / sqrt(n)
  const a = Array.from(cpm);
  return (1.2533 * sd(a)) / Math.sqrt(a.length);
}
let under1se = 0;
let under2se = 0;
const tstats: number[] = [];
for (const v of vehicles) {
  const scored = HOLDS.map((h) => ({ h, p: get(v.name, h, "TODAY"), run: runs.get(key(v.name, h, "TODAY"))! }));
  scored.sort((a, b) => a.p - b.p);
  const gap = scored[1]!.p - scored[0]!.p;
  const se = Math.hypot(seOfP50(scored[0]!.run.cpm), seOfP50(scored[1]!.run.cpm));
  const t = gap / se;
  tstats.push(t);
  if (t < 1) under1se++;
  if (t < 2) under2se++;
}
console.log(`TODAY best-vs-runner-up (${DRAWS} draws): <1 SE on ${under1se}/71, <2 SE on ${under2se}/71, median t = ${f(median(tstats), 2)}`);

// (c) the long end of the grid is the same experiment repeated
let same200Eol = 0;
let sameFourLong = 0;
for (const v of vehicles) {
  const e = get(v.name, "eol", "TODAY");
  if (Math.abs(pct(e, get(v.name, 200_000, "TODAY"))) < 0.1) same200Eol++;
  const four = [150_000, 175_000, 200_000].map((h) => get(v.name, h as number, "TODAY")).concat(e);
  if ((Math.max(...four) - Math.min(...four)) / Math.min(...four) < 0.005) sameFourLong++;
}
console.log(`200k and 'eol' within 0.1%: ${same200Eol}/71 vehicles`);
console.log(`{150k,175k,200k,eol} all within 0.5%: ${sameFourLong}/71 vehicles`);

// ---------------------------------------------------------------------------
section("3. Cheapest hold — distribution and the long->short claim");
// ---------------------------------------------------------------------------
function argmin(v: Vehicle, m: string): string {
  let best: [string, number] | null = null;
  for (const h of HOLDS) {
    const p = get(v.name, h, m);
    if (!best || p < best[1]) best = [hlabel(h), p];
  }
  return best![0];
}
const bins = (m: string) => {
  const out: Record<string, number> = {};
  for (const v of vehicles) {
    const a = argmin(v, m);
    out[a] = (out[a] ?? 0) + 1;
  }
  return out;
};
const longSet = new Set(["125k", "150k", "175k", "200k", "eol"]);
const shortSet = new Set(["25k", "50k", "75k", "100k"]);
let flips = 0;
let longToShort = 0;
for (const v of vehicles) {
  const a = argmin(v, "TODAY");
  const b = argmin(v, "EAC");
  if (a !== b) flips++;
  if (longSet.has(a) && shortSet.has(b)) longToShort++;
}
console.log("TODAY", JSON.stringify(bins("TODAY")));
console.log("EAC  ", JSON.stringify(bins("EAC")));
console.log(`argmin changes: ${flips}/71; long(>=125k) -> short(<=100k): ${longToShort}/71`);
console.log(
  `TODAY argmin in {125k..eol}: ${vehicles.filter((v) => longSet.has(argmin(v, "TODAY"))).length}/71; ` +
    `EAC argmin in {25k..100k}: ${vehicles.filter((v) => shortSet.has(argmin(v, "EAC"))).length}/71`,
);

// ---------------------------------------------------------------------------
section("4. How much of today's hold gradient is R20's resale blend?");
// ---------------------------------------------------------------------------
const CLIFF: CfSwitches = { resaleCliff: true };
const preRuns = new Map<string, number>();
for (const v of vehicles) {
  for (const h of HOLDS) {
    preRuns.set(
      key(v.name, h, "PRE"),
      costPerMileCf(v, c, { holdMiles: h, draws: DRAWS, seed: 42 }, CLIFF).p50,
    );
  }
}
function argminPre(v: Vehicle): string {
  let best: [string, number] | null = null;
  for (const h of HOLDS) {
    const p = preRuns.get(key(v.name, h, "PRE"))!;
    if (!best || p < best[1]) best = [hlabel(h), p];
  }
  return best![0];
}
const preBins: Record<string, number> = {};
let preFlips = 0;
let preLongToShort = 0;
for (const v of vehicles) {
  const a = argminPre(v);
  preBins[a] = (preBins[a] ?? 0) + 1;
  const b = argmin(v, "EAC");
  if (a !== b) preFlips++;
  if (longSet.has(a) && shortSet.has(b)) preLongToShort++;
}
console.log("pre-R20 (hard cliff) TODAY argmin", JSON.stringify(preBins));
console.log(`pre-R20: argmin in {125k..eol} ${vehicles.filter((v) => longSet.has(argminPre(v))).length}/71; flips vs EAC ${preFlips}/71; long->short ${preLongToShort}/71`);
const preGap100 = vehicles.map((v) => pct(preRuns.get(key(v.name, 100_000, "PRE"))!, preRuns.get(key(v.name, "eol", "PRE"))!));
const postGap100 = vehicles.map((v) => pct(get(v.name, 100_000, "TODAY"), get(v.name, "eol", "TODAY")));
console.log(`100k -> eol gap: pre-R20 mean ${f(mean(preGap100), 2)}%, post-R20 mean ${f(mean(postGap100), 2)}%`);
let eolIdentical = 0;
for (const v of vehicles) {
  if (Math.abs(preRuns.get(key(v.name, "eol", "PRE"))! - get(v.name, "eol", "TODAY")) === 0) eolIdentical++;
}
console.log(`'eol' mode bit-identical pre/post R20: ${eolIdentical}/71 vehicles`);

// ---------------------------------------------------------------------------
section("5. The replacement stand-in is the whole fix — sensitivity");
// ---------------------------------------------------------------------------
/**
 * Chain value of a policy: buy this vehicle at `buyOdo`, hold `holdMiles`, then
 * repeat that policy forever. PV cost and PV miles of the infinite chain are the
 * one-cycle values divided by (1 - df(T)).
 *
 * For hold option X evaluated against a CONTINUATION policy S:
 *   $/mi = (C_X + df(T_X) * Vchain_S) / (M_X + df(T_X) * Mchain_S)
 * With S = X itself this collapses to C_X / M_X, i.e. the EAC metric above —
 * which is exactly why self-replication looks canonical.
 */
function chain(v: Vehicle, buyOdo: number | undefined, holdMiles: number | "eol") {
  const res = costPerMileCf(v, c, { holdMiles, buyOdo, draws: DRAWS, seed: 42 }, EAC);
  const C = p50(res.pvUsd);
  const M = p50(res.pvMiles);
  const T = p50(res.years);
  const df = Math.pow(1 + r, -T);
  return { C, M, T, df, Vchain: C / (1 - df), Mchain: M / (1 - df), res };
}
function underContinuation(v: Vehicle, holdMiles: number | "eol", S: { Vchain: number; Mchain: number }) {
  const x = costPerMileCf(v, c, { holdMiles, draws: DRAWS, seed: 42 }, EAC);
  const out = new Float64Array(x.cpm.length);
  for (let i = 0; i < out.length; i++) {
    const df = Math.pow(1 + r, -x.years[i]!);
    out[i] = (x.pvUsd[i]! + df * S.Vchain) / (x.pvMiles[i]! + df * S.Mchain);
  }
  return p50(out);
}
const corolla = vehicles.find((v) => v.name.includes("Corolla"))!;
const contSame = chain(corolla, undefined, "eol"); // "next car: this car, driven to death"
const contBeater = chain(corolla, 100_000, 50_000); // "next car: a 100k-mi example, held 50k"
console.log(`Corolla, buy odo ${corolla.pinned_buy_odo}, eol_maintained_miles ${Math.round(corolla.eol_maintained_miles)}`);
console.log("hold  | TODAY    | self-replicating (EAC) | continuation: same car to eol | continuation: 100k-mi beater");
for (const h of [50_000, 100_000, 150_000, "eol"] as const) {
  const self = get(corolla.name, h, "EAC");
  const a = underContinuation(corolla, h, contSame);
  const b = underContinuation(corolla, h, contBeater);
  console.log(
    `${hlabel(h).padEnd(5)} | ${f(get(corolla.name, h, "TODAY"))} | ${f(self).padStart(22)} | ${f(a).padStart(29)} | ${f(b).padStart(28)}`,
  );
}
const gapSelf = pct(get(corolla.name, 50_000, "EAC"), get(corolla.name, "eol", "EAC"));
const gapSame = pct(underContinuation(corolla, 50_000, contSame), underContinuation(corolla, "eol", contSame));
const gapBeater = pct(underContinuation(corolla, 50_000, contBeater), underContinuation(corolla, "eol", contBeater));
console.log(`50k -> eol gap: self-replicating ${f(gapSelf, 2)}%, same-car continuation ${f(gapSame, 2)}%, beater continuation ${f(gapBeater, 2)}%`);

// ---------------------------------------------------------------------------
section("6. Undiscounted tires in a PV numerator (engine.ts:202)");
// ---------------------------------------------------------------------------
console.log("Corolla: F2 (tires nominal, as R10 option 2 specified) vs EAC (tires discounted)");
console.log("hold  | TODAY    | F2       | EAC      | F2-EAC     %");
for (const h of HOLDS) {
  const t = get(corolla.name, h, "TODAY");
  const a = get(corolla.name, h, "F2");
  const b = get(corolla.name, h, "EAC");
  console.log(`${hlabel(h).padEnd(5)} | ${f(t)} | ${f(a)} | ${f(b)} | ${f(a - b)} ${f(pct(b, a), 2).padStart(6)}%`);
}
const tiresGap = vehicles.map((v) => get(v.name, "eol", "F2") - get(v.name, "eol", "EAC"));
console.log(`field at 'eol': mean F2-EAC ${f(mean(tiresGap))} $/mi, max ${f(Math.max(...tiresGap))}`);

// ---------------------------------------------------------------------------
section("7. Nominal holds are not realized holds (truncation)");
// ---------------------------------------------------------------------------
for (const h of [100_000, 150_000, 200_000] as const) {
  const trunc = vehicles.map((v) => runs.get(key(v.name, h, "TODAY"))!.truncatedDrawFraction);
  const realized = vehicles.map((v) => p50(runs.get(key(v.name, h, "TODAY"))!.miles) / h);
  console.log(
    `${hlabel(h)} nominal: mean truncated-draw fraction ${f(mean(trunc), 3)}, ` +
      `mean realized/nominal miles ${f(mean(realized), 3)}, ` +
      `vehicles realizing <90%: ${realized.filter((x) => x < 0.9).length}/71`,
  );
}

// ---------------------------------------------------------------------------
section("8. Blast radius if the metric changed (at the reference basis: holdMiles 'eol')");
// ---------------------------------------------------------------------------
const cars = (m: string): RankableCar[] =>
  vehicles.map((v) => ({ id: v.name, p50: get(v.name, "eol", m), drawsCpm: runs.get(key(v.name, "eol", m))!.cpm }));
const rkToday = rankWithTiers(cars("TODAY"));
const rkEac = rankWithTiers(cars("EAC"));
const posToday = new Map(rkToday.map((x) => [x.id, x.rank]));
const posEac = new Map(rkEac.map((x) => [x.id, x.rank]));
const shifts = vehicles.map((v) => Math.abs(posToday.get(v.name)! - posEac.get(v.name)!));
const maxShift = Math.max(...shifts);
const maxMover = vehicles.find((v) => Math.abs(posToday.get(v.name)! - posEac.get(v.name)!) === maxShift)!;
console.log(
  `mean headline ${f(mean(vehicles.map((v) => get(v.name, "eol", "TODAY"))))} -> ` +
    `${f(mean(vehicles.map((v) => get(v.name, "eol", "EAC"))))} ` +
    `(+${f(pct(mean(vehicles.map((v) => get(v.name, "eol", "TODAY"))), mean(vehicles.map((v) => get(v.name, "eol", "EAC")))), 1)}%)`,
);
console.log(`mean |rank shift| ${f(mean(shifts), 2)}, max ${maxShift} (${maxMover.name})`);
const tierToday = new Map(rkToday.map((x) => [x.id, x.tier]));
const tierEac = new Map(rkEac.map((x) => [x.id, x.tier]));
console.log(
  `tie tiers ${Math.max(...rkToday.map((x) => x.tier))} -> ${Math.max(...rkEac.map((x) => x.tier))}; ` +
    `stat_tier changes for ${vehicles.filter((v) => tierToday.get(v.name) !== tierEac.get(v.name)).length}/71`,
);
console.log("top 10 TODAY:", rkToday.slice(0, 10).map((x) => x.id).join(" | "));
console.log("top 10 EAC  :", rkEac.slice(0, 10).map((x) => x.id).join(" | "));
const top6 = rkEac.slice(0, 6).map((x) => x.id);
console.log(
  `reference.test.ts top-6 guardrail under EAC: Bolt EV ${top6.includes("Chevy Bolt EV") ? "in" : "OUT"}, ` +
    `Prius (hybrid) ${top6.includes("Toyota Prius (hybrid)") ? "in" : "OUT"}`,
);

// correlation between how much a car's price inflates and how long it lives
const infl = vehicles.map((v) => pct(get(v.name, "eol", "TODAY"), get(v.name, "eol", "EAC")));
const eols = vehicles.map((v) => v.eol_maintained_miles);
const corr = (() => {
  const mx = mean(infl);
  const my = mean(eols);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < infl.length; i++) {
    sxy += (infl[i]! - mx) * (eols[i]! - my);
    sxx += (infl[i]! - mx) ** 2;
    syy += (eols[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
})();
console.log(`corr(price inflation %, eol_maintained_miles) = ${f(corr, 3)}`);
for (const name of ["Fiat 500", "Toyota Highlander Hybrid", "Toyota Prius (hybrid)"]) {
  if (!posToday.has(name)) continue;
  console.log(
    `  ${name}: rank ${posToday.get(name)} -> ${posEac.get(name)}, ` +
      `$/mi ${f(get(name, "eol", "TODAY"))} -> ${f(get(name, "eol", "EAC"))}, ` +
      `eol ${Math.round(vehicles.find((v) => v.name === name)!.eol_maintained_miles)}`,
  );
}
