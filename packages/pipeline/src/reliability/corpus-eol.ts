/** The 71 seed vehicles mapped onto the NY State DMV Vehicle Inspections
 *  dataset (`https://data.ny.gov/resource/vezn-fmmk.json`, see
 *  `sources/ny-inspections.ts`), for the end-of-life mileage re-derivation
 *  (`derive-eol.ts`). Built from opencawr_data.json so this corpus can never
 *  drift from the seed set — see the exhaustive-coverage test in
 *  `test/corpus-eol.test.ts`.
 *
 *  Every value here is transcribed verbatim from a fully-verified,
 *  already-queried mapping, not re-derived: docs/investigations/
 *  2026-07-30-ny-dmv-catalogue.md. Read that file for how each row was
 *  checked against the live API — this module only encodes its conclusions.
 *
 *  `make_code` is DMV's 5-char truncated make field (`TOYOT`, `HONDA`, ...).
 *  `model_name` is pre-normalized (uppercased, no spaces/punctuation) and,
 *  unlike NHTSA's catalogue, usually stable across model years for a given
 *  nameplate — but a few of the exact same cross-generation ambiguities
 *  documented in `corpus.ts` for NHTSA reappear here verbatim, because
 *  they're facts about the cars, not the catalogue: Toyota Sienna V6/Hybrid,
 *  Ford Ranger generations, and Hyundai Santa Fe generations share a
 *  `model_name` string across physically different cars. Where two SEED ROWS
 *  share a string (Sienna, Ranger) the only discriminator is model year —
 *  `minModelYear`/`maxModelYear` below encode that; see MAPPING_NOTES for
 *  every other judgment call (single-seed-row cases like Santa Fe, Mini
 *  Cooper, the Prius/RAV4 Prime mid-life renames, Buick Encore's
 *  discontinuation, etc). */

export interface EolMappingEntry {
  /** NY DMV `make_code`: 5-char truncated field, e.g. `TOYOT`. */
  makeCode: string;
  /** Every `model_name` string that belongs to this nameplate (Socrata
   *  `model_name in (...)`). */
  modelNames: string[];
  /** Inclusive NY DMV model-year bounds — set ONLY when this row shares its
   *  `modelNames` with another seed row and the two are separable solely by
   *  model year (MAPPING_NOTES: Toyota Sienna V6/Hybrid, Ford Ranger
   *  generations). Omitted when the seed row's own `first_year`/`last_year`
   *  is already the only relevant bound. */
  minModelYear?: number;
  maxModelYear?: number;
  /** doc §1 "Sample" column: `count(distinct vin)` for one representative
   *  model year, `inspection_date` in calendar 2025 — a proxy for "cars
   *  currently on NY roads of a mid-life age for this nameplate". */
  sampleModelYear: number;
  sampleSize: number;
  /** True for the small-sample models doc §3/§4 explicitly flag as thin
   *  (Volvo V90 CC 39, Fiat 500X 61, Toyota Sequoia 164, Nissan Leaf 124,
   *  Kia Niro 105, Mini Countryman 542, Chrysler Pacifica PHEV 512, VW GTI
   *  563, Chevy Bolt EV 405, Chevy Volt 643 — the latter flagged in doc §3
   *  rather than the §4 table). Downstream code should threshold on
   *  `sampleSize` directly rather than trust only this boolean — it mirrors
   *  the doc's own flagging, not a freshly computed cutoff. */
  lowVolume: boolean;
}

export type EolCorpusEntry =
  | ({ derivable: true } & EolMappingEntry)
  | {
      derivable: false;
      /** Why this seed row cannot be queried against this dataset at all
       *  (distinct from `lowVolume`, which CAN be queried, just thinly). */
      reason: string;
    };

const PORSCHE_996_UNDERIVABLE_REASON =
  "NY DMV lumps every 911 variant (Carrera, Turbo, GT2/GT3) across MY1999-2006 into a single " +
  "bare '911' model_name string with no trim/engine/drivetrain field to split on — worse than " +
  "NHTSA's partial split. Cannot be separated from the other Porsche 996 seed row at all. Both " +
  "rows are reliability_tier='sport' and excluded from derivation regardless (same carve-out " +
  "R12 applied to NHTSA-derived reliability tiers).";

/** Per-seed-vehicle NY DMV mapping, keyed by the exact `name` string in
 *  opencawr_data.json. All 71 seed vehicles are present — either `derivable:
 *  true` with query parameters, or `derivable: false` with a reason. */
export const CORPUS_EOL: Record<string, EolCorpusEntry> = {
  "Chevy Bolt EV": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["BOLTEV"],
    sampleModelYear: 2021,
    sampleSize: 405,
    lowVolume: true,
  },
  "Chevy Volt": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["VOLT"],
    sampleModelYear: 2018,
    sampleSize: 643,
    lowVolume: true,
  },
  "Toyota Prius (hybrid)": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["PRIUS"],
    sampleModelYear: 2018,
    sampleSize: 991,
    lowVolume: false,
  },
  "Toyota Prius Prime": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["PRIUSPRIME", "PRIUSPLUGINHYBRID"],
    sampleModelYear: 2021,
    sampleSize: 2211,
    lowVolume: false,
  },
  "Toyota Corolla": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["COROLLA"],
    sampleModelYear: 2017,
    sampleSize: 6326,
    lowVolume: false,
  },
  "Toyota Camry Hybrid": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["CAMRYHYBRID"],
    sampleModelYear: 2018,
    sampleSize: 1059,
    lowVolume: false,
  },
  "Honda Civic": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["CIVIC"],
    sampleModelYear: 2017,
    sampleSize: 11057,
    lowVolume: false,
  },
  "Nissan Leaf": {
    derivable: true,
    makeCode: "NISSA",
    modelNames: ["LEAF"],
    sampleModelYear: 2021,
    sampleSize: 124,
    lowVolume: true,
  },
  "Hyundai Elantra": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["ELANTRA", "ELANTRAGT"],
    sampleModelYear: 2018,
    sampleSize: 6314,
    lowVolume: false,
  },
  "Honda Accord": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["ACCORD"],
    sampleModelYear: 2017,
    sampleSize: 13990,
    lowVolume: false,
  },
  "Kia K4": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["K4", "K4HATCHBACK"],
    sampleModelYear: 2025,
    sampleSize: 5347,
    lowVolume: false,
  },
  "Mazda3 (SkyActiv)": {
    derivable: true,
    makeCode: "MAZDA",
    modelNames: ["MAZDA3", "MAZDA3SEDAN", "MAZDA3HATCHBACK"],
    sampleModelYear: 2018,
    sampleSize: 2551,
    lowVolume: false,
  },
  "Toyota Camry": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["CAMRY"],
    sampleModelYear: 2017,
    sampleSize: 11873,
    lowVolume: false,
  },
  "Toyota RAV4 Hybrid": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["RAV4HYBRID"],
    sampleModelYear: 2021,
    sampleSize: 7455,
    lowVolume: false,
  },
  "Kia Niro (hybrid)": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["NIRO"],
    sampleModelYear: 2021,
    sampleSize: 105,
    lowVolume: true,
  },
  "Tesla Model 3": {
    derivable: true,
    makeCode: "TESLA",
    modelNames: ["MODEL3"],
    sampleModelYear: 2021,
    sampleSize: 2878,
    lowVolume: false,
  },
  "Hyundai Sonata": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["SONATA", "SONATA20T"],
    sampleModelYear: 2018,
    sampleSize: 4052,
    lowVolume: false,
  },
  "Toyota RAV4": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["RAV4"],
    sampleModelYear: 2019,
    sampleSize: 15769,
    lowVolume: false,
  },
  "Fiat 500": {
    derivable: true,
    makeCode: "FIAT",
    modelNames: ["500", "500C", "500T"],
    sampleModelYear: 2015,
    sampleSize: 849,
    lowVolume: false,
  },
  "Honda CR-V": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["CRV"],
    sampleModelYear: 2019,
    sampleSize: 26252,
    lowVolume: false,
  },
  "VW ID.4 (AWD avail)": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["ID4"],
    sampleModelYear: 2023,
    sampleSize: 1363,
    lowVolume: false,
  },
  "Toyota RAV4 Prime": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["RAV4PRIME", "RAV4PLUGINHYBRID"],
    sampleModelYear: 2023,
    sampleSize: 3720,
    lowVolume: false,
  },
  "Kia Soul": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["SOUL"],
    sampleModelYear: 2018,
    sampleSize: 1484,
    lowVolume: false,
  },
  "VW Passat": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["PASSAT"],
    sampleModelYear: 2017,
    sampleSize: 2183,
    lowVolume: false,
  },
  "Buick Encore": {
    derivable: true,
    makeCode: "BUICK",
    modelNames: ["ENCORE"],
    sampleModelYear: 2018,
    sampleSize: 2650,
    lowVolume: false,
  },
  "Hyundai Kona": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["KONA"],
    sampleModelYear: 2021,
    sampleSize: 3562,
    lowVolume: false,
  },
  "Mazda CX-5": {
    derivable: true,
    makeCode: "MAZDA",
    modelNames: ["CX5"],
    sampleModelYear: 2019,
    sampleSize: 8034,
    lowVolume: false,
  },
  "Toyota Highlander Hybrid": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["HIGHLANDERHYBRID"],
    sampleModelYear: 2019,
    sampleSize: 843,
    lowVolume: false,
  },
  "Subaru Outback": {
    derivable: true,
    makeCode: "SUBAR",
    modelNames: ["OUTBACK"],
    sampleModelYear: 2018,
    sampleSize: 8532,
    lowVolume: false,
  },
  "Subaru Forester": {
    derivable: true,
    makeCode: "SUBAR",
    modelNames: ["FORESTER"],
    sampleModelYear: 2018,
    sampleSize: 14480,
    lowVolume: false,
  },
  "Toyota Sienna Hybrid": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["SIENNA"],
    minModelYear: 2021,
    sampleModelYear: 2022,
    sampleSize: 6733,
    lowVolume: false,
  },
  "Toyota Tacoma": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["TACOMA"],
    sampleModelYear: 2017,
    sampleSize: 5334,
    lowVolume: false,
  },
  "Nissan Rogue": {
    derivable: true,
    makeCode: "NISSA",
    modelNames: ["ROGUE"],
    sampleModelYear: 2018,
    sampleSize: 17232,
    lowVolume: false,
  },
  "Chevy Equinox": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["EQUINOX"],
    sampleModelYear: 2018,
    sampleSize: 15192,
    lowVolume: false,
  },
  "Toyota Sienna (V6)": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["SIENNA"],
    maxModelYear: 2020,
    sampleModelYear: 2016,
    sampleSize: 4365,
    lowVolume: false,
  },
  "Mini Cooper": {
    derivable: true,
    makeCode: "MINI",
    modelNames: ["COOPER", "HARDTOP", "HARDTOP2DOOR", "HARDTOP4DOOR", "COOPERHARDTOP"],
    sampleModelYear: 2019,
    sampleSize: 916,
    lowVolume: false,
  },
  "Ford Ranger (old compact)": {
    derivable: true,
    makeCode: "FORD",
    modelNames: ["RANGER"],
    maxModelYear: 2011,
    sampleModelYear: 2007,
    sampleSize: 746,
    lowVolume: false,
  },
  "Fiat 500X": {
    derivable: true,
    makeCode: "FIAT",
    modelNames: ["500X"],
    sampleModelYear: 2019,
    sampleSize: 61,
    lowVolume: true,
  },
  "VW GTI": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["GOLFGTI", "GTI"],
    sampleModelYear: 2019,
    sampleSize: 563,
    lowVolume: true,
  },
  "Kia Sportage": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["SPORTAGE"],
    sampleModelYear: 2018,
    sampleSize: 2700,
    lowVolume: false,
  },
  "Ford Escape": {
    derivable: true,
    makeCode: "FORD",
    modelNames: ["ESCAPE"],
    sampleModelYear: 2017,
    sampleSize: 12960,
    lowVolume: false,
  },
  "Toyota Highlander": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["HIGHLANDER"],
    sampleModelYear: 2017,
    sampleSize: 7573,
    lowVolume: false,
  },
  "Hyundai Tucson": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["TUCSON"],
    sampleModelYear: 2017,
    sampleSize: 4945,
    lowVolume: false,
  },
  "Toyota 4Runner": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["4RUNNER"],
    sampleModelYear: 2017,
    sampleSize: 1592,
    lowVolume: false,
  },
  "Honda Odyssey": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["ODYSSEY"],
    sampleModelYear: 2018,
    sampleSize: 4074,
    lowVolume: false,
  },
  "Kia Sorento": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["SORENTO"],
    sampleModelYear: 2018,
    sampleSize: 2243,
    lowVolume: false,
  },
  "Hyundai Santa Fe": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["SANTAFE"],
    sampleModelYear: 2019,
    sampleSize: 3831,
    lowVolume: false,
  },
  "VW Tiguan": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["TIGUAN"],
    sampleModelYear: 2021,
    sampleSize: 5846,
    lowVolume: false,
  },
  "Chrysler Pacifica PHEV": {
    derivable: true,
    makeCode: "CHRYS",
    modelNames: ["PACIFICAHYBRID", "PACIFICAPLUGINHYBRID"],
    sampleModelYear: 2021,
    sampleSize: 512,
    lowVolume: true,
  },
  "Subaru Ascent": {
    derivable: true,
    makeCode: "SUBAR",
    modelNames: ["ASCENT"],
    sampleModelYear: 2022,
    sampleSize: 3244,
    lowVolume: false,
  },
  "Ford Ranger (2019+ midsize)": {
    derivable: true,
    makeCode: "FORD",
    modelNames: ["RANGER"],
    minModelYear: 2019,
    sampleModelYear: 2022,
    sampleSize: 1399,
    lowVolume: false,
  },
  "Honda Pilot": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["PILOT"],
    sampleModelYear: 2017,
    sampleSize: 6604,
    lowVolume: false,
  },
  "Mini Countryman": {
    derivable: true,
    makeCode: "MINI",
    modelNames: ["COUNTRYMAN", "COOPERCOUNTRYMAN"],
    sampleModelYear: 2018,
    sampleSize: 542,
    lowVolume: true,
  },
  "Toyota Sequoia": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["SEQUOIA"],
    sampleModelYear: 2017,
    sampleSize: 164,
    lowVolume: true,
  },
  "Hyundai Palisade": {
    derivable: true,
    makeCode: "HYUND",
    modelNames: ["PALISADE"],
    sampleModelYear: 2022,
    sampleSize: 2626,
    lowVolume: false,
  },
  "Chrysler Pacifica": {
    derivable: true,
    makeCode: "CHRYS",
    modelNames: ["PACIFICA"],
    sampleModelYear: 2021,
    sampleSize: 2003,
    lowVolume: false,
  },
  "Chevy Colorado": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["COLORADO"],
    sampleModelYear: 2020,
    sampleSize: 2354,
    lowVolume: false,
  },
  "Kia Telluride": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["TELLURIDE"],
    sampleModelYear: 2022,
    sampleSize: 4114,
    lowVolume: false,
  },
  "Mazda CX-90": {
    derivable: true,
    makeCode: "MAZDA",
    modelNames: ["CX90"],
    sampleModelYear: 2024,
    sampleSize: 4790,
    lowVolume: false,
  },
  "Chevy Traverse": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["TRAVERSE"],
    sampleModelYear: 2021,
    sampleSize: 6280,
    lowVolume: false,
  },
  "VW Atlas": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["ATLAS"],
    sampleModelYear: 2021,
    sampleSize: 3885,
    lowVolume: false,
  },
  "Ford Explorer": {
    derivable: true,
    makeCode: "FORD",
    modelNames: ["EXPLORER"],
    sampleModelYear: 2018,
    sampleSize: 8114,
    lowVolume: false,
  },
  "Buick Enclave": {
    derivable: true,
    makeCode: "BUICK",
    modelNames: ["ENCLAVE"],
    sampleModelYear: 2017,
    sampleSize: 1069,
    lowVolume: false,
  },
  "Volvo XC60": {
    derivable: true,
    makeCode: "VOLVO",
    modelNames: ["XC60"],
    sampleModelYear: 2021,
    sampleSize: 2041,
    lowVolume: false,
  },
  "Chevy Tahoe": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["TAHOE"],
    sampleModelYear: 2020,
    sampleSize: 1672,
    lowVolume: false,
  },
  "Jeep Grand Cherokee L": {
    derivable: true,
    makeCode: "JEEP",
    modelNames: ["GRANDCHEROKEEL"],
    sampleModelYear: 2023,
    sampleSize: 7942,
    lowVolume: false,
  },
  "Volvo V90 Cross Country": {
    derivable: true,
    makeCode: "VOLVO",
    modelNames: ["V90CROSSCOUNTRY"],
    sampleModelYear: 2021,
    sampleSize: 39,
    lowVolume: true,
  },
  "Chevy Suburban": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["SUBURBAN"],
    sampleModelYear: 2020,
    sampleSize: 1169,
    lowVolume: false,
  },
  "Volvo XC90": {
    derivable: true,
    makeCode: "VOLVO",
    modelNames: ["XC90"],
    sampleModelYear: 2020,
    sampleSize: 1555,
    lowVolume: false,
  },
  "Porsche 996 Carrera": {
    derivable: false,
    reason: PORSCHE_996_UNDERIVABLE_REASON,
  },
  "Porsche 996 Turbo": {
    derivable: false,
    reason: PORSCHE_996_UNDERIVABLE_REASON,
  },

  // 71->100 seed expansion (2026-08), researched per-vehicle against the live
  // NY DMV dataset — see ROADMAP.md's 100-model rollout entry.
  "GMC Sierra 1500": {
    derivable: true,
    makeCode: "GMC",
    modelNames: ["SIERRA1500", "SIERRA1500LIMITED"],
    sampleModelYear: 2025,
    sampleSize: 6185,
    lowVolume: false,
  },
  "Ram 1500": {
    derivable: true,
    makeCode: "RAM",
    modelNames: ["1500", "RAMPICKUP1500"],
    sampleModelYear: 2021,
    sampleSize: 12775,
    lowVolume: false,
  },
  "Dodge Durango": {
    derivable: true,
    makeCode: "DODGE",
    modelNames: ["DURANGO"],
    sampleModelYear: 2023,
    sampleSize: 3854,
    lowVolume: false,
  },
  "Cadillac XT5": {
    derivable: true,
    makeCode: "CADIL",
    modelNames: ["XT5"],
    sampleModelYear: 2025,
    sampleSize: 2012,
    lowVolume: false,
  },
  "Lincoln Corsair": {
    derivable: true,
    makeCode: "LINCO",
    modelNames: ["CORSAIR"],
    sampleModelYear: 2022,
    sampleSize: 2268,
    lowVolume: false,
  },
  "Acura RDX": {
    derivable: true,
    makeCode: "ACURA",
    modelNames: ["RDX"],
    sampleModelYear: 2022,
    sampleSize: 1824,
    lowVolume: false,
  },
  "Lexus RX": {
    derivable: true,
    makeCode: "LEXUS",
    modelNames: ["RX350"],
    sampleModelYear: 2020,
    sampleSize: 3755,
    lowVolume: false,
  },
  "Infiniti QX60": {
    derivable: true,
    makeCode: "INFIN",
    modelNames: ["QX60", "QX60HYBRID"],
    sampleModelYear: 2020,
    sampleSize: 2558,
    lowVolume: false,
  },
  "Audi Q5": {
    derivable: true,
    makeCode: "AUDI",
    modelNames: ["Q5"],
    sampleModelYear: 2023,
    sampleSize: 4314,
    lowVolume: false,
  },
  "BMW X3": {
    derivable: true,
    makeCode: "BMW",
    modelNames: ["X3"],
    sampleModelYear: 2023,
    sampleSize: 4053,
    lowVolume: false,
  },
  "Mercedes-Benz GLC": {
    derivable: true,
    makeCode: "ME/BE",
    modelNames: ["GLC"],
    sampleModelYear: 2022,
    sampleSize: 4718,
    lowVolume: false,
  },
  "Genesis GV70": {
    derivable: true,
    makeCode: "GENES",
    modelNames: ["GV70"],
    sampleModelYear: 2023,
    sampleSize: 1297,
    lowVolume: false,
  },
  "Mitsubishi Outlander": {
    derivable: true,
    makeCode: "MITSU",
    modelNames: ["OUTLANDER"],
    sampleModelYear: 2018,
    sampleSize: 1541,
    lowVolume: false,
  },
  "Ford F-150": {
    derivable: true,
    makeCode: "FORD",
    modelNames: ["F150"],
    sampleModelYear: 2022,
    sampleSize: 9053,
    lowVolume: false,
  },
  "Chevy Silverado 1500": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["SILVERADO1500"],
    sampleModelYear: 2024,
    sampleSize: 16709,
    lowVolume: false,
  },
  "Toyota Tundra": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["TUNDRA"],
    sampleModelYear: 2019,
    sampleSize: 2841,
    lowVolume: false,
  },
  "Jeep Wrangler": {
    derivable: true,
    makeCode: "JEEP",
    modelNames: ["WRANGLER", "WRANGLERUNLIMITED"],
    sampleModelYear: 2023,
    sampleSize: 7613,
    lowVolume: false,
  },
  "Jeep Grand Cherokee": {
    derivable: true,
    makeCode: "JEEP",
    modelNames: ["GRANDCHEROKEE", "GRANDCHEROKEEWK"],
    sampleModelYear: 2023,
    sampleSize: 13266,
    lowVolume: false,
  },
  "Chevy Trax": {
    derivable: true,
    makeCode: "CHEVR",
    modelNames: ["TRAX"],
    sampleModelYear: 2025,
    sampleSize: 14413,
    lowVolume: false,
  },
  "Nissan Altima": {
    derivable: true,
    makeCode: "NISSA",
    modelNames: ["ALTIMA"],
    sampleModelYear: 2023,
    sampleSize: 4783,
    lowVolume: false,
  },
  "Nissan Sentra": {
    derivable: true,
    makeCode: "NISSA",
    modelNames: ["SENTRA"],
    sampleModelYear: 2021,
    sampleSize: 4217,
    lowVolume: false,
  },
  "Mazda CX-30": {
    derivable: true,
    makeCode: "MAZDA",
    modelNames: ["CX30"],
    sampleModelYear: 2024,
    sampleSize: 9919,
    lowVolume: false,
  },
  "Subaru Crosstrek": {
    derivable: true,
    makeCode: "SUBAR",
    modelNames: ["CROSSTREK", "XVCROSSTREK"],
    sampleModelYear: 2025,
    sampleSize: 13703,
    lowVolume: false,
  },
  "Kia Seltos": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["SELTOS"],
    sampleModelYear: 2025,
    sampleSize: 3999,
    lowVolume: false,
  },
  "Kia Forte": {
    derivable: true,
    makeCode: "KIA",
    modelNames: ["FORTE", "FORTE5", "FORTE5DOOR", "FORTEKOUP"],
    sampleModelYear: 2023,
    sampleSize: 7169,
    lowVolume: false,
  },
  "Toyota Corolla Cross": {
    derivable: true,
    makeCode: "TOYOT",
    modelNames: ["COROLLACROSS"],
    sampleModelYear: 2023,
    sampleSize: 2792,
    lowVolume: false,
  },
  "Honda HR-V": {
    derivable: true,
    makeCode: "HONDA",
    modelNames: ["HRV"],
    sampleModelYear: 2025,
    sampleSize: 13010,
    lowVolume: false,
  },
  "VW Jetta": {
    derivable: true,
    makeCode: "VOLKS",
    modelNames: ["JETTA"],
    sampleModelYear: 2019,
    sampleSize: 6964,
    lowVolume: false,
  },
  "Tesla Model Y": {
    derivable: true,
    makeCode: "TESLA",
    modelNames: ["MODELY"],
    sampleModelYear: 2023,
    sampleSize: 19046,
    lowVolume: false,
  },
};

/** Seed vehicles whose NY DMV mapping involved a judgment call — disclosed
 *  here, never silently resolved. Mirrors the `MAPPING_NOTES` convention in
 *  `corpus.ts`; substance transcribed from doc §2. */
export const MAPPING_NOTES: Record<string, string> = {
  "Toyota Sienna (V6)":
    "Same DMV model_name as Toyota Sienna Hybrid ('SIENNA') — the fuel_type/hybrid columns don't " +
    "create a usable split within a single SIENNA model-year either (queried MY2022: GASOLINE/" +
    "hybrid=TRUE dominates, 48,519 of 49,170, correctly confirming the car IS a hybrid, not " +
    "distinguishing anything). Separated ONLY by model-year window (<=2020 V6, 2021+ hybrid-only), " +
    "exactly like the existing NHTSA mapping's Sienna note.",
  "Toyota Sienna Hybrid":
    "MY2021+ Sienna is hybrid-only, so this row and the V6 row can never overlap in model year.",
  "Ford Ranger (old compact)":
    "Same DMV model_name as the 2019+ midsize ('RANGER'). Verified the production gap directly by " +
    "year: 2001-2011 real volume, 2012-2018 genuinely empty (2015 n=1, 2016 n=2, else 0), 2019-2026 " +
    "real volume resumes. Separated ONLY by model-year window — identical situation to the existing " +
    "NHTSA mapping.",
  "Ford Ranger (2019+ midsize)": "See 'old compact' note; the model-year window is the only discriminator.",
  "Hyundai Santa Fe":
    "'SANTAFE' spans two physically different cars over the seed window: MY2013-2018 it's the 3-row " +
    "Santa Fe (the 2-row of those years files as the separate string 'SANTAFESPORT', excluded, " +
    "mirroring the NHTSA note's 'SANTA FE SPORT' exclusion); MY2019+ 'SANTAFE' becomes the new " +
    "mid-size 2-row (the true 3-row for those two years is 'SANTAFEXL', also excluded). This is the " +
    "same cross-generation ambiguity already documented for NHTSA, reproduced independently here.",
  "Mini Cooper":
    "The base Cooper hatchback's string changes generation to generation: 'COOPER' (2002-2011, real " +
    "volume), 'COOPERHARDTOP' (2012 only, a one-year transitional label), then " +
    "'HARDTOP2DOOR'/'HARDTOP4DOOR' (2013-2026) — 'COOPER' drops to noise (n<=11) after 2012, the " +
    "same pattern the NHTSA MAPPING_NOTES entry describes ('drops COOPER entirely in MY2021'), just " +
    "shifted a decade earlier in this dataset. CLUBMAN/CONVERTIBLE/COUNTRYMAN/PACEMAN/ROADSTER/COUPE " +
    "excluded to match the existing NHTSA convention.",
  "Toyota Prius Prime":
    "'PRIUSPRIME' is the dominant string MY2017-2024; DMV then reverts to 'PRIUSPLUGINHYBRID' for " +
    "MY2025-2026 (verified by year breakdown) — DMV's mid-life string rename. Both matched. Note " +
    "'PRIUSPLUGINHYBRID' was ALSO used MY2007-2015 for the unrelated first-generation Prius " +
    "Plug-in Hybrid, outside this seed row's first_year=2017 window, so no overlap.",
  "Toyota RAV4 Prime":
    "Same pattern as Prius Prime: 'RAV4PRIME' MY2021-2024, 'RAV4PLUGINHYBRID' takes over " +
    "MY2025-2026 (verified by year breakdown). Both matched.",
  "Chrysler Pacifica PHEV":
    "'PACIFICAHYBRID' MY2017-2023 (stray n=1 in 2026), 'PACIFICAPLUGINHYBRID' overlaps and takes " +
    "over from MY2023 through 2026 (verified by year breakdown). Both matched. Same rename pattern " +
    "the existing NHTSA note already documents ('PACIFICA PHEV' -> 'PACIFICA HYBRID'), just with " +
    "different strings and a later transition year.",
  "Hyundai Elantra":
    "Matched ELANTRA + ELANTRAGT (a hatchback body variant), excluding " +
    "ELANTRAHYBRID/ELANTRATOURING/ELANTRACOUPE/ELANTRAN — a direct port of the existing NHTSA " +
    "convention (exact('ELANTRA', 'ELANTRA GT')) rather than an independently re-derived judgment.",
  "Hyundai Kona":
    "Matched bare KONA only. KONAN (a turbo/performance trim of the gas Kona, n=1,204 total) was " +
    "left out for simplicity; volume is too small to matter for the 2025 sample. " +
    "KONAELECTRIC/KONAEV (separate strings, genuinely different powertrain) are correctly excluded.",
  "Toyota Sequoia":
    "The real-world MY2023+ 4th-generation Sequoia is hybrid-standard (i-FORCE MAX), but DMV never " +
    "splits it into a separate string — it's SEQUOIA for the entire 2008-2026 window with no hybrid " +
    "flag distinguishing it from the earlier V8-only generations. The seed row's etype=gas is not " +
    "strictly accurate for its own most recent model years in this dataset; there is no way to carve " +
    "that out by model_name.",
  "Porsche 996 Carrera": PORSCHE_996_UNDERIVABLE_REASON,
  "Porsche 996 Turbo": PORSCHE_996_UNDERIVABLE_REASON,
  "Buick Encore":
    "'ENCORE' has real volume MY2013-2022 (2,650-29,592/yr) then collapses to n=1/yr MY2023-2026, " +
    "because Buick discontinued the original Encore after MY2022 and replaced it with the " +
    "differently-platformed 'ENCOREGX' (excluded here as a different vehicle — different chassis, " +
    "not a trim of the original Encore). The seed row's last_year=2026 should NOT be read as 'no " +
    "data' for 2023-2026 — the physical car mapped to this row stopped being sold, the same " +
    "distinction the existing KNOWN_EMPTY_MODEL_YEARS convention in corpus.ts draws for Fiat " +
    "500/500X/V90 CC.",
  "VW Tiguan":
    "'TIGUANLIMITED' (first-generation Tiguan sold at clearance pricing alongside the genuinely-new " +
    "second-generation 'TIGUAN' for one transition year, MY2018 plus stray rows) is excluded — it's " +
    "the outgoing car, not a trim of the current one.",
  "Chevy Traverse":
    "'TRAVERSELIMITED' (MY2024 only) is the same old-generation continuation pattern GM used for " +
    "Malibu/Impala/Cruze. Excluded for the same reason as Tiguan Limited.",
};

/** Given a seed vehicle's exact `name` (as in opencawr_data.json), returns
 *  its NY DMV query parameters or a typed "not derivable" result. Throws
 *  (rather than silently returning `undefined`) for any name not in the
 *  corpus at all — a typo here would otherwise produce a silent gap the same
 *  way an unmapped NHTSA name would. */
export function eolQueryFor(name: string): EolCorpusEntry {
  const entry = CORPUS_EOL[name];
  if (!entry) {
    throw new Error(`No NY DMV EOL mapping for seed vehicle "${name}" (see corpus-eol.ts)`);
  }
  return entry;
}
