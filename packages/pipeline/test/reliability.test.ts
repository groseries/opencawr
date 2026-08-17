import { beforeAll, describe, expect, it } from "vitest";
import {
  classifyLandmineYears,
  deriveReliability,
  percentile,
  referenceFor,
  type ReliabilityQuery,
} from "../src/reliability/derive.js";
import { corpusQueries, yearsFor } from "../src/reliability/corpus.js";
import { complaintCounts, complaintComponentsByCatalogue } from "../src/sources/nhtsa.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

/** Volvo is the recorded regression corpus for NHTSA's trim-fragmented,
 *  year-inconsistent model catalogue (see test/fixtures/index.json). */
const VOLVO_YEARS = [2017, 2018, 2019, 2020, 2021, 2022];
const volvoQuery = (name: string): ReliabilityQuery =>
  corpusQueries().find((q) => q.name === name)!;

describe("percentile (linear interpolation)", () => {
  it("matches known order statistics", () => {
    const nums = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(percentile(nums, 0)).toBe(1);
    expect(percentile(nums, 1)).toBe(8);
    expect(percentile(nums, 0.5)).toBeCloseTo(4.5, 6);
    // rank = (8-1)*0.25 = 1.75 -> between index 1 (2) and 2 (3)
    expect(percentile(nums, 0.25)).toBeCloseTo(2.75, 6);
  });

  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("classifyLandmineYears (methodology 'Step 4', pure/synthetic)", () => {
  it("flags a year as landmine only when BOTH the 2x-median count AND the >30% powertrain share hold", () => {
    const result = classifyLandmineYears([
      { year: 2017, complaints: 10, components: Array(10).fill(["EXTERIOR LIGHTING"]) },
      { year: 2018, complaints: 10, components: Array(10).fill(["EXTERIOR LIGHTING"]) },
      { year: 2019, complaints: 10, components: Array(10).fill(["EXTERIOR LIGHTING"]) },
      // 2020: > 2x median (10) AND all-powertrain -> landmine
      { year: 2020, complaints: 25, components: Array(25).fill(["ENGINE"]) },
      // 2021: > 2x median count but NOT majority-powertrain -> not landmine
      { year: 2021, complaints: 25, components: Array(25).fill(["EXTERIOR LIGHTING"]) },
    ]);

    expect(result.find((r) => r.year === 2020)?.landmine).toBe(true);
    expect(result.find((r) => r.year === 2021)?.landmine).toBe(false);
    expect(result.find((r) => r.year === 2018)?.landmine).toBe(false);
  });

  it("recognizes POWER TRAIN: subcategories and TRANSMISSION as powertrain", () => {
    const result = classifyLandmineYears([
      { year: 2017, complaints: 4, components: Array(4).fill(["STRUCTURE"]) },
      { year: 2018, complaints: 4, components: Array(4).fill(["STRUCTURE"]) },
      {
        year: 2019,
        complaints: 20,
        components: [
          ...Array(15).fill(["POWER TRAIN:AUTOMATIC TRANSMISSION"]),
          ...Array(5).fill(["STRUCTURE"]),
        ],
      },
    ]);
    expect(result.find((r) => r.year === 2019)?.powertrainShare).toBeCloseTo(0.75, 6);
    expect(result.find((r) => r.year === 2019)?.landmine).toBe(true);
  });

  it("never flags a landmine when the count median is 0", () => {
    const result = classifyLandmineYears([
      { year: 2018, complaints: 0, components: [] },
      { year: 2019, complaints: 1, components: [["ENGINE"]] },
    ]);
    expect(result.every((r) => !r.landmine)).toBe(true);
  });
});

describe("per-year catalogue resolution (real NHTSA fixtures, Volvo XC90)", () => {
  it("finds complaints for every model year that a single hard-coded model string finds none for", async () => {
    // The defect this replaces: NHTSA never lists a bare `XC90` in this window,
    // so the old one-string-per-model query returned count 0 for EVERY year of
    // a car that plainly has complaints -- a failed query the derivation would
    // have read as a flawless vehicle.
    const bareString = await complaintCounts("VOLVO", "XC90", [2017]);
    expect(bareString[0]!.complaints).toBe(0);

    const resolved = await complaintComponentsByCatalogue(
      "VOLVO",
      VOLVO_YEARS,
      volvoQuery("Volvo XC90").matchesModel,
    );
    expect(resolved).toHaveLength(6);
    for (const y of resolved) {
      expect(y.matchedModels.length).toBeGreaterThan(0);
      expect(y.complaints).toBeGreaterThan(0);
      expect(y.components).toHaveLength(y.complaints);
    }
    // MY2017-2021 are trim strings; MY2022 renames them again.
    expect(resolved[0]!.matchedModels).toEqual(["XC90 T5", "XC90 T6"]);
    expect(resolved[5]!.matchedModels).toEqual(["XC90 T5 AWD", "XC90 T5 FWD", "XC90 T6 AWD"]);
  });

  it("de-duplicates by odiNumber across the matched model strings", async () => {
    // NHTSA returns the SAME complaint set for `XC90 T5` and `XC90 T6` (it
    // ignores the trim suffix), so unioning without de-duplication would
    // exactly double MY2017's count.
    const perString = await Promise.all(
      ["XC90 T5", "XC90 T6"].map((m) => complaintCounts("VOLVO", m, [2017])),
    );
    const summed = perString.reduce((n, s) => n + s[0]!.complaints, 0);
    const resolved = await complaintComponentsByCatalogue(
      "VOLVO",
      [2017],
      volvoQuery("Volvo XC90").matchesModel,
    );
    expect(summed).toBe(148);
    expect(resolved[0]!.complaints).toBe(74);
  });

  it("excludes the PHEV trim strings the seed row is not (XC90 T8/Recharge)", () => {
    const match = volvoQuery("Volvo XC90").matchesModel;
    expect(match("XC90 T6 AWD")).toBe(true);
    expect(match("XC90 T8 RECHARGE")).toBe(false);
    expect(match("XC90 T8")).toBe(false);
  });
});

describe("deriveReliability — powertrain complaint SHARE (real NHTSA fixtures)", () => {
  const volvoBatch = () =>
    ["Volvo XC90", "Volvo XC60", "Volvo V90 Cross Country"].map(volvoQuery);

  it("scores each vehicle as its pooled powertrain complaints / total complaints", async () => {
    const derivations = await deriveReliability(volvoBatch());
    expect(derivations).toHaveLength(3);
    for (const d of derivations) {
      expect(d.reference).toBe("main");
      expect(d.rawScore).toBeCloseTo(d.evidence.powertrainComplaints / d.evidence.complaints, 12);
      expect(d.rawScore).toBeGreaterThanOrEqual(0);
      expect(d.rawScore).toBeLessThanOrEqual(1);
      expect(["low", "mid", "high"]).toContain(d.tier);
    }
    // A share, so the tier ordering follows the score ordering globally --
    // there is no per-class partition that could reorder them.
    const sorted = [...derivations].sort((a, b) => a.rawScore - b.rawScore);
    const rank = { low: 0, mid: 1, high: 2 };
    for (let i = 1; i < sorted.length; i++) {
      expect(rank[sorted[i]!.tier!]).toBeGreaterThanOrEqual(rank[sorted[i - 1]!.tier!]);
    }
  });

  it("excludes `sport` from the cut-point computation, not just from assignment", async () => {
    const batch = volvoBatch();
    const asSport = batch.map((q) =>
      q.name === "Volvo V90 Cross Country" ? { ...q, seedTier: "sport" } : q,
    );

    const plain = await deriveReliability(batch);
    const withSport = await deriveReliability(asSport);

    const carveOut = withSport.find((d) => d.name === "Volvo V90 Cross Country")!;
    expect(carveOut.tier).toBeNull();
    expect(carveOut.reference).toBeNull();
    // Its (lowest) score no longer drags the cut points down for the others.
    const xc90 = (ds: typeof plain) => ds.find((d) => d.name === "Volvo XC90")!;
    expect(xc90(plain).rawScore).toBeCloseTo(xc90(withSport).rawScore, 12);
    expect(xc90(withSport).cuts!.low).toBeGreaterThan(xc90(plain).cuts!.low);
  });

  it("routes EVs to their own reference and counts electric propulsion in the numerator", async () => {
    // Mechanism check on recorded data: the same complaints re-scored under the
    // EV reference must include ELECTRICAL SYSTEM / FUEL-PROPULSION, which an
    // EV can generate and an engine/transmission numerator cannot see at all.
    const [gas] = await deriveReliability([volvoQuery("Volvo XC90")]);
    const [ev] = await deriveReliability([{ ...volvoQuery("Volvo XC90"), etype: "ev" }]);
    expect(gas!.reference).toBe("main");
    expect(ev!.reference).toBe("ev");
    expect(ev!.rawScore).toBeGreaterThan(gas!.rawScore);
    expect(ev!.evidence.provisional).toBe(true);
    expect(gas!.evidence.provisional).toBe(false);
  });

  it("routes every seed vehicle to a reference group, with sport never derived", () => {
    const queries = corpusQueries();
    expect(queries).toHaveLength(100);
    const sport = queries.filter((q) => q.seedTier === "sport");
    expect(sport).toHaveLength(2);
    expect(sport.every((q) => referenceFor(q) === null)).toBe(true);
    expect(queries.filter((q) => referenceFor(q) === "ev")).toHaveLength(5);
    expect(queries.filter((q) => referenceFor(q) === "main")).toHaveLength(93);
  });

  it("windows queries at <= 6 model years ending no later than MY2022", () => {
    expect(yearsFor({ first_year: 2013, last_year: 2026 })).toEqual([
      2017, 2018, 2019, 2020, 2021, 2022,
    ]);
    expect(yearsFor({ first_year: 2019, last_year: 2022 })).toEqual([2019, 2020, 2021, 2022]);
    // Models that start after the window keep their own (short) span.
    expect(yearsFor({ first_year: 2025, last_year: 2026 })).toEqual([2025, 2026]);
  });
});
