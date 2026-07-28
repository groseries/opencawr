import { beforeAll, describe, expect, it } from "vitest";
import { complaintCounts, normalizeModel, splitComponents } from "../src/sources/nhtsa.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

describe("nhtsa adapter (Honda Fit fixtures)", () => {
  it("returns a complaint count + odi id list per year, no complaint text", async () => {
    const counts = await complaintCounts("Honda", "Fit", [2017, 2018, 2019, 2020]);
    expect(counts).toHaveLength(4);
    for (const c of counts) {
      expect(c.complaints).toBeGreaterThan(0);
      expect(c.odiIds.length).toBe(c.complaints);
      for (const id of c.odiIds) expect(typeof id).toBe("number");
      // counts-only: nothing beyond the ODI id should be attached to a year entry
      expect(Object.keys(c).sort()).toEqual(["complaints", "odiIds", "year"]);
    }
  });

  it("normalizes model casing via VPIC getmodelsformake", async () => {
    expect(await normalizeModel("Honda", "fit")).toBe("Fit");
    expect(await normalizeModel("Honda", "FIT")).toBe("Fit");
  });

  it("falls back to the input model when no VPIC match exists", async () => {
    expect(await normalizeModel("Honda", "Nonexistent-Model-XYZ")).toBe("Nonexistent-Model-XYZ");
  });
});

describe("splitComponents (Task D review fix: category names with embedded commas)", () => {
  // Real `components` values from the recorded Ford Escape 2020 fixture
  // (test/fixtures/046e6462b20b61e3.json) — NHTSA's own category names
  // "FUEL SYSTEM, GASOLINE" and "SERVICE BRAKES, AIR" each contain a comma
  // that a naive `.split(",")` would wrongly treat as a category separator.
  it("keeps 'FUEL SYSTEM, GASOLINE' whole instead of splitting it into two categories", () => {
    expect(splitComponents("ENGINE AND ENGINE COOLING,FUEL SYSTEM, GASOLINE,BACK OVER PREVENTION")).toEqual([
      "ENGINE AND ENGINE COOLING",
      "FUEL SYSTEM, GASOLINE",
      "BACK OVER PREVENTION",
    ]);
  });

  it("keeps 'SERVICE BRAKES, AIR' whole even alongside another comma-containing category", () => {
    expect(splitComponents("SERVICE BRAKES, AIR,FUEL SYSTEM, GASOLINE,TRACTION CONTROL SYSTEM")).toEqual([
      "SERVICE BRAKES, AIR",
      "FUEL SYSTEM, GASOLINE",
      "TRACTION CONTROL SYSTEM",
    ]);
  });

  it("does not corrupt ordinary multi-word categories that merely contain spaces", () => {
    // A naive comma-protection scheme using a plain space as its placeholder
    // would mis-split "ENGINE AND ENGINE COOLING" on its own internal spaces;
    // this pins that it doesn't.
    expect(splitComponents("ENGINE AND ENGINE COOLING,POWER TRAIN")).toEqual([
      "ENGINE AND ENGINE COOLING",
      "POWER TRAIN",
    ]);
  });

  it("returns an empty array for an empty components string", () => {
    expect(splitComponents("")).toEqual([]);
  });
});
