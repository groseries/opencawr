/** THROWAWAY. Validates every seed vehicle's NHTSA make/model string against
 *  NHTSA's own model catalogue for each queried model year. Reports any query
 *  string NHTSA does not list. */
import { fetchCached } from "../packages/pipeline/src/fetchCached.js";
import { seedVehicles, NHTSA_NAME, yearsFor } from "./queries.js";

interface ModelsResponse {
  count: number;
  results?: { modelYear: string; make: string; model: string }[];
}

async function modelsFor(make: string, year: number): Promise<Set<string>> {
  const url = `https://api.nhtsa.gov/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=c`;
  const res = (await fetchCached(url)) as ModelsResponse;
  return new Set((res.results ?? []).map((r) => r.model.toUpperCase()));
}

async function main() {
  const vehicles = seedVehicles();
  const need = new Map<string, number[]>();
  for (const v of vehicles) {
    const q = NHTSA_NAME[v.name];
    if (!q) continue;
    const ys = need.get(q.make) ?? [];
    need.set(q.make, [...new Set([...ys, ...yearsFor(v)])]);
  }
  const catalogue = new Map<string, Set<string>>();
  let reqs = 0;
  let fails = 0;
  for (const [make, years] of need) {
    for (const y of years) {
      try {
        catalogue.set(`${make}|${y}`, await modelsFor(make, y));
        reqs++;
      } catch (e) {
        fails++;
        console.error(`FAIL ${make} ${y}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.log(`# catalogue requests: ${reqs}, failures: ${fails}\n`);

  for (const v of vehicles) {
    const q = NHTSA_NAME[v.name];
    const ys = yearsFor(v);
    if (!q) {
      console.log(`UNMAPPED  ${v.name}`);
      continue;
    }
    const missing = ys.filter((y) => !catalogue.get(`${q.make}|${y}`)?.has(q.model.toUpperCase()));
    const status = missing.length === 0 ? "ok" : missing.length === ys.length ? "NONE" : "partial";
    if (status !== "ok") {
      const all = new Set<string>();
      for (const y of ys) for (const m of catalogue.get(`${q.make}|${y}`) ?? []) all.add(m);
      const near = [...all].filter((m) => {
        const t = q.model.toUpperCase().split(/[\s-]/)[0]!;
        return m.includes(t) || t.includes(m.split(/[\s-]/)[0]!);
      });
      console.log(
        `${status.padEnd(8)} ${v.name.padEnd(30)} ${q.make}/${q.model} yrs=${ys[0]}-${ys[ys.length - 1]} missing=[${missing.join(",")}] candidates=[${near.slice(0, 12).join(" | ")}]`,
      );
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
