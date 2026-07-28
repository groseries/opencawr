/** NHTSA complaints + VPIC adapters (free, keyless). Counts only: we discard
 *  everything from each complaint except its ODI id — no complaint text or
 *  VIN is ever stored in our output. */
import { fetchCached } from "../fetchCached.js";

interface ComplaintsResponse {
  count: number;
  results?: { odiNumber: number; components?: string }[];
}

export interface YearComplaints {
  year: number;
  complaints: number;
  odiIds: number[];
}

function complaintsUrl(make: string, model: string, modelYear: number): string {
  const params = new URLSearchParams({ make, model, modelYear: String(modelYear) });
  return `https://api.nhtsa.gov/complaints/complaintsByVehicle?${params.toString()}`;
}

export async function complaintCounts(
  make: string,
  model: string,
  years: number[],
): Promise<YearComplaints[]> {
  const out: YearComplaints[] = [];
  for (const year of years) {
    const res = (await fetchCached(complaintsUrl(make, model, year))) as ComplaintsResponse;
    const odiIds = (res.results ?? []).map((r) => r.odiNumber);
    out.push({ year, complaints: res.count ?? odiIds.length, odiIds });
  }
  return out;
}

export interface YearComplaintComponents {
  year: number;
  complaints: number;
  /** One entry per complaint: its NHTSA `components` field, split into
   *  top-level categories (never `summary`/`vin` — see module docstring).
   *  Used by reliability/derive.ts to find the powertrain-component share of
   *  a model year's complaints. */
  components: string[][];
}

/** A handful of NHTSA's own top-level component category *names* contain a
 *  literal comma (confirmed live, e.g. in the recorded Ford Escape 2020
 *  fixture: "ENGINE AND ENGINE COOLING,FUEL SYSTEM, GASOLINE,BACK OVER
 *  PREVENTION"). The `components` field itself is a comma-joined list of
 *  these categories, so a naive `.split(",")` fragments them (e.g. "FUEL
 *  SYSTEM" + " GASOLINE" as two spurious tokens). These are protected before
 *  splitting so each category survives whole. */
const COMMA_CONTAINING_CATEGORIES = [
  "FUEL SYSTEM, GASOLINE",
  "FUEL SYSTEM, DIESEL",
  "SERVICE BRAKES, HYDRAULIC",
  "SERVICE BRAKES, AIR",
];

/** Placeholder for a protected category's internal comma: a Unicode Private
 *  Use Area code point, never present in real NHTSA category text, so
 *  restoring it can't collide with an ordinary space in some other,
 *  unrelated category (a plain space would — e.g. "ENGINE AND ENGINE
 *  COOLING" also contains spaces). Deliberately not a NUL/control byte,
 *  which some tools mis-detect as a binary file. */
const COMMA_PLACEHOLDER = "\uE000";

/** Splits a raw `components` string into its top-level categories, keeping
 *  any of `COMMA_CONTAINING_CATEGORIES` intact instead of fragmenting on
 *  their internal comma. Exported for direct unit testing (see nhtsa.test.ts). */
export function splitComponents(raw: string): string[] {
  let protectedRaw = raw;
  for (const category of COMMA_CONTAINING_CATEGORIES) {
    protectedRaw = protectedRaw.split(category).join(category.replace(",", COMMA_PLACEHOLDER));
  }
  return protectedRaw
    .split(",")
    .map((s) => s.replace(COMMA_PLACEHOLDER, ",").trim())
    .filter(Boolean);
}

/** Same endpoint as complaintCounts, but keeps each complaint's `components`
 *  category list instead of discarding it — still no complaint text or VIN. */
export async function complaintComponents(
  make: string,
  model: string,
  years: number[],
): Promise<YearComplaintComponents[]> {
  const out: YearComplaintComponents[] = [];
  for (const year of years) {
    const res = (await fetchCached(complaintsUrl(make, model, year))) as ComplaintsResponse;
    const results = res.results ?? [];
    const components = results.map((r) => splitComponents(r.components ?? ""));
    out.push({ year, complaints: res.count ?? results.length, components });
  }
  return out;
}

interface VpicModelsResponse {
  Results?: { Model_Name: string }[];
}

function modelsForMakeUrl(make: string): string {
  return `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/${encodeURIComponent(make)}?format=json`;
}

/** Case-normalizes `model` against VPIC's real model list for `make` (e.g. "fit" -> "Fit").
 *  Falls back to the input unchanged if the make/model isn't found. */
export async function normalizeModel(make: string, model: string): Promise<string> {
  const res = (await fetchCached(modelsForMakeUrl(make))) as VpicModelsResponse;
  const match = (res.Results ?? []).find(
    (r) => r.Model_Name.toLowerCase() === model.toLowerCase(),
  );
  return match?.Model_Name ?? model;
}
