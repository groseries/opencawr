import { readFileSync } from "node:fs";
const B="/Users/jig/VSCode Projects/opencawr/.claude/worktrees/bridge-cse_01RuqxJ16tGSdfjaXQ3fYCuP";
const { costPerMile } = await import(B+"/packages/core/src/engine.js");
const d = JSON.parse(readFileSync(B+"/opencawr_data.json","utf8"));
const inputs = { holdMiles:100_000, annualMiles:13_000, discountRate:0.07, gasUsdPerGal:5.455,
  insuranceMultiplier:0.8, useTaxRate:0.07, draws:1100, seed:42 };
const sd=(a:number[])=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length);};

const v = d.vehicles.find((x:any)=>x.name==="Toyota Corolla");
// two adjacent model years: 2020 (73k mi) vs 2022 (52k? use canonical)
const A = costPerMile(v, d.constants, {...inputs, buyOdo: 78_000});
const Bb= costPerMile(v, d.constants, {...inputs, buyOdo: 52_000});
const a=[...A.drawsCpm], b=[...Bb.drawsCpm];
const diff=a.map((x,i)=>x-b[i]!);
console.log("Toyota Corolla, 2020 (78k mi) vs 2022 (52k mi), 100k hold, paired (same seed):");
console.log(`  level sd:      $${sd(a).toFixed(4)}/mi  (P05-P95 spread is what the band column shows)`);
console.log(`  PAIRED diff sd:$${sd(diff).toFixed(4)}/mi  <- what the tie test actually sees`);
console.log(`  mean diff:     $${(diff.reduce((x,y)=>x+y,0)/diff.length).toFixed(4)}/mi`);
console.log(`  sign flips:    ${(diff.filter(x=>x>0).length/diff.length*100).toFixed(0)}% of draws favour 2022`);
console.log(`  common-random-numbers cancellation: ${(100*(1-sd(diff)/sd(a))).toFixed(0)}% of level noise removed\n`);

// How much year-to-year signal exists at all? Neutralize the ONLY year-specific input.
const neutral = { ...d.constants, year_reliability_multipliers: { landmine:1, caution:1, sweet_spot:1, normal:1 } };
let spreadReal=0, spreadNeutral=0;
for (const veh of d.vehicles.slice(0,40)) {
  const ys:number[]=[], yn:number[]=[];
  for (let y=veh.first_year; y<=veh.last_year; y++) {
    const odo=(d.constants.now_year-y)*13_000;
    if (odo<0) continue;
    ys.push(costPerMile(veh, d.constants, {...inputs, buyOdo:odo}).p50);
    yn.push(costPerMile(veh, neutral,      {...inputs, buyOdo:odo}).p50);
  }
  if(ys.length>1){ spreadReal += (Math.max(...ys)-Math.min(...ys))/Math.min(...ys); spreadNeutral += (Math.max(...yn)-Math.min(...yn))/Math.min(...yn); }
}
console.log(`Across 40 cars, spread from cheapest to priciest model year:`);
console.log(`  with model_year_reliability active: ${(spreadReal/40*100).toFixed(1)}%`);
console.log(`  with it neutralized (odometer only): ${(spreadNeutral/40*100).toFixed(1)}%`);
