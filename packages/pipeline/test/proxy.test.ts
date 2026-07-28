import { describe, expect, it } from "vitest";
import type { Vehicle } from "@opencawr/core";
import { pickProxyPeer } from "../src/sources/proxy.js";

function fakeVehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    name: "Fake",
    make: "fake",
    body: "Car",
    etype: "gas",
    first_year: 2010,
    last_year: 2020,
    reliability_tier: "mid",
    provenance: "curated",
    specs: {
      mpg_combined: 30,
      kwh_per_100mi: null,
      phev_gas_mpg: null,
      phev_utility_factor: null,
      seats: 5,
      cargo_cu_ft: 15,
      co2_g_per_mi: 300,
      full_coverage_ins_usd_yr: 2000,
    },
    eol_maintained_miles: 200000,
    pinned_buy_odo: 50000,
    pinned_buy_year_est: 2018,
    price_vs_odometer_usd: { "10000": 20000, "100000": 10000 },
    maintenance_usd_per_yr_by_age: { "1": 300, "10": 900 },
    repair_cost_multiplier_by_make: 1,
    model_year_reliability: { bad: [], caution: [], good: [] },
    ...overrides,
  };
}

describe("pickProxyPeer", () => {
  it("picks the peer with the closest mpg_combined within the same body+etype", () => {
    const near = fakeVehicle({ name: "Near", specs: { ...fakeVehicle({}).specs, mpg_combined: 33 } });
    const far = fakeVehicle({ name: "Far", specs: { ...fakeVehicle({}).specs, mpg_combined: 10 } });
    const wrongBody = fakeVehicle({ name: "WrongBody", body: "SUV", specs: { ...fakeVehicle({}).specs, mpg_combined: 34 } });
    const wrongEtype = fakeVehicle({ name: "WrongEtype", etype: "hybrid", specs: { ...fakeVehicle({}).specs, mpg_combined: 34 } });

    const peer = pickProxyPeer([far, wrongBody, wrongEtype, near], {
      body: "Car",
      etype: "gas",
      mpg_combined: 36,
      kwh_per_100mi: null,
    });

    expect(peer.name).toBe("Near");
  });

  it("uses kwh_per_100mi as the distance metric for ev queries", () => {
    const closeEv = fakeVehicle({
      name: "CloseEv",
      body: "EV",
      etype: "ev",
      specs: { ...fakeVehicle({}).specs, mpg_combined: null, kwh_per_100mi: 29 },
    });
    const farEv = fakeVehicle({
      name: "FarEv",
      body: "EV",
      etype: "ev",
      specs: { ...fakeVehicle({}).specs, mpg_combined: null, kwh_per_100mi: 45 },
    });

    const peer = pickProxyPeer([farEv, closeEv], { body: "EV", etype: "ev", mpg_combined: null, kwh_per_100mi: 28 });
    expect(peer.name).toBe("CloseEv");
  });

  it("throws when no peer shares body+etype", () => {
    const civic = fakeVehicle({ name: "Civic" });
    expect(() =>
      pickProxyPeer([civic], { body: "Truck", etype: "gas", mpg_combined: 20, kwh_per_100mi: null }),
    ).toThrow(/No segment-peer/);
  });
});
