/** THROWAWAY. NHTSA model-string alias matchers per seed vehicle.
 *
 *  NHTSA's own model catalogue (api.nhtsa.gov/products/vehicle/models) is
 *  trim- and body-style-fragmented AND inconsistent year to year (e.g. FORD
 *  RANGER is "RANGER" in 2019-2020 but "RANGER SUPER CAB"/"RANGER SUPER CREW"
 *  in 2021-2022; VOLVO XC60 is "XC60" in 2017, "XC60 T5|T6|T8" in 2018-2021,
 *  "XC60 B5 AWD|B5 FWD|B6 AWD" in 2022). A single model string therefore
 *  silently returns ZERO complaints for some years of a model that plainly had
 *  complaints. Each seed vehicle gets an include/exclude predicate applied to
 *  that year's real catalogue instead; complaints are unioned and de-duplicated
 *  by ODI number across the matched strings. */

export type Matcher = (m: string) => boolean;

const exact = (...names: string[]): Matcher => {
  const set = new Set(names.map((n) => n.toUpperCase()));
  return (m) => set.has(m.toUpperCase());
};
const re = (pattern: RegExp, not?: RegExp): Matcher => (m) =>
  pattern.test(m.toUpperCase()) && !(not?.test(m.toUpperCase()) ?? false);

export const MATCHERS: Record<string, Matcher> = {
  "Chevy Bolt EV": re(/^BOLT( EV)?$/),
  "Chevy Volt": exact("VOLT"),
  "Toyota Prius (hybrid)": exact("PRIUS"),
  "Toyota Prius Prime": exact("PRIUS PRIME", "PRIUS PLUG-IN HYBRID"),
  "Toyota Corolla": exact("COROLLA"),
  "Toyota Camry Hybrid": exact("CAMRY HYBRID"),
  "Honda Civic": exact("CIVIC", "CIVIC HATCH", "CIVIC HATCHBACK", "CIVIC SI", "CIVIC SEDAN SI"),
  "Nissan Leaf": re(/^LEAF\b|^LEAF$/),
  "Hyundai Elantra": exact("ELANTRA", "ELANTRA GT"),
  "Honda Accord": exact("ACCORD"),
  "Kia K4": exact("K4", "K4 5DR"),
  "Mazda3 (SkyActiv)": exact("MAZDA3", "MAZDA3 SEDAN", "MAZDA3 HATCHBACK"),
  "Toyota Camry": exact("CAMRY"),
  "Toyota RAV4 Hybrid": exact("RAV4 HYBRID", "RAV4 HV"),
  "Kia Niro (hybrid)": exact("NIRO", "NIRO HYBRID", "NIRO HEV"),
  "Tesla Model 3": exact("MODEL 3"),
  "Hyundai Sonata": exact("SONATA"),
  "Toyota RAV4": exact("RAV4"),
  "Fiat 500": exact("500", "500 CABRIO"),
  "Honda CR-V": exact("CR-V"),
  "VW ID.4 (AWD avail)": exact("ID.4"),
  "Toyota RAV4 Prime": exact("RAV4 PRIME"),
  "Kia Soul": exact("SOUL"),
  "VW Passat": exact("PASSAT"),
  "Buick Encore": exact("ENCORE"),
  "Hyundai Kona": exact("KONA"),
  "Mazda CX-5": exact("CX-5"),
  "Toyota Highlander Hybrid": exact("HIGHLANDER HYBRID"),
  "Subaru Outback": exact("OUTBACK"),
  "Subaru Forester": exact("FORESTER"),
  "Toyota Sienna Hybrid": exact("SIENNA HYBRID"),
  "Toyota Tacoma": exact("TACOMA"),
  "Nissan Rogue": exact("ROGUE"),
  "Chevy Equinox": exact("EQUINOX"),
  "Toyota Sienna (V6)": exact("SIENNA"),
  "Mini Cooper": exact("COOPER", "COOPER S", "HARDTOP", "HARDTOP 2DR", "HARDTOP 4DR"),
  "Ford Ranger (old compact)": re(/^RANGER( REGULAR| SUPERCAB| SUPER CAB| SUPER CREW)?$/),
  "Fiat 500X": exact("500X"),
  "VW GTI": exact("GOLF GTI", "GTI"),
  "Kia Sportage": exact("SPORTAGE"),
  "Ford Escape": exact("ESCAPE"),
  "Toyota Highlander": exact("HIGHLANDER"),
  "Hyundai Tucson": exact("TUCSON"),
  "Toyota 4Runner": exact("4RUNNER"),
  "Honda Odyssey": exact("ODYSSEY"),
  "Kia Sorento": exact("SORENTO"),
  "Hyundai Santa Fe": exact("SANTA FE"),
  "VW Tiguan": exact("TIGUAN"),
  "Chrysler Pacifica PHEV": exact("PACIFICA PHEV", "PACIFICA HYBRID"),
  "Subaru Ascent": exact("ASCENT"),
  "Ford Ranger (2019+ midsize)": re(/^RANGER( SUPER CAB| SUPER CREW)?$/),
  "Honda Pilot": exact("PILOT"),
  "Mini Countryman": exact("COUNTRYMAN"),
  "Toyota Sequoia": exact("SEQUOIA"),
  "Hyundai Palisade": exact("PALISADE"),
  "Chrysler Pacifica": exact("PACIFICA"),
  "Chevy Colorado": exact("COLORADO"),
  "Kia Telluride": exact("TELLURIDE"),
  "Mazda CX-90": exact("CX-90", "CX-90 MHEV", "CX-90-MHEV"),
  "Chevy Traverse": exact("TRAVERSE"),
  "VW Atlas": exact("ATLAS"),
  "Ford Explorer": exact("EXPLORER"),
  "Buick Enclave": exact("ENCLAVE"),
  "Volvo XC60": re(/^XC60\b|^XC60$/, /T8|PHEV|RECHARGE|POLESTAR/),
  "Chevy Tahoe": exact("TAHOE"),
  "Jeep Grand Cherokee L": exact("GRAND CHEROKEE L"),
  "Volvo V90 Cross Country": re(/^V90 ?CC\b|^V90 ?CC$/),
  "Chevy Suburban": exact("SUBURBAN", "SUBURBAN 1500"),
  "Volvo XC90": re(/^XC90\b|^XC90$/, /T8|XC90H|RECHARGE|POLESTAR/),
  "Porsche 996 Carrera": re(/^911( CARRERA| CARRERA\/| CARRERA 4S)/, /TURBO|GT2|GT3/),
  "Porsche 996 Turbo": re(/^911 (TURBO|GT)/),
};

/** Seed vehicles whose NHTSA mapping is genuinely ambiguous — reported, never silently dropped. */
export const MAPPING_NOTES: Record<string, string> = {
  "Toyota Sienna (V6)":
    "same NHTSA model string as Toyota Sienna Hybrid ('SIENNA'); separated ONLY by year window (<=2020 V6, 2021+ hybrid-only). NHTSA also emits a junk 'REDUNDANT SIENNA' string for 2021-22, excluded.",
  "Ford Ranger (old compact)":
    "same NHTSA model token as the 2019+ midsize; separated ONLY by year window (2006-2011 vs 2019-2022). NHTSA has NO Ford models at all for MY2018 (catalogue gap), and splits Ranger into body-style strings in 2010 and 2021-22.",
  "Ford Ranger (2019+ midsize)": "see 'old compact' note; year window is the only discriminator.",
  "Porsche 996 Carrera":
    "NHTSA's 911 strings are inconsistent per year ('911', '911 CARRERA', '911 CARRERA/CARRERA CABRIO', '911 CARRERA 4S/CARRERA 4 CABRIO'), and for MY1999-2001 a bare '911' string exists that could be either trim. Bare '911' is assigned to NEITHER Porsche row (would double-count). sport tier is never derived, so this does not affect any tier.",
  "Porsche 996 Turbo": "see 996 Carrera note; NHTSA bundles GT2/GT3/Targa with Turbo in 2002-2004.",
  "Chrysler Pacifica PHEV":
    "NHTSA renamed the string mid-life: 'PACIFICA PHEV' MY2017-2019, 'PACIFICA HYBRID' MY2020+. Both matched.",
  "Kia Niro (hybrid)":
    "NHTSA lists NIRO HYBRID / NIRO PLUG-IN HYBRID / NIRO ELECTRIC separately in MY2017-2020, then a bare 'NIRO' from MY2021. Bare 'NIRO' is included (it is the pooled string) — for MY2021-22 this may fold some PHEV/EV complaints into the hybrid row.",
  "Hyundai Santa Fe":
    "MY2017-2018 'SANTA FE' is the 3-row (later Santa Fe XL); the 2-row of those years is 'SANTA FE SPORT' and is excluded. The seed row spans both generations, so the pre-2019 years describe a physically larger vehicle than the post-2019 ones.",
  "Chevy Bolt EV": "'BOLT' MY2017-2018, 'BOLT EV' MY2019+. 'BOLT EUV' (a different vehicle) excluded.",
  "Mini Cooper":
    "NHTSA uses COOPER / COOPER S / HARDTOP / HARDTOP 2DR / HARDTOP 4DR interchangeably across years, and drops 'COOPER' entirely in MY2021. All hardtop strings matched; CLUBMAN / CONVERTIBLE / COUNTRYMAN / JCW / COOPER SE (EV) excluded.",
  "Volvo XC60": "NHTSA has no bare 'XC60' after MY2017 — only trim strings. T8/Recharge/Polestar (PHEV) excluded to match the seed row's etype=gas.",
  "Volvo XC90": "as XC60; 'XC90H'/'T8'/'Recharge' (PHEV) excluded.",
  "Volvo V90 Cross Country": "'V90 CC' and 'V90CC' both appear; plain 'V90 T5/T6' (non-Cross-Country wagon) excluded.",
  "Toyota Sienna Hybrid": "MY2021+ Sienna is hybrid-only, so this row and the V6 row can never overlap in year.",
  "Kia K4": "MY2025+ only — almost no complaint history exists yet. Seed row is already provenance='proxied'.",
  "Mazda CX-90": "MY2024+ only; NHTSA writes it 'CX-90-MHEV' in 2024 and 'CX-90 MHEV'/'CX-90' later. PHEV excluded (seed etype=gas).",
  "VW GTI": "'GOLF GTI' and 'GTI' both appear in MY2018-2019; both matched and de-duplicated by ODI number.",
  "Chevy Suburban": "'SUBURBAN 1500' MY2016-2021, 'SUBURBAN' MY2021+; both matched.",
};
