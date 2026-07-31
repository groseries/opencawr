/** The 71 seed vehicles mapped onto EPA fueleconomy.gov's model catalogue:
 *  make string plus a per-year model-string matcher. The EPA-side twin of
 *  `packages/pipeline/src/reliability/corpus.ts`, deliberately built the same
 *  way, for the same reason.
 *
 *  Why matchers and not model strings: EPA's own catalogue
 *  (`fueleconomy.gov/ws/rest/vehicle/menu/model?year=&make=`) is
 *  **drivetrain/trim-fragmented**, exactly as NHTSA's is. MY2022 Honda lists
 *  `CR-V AWD`, `CR-V FWD` and `CR-V Hybrid AWD` and **no bare `CR-V`** — so the
 *  single exact-string query the previous pass used (`peerEpaQuery`) got a bare
 *  JSON `null` back and left `drivetrain` blank for every year of 49 of the 71
 *  seed vehicles. Every matcher here is applied to that model year's REAL
 *  catalogue instead.
 *
 *  Two rules every matcher obeys:
 *
 *  1. **etype include/exclude.** EPA lists electrified and alt-fuel variants as
 *     separate model strings under the same nameplate, so a `gas` seed row must
 *     never match one (`Honda CR-V` matches `CR-V AWD`/`CR-V FWD` but NOT
 *     `CR-V Hybrid AWD`), and an electrified seed row must match the
 *     corresponding electrified string (`Toyota RAV4 Hybrid` -> `RAV4 Hybrid
 *     AWD`, which `Toyota RAV4` excludes). `NON_GAS` below is the shared
 *     exclusion for `gas` rows.
 *  2. **One deterministic variant per model year.** Several strings usually
 *     match (`CR-V AWD` *and* `CR-V FWD`), each with its own config ids and so
 *     its own `drive`/`trany`. `pickModelForYear` sorts the matches and takes
 *     the first, so `specChangeFromPriorYear` compares like for like year over
 *     year. A model year's reported `drivetrain` is therefore **a configuration
 *     EPA lists for that year, not the only one** — see
 *     docs/model-year-detail-methodology.md. */
import type { Vehicle } from "@opencawr/core";

type Matcher = (model: string) => boolean;

const exact = (...names: string[]): Matcher => {
  const set = new Set(names.map((n) => n.toUpperCase()));
  return (m) => set.has(m.toUpperCase());
};
const re =
  (pattern: RegExp, not?: RegExp): Matcher =>
  (m) =>
    pattern.test(m.toUpperCase()) && !(not?.test(m.toUpperCase()) ?? false);

/** Markers EPA puts in the model string of an electrified/alt-fuel variant of
 *  an otherwise identically-named nameplate. Excluded from every `gas` seed row
 *  (rule 1 above); `hybrid`/`phev`/`ev` rows match these on purpose instead.
 *  `FFV` (flex-fuel E85) is deliberately NOT here — a flex-fuel car is a
 *  gasoline car. */
const NON_GAS = /HYBRID|PLUG-IN|PHEV|\bHEV\b|ELECTRIC|\bEV\b|FCEV|\bFCV\b|\bCNG\b|NATURAL GAS/;

/** `NON_GAS` plus row-specific exclusions (other nameplates EPA files under a
 *  matching prefix, different body styles, etc). */
const alsoNot = (...extra: RegExp[]): RegExp =>
  new RegExp([NON_GAS, ...extra].map((r) => r.source).join("|"));

/** EPA make string + model matcher, by seed vehicle name. Make strings verified
 *  against `fueleconomy.gov/ws/rest/vehicle/menu/make?year=` — note `Chevrolet`
 *  (not "Chevy"), `Volkswagen` (not "VW") and `MINI` (all caps). */
const EPA: Record<string, { make: string; match: Matcher }> = {
  // --- Chevrolet ---
  "Chevy Bolt EV": { make: "Chevrolet", match: exact("Bolt EV") },
  "Chevy Volt": { make: "Chevrolet", match: exact("Volt") },
  "Chevy Equinox": { make: "Chevrolet", match: re(/^EQUINOX\b/, NON_GAS) },
  "Chevy Colorado": { make: "Chevrolet", match: re(/^COLORADO\b/, NON_GAS) },
  "Chevy Traverse": { make: "Chevrolet", match: re(/^TRAVERSE\b/, NON_GAS) },
  "Chevy Tahoe": { make: "Chevrolet", match: re(/^TAHOE\b/, NON_GAS) },
  "Chevy Suburban": { make: "Chevrolet", match: re(/^SUBURBAN\b/, NON_GAS) },

  // --- Toyota ---
  // Enumerated rather than `^PRIUS` + exclusions: `Prius c` and `Prius v` are
  // different vehicles, and `Prius Prime`/`Prius PHEV` are the seed's own
  // separate plug-in row.
  "Toyota Prius (hybrid)": {
    make: "Toyota",
    match: re(/^PRIUS( AWD| ECO| XLE\/LTD| AWD XLE\/LTD)?$/),
  },
  "Toyota Prius Prime": { make: "Toyota", match: re(/^PRIUS (PRIME|PHEV|PLUG-IN)\b/) },
  "Toyota Corolla": {
    make: "Toyota",
    match: re(/^COROLLA\b/, alsoNot(/CROSS|HATCHBACK|\bIM\b/)),
  },
  "Toyota Camry": { make: "Toyota", match: re(/^CAMRY\b/, alsoNot(/SOLARA/)) },
  "Toyota Camry Hybrid": { make: "Toyota", match: re(/^CAMRY (HYBRID|HEV)\b/) },
  "Toyota RAV4": { make: "Toyota", match: re(/^RAV4\b/, alsoNot(/PRIME/)) },
  "Toyota RAV4 Hybrid": { make: "Toyota", match: re(/^RAV4 HYBRID\b/) },
  "Toyota RAV4 Prime": { make: "Toyota", match: re(/^RAV4 (PRIME|PHEV)\b/) },
  "Toyota Highlander": { make: "Toyota", match: re(/^HIGHLANDER\b/, NON_GAS) },
  "Toyota Highlander Hybrid": { make: "Toyota", match: re(/^HIGHLANDER HYBRID\b/) },
  "Toyota Sienna (V6)": { make: "Toyota", match: re(/^SIENNA\b/, NON_GAS) },
  "Toyota Sienna Hybrid": { make: "Toyota", match: re(/^SIENNA\b/) },
  "Toyota Tacoma": { make: "Toyota", match: re(/^TACOMA\b/, NON_GAS) },
  "Toyota 4Runner": { make: "Toyota", match: re(/^4RUNNER\b/, NON_GAS) },
  "Toyota Sequoia": { make: "Toyota", match: re(/^SEQUOIA\b/, NON_GAS) },

  // --- Honda ---
  "Honda Civic": { make: "Honda", match: re(/^CIVIC\b/, alsoNot(/TYPE R|\bSI\b/)) },
  "Honda Accord": { make: "Honda", match: re(/^ACCORD\b/, alsoNot(/CROSSTOUR/)) },
  "Honda CR-V": { make: "Honda", match: re(/^CR-V\b/, NON_GAS) },
  "Honda Odyssey": { make: "Honda", match: re(/^ODYSSEY\b/) },
  "Honda Pilot": { make: "Honda", match: re(/^PILOT\b/, NON_GAS) },

  // --- Nissan ---
  "Nissan Leaf": { make: "Nissan", match: re(/^LEAF\b/) },
  "Nissan Rogue": { make: "Nissan", match: re(/^ROGUE (AWD|FWD)\b/, NON_GAS) },

  // --- Hyundai ---
  "Hyundai Elantra": { make: "Hyundai", match: re(/^ELANTRA\b/, NON_GAS) },
  "Hyundai Sonata": { make: "Hyundai", match: re(/^SONATA\b/, NON_GAS) },
  "Hyundai Kona": { make: "Hyundai", match: re(/^KONA\b/, NON_GAS) },
  "Hyundai Tucson": { make: "Hyundai", match: re(/^TUCSON\b/, alsoNot(/FUEL CELL/)) },
  "Hyundai Santa Fe": { make: "Hyundai", match: re(/^SANTA FE\b/, alsoNot(/SPORT|\bXL\b/)) },
  "Hyundai Palisade": { make: "Hyundai", match: re(/^PALISADE\b/, NON_GAS) },

  // --- Kia ---
  "Kia K4": { make: "Kia", match: re(/^K4\b/) },
  "Kia Niro (hybrid)": { make: "Kia", match: re(/^NIRO\b/, /ELECTRIC|PLUG-IN/) },
  "Kia Soul": { make: "Kia", match: re(/^SOUL\b/, NON_GAS) },
  "Kia Sportage": { make: "Kia", match: re(/^SPORTAGE\b/, NON_GAS) },
  "Kia Sorento": { make: "Kia", match: re(/^SORENTO\b/, NON_GAS) },
  "Kia Telluride": { make: "Kia", match: re(/^TELLURIDE\b/, NON_GAS) },

  // --- Mazda ---
  // EPA files the Mazda3 as a bare `3` / `3 4-Door` / `3 4-Door 2WD`.
  "Mazda3 (SkyActiv)": { make: "Mazda", match: re(/^3\b/, NON_GAS) },
  "Mazda CX-5": { make: "Mazda", match: re(/^CX-5\b/, NON_GAS) },
  "Mazda CX-90": { make: "Mazda", match: re(/^CX-90\b/, NON_GAS) },

  // --- Tesla ---
  "Tesla Model 3": { make: "Tesla", match: re(/^MODEL 3\b/) },

  // --- Fiat ---
  "Fiat 500": { make: "Fiat", match: re(/^500( ABARTH| CABRIO)?$/) },
  "Fiat 500X": { make: "Fiat", match: re(/^500 ?X\b/, NON_GAS) },

  // --- Volkswagen ---
  "VW ID.4 (AWD avail)": { make: "Volkswagen", match: re(/^ID\.4\b/) },
  "VW Passat": { make: "Volkswagen", match: re(/^PASSAT\b/, NON_GAS) },
  "VW GTI": { make: "Volkswagen", match: exact("GTI") },
  "VW Tiguan": { make: "Volkswagen", match: re(/^TIGUAN\b/, NON_GAS) },
  "VW Atlas": { make: "Volkswagen", match: re(/^ATLAS\b/, alsoNot(/CROSS SPORT/)) },

  // --- Buick ---
  "Buick Encore": { make: "Buick", match: re(/^ENCORE( AWD| FWD)?$/) },
  "Buick Enclave": { make: "Buick", match: re(/^ENCLAVE\b/, NON_GAS) },

  // --- Subaru ---
  "Subaru Outback": { make: "Subaru", match: re(/^OUTBACK\b/, NON_GAS) },
  "Subaru Forester": { make: "Subaru", match: re(/^FORESTER\b/, NON_GAS) },
  "Subaru Ascent": { make: "Subaru", match: re(/^ASCENT\b/, NON_GAS) },

  // --- MINI ---
  "Mini Cooper": {
    make: "MINI",
    match: re(/^COOPER( C| S)?( HARDTOP [24] DOOR| \([35]-DOORS\)| [24] DOOR)?$/),
  },
  "Mini Countryman": {
    make: "MINI",
    match: re(/COUNTRYMAN/, /\bSE\b|JCW|JOHN COOPER WORKS|COUPE/),
  },

  // --- Ford ---
  "Ford Ranger (old compact)": { make: "Ford", match: re(/^RANGER\b/, alsoNot(/INCOMPLETE/)) },
  "Ford Ranger (2019+ midsize)": { make: "Ford", match: re(/^RANGER\b/, alsoNot(/INCOMPLETE/)) },
  "Ford Escape": { make: "Ford", match: re(/^ESCAPE\b/, NON_GAS) },
  "Ford Explorer": { make: "Ford", match: re(/^EXPLORER\b/, alsoNot(/SPORT|USPS/)) },

  // --- Chrysler ---
  "Chrysler Pacifica": { make: "Chrysler", match: re(/^PACIFICA\b/, NON_GAS) },
  "Chrysler Pacifica PHEV": { make: "Chrysler", match: exact("Pacifica Hybrid") },

  // --- Jeep ---
  "Jeep Grand Cherokee L": { make: "Jeep", match: re(/^GRAND CHEROKEE L\b/, NON_GAS) },

  // --- Volvo ---
  "Volvo XC60": { make: "Volvo", match: re(/^XC60\b/, alsoNot(/T8|RECHARGE|POLESTAR/)) },
  "Volvo XC90": { make: "Volvo", match: re(/^XC90\b/, alsoNot(/T8|RECHARGE|POLESTAR/)) },
  "Volvo V90 Cross Country": {
    make: "Volvo",
    match: re(/^V90 ?CC\b/, alsoNot(/T8|RECHARGE|POLESTAR/)),
  },

  // --- Porsche ---
  // EPA drops the `911` prefix from MY2003 (`Carrera 2 Coupe`, `Turbo`) and
  // mangles it back in from MY2004 (`Turbo 4 911 Cab`), so both shapes match.
  "Porsche 996 Carrera": { make: "Porsche", match: re(/^(911 )?CARRERA\b/, /GT[23]|\bGT$/) },
  "Porsche 996 Turbo": { make: "Porsche", match: re(/^(911 )?TURBO\b/, /GT[23]/) },
};

/** Seed vehicles whose EPA mapping is genuinely ambiguous, or whose catalogue
 *  window is shorter than the seed's production span — disclosed here and in
 *  docs/model-year-detail-methodology.md, never silently resolved. */
export const MAPPING_NOTES: Record<string, string> = {
  "Toyota Sienna Hybrid":
    "MY2021+ Sienna is hybrid-only, so EPA drops the `Hybrid` marker after MY2021: `Sienna Hybrid 2WD/AWD` (2021) then plain `Sienna 2WD/AWD` (2022+). This row therefore matches ALL `Sienna` strings and is separated from the V6 row ONLY by year window (2021-2026 vs 2011-2020), exactly as corpus.ts separates the same two NHTSA rows.",
  "Toyota Sienna (V6)": "see the Sienna Hybrid note; the `Hybrid` marker is excluded here and the year window (2011-2020) is the real discriminator.",
  "Toyota Camry":
    "MY2025+ Camry is hybrid-only and EPA lists no non-`HEV` Camry string for 2025-2026, so those two years are a genuine gap for this gas row (the hybrid row covers them).",
  "Toyota RAV4":
    "EPA's MY2026 RAV4 strings (`RAV4 AWD XLE`, ...) carry no `Hybrid` marker even though the MY2026 RAV4 is hybrid-only. The etype rule keys off the catalogue STRING, so MY2026 resolves through this gas row.",
  "Toyota RAV4 Prime": "EPA renamed the string mid-life (`RAV4 Prime 4WD` 2021-2024, `RAV4 PHEV AWD` 2025); both matched. No MY2026 plug-in RAV4 string exists yet.",
  "Toyota Prius Prime": "EPA renamed the string mid-life (`Prius Prime` 2017-2024, `Prius PHEV` 2025); both matched. No MY2026 string exists yet.",
  "Hyundai Santa Fe":
    "MY2015-2018 `Santa Fe AWD/FWD` is the 3-row (later `Santa Fe XL`); the 2-row of those years is `Santa Fe Sport` and is excluded, as is `Santa Fe XL` from MY2019. The seed row therefore spans two physically different vehicles — the same limitation corpus.ts already discloses for its NHTSA row.",
  "Buick Encore":
    "`Encore GX` (MY2020+, a different platform) is EXCLUDED, matching corpus.ts's NHTSA row. The Encore proper ends at MY2022, so MY2023-2026 of this seed row is a genuine gap.",
  "Kia Soul": "EPA lists no MY2026 Soul (US sales ended after MY2025) — that year is a gap.",
  "Kia Telluride": "EPA lists no MY2026 Telluride yet — that year is a gap.",
  "Chrysler Pacifica PHEV":
    "EPA calls the plug-in `Pacifica Hybrid` (no `PHEV`/`Plug-in` in the string); matched exactly, and excluded from the gas `Chrysler Pacifica` row by NON_GAS.",
  "Chevy Bolt EV": "`Bolt EUV` (a different vehicle) is excluded, matching corpus.ts.",
  "Mini Cooper":
    "EPA renames the hardtop twice: `Cooper (3-doors)`/`(5-doors)` (2014-2015) -> `Cooper Hardtop 2/4 door` (2016-2025) -> `Cooper C/S 2/4 Door` (2026). Clubman/Countryman/Convertible/Roadster/Coupe/Paceman/JCW and the electric `Cooper SE` are excluded.",
  "Mini Countryman":
    "`Cooper Countryman` (2011-2024) and `Countryman S All4` (2025-2026) are both matched; the plug-in `Cooper SE Countryman` and electric `Countryman SE ALL4` are excluded, as are the JCW variants and the MY2013-only `Countryman Coupe` body.",
  "Ford Ranger (old compact)":
    "same matcher as the 2019+ midsize; separated ONLY by year window (2001-2011 vs 2019-2026), exactly as corpus.ts separates the same two NHTSA rows. EPA renames it `Ranger Pickup 2WD/4WD` (2001-2009) -> `Ranger 2WD/4WD` (2010-2011).",
  "Ford Ranger (2019+ midsize)": "see the 'old compact' note; the year window is the only discriminator.",
  "Porsche 996 Carrera":
    "EPA's 911 strings change shape by year: `911 Carrera` (1999-2000, 2002), `911 Carrera 2/4` (2001), then the `911` prefix is DROPPED (`Carrera 2 Coupe`/`Carrera 4 Cabriolet`, 2003+). `Carrera GT` (a different car) and the GT2/GT3 strings are excluded.",
  "Porsche 996 Turbo":
    "`911 Turbo` (2001-2002) -> bare `Turbo` (2003) -> `Turbo 4 911 ...` (2004-2005). GT2/GT3 strings are excluded here (unlike corpus.ts's NHTSA row, which bundles them because NHTSA does) so the reported drivetrain is the Turbo's, not a GT car's.",
  "Volvo XC60": "no bare `XC60` exists: `XC60 AWD/FWD` (2016-2021) -> `XC60 B5/B5 AWD/B6 AWD` (2022+). T8/Recharge/PHEV excluded to match the seed row's etype=gas.",
  "Volvo XC90": "as XC60: `XC90 AWD/FWD` -> `XC90 T5/T6 AWD` (2022) -> `XC90 B5/B6 AWD` (2023+). T8/Recharge/PHEV excluded.",
  "Volvo V90 Cross Country": "`V90 CC AWD` (2017-2021) and `V90CC B6 AWD` (2022+) — both spellings matched; the plain `V90 AWD/FWD` wagon is excluded.",
  "Honda Civic":
    "EPA splits the Civic by body (`Civic` -> `Civic 2Dr`/`4Dr`/`5Dr`); Hybrid, CNG/Natural Gas, Si and Type R strings are excluded.",
  "Kia Niro (hybrid)": "`Niro`/`Niro FE`/`Niro Touring` are the hybrid; `Niro Electric` and `Niro Plug-in Hybrid` are excluded (the seed row is etype=hybrid).",
  "Mazda3 (SkyActiv)":
    "EPA files this as a bare `3` (`3` -> `3 4-Door`/`5-Door` -> `3 4-Door 2WD/4WD`), which is precisely why the old `peerEpaQuery` model string `Mazda3 (SkyActiv)` returned nothing.",
};

/** Deterministic single variant for one model year: the sorted-first catalogue
 *  string matching `matchesModel`, or `null` if none do. Sorting is
 *  case-insensitive with a raw-string tiebreak, so it can't be flipped by EPA's
 *  inconsistent capitalization (`LEAF` vs `Leaf` in the same catalogue).
 *
 *  **This is a choice, not the whole truth**: a model year offering several
 *  drivetrains (`CR-V AWD` and `CR-V FWD`) is represented by ONE of them. */
export function pickModelForYear(models: string[], matchesModel: Matcher): string | null {
  const matched = models.filter(matchesModel);
  if (matched.length === 0) return null;
  matched.sort((a, b) => {
    const ua = a.toUpperCase();
    const ub = b.toUpperCase();
    if (ua !== ub) return ua < ub ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return matched[0]!;
}

export interface EpaCatalogueQuery {
  make: string;
  matchesModel: Matcher;
}

/** EPA make + model matcher for one seed vehicle. Throws rather than silently
 *  dropping a vehicle whose EPA mapping is missing (same discipline as
 *  `corpusQueries`). */
export function epaCatalogueQuery(vehicle: Pick<Vehicle, "name">): EpaCatalogueQuery {
  const epa = EPA[vehicle.name];
  if (!epa) throw new Error(`No EPA mapping for seed vehicle "${vehicle.name}" (see epaCorpus.ts)`);
  return { make: epa.make, matchesModel: epa.match };
}
