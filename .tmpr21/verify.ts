/** Gate: the counterfactual copy must be bit-identical to the shipped engine
 *  with every switch off, across the whole seed field and every hold the
 *  investigation reports. Nothing else in .tmpr21 is trustworthy until this
 *  prints max |delta| = 0. */
import { readFileSync } from "node:fs";
import { costPerMile } from "../packages/core/src/engine.js";
import { costPerMileCf } from "./engine-cf.js";

const d = JSON.parse(readFileSync("./opencawr_data.json", "utf8"));
const c = d.constants;
const HOLDS: (number | "eol")[] = [25_000, 50_000, 100_000, 150_000, 200_000, "eol"];

let maxDelta = 0;
let n = 0;
let worst = "";
for (const v of d.vehicles) {
  for (const holdMiles of HOLDS) {
    const a = costPerMile(v, c, { holdMiles, draws: 400, seed: 42 });
    const b = costPerMileCf(v, c, { holdMiles, draws: 400, seed: 42 });
    const delta = Math.abs(a.p50 - b.p50);
    if (delta > maxDelta) {
      maxDelta = delta;
      worst = `${v.name} @ ${holdMiles}`;
    }
    // per-draw, not just the quantile
    for (let i = 0; i < a.drawsCpm.length; i++) {
      const dd = Math.abs(a.drawsCpm[i]! - b.cpm[i]!);
      if (dd > maxDelta) {
        maxDelta = dd;
        worst = `${v.name} @ ${holdMiles} draw ${i}`;
      }
    }
    n++;
  }
}
console.log(`counterfactual vs shipped: ${n} runs, ${d.vehicles.length} vehicles`);
console.log(`max |delta| = ${maxDelta.toExponential(3)}${worst ? `  (${worst})` : ""}`);
console.log(maxDelta === 0 ? "IDENTICAL — safe to proceed" : "NOT IDENTICAL — stop");
