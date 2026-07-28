/** Dev-only: records real API responses into test/fixtures/, keyed by the
 *  same URL hash fetchCached() uses, so offline tests/CLI replay them
 *  exactly. Run with network access: `npm run record-fixtures -w @opencawr/pipeline`.
 *  NHTSA complaint responses are trimmed to {count, results:[{odiNumber}]}
 *  before being written — we never persist complaint text/VINs, even in
 *  recorded fixtures. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { urlHash, FIXTURE_DIR } from "../src/fetchCached.js";

const here = dirname(fileURLToPath(import.meta.url));
void here;

interface IndexRow {
  hash: string;
  url: string;
  note: string;
}
const index: IndexRow[] = [];

async function record(url: string, note: string, transform?: (body: unknown) => unknown): Promise<void> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  let body = await res.json();
  if (transform) body = transform(body);
  const hash = urlHash(url);
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(
    join(FIXTURE_DIR, `${hash}.json`),
    JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }, null, 2),
  );
  index.push({ hash, url, note });
  console.log(`recorded ${hash}  ${note}`);
}

function menuUrl(year: number, make: string, model: string): string {
  const params = new URLSearchParams({ year: String(year), make, model });
  return `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?${params.toString()}`;
}
function detailUrl(id: string): string {
  return `https://www.fueleconomy.gov/ws/rest/vehicle/${id}`;
}
function complaintsUrl(make: string, model: string, modelYear: number): string {
  const params = new URLSearchParams({ make, model, modelYear: String(modelYear) });
  return `https://api.nhtsa.gov/complaints/complaintsByVehicle?${params.toString()}`;
}
function modelsForMakeUrl(make: string): string {
  return `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/${encodeURIComponent(make)}?format=json`;
}

function trimComplaints(body: unknown): unknown {
  const b = body as { count: number; results?: { odiNumber: number }[] };
  return { count: b.count, results: (b.results ?? []).map((r) => ({ odiNumber: r.odiNumber })) };
}

async function main(): Promise<void> {
  // --- EPA adapter mapping test fixture (brief: "Toyota Camry 2020") ---
  await record(menuUrl(2020, "Toyota", "Camry"), "EPA menu options: Toyota Camry 2020");
  await record(detailUrl("42011"), "EPA vehicle detail: Toyota Camry 2020 (Auto S8 3.5L V6)");

  // --- PHEV adapter mapping test fixture (code review follow-up) ---
  await record(menuUrl(2019, "Chevrolet", "Volt"), "EPA menu options: Chevrolet Volt 2019 (PHEV)");
  await record(detailUrl("40924"), "EPA vehicle detail: Chevrolet Volt 2019 (PHEV)");

  // --- Honda Fit: assemble()/CLI demo, default 10-year window ---
  const currentYear = new Date().getFullYear();
  for (let year = currentYear - 9; year <= currentYear; year++) {
    await record(menuUrl(year, "Honda", "Fit"), `EPA menu options: Honda Fit ${year}`);
  }
  await record(detailUrl("42395"), "EPA vehicle detail: Honda Fit 2020 (Automatic AV-S7)");

  await record(modelsForMakeUrl("Honda"), "VPIC getmodelsformake: Honda");

  for (const year of [2017, 2018, 2019, 2020]) {
    await record(
      complaintsUrl("Honda", "Fit", year),
      `NHTSA complaintsByVehicle: Honda Fit ${year} (trimmed to odiNumber only)`,
      trimComplaints,
    );
  }

  // --- Segment-peer size-tier lookups (proxy.ts pickProxyPeer): each seed
  // Car+gas peer's real EPA VClass, at the peer's own pinned_buy_year_est,
  // so offline tests reproduce the same size-tier pre-filter as production.
  // Honda Civic / Mazda3 / Kia K4 deliberately excluded: real, live-verified
  // EPA data gaps (bare "Civic"/"3"/"K4" model strings return no data) or
  // (K4) not eligible anyway since it's itself provenance:"proxied" — the
  // absent fixture + peerSizeTier's try/catch correctly resolves them to
  // "unknown" both offline and live.
  const peerLookups: Array<[string, string, number, string]> = [
    ["Toyota", "Corolla", 2022, "Toyota Corolla"],
    ["Hyundai", "Elantra", 2023, "Hyundai Elantra"],
    ["Honda", "Accord", 2021, "Honda Accord"],
    ["Hyundai", "Sonata", 2021, "Hyundai Sonata"],
    ["Fiat", "500", 2019, "Fiat 500"],
    ["Volkswagen", "Passat", 2022, "VW Passat"],
    ["MINI", "Cooper Hardtop 2 Door", 2023, "Mini Cooper"],
    ["Volkswagen", "GTI", 2021, "VW GTI"],
  ];
  for (const [make, model, year, label] of peerLookups) {
    await record(menuUrl(year, make, model), `EPA menu options: ${label} ${year} (peer size-tier lookup)`);
  }
  // one representative trim id per peer, taken from the menu responses above
  const peerDetailIds: Array<[string, string]> = [
    ["44074", "Toyota Corolla 2022"],
    ["45296", "Hyundai Elantra 2023"],
    ["43361", "Honda Accord 2021"],
    ["43456", "Hyundai Sonata 2021"],
    ["41148", "Fiat 500 2019"],
    ["44136", "VW Passat 2022"],
    ["45227", "Mini Cooper 2023"],
    ["43244", "VW GTI 2021"],
  ];
  for (const [id, label] of peerDetailIds) {
    await record(detailUrl(id), `EPA vehicle detail: ${label} (peer size-tier lookup)`);
  }

  writeFileSync(join(FIXTURE_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${index.length} fixtures + index.json to ${FIXTURE_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
