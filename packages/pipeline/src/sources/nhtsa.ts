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

interface CatalogueResponse {
  results?: { model: string }[];
}

/** NHTSA's own list of model strings that are queryable for `make` in
 *  `modelYear`. This catalogue is **trim-fragmented and inconsistent year to
 *  year** for the same physical car — `RANGER` becomes `RANGER SUPER
 *  CAB`/`RANGER SUPER CREW`, `XC60` becomes `XC60 T5|T6|T8` and then `XC60 B5
 *  AWD`, `COOPER` disappears entirely in MY2021 — so a single hard-coded model
 *  string silently returns ZERO complaints for whole model years (Volvo XC90
 *  returns zero for *every* year in the window, which a naive derivation reads
 *  as a flawless car rather than a failed query). Resolve per year against this
 *  list instead. Cheap: one request per make-year, cached like everything else. */
export async function modelsForYear(
  make: string,
  modelYear: number,
  issueType: "c" | "r" = "c",
): Promise<string[]> {
  const params = new URLSearchParams({
    modelYear: String(modelYear),
    make,
    issueType,
  });
  const res = (await fetchCached(
    `https://api.nhtsa.gov/products/vehicle/models?${params.toString()}`,
  )) as CatalogueResponse;
  return [...new Set((res.results ?? []).map((r) => r.model.toUpperCase()))].sort();
}

export interface YearComplaintCatalogue extends YearComplaintComponents {
  /** The catalogue strings that matched this model year — reported so a
   *  zero-match year is visibly a mapping gap, not a clean car. */
  matchedModels: string[];
}

/** Complaints for one vehicle across `years`, resolving each year's real
 *  catalogue (`modelsForYear`) with `matchesModel`, querying every matching
 *  string, and **de-duplicating by `odiNumber`** — NHTSA lists the same
 *  physical car under several strings in some years (`GOLF GTI` *and* `GTI`),
 *  which would otherwise double-count. Keeps each complaint's `components`
 *  category list; still never its `summary` text or `vin`. */
export async function complaintComponentsByCatalogue(
  make: string,
  years: number[],
  matchesModel: (model: string) => boolean,
): Promise<YearComplaintCatalogue[]> {
  const out: YearComplaintCatalogue[] = [];
  for (const year of years) {
    const matchedModels = (await modelsForYear(make, year)).filter(matchesModel);
    const byOdi = new Map<number, string[]>();
    for (const model of matchedModels) {
      const res = (await fetchCached(complaintsUrl(make, model, year))) as ComplaintsResponse;
      for (const r of res.results ?? []) {
        byOdi.set(r.odiNumber, splitComponents(r.components ?? ""));
      }
    }
    out.push({
      year,
      matchedModels,
      complaints: byOdi.size,
      components: [...byOdi.values()],
    });
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
