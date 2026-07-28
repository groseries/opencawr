import { beforeAll, describe, expect, it } from "vitest";
import { complaintCounts, normalizeModel } from "../src/sources/nhtsa.js";

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
