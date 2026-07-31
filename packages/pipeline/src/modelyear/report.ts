#!/usr/bin/env node
/** npm run model-year-report -w @opencawr/pipeline [-- --write]
 *
 *  Derives R2's per-model-year descriptive facts
 *  (docs/model-year-detail-methodology.md) for the FULL 71-vehicle seed
 *  corpus from EPA fueleconomy.gov (drivetrain) + the reliability
 *  derivation's own NHTSA complaint-component fetch (dominant complaint
 *  category), and prints a compact per-vehicle summary.
 *
 *  Default: read-only. `--write` applies the full `Record<string,
 *  ModelYearDetail>` under `model_year_detail` for every seed vehicle into
 *  opencawr_data.json.
 *
 *  UNLIKE the reliability report, **this is NOT a numbers-change event**:
 *  `model_year_detail` is purely descriptive and is never read by
 *  `costPerMile` (packages/core/src/engine.ts) — writing it changes zero
 *  $/mi output, so no `npm run gen-reference -w @opencawr/core` re-run is
 *  needed afterward. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelYearDetail } from "@opencawr/core";
import { fetchModelYearDetail } from "./deriveModelYearDetail.js";
import { loadSeedData } from "../seedData.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(here, "../../../../opencawr_data.json");

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const { vehicles } = loadSeedData();

  console.log(
    "=== Model-year detail derivation — full seed corpus (EPA drivetrain + NHTSA complaint " +
      "category, docs/model-year-detail-methodology.md) ===\n",
  );
  console.log(
    "vehicle".padEnd(30) +
      "years".padEnd(12) +
      "drivetrain".padStart(11) +
      "specChg".padStart(9) +
      "topCplt".padStart(9),
  );
  console.log("-".repeat(71));

  const results: Array<{ name: string; detail: Record<string, ModelYearDetail> }> = [];
  for (const vehicle of vehicles) {
    const detail = await fetchModelYearDetail(vehicle);
    results.push({ name: vehicle.name, detail });
    const years = Object.keys(detail);
    const withDrivetrain = years.filter((y) => detail[y]!.drivetrain !== null).length;
    const specChanges = years.filter((y) => detail[y]!.specChangeFromPriorYear).length;
    const withComplaint = years.filter((y) => detail[y]!.topComplaintCategory !== null).length;
    console.log(
      vehicle.name.padEnd(30) +
        `${vehicle.first_year}-${vehicle.last_year}`.padEnd(12) +
        String(withDrivetrain).padStart(11) +
        String(specChanges).padStart(9) +
        String(withComplaint).padStart(9),
    );
  }

  console.log("-".repeat(71));
  console.log(
    "\nNOT a numbers-change event: model_year_detail is never read by costPerMile, so writing it " +
      "changes zero $/mi output — no gen-reference re-run is needed.",
  );

  if (!write) {
    console.log(
      "\nRead-only. Re-run with `-- --write` to apply model_year_detail to opencawr_data.json " +
        "(still not a numbers-change event — no gen-reference re-run needed).",
    );
    return;
  }

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as {
    vehicles: Array<{ name: string; model_year_detail?: Record<string, ModelYearDetail> }>;
  };
  let changed = 0;
  for (const v of raw.vehicles) {
    const r = results.find((x) => x.name === v.name);
    if (!r) continue;
    v.model_year_detail = r.detail;
    changed++;
  }
  writeFileSync(DATA_PATH, JSON.stringify(raw, null, 1), "utf8");
  console.log(`\nWROTE opencawr_data.json: model_year_detail populated for ${changed} vehicles.`);
  console.log("This is NOT a numbers-change event — no gen-reference re-run is needed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
