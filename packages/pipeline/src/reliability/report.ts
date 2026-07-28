#!/usr/bin/env node
/** npm run reliability-report -w @opencawr/pipeline
 *  Re-derives reliability tiers (docs/reliability-methodology.md) for the 6
 *  seed models named in the Task D brief and prints them against the current
 *  seed `reliability_tier` in an agreement table. This is a VALIDATION
 *  REPORT, not a data migration: opencawr_data.json is read, never written —
 *  rewriting seed tiers is an owner review gate (ASSUMPTIONS.md §D/§E). */
import { deriveReliability, type ReliabilityQuery } from "./derive.js";
import { loadSeedData } from "../seedData.js";

const QUERIES: ReliabilityQuery[] = [
  { name: "Toyota Corolla", make: "Toyota", model: "Corolla", body: "Car", years: [2018, 2019, 2020, 2021, 2022] },
  { name: "Mazda CX-5", make: "Mazda", model: "CX-5", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
  { name: "Kia Sorento", make: "Kia", model: "Sorento", body: "SUV AWD", years: [2018, 2019, 2020, 2021, 2022] },
  { name: "Ford Escape", make: "Ford", model: "Escape", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
  { name: "Honda Odyssey", make: "Honda", model: "Odyssey", body: "Van", years: [2018, 2019, 2020, 2021, 2022] },
  { name: "Fiat 500", make: "Fiat", model: "500", body: "Car", years: [2015, 2016, 2017, 2018, 2019] },
];

async function main(): Promise<void> {
  const { vehicles } = loadSeedData();
  const derivations = await deriveReliability(QUERIES);

  console.log("=== Reliability re-derivation (NHTSA complaints, docs/reliability-methodology.md) ===\n");
  console.log(
    "Model".padEnd(18) + "Derived".padEnd(10) + "Seed".padEnd(8) + "Agree".padEnd(8) + "Landmine years",
  );
  console.log("-".repeat(70));

  let agree = 0;
  for (const d of derivations) {
    const seedTier = vehicles.find((v) => v.name === d.name)?.reliability_tier ?? "?";
    const match = d.tier === seedTier;
    if (match) agree++;
    console.log(
      d.name.padEnd(18) +
        d.tier.padEnd(10) +
        String(seedTier).padEnd(8) +
        (match ? "yes".padEnd(8) : "NO".padEnd(8)) +
        (d.landmineYears.length > 0 ? d.landmineYears.join(", ") : "(none)"),
    );
  }

  console.log("-".repeat(70));
  console.log(`Agreement: ${agree}/${derivations.length} derived tiers match the current seed tier.\n`);
  console.log(
    "Caveat: singleton body classes (SUV AWD, Van) pin to bodyClassIndex 1.0 and shift the shared " +
      "quartile cuts for every model above (docs/reliability-methodology.md §3, ASSUMPTIONS.md §G).\n",
  );
  console.log(
    "Estimates, not advice. DO NOT rewrite opencawr_data.json from this report — " +
      "seed reliability data remains pending re-derivation (owner review gate; see ASSUMPTIONS.md §D/§E).",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
