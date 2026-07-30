#!/usr/bin/env node
/** npm run reliability-report -w @opencawr/pipeline [-- --write]
 *
 *  Re-derives reliability tiers (docs/reliability-methodology.md) for the FULL
 *  71-vehicle seed corpus from NHTSA complaint data and prints them against the
 *  current seed `reliability_tier`.
 *
 *  Default: read-only. `--write` applies the derived tiers to
 *  opencawr_data.json — a deliberate, owner-gated numbers-change event, since
 *  `reliability_tier` selects the repair-frequency/median-cost row in
 *  `constants.reliability_tiers` and the EOL dispersion σ. After writing, run
 *  `npm run gen-reference -w @opencawr/core`.
 *
 *  Agreement with the seed tier is printed as an OBSERVATION, not a score. The
 *  seed tier is the Consumer-Reports-derived judgment this derivation exists to
 *  replace, and it correlates with `eol_maintained_miles` at ρ = −0.838 and
 *  with `repair_cost_multiplier_by_make` at ρ = +0.602 — one judgment wearing
 *  three hats. High agreement would only prove we reproduced CR. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveReliability } from "./derive.js";
import { corpusQueries, KNOWN_EMPTY_MODEL_YEARS, MAPPING_NOTES } from "./corpus.js";
import { loadSeedData } from "../seedData.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(here, "../../../../opencawr_data.json");

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const { vehicles } = loadSeedData();
  const derivations = await deriveReliability(corpusQueries(vehicles));
  const seedTier = new Map(vehicles.map((v) => [v.name, v.reliability_tier]));
  const order = { low: 0, mid: 1, high: 2 } as const;

  console.log(
    "=== Reliability re-derivation — full seed corpus (NHTSA complaints, docs/reliability-methodology.md) ===\n",
  );
  const mainCuts = derivations.find((d) => d.reference === "main")?.cuts;
  const evCuts = derivations.find((d) => d.reference === "ev")?.cuts;
  console.log(
    `Cut points (percentiles of each reference group's own score distribution): ` +
      `main low <= ${mainCuts?.low.toFixed(4)} / high > ${mainCuts?.high.toFixed(4)}; ` +
      `EV low <= ${evCuts?.low.toFixed(4)} / high > ${evCuts?.high.toFixed(4)}\n`,
  );

  console.log(
    "vehicle".padEnd(30) +
      "etype".padEnd(8) +
      "years".padEnd(12) +
      "cplt".padStart(6) +
      "pt%".padStart(8) +
      "  derived  seed   move",
  );
  console.log("-".repeat(92));

  let agree = 0;
  let derived = 0;
  const moved2: string[] = [];
  const sorted = [...derivations].sort((a, b) => b.rawScore - a.rawScore);
  for (const d of sorted) {
    const seed = seedTier.get(d.name) ?? "?";
    const years = d.byYear.length > 0 ? `${d.byYear[0]!.year}-${d.byYear.at(-1)!.year}` : "-";
    let move = "—";
    if (d.tier) {
      derived++;
      const delta = order[d.tier] - (order[seed as keyof typeof order] ?? NaN);
      if (delta === 0) agree++;
      move = Number.isNaN(delta) ? "?" : delta === 0 ? "=" : delta > 0 ? `worse +${delta}` : `better ${delta}`;
      if (Math.abs(delta) >= 2) moved2.push(`${d.name}: ${seed} -> ${d.tier}`);
    }
    console.log(
      d.name.padEnd(30) +
        d.etype.padEnd(8) +
        years.padEnd(12) +
        String(d.evidence.complaints).padStart(6) +
        `${(d.rawScore * 100).toFixed(1)}%`.padStart(8) +
        "  " +
        (d.tier ?? "(carve-out)").padEnd(9) +
        String(seed).padEnd(7) +
        move +
        (d.evidence.provisional && d.tier ? "  [provisional]" : ""),
    );
  }

  console.log("-".repeat(92));
  console.log(
    `Observation only, NOT a success metric: ${agree}/${derived} derived tiers coincide with the seed tier.\n`,
  );
  if (moved2.length > 0) console.log(`Vehicles moving 2+ tiers: ${moved2.join("; ")}\n`);

  const provisional = derivations.filter((d) => d.tier && d.evidence.provisional);
  console.log(
    `Provisional (${provisional.length}): EVs (derived against an EV-only reference of 4 — an ordering, ` +
      `not a calibrated tier) and vehicles with < 100 pooled complaints:\n  ` +
      provisional.map((d) => `${d.name} (${d.evidence.complaints})`).join(", "),
  );
  const emptyYears = derivations.flatMap((d) =>
    d.byYear.filter((y) => y.matchedModels.length === 0).map((y) => `${d.name} MY${y.year}`),
  );
  console.log(
    `\nModel years with no matching NHTSA model string (${emptyYears.length}): ` +
      `${emptyYears.join(", ") || "(none)"}\n  Expected, per docs/investigations/2026-07-29-reliability-corpus.md §1.2: ${KNOWN_EMPTY_MODEL_YEARS.join(", ")}.`,
  );
  console.log(
    `\nAmbiguous NHTSA mappings, disclosed not resolved (${Object.keys(MAPPING_NOTES).length}): ` +
      `${Object.keys(MAPPING_NOTES).join(", ")}.`,
  );
  console.log(
    "\nHonest limits (methodology 'Known limitations'): complaint SHARE measures the mix of what owners " +
      "report, not a defect rate; within the gas vehicles alone the method scores barely above chance; " +
      "`make` is the dominant factor and is deliberately NOT normalized away; EV tiers rest on 4 vehicles.\n" +
      "Estimates, not advice.",
  );

  if (!write) {
    console.log(
      "\nRead-only. Re-run with `-- --write` to apply these tiers to opencawr_data.json " +
        "(a numbers-change event: follow with `npm run gen-reference -w @opencawr/core`).",
    );
    return;
  }

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as {
    vehicles: Array<{ name: string; reliability_tier: string }>;
  };
  let changed = 0;
  for (const v of raw.vehicles) {
    const d = derivations.find((x) => x.name === v.name);
    if (!d?.tier || d.tier === v.reliability_tier) continue;
    v.reliability_tier = d.tier;
    changed++;
  }
  writeFileSync(DATA_PATH, JSON.stringify(raw, null, 1), "utf8");
  console.log(`\nWROTE opencawr_data.json: ${changed} reliability_tier values changed.`);
  console.log("Now run: npm run gen-reference -w @opencawr/core");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
