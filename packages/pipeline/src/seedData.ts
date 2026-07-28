/** Loads opencawr_data.json for the segment-peer proxy fallback (spec: same pattern
 *  as packages/core/test/helpers.ts). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Constants, Vehicle } from "@opencawr/core";

const here = dirname(fileURLToPath(import.meta.url));

export function loadSeedData(): { constants: Constants; vehicles: Vehicle[] } {
  const raw = JSON.parse(readFileSync(join(here, "../../../opencawr_data.json"), "utf8"));
  return { constants: raw.constants, vehicles: raw.vehicles };
}
