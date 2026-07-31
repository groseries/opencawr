import { describe, expect, it } from "vitest";
import { CORPUS_EOL, MAPPING_NOTES, eolQueryFor } from "../src/reliability/corpus-eol.js";
import { loadSeedData } from "../src/seedData.js";

describe("corpus-eol coverage (see corpus-eol.ts docstring)", () => {
  it("has exactly one entry per seed vehicle, no typos in the name keys", () => {
    const { vehicles } = loadSeedData();
    const seedNames = vehicles.map((v) => v.name);

    // Every seed name must be a key -- a misspelled key would silently
    // produce a zero-sample "flawless car" downstream, the same failure
    // mode corpus.ts's own docstring warns about for the NHTSA equivalent.
    for (const name of seedNames) {
      expect(CORPUS_EOL, `missing CORPUS_EOL entry for seed vehicle "${name}"`).toHaveProperty(name);
    }

    // No stray keys that don't correspond to a real seed vehicle (would
    // also indicate a typo, just in the other direction).
    const seedNameSet = new Set(seedNames);
    for (const key of Object.keys(CORPUS_EOL)) {
      expect(seedNameSet.has(key), `CORPUS_EOL has a key "${key}" not present in opencawr_data.json`).toBe(
        true,
      );
    }

    expect(Object.keys(CORPUS_EOL)).toHaveLength(71);
    expect(Object.keys(CORPUS_EOL)).toHaveLength(seedNames.length);
  });

  it("marks exactly the two Porsche 996 rows as not derivable", () => {
    const notDerivable = Object.entries(CORPUS_EOL).filter(([, v]) => !v.derivable);
    expect(notDerivable.map(([name]) => name).sort()).toEqual(["Porsche 996 Carrera", "Porsche 996 Turbo"]);
    for (const [, entry] of notDerivable) {
      if (!entry.derivable) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every derivable entry a non-empty makeCode and modelNames", () => {
    for (const [name, entry] of Object.entries(CORPUS_EOL)) {
      if (!entry.derivable) continue;
      expect(entry.makeCode, name).toMatch(/^[A-Z]{2,5}$/);
      expect(entry.modelNames.length, name).toBeGreaterThan(0);
      for (const m of entry.modelNames) {
        expect(m, `${name} modelNames entry`).toMatch(/^[A-Z0-9]+$/);
      }
      expect(entry.sampleSize, name).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.sampleModelYear), name).toBe(true);
    }
  });

  it("only sets a model-year window for the rows that share a model_name across seed rows", () => {
    const windowed = Object.entries(CORPUS_EOL).filter(
      ([, v]) => v.derivable && (v.minModelYear !== undefined || v.maxModelYear !== undefined),
    );
    expect(windowed.map(([name]) => name).sort()).toEqual([
      "Ford Ranger (2019+ midsize)",
      "Ford Ranger (old compact)",
      "Toyota Sienna (V6)",
      "Toyota Sienna Hybrid",
    ]);
  });

  it("flags the doc-specified low-volume models with their real sampled n", () => {
    const lowVolume = Object.entries(CORPUS_EOL)
      .filter(([, v]) => v.derivable && v.lowVolume)
      .map(([name, v]) => [name, v.derivable ? v.sampleSize : undefined] as const);
    const byName = Object.fromEntries(lowVolume);

    expect(byName["Volvo V90 Cross Country"]).toBe(39);
    expect(byName["Fiat 500X"]).toBe(61);
    expect(byName["Nissan Leaf"]).toBe(124);
    expect(byName["Kia Niro (hybrid)"]).toBe(105);
    expect(byName["Toyota Sequoia"]).toBe(164);
    expect(byName["Chevy Bolt EV"]).toBe(405);
    expect(byName["Chrysler Pacifica PHEV"]).toBe(512);
    expect(byName["Chevy Volt"]).toBe(643);
  });

  it("keys every MAPPING_NOTES entry to a real seed vehicle name", () => {
    const { vehicles } = loadSeedData();
    const seedNameSet = new Set(vehicles.map((v) => v.name));
    for (const name of Object.keys(MAPPING_NOTES)) {
      expect(seedNameSet.has(name), `MAPPING_NOTES key "${name}" is not a real seed vehicle`).toBe(true);
    }
  });

  it("eolQueryFor returns the mapped entry for a known vehicle", () => {
    const entry = eolQueryFor("Toyota Camry");
    expect(entry.derivable).toBe(true);
    if (entry.derivable) {
      expect(entry.makeCode).toBe("TOYOT");
      expect(entry.modelNames).toEqual(["CAMRY"]);
    }
  });

  it("eolQueryFor returns a not-derivable result for the Porsche 996 rows", () => {
    const entry = eolQueryFor("Porsche 996 Carrera");
    expect(entry.derivable).toBe(false);
    if (!entry.derivable) {
      expect(entry.reason).toMatch(/911/);
    }
  });

  it("eolQueryFor throws for an unknown vehicle name (never silently drops a typo)", () => {
    expect(() => eolQueryFor("Not A Real Vehicle")).toThrow(/No NY DMV EOL mapping/);
  });
});
