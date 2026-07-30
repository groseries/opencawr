/** The 71 seed vehicles mapped onto NHTSA's complaint catalogue: make string,
 *  per-year model-string matcher, and query year window. Built from
 *  opencawr_data.json so the corpus can never drift from the seed set.
 *
 *  Why matchers and not model strings: NHTSA's own catalogue
 *  (`api.nhtsa.gov/products/vehicle/models`) is trim-fragmented AND
 *  inconsistent year to year for the same physical car — `RANGER` → `RANGER
 *  SUPER CAB`/`SUPER CREW`, `XC60` → `XC60 T5|T6|T8` → `XC60 B5 AWD`, `COOPER`
 *  absent entirely in MY2021 — so one hard-coded string returns zero complaints
 *  for whole model years. Every matcher is applied to that year's real
 *  catalogue and the results are unioned and de-duplicated by ODI number
 *  (`complaintComponentsByCatalogue`).
 *
 *  Evidence and the full mapping audit: docs/investigations/2026-07-29-reliability-corpus.md §1. */
import type { Vehicle } from "@opencawr/core";
import { loadSeedData } from "../seedData.js";
import type { ReliabilityQuery } from "./derive.js";

type Matcher = (model: string) => boolean;

const exact = (...names: string[]): Matcher => {
  const set = new Set(names.map((n) => n.toUpperCase()));
  return (m) => set.has(m.toUpperCase());
};
const re =
  (pattern: RegExp, not?: RegExp): Matcher =>
  (m) =>
    pattern.test(m.toUpperCase()) && !(not?.test(m.toUpperCase()) ?? false);

/** NHTSA make string + model matcher, by seed vehicle name. */
const NHTSA: Record<string, { make: string; match: Matcher }> = {
  "Chevy Bolt EV": { make: "CHEVROLET", match: re(/^BOLT( EV)?$/) },
  "Chevy Volt": { make: "CHEVROLET", match: exact("VOLT") },
  "Toyota Prius (hybrid)": { make: "TOYOTA", match: exact("PRIUS") },
  "Toyota Prius Prime": { make: "TOYOTA", match: exact("PRIUS PRIME", "PRIUS PLUG-IN HYBRID") },
  "Toyota Corolla": { make: "TOYOTA", match: exact("COROLLA") },
  "Toyota Camry Hybrid": { make: "TOYOTA", match: exact("CAMRY HYBRID") },
  "Honda Civic": {
    make: "HONDA",
    match: exact("CIVIC", "CIVIC HATCH", "CIVIC HATCHBACK", "CIVIC SI", "CIVIC SEDAN SI"),
  },
  // `^LEAF\b`, not exact("LEAF"): NHTSA lists no bare `LEAF` in MY2022, only
  // trim strings, so an exact match silently loses that whole model year.
  "Nissan Leaf": { make: "NISSAN", match: re(/^LEAF\b/) },
  "Hyundai Elantra": { make: "HYUNDAI", match: exact("ELANTRA", "ELANTRA GT") },
  "Honda Accord": { make: "HONDA", match: exact("ACCORD") },
  "Kia K4": { make: "KIA", match: exact("K4", "K4 5DR") },
  "Mazda3 (SkyActiv)": {
    make: "MAZDA",
    match: exact("MAZDA3", "MAZDA3 SEDAN", "MAZDA3 HATCHBACK"),
  },
  "Toyota Camry": { make: "TOYOTA", match: exact("CAMRY") },
  "Toyota RAV4 Hybrid": { make: "TOYOTA", match: exact("RAV4 HYBRID", "RAV4 HV") },
  "Kia Niro (hybrid)": { make: "KIA", match: exact("NIRO", "NIRO HYBRID", "NIRO HEV") },
  "Tesla Model 3": { make: "TESLA", match: exact("MODEL 3") },
  "Hyundai Sonata": { make: "HYUNDAI", match: exact("SONATA") },
  "Toyota RAV4": { make: "TOYOTA", match: exact("RAV4") },
  "Fiat 500": { make: "FIAT", match: exact("500", "500 CABRIO") },
  "Honda CR-V": { make: "HONDA", match: exact("CR-V") },
  "VW ID.4 (AWD avail)": { make: "VOLKSWAGEN", match: exact("ID.4") },
  "Toyota RAV4 Prime": { make: "TOYOTA", match: exact("RAV4 PRIME") },
  "Kia Soul": { make: "KIA", match: exact("SOUL") },
  "VW Passat": { make: "VOLKSWAGEN", match: exact("PASSAT") },
  "Buick Encore": { make: "BUICK", match: exact("ENCORE") },
  "Hyundai Kona": { make: "HYUNDAI", match: exact("KONA") },
  "Mazda CX-5": { make: "MAZDA", match: exact("CX-5") },
  "Toyota Highlander Hybrid": { make: "TOYOTA", match: exact("HIGHLANDER HYBRID") },
  "Subaru Outback": { make: "SUBARU", match: exact("OUTBACK") },
  "Subaru Forester": { make: "SUBARU", match: exact("FORESTER") },
  "Toyota Sienna Hybrid": { make: "TOYOTA", match: exact("SIENNA HYBRID") },
  "Toyota Tacoma": { make: "TOYOTA", match: exact("TACOMA") },
  "Nissan Rogue": { make: "NISSAN", match: exact("ROGUE") },
  "Chevy Equinox": { make: "CHEVROLET", match: exact("EQUINOX") },
  "Toyota Sienna (V6)": { make: "TOYOTA", match: exact("SIENNA") },
  "Mini Cooper": {
    make: "MINI",
    match: exact("COOPER", "COOPER S", "HARDTOP", "HARDTOP 2DR", "HARDTOP 4DR"),
  },
  "Ford Ranger (old compact)": {
    make: "FORD",
    match: re(/^RANGER( REGULAR| SUPERCAB| SUPER CAB| SUPER CREW)?$/),
  },
  "Fiat 500X": { make: "FIAT", match: exact("500X") },
  "VW GTI": { make: "VOLKSWAGEN", match: exact("GOLF GTI", "GTI") },
  "Kia Sportage": { make: "KIA", match: exact("SPORTAGE") },
  "Ford Escape": { make: "FORD", match: exact("ESCAPE") },
  "Toyota Highlander": { make: "TOYOTA", match: exact("HIGHLANDER") },
  "Hyundai Tucson": { make: "HYUNDAI", match: exact("TUCSON") },
  "Toyota 4Runner": { make: "TOYOTA", match: exact("4RUNNER") },
  "Honda Odyssey": { make: "HONDA", match: exact("ODYSSEY") },
  "Kia Sorento": { make: "KIA", match: exact("SORENTO") },
  "Hyundai Santa Fe": { make: "HYUNDAI", match: exact("SANTA FE") },
  "VW Tiguan": { make: "VOLKSWAGEN", match: exact("TIGUAN") },
  "Chrysler Pacifica PHEV": {
    make: "CHRYSLER",
    match: exact("PACIFICA PHEV", "PACIFICA HYBRID"),
  },
  "Subaru Ascent": { make: "SUBARU", match: exact("ASCENT") },
  "Ford Ranger (2019+ midsize)": {
    make: "FORD",
    match: re(/^RANGER( SUPER CAB| SUPER CREW)?$/),
  },
  "Honda Pilot": { make: "HONDA", match: exact("PILOT") },
  "Mini Countryman": { make: "MINI", match: exact("COUNTRYMAN") },
  "Toyota Sequoia": { make: "TOYOTA", match: exact("SEQUOIA") },
  "Hyundai Palisade": { make: "HYUNDAI", match: exact("PALISADE") },
  "Chrysler Pacifica": { make: "CHRYSLER", match: exact("PACIFICA") },
  "Chevy Colorado": { make: "CHEVROLET", match: exact("COLORADO") },
  "Kia Telluride": { make: "KIA", match: exact("TELLURIDE") },
  "Mazda CX-90": { make: "MAZDA", match: exact("CX-90", "CX-90 MHEV", "CX-90-MHEV") },
  "Chevy Traverse": { make: "CHEVROLET", match: exact("TRAVERSE") },
  "VW Atlas": { make: "VOLKSWAGEN", match: exact("ATLAS") },
  "Ford Explorer": { make: "FORD", match: exact("EXPLORER") },
  "Buick Enclave": { make: "BUICK", match: exact("ENCLAVE") },
  "Volvo XC60": { make: "VOLVO", match: re(/^XC60\b/, /T8|PHEV|RECHARGE|POLESTAR/) },
  "Chevy Tahoe": { make: "CHEVROLET", match: exact("TAHOE") },
  "Jeep Grand Cherokee L": { make: "JEEP", match: exact("GRAND CHEROKEE L") },
  "Volvo V90 Cross Country": { make: "VOLVO", match: re(/^V90 ?CC\b/) },
  "Chevy Suburban": { make: "CHEVROLET", match: exact("SUBURBAN", "SUBURBAN 1500") },
  "Volvo XC90": { make: "VOLVO", match: re(/^XC90\b/, /T8|XC90H|RECHARGE|POLESTAR/) },
  "Porsche 996 Carrera": {
    make: "PORSCHE",
    match: re(/^911( CARRERA| CARRERA\/| CARRERA 4S)/, /TURBO|GT2|GT3/),
  },
  "Porsche 996 Turbo": { make: "PORSCHE", match: re(/^911 (TURBO|GT)/) },
};

/** Seed vehicles whose NHTSA mapping is genuinely ambiguous — disclosed in the
 *  report, never silently resolved. */
export const MAPPING_NOTES: Record<string, string> = {
  "Toyota Sienna (V6)":
    "same NHTSA string as Toyota Sienna Hybrid ('SIENNA'); separated ONLY by year window (<=2020 V6, 2021+ hybrid-only). NHTSA's junk 'REDUNDANT SIENNA' string for 2021-22 is excluded.",
  "Toyota Sienna Hybrid": "MY2021+ Sienna is hybrid-only, so this row and the V6 row can never overlap in year.",
  "Ford Ranger (old compact)":
    "same NHTSA string as the 2019+ midsize; separated ONLY by year window (2006-2011 vs 2019-2022). NHTSA lists NO Ford models at all for MY2018 (catalogue gap).",
  "Ford Ranger (2019+ midsize)": "see 'old compact' note; the year window is the only discriminator.",
  "Porsche 996 Carrera":
    "NHTSA's 911 strings vary by year ('911', '911 CARRERA', '911 CARRERA/CARRERA CABRIO', ...). The bare '911' string (MY1999-2001) is assigned to NEITHER Porsche row, to avoid double-counting. sport is never derived, so this affects no tier.",
  "Porsche 996 Turbo": "see the 996 Carrera note; NHTSA bundles GT2/GT3/Targa with Turbo in MY2002-2004.",
  "Chrysler Pacifica PHEV":
    "NHTSA renamed the string mid-life: 'PACIFICA PHEV' MY2017-2019, 'PACIFICA HYBRID' MY2020+. Both matched.",
  "Kia Niro (hybrid)":
    "NHTSA pools HEV/PHEV/BEV into a bare 'NIRO' from MY2021, so MY2021-22 folds some PHEV/EV complaints into this hybrid row.",
  "Hyundai Santa Fe":
    "MY2017-2018 'SANTA FE' is the 3-row (later Santa Fe XL); the 2-row of those years is 'SANTA FE SPORT' and is excluded. The seed row therefore spans two physically different vehicles.",
  "Chevy Bolt EV": "'BOLT' MY2017-2018, 'BOLT EV' MY2019+; 'BOLT EUV' (a different vehicle) excluded.",
  "Mini Cooper":
    "NHTSA uses COOPER / COOPER S / HARDTOP / HARDTOP 2DR / HARDTOP 4DR interchangeably and drops 'COOPER' entirely in MY2021. CLUBMAN / CONVERTIBLE / COUNTRYMAN / JCW / COOPER SE excluded.",
  "Volvo XC60": "no bare 'XC60' exists after MY2017 — only trim strings. T8/Recharge/Polestar (PHEV) excluded to match the seed row's etype=gas.",
  "Volvo XC90":
    "as XC60 — there is never a bare 'XC90' in the window, which is why the previous single-string query returned zero complaints for every year of this vehicle. T8/XC90H/Recharge excluded.",
  "Volvo V90 Cross Country": "'V90 CC' and 'V90CC' both appear; the plain 'V90 T5/T6' wagon is excluded.",
  "Toyota Corolla": "COROLLA HATCHBACK / COROLLA CROSS / COROLLA IM / COROLLA HYBRID are separate NHTSA strings and are excluded.",
  "Kia K4": "MY2025+ only — almost no complaint history exists yet. The seed row is already provenance='proxied'.",
  "Mazda CX-90": "MY2024+ only; NHTSA writes it 'CX-90-MHEV' in 2024 and 'CX-90 MHEV'/'CX-90' later. PHEV excluded (seed etype=gas).",
  "VW GTI": "'GOLF GTI' and 'GTI' both appear in MY2018-2019; both matched, de-duplicated by ODI number.",
  "Chevy Suburban": "'SUBURBAN 1500' MY2016-2021, 'SUBURBAN' MY2021+; both matched.",
};

/** Model-years NHTSA lists no matching string for at all — handled as missing
 *  years, never as zeros (which would read as a flawless model year). */
export const KNOWN_EMPTY_MODEL_YEARS = [
  "Fiat 500 MY2019",
  "Fiat 500X MY2021",
  "Volvo V90 Cross Country MY2021",
];

/** Query window: at most 6 model years ending no later than MY2022, so every
 *  queried model year has >= 4 years on road to accumulate complaints.
 *  Vehicles that start after 2022 (Kia K4, Mazda CX-90) fall back to their own
 *  short span. Methodology "Year window". */
export const WINDOW_END = 2022;
export const WINDOW_SPAN = 6;

export function yearsFor(v: Pick<Vehicle, "first_year" | "last_year">): number[] {
  let end = Math.min(v.last_year, WINDOW_END);
  let start: number;
  if (end < v.first_year) {
    start = v.first_year;
    end = v.last_year;
  } else {
    start = Math.max(v.first_year, end - (WINDOW_SPAN - 1));
  }
  const out: number[] = [];
  for (let y = start; y <= end; y++) out.push(y);
  return out;
}

/** Every seed vehicle as a reliability query. Throws rather than silently
 *  dropping a vehicle whose NHTSA mapping is missing. */
export function corpusQueries(vehicles?: Vehicle[]): ReliabilityQuery[] {
  return (vehicles ?? loadSeedData().vehicles).map((v) => {
    const nhtsa = NHTSA[v.name];
    if (!nhtsa) throw new Error(`No NHTSA mapping for seed vehicle "${v.name}" (see corpus.ts)`);
    return {
      name: v.name,
      make: nhtsa.make,
      matchesModel: nhtsa.match,
      years: yearsFor(v),
      etype: v.etype,
      seedTier: v.reliability_tier,
      body: v.body,
    };
  });
}
