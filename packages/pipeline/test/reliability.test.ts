import { beforeAll, describe, expect, it } from "vitest";
import {
  classifyLandmineYears,
  deriveReliability,
  percentile,
  perYearOnRoadRate,
} from "../src/reliability/derive.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

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

describe("perYearOnRoadRate", () => {
  it("divides complaints by years-on-road", () => {
    expect(perYearOnRoadRate(2018, 100, 2026)).toBeCloseTo(100 / 8, 6);
  });

  it("floors years-on-road at 1 for the current model year", () => {
    expect(perYearOnRoadRate(2026, 10, 2026)).toBe(10);
  });
});

describe("classifyLandmineYears (methodology §4, pure/synthetic)", () => {
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

describe("deriveReliability (offline, real NHTSA fixtures for the 6 named seed models)", () => {
  it("derives a low/mid/high tier plus landmine years for each model, using a fixed currentYear for determinism", async () => {
    const derivations = await deriveReliability(
      [
        { name: "Toyota Corolla", make: "Toyota", model: "Corolla", body: "Car", years: [2018, 2019, 2020, 2021, 2022] },
        { name: "Mazda CX-5", make: "Mazda", model: "CX-5", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
        { name: "Kia Sorento", make: "Kia", model: "Sorento", body: "SUV AWD", years: [2018, 2019, 2020, 2021, 2022] },
        { name: "Ford Escape", make: "Ford", model: "Escape", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
        { name: "Honda Odyssey", make: "Honda", model: "Odyssey", body: "Van", years: [2018, 2019, 2020, 2021, 2022] },
        { name: "Fiat 500", make: "Fiat", model: "500", body: "Car", years: [2015, 2016, 2017, 2018, 2019] },
      ],
      2026,
    );

    expect(derivations).toHaveLength(6);
    for (const d of derivations) {
      expect(["low", "mid", "high"]).toContain(d.tier);
      expect(d.byYear.length).toBeGreaterThan(0);
      expect(Number.isFinite(d.rawScore)).toBe(true);
      expect(Number.isFinite(d.bodyClassIndex)).toBe(true);
    }

    // Real-data spot checks that should hold regardless of exact thresholds:
    // Ford Escape's 2018 model year (well-documented EcoBoost-era complaint spike)
    // is a landmine, and CX-5's normalized index is below Sorento's/Escape's.
    const escape = derivations.find((d) => d.name === "Ford Escape")!;
    expect(escape.landmineYears).toContain(2018);
    const cx5 = derivations.find((d) => d.name === "Mazda CX-5")!;
    const sorento = derivations.find((d) => d.name === "Kia Sorento")!;
    expect(cx5.bodyClassIndex).toBeLessThan(sorento.bodyClassIndex);
  });

  it("documents the singleton-body-class cross-contamination effect (methodology §3 / ASSUMPTIONS.md §G)", async () => {
    // Sorento (SUV AWD) and Odyssey (Van) are the only members of their body
    // classes in this 6-model batch, so their bodyClassIndex is trivially 1.0
    // (methodology §3). Because Q1/Q3 are computed once across ALL 6 indices
    // together, those two 1.0s shift the shared cut points for the OTHER four
    // models too -- not just for themselves. This pins that effect against
    // real data: removing the two singletons from the batch changes CX-5's
    // and Escape's derived tier, even though neither of their own rawScores
    // or body-class medians changed (CX-5/Escape's body-class peer is each
    // other, unaffected by Sorento/Odyssey being in a different body class).
    const fourModelQueries = [
      { name: "Toyota Corolla", make: "Toyota", model: "Corolla", body: "Car", years: [2018, 2019, 2020, 2021, 2022] },
      { name: "Mazda CX-5", make: "Mazda", model: "CX-5", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
      { name: "Ford Escape", make: "Ford", model: "Escape", body: "SUV", years: [2018, 2019, 2020, 2021, 2022] },
      { name: "Fiat 500", make: "Fiat", model: "500", body: "Car", years: [2015, 2016, 2017, 2018, 2019] },
    ];
    const sixModelQueries = [
      ...fourModelQueries,
      { name: "Kia Sorento", make: "Kia", model: "Sorento", body: "SUV AWD", years: [2018, 2019, 2020, 2021, 2022] },
      { name: "Honda Odyssey", make: "Honda", model: "Odyssey", body: "Van", years: [2018, 2019, 2020, 2021, 2022] },
    ];

    const fourModel = await deriveReliability(fourModelQueries, 2026);
    const sixModel = await deriveReliability(sixModelQueries, 2026);

    const cx5Four = fourModel.find((d) => d.name === "Mazda CX-5")!;
    const cx5Six = sixModel.find((d) => d.name === "Mazda CX-5")!;
    const escapeFour = fourModel.find((d) => d.name === "Ford Escape")!;
    const escapeSix = sixModel.find((d) => d.name === "Ford Escape")!;

    // Same underlying rawScore/bodyClassIndex either way -- CX-5/Escape's
    // only body-class peer is each other, so adding Sorento (SUV AWD) and
    // Odyssey (Van) can't touch that ratio...
    expect(cx5Six.bodyClassIndex).toBeCloseTo(cx5Four.bodyClassIndex, 9);
    expect(escapeSix.bodyClassIndex).toBeCloseTo(escapeFour.bodyClassIndex, 9);
    // ...yet their derived TIER still differs, because the shared Q1/Q3 the
    // singletons' pinned-1.0 indices helped compute are different from batch
    // to batch. This is the disclosed cross-contamination effect, not a bug.
    expect(cx5Six.tier).not.toBe(cx5Four.tier);
    expect(escapeSix.tier).not.toBe(escapeFour.tier);
  });
});
