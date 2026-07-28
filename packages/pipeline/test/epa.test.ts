import { beforeAll, describe, expect, it } from "vitest";
import { epaSpecs, epaVehicleDetail, epaVehicleIdsForYear } from "../src/sources/epa.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

describe("epa adapter (Toyota Camry 2020 fixture)", () => {
  it("lists vehicle-config ids for the year/make/model", async () => {
    const ids = await epaVehicleIdsForYear("Toyota", "Camry", 2020);
    expect(ids).toContain("42011");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("maps the EPA detail response onto VehicleSpecs fields", async () => {
    const detail = await epaVehicleDetail("42011");
    const specs = epaSpecs(detail);
    expect(specs.etype).toBe("gas");
    expect(specs.body).toBe("Car");
    expect(specs.mpg_combined).toBe(26);
    expect(specs.kwh_per_100mi).toBeNull();
    expect(specs.co2_g_per_mi).toBe(338);
    expect(specs.phev_gas_mpg).toBeNull();
    expect(specs.phev_utility_factor).toBeNull();
  });

  it("returns no ids for a year with no EPA data (bare JSON null)", async () => {
    const ids = await epaVehicleIdsForYear("Honda", "Fit", 2022);
    expect(ids).toEqual([]);
  });
});
