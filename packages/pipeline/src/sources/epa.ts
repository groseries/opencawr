/** EPA fueleconomy.gov adapter (free, keyless). Maps a vehicle-detail response
 *  onto the fields of VehicleSpecs that EPA can actually supply: mpg/kWh and
 *  co2, plus etype/body hints derived from atvType/fuelType1/VClass. Fields
 *  EPA has no concept of (seats, cargo, insurance, price/maintenance curves,
 *  reliability) are NOT handled here — those come from the segment-peer proxy
 *  in assemble.ts. */
import type { EType } from "@opencawr/core";
import { fetchCached } from "../fetchCached.js";

const JSON_HEADERS = { Accept: "application/json" };

function menuUrl(year: number, make: string, model: string): string {
  const params = new URLSearchParams({ year: String(year), make, model });
  return `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?${params.toString()}`;
}

function detailUrl(id: string): string {
  return `https://www.fueleconomy.gov/ws/rest/vehicle/${id}`;
}

interface MenuItem {
  text: string;
  value: string;
}
interface MenuResponse {
  menuItem?: MenuItem | MenuItem[];
}

/** EPA returns a bare object (not an array) when there's exactly one match. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Vehicle-config IDs EPA has on file for this make/model/year (empty = not sold that year). */
export async function epaVehicleIdsForYear(
  make: string,
  model: string,
  year: number,
): Promise<string[]> {
  // EPA returns a bare JSON `null` (not `{}`) when nothing matches the year/make/model.
  const res = (await fetchCached(menuUrl(year, make, model), JSON_HEADERS)) as MenuResponse | null;
  if (!res) return [];
  return asArray(res.menuItem).map((item) => item.value);
}

export interface EpaVehicleDetail {
  id: string;
  year: string;
  comb08: string;
  combE: string;
  co2TailpipeGpm: string;
  combinedUF: string;
  VClass: string;
  fuelType1: string;
  atvType: string;
  drive: string;
}

export async function epaVehicleDetail(id: string): Promise<EpaVehicleDetail> {
  return (await fetchCached(detailUrl(id), JSON_HEADERS)) as EpaVehicleDetail;
}

function classifyEtype(atvType: string, fuelType1: string): EType {
  const at = atvType.toLowerCase();
  if (at.includes("plug-in")) return "phev";
  if (fuelType1.toLowerCase() === "electricity") return "ev";
  if (at.includes("hybrid")) return "hybrid";
  return "gas";
}

/** Rough size-class bucket from EPA's VClass string, refined to the seed's
 *  body vocabulary by finalizeBody() below (JUDGMENT: EPA has no equivalent
 *  of the seed's body field, so this string-matches the size-class label). */
function classifyBaseBody(vClass: string, drive: string): string {
  const vc = vClass.toLowerCase();
  if (vc.includes("pickup")) return "Truck";
  if (vc.includes("van")) return "Van";
  if (vc.includes("sport utility") || vc.includes(" suv")) {
    return /all[- ]wheel|4wd|four[- ]wheel/i.test(drive) ? "SUV AWD" : "SUV";
  }
  if (vc.includes("two seater")) return "Sport";
  return "Car"; // sedans/hatchbacks/wagons (mini/subcompact/compact/midsize/large cars, station wagons)
}

/** Seed convention folds propulsion into body for ev/phev (e.g. "EV SUV",
 *  "PHEV SUV AWD") but not for gas/hybrid. Mirrors that so proxy peer lookup
 *  (same body + etype) lines up with the seed data. JUDGMENT. */
function finalizeBody(baseBody: string, etype: EType): string {
  if (etype === "ev") return baseBody.startsWith("SUV") ? "EV SUV" : "EV";
  if (etype === "phev") return baseBody.startsWith("SUV") ? "PHEV SUV AWD" : "PHEV";
  return baseBody;
}

function numOrNull(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface EpaSpecs {
  etype: EType;
  body: string;
  mpg_combined: number | null;
  kwh_per_100mi: number | null;
  phev_gas_mpg: number | null;
  phev_utility_factor: number | null;
  /** null for EV: EPA's tailpipe co2 is ~0 for EVs, which would misrepresent
   *  the seed's grid/upstream-emissions convention — left for the proxy to fill. JUDGMENT. */
  co2_g_per_mi: number | null;
}

export function epaSpecs(detail: EpaVehicleDetail): EpaSpecs {
  const etype = classifyEtype(detail.atvType, detail.fuelType1);
  const body = finalizeBody(classifyBaseBody(detail.VClass, detail.drive), etype);
  const co2 = Number(detail.co2TailpipeGpm);

  if (etype === "ev") {
    return {
      etype,
      body,
      mpg_combined: null,
      kwh_per_100mi: numOrNull(detail.combE),
      phev_gas_mpg: null,
      phev_utility_factor: null,
      co2_g_per_mi: null,
    };
  }
  if (etype === "phev") {
    return {
      etype,
      body,
      mpg_combined: null,
      kwh_per_100mi: numOrNull(detail.combE),
      phev_gas_mpg: numOrNull(detail.comb08),
      phev_utility_factor: numOrNull(detail.combinedUF),
      co2_g_per_mi: co2 > 0 ? co2 : null,
    };
  }
  return {
    etype,
    body,
    mpg_combined: numOrNull(detail.comb08),
    kwh_per_100mi: null,
    phev_gas_mpg: null,
    phev_utility_factor: null,
    co2_g_per_mi: co2 > 0 ? co2 : null,
  };
}
