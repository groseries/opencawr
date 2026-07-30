/** Reliability re-derivation (launch gate, spec §9). Re-derives a
 *  `low`/`mid`/`high` reliability tier from free/keyless NHTSA complaint data
 *  instead of the seed data's Consumer-Reports-derived judgment calls.
 *  Implements exactly the method documented in docs/reliability-methodology.md
 *  — read that first; every formula here has a name and a reason there, and the
 *  evidence behind each choice is in docs/investigations/2026-07-29-reliability-corpus.md.
 *
 *  The score is a SHARE, not a rate: the fraction of a model's complaints that
 *  are powertrain complaints. Numerator and denominator both scale with units
 *  sold, so the sales-volume confound that made the previous count-based metric
 *  a sales ranking (ρ = +0.11 vs the seed tier, i.e. nothing) cancels exactly.
 *
 *  `sport` is never derived (owner judgment for passion vehicles); EVs are
 *  derived against an EV-only reference because they have no engine and no
 *  transmission and so cannot generate the gas numerator at all. */
import {
  complaintComponentsByCatalogue,
  type YearComplaintComponents,
} from "../sources/nhtsa.js";

export interface ReliabilityQuery {
  name: string;
  /** NHTSA make string (as it appears in `products/vehicle/models`). */
  make: string;
  /** Applied to each model year's real NHTSA catalogue — never a single
   *  hard-coded model string (methodology "Source"; the catalogue renames the
   *  same physical car year to year). */
  matchesModel: (model: string) => boolean;
  years: number[];
  /** Seed `etype`; selects the reference group (`ev` gets its own). */
  etype: string;
  /** Seed `reliability_tier`; `sport` is an owner carve-out, never derived. */
  seedTier: string;
  /** Seed `body` — reporting only. Nothing in the derivation partitions by it. */
  body: string;
}

export type ReferenceGroup = "main" | "ev";

export interface ReliabilityDerivation {
  name: string;
  body: string;
  etype: string;
  /** `null` for the `sport` carve-out: excluded from the score distribution
   *  AND from the cut-point computation, not merely left unassigned. */
  reference: ReferenceGroup | null;
  /** Powertrain complaint share, pooled across the queried model years. */
  rawScore: number;
  tier: "low" | "mid" | "high" | null;
  /** The percentile cut points of this vehicle's own reference group. */
  cuts: { low: number; high: number } | null;
  evidence: {
    complaints: number;
    powertrainComplaints: number;
    modelYears: number;
    /** Low-confidence tier: an EV (n = 4, see methodology "Known limitations")
     *  or a thin denominator. Report it, don't silently assert it. */
    provisional: boolean;
  };
  landmineYears: number[];
  byYear: Array<{
    year: number;
    matchedModels: string[];
    complaints: number;
    powertrainShare: number;
    landmine: boolean;
  }>;
}

/** JUDGMENT (methodology "Step 2"): a complaint counts as powertrain when any
 *  of its `components` top-level categories (before a `:` subcategory) starts
 *  with one of these. */
const POWERTRAIN_PREFIXES = ["ENGINE", "POWER TRAIN", "TRANSMISSION"];

/** The EV reference's numerator (methodology "EVs"): the gas set plus the
 *  categories NHTSA files an electric drivetrain's failures under. An EV has
 *  no engine and no transmission, so the gas numerator is structurally
 *  impossible for it, not merely small. */
const EV_PROPULSION_PREFIXES = [
  ...POWERTRAIN_PREFIXES,
  "FUEL/PROPULSION SYSTEM",
  "HYBRID PROPULSION SYSTEM",
  "ELECTRICAL SYSTEM",
];

/** Percentile cut points = the seed corpus's own tier marginals (22 `low` /
 *  32 `mid` / 15 `high` across the 69 non-sport vehicles = 32% / 78%), so the
 *  derivation is not penalised for producing the wrong *proportion* of tiers.
 *  Named, not bare literals — methodology "Step 3". */
export const TIER_CUT_LOW = 0.32;
export const TIER_CUT_HIGH = 0.78;

/** Below this many pooled complaints the share is too noisy to assert
 *  (methodology "Known limitations"): 6 corpus vehicles fall under it. */
const THIN_EVIDENCE_COMPLAINTS = 100;

function hasPrefix(prefixes: string[], topLevel: string): boolean {
  const c = topLevel.toUpperCase();
  return prefixes.some((p) => c.startsWith(p));
}

function isPowertrainComponent(topLevel: string): boolean {
  return hasPrefix(POWERTRAIN_PREFIXES, topLevel);
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Linear-interpolation percentile between order statistics (numpy's default
 *  "linear" method) — methodology "Step 3". `p` in [0, 1]. */
export function percentile(nums: number[], p: number): number {
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Landmine-year classification for one model (methodology "Step 4"): a year is
 *  a landmine when its raw complaint count is > 2x the model's median AND more
 *  than 30% of that year's complaints have a powertrain component. Already a
 *  share, so already volume-invariant — the same family of statistic as the
 *  tier score. Pure function over already-fetched per-year component lists —
 *  directly unit-testable with synthetic data. */
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

/** Vehicles fetched at a time (each one walks its own model years
 *  sequentially). Deliberately small: the corpus is ~440 complaint requests
 *  against a free public API and being a good citizen matters more than wall
 *  clock, especially since every response is cached on disk anyway. */
const NHTSA_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Which reference group a query belongs to — `null` = never derived. */
export function referenceFor(query: ReliabilityQuery): ReferenceGroup | null {
  if (query.seedTier === "sport") return null;
  return query.etype === "ev" ? "ev" : "main";
}

/** Re-derives reliability tiers for a batch of vehicles together. Cut points
 *  are percentiles of the batch's own score distribution, so the batch should
 *  be the whole corpus (methodology "Step 3"). Fetches NHTSA complaint data via
 *  the shared fetchCached/fixture infrastructure, so this works offline
 *  (OPENCAWR_PIPELINE_OFFLINE=1) against recorded fixtures exactly like the
 *  rest of the pipeline's adapters. */
export async function deriveReliability(
  queries: ReliabilityQuery[],
): Promise<ReliabilityDerivation[]> {
  const perModel = await mapWithConcurrency(queries, NHTSA_CONCURRENCY, async (q) => {
    const reference = referenceFor(q);
    const prefixes = reference === "ev" ? EV_PROPULSION_PREFIXES : POWERTRAIN_PREFIXES;
    const yearsData = await complaintComponentsByCatalogue(q.make, q.years, q.matchesModel);
    const landmine = classifyLandmineYears(yearsData);
    const byYear = yearsData.map((y, i) => ({
      year: y.year,
      matchedModels: y.matchedModels,
      complaints: y.complaints,
      powertrainShare: landmine[i]!.powertrainShare,
      landmine: landmine[i]!.landmine,
    }));

    // Pooled across the window, NOT a median of per-year shares: a thin model
    // year would otherwise weigh as much as a 2,000-complaint one. Each
    // complaint counts once however many powertrain categories it carries, so
    // rawScore is a true share in [0, 1].
    const complaints = yearsData.reduce((n, y) => n + y.complaints, 0);
    const powertrainComplaints = yearsData.reduce(
      (n, y) =>
        n + y.components.filter((topLevels) => topLevels.some((c) => hasPrefix(prefixes, c))).length,
      0,
    );
    const rawScore = complaints > 0 ? powertrainComplaints / complaints : 0;

    return { query: q, reference, rawScore, complaints, powertrainComplaints, byYear };
  });

  // One distribution per reference group, no other partition of any kind — no
  // body class, no etype, no make (make-normalising erases the signal; see the
  // investigation §5.3). `sport` is in neither distribution.
  const cutsByReference = new Map<ReferenceGroup, { low: number; high: number }>();
  for (const reference of ["main", "ev"] as const) {
    const scores = perModel.filter((m) => m.reference === reference).map((m) => m.rawScore);
    if (scores.length === 0) continue;
    cutsByReference.set(reference, {
      low: percentile(scores, TIER_CUT_LOW),
      high: percentile(scores, TIER_CUT_HIGH),
    });
  }

  return perModel.map((m) => {
    const cuts = m.reference ? (cutsByReference.get(m.reference) ?? null) : null;
    const tier = cuts
      ? m.rawScore <= cuts.low
        ? ("low" as const)
        : m.rawScore > cuts.high
          ? ("high" as const)
          : ("mid" as const)
      : null;
    return {
      name: m.query.name,
      body: m.query.body,
      etype: m.query.etype,
      reference: m.reference,
      rawScore: m.rawScore,
      tier,
      cuts,
      evidence: {
        complaints: m.complaints,
        powertrainComplaints: m.powertrainComplaints,
        modelYears: m.byYear.length,
        provisional:
          m.reference === "ev" || m.complaints < THIN_EVIDENCE_COMPLAINTS,
      },
      landmineYears: m.byYear.filter((y) => y.landmine).map((y) => y.year),
      byYear: m.byYear,
    };
  });
}
