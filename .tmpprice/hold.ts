import { readFileSync } from "node:fs";
import { buyPointSweep } from "../packages/core/src/index.js";
import type { Vehicle, Constants } from "../packages/core/src/types.js";
const d = JSON.parse(readFileSync(new URL("../opencawr_data.json", import.meta.url), "utf8"));
const C: Constants = d.constants;
const MSRP: Record<string, number> = JSON.parse(readFileSync(new URL("./msrp.json", import.meta.url), "utf8"));
const anchored = (v: Vehicle): Vehicle => ({ ...v, price_vs_odometer_usd: { "0": MSRP[v.name]!, ...v.price_vs_odometer_usd } });
for (const hold of [100000, 150000] as const) {
  console.log(`\n=== buyPointSweep at FIXED holdMiles=${hold} ===`);
  console.log(["vehicle","ideal clamped","ideal anchored"].join("\t"));
  let zero = 0, n = 0;
  for (const v of d.vehicles as Vehicle[]) {
    if (!(v.name in MSRP)) continue;
    const a = buyPointSweep(v, C, { holdMiles: hold });
    const b = buyPointSweep(anchored(v), C, { holdMiles: hold });
    n++; if (b.idealOdo === 0) zero++;
    console.log([v.name, a.idealOdo, b.idealOdo].join("\t"));
  }
  console.log(`  argmin at 0 mi with anchor: ${zero}/${n}`);
}
