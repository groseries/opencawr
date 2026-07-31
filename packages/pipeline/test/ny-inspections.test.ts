import { beforeAll, describe, expect, it } from "vitest";
import { distinctVinCount, medianOdometer } from "../src/sources/ny-inspections.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

describe("ny-inspections adapter (Socrata SODA, vezn-fmmk fixtures)", () => {
  it("returns the distinct VIN count for a single-model_name slice (TOYOT CAMRY 2013, CY2023)", async () => {
    const n = await distinctVinCount("TOYOT", ["CAMRY"], 2013, 2023);
    expect(n).toBe(6747);
  });

  it("returns the server-side median odometer reading for the same slice", async () => {
    const med = await medianOdometer("TOYOT", ["CAMRY"], 2013, 2023);
    expect(med).toBe(113324.5);
  });

  it("ORs multiple trim-fragmented model_name values together (HONDA FIT / FIT SPORT 2018, CY2022)", async () => {
    const n = await distinctVinCount("HONDA", ["FIT", "FIT SPORT"], 2018, 2022);
    expect(n).toBe(1690);
    const med = await medianOdometer("HONDA", ["FIT", "FIT SPORT"], 2018, 2022);
    expect(med).toBe(34424);
  });

  it("lower-cases-tolerant: upper-cases make_code/model_name before querying (matching is case-sensitive server-side)", async () => {
    // Same fixture as the first test, reached via lower-case inputs.
    const n = await distinctVinCount("toyot", ["camry"], 2013, 2023);
    expect(n).toBe(6747);
  });

  it("returns 0 distinct VINs for a slice with zero matching rows", async () => {
    const n = await distinctVinCount("ZZZZZ", ["NONE"], 2013, 2023);
    expect(n).toBe(0);
  });

  it("returns 0 median odometer when the response has no `med` key (zero matching rows)", async () => {
    const med = await medianOdometer("ZZZZZ", ["NONE"], 2013, 2023);
    expect(med).toBe(0);
  });
});
