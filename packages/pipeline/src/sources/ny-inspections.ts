/** New York State DMV Vehicle Inspections adapter (free, keyless), via the
 *  Socrata SODA API: https://data.ny.gov/resource/vezn-fmmk.json — one row
 *  per NY State vehicle inspection, inspection dates 2020-12-29 to present.
 *
 *  NY-STATE-ONLY: this dataset only reflects vehicles inspected in New York,
 *  not a national fleet sample — don't treat its counts/medians as
 *  nationally representative.
 *
 *  Licence position (Open NY): no attribution, share-alike, or
 *  pre-approval is required; reuse is unrestricted for lawful purposes.
 *
 *  API traps discovered by curling the live endpoint (see also ASSUMPTIONS.md-
 *  style rationale kept here since this is the only file that talks to it):
 *   - No `$limit` cap found up to 500,000 rows (tested live). But the
 *     *default* limit with no `$limit` param at all is a silent 1000 rows —
 *     every raw-row query here must pass an explicit `$limit`. Aggregate
 *     queries (`count`, `median`) always return exactly one row regardless.
 *   - `count(distinct vin)` returns an exact count, not a HyperLogLog-style
 *     approximation, at least at the row counts this adapter deals with:
 *     spot-checked TOYOT/CAMRY/model_year=2013/calendar-year=2023 gave
 *     `{"total":"8183","distinct_vins":"6747"}`, consistent with repeat
 *     inspections of the same cars within a year.
 *   - SoQL DOES have a genuine `median()` aggregate (contrary to the naive
 *     assumption that Socrata only offers avg/min/max) — verified it exactly
 *     matches a client-side sorted-array median on the same `$where` slice
 *     (132-row TOYOT/CAMRY/2013/Jan-2023 slice: server `median()` = 107078,
 *     client-computed median of all 132 values = 107078), and it stays fast
 *     (~2.4s) even over a 300k+ row slice (all-years TOYOT/CAMRY). So
 *     `medianOdometer` below computes it server-side instead of pulling a
 *     client-side sample.
 *   - `median()` (and presumably other aggregates) return an EMPTY object
 *     `{}` — the `med` key is simply absent — when zero rows match, not
 *     `{"med":null}`. Must guard for the key missing, not just for null.
 *   - `between 'YYYY-MM-DD' and 'YYYY-MM-DD'` (bare dates, no time-of-day) is
 *     interpreted as midnight-to-midnight and silently drops any inspection
 *     that happened later in the end day: bare-date bounds gave `n=8181` vs.
 *     `n=8183` for the same slice with full `T00:00:00`/`T23:59:59`
 *     timestamps. Always use full timestamps for calendar-year windows.
 *   - `make_code` (and likely `model_name`) are case-sensitive exact-match
 *     strings: `make_code='toyot'` returns 0 rows while `make_code='TOYOT'`
 *     returns 1.3M+ — inputs are upper-cased before querying.
 *   - `odometer_reading` contains real data-entry noise: readings of 0 (5
 *     rows in one spot-checked slice) and implausibly high values (up to
 *     1,386,406 observed live) — filtered out server-side in `medianOdometer`
 *     via `odometer_reading>0 AND odometer_reading<=1000000`.
 *   - No app token/auth is required, and no rate-limiting (HTTP 429) was
 *     observed across 40 rapid sequential unauthenticated requests in this
 *     session — but Socrata's documented policy is that unauthenticated
 *     traffic sits behind a lower throttling threshold than tokened traffic,
 *     so sustained heavy production use may eventually need one; not wired
 *     up here since the brief calls for a keyless adapter.
 *   - A zero/no-match `$where` doesn't error — it's a clean HTTP 200 with an
 *     aggregate of 0 (`count`) or an absent key (`median`), same as a real
 *     answer; no NHTSA-style `acceptNonOkJson` trick is needed here. */
import { fetchCached } from "../fetchCached.js";

const BASE_URL = "https://data.ny.gov/resource/vezn-fmmk.json";

/** Data-entry noise guard for `odometer_reading`: 0 and anything above this
 *  are treated as bad reads, not real mileages (see module docstring). */
const MAX_PLAUSIBLE_ODOMETER = 1_000_000;

/** Doubles embedded single quotes for safe interpolation into a SoQL string
 *  literal (verified live: `make_code='O''NEIL'` parses as `O'NEIL`, while an
 *  unescaped `'` breaks the query with a `query.compiler.malformed` error). */
function escapeSoqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function soqlString(value: string): string {
  return `'${escapeSoqlString(value)}'`;
}

/** Common `$where` fragment shared by both queries below: make + one of
 *  several trim-fragmented `model_name` values + model year + inspections
 *  that fell inside `calendarYear`. `make_code`/`model_name` are upper-cased
 *  since the dataset's own values are upper-case and matching is
 *  case-sensitive (see module docstring). */
function sliceWhere(
  makeCode: string,
  modelNames: string[],
  modelYear: number,
  calendarYear: number,
): string {
  const modelList = modelNames.map((m) => soqlString(m.toUpperCase())).join(",");
  return (
    `make_code=${soqlString(makeCode.toUpperCase())} AND model_name in(${modelList}) ` +
    `AND model_year=${modelYear} AND inspection_date between ` +
    `'${calendarYear}-01-01T00:00:00' and '${calendarYear}-12-31T23:59:59'`
  );
}

function soqlUrl(select: string, where: string): string {
  const params = new URLSearchParams({ $select: select, $where: where });
  return `${BASE_URL}?${params.toString()}`;
}

/** Socrata returns aggregate values (including counts) as JSON strings, in a
 *  single-row array, e.g. `[{"n":"6747"}]`. */
export interface DistinctVinCountResponse {
  n?: string;
}

/** `[{}]` (key absent) when zero rows match — see module docstring. */
export interface MedianOdometerResponse {
  med?: string;
}

function distinctVinCountUrl(
  makeCode: string,
  modelNames: string[],
  modelYear: number,
  calendarYear: number,
): string {
  return soqlUrl("count(distinct vin) as n", sliceWhere(makeCode, modelNames, modelYear, calendarYear));
}

function medianOdometerUrl(
  makeCode: string,
  modelNames: string[],
  modelYear: number,
  calendarYear: number,
): string {
  const where =
    `${sliceWhere(makeCode, modelNames, modelYear, calendarYear)} ` +
    `AND odometer_reading>0 AND odometer_reading<=${MAX_PLAUSIBLE_ODOMETER}`;
  return soqlUrl("median(odometer_reading) as med", where);
}

/** Count of distinct VINs inspected in `calendarYear`, for `makeCode` +
 *  `modelYear`, across every one of `modelNames` (a nameplate is
 *  trim-fragmented across several `model_name` strings, so callers should
 *  pass all of them). */
export async function distinctVinCount(
  makeCode: string,
  modelNames: string[],
  modelYear: number,
  calendarYear: number,
): Promise<number> {
  const res = (await fetchCached(
    distinctVinCountUrl(makeCode, modelNames, modelYear, calendarYear),
  )) as DistinctVinCountResponse[];
  return Number(res[0]?.n ?? 0);
}

/** Median `odometer_reading` for the same slice as `distinctVinCount`,
 *  computed server-side via SoQL's `median()` aggregate (verified to exist
 *  and to match a client-side computation exactly — see module docstring;
 *  no client-side sampling needed). Data-entry noise (0 or >1,000,000 miles)
 *  is excluded before the median is taken. Returns 0 when no rows match the
 *  slice — safe as a sentinel since the `odometer_reading>0` filter means a
 *  real median can never legitimately be 0. */
export async function medianOdometer(
  makeCode: string,
  modelNames: string[],
  modelYear: number,
  calendarYear: number,
): Promise<number> {
  const res = (await fetchCached(
    medianOdometerUrl(makeCode, modelNames, modelYear, calendarYear),
  )) as MedianOdometerResponse[];
  const med = res[0]?.med;
  return med === undefined ? 0 : Number(med);
}
