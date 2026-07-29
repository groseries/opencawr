/** THROWAWAY analysis scratch (not part of the build). Builds the full 71-vehicle
 *  NHTSA query set from opencawr_data.json. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");

export interface SeedVehicle {
  name: string;
  make: string;
  body: string;
  etype: string;
  first_year: number;
  last_year: number;
  reliability_tier: string;
  provenance: string;
  eol_maintained_miles: number;
  repair_cost_multiplier_by_make: number;
  battery?: unknown;
  specs: Record<string, number | null>;
}

export function seedVehicles(): SeedVehicle[] {
  const d = JSON.parse(readFileSync(join(ROOT, "opencawr_data.json"), "utf8"));
  return d.vehicles as SeedVehicle[];
}

/** NHTSA make/model strings for each seed vehicle name. `null` model = deliberately
 *  unmappable. Resolved against api.nhtsa.gov/products/vehicle/models (see resolve.ts). */
export const NHTSA_NAME: Record<string, { make: string; model: string; note?: string }> = {
  "Chevy Bolt EV": { make: "CHEVROLET", model: "BOLT EV" },
  "Chevy Volt": { make: "CHEVROLET", model: "VOLT" },
  "Toyota Prius (hybrid)": { make: "TOYOTA", model: "PRIUS", note: "excludes PRIUS PRIME/PRIUS V/PRIUS C, which NHTSA lists separately" },
  "Toyota Prius Prime": { make: "TOYOTA", model: "PRIUS PRIME" },
  "Toyota Corolla": { make: "TOYOTA", model: "COROLLA", note: "excludes COROLLA HATCHBACK / COROLLA CROSS / COROLLA IM" },
  "Toyota Camry Hybrid": { make: "TOYOTA", model: "CAMRY HYBRID" },
  "Honda Civic": { make: "HONDA", model: "CIVIC" },
  "Nissan Leaf": { make: "NISSAN", model: "LEAF" },
  "Hyundai Elantra": { make: "HYUNDAI", model: "ELANTRA" },
  "Honda Accord": { make: "HONDA", model: "ACCORD" },
  "Kia K4": { make: "KIA", model: "K4", note: "MY2025+; seed vehicle is already provenance=proxied" },
  "Mazda3 (SkyActiv)": { make: "MAZDA", model: "MAZDA3" },
  "Toyota Camry": { make: "TOYOTA", model: "CAMRY", note: "NHTSA lists CAMRY and CAMRY HYBRID separately for these years" },
  "Toyota RAV4 Hybrid": { make: "TOYOTA", model: "RAV4 HYBRID" },
  "Kia Niro (hybrid)": { make: "KIA", model: "NIRO", note: "NHTSA NIRO pools HEV/PHEV/EV trims for most years" },
  "Tesla Model 3": { make: "TESLA", model: "MODEL 3" },
  "Hyundai Sonata": { make: "HYUNDAI", model: "SONATA" },
  "Toyota RAV4": { make: "TOYOTA", model: "RAV4" },
  "Fiat 500": { make: "FIAT", model: "500" },
  "Honda CR-V": { make: "HONDA", model: "CR-V" },
  "VW ID.4 (AWD avail)": { make: "VOLKSWAGEN", model: "ID.4" },
  "Toyota RAV4 Prime": { make: "TOYOTA", model: "RAV4 PRIME" },
  "Kia Soul": { make: "KIA", model: "SOUL" },
  "VW Passat": { make: "VOLKSWAGEN", model: "PASSAT" },
  "Buick Encore": { make: "BUICK", model: "ENCORE" },
  "Hyundai Kona": { make: "HYUNDAI", model: "KONA" },
  "Mazda CX-5": { make: "MAZDA", model: "CX-5" },
  "Toyota Highlander Hybrid": { make: "TOYOTA", model: "HIGHLANDER HYBRID" },
  "Subaru Outback": { make: "SUBARU", model: "OUTBACK" },
  "Subaru Forester": { make: "SUBARU", model: "FORESTER" },
  "Toyota Sienna Hybrid": { make: "TOYOTA", model: "SIENNA", note: "MY2021+ Sienna is hybrid-only, so SIENNA == Sienna Hybrid for the queried years" },
  "Toyota Tacoma": { make: "TOYOTA", model: "TACOMA" },
  "Nissan Rogue": { make: "NISSAN", model: "ROGUE", note: "excludes ROGUE SPORT / ROGUE SELECT" },
  "Chevy Equinox": { make: "CHEVROLET", model: "EQUINOX" },
  "Toyota Sienna (V6)": { make: "TOYOTA", model: "SIENNA", note: "same NHTSA model string as Sienna Hybrid; disambiguated ONLY by year window (<=2020 = V6)" },
  "Mini Cooper": { make: "MINI", model: "COOPER" },
  "Ford Ranger (old compact)": { make: "FORD", model: "RANGER", note: "same NHTSA model string as the 2019+ midsize; disambiguated ONLY by year window" },
  "Fiat 500X": { make: "FIAT", model: "500X" },
  "VW GTI": { make: "VOLKSWAGEN", model: "GOLF GTI" },
  "Kia Sportage": { make: "KIA", model: "SPORTAGE" },
  "Ford Escape": { make: "FORD", model: "ESCAPE" },
  "Toyota Highlander": { make: "TOYOTA", model: "HIGHLANDER" },
  "Hyundai Tucson": { make: "HYUNDAI", model: "TUCSON" },
  "Toyota 4Runner": { make: "TOYOTA", model: "4RUNNER" },
  "Honda Odyssey": { make: "HONDA", model: "ODYSSEY" },
  "Kia Sorento": { make: "KIA", model: "SORENTO" },
  "Hyundai Santa Fe": { make: "HYUNDAI", model: "SANTA FE", note: "excludes SANTA FE SPORT / SANTA FE XL, listed separately pre-2019" },
  "VW Tiguan": { make: "VOLKSWAGEN", model: "TIGUAN" },
  "Chrysler Pacifica PHEV": { make: "CHRYSLER", model: "PACIFICA HYBRID" },
  "Subaru Ascent": { make: "SUBARU", model: "ASCENT" },
  "Ford Ranger (2019+ midsize)": { make: "FORD", model: "RANGER" },
  "Honda Pilot": { make: "HONDA", model: "PILOT" },
  "Mini Countryman": { make: "MINI", model: "COUNTRYMAN" },
  "Toyota Sequoia": { make: "TOYOTA", model: "SEQUOIA" },
  "Hyundai Palisade": { make: "HYUNDAI", model: "PALISADE" },
  "Chrysler Pacifica": { make: "CHRYSLER", model: "PACIFICA" },
  "Chevy Colorado": { make: "CHEVROLET", model: "COLORADO" },
  "Kia Telluride": { make: "KIA", model: "TELLURIDE" },
  "Mazda CX-90": { make: "MAZDA", model: "CX-90" },
  "Chevy Traverse": { make: "CHEVROLET", model: "TRAVERSE" },
  "VW Atlas": { make: "VOLKSWAGEN", model: "ATLAS" },
  "Ford Explorer": { make: "FORD", model: "EXPLORER" },
  "Buick Enclave": { make: "BUICK", model: "ENCLAVE" },
  "Volvo XC60": { make: "VOLVO", model: "XC60" },
  "Chevy Tahoe": { make: "CHEVROLET", model: "TAHOE" },
  "Jeep Grand Cherokee L": { make: "JEEP", model: "GRAND CHEROKEE L" },
  "Volvo V90 Cross Country": { make: "VOLVO", model: "V90 CROSS COUNTRY" },
  "Chevy Suburban": { make: "CHEVROLET", model: "SUBURBAN" },
  "Volvo XC90": { make: "VOLVO", model: "XC90" },
  "Porsche 996 Carrera": { make: "PORSCHE", model: "911", note: "NHTSA has no 996/Carrera-vs-Turbo trim split; both Porsche rows map to the same 911 query" },
  "Porsche 996 Turbo": { make: "PORSCHE", model: "911", note: "identical query to 996 Carrera — NHTSA cannot distinguish the trims" },
};

/** Year window: at most 6 model years, ending no later than 2022 so every queried
 *  model year has >=4 years on road to accumulate complaints. Models that start
 *  after 2022 fall back to their own (short) span. */
export function yearsFor(v: SeedVehicle): number[] {
  const WINDOW_END = 2022;
  const SPAN = 6;
  let end = Math.min(v.last_year, WINDOW_END);
  let start: number;
  if (end < v.first_year) {
    start = v.first_year;
    end = v.last_year;
  } else {
    start = Math.max(v.first_year, end - (SPAN - 1));
  }
  const out: number[] = [];
  for (let y = start; y <= end; y++) out.push(y);
  return out;
}
