/** THROWAWAY. Pulls NHTSA complaints + recalls for all 71 seed vehicles through
 *  the pipeline's own fetchCached (on-disk cache, 1 retry, 10s timeout). */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchCached, CACHE_DIR, urlHash } from "../packages/pipeline/src/fetchCached.js";
import { splitComponents } from "../packages/pipeline/src/sources/nhtsa.js";
import { seedVehicles, NHTSA_NAME, yearsFor } from "./queries.js";
import { MATCHERS } from "./aliases.js";

interface ModelsResponse { results?: { model: string }[] }
interface ComplaintsResponse { count?: number; results?: { odiNumber: number; components?: string }[] }
interface RecallsResponse { Count?: number; results?: { NHTSACampaignNumber: string; Component?: string }[] }

const UA = { "User-Agent": "opencawr-pipeline/0.1" };

let reqs = 0;
let fails = 0;
const failed: string[] = [];

async function get<T>(url: string): Promise<T | undefined> {
  try {
    const r = (await fetchCached(url, UA)) as T;
    reqs++;
    return r;
  } catch (e) {
    fails++;
    failed.push(`${url} :: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** FINDING: api.nhtsa.gov/recalls/recallsByVehicle answers HTTP **400** — with a
 *  perfectly well-formed `{"Count":0,"Message":"Results returned successfully",
 *  "results":[]}` body — whenever a make/model/year simply has no recalls.
 *  fetchCached's `if (!res.ok) throw` therefore turns "zero recalls" (a real,
 *  informative answer, ~15% of all model-years here) into a hard failure. Same
 *  on-disk cache dir/format so results stay reproducible. */
async function getRecalls(url: string): Promise<RecallsResponse | undefined> {
  const file = join(CACHE_DIR, `${urlHash(url)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).body as RecallsResponse;
  for (let attempt = 0; ; attempt++) {
   try {
    // FINDING 2: NHTSA's edge (Akamai) answers 403 "Access Denied" (HTML) to the
    // recalls endpoint when the request carries Node/undici's default UA. Any
    // ordinary UA string gets the real 400+JSON. fetchCached sends no UA at all.
    const res = await fetch(url, { headers: UA });
    const body = (await res.json()) as RecallsResponse;
    if (!res.ok && typeof body?.Count !== "number") throw new Error(`HTTP ${res.status}`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }, null, 2));
    reqs++;
    return body;
   } catch (e) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    fails++;
    failed.push(`${url} :: ${e instanceof Error ? e.message : e}`);
    return undefined;
   }
  }
}

const catalogueCache = new Map<string, string[]>();
async function catalogue(make: string, year: number): Promise<string[]> {
  const key = `${make}|${year}`;
  if (catalogueCache.has(key)) return catalogueCache.get(key)!;
  const res = await get<ModelsResponse>(
    `https://api.nhtsa.gov/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=c`,
  );
  const models = [...new Set((res?.results ?? []).map((r) => r.model.toUpperCase()))].sort();
  catalogueCache.set(key, models);
  return models;
}

export interface YearPull {
  year: number;
  matchedStrings: string[];
  complaints: number;
  powertrainComplaints: number;
  recalls: number;
  powertrainRecalls: number;
}
export interface VehiclePull {
  name: string;
  make: string;
  years: YearPull[];
}

const POWERTRAIN_PREFIXES = ["ENGINE", "POWER TRAIN", "TRANSMISSION"];
const isPt = (c: string) => POWERTRAIN_PREFIXES.some((p) => c.toUpperCase().startsWith(p));

async function pullVehicle(name: string, make: string, years: number[], match: (m: string) => boolean): Promise<VehiclePull> {
  const out: YearPull[] = [];
  for (const year of years) {
    const models = (await catalogue(make, year)).filter(match);
    const odi = new Map<number, string[]>();
    const campaigns = new Map<string, string>();
    for (const model of models) {
      const c = await get<ComplaintsResponse>(
        `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`,
      );
      for (const r of c?.results ?? []) odi.set(r.odiNumber, splitComponents(r.components ?? ""));
      const rc = await getRecalls(
        `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`,
      );
      for (const r of rc?.results ?? []) campaigns.set(r.NHTSACampaignNumber, r.Component ?? "");
    }
    out.push({
      year,
      matchedStrings: models,
      complaints: odi.size,
      powertrainComplaints: [...odi.values()].filter((cs) => cs.some(isPt)).length,
      recalls: campaigns.size,
      powertrainRecalls: [...campaigns.values()].filter((c) => splitComponents(c).some(isPt)).length,
    });
  }
  return { name, make, years: out };
}

async function main() {
  const vehicles = seedVehicles();
  const results: VehiclePull[] = [];
  let i = 0;
  const queue = vehicles.map((v) => ({ v, q: NHTSA_NAME[v.name]!, ys: yearsFor(v) }));
  const CONC = 2;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      for (;;) {
        const item = queue[i++];
        if (!item) return;
        const r = await pullVehicle(item.v.name, item.q.make, item.ys, MATCHERS[item.v.name]!);
        results.push(r);
        console.error(`  done ${r.name}`);
      }
    }),
  );
  mkdirSync(join(import.meta.dirname, "data"), { recursive: true });
  writeFileSync(join(import.meta.dirname, "data/pulled.json"), JSON.stringify(results, null, 1));
  console.error(`\nrequests: ${reqs}, failures: ${fails}`);
  for (const f of failed) console.error(`  FAILED ${f}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
