import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Constants, Vehicle } from "../src/types.js";

export interface GoldenOutput {
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

export type SeedVehicle = Vehicle & { model_output: GoldenOutput };

const here = dirname(fileURLToPath(import.meta.url));

export function loadSeedData(): { constants: Constants; vehicles: SeedVehicle[] } {
  const raw = JSON.parse(readFileSync(join(here, "../../../opencawr_data.json"), "utf8"));
  return { constants: raw.constants, vehicles: raw.vehicles };
}

export function loadManifest() {
  return JSON.parse(readFileSync(join(here, "fidelity-manifest.json"), "utf8")) as {
    draws: number;
    seed: number;
    fleetMaeMax: Record<string, number>;
    cars: Record<string, Record<string, number>>;
    exactP50Snapshots: Record<string, number>;
  };
}

/** Golden rows whose opp-cost columns are provably from a different prototype run:
 *  both imply a 70k-mile horizon while every other car implies drive-to-death. */
export const OPP_COST_AUDIT_ROWS = new Set(["Porsche 996 Carrera", "Porsche 996 Turbo"]);
