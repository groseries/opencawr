#!/usr/bin/env node
/** npm run assemble -w @opencawr/pipeline -- "Honda" "Fit"
 *  Assembles a vehicle from EPA/NHTSA + segment-peer proxy, prints it with
 *  its provenance table, then runs it through the ONE cost engine to prove
 *  the pipeline's output actually feeds costPerMile. Estimates, not advice. */
import { costPerMile } from "@opencawr/core";
import { assembleVehicle } from "./assemble.js";
import { loadSeedData } from "./seedData.js";
import { validateVehicleShape } from "./schema.js";

async function main(): Promise<void> {
  const [make, model] = process.argv.slice(2);
  if (!make || !model) {
    console.error('Usage: npm run assemble -w @opencawr/pipeline -- "<make>" "<model>"');
    process.exit(1);
  }

  const { vehicle, report } = await assembleVehicle({ make, model });

  const problems = validateVehicleShape(vehicle);
  if (problems.length > 0) {
    console.error("Assembled vehicle failed schema check:", problems);
    process.exit(1);
  }

  console.log("=== Assembled vehicle ===");
  console.log(JSON.stringify(vehicle, null, 2));

  console.log("\n=== Provenance ===");
  for (const entry of report) {
    // Spec §9's Consumer-Reports gate is cleared for the 71 SEED vehicles
    // (docs/reliability-methodology.md). An assembled vehicle is not one of
    // them: its tier is copied from a segment peer and its model-year flags
    // come from the placeholder heuristic, neither of which is the derivation.
    const flag = entry.launchBlocked ? " [NOT DERIVED: proxy/placeholder reliability]" : "";
    console.log(`  [${entry.source}] ${entry.field}: ${entry.detail}${flag}`);
  }

  const { constants } = loadSeedData();
  const result = costPerMile(vehicle, constants);
  console.log("\n=== Engine result (estimate, not advice) ===");
  console.log(`  p50: $${result.p50.toFixed(4)}/mi`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
