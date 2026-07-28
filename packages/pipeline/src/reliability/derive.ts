/** Reliability re-derivation (Task D, launch gate). Re-derives a `low`/`mid`/`high`
 *  reliability tier from free/keyless NHTSA complaint data instead of the seed
 *  data's Consumer-Reports-derived judgment calls. Implements exactly the
 *  method documented in docs/reliability-methodology.md — read that first;
 *  every formula here has a name and a reason there. `sport` is never derived
 *  (owner judgment for passion vehicles, out of scope). */
import { complaintComponents, type YearComplaintComponents } from "../sources/nhtsa.js";

export interface ReliabilityQuery {
  name: string;
  make: string;
  model: string;
  body: string;
  years: number[];
}

export interface ReliabilityDerivation {
  name: string;
  body: string;
  rawScore: number;
  bodyClassIndex: number;
  tier: "low" | "mid" | "high";
  landmineYears: number[];
  byYear: Array<{
    year: number;
    complaints: number;
    perYearOnRoad: number;
    powertrainShare: number;
    landmine: boolean;
  }>;
}

/** JUDGMENT (methodology §4): a complaint's components field counts as
 *  powertrain when its top-level category (before any ":" subcategory)
 *  starts with one of these. */
const POWERTRAIN_PREFIXES = ["ENGINE", "POWER TRAIN", "TRANSMISSION"];

function isPowertrainComponent(topLevel: string): boolean {
  const c = topLevel.toUpperCase();
  return POWERTRAIN_PREFIXES.some((p) => c.startsWith(p));
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Linear-interpolation percentile between order statistics (numpy's default
 *  "linear" method) — methodology §3. `p` in [0, 1]. */
export function percentile(nums: number[], p: number): number {
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Per-model-year rate: complaints ÷ years-on-road (methodology §1). Floored
 *  at 1 year so the current model year never divides by zero. */
export function perYearOnRoadRate(modelYear: number, complaints: number, currentYear: number): number {
  const yearsOnRoad = Math.max(1, currentYear - modelYear);
  return complaints / yearsOnRoad;
}

/** Landmine-year classification for one model (methodology §4): a year is a
 *  landmine when its raw complaint count is > 2x the model's median AND more
 *  than 30% of that year's complaints have a powertrain component. Pure
 *  function over already-fetched per-year component lists — directly
 *  unit-testable with synthetic data. */
export function classifyLandmineYears(
  yearsData: YearComplaintComponents[],
): Array<{ year: number; powertrainShare: number; landmine: boolean }> {
  const countMedian = median(yearsData.map((y) => y.complaints));
  return yearsData.map((y) => {
    const powertrainCount = y.components.filter((topLevels) =>
      topLevels.some(isPowertrainComponent),
    ).length;
    const powertrainShare = y.complaints > 0 ? powertrainCount / y.complaints : 0;
    const landmine = countMedian > 0 && y.complaints > 2 * countMedian && powertrainShare > 0.3;
    return { year: y.year, powertrainShare, landmine };
  });
}

/** Re-derives reliability tiers for a batch of models together (quartiles are
 *  relative to the batch — methodology §3). Fetches NHTSA complaint data for
 *  every model/year via the shared fetchCached/fixture infrastructure, so
 *  this works offline (OPENCAWR_PIPELINE_OFFLINE=1) against recorded fixtures
 *  exactly like the rest of the pipeline's adapters. */
export async function deriveReliability(
  queries: ReliabilityQuery[],
  currentYear: number = new Date().getFullYear(),
): Promise<ReliabilityDerivation[]> {
  const perModel = await Promise.all(
    queries.map(async (q) => {
      const yearsData = await complaintComponents(q.make, q.model, q.years);
      const landmine = classifyLandmineYears(yearsData);
      const byYear = yearsData.map((y, i) => ({
        year: y.year,
        complaints: y.complaints,
        perYearOnRoad: perYearOnRoadRate(y.year, y.complaints, currentYear),
        powertrainShare: landmine[i]!.powertrainShare,
        landmine: landmine[i]!.landmine,
      }));
      const rawScore = median(byYear.map((y) => y.perYearOnRoad));
      return { query: q, rawScore, byYear };
    }),
  );

  // Body-class normalization (methodology §3): median rawScore per body value
  // among this batch, then each model's score relative to its own body-class median.
  const rawScoresByBody = new Map<string, number[]>();
  for (const m of perModel) {
    const list = rawScoresByBody.get(m.query.body) ?? [];
    list.push(m.rawScore);
    rawScoresByBody.set(m.query.body, list);
  }
  const indexed = perModel.map((m) => {
    const bodyMedian = median(rawScoresByBody.get(m.query.body)!);
    const bodyClassIndex = bodyMedian > 0 ? m.rawScore / bodyMedian : 1;
    return { ...m, bodyClassIndex };
  });

  // Quartile tiering across the whole batch (methodology §3).
  const indices = indexed.map((m) => m.bodyClassIndex);
  const q1 = percentile(indices, 0.25);
  const q3 = percentile(indices, 0.75);
  const tierOf = (index: number): "low" | "mid" | "high" =>
    index <= q1 ? "low" : index > q3 ? "high" : "mid";

  return indexed.map((m) => ({
    name: m.query.name,
    body: m.query.body,
    rawScore: m.rawScore,
    bodyClassIndex: m.bodyClassIndex,
    tier: tierOf(m.bodyClassIndex),
    landmineYears: m.byYear.filter((y) => y.landmine).map((y) => y.year),
    byYear: m.byYear,
  }));
}
