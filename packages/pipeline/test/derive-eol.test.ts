import { describe, expect, it } from "vitest";
import {
  EXPECTED_LEAKAGE_CEILING,
  MIN_VINS_PER_AGE,
  MIN_WEIBULL_POINTS,
  RATIO_AGES,
  SURVIVAL_AGES,
  MAX_RELATIVE_SLOPE_SE,
  MIN_ODOMETER_RATE_AGES,
  NATIONAL_ANCHOR_MILES,
  ODOMETER_RATE_AGES,
  bodyClassFor,
  chooseBasis,
  computeLeakageCeiling,
  computeRateRatio,
  cumulativeSurvival,
  fitLeakSeparatedHazard,
  fitWeibull,
  fleetExitHazardByAge,
  isHazardFitUsable,
  isLevelUsable,
  leakageCorrect,
  medianAgeFromWeibull,
  removeCrashAttrition,
  scaleMedianAgeByHazardRatio,
  type AgeRetention,
  type LevelResult,
  type WeibullPoint,
} from "../src/reliability/derive-eol.js";

/** Generates points from a known Weibull curve S(t) = exp(-(t/lambda)^k) at
 *  the given ages — the standard fixture for testing the fit round-trips. */
function weibullPoints(ages: number[], lambda: number, k: number): WeibullPoint[] {
  return ages.map((age) => ({ age, survival: Math.exp(-Math.pow(age / lambda, k)) }));
}

describe("fitWeibull (OLS on the log-log linearization)", () => {
  it("recovers known lambda/k from generated points, with R^2 ~ 1", () => {
    const points = weibullPoints([4, 6, 8, 10, 12, 14, 16, 18, 20], 15, 3);
    const fit = fitWeibull(points);
    expect(fit.lambda).toBeCloseTo(15, 6);
    expect(fit.k).toBeCloseTo(3, 6);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it("throws with fewer than 2 points", () => {
    expect(() => fitWeibull([{ age: 4, survival: 0.9 }])).toThrow();
  });
});

describe("medianAgeFromWeibull — the Corolla case (right-censored curve)", () => {
  it("extrapolates a sensible median for a curve that never crosses S=0.5 within the observed ages", () => {
    // lambda=40, k=2.5 -> S(20) = exp(-(0.5)^2.5) ~= 0.838, still well above
    // 0.5 at the oldest observed age: naive interpolation would return n/a.
    const points = weibullPoints([4, 6, 8, 10, 12, 14, 16, 18, 20], 40, 2.5);
    expect(points.every((p) => p.survival > 0.5)).toBe(true);

    const result = medianAgeFromWeibull(points);
    expect(result.provisional).toBe(false);
    expect(result.medianAge).not.toBeNull();
    // Median must lie beyond the observed range for a curve that never dips
    // below 0.5 within it.
    expect(result.medianAge!).toBeGreaterThan(20);
    expect(result.fit!.r2).toBeGreaterThan(0.999);
  });

  it("returns provisional with a null median when fewer than MIN_WEIBULL_POINTS are usable", () => {
    const points: WeibullPoint[] = [
      { age: 4, survival: 0.95 },
      { age: 6, survival: 0.9 },
      { age: 8, survival: 0.85 },
    ];
    expect(points.length).toBeLessThan(MIN_WEIBULL_POINTS);
    const result = medianAgeFromWeibull(points);
    expect(result.provisional).toBe(true);
    expect(result.medianAge).toBeNull();
    expect(result.usablePoints).toBe(3);
  });

  it("drops S<=0 and S>=1 points before counting usable points (a too-new nameplate collapses to 0 usable points)", () => {
    // A nameplate with no data older than age 2 sees every age-4..20
    // cohort's raw retention floor to 0 (n2023=0), which after leakage
    // correction and cumulative chaining is exactly S<=0 everywhere.
    const points: WeibullPoint[] = [4, 6, 8, 10, 12, 14, 16, 18, 20].map((age) => ({
      age,
      survival: 0,
    }));
    const result = medianAgeFromWeibull(points);
    expect(result.usablePoints).toBe(0);
    expect(result.provisional).toBe(true);
    expect(result.medianAge).toBeNull();
  });
});

describe("leakageCorrect (Step 2)", () => {
  it("caps at 1 when raw retention divided by the ceiling would exceed certainty", () => {
    expect(leakageCorrect(1.0, EXPECTED_LEAKAGE_CEILING)).toBe(1);
    expect(leakageCorrect(0.95, 0.9)).toBe(1);
  });

  it("otherwise returns retention / ceiling", () => {
    expect(leakageCorrect(0.81, 0.9)).toBeCloseTo(0.9, 10);
    expect(leakageCorrect(EXPECTED_LEAKAGE_CEILING, EXPECTED_LEAKAGE_CEILING)).toBeCloseTo(1, 10);
  });
});

describe("computeLeakageCeiling", () => {
  it("divides the max ages-4-8 retention by one 2-year step of crash-only survival", () => {
    // Real measured fleet retentions (2026-07-30). Raw max is 0.9016 at age
    // 4; the crash-consistent ceiling lifts it by (1 - 0.015)^2 = 0.9702.
    const L = computeLeakageCeiling([0.9016, 0.8969, 0.8869], 0.015);
    expect(L).toBeCloseTo(0.9016 / Math.pow(1 - 0.015, 2), 10);
    expect(L).toBeCloseTo(0.9293, 4);
  });

  it("is strictly above the raw max retention (the raw max asserts zero attrition, which is wrong)", () => {
    const raw = 0.9016;
    expect(computeLeakageCeiling([raw], 0.015)).toBeGreaterThan(raw);
  });

  it("throws when the computed ceiling drifts far from the measured ~0.93 (dataset-shape guard)", () => {
    expect(() => computeLeakageCeiling([0.5, 0.4, 0.3], 0.015)).toThrow();
  });
});

describe("cumulativeSurvival (Step 4)", () => {
  it("chains leakage-corrected retention starting from S=1, sorted by age", () => {
    const result = cumulativeSurvival([
      { age: 6, trueSurvival: 0.9 },
      { age: 4, trueSurvival: 0.95 },
    ]);
    expect(result).toEqual([
      { age: 4, survival: 0.95 },
      { age: 6, survival: 0.95 * 0.9 },
    ]);
  });
});

describe("removeCrashAttrition (Step 4.5)", () => {
  it("inflates observed survival by (1 - rate)^-age, matching the closed-form", () => {
    const rate = 0.015;
    const observed: { age: number; survival: number }[] = [{ age: 20, survival: 0.5 }];
    const [result] = removeCrashAttrition(observed, rate);
    expect(result!.survival).toBeCloseTo(0.5 / Math.pow(1 - rate, 20), 10);
  });

  it("caps at 1 rather than exceeding certainty", () => {
    const [result] = removeCrashAttrition([{ age: 20, survival: 0.99 }], 0.015);
    expect(result!.survival).toBe(1);
  });

  it("is a no-op at rate=0", () => {
    const points = [
      { age: 4, survival: 0.99 },
      { age: 20, survival: 0.4 },
    ];
    const result = removeCrashAttrition(points, 0);
    expect(result).toEqual(points);
  });
});

describe("recovers a realistic fleet median (external validation of the leakage + crash-removal correction)", () => {
  // Fleet OBSERVED curve measured live this session: Weibull k=4.192,
  // lambda=19.81 -> median age 18.15yr, matching the independent real-world
  // consensus for US passenger cars (~17-18yr). This is the main evidence
  // the leakage correction (Step 2) is sound.
  const OBSERVED_LAMBDA = 19.81;
  const OBSERVED_K = 4.192;
  const TOTAL_LOSS_RATE_PER_YR = 0.015;

  it("the fleet OBSERVED median lands in the real-world consensus band (~17-19yr)", () => {
    const observed = weibullPoints([4, 6, 8, 10, 12, 14, 16, 18, 20], OBSERVED_LAMBDA, OBSERVED_K);
    const result = medianAgeFromWeibull(observed);
    expect(result.provisional).toBe(false);
    expect(result.medianAge!).toBeGreaterThan(17.5);
    expect(result.medianAge!).toBeLessThan(19);
    expect(result.fit!.r2).toBeGreaterThan(0.999);
  });

  // The REAL fleet retentions pulled from the NY DMV API on 2026-07-30, at
  // cohort ages 4..20 (2023 -> 2025). Driving the whole pipeline off these
  // rather than a synthetic curve is the point: it pins the actual numbers
  // the shipped derivation depends on.
  const MEASURED_FLEET_RETENTION = [
    { age: 4, retention: 0.9016 },
    { age: 6, retention: 0.8969 },
    { age: 8, retention: 0.8869 },
    { age: 10, retention: 0.8609 },
    { age: 12, retention: 0.8276 },
    { age: 14, retention: 0.7881 },
    { age: 16, retention: 0.7804 },
    { age: 18, retention: 0.7593 },
    { age: 20, retention: 0.7618 },
  ];

  function measuredFleetCurves() {
    const L = computeLeakageCeiling([0.9016, 0.8969, 0.8869], TOTAL_LOSS_RATE_PER_YR);
    const observed = cumulativeSurvival(
      MEASURED_FLEET_RETENTION.map(({ age, retention }) => ({
        age,
        trueSurvival: leakageCorrect(retention, L),
      })),
    );
    return { observed, mechanical: removeCrashAttrition(observed, TOTAL_LOSS_RATE_PER_YR) };
  }

  it("removing crash attrition raises the median (mechanical-only survival exceeds observed)", () => {
    const { observed, mechanical } = measuredFleetCurves();

    const observedResult = medianAgeFromWeibull(observed);
    const mechanicalResult = medianAgeFromWeibull(mechanical);
    expect(observedResult.medianAge).not.toBeNull();
    expect(mechanicalResult.medianAge).not.toBeNull();

    // Mechanical-only survival is never lower than observed (crashes only
    // ever remove cars, never add them back), so the derived median age
    // rises — this is what "un-double-counts" crash attrition against the
    // engine's own total_loss_rate_per_yr hazard.
    expect(mechanicalResult.medianAge!).toBeGreaterThan(observedResult.medianAge!);

    const maintainedBonus = mechanicalResult.medianAge! / observedResult.medianAge!;
    expect(maintainedBonus).toBeGreaterThan(1.0);
    expect(maintainedBonus).toBeLessThan(1.3); // below the legacy un-derived 1.30 judgment
  });

  // Regression guard for the defect this fix addresses. With the naive
  // ceiling (raw max retention, = asserting ZERO attrition at age 4), crash
  // removal capped S_mechanical at 1.0 for ages 4 through 12 and left only 4
  // usable points — below MIN_WEIBULL_POINTS, so the fleet context failed to
  // resolve at all. The crash-consistent ceiling keeps enough points alive.
  it("leaves enough usable mechanical points to fit (the raw-max ceiling starved this to 4)", () => {
    const { mechanical } = measuredFleetCurves();
    const usable = mechanical.filter((p) => p.survival > 0 && p.survival < 1);
    expect(usable.length).toBeGreaterThanOrEqual(MIN_WEIBULL_POINTS);

    const naiveCeiling = 0.9016; // raw max, no crash division
    const naiveMechanical = removeCrashAttrition(
      cumulativeSurvival(
        MEASURED_FLEET_RETENTION.map(({ age, retention }) => ({
          age,
          trueSurvival: leakageCorrect(retention, naiveCeiling),
        })),
      ),
      TOTAL_LOSS_RATE_PER_YR,
    );
    const naiveUsable = naiveMechanical.filter((p) => p.survival > 0 && p.survival < 1);
    expect(naiveUsable.length).toBeLessThan(MIN_WEIBULL_POINTS);
  });
});

describe("bodyClassFor (Step 7 body -> national anchor mapping)", () => {
  const cases: Array<[string, "car" | "light-truck"]> = [
    ["Car", "car"],
    ["EV", "car"],
    ["PHEV", "car"],
    ["Sport", "car"],
    ["SUV", "light-truck"],
    ["SUV AWD", "light-truck"],
    ["EV SUV", "light-truck"],
    ["PHEV SUV AWD", "light-truck"],
    ["Truck", "light-truck"],
    ["Van", "light-truck"],
  ];

  it.each(cases)("maps seed body %s to class %s", (body, expected) => {
    expect(bodyClassFor(body)).toBe(expected);
  });

  it("covers all 10 seed body values exactly (no gaps, no overlap)", () => {
    expect(cases).toHaveLength(10);
  });

  it("has a national anchor for every mapped class, car < light-truck (per DOT HS 809 952)", () => {
    expect(NATIONAL_ANCHOR_MILES.car).toBe(152_137);
    expect(NATIONAL_ANCHOR_MILES["light-truck"]).toBe(179_954);
    expect(NATIONAL_ANCHOR_MILES.car).toBeLessThan(NATIONAL_ANCHOR_MILES["light-truck"]);
  });

  it("throws for an unrecognized body value", () => {
    expect(() => bodyClassFor("Minivan")).toThrow();
  });
});

describe("Step 6.5 leak-separating hazard regression (the per-model fix)", () => {
  // Real fleet fit from the full-corpus run this fix was validated against:
  // k~4.2, fleet median age ~18. The reference hazard ratios are the fitted
  // slopes measured on the real corpus: Toyota Highlander 0.424 (most
  // durable), Chevy Equinox 3.292 (least durable).
  const FLEET_K = 4.2;
  const FLEET_MEDIAN_AGE = 18;

  /** Real measured fleet retention at a spread of ages, and the measured
   *  crash-consistent ceiling. `m_fleet` at age 4 is crash-only. */
  const FLEET_RETENTION = new Map<number, number>([
    [4, 0.9016],
    [8, 0.8869],
    [12, 0.8276],
    [16, 0.7804],
    [20, 0.7618],
  ]);
  const L = 0.9293;

  describe("fleetExitHazardByAge", () => {
    it("subtracts the fleet's own leak hazard from the total measured hazard", () => {
      const m = fleetExitHazardByAge(FLEET_RETENTION, L);
      // -ln(0.8276) - -ln(0.9293) = 0.18921 - 0.07333
      expect(m.get(12)!).toBeCloseTo(0.1159, 4);
    });

    it("is the same decomposition Step 2's leakageCorrect performs", () => {
      // Dividing retention by L is subtracting -ln(L) in hazard terms, so
      // the exit hazard must equal -ln(leakage-corrected retention).
      const m = fleetExitHazardByAge(FLEET_RETENTION, L);
      for (const [age, retention] of FLEET_RETENTION) {
        if (!m.has(age)) continue;
        expect(m.get(age)!).toBeCloseTo(-Math.log(leakageCorrect(retention, L)), 10);
      }
    });

    it("rises steeply with age — the leak is 70.8% of measured hazard at age 4 and 27.0% at age 20", () => {
      const m = fleetExitHazardByAge(FLEET_RETENTION, L);
      const leakShare = (age: number) =>
        -Math.log(L) / -Math.log(FLEET_RETENTION.get(age)!);
      expect(leakShare(4)).toBeCloseTo(0.708, 3);
      expect(leakShare(20)).toBeCloseTo(0.27, 2);
      // This is exactly why the rejected ratio estimator misranked: at age 4
      // its c is a ratio of two numbers that are ~71% leakage.
      expect(m.get(20)!).toBeGreaterThan(m.get(4)! * 5);
    });

    it("drops an age with no measurable exit at all (corrected retention at/above 1)", () => {
      expect(fleetExitHazardByAge(new Map([[4, 0.99]]), L).has(4)).toBe(false);
    });
  });

  describe("fitLeakSeparatedHazard", () => {
    const fleetExit = fleetExitHazardByAge(FLEET_RETENTION, L);
    const ages = [...fleetExit.keys()];

    /** Builds a model whose hazard is exactly `leak + c * m_fleet(age)`. */
    function synthetic(c: number, leak: number, n = 1000): AgeRetention[] {
      return ages.map((age) => ({
        age,
        n2023: n,
        retention: Math.exp(-(leak + c * fleetExit.get(age)!)),
      }));
    }

    it("recovers a known slope and intercept exactly from a synthetic model", () => {
      const fit = fitLeakSeparatedHazard(synthetic(0.424, 0.0918), fleetExit, MIN_VINS_PER_AGE);
      expect(fit).not.toBeNull();
      expect(fit!.c).toBeCloseTo(0.424, 6);
      expect(fit!.leak).toBeCloseTo(0.0918, 6);
      expect(fit!.r2).toBeCloseTo(1, 6);
    });

    it("separates durability from leak: two models with the SAME slope and different leaks both recover c", () => {
      // This is the whole point of the fix. The rejected estimator divided
      // total hazard by total hazard, so a model that merely LEAKS more
      // (Camry at 2.02x the fleet leak) read as less durable. Here the leak
      // lands in the intercept and leaves the slope alone.
      const lowLeak = fitLeakSeparatedHazard(synthetic(0.7, 0.006), fleetExit, MIN_VINS_PER_AGE);
      const highLeak = fitLeakSeparatedHazard(synthetic(0.7, 0.172), fleetExit, MIN_VINS_PER_AGE);
      expect(lowLeak!.c).toBeCloseTo(0.7, 6);
      expect(highLeak!.c).toBeCloseTo(0.7, 6);
      expect(highLeak!.leak - lowLeak!.leak).toBeCloseTo(0.166, 6);
    });

    it("drops ages below MIN_VINS_PER_AGE, and returns null once too few remain", () => {
      const thin = synthetic(0.7, 0.05).map((r, i) =>
        i < 2 ? { ...r, n2023: MIN_VINS_PER_AGE - 1 } : r,
      );
      expect(fitLeakSeparatedHazard(thin, fleetExit, MIN_VINS_PER_AGE)).toBeNull();
      expect(fitLeakSeparatedHazard(synthetic(0.7, 0.05), fleetExit, MIN_VINS_PER_AGE)!.n).toBe(
        ages.length,
      );
    });

    it("returns null when fewer than MIN_WEIBULL_POINTS ages survive", () => {
      const few = synthetic(0.7, 0.05).slice(0, MIN_WEIBULL_POINTS - 1);
      expect(fitLeakSeparatedHazard(few, fleetExit, MIN_VINS_PER_AGE)).toBeNull();
    });

    it("returns null when the fleet regressor never varies (no slope is identified)", () => {
      const flat = new Map(ages.map((age) => [age, 0.1]));
      expect(fitLeakSeparatedHazard(synthetic(0.7, 0.05), flat, MIN_VINS_PER_AGE)).toBeNull();
    });
  });

  describe("isHazardFitUsable — the guard that refuses to derive an unmeasurable nameplate", () => {
    const base = { c: 1, leak: 0.07, seC: 0.1, r2: 0.9, n: 9 };

    it("accepts a precisely-fitted slope (Corolla measured 0.725 +/- 0.080, 11%)", () => {
      expect(isHazardFitUsable({ ...base, c: 0.725, seC: 0.08 })).toBe(true);
    });

    it("rejects Fiat 500's real fit (c = 1.123 +/- 0.740, 66% relative error)", () => {
      expect(isHazardFitUsable({ ...base, c: 1.123, seC: 0.74 })).toBe(false);
    });

    it("rejects a non-positive slope, and null", () => {
      expect(isHazardFitUsable({ ...base, c: -0.2, seC: 0.01 })).toBe(false);
      expect(isHazardFitUsable(null)).toBe(false);
    });

    it("cuts exactly at MAX_RELATIVE_SLOPE_SE", () => {
      expect(isHazardFitUsable({ ...base, c: 1, seC: MAX_RELATIVE_SLOPE_SE })).toBe(true);
      expect(isHazardFitUsable({ ...base, c: 1, seC: MAX_RELATIVE_SLOPE_SE + 1e-9 })).toBe(false);
    });
  });

  describe("computeRateRatio (Step 7's mileage half)", () => {
    // Real measured private-registration medians, fleet vs Fiat 500.
    const fleetOdo = new Map<number, number>([
      [6, 62300],
      [8, 84262],
      [10, 103795],
      [12, 116917],
      [14, 130994],
      [16, 134278],
    ]);

    it("is 1 for a model matching the fleet at every age", () => {
      expect(computeRateRatio(fleetOdo, fleetOdo)!.ratio).toBeCloseTo(1, 10);
    });

    it("measures Fiat 500 well below fleet (6,243 vs 9,420 mi/yr) on the ages it has", () => {
      const fiat = new Map<number, number>([
        [6, 28596],
        [8, 46576],
        [10, 67472],
        [12, 79306],
      ]);
      const rr = computeRateRatio(fiat, fleetOdo)!;
      expect(rr.ratio).toBeLessThan(0.75);
      expect(rr.ages).toEqual([6, 8, 10, 12]);
    });

    it("cancels the fleet's own accumulation profile, so a young-only nameplate isn't over-rated", () => {
      // Cars accumulate faster when young: the fleet's own implied rate falls
      // from 10,383 mi/yr at age 6 to 8,392 at age 16. A model that tracks
      // the fleet exactly but is only observed young must still read 1.0 —
      // which is what taking the ratio age-for-age buys.
      const youngOnly = new Map([
        [6, fleetOdo.get(6)!],
        [8, fleetOdo.get(8)!],
      ]);
      expect(computeRateRatio(youngOnly, fleetOdo)!.ratio).toBeCloseTo(1, 10);
    });

    it("returns null below MIN_ODOMETER_RATE_AGES shared ages", () => {
      expect(computeRateRatio(new Map([[6, 60000]]), fleetOdo)).toBeNull();
      expect(computeRateRatio(new Map(), fleetOdo)).toBeNull();
    });

    it("ignores an age either side is missing or reports as 0 (the no-rows sentinel)", () => {
      const withHole = new Map([
        [6, 62300],
        [8, 0],
        [10, 103795],
        [99, 999999],
      ]);
      expect(computeRateRatio(withHole, fleetOdo)!.ages).toEqual([6, 10]);
    });

    it("only samples ODOMETER_RATE_AGES, which stop at 16", () => {
      expect([...ODOMETER_RATE_AGES]).toEqual([6, 8, 10, 12, 14, 16]);
      expect(MIN_ODOMETER_RATE_AGES).toBeLessThanOrEqual(ODOMETER_RATE_AGES.length);
    });
  });

  describe("scaleMedianAgeByHazardRatio", () => {
    it("Highlander worked example: c~0.424, k~4.2 -> ~1.22x the fleet median age", () => {
      const medianAge = scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 0.424, FLEET_K);
      expect(medianAge).not.toBeNull();
      expect(medianAge! / FLEET_MEDIAN_AGE).toBeCloseTo(1.226, 2);
    });

    it("Equinox worked example: c~3.292, k~4.2 -> ~0.75x the fleet median age", () => {
      const medianAge = scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 3.292, FLEET_K);
      expect(medianAge).not.toBeNull();
      expect(medianAge! / FLEET_MEDIAN_AGE).toBeCloseTo(0.754, 2);
    });

    it("c=1 (identical hazard to fleet) is a no-op", () => {
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 1, FLEET_K)).toBeCloseTo(FLEET_MEDIAN_AGE, 10);
    });

    it("returns null for a non-positive or non-finite c or k", () => {
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 0, FLEET_K)).toBeNull();
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, -1, FLEET_K)).toBeNull();
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, Infinity, FLEET_K)).toBeNull();
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 0.75, 0)).toBeNull();
      expect(scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 0.75, -1)).toBeNull();
    });
  });

  it("no capping, no <1 censoring needed: a model retaining better than the fleet ceiling still fits", () => {
    // The defect the FIRST rejected path had: it pinned leakage-corrected
    // survival to exactly 1.0 for a model retaining better than the fleet
    // ceiling, and medianAgeFromWeibull's `0 < S < 1` filter then discarded
    // that point outright — biased hardest against the most durable models.
    // A hazard regression never constructs a capped survival value at all.
    const fleetExit = fleetExitHazardByAge(FLEET_RETENTION, L);
    const better: AgeRetention[] = [...fleetExit.keys()].map((age) => ({
      age,
      n2023: 1000,
      // Retention above the leakage ceiling at every age.
      retention: Math.min(0.99, Math.exp(-0.3 * fleetExit.get(age)!)),
    }));
    const fit = fitLeakSeparatedHazard(better, fleetExit, MIN_VINS_PER_AGE);
    expect(fit).not.toBeNull();
    expect(isHazardFitUsable(fit)).toBe(true);
    expect(fit!.c).toBeGreaterThan(0);
    expect(fit!.c).toBeLessThan(1); // better-than-fleet retention -> below-fleet hazard
  });
});

describe("Step 8 coverage fallback (chooseBasis / isLevelUsable)", () => {
  const usable: LevelResult = {
    medianAge: 18,
    r2: 0.95,
    usablePoints: 9,
    fit: { c: 0.9, leak: 0.07, seC: 0.05, r2: 0.95, n: 9 },
  };
  const unusable: LevelResult = {
    medianAge: null,
    r2: null,
    usablePoints: 0,
    fit: null,
  };

  it("prefers the nameplate level when it's usable", () => {
    expect(chooseBasis(usable, usable)).toBe("nameplate");
    expect(chooseBasis(usable, null)).toBe("nameplate");
  });

  it("falls through to make when the nameplate is unusable but make is supplied and usable (rescues a too-new nameplate, e.g. Kia K4)", () => {
    expect(chooseBasis(unusable, usable)).toBe("make");
  });

  it("falls through to fleet when both nameplate and make are unusable", () => {
    expect(chooseBasis(unusable, unusable)).toBe("fleet");
  });

  it("falls through to fleet when the nameplate is unusable and no make query was supplied", () => {
    expect(chooseBasis(unusable, null)).toBe("fleet");
  });

  it("isLevelUsable requires a real (non-degenerate) median age", () => {
    expect(isLevelUsable(usable)).toBe(true);
    expect(isLevelUsable({ ...usable, medianAge: null })).toBe(false);
  });
});

describe("SURVIVAL_AGES vs RATIO_AGES — the chaining-interval regression", () => {
  it("SURVIVAL_AGES steps are 2 apart, because cumulativeSurvival chains one 2-year retention per step", () => {
    // Each step contributes one 2-year retention, so the steps must cover
    // DISJOINT intervals. Any two consecutive ages 1 apart would overlap
    // (age 4 covers 4->6 while age 5 covers 5->7) and attrition would be
    // counted roughly twice.
    const gaps = SURVIVAL_AGES.slice(1).map((age, i) => age - SURVIVAL_AGES[i]!);
    expect(gaps.every((g) => g === 2)).toBe(true);
  });

  it("RATIO_AGES samples every age — it aggregates independent ratios and never chains", () => {
    const gaps = RATIO_AGES.slice(1).map((age, i) => age - RATIO_AGES[i]!);
    expect(gaps.every((g) => g === 1)).toBe(true);
    expect(RATIO_AGES.length).toBeGreaterThan(SURVIVAL_AGES.length);
  });

  it("chaining at 1-year spacing double-counts attrition and collapses the fleet median (the measured bug)", () => {
    // Reproduces what shipped briefly: feeding 1-year-spaced ages into the
    // 2-year-retention chain drove the real fleet observed median from
    // 16.90yr to 13.20yr, outside the real-world consensus band that is this
    // method's main external validation.
    const perStepRetention = 0.93;
    const correct = cumulativeSurvival(
      SURVIVAL_AGES.map((age) => ({ age, trueSurvival: perStepRetention })),
    );
    const doubleCounted = cumulativeSurvival(
      RATIO_AGES.map((age) => ({ age, trueSurvival: perStepRetention })),
    );
    const correctMedian = medianAgeFromWeibull(correct).medianAge!;
    const brokenMedian = medianAgeFromWeibull(doubleCounted).medianAge!;
    expect(brokenMedian).toBeLessThan(correctMedian);
  });
});
