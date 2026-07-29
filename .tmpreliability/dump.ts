/** THROWAWAY. Dumps NHTSA's model catalogue per (make, year) so alias lists can be built. */
import { fetchCached } from "../packages/pipeline/src/fetchCached.js";
import { seedVehicles, NHTSA_NAME, yearsFor } from "./queries.js";

interface ModelsResponse { results?: { model: string }[] }

async function main() {
  const [filterMake, filterTok] = [process.argv[2]?.toUpperCase(), process.argv[3]?.toUpperCase()];
  const vehicles = seedVehicles();
  const need = new Map<string, Set<number>>();
  for (const v of vehicles) {
    const q = NHTSA_NAME[v.name]!;
    const s = need.get(q.make) ?? new Set<number>();
    for (const y of yearsFor(v)) s.add(y);
    need.set(q.make, s);
  }
  for (const [make, years] of need) {
    if (filterMake && make !== filterMake) continue;
    for (const y of [...years].sort()) {
      const url = `https://api.nhtsa.gov/products/vehicle/models?modelYear=${y}&make=${encodeURIComponent(make)}&issueType=c`;
      const res = (await fetchCached(url)) as ModelsResponse;
      const models = [...new Set((res.results ?? []).map((r) => r.model.toUpperCase()))].sort();
      const shown = filterTok ? models.filter((m) => m.includes(filterTok)) : models;
      console.log(`${make} ${y}: ${shown.join(" | ")}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
