/** Minimal runtime schema check for an assembled Vehicle. Data assembled from
 *  external APIs isn't checked by the TS compiler at runtime, so this catches
 *  obviously-broken output (missing/NaN fields, empty curves) before it's
 *  handed to the engine. Not a general-purpose validator — just enough to
 *  gate assemble() output. Returns a list of problems; empty = valid. */
import type { Vehicle } from "@opencawr/core";

export function validateVehicleShape(v: Vehicle): string[] {
  const problems: string[] = [];
  const isFiniteNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

  if (!v.name) problems.push("name is empty");
  if (!v.make) problems.push("make is empty");
  if (!v.body) problems.push("body is empty");
  if (!["gas", "hybrid", "ev", "phev"].includes(v.etype)) problems.push(`invalid etype "${v.etype}"`);
  if (!isFiniteNum(v.first_year) || !isFiniteNum(v.last_year)) problems.push("first_year/last_year not numeric");
  if (!isFiniteNum(v.eol_maintained_miles) || v.eol_maintained_miles <= 0) {
    problems.push("eol_maintained_miles missing or non-positive");
  }
  if (!isFiniteNum(v.pinned_buy_odo)) problems.push("pinned_buy_odo not numeric");
  if (!isFiniteNum(v.pinned_buy_year_est)) problems.push("pinned_buy_year_est not numeric");
  if (Object.keys(v.price_vs_odometer_usd ?? {}).length < 2) {
    problems.push("price_vs_odometer_usd needs at least 2 points");
  }
  if (Object.keys(v.maintenance_usd_per_yr_by_age ?? {}).length < 2) {
    problems.push("maintenance_usd_per_yr_by_age needs at least 2 points");
  }
  if (!isFiniteNum(v.repair_cost_multiplier_by_make)) problems.push("repair_cost_multiplier_by_make not numeric");
  if (v.specs.mpg_combined === null && v.specs.kwh_per_100mi === null && v.specs.phev_gas_mpg === null) {
    problems.push("specs has no energy metric (mpg_combined/kwh_per_100mi/phev_gas_mpg all null)");
  }
  if (!isFiniteNum(v.specs.seats) || v.specs.seats <= 0) problems.push("specs.seats missing or non-positive");
  if (!isFiniteNum(v.specs.cargo_cu_ft)) problems.push("specs.cargo_cu_ft not numeric");
  if (!isFiniteNum(v.specs.co2_g_per_mi)) problems.push("specs.co2_g_per_mi not numeric");
  if (!isFiniteNum(v.specs.full_coverage_ins_usd_yr)) problems.push("specs.full_coverage_ins_usd_yr not numeric");
  if (!v.model_year_reliability) problems.push("model_year_reliability missing");

  return problems;
}
