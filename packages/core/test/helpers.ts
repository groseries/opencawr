import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Constants, Vehicle } from "../src/types.js";

export interface ReferenceOutput {
  cost_per_mile_p50: number;
  p75: number;
  p90_badluck: number;
  band_p05: number;
  band_p95: number;
  stat_tier: number;
  beats_next_prob: number;
  opp_cost_lifetime_usd: number;
  opp_cost_per_mi: number;
}

export type SeedVehicle = Vehicle & {
  model_output: ReferenceOutput;
  model_output_prototype?: ReferenceOutput;
};

const here = dirname(fileURLToPath(import.meta.url));

export function loadSeedData(): {
  meta: { reference_engine?: { draws: number; seed: number } };
  constants: Constants;
  vehicles: SeedVehicle[];
} {
  const raw = JSON.parse(readFileSync(join(here, "../../../opencawr_data.json"), "utf8"));
  return { meta: raw.meta, constants: raw.constants, vehicles: raw.vehicles };
}
