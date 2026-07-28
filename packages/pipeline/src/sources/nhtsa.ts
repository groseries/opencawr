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
  /** One entry per complaint: its NHTSA `components` field split on "," (never
   *  `summary`/`vin` — see module docstring). Used by reliability/derive.ts to
   *  find the powertrain-component share of a model year's complaints. */
  components: string[][];
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
    const components = results.map((r) =>
      (r.components ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
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
