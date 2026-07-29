/** THROWAWAY. Counts NHTSA ODI defect investigations per seed vehicle from the
 *  public-domain ODI flat file (static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip).
 *  There is NO working per-vehicle investigations JSON endpoint on api.nhtsa.gov
 *  (investigationsByVehicle -> 403 "Missing Authentication Token";
 *  /investigations?make=..&model=.. returns 200 but silently ignores the filters
 *  and pages the entire 4,171-row corpus). The flat file's MODEL column uses
 *  BASE model names (VOLVO/XC60, not VOLVO/XC60 T5), unlike the complaints API. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedVehicles, NHTSA_NAME, yearsFor } from "./queries.js";
import { MATCHERS } from "./aliases.js";

const FLAT = process.argv[2]!;

function main() {
  const rows = readFileSync(FLAT, "utf8").split("\n");
  const vehicles = seedVehicles();
  // make -> [ {inv, model, year, component} ]
  const byMake = new Map<string, { inv: string; model: string; year: number; component: string }[]>();
  const wanted = new Set(vehicles.map((v) => NHTSA_NAME[v.name]!.make));
  for (const line of rows) {
    const f = line.split("\t");
    if (f.length < 5) continue;
    const make = f[1]!.toUpperCase();
    if (!wanted.has(make)) continue;
    const year = Number(f[3]);
    if (!Number.isFinite(year)) continue;
    const list = byMake.get(make) ?? [];
    list.push({ inv: f[0]!, model: f[2]!.toUpperCase(), year, component: f[4]!.toUpperCase() });
    byMake.set(make, list);
  }

  const out: Record<string, { investigations: number; matchedModels: string[]; byYear: Record<number, number> }> = {};
  for (const v of vehicles) {
    const q = NHTSA_NAME[v.name]!;
    const ys = new Set(yearsFor(v));
    const strict = MATCHERS[v.name]!;
    // Flat-file models are base names; fall back to a base-token prefix match.
    const baseToken = q.model.toUpperCase().replace(/ (HYBRID|PHEV|PRIME|EV|MHEV|PLUG-IN HYBRID|5DR)$/, "");
    const rowsForMake = byMake.get(q.make) ?? [];
    const pick = (m: string) => strict(m) || m === baseToken;
    const hits = rowsForMake.filter((r) => ys.has(r.year) && pick(r.model));
    const invIds = new Set(hits.map((h) => h.inv));
    const byYear: Record<number, number> = {};
    for (const y of ys) byYear[y] = new Set(hits.filter((h) => h.year === y).map((h) => h.inv)).size;
    out[v.name] = {
      investigations: invIds.size,
      matchedModels: [...new Set(hits.map((h) => h.model))].sort(),
      byYear,
    };
  }
  writeFileSync(join(import.meta.dirname, "data/investigations.json"), JSON.stringify(out, null, 1));
  for (const [name, r] of Object.entries(out)) {
    console.log(`${name.padEnd(30)} inv=${String(r.investigations).padStart(3)}  models=[${r.matchedModels.join(", ")}]`);
  }
}
main();
