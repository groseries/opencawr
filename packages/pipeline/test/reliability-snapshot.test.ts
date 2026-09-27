import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TIER_CUT_HIGH, TIER_CUT_LOW, percentile } from "../src/reliability/derive.js";
import { loadSeedData } from "../src/seedData.js";

/**
 * R30 guard (2026-09-26). `reliability_tier` is a percentile of a complaint SHARE over a
 * corpus that keeps accruing, so it is a function of the pull date — before this snapshot
 * existed, nothing in the repo recorded which pull produced a shipped tier, and drift was
 * invisible. Measured at the time: re-deriving moved 9 of 107 tiers, every one of them
 * within 0.03 of a cut point.
 *
 * `meta.reliability_snapshot` now records, for the pinned pull, each row's raw score and
 * the evidence behind it plus the cut points that classified it. These tests assert the
 * shipped data is SELF-CONSISTENT with that record: nobody can hand-edit a tier, a score
 * or a cut without one of them failing. They do NOT re-fetch anything and do not assert
 * that today's NHTSA data still agrees — that comparison is a deliberate re-derivation
 * event, not a CI check (see ASSUMPTIONS.md §P).
 */
const here = dirname(fileURLToPath(import.meta.url));
interface Snapshot {
  derived: string;
  tier_cut_percentiles: { low: number; high: number };
  cuts: Record<string, { low: number; high: number }>;
  rows: Record<
    string,
    {
      reference: "main" | "ev" | null;
      raw_score: number;
      complaints: number;
      powertrain_complaints: number;
      model_years: number;
      provisional: boolean;
    }
  >;
}
const raw = JSON.parse(readFileSync(join(here, "../../../opencawr_data.json"), "utf8")) as {
  meta: { reliability_snapshot: Snapshot };
};
const snapshot = raw.meta.reliability_snapshot;
const { vehicles } = loadSeedData();

function tierFor(score: number, cuts: { low: number; high: number }): "low" | "mid" | "high" {
  return score <= cuts.low ? "low" : score > cuts.high ? "high" : "mid";
}

describe("reliability snapshot is self-consistent with the shipped tiers (R30)", () => {
  it("covers every seed vehicle and nothing else", () => {
    expect(Object.keys(snapshot.rows).sort()).toEqual(vehicles.map((v) => v.name).sort());
  });

  it("records the percentile definition the derivation actually uses", () => {
    expect(snapshot.tier_cut_percentiles).toEqual({ low: TIER_CUT_LOW, high: TIER_CUT_HIGH });
  });

  it("recorded cut points ARE the percentiles of the recorded scores, per reference group", () => {
    for (const reference of ["main", "ev"] as const) {
      const scores = Object.values(snapshot.rows)
        .filter((r) => r.reference === reference)
        .map((r) => r.raw_score);
      expect(scores.length).toBeGreaterThan(0);
      const cuts = snapshot.cuts[reference]!;
      // Scores are stored rounded to 6dp, so allow that much slack and no more.
      expect(percentile(scores, TIER_CUT_LOW)).toBeCloseTo(cuts.low, 5);
      expect(percentile(scores, TIER_CUT_HIGH)).toBeCloseTo(cuts.high, 5);
    }
  });

  it.each(vehicles.map((v) => [v.name, v] as const))(
    "%s: shipped tier is what its recorded score classifies to",
    (name, v) => {
      const row = snapshot.rows[name]!;
      if (row.reference === null) {
        // The sport carve-out is never derived (R12). Its score IS still computed and
        // recorded — `reference: null` means "excluded from the cut points and from tier
        // assignment", not "unscored" — so the score is kept for transparency and the
        // recorded-cuts test above is what proves it never entered a percentile.
        expect(v.reliability_tier).toBe("sport");
        return;
      }
      expect(v.reliability_tier).not.toBe("sport");
      expect(v.reliability_tier).toBe(tierFor(row.raw_score, snapshot.cuts[row.reference]!));
    },
  );

  it("every EV is flagged provisional, and so is every thin-evidence row (R12)", () => {
    for (const [name, row] of Object.entries(snapshot.rows)) {
      if (row.reference === "ev" || (row.reference !== null && row.complaints < 100)) {
        expect(row.provisional, `${name} should be provisional`).toBe(true);
      }
    }
  });

  it("evidence counts are internally coherent", () => {
    for (const [name, row] of Object.entries(snapshot.rows)) {
      expect(row.powertrain_complaints, name).toBeLessThanOrEqual(row.complaints);
      expect(row.raw_score, name).toBeGreaterThanOrEqual(0);
      expect(row.raw_score, name).toBeLessThanOrEqual(1);
      if (row.complaints > 0 && row.reference !== null) {
        expect(row.raw_score, name).toBeCloseTo(row.powertrain_complaints / row.complaints, 5);
      }
    }
  });
});
