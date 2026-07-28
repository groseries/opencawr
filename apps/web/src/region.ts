/**
 * ZIP → state regionalization: per-state gas price, electricity price, vehicle
 * sales/use tax rate, and annual registration fee, used to prefill the four
 * region-dependent `EngineInputs` fields from the intake card's ZIP question.
 * This is an optional overlay on top of `controls.tsx`'s `DEFAULTS` — nothing
 * here changes the app's baseline defaults, and every value stays editable in
 * the Assumptions rail afterward.
 *
 * Sources (see ASSUMPTIONS.md §G for the full write-up):
 *  - gasUsdPerGal    — AAA state average retail regular-gasoline price (snapshot).
 *  - elecUsdPerKwh   — EIA state average electricity price, all sectors, as
 *    compiled/republished by ElectricChoice.com's EIA-sourced state table.
 *  - useTaxRate      — state Department of Revenue / DMV published vehicle
 *    sales-or-use tax rate (statewide statutory rate; local/county add-ons,
 *    which can add several more points in some states, are not modeled).
 *  - registrationUsdYr — midpoint of the state DMV's published base annual
 *    vehicle registration fee range (autoinsurance.org compilation); excludes
 *    one-time title/plate fees and any separate ad valorem vehicle property
 *    tax some states charge (e.g. CT, VA, MS) — those are a distinct, harder
 *    to generalize recurring cost, flagged as an open item in the ledger.
 * Snapshot date: 2026-07-27/28 — real-world prices drift; re-pull periodically.
 */
export interface RegionRow {
  state: string;
  gasUsdPerGal: number;
  elecUsdPerKwh: number;
  useTaxRate: number;
  registrationUsdYr: number;
  sources: string;
}

const SOURCES =
  "gas: AAA state avg retail regular (Jul 2026) · elec: EIA state avg all-sector price via ElectricChoice.com (Jul 2026) · use tax: state DOR/DMV published vehicle sales-or-use tax rate, statewide statutory rate · registration: midpoint of state DMV published base annual registration fee range (autoinsurance.org)";

const SOURCES_DC =
  "gas: AAA DC avg retail regular (Jul 2026) · elec: EIA DC avg all-sector price via ElectricChoice.com (Jul 2026) · use tax: DC OTR published ~6% vehicle excise tax (DC not in the compiled 50-state tax table; estimated separately) · registration: DC DMV published base fee, averaged (DC not in the compiled 50-state registration table; estimated separately)";

/** Per-state region data, keyed by two-letter USPS state code (+ DC). */
export const REGION_BY_STATE: Record<string, RegionRow> = {
  AL: { state: "AL", gasUsdPerGal: 3.78, elecUsdPerKwh: 0.1741, useTaxRate: 0.02, registrationUsdYr: 54, sources: SOURCES },
  AK: { state: "AK", gasUsdPerGal: 4.74, elecUsdPerKwh: 0.2735, useTaxRate: 0, registrationUsdYr: 150, sources: SOURCES },
  AZ: { state: "AZ", gasUsdPerGal: 4.41, elecUsdPerKwh: 0.1548, useTaxRate: 0.056, registrationUsdYr: 64, sources: SOURCES },
  AR: { state: "AR", gasUsdPerGal: 3.80, elecUsdPerKwh: 0.1416, useTaxRate: 0.065, registrationUsdYr: 24, sources: SOURCES },
  CA: { state: "CA", gasUsdPerGal: 5.65, elecUsdPerKwh: 0.3525, useTaxRate: 0.0725, registrationUsdYr: 380, sources: SOURCES },
  CO: { state: "CO", gasUsdPerGal: 4.08, elecUsdPerKwh: 0.1654, useTaxRate: 0.029, registrationUsdYr: 82.5, sources: SOURCES },
  CT: { state: "CT", gasUsdPerGal: 4.21, elecUsdPerKwh: 0.3224, useTaxRate: 0.0635, registrationUsdYr: 165, sources: SOURCES },
  DE: { state: "DE", gasUsdPerGal: 4.17, elecUsdPerKwh: 0.1879, useTaxRate: 0, registrationUsdYr: 55, sources: SOURCES },
  DC: { state: "DC", gasUsdPerGal: 4.23, elecUsdPerKwh: 0.2541, useTaxRate: 0.06, registrationUsdYr: 100, sources: SOURCES_DC },
  FL: { state: "FL", gasUsdPerGal: 3.97, elecUsdPerKwh: 0.1538, useTaxRate: 0.06, registrationUsdYr: 47, sources: SOURCES },
  GA: { state: "GA", gasUsdPerGal: 3.92, elecUsdPerKwh: 0.1537, useTaxRate: 0.07, registrationUsdYr: 77.5, sources: SOURCES },
  HI: { state: "HI", gasUsdPerGal: 5.43, elecUsdPerKwh: 0.4662, useTaxRate: 0.04, registrationUsdYr: 147.5, sources: SOURCES },
  ID: { state: "ID", gasUsdPerGal: 4.24, elecUsdPerKwh: 0.1270, useTaxRate: 0.06, registrationUsdYr: 59, sources: SOURCES },
  IL: { state: "IL", gasUsdPerGal: 4.26, elecUsdPerKwh: 0.2047, useTaxRate: 0.0625, registrationUsdYr: 151, sources: SOURCES },
  IN: { state: "IN", gasUsdPerGal: 3.49, elecUsdPerKwh: 0.1790, useTaxRate: 0.07, registrationUsdYr: 25.5, sources: SOURCES },
  IA: { state: "IA", gasUsdPerGal: 3.77, elecUsdPerKwh: 0.1386, useTaxRate: 0.05, registrationUsdYr: 87.5, sources: SOURCES },
  KS: { state: "KS", gasUsdPerGal: 3.75, elecUsdPerKwh: 0.1578, useTaxRate: 0.075, registrationUsdYr: 69.5, sources: SOURCES },
  KY: { state: "KY", gasUsdPerGal: 3.74, elecUsdPerKwh: 0.1502, useTaxRate: 0.06, registrationUsdYr: 41, sources: SOURCES },
  LA: { state: "LA", gasUsdPerGal: 3.70, elecUsdPerKwh: 0.1444, useTaxRate: 0.05, registrationUsdYr: 51.5, sources: SOURCES },
  ME: { state: "ME", gasUsdPerGal: 4.10, elecUsdPerKwh: 0.2842, useTaxRate: 0.055, registrationUsdYr: 45, sources: SOURCES },
  MD: { state: "MD", gasUsdPerGal: 4.18, elecUsdPerKwh: 0.2207, useTaxRate: 0.06, registrationUsdYr: 161, sources: SOURCES },
  MA: { state: "MA", gasUsdPerGal: 4.13, elecUsdPerKwh: 0.2945, useTaxRate: 0.0625, registrationUsdYr: 80, sources: SOURCES },
  MI: { state: "MI", gasUsdPerGal: 4.22, elecUsdPerKwh: 0.2139, useTaxRate: 0.06, registrationUsdYr: 164, sources: SOURCES },
  MN: { state: "MN", gasUsdPerGal: 4.04, elecUsdPerKwh: 0.1639, useTaxRate: 0.0688, registrationUsdYr: 90, sources: SOURCES },
  MS: { state: "MS", gasUsdPerGal: 3.67, elecUsdPerKwh: 0.1676, useTaxRate: 0.05, registrationUsdYr: 20, sources: SOURCES },
  MO: { state: "MO", gasUsdPerGal: 3.85, elecUsdPerKwh: 0.1401, useTaxRate: 0.0423, registrationUsdYr: 30.5, sources: SOURCES },
  MT: { state: "MT", gasUsdPerGal: 4.30, elecUsdPerKwh: 0.1390, useTaxRate: 0, registrationUsdYr: 122.5, sources: SOURCES },
  NE: { state: "NE", gasUsdPerGal: 3.96, elecUsdPerKwh: 0.1328, useTaxRate: 0.055, registrationUsdYr: 54, sources: SOURCES },
  NV: { state: "NV", gasUsdPerGal: 4.79, elecUsdPerKwh: 0.1429, useTaxRate: 0.0685, registrationUsdYr: 87, sources: SOURCES },
  NH: { state: "NH", gasUsdPerGal: 4.07, elecUsdPerKwh: 0.2724, useTaxRate: 0, registrationUsdYr: 51, sources: SOURCES },
  NJ: { state: "NJ", gasUsdPerGal: 4.19, elecUsdPerKwh: 0.2353, useTaxRate: 0.0663, registrationUsdYr: 66, sources: SOURCES },
  NM: { state: "NM", gasUsdPerGal: 3.98, elecUsdPerKwh: 0.1515, useTaxRate: 0.04, registrationUsdYr: 44.5, sources: SOURCES },
  NY: { state: "NY", gasUsdPerGal: 4.23, elecUsdPerKwh: 0.2945, useTaxRate: 0.04, registrationUsdYr: 83, sources: SOURCES },
  NC: { state: "NC", gasUsdPerGal: 3.80, elecUsdPerKwh: 0.1625, useTaxRate: 0.03, registrationUsdYr: 66, sources: SOURCES },
  ND: { state: "ND", gasUsdPerGal: 3.91, elecUsdPerKwh: 0.1235, useTaxRate: 0.05, registrationUsdYr: 120, sources: SOURCES },
  OH: { state: "OH", gasUsdPerGal: 3.88, elecUsdPerKwh: 0.1949, useTaxRate: 0.0575, registrationUsdYr: 45.5, sources: SOURCES },
  OK: { state: "OK", gasUsdPerGal: 3.77, elecUsdPerKwh: 0.1331, useTaxRate: 0.045, registrationUsdYr: 104.5, sources: SOURCES },
  OR: { state: "OR", gasUsdPerGal: 4.63, elecUsdPerKwh: 0.1578, useTaxRate: 0, registrationUsdYr: 219, sources: SOURCES },
  PA: { state: "PA", gasUsdPerGal: 4.23, elecUsdPerKwh: 0.2147, useTaxRate: 0.06, registrationUsdYr: 59.5, sources: SOURCES },
  RI: { state: "RI", gasUsdPerGal: 4.13, elecUsdPerKwh: 0.2830, useTaxRate: 0.07, registrationUsdYr: 114, sources: SOURCES },
  SC: { state: "SC", gasUsdPerGal: 3.77, elecUsdPerKwh: 0.1706, useTaxRate: 0.05, registrationUsdYr: 64.5, sources: SOURCES },
  SD: { state: "SD", gasUsdPerGal: 4.02, elecUsdPerKwh: 0.1452, useTaxRate: 0.04, registrationUsdYr: 90, sources: SOURCES },
  TN: { state: "TN", gasUsdPerGal: 3.71, elecUsdPerKwh: 0.1494, useTaxRate: 0.07, registrationUsdYr: 55, sources: SOURCES },
  TX: { state: "TX", gasUsdPerGal: 3.69, elecUsdPerKwh: 0.1699, useTaxRate: 0.0625, registrationUsdYr: 79.5, sources: SOURCES },
  UT: { state: "UT", gasUsdPerGal: 4.14, elecUsdPerKwh: 0.1329, useTaxRate: 0.0696, registrationUsdYr: 130.5, sources: SOURCES },
  VT: { state: "VT", gasUsdPerGal: 4.21, elecUsdPerKwh: 0.2456, useTaxRate: 0.06, registrationUsdYr: 97, sources: SOURCES },
  VA: { state: "VA", gasUsdPerGal: 3.98, elecUsdPerKwh: 0.1738, useTaxRate: 0.0415, registrationUsdYr: 60, sources: SOURCES },
  WA: { state: "WA", gasUsdPerGal: 5.11, elecUsdPerKwh: 0.1436, useTaxRate: 0.068, registrationUsdYr: 95, sources: SOURCES },
  WV: { state: "WV", gasUsdPerGal: 3.88, elecUsdPerKwh: 0.1606, useTaxRate: 0.06, registrationUsdYr: 40.5, sources: SOURCES },
  WI: { state: "WI", gasUsdPerGal: 3.88, elecUsdPerKwh: 0.1921, useTaxRate: 0.05, registrationUsdYr: 80, sources: SOURCES },
  WY: { state: "WY", gasUsdPerGal: 4.14, elecUsdPerKwh: 0.1468, useTaxRate: 0.04, registrationUsdYr: 42, sources: SOURCES },
};

/**
 * ZIP3 → state, as contiguous ranges. USPS assigns ZIP3 prefixes in
 * contiguous blocks per state/territory (the standard public-domain "ZIP
 * Code prefix" chart) — representing that as ~50 ranges is equivalent to
 * enumerating all ~900 individual 3-digit prefixes, just far more
 * maintainable and reviewable than writing each one out. A handful of
 * prefixes are intentionally left unmapped (military APO/FPO 090-098, Puerto
 * Rico/territories, a few single-prefix carve-outs) — an unmapped ZIP simply
 * means the intake card can't resolve a state; it never blocks the user.
 */
const ZIP3_RANGES: { start: number; end: number; state: string }[] = [
  { start: 10, end: 27, state: "MA" },
  { start: 28, end: 29, state: "RI" },
  { start: 30, end: 38, state: "NH" },
  { start: 39, end: 49, state: "ME" },
  { start: 50, end: 59, state: "VT" },
  { start: 60, end: 69, state: "CT" },
  { start: 70, end: 89, state: "NJ" },
  { start: 100, end: 149, state: "NY" },
  { start: 150, end: 196, state: "PA" },
  { start: 197, end: 199, state: "DE" },
  { start: 200, end: 205, state: "DC" },
  { start: 206, end: 219, state: "MD" },
  { start: 220, end: 246, state: "VA" },
  { start: 247, end: 268, state: "WV" },
  { start: 270, end: 289, state: "NC" },
  { start: 290, end: 299, state: "SC" },
  { start: 300, end: 319, state: "GA" },
  { start: 320, end: 349, state: "FL" },
  { start: 350, end: 369, state: "AL" },
  { start: 370, end: 385, state: "TN" },
  { start: 386, end: 397, state: "MS" },
  { start: 398, end: 399, state: "GA" },
  { start: 400, end: 427, state: "KY" },
  { start: 430, end: 459, state: "OH" },
  { start: 460, end: 479, state: "IN" },
  { start: 480, end: 499, state: "MI" },
  { start: 500, end: 528, state: "IA" },
  { start: 530, end: 549, state: "WI" },
  { start: 550, end: 567, state: "MN" },
  { start: 570, end: 577, state: "SD" },
  { start: 580, end: 588, state: "ND" },
  { start: 590, end: 599, state: "MT" },
  { start: 600, end: 629, state: "IL" },
  { start: 630, end: 658, state: "MO" },
  { start: 660, end: 679, state: "KS" },
  { start: 680, end: 693, state: "NE" },
  { start: 700, end: 714, state: "LA" },
  { start: 716, end: 729, state: "AR" },
  { start: 730, end: 749, state: "OK" },
  { start: 750, end: 799, state: "TX" },
  { start: 800, end: 816, state: "CO" },
  { start: 820, end: 831, state: "WY" },
  { start: 832, end: 838, state: "ID" },
  { start: 840, end: 847, state: "UT" },
  { start: 850, end: 865, state: "AZ" },
  { start: 870, end: 884, state: "NM" },
  { start: 889, end: 898, state: "NV" },
  { start: 900, end: 961, state: "CA" },
  { start: 967, end: 968, state: "HI" },
  { start: 970, end: 979, state: "OR" },
  { start: 980, end: 994, state: "WA" },
  { start: 995, end: 999, state: "AK" },
];

/** Resolves the first 3 digits of a ZIP to a state code, or null if the ZIP
 * doesn't parse or falls in an unmapped range. */
export function stateForZip(zip: string): string | null {
  const match = /^(\d{3})/.exec(zip.trim());
  if (!match) return null;
  const prefix = Number(match[1]);
  const hit = ZIP3_RANGES.find((r) => prefix >= r.start && prefix <= r.end);
  return hit ? hit.state : null;
}

/** Resolves a ZIP straight to its region data, or null if unrecognized. */
export function regionForZip(zip: string): RegionRow | null {
  const state = stateForZip(zip);
  return state ? (REGION_BY_STATE[state] ?? null) : null;
}
