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

function modelMenuUrl(year: number, make: string): string {
  const params = new URLSearchParams({ year: String(year), make });
  return `https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?${params.toString()}`;
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

/** EPA's own list of model strings queryable for `make` in `year`. Like NHTSA's
 *  complaint catalogue (`modelsForYear`, `sources/nhtsa.ts`), this catalogue is
 *  **drivetrain/trim-fragmented**: MY2022 Honda lists `CR-V AWD`, `CR-V FWD`,
 *  `CR-V Hybrid AWD` and **no bare `CR-V`**, so a single hard-coded model string
 *  returns an empty menu for whole model years. Resolve per year against this
 *  list instead (`modelyear/epaCorpus.ts`). Cheap: one request per make-year,
 *  cached like everything else. */
export async function epaModelsForYear(make: string, year: number): Promise<string[]> {
  // Same two response quirks as the options menu: a bare object when exactly
  // one model matches, a bare JSON `null` when nothing matches the year/make.
  const res = (await fetchCached(modelMenuUrl(year, make), JSON_HEADERS)) as MenuResponse | null;
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
  /** Engine displacement, liters (e.g. "2.5"). Already on the wire in EPA's
   *  vehicle-detail response; unused until R2's `model_year_detail`. */
  displ: string;
  /** Cylinder count (e.g. "4"). Already on the wire; see `displ` above. */
  cylinders: string;
  /** Transmission descriptor (e.g. "Automatic (AM-S8)"). Already on the wire; see `displ` above. */
  trany: string;
}

export async function epaVehicleDetail(id: string): Promise<EpaVehicleDetail> {
  return (await fetchCached(detailUrl(id), JSON_HEADERS)) as EpaVehicleDetail;
}

/** Best-effort "2.5L I4, Automatic (AM-S8), Front-Wheel Drive" style descriptor
 *  from EPA's own displ/cylinders/trany/drive strings (R2, `model_year_detail`).
 *  Never throws: any missing/blank field is simply omitted from the joined
 *  string rather than producing "undefined" or a stray separator. */
export function drivetrainDescriptor(detail: EpaVehicleDetail): string {
  const parts: string[] = [];
  if (detail.displ && detail.cylinders) {
    parts.push(`${detail.displ}L I${detail.cylinders}`);
  } else if (detail.displ) {
    parts.push(`${detail.displ}L`);
  } else if (detail.cylinders) {
    parts.push(`I${detail.cylinders}`);
  }
  if (detail.trany) parts.push(detail.trany);
  if (detail.drive) parts.push(detail.drive);
  return parts.join(", ");
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

/** A size sub-category finer than `body`, derived from EPA's own VClass string
 *  (e.g. "Compact Cars" vs "Midsize Cars" vs "Minicompact Cars"). Used by
 *  proxy.ts to pre-filter same-body+etype peers to ones of a comparable size
 *  before falling back to mpg-distance — see ASSUMPTIONS.md §F. Subcompact
 *  cars and small station wagons (hatchbacks) are grouped with compact cars
 *  since they're practically the same size class of daily driver; minicompact
 *  cars/two-seaters are kept as their own (smaller) tier. JUDGMENT. */
export type SizeTier =
  | "two-seater"
  | "micro"
  | "compact"
  | "midsize"
  | "large"
  | "small-suv"
  | "standard-suv"
  | "small-truck"
  | "standard-truck"
  | "minivan"
  | "van"
  | "unknown";

export function classifySizeTier(vClass: string): SizeTier {
  const vc = vClass.toLowerCase();
  if (vc.includes("two seater")) return "two-seater";
  if (vc.includes("minicompact")) return "micro";
  if (vc.includes("subcompact") || vc.includes("small station wagon")) return "compact";
  if (vc.includes("compact")) return "compact";
  if (vc.includes("midsize")) return "midsize"; // covers "Midsize Cars" and "Midsize Station Wagons"
  if (vc.includes("large")) return "large";
  if (vc.includes("small sport utility") || vc.includes("small suv")) return "small-suv";
  if (vc.includes("sport utility") || vc.includes("suv")) return "standard-suv";
  if (vc.includes("minivan")) return "minivan";
  if (vc.includes("van")) return "van";
  if (vc.includes("small pickup")) return "small-truck";
  if (vc.includes("pickup")) return "standard-truck";
  return "unknown";
}

export interface EpaSpecs {
  etype: EType;
  body: string;
  sizeTier: SizeTier;
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
  const sizeTier = classifySizeTier(detail.VClass);
  const co2 = Number(detail.co2TailpipeGpm);

  if (etype === "ev") {
    return {
      etype,
      body,
      sizeTier,
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
      sizeTier,
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
    sizeTier,
    mpg_combined: numOrNull(detail.comb08),
    kwh_per_100mi: null,
    phev_gas_mpg: null,
    phev_utility_factor: null,
    co2_g_per_mi: co2 > 0 ? co2 : null,
  };
}
