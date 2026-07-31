#!/usr/bin/env node
/** npm run eol-report -w @opencawr/pipeline [-- --write]
 *
 *  Re-derives `eol_maintained_miles` (docs/reliability-methodology.md's
 *  sibling end-of-life estimate — see `derive-eol.ts`'s module docstring for
 *  the full survival-analysis method) for the FULL 71-vehicle seed corpus
 *  from free/keyless NY State DMV inspection data, and prints the derived
 *  values against the current seed `eol_maintained_miles`.
 *
 *  Default: read-only. `--write` applies the derived values to
 *  opencawr_data.json — a deliberate, owner-gated numbers-change event,
 *  since `eol_maintained_miles` anchors the odometer axis of the cost curve.
 *
 *  The 2 Porsche 996 rows are `derivable: false` in corpus-eol.ts (NY DMV
 *  cannot split 911 variants at all) and are the same `sport` owner
 *  carve-out that reliability re-derivation (report.ts) also never derives —
 *  skipped entirely, reported as skipped rather than as a failure.
 *
 *  Runs sequentially, one vehicle at a time (not in parallel across
 *  vehicles) to keep load on the free NY DMV endpoint low; everything goes
 *  through `fetchCached`'s on-disk cache, so a re-run only pays for
 *  previously-uncached URLs. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveEolForModel, deriveFleetContext, type EolDerivation, type EolQuery } from "./derive-eol.js";
import { eolQueryFor } from "./corpus-eol.js";
import { loadSeedData } from "../seedData.js";
import type { Vehicle } from "@opencawr/core";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(here, "../../../../opencawr_data.json");

function buildQueries(vehicles: Vehicle[]): { queries: EolQuery[]; skipped: string[] } {
  const queries: EolQuery[] = [];
  const skipped: string[] = [];
  for (const v of vehicles) {
    const entry = eolQueryFor(v.name);
    if (!entry.derivable) {
      skipped.push(v.name);
      continue;
    }
    queries.push({
      name: v.name,
      body: v.body,
      nameplate: { makeCode: entry.makeCode, modelNames: entry.modelNames },
      // Level 2 fallback: same make, EMPTY modelNames means "every model
      // this make sells" per ny-inspections.ts's sliceWhere (module docstring).
      make: { makeCode: entry.makeCode, modelNames: [] },
    });
  }
  return { queries, skipped };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const { vehicles } = loadSeedData();
  const { queries, skipped } = buildQueries(vehicles);
  const seedEol = new Map(vehicles.map((v) => [v.name, v.eol_maintained_miles]));

  console.log(
    "=== EOL mileage re-derivation — full seed corpus (NY DMV inspections, derive-eol.ts) ===\n",
  );
  console.log(`Building fleet context from ${queries.length} nameplates (shared across every vehicle)...`);
  const fleetContext = await deriveFleetContext(queries);
  console.log(
    `Fleet context: leakageCeiling=${fleetContext.leakageCeiling.toFixed(4)}  ` +
      `observedMedianAge=${fleetContext.fleetObservedMedianAge.toFixed(2)}yr (R^2=${fleetContext.fleetObservedR2.toFixed(4)})  ` +
      `mechanicalMedianAge=${fleetContext.fleetMechanicalMedianAge.toFixed(2)}yr (R^2=${fleetContext.fleetMechanicalR2.toFixed(4)})  ` +
      `maintainedBonus=${fleetContext.maintainedBonus.toFixed(4)}  ` +
      `fleetMechanicalMedianMiles=${Math.round(fleetContext.fleetMechanicalMedianLifetimeMiles)}\n`,
  );

  const derivations: EolDerivation[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    console.log(`[${i + 1}/${queries.length}] deriving ${q.name}...`);
    derivations.push(await deriveEolForModel(q, fleetContext));
  }

  console.log(
    "\n" +
      "vehicle".padEnd(30) +
      "seed".padStart(9) +
      "derived".padStart(9) +
      "delta".padStart(9) +
      "delta%".padStart(8) +
      "  " +
      "basis".padEnd(10) +
      "r2".padStart(7) +
      "pts".padStart(5) +
      "c".padStart(8) +
      "±se%".padStart(7) +
      "leak".padStart(8) +
      "relRate".padStart(9) +
      "nOdo".padStart(5),
  );
  console.log("-".repeat(126));

  const rows: Array<{ name: string; seed: number; derived: number; delta: number; deltaPct: number }> = [];
  for (const d of derivations) {
    const seed = seedEol.get(d.name)!;
    const derived = Math.round(d.eolMiles!);
    const delta = derived - seed;
    const deltaPct = (delta / seed) * 100;
    rows.push({ name: d.name, seed, derived, delta, deltaPct });
    console.log(
      d.name.padEnd(30) +
        String(seed).padStart(9) +
        String(derived).padStart(9) +
        (delta >= 0 ? `+${delta}` : String(delta)).padStart(9) +
        `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`.padStart(8) +
        "  " +
        d.basis.padEnd(10) +
        (d.r2 !== null ? d.r2.toFixed(3) : "  n/a").padStart(7) +
        String(d.evidence.usableSurvivalPoints).padStart(5) +
        (d.ratioToFleet !== null && d.medianAge !== null
          ? Math.pow(d.ratioToFleet, -fleetContext.fleetMechanicalK).toFixed(3)
          : "  n/a"
        ).padStart(8) +
        (d.evidence.relativeSlopeSe !== null
          ? `${(d.evidence.relativeSlopeSe * 100).toFixed(0)}%`
          : "n/a"
        ).padStart(7) +
        (d.evidence.leakHazard !== null ? d.evidence.leakHazard.toFixed(4) : " n/a").padStart(8) +
        d.relativeRate.toFixed(3).padStart(9) +
        String(d.evidence.rateAges).padStart(5) +
        (d.provisional ? "  [provisional]" : ""),
    );
  }
  console.log("-".repeat(126));

  console.log(`\nSkipped (${skipped.length}, sport carve-out, not derivable from NY DMV): ${skipped.join(", ")}`);

  const basisCounts = { nameplate: 0, make: 0, fleet: 0 };
  for (const d of derivations) basisCounts[d.basis]++;
  const provisionalCount = derivations.filter((d) => d.provisional).length;
  console.log(
    `\nBasis breakdown (${derivations.length} resolved): nameplate=${basisCounts.nameplate}  ` +
      `make=${basisCounts.make}  fleet=${basisCounts.fleet}`,
  );
  console.log(
    `Provisional (${provisionalCount}): basis != nameplate, winning fit's R^2 < 0.85, ` +
      `or no measurable mileage-accumulation rate.`,
  );
  console.log(
    `Class mean rate ratio (Step 7 normaliser): car=${fleetContext.classMeanRateRatio.car.toFixed(4)}  ` +
      `light-truck=${fleetContext.classMeanRateRatio["light-truck"].toFixed(4)}`,
  );

  const absDeltas = rows.map((r) => Math.abs(r.delta));
  const maxRow = rows.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
  console.log(
    `\nAbsolute change vs seed (miles): mean=${Math.round(mean(absDeltas))}  ` +
      `median=${Math.round(median(absDeltas))}  max=${Math.round(Math.abs(maxRow.delta))} (${maxRow.name}, seed ${maxRow.seed} -> ${maxRow.derived})`,
  );
  console.log(
    `\nDerived maintainedBonus=${fleetContext.maintainedBonus.toFixed(4)} (legacy seed assumption: 1.30). ` +
      `Fleet observed median age=${fleetContext.fleetObservedMedianAge.toFixed(2)}yr vs. mechanical median age=` +
      `${fleetContext.fleetMechanicalMedianAge.toFixed(2)}yr.`,
  );

  if (!write) {
    console.log(
      "\nRead-only. Re-run with `-- --write` to apply these values to opencawr_data.json " +
        "(a numbers-change event: follow with `npm run gen-reference -w @opencawr/core`).",
    );
    return;
  }

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as {
    vehicles: Array<{ name: string; eol_maintained_miles: number }>;
  };
  let changed = 0;
  for (const v of raw.vehicles) {
    const row = rows.find((r) => r.name === v.name);
    if (!row || row.derived === v.eol_maintained_miles) continue;
    v.eol_maintained_miles = row.derived;
    changed++;
  }
  writeFileSync(DATA_PATH, JSON.stringify(raw, null, 1), "utf8");
  console.log(`\nWROTE opencawr_data.json: ${changed} eol_maintained_miles values changed.`);
  console.log("Now run: npm run gen-reference -w @opencawr/core");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
