/** Assembles a partial Vehicle for an arbitrary make/model from free/keyless
 *  EPA + NHTSA sources, falling back to a segment-peer proxy from the seed
 *  data for everything those sources can't supply. See ASSUMPTIONS.md for
 *  the caution-heuristic and proxy-selection JUDGMENT rows. */
import type { Vehicle } from "@opencawr/core";
import { epaSpecs, epaVehicleDetail, epaVehicleIdsForYear } from "./sources/epa.js";
import { complaintCounts, normalizeModel, type YearComplaints } from "./sources/nhtsa.js";
import { pickProxyPeer } from "./sources/proxy.js";
import { loadSeedData } from "./seedData.js";

export interface ProvenanceEntry {
  field: string;
  source: "epa" | "nhtsa" | "seed" | "proxy";
  detail: string;
  launchBlocked?: boolean;
}
export type ProvenanceReport = ProvenanceEntry[];

export interface AssembleQuery {
  make: string;
  model: string;
  /** Inclusive [startYear, endYear]. Default: the last 10 model years. */
  years?: [number, number];
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** JUDGMENT heuristic (ASSUMPTIONS.md §F): a model year is `caution` when its
 *  complaint count exceeds 2x the median count across the queried years;
 *  everything else is `good` (`bad` is never derived here). Pulled out as a
 *  pure function so it's directly unit-testable with synthetic counts. */
export function classifyModelYearReliability(
  counts: YearComplaints[],
): { bad: number[]; caution: number[]; good: number[]; median: number } {
  const med = median(counts.map((c) => c.complaints));
  const caution: number[] = [];
  const good: number[] = [];
  for (const c of counts) {
    if (med > 0 && c.complaints > 2 * med) caution.push(c.year);
    else good.push(c.year);
  }
  return { bad: [], caution, good, median: med };
}

export async function assembleVehicle(
  query: AssembleQuery,
): Promise<{ vehicle: Vehicle; report: ProvenanceReport }> {
  const report: ProvenanceReport = [];
  const make = query.make;

  const model = await normalizeModel(make, query.model);
  if (model.toLowerCase() !== query.model.toLowerCase() || model !== query.model) {
    report.push({
      field: "model",
      source: "nhtsa",
      detail: `normalized "${query.model}" -> "${model}" via VPIC getmodelsformake/${make}`,
    });
  }

  const currentYear = new Date().getFullYear();
  const [startYear, endYear] = query.years ?? [currentYear - 9, currentYear];

  // Walk newest -> oldest so the primary spec snapshot is the most recent model year.
  const yearsWithData: number[] = [];
  let primaryYear: number | undefined;
  let primaryDetailId: string | undefined;
  for (let year = endYear; year >= startYear; year--) {
    const ids = await epaVehicleIdsForYear(make, model, year);
    if (ids.length === 0) continue;
    yearsWithData.push(year);
    if (primaryYear === undefined) {
      primaryYear = year;
      primaryDetailId = ids[0];
    }
  }
  if (primaryYear === undefined || primaryDetailId === undefined) {
    throw new Error(
      `No EPA fueleconomy.gov data for ${make} ${model} in model years ${startYear}-${endYear}`,
    );
  }
  yearsWithData.sort((a, b) => a - b);

  const detail = await epaVehicleDetail(primaryDetailId);
  const specs = epaSpecs(detail);
  report.push({
    field: "specs.mpg_combined / specs.kwh_per_100mi",
    source: "epa",
    detail: `fueleconomy.gov vehicle ${primaryDetailId}, model year ${primaryYear} (etype=${specs.etype})`,
  });
  if (specs.co2_g_per_mi !== null) {
    report.push({
      field: "specs.co2_g_per_mi",
      source: "epa",
      detail: `fueleconomy.gov vehicle ${primaryDetailId} co2TailpipeGpm`,
    });
  }

  const counts = await complaintCounts(make, model, yearsWithData);
  const { bad, caution, good, median: med } = classifyModelYearReliability(counts);
  report.push({
    field: "model_year_reliability",
    source: "nhtsa",
    detail:
      `complaintsByVehicle counts per model year (${JSON.stringify(counts.map((c) => ({ year: c.year, complaints: c.complaints })))}); ` +
      `caution = complaints > 2x median(${med}) [JUDGMENT heuristic]`,
    launchBlocked: true,
  });

  const { vehicles: seedVehicles } = loadSeedData();
  const peer = await pickProxyPeer(seedVehicles, {
    body: specs.body,
    etype: specs.etype,
    mpg_combined: specs.mpg_combined,
    kwh_per_100mi: specs.kwh_per_100mi,
    sizeTier: specs.sizeTier,
  });
  report.push({
    field: "segment peer",
    source: "proxy",
    detail: `closest peer in body="${specs.body}" etype="${specs.etype}" sizeTier="${specs.sizeTier}" = "${peer.name}" (size-tier pre-filter, mpg-distance tiebreak)`,
  });

  const proxiedFields: Array<[string, boolean?]> = [
    ["specs.seats", undefined],
    ["specs.cargo_cu_ft", undefined],
    ["specs.full_coverage_ins_usd_yr", undefined],
    ["specs.co2_g_per_mi (ev only)", undefined],
    ["reliability_tier", true],
    ["eol_maintained_miles", undefined],
    ["pinned_buy_odo", undefined],
    ["pinned_buy_year_est", undefined],
    ["price_vs_odometer_usd", undefined],
    ["maintenance_usd_per_yr_by_age", undefined],
    ["repair_cost_multiplier_by_make", undefined],
    ["battery", undefined],
    ["maintenance_curve_shared_with", undefined],
  ];
  for (const [field, launchBlocked] of proxiedFields) {
    if (field === "specs.co2_g_per_mi (ev only)" && specs.co2_g_per_mi !== null) continue;
    if (field === "battery" && !peer.battery) continue;
    if (field === "maintenance_curve_shared_with" && !peer.maintenance_curve_shared_with) continue;
    report.push({
      field,
      source: "proxy",
      detail: `copied from segment peer "${peer.name}"`,
      ...(launchBlocked ? { launchBlocked } : {}),
    });
  }

  const vehicle: Vehicle = {
    name: `${titleCase(make)} ${model}`,
    make: make.toLowerCase(),
    body: specs.body,
    etype: specs.etype,
    first_year: yearsWithData[0]!,
    last_year: yearsWithData[yearsWithData.length - 1]!,
    reliability_tier: peer.reliability_tier,
    provenance: "proxied",
    specs: {
      mpg_combined: specs.mpg_combined,
      kwh_per_100mi: specs.kwh_per_100mi,
      phev_gas_mpg: specs.phev_gas_mpg,
      phev_utility_factor: specs.phev_utility_factor,
      seats: peer.specs.seats,
      cargo_cu_ft: peer.specs.cargo_cu_ft,
      co2_g_per_mi: specs.co2_g_per_mi ?? peer.specs.co2_g_per_mi,
      full_coverage_ins_usd_yr: peer.specs.full_coverage_ins_usd_yr,
    },
    eol_maintained_miles: peer.eol_maintained_miles,
    pinned_buy_odo: peer.pinned_buy_odo,
    pinned_buy_year_est: peer.pinned_buy_year_est,
    price_vs_odometer_usd: peer.price_vs_odometer_usd,
    maintenance_usd_per_yr_by_age: peer.maintenance_usd_per_yr_by_age,
    repair_cost_multiplier_by_make: peer.repair_cost_multiplier_by_make,
    model_year_reliability: { bad, caution, good },
    ...(peer.battery ? { battery: peer.battery } : {}),
    ...(peer.maintenance_curve_shared_with
      ? { maintenance_curve_shared_with: peer.maintenance_curve_shared_with }
      : {}),
  };

  return { vehicle, report };
}
