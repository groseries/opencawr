import { beforeAll, describe, expect, it } from "vitest";
import { costPerMile } from "@opencawr/core";
import { assembleVehicle, classifyModelYearReliability } from "../src/assemble.js";
import { loadSeedData } from "../src/seedData.js";
import { validateVehicleShape } from "../src/schema.js";

beforeAll(() => {
  process.env.OPENCAWR_PIPELINE_OFFLINE = "1";
});

describe("assembleVehicle (Honda Fit, no seed entry -> full proxy fallback)", () => {
  it("assembles a vehicle with EPA specs + proxied everything-else, passes schema, runs through costPerMile without NaN", async () => {
    const { vehicle, report } = await assembleVehicle({ make: "Honda", model: "Fit" });

    expect(vehicle.make).toBe("honda");
    expect(vehicle.body).toBe("Car");
    expect(vehicle.etype).toBe("gas");
    expect(vehicle.provenance).toBe("proxied");
    expect(vehicle.specs.mpg_combined).toBeGreaterThan(0);

    const problems = validateVehicleShape(vehicle);
    expect(problems).toEqual([]);

    const epaEntry = report.find((r) => r.source === "epa" && r.field.includes("mpg_combined"));
    expect(epaEntry).toBeDefined();

    const proxyEntries = report.filter((r) => r.source === "proxy");
    expect(proxyEntries.length).toBeGreaterThan(0);
    expect(proxyEntries.some((r) => r.field === "price_vs_odometer_usd")).toBe(true);
    expect(proxyEntries.some((r) => r.field === "reliability_tier" && r.launchBlocked)).toBe(true);

    const reliabilityEntry = report.find((r) => r.field === "model_year_reliability");
    expect(reliabilityEntry?.source).toBe("nhtsa");
    expect(reliabilityEntry?.launchBlocked).toBe(true);

    const { constants } = loadSeedData();
    const result = costPerMile(vehicle, constants);
    expect(Number.isFinite(result.p50)).toBe(true);
    expect(result.p50).toBeGreaterThan(0);
    for (const key of Object.keys(result.breakdown) as (keyof typeof result.breakdown)[]) {
      expect(Number.isFinite(result.breakdown[key])).toBe(true);
    }
  });

  it("picks a same-body/etype segment peer from the real seed data", async () => {
    const { vehicle } = await assembleVehicle({ make: "Honda", model: "Fit" });
    const { vehicles } = loadSeedData();
    // Everything copied from the peer (price curve) must exactly match some real seed vehicle
    // of the same body+etype -- proving the fallback actually used a segment peer, not a fabrication.
    const matchingPeer = vehicles.find(
      (v) =>
        v.body === vehicle.body &&
        v.etype === vehicle.etype &&
        JSON.stringify(v.price_vs_odometer_usd) === JSON.stringify(vehicle.price_vs_odometer_usd),
    );
    expect(matchingPeer).toBeDefined();
  });

  it("does not pick Fiat 500 (a much smaller EPA size class than Fit's) as the segment peer", async () => {
    const { vehicle } = await assembleVehicle({ make: "Honda", model: "Fit" });
    expect(vehicle.name).not.toBe("Fiat 500");
    expect(vehicle.price_vs_odometer_usd).not.toEqual({
      "12000": 14000,
      "30000": 11000,
      "55000": 9000,
      "80000": 7000,
      "110000": 5000,
      "140000": 3500,
    });
  });
});

describe("classifyModelYearReliability (synthetic complaint counts)", () => {
  it("flags a year as caution when its complaint count exceeds 2x the median", () => {
    const counts = [
      { year: 2018, complaints: 40, odiIds: [] },
      { year: 2019, complaints: 45, odiIds: [] },
      { year: 2020, complaints: 200, odiIds: [] }, // > 2x median(42.5) = 85
      { year: 2021, complaints: 38, odiIds: [] },
    ];
    const result = classifyModelYearReliability(counts);
    expect(result.median).toBe(42.5);
    expect(result.caution).toEqual([2020]);
    expect(result.good).toEqual([2018, 2019, 2021]);
    expect(result.bad).toEqual([]);
  });

  it("flags no years as caution when nothing crosses the threshold", () => {
    const counts = [
      { year: 2018, complaints: 40, odiIds: [] },
      { year: 2019, complaints: 50, odiIds: [] },
      { year: 2020, complaints: 60, odiIds: [] },
    ];
    const result = classifyModelYearReliability(counts);
    expect(result.caution).toEqual([]);
    expect(result.good).toEqual([2018, 2019, 2020]);
  });
});
