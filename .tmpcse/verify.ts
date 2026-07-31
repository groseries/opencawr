/** Post-change verification: row coherence, the model-year invariant, feasNote census,
 *  and the fused rank-pass timing. Mirrors what engine.worker.ts's handleRank does. */
import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { buyPointSweep, priceAtSweetSpot } from "../packages/core/src/buypoint.js";
import { modelYearRank } from "../packages/core/src/modelyear.js";
import { impliedModelYear } from "../packages/core/src/feasibility.js";
import { rankWithTiers, type RankableCar } from "../packages/core/src/tiers.js";

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

for (const hold of [50_000, 100_000, 150_000]) {
  const inputs = { ...BASE, holdMiles: hold };
  let coherent = 0, myrAgree = 0, notes: string[] = [];
  for (const v of vehicles) {
    const { sweep, priced } = priceAtSweetSpot(v, c, inputs);
    if (priced.buyOdo === sweep.idealOdo && priced.impliedBuyYear === sweep.idealYear) coherent++;
    const myr = modelYearRank(v, c, inputs);
    if (myr.bestYear === sweep.idealYear && myr.bestOdo === sweep.idealOdo && myr.bestP50 === sweep.idealP50) myrAgree++;
    const y = Math.round(impliedModelYear(priced.buyOdo, BASE.annualMiles, c.now_year));
    if (y > v.last_year) notes.push(`${v.name}: low-mileage example (last built ${v.last_year}) @${priced.buyOdo}`);
    else if (y < v.first_year) notes.push(`${v.name}: more miles than plausible @${priced.buyOdo}`);
  }
  console.log(`hold ${hold / 1000}k: row coherence ${coherent}/${vehicles.length}, modelYearRank==sweep ${myrAgree}/${vehicles.length}, feasNote fires ${notes.length}`);
  for (const n of notes) console.log(`    ${n}`);
}

// eol: no sweep, priced at default
{
  const inputs = { ...BASE, holdMiles: "eol" as const };
  let coherent = 0;
  for (const v of vehicles) {
    const r = costPerMile(v, c, inputs);
    if (r.buyOdo === v.pinned_buy_odo) coherent++;
  }
  console.log(`hold eol: row priced at pinned_buy_odo ${coherent}/${vehicles.length}`);
}

// Fused pass timing (what handleRank now does at a fixed hold), vs the eol pass.
function fused(hold: number) {
  const inputs = { ...BASE, holdMiles: hold };
  const t = performance.now();
  const res = vehicles.map((v) => {
    const { sweep, priced } = priceAtSweetSpot(v, c, inputs);
    return { v, r: priced, upperOdo: sweep.upperOdo };
  });
  for (const f of ["p50", "p75"] as const)
    rankWithTiers(res.map(({ v, r }): RankableCar => ({ id: v.name, p50: r[f], drawsCpm: r.drawsCpm })));
  return performance.now() - t;
}
function eolPass() {
  const inputs = { ...BASE, holdMiles: "eol" as const };
  const t = performance.now();
  const res = vehicles.map((v) => ({ v, r: costPerMile(v, c, inputs) }));
  for (const f of ["p50", "p75"] as const)
    rankWithTiers(res.map(({ v, r }): RankableCar => ({ id: v.name, p50: r[f], drawsCpm: r.drawsCpm })));
  return performance.now() - t;
}
fused(100_000); eolPass();
const fu = [fused(100_000), fused(100_000), fused(100_000)];
const eo = [eolPass(), eolPass(), eolPass()];
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[1]!;
console.log(`\nfused rank pass @100k hold: ${med(fu).toFixed(0)} ms (${fu.map(x=>x.toFixed(0)).join("/")})`);
console.log(`rank pass @ "eol":          ${med(eo).toFixed(0)} ms (${eo.map(x=>x.toFixed(0)).join("/")})`);

// Hand-check three named cars at a 100k hold: total / miles vs $/mi.
console.log("\nhand-check (100k hold):");
for (const name of ["Porsche 996 Turbo", "Porsche 996 Carrera", "Ford Ranger (old compact)", "Toyota 4Runner", "Chevy Bolt EV"]) {
  const v = vehicles.find((x) => x.name === name);
  if (!v) { console.log(`  ${name}: NOT FOUND`); continue; }
  const { sweep, priced } = priceAtSweetSpot(v, c, { ...BASE, holdMiles: 100_000 });
  console.log(
    `  ${name}: shown ${priced.impliedBuyYear} @${Math.round(priced.buyOdo/1000)}k` +
    `${sweep.upperOdo !== null ? ` (up to ${Math.round(sweep.upperOdo/1000)}k)` : ""}` +
    ` | $/mi P50 ${priced.p50.toFixed(3)} | total $${Math.round(priced.lifetimeCostUsdP50).toLocaleString()} over ${Math.round(priced.lifetimeMilesP50/1000)}k mi` +
    ` | total/miles = ${(priced.lifetimeCostUsdP50 / priced.lifetimeMilesP50).toFixed(3)}`,
  );
}
console.log("\nhand-check (eol):");
for (const name of ["Porsche 996 Turbo", "Ford Ranger (old compact)", "Toyota 4Runner"]) {
  const v = vehicles.find((x) => x.name === name)!;
  const r = costPerMile(v, c, { ...BASE, holdMiles: "eol" as const });
  console.log(
    `  ${name}: shown ${r.impliedBuyYear} priced at ${Math.round(r.buyOdo/1000)}k | $/mi P50 ${r.p50.toFixed(3)}` +
    ` | total $${Math.round(r.lifetimeCostUsdP50).toLocaleString()} over ${Math.round(r.lifetimeMilesP50/1000)}k mi | total/miles = ${(r.lifetimeCostUsdP50/r.lifetimeMilesP50).toFixed(3)}`,
  );
}
