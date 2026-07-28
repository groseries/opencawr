import { beforeAll, describe, expect, it } from "vitest";
import { classifySizeTier, epaSpecs, epaVehicleDetail, epaVehicleIdsForYear } from "../src/sources/epa.js";

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
    expect(specs.sizeTier).toBe("midsize"); // real VClass: "Midsize Cars"
  });

  it("returns no ids for a year with no EPA data (bare JSON null)", async () => {
    const ids = await epaVehicleIdsForYear("Honda", "Fit", 2022);
    expect(ids).toEqual([]);
  });
});

describe("epa adapter (Chevrolet Volt 2019 fixture, PHEV mapping)", () => {
  it("maps a plug-in hybrid onto phev_gas_mpg/phev_utility_factor/kwh_per_100mi", async () => {
    const ids = await epaVehicleIdsForYear("Chevrolet", "Volt", 2019);
    expect(ids).toContain("40924");

    const detail = await epaVehicleDetail("40924");
    const specs = epaSpecs(detail);
    expect(specs.etype).toBe("phev");
    expect(specs.body).toBe("PHEV"); // finalizeBody folds propulsion into body for phev, per seed convention
    expect(specs.sizeTier).toBe("compact"); // real VClass: "Compact Cars"
    expect(specs.mpg_combined).toBeNull();
    expect(specs.kwh_per_100mi).toBe(31);
    expect(specs.phev_gas_mpg).toBe(42);
    expect(specs.phev_utility_factor).toBe(0.764);
    expect(specs.co2_g_per_mi).toBe(51);
  });
});

describe("classifySizeTier", () => {
  it("groups subcompact/small-wagon with compact, and keeps minicompact as its own (smaller) tier", () => {
    expect(classifySizeTier("Small Station Wagons")).toBe("compact"); // Honda Fit's real VClass
    expect(classifySizeTier("Subcompact Cars")).toBe("compact");
    expect(classifySizeTier("Compact Cars")).toBe("compact"); // Toyota Corolla's real VClass
    expect(classifySizeTier("Minicompact Cars")).toBe("micro"); // Fiat 500's real VClass
    expect(classifySizeTier("Midsize Cars")).toBe("midsize");
    expect(classifySizeTier("Large Cars")).toBe("large");
    expect(classifySizeTier("Standard Sport Utility Vehicle 4WD")).toBe("standard-suv");
    expect(classifySizeTier("Small Sport Utility Vehicle 2WD")).toBe("small-suv");
    expect(classifySizeTier("Vans, Passenger Type")).toBe("van");
    expect(classifySizeTier("Standard Pickup Trucks 4WD")).toBe("standard-truck");
    expect(classifySizeTier("Something EPA hasn't invented yet")).toBe("unknown");
  });
});
