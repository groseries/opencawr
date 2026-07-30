import { describe, expect, it } from "vitest";
import { energyPerMile } from "../src/engine.js";
import { loadSeedData } from "./helpers.js";

const { constants, vehicles } = loadSeedData();
const volt = vehicles.find((v) => v.name === "Chevy Volt")!;
const gas = constants.gas_usd_per_gal;
const elec = constants.elec_usd_per_kwh;

// Isolate item 1's UF-vs-mileage shape from item 2's pack degradation: degradation is a
// fixed mid-life multiplier applied unconditionally (see ASSUMPTIONS.md §B), so it pulls
// uf below the seed value even at baseline mileage — that's intended, but it would mask
// the anchor property these tests exist to check. Forcing degradation to 1x isolates it.
const constantsNoDeg = { ...constants, ev_kwh_degradation_mult: 1 };

describe("PHEV mileage-dependent utility factor (R7)", () => {
  it("anchors to the seed utility factor at baseline annual_miles", () => {
    const withRange = energyPerMile(volt, constantsNoDeg, gas, elec, constants.annual_miles);
    const noRangeVehicle = {
      ...volt,
      specs: { ...volt.specs, electric_range_mi: undefined },
    };
    // No electric_range_mi -> falls back to the fixed seed uf with no mileage sensitivity.
    // At baseline annual_miles (with degradation isolated out) the anchored formula must
    // reduce to exactly that same fixed value.
    const withoutRange = energyPerMile(noRangeVehicle, constantsNoDeg, gas, elec, constants.annual_miles);
    expect(withRange).toBeCloseTo(withoutRange, 10);
  });

  it("higher annual mileage lowers the utility factor, raising PHEV $/mi", () => {
    const lo = energyPerMile(volt, constantsNoDeg, gas, elec, 8_000);
    const hi = energyPerMile(volt, constantsNoDeg, gas, elec, 24_000);
    // Gas ($5.455/42mpg ≈ $0.130/mi) costs more per mile than the electric share here
    // ($0.38/kWh × 0.31 ≈ $0.118/mi), so shifting miles to gas raises the blended cost.
    expect(hi).toBeGreaterThan(lo);
  });

  it("lower annual mileage raises the utility factor, lowering PHEV $/mi", () => {
    const base = energyPerMile(volt, constantsNoDeg, gas, elec, constants.annual_miles);
    const lo = energyPerMile(volt, constantsNoDeg, gas, elec, 4_000);
    expect(lo).toBeLessThan(base);
  });

  it("clamps the utility factor at 1 instead of overshooting past it", () => {
    // At very low annual mileage the raw anchored ratio exceeds 1 (almost every mile falls
    // within range); uf must clamp to 1, i.e. energy collapses to the pure-electric term.
    const tiny = energyPerMile(volt, constantsNoDeg, gas, elec, 100);
    const pureElectric =
      ((volt.specs.kwh_per_100mi ?? 30) / 100) * elec * constantsNoDeg.dcfc_elec_mult_phev;
    expect(tiny).toBeCloseTo(pureElectric, 10);
  });
});
