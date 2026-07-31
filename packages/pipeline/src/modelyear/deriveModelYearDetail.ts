/** R2 "model year as a designed surface" derivation. Builds the purely
 *  descriptive, engine-inert `Vehicle.model_year_detail` map from two sources
 *  already flowing through this pipeline for free/public/keyless reasons —
 *  see docs/model-year-detail-methodology.md for the full writeup and its
 *  honest limitations; every judgment call here has a name and a reason
 *  there. Never read by `costPerMile`. */
import type { ModelYearDetail, Vehicle } from "@opencawr/core";
import {
  drivetrainDescriptor,
  epaModelsForYear,
  epaVehicleDetail,
  epaVehicleIdsForYear,
} from "../sources/epa.js";
import { epaCatalogueQuery, pickModelForYear } from "./epaCorpus.js";
import { corpusQueries } from "../reliability/corpus.js";
import {
  complaintComponentsByCatalogue,
  type YearComplaintComponents,
} from "../sources/nhtsa.js";

export interface EpaYearFacts {
  year: number;
  /** `drivetrainDescriptor()` output, or `null` if EPA has no data for this
   *  make/model/year (empty menu, not an error). */
  drivetrain: string | null;
  /** Raw EPA `VClass` string, or `null` alongside `drivetrain`. */
  vClass: string | null;
}

/** Top-level NHTSA component category (the part before any `:` subcategory),
 *  mirroring the "before a `:` subcategory" convention `reliability/derive.ts`
 *  already uses for its powertrain-prefix check. */
function topLevelCategory(raw: string): string {
  const idx = raw.indexOf(":");
  return idx === -1 ? raw : raw.slice(0, idx);
}

/** JUDGMENT, disclosed plainly (docs/model-year-detail-methodology.md): a year
 *  is flagged as a spec-change year when EITHER EPA's drivetrain descriptor OR
 *  its VClass string differs from the immediately preceding year in `byYear`.
 *  This is a PROXY for a spec discontinuity, NOT a confirmed styling refresh
 *  or facelift — EPA data carries no styling signal at all, and this must
 *  never be described as detecting a "refresh".
 *
 *  A missing (`null`) drivetrain on either side of a comparison means
 *  "insufficient EPA data", not "evidence of no change" or "evidence of
 *  change" — that comparison is skipped and VClass is checked independently.
 *  Only when BOTH signals are unavailable does the year fall back to `false`.
 *  The first year in `byYear` is always `false` (no prior year to compare). */
export function classifySpecChangeYears(
  byYear: Array<{ year: number; drivetrain: string | null; vClass: string | null }>,
): Array<{ year: number; specChangeFromPriorYear: boolean }> {
  return byYear.map((y, i) => {
    if (i === 0) return { year: y.year, specChangeFromPriorYear: false };
    const prev = byYear[i - 1]!;
    const drivetrainChanged =
      y.drivetrain !== null && prev.drivetrain !== null && y.drivetrain !== prev.drivetrain;
    const vClassChanged = y.vClass !== null && prev.vClass !== null && y.vClass !== prev.vClass;
    return { year: y.year, specChangeFromPriorYear: drivetrainChanged || vClassChanged };
  });
}

/** For each model year, the most-reported NHTSA top-level complaint category
 *  and its share of that year's complaints. Reuses the SAME already-fetched
 *  `YearComplaintComponents[]` the reliability derivation produces — no second
 *  NHTSA query path. A category counts once per complaint (the same "counts
 *  once per complaint" discipline `classifyLandmineYears`/`isPowertrainComponent`
 *  use in `reliability/derive.ts`), never once per raw category occurrence.
 *  Ties broken alphabetically for determinism. Zero complaints -> both fields
 *  `null`. */
export function topComplaintCategoryByYear(
  yearsData: YearComplaintComponents[],
): Array<{ year: number; topCategory: string | null; topShare: number | null }> {
  return yearsData.map((y) => {
    if (y.complaints === 0) return { year: y.year, topCategory: null, topShare: null };
    const counts = new Map<string, number>();
    for (const topLevels of y.components) {
      const categoriesInComplaint = new Set(topLevels.map(topLevelCategory));
      for (const cat of categoriesInComplaint) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    let topCategory: string | null = null;
    let topCount = -1;
    for (const cat of [...counts.keys()].sort()) {
      const count = counts.get(cat)!;
      if (count > topCount) {
        topCount = count;
        topCategory = cat;
      }
    }
    return { year: y.year, topCategory, topShare: topCount / y.complaints };
  });
}

/** Assembles one `ModelYearDetail` per year in `[vehicle.first_year,
 *  vehicle.last_year]`. `drivetrain`/`specChangeFromPriorYear` come from the
 *  full `epaByYear` range; `topComplaintCategory`/`topComplaintShare` are only
 *  populated for years present in `nhtsaByYear` (the reliability derivation's
 *  own ≤6-year window ending ≤MY2022) — `null` outside it, an accepted,
 *  already-precedented limitation (same as R12's landmine years). */
export function deriveModelYearDetail(
  vehicle: Pick<Vehicle, "first_year" | "last_year">,
  epaByYear: EpaYearFacts[],
  nhtsaByYear: YearComplaintComponents[],
): Record<string, ModelYearDetail> {
  const specChangeByYear = new Map(
    classifySpecChangeYears(epaByYear).map((s) => [s.year, s.specChangeFromPriorYear]),
  );
  const drivetrainByYear = new Map(epaByYear.map((e) => [e.year, e.drivetrain]));
  const complaintByYear = new Map(topComplaintCategoryByYear(nhtsaByYear).map((c) => [c.year, c]));

  const out: Record<string, ModelYearDetail> = {};
  for (let year = vehicle.first_year; year <= vehicle.last_year; year++) {
    const complaint = complaintByYear.get(year);
    out[String(year)] = {
      drivetrain: drivetrainByYear.get(year) ?? null,
      specChangeFromPriorYear: specChangeByYear.get(year) ?? false,
      topComplaintCategory: complaint?.topCategory ?? null,
      topComplaintShare: complaint?.topShare ?? null,
    };
  }
  return out;
}

/** EPA `{year, drivetrain, vClass}` for every year in `[vehicle.first_year,
 *  vehicle.last_year]`, resolved against EPA's REAL per-year model catalogue
 *  (`epaModelsForYear` + the vehicle's matcher in `epaCorpus.ts`) rather than
 *  one hard-coded model string — EPA's catalogue is drivetrain/trim-fragmented
 *  (no bare `CR-V`, only `CR-V AWD`/`CR-V FWD`/`CR-V Hybrid AWD`), so a single
 *  string yields an empty menu for whole model years. Where several strings
 *  match, `pickModelForYear` takes ONE deterministically (sorted-first) so
 *  `classifySpecChangeYears` compares like for like year over year.
 *
 *  A year EPA genuinely has no matching catalogue string or no vehicle-config
 *  ids for is a gap (`null`) — never an error, never inferred from a
 *  neighboring year, and never throws. */
async function fetchEpaByYear(vehicle: Vehicle): Promise<EpaYearFacts[]> {
  const { make, matchesModel } = epaCatalogueQuery(vehicle);
  const out: EpaYearFacts[] = [];
  for (let year = vehicle.first_year; year <= vehicle.last_year; year++) {
    try {
      const model = pickModelForYear(await epaModelsForYear(make, year), matchesModel);
      if (model === null) {
        out.push({ year, drivetrain: null, vClass: null });
        continue;
      }
      const ids = await epaVehicleIdsForYear(make, model, year);
      if (ids.length === 0) {
        out.push({ year, drivetrain: null, vClass: null });
        continue;
      }
      const detail = await epaVehicleDetail(ids[0]!);
      const descriptor = drivetrainDescriptor(detail);
      out.push({
        year,
        drivetrain: descriptor.length > 0 ? descriptor : null,
        vClass: detail.VClass || null,
      });
    } catch {
      out.push({ year, drivetrain: null, vClass: null });
    }
  }
  return out;
}

/** NHTSA `YearComplaintComponents[]` for `vehicle`, via the exact same
 *  corpus query (`corpusQueries`/`complaintComponentsByCatalogue`) the
 *  reliability derivation uses — same make/matcher/year-window, same on-disk
 *  cache, no second NHTSA query path. */
async function fetchNhtsaByYear(vehicle: Vehicle): Promise<YearComplaintComponents[]> {
  const query = corpusQueries([vehicle])[0]!;
  return complaintComponentsByCatalogue(query.make, query.years, query.matchesModel);
}

/** Fetches both sources for one seed `vehicle` and derives its full
 *  `model_year_detail` map. Real network calls (EPA per production year,
 *  NHTSA via the shared cache) — see report.ts for the batch/CLI entry point. */
export async function fetchModelYearDetail(vehicle: Vehicle): Promise<Record<string, ModelYearDetail>> {
  const [epaByYear, nhtsaByYear] = await Promise.all([
    fetchEpaByYear(vehicle),
    fetchNhtsaByYear(vehicle),
  ]);
  return deriveModelYearDetail(vehicle, epaByYear, nhtsaByYear);
}
