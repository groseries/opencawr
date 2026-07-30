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
import { corpusQueries } from "../src/reliability/corpus.js";
import { modelsForYear } from "../src/sources/nhtsa.js";

const here = dirname(fileURLToPath(import.meta.url));
void here;

interface IndexRow {
  hash: string;
  url: string;
  note: string;
}
const index: IndexRow[] = [];

async function record(
  url: string,
  note: string,
  transform?: (body: unknown) => unknown,
  /** NHTSA answers HTTP 400 with a valid `{"count":0,...,"results":[]}` body
   *  when a make/model/year has no data — e.g. any model string it doesn't
   *  list for that year. That is a real answer worth recording, not a failure. */
  acceptNonOkJson = false,
): Promise<void> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok && !acceptNonOkJson) throw new Error(`${url} -> HTTP ${res.status}`);
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
  const b = body as { count: number; results?: { odiNumber: number; components?: string }[] };
  return {
    count: b.count,
    results: (b.results ?? []).map((r) => ({ odiNumber: r.odiNumber, components: r.components ?? "" })),
  };
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

  // --- Task D: reliability re-derivation, 6 seed models spanning tiers
  // (Corolla/CX-5 = low, Odyssey/Sorento = mid, Escape/Fiat 500 = high).
  // NHTSA's complaints API is slow (10-30s/request); fetch this batch
  // concurrently instead of record()'s usual sequential await.
  const reliabilityModels: Array<[string, string, number[]]> = [
    ["Toyota", "Corolla", [2018, 2019, 2020, 2021, 2022]],
    ["Mazda", "CX-5", [2018, 2019, 2020, 2021, 2022]],
    ["Kia", "Sorento", [2018, 2019, 2020, 2021, 2022]],
    ["Ford", "Escape", [2018, 2019, 2020, 2021, 2022]],
    ["Honda", "Odyssey", [2018, 2019, 2020, 2021, 2022]],
    ["Fiat", "500", [2015, 2016, 2017, 2018, 2019]], // discontinued after MY2019
  ];
  const reliabilityJobs: Array<() => Promise<void>> = [];
  for (const [make, model, years] of reliabilityModels) {
    for (const year of years) {
      reliabilityJobs.push(async () => {
        const url = complaintsUrl(make, model, year);
        const note = `NHTSA complaintsByVehicle: ${make} ${model} ${year} (reliability re-derivation, trimmed to odiNumber+components)`;
        for (let attempt = 1; ; attempt++) {
          try {
            await record(url, note, trimComplaints);
            return;
          } catch (err) {
            if (attempt >= 4) throw err;
            console.error(`retrying (${attempt}/3) after: ${err instanceof Error ? err.message : err}`);
          }
        }
      });
    }
  }
  // NHTSA's complaints API 504s under high concurrency; run a small pool instead of all-at-once.
  const CONCURRENCY = 3;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < reliabilityJobs.length) {
        const job = reliabilityJobs[cursor++]!;
        await job();
      }
    }),
  );

  // --- Full-corpus reliability re-derivation (launch gate): the Volvo trio is
  // the regression case for NHTSA's trim-fragmented, year-inconsistent model
  // catalogue. There is never a bare `XC90` string in the window (the bare
  // query 400s with count 0 — recorded below as the pin), and `XC90 T5` and
  // `XC90 T6` return the SAME complaints, so both the per-year catalogue and
  // every matched string are needed to prove catalogue resolution AND ODI
  // de-duplication. Matchers come from corpus.ts so they can't drift.
  const volvoQueries = corpusQueries().filter((q) => q.make === "VOLVO");
  for (const year of [2017, 2018, 2019, 2020, 2021, 2022]) {
    await record(
      `https://api.nhtsa.gov/products/vehicle/models?${new URLSearchParams({
        modelYear: String(year),
        make: "VOLVO",
        issueType: "c",
      })}`,
      `NHTSA model catalogue: Volvo ${year}`,
    );
    const catalogue = await modelsForYear("VOLVO", year);
    const models = new Set(
      volvoQueries.filter((q) => q.years.includes(year)).flatMap((q) => catalogue.filter(q.matchesModel)),
    );
    for (const model of [...models].sort()) {
      await record(
        complaintsUrl("VOLVO", model, year),
        `NHTSA complaintsByVehicle: Volvo ${model} ${year} (full-corpus re-derivation, trimmed to odiNumber+components)`,
        trimComplaints,
      );
    }
  }
  await record(
    complaintsUrl("VOLVO", "XC90", 2017),
    "NHTSA complaintsByVehicle: bare 'XC90' 2017 — the single model string the pre-catalogue " +
      "pipeline used. NHTSA does not list it for that year and answers HTTP 400 with count 0.",
    trimComplaints,
    true,
  );

  writeFileSync(join(FIXTURE_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${index.length} fixtures + index.json to ${FIXTURE_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
