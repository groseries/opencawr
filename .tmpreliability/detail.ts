/** THROWAWAY. Second pass over the SAME cached complaint responses: per-vehicle
 *  NHTSA component-category histogram + severity flags, so volume-invariant
 *  SHARE metrics can be tested. No new network traffic (cache hits only). */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR, urlHash } from "../packages/pipeline/src/fetchCached.js";
import { splitComponents } from "../packages/pipeline/src/sources/nhtsa.js";
import { seedVehicles, NHTSA_NAME, yearsFor } from "./queries.js";
import { MATCHERS } from "./aliases.js";

interface Complaint { odiNumber: number; components?: string; crash?: boolean; fire?: boolean; numberOfInjuries?: number; numberOfDeaths?: number }

function cached<T>(url: string): T | undefined {
  const f = join(CACHE_DIR, `${urlHash(url)}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")).body as T) : undefined;
}

const out: Record<string, { total: number; cats: Record<string, number>; crash: number; fire: number; injury: number }> = {};

for (const v of seedVehicles()) {
  const q = NHTSA_NAME[v.name]!;
  const match = MATCHERS[v.name]!;
  const seen = new Map<number, Complaint>();
  for (const year of yearsFor(v)) {
    const cat = cached<{ results?: { model: string }[] }>(
      `https://api.nhtsa.gov/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(q.make)}&issueType=c`,
    );
    const models = [...new Set((cat?.results ?? []).map((r) => r.model.toUpperCase()))].filter(match);
    for (const model of models) {
      const c = cached<{ results?: Complaint[] }>(
        `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(q.make)}&model=${encodeURIComponent(model)}&modelYear=${year}`,
      );
      for (const r of c?.results ?? []) seen.set(r.odiNumber, r);
    }
  }
  const cats: Record<string, number> = {};
  let crash = 0, fire = 0, injury = 0;
  for (const r of seen.values()) {
    for (const cat of new Set(splitComponents(r.components ?? ""))) {
      const top = cat.split(":")[0]!.trim().toUpperCase();
      cats[top] = (cats[top] ?? 0) + 1;
    }
    if (r.crash) crash++;
    if (r.fire) fire++;
    if ((r.numberOfInjuries ?? 0) > 0 || (r.numberOfDeaths ?? 0) > 0) injury++;
  }
  out[v.name] = { total: seen.size, cats, crash, fire, injury };
}

writeFileSync(join(import.meta.dirname, "data/detail.json"), JSON.stringify(out, null, 1));
const allCats = new Map<string, number>();
for (const r of Object.values(out)) for (const [k, n] of Object.entries(r.cats)) allCats.set(k, (allCats.get(k) ?? 0) + n);
console.log("Top NHTSA top-level component categories across the corpus:");
for (const [k, n] of [...allCats].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${String(n).padStart(6)}  ${k}`);
