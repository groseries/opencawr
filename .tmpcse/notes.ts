import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { impliedModelYear } from "../packages/core/src/feasibility.js";
const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c = d.constants;
let n = 0;
for (const v of d.vehicles as any[]) {
  const r = costPerMile(v, c, { annualMiles: 13000, holdMiles: 100000, draws: 200, seed: 42 });
  const y = Math.round(impliedModelYear(r.buyOdo, 13000, c.now_year));
  if (y > v.last_year || y < v.first_year) n++;
}
console.log(`feasNote at the OLD default buy odometer (pinned_buy_odo): ${n}/${(d.vehicles as any[]).length}`);
