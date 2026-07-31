import { beforeAll, describe, expect, it } from "vitest";
import {
  classifySpecChangeYears,
  deriveModelYearDetail,
  topComplaintCategoryByYear,
} from "../src/modelyear/deriveModelYearDetail.js";
import { epaCatalogueQuery, pickModelForYear } from "../src/modelyear/epaCorpus.js";
import {
  drivetrainDescriptor,
  epaModelsForYear,
  epaVehicleDetail,
  epaVehicleIdsForYear,
} from "../src/sources/epa.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

describe("epaCorpus matchers respect the seed row's etype", () => {
  // EPA lists electrified variants as SEPARATE model strings under the same
  // nameplate, so a gas row that matched them would report a hybrid's
  // drivetrain for a gas car (and vice versa).
  const crv = epaCatalogueQuery({ name: "Honda CR-V" }).matchesModel;
  const rav4 = epaCatalogueQuery({ name: "Toyota RAV4" }).matchesModel;
  const rav4Hybrid = epaCatalogueQuery({ name: "Toyota RAV4 Hybrid" }).matchesModel;

  it("a gas row matches the plain drivetrain strings and rejects the Hybrid string", () => {
    expect(crv("CR-V AWD")).toBe(true);
    expect(crv("CR-V FWD")).toBe(true);
    expect(crv("CR-V Hybrid AWD")).toBe(false);
    expect(crv("CR-V e-FCEV")).toBe(false);

    expect(rav4("RAV4 AWD")).toBe(true);
    expect(rav4("RAV4 Hybrid AWD")).toBe(false);
    expect(rav4("RAV4 EV")).toBe(false);
    expect(rav4("RAV4 Prime 4WD")).toBe(false);
  });

  it("the electrified row matches the electrified string and nothing else", () => {
    expect(rav4Hybrid("RAV4 Hybrid AWD")).toBe(true);
    expect(rav4Hybrid("RAV4 Hybrid  AWD")).toBe(true); // EPA's MY2021 double space
    expect(rav4Hybrid("RAV4 AWD")).toBe(false);
    expect(rav4Hybrid("RAV4 Prime 4WD")).toBe(false);
  });

  it("throws rather than silently dropping a vehicle with no EPA mapping", () => {
    expect(() => epaCatalogueQuery({ name: "Not A Seed Vehicle" })).toThrow(/No EPA mapping/);
  });
});

describe("pickModelForYear (deterministic single variant)", () => {
  const crv = epaCatalogueQuery({ name: "Honda CR-V" }).matchesModel;

  it("resolves several matching catalogue strings to the sorted-first one", () => {
    expect(pickModelForYear(["CR-V FWD", "CR-V Hybrid AWD", "CR-V AWD"], crv)).toBe("CR-V AWD");
  });

  it("sorts case-insensitively, so EPA's inconsistent capitalization can't flip the pick", () => {
    const leaf = epaCatalogueQuery({ name: "Nissan Leaf" }).matchesModel;
    expect(pickModelForYear(["Leaf SV", "LEAF"], leaf)).toBe("LEAF");
  });

  it("returns null (a gap, not an error) when no catalogue string matches", () => {
    expect(pickModelForYear(["Civic 4Dr", "Accord"], crv)).toBeNull();
  });
});

describe("EPA catalogue resolution (Honda 2022 fixture — the fragmentation regression)", () => {
  it("lists no bare 'CR-V': the single-string query the old derivation used returns nothing", async () => {
    expect(await epaVehicleIdsForYear("Honda", "CR-V", 2022)).toEqual([]);
  });

  it("resolves the real catalogue to one variant, then to a drivetrain descriptor", async () => {
    const models = await epaModelsForYear("Honda", 2022);
    expect(models).toEqual(expect.arrayContaining(["CR-V AWD", "CR-V FWD", "CR-V Hybrid AWD"]));
    expect(models).not.toContain("CR-V");

    const { matchesModel } = epaCatalogueQuery({ name: "Honda CR-V" });
    const model = pickModelForYear(models, matchesModel);
    expect(model).toBe("CR-V AWD");

    const ids = await epaVehicleIdsForYear("Honda", model!, 2022);
    expect(ids.length).toBeGreaterThan(0);
    expect(drivetrainDescriptor(await epaVehicleDetail(ids[0]!))).toBe(
      "1.5L I4, Automatic (variable gear ratios), All-Wheel Drive",
    );
  });
});

describe("classifySpecChangeYears (synthetic, pure)", () => {
  it("the first year is always false, no prior year to compare", () => {
    const result = classifySpecChangeYears([
      { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
    ]);
    expect(result).toEqual([{ year: 2018, specChangeFromPriorYear: false }]);
  });

  it("flags a year when the drivetrain descriptor changes from the prior year", () => {
    const result = classifySpecChangeYears([
      { year: 2018, drivetrain: "2.5L I4, Automatic (AM-S8), FWD", vClass: "Compact Cars" },
      { year: 2019, drivetrain: "2.5L I4, Automatic (AM-S8), FWD", vClass: "Compact Cars" },
      { year: 2020, drivetrain: "2.5L I4, Automatic (CVT), FWD", vClass: "Compact Cars" },
    ]);
    expect(result.find((r) => r.year === 2019)?.specChangeFromPriorYear).toBe(false);
    expect(result.find((r) => r.year === 2020)?.specChangeFromPriorYear).toBe(true);
  });

  it("flags a year when ONLY VClass changes (drivetrain identical)", () => {
    const result = classifySpecChangeYears([
      { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
      { year: 2019, drivetrain: "FWD", vClass: "Midsize Cars" },
    ]);
    expect(result[1]!.specChangeFromPriorYear).toBe(true);
  });

  it("does NOT flag a change from a null drivetrain alone (insufficient data), but still checks VClass", () => {
    const missingDrivetrain = classifySpecChangeYears([
      { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
      { year: 2019, drivetrain: null, vClass: "Compact Cars" },
    ]);
    expect(missingDrivetrain[1]!.specChangeFromPriorYear).toBe(false);

    // Drivetrain unavailable on one side, but VClass differs -> still flagged.
    const vClassStillChecked = classifySpecChangeYears([
      { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
      { year: 2019, drivetrain: null, vClass: "Midsize Cars" },
    ]);
    expect(vClassStillChecked[1]!.specChangeFromPriorYear).toBe(true);
  });

  it("falls back to false only when BOTH signals are unavailable on either side", () => {
    const result = classifySpecChangeYears([
      { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
      { year: 2019, drivetrain: null, vClass: null },
    ]);
    expect(result[1]!.specChangeFromPriorYear).toBe(false);
  });
});

describe("topComplaintCategoryByYear (synthetic, pure)", () => {
  it("picks the category with the highest per-complaint count and computes its share", () => {
    const result = topComplaintCategoryByYear([
      {
        year: 2020,
        complaints: 10,
        components: [
          ...Array(6).fill(["ENGINE"]),
          ...Array(4).fill(["ELECTRICAL SYSTEM"]),
        ],
      },
    ]);
    expect(result[0]!.topCategory).toBe("ENGINE");
    expect(result[0]!.topShare).toBeCloseTo(0.6, 6);
  });

  it("counts a category once per complaint even if it appears multiple times/subcategories in that complaint", () => {
    const result = topComplaintCategoryByYear([
      {
        year: 2020,
        complaints: 2,
        components: [
          // Two different POWER TRAIN subcategories in the SAME complaint -> counts once,
          // not twice (POWER TRAIN ties ENGINE at 1 each; alphabetical tiebreak -> ENGINE).
          ["POWER TRAIN:AUTOMATIC TRANSMISSION", "POWER TRAIN:MANUAL TRANSMISSION"],
          ["ENGINE"],
        ],
      },
    ]);
    expect(result[0]!.topCategory).toBe("ENGINE");
    expect(result[0]!.topShare).toBeCloseTo(0.5, 6);
  });

  it("breaks ties alphabetically", () => {
    const result = topComplaintCategoryByYear([
      {
        year: 2020,
        complaints: 2,
        components: [["STRUCTURE"], ["ENGINE"]],
      },
    ]);
    expect(result[0]!.topCategory).toBe("ENGINE");
  });

  it("returns null/null for a year with zero complaints", () => {
    const result = topComplaintCategoryByYear([{ year: 2021, complaints: 0, components: [] }]);
    expect(result[0]).toEqual({ year: 2021, topCategory: null, topShare: null });
  });
});

describe("deriveModelYearDetail (synthetic, pure)", () => {
  it("builds one entry per year in [first_year, last_year], filling gaps with null/false", () => {
    const detail = deriveModelYearDetail(
      { first_year: 2018, last_year: 2020 },
      [
        { year: 2018, drivetrain: "FWD", vClass: "Compact Cars" },
        { year: 2019, drivetrain: "AWD", vClass: "Compact Cars" },
        // 2020 has no EPA data at all.
      ],
      [{ year: 2018, complaints: 4, components: Array(4).fill(["ENGINE"]) }],
    );

    expect(Object.keys(detail)).toEqual(["2018", "2019", "2020"]);
    expect(detail["2018"]).toEqual({
      drivetrain: "FWD",
      specChangeFromPriorYear: false,
      topComplaintCategory: "ENGINE",
      topComplaintShare: 1,
    });
    expect(detail["2019"]).toEqual({
      drivetrain: "AWD",
      specChangeFromPriorYear: true,
      topComplaintCategory: null,
      topComplaintShare: null,
    });
    expect(detail["2020"]).toEqual({
      drivetrain: null,
      specChangeFromPriorYear: false,
      topComplaintCategory: null,
      topComplaintShare: null,
    });
  });
});
