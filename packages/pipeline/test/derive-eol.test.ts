import { describe, expect, it } from "vitest";
import {
  EXPECTED_LEAKAGE_CEILING,
  MIN_VINS_PER_AGE,
  MIN_WEIBULL_POINTS,
  RATIO_AGES,
  SURVIVAL_AGES,
  NATIONAL_ANCHOR_MILES,
  aggregateHazardRatio,
  bodyClassFor,
  chooseBasis,
  computeHazardRatioPoints,
  computeLeakageCeiling,
  cumulativeSurvival,
  fitWeibull,
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

describe("Step 6.5 ratio-based hazard scaling (the per-model fix)", () => {
  // Real fleet fit from the full-corpus run this fix was validated against:
  // k~4.2, and a representative mid-life fleet 2-year retention ~0.86
  // (h_fleet = -ln(0.86) ~= 0.1508). Reference per-model retention ratios
  // measured directly against fleet at matched ages (model retention /
  // fleet retention): Toyota Corolla 1.039 (most durable end of the
  // spread), Chevy Malibu 0.859 (least durable end).
  const FLEET_K = 4.2;
  const FLEET_RETENTION_MID_LIFE = 0.86;
  const FLEET_MEDIAN_AGE = 18;

  describe("computeHazardRatioPoints", () => {
    const fleetRetentionByAge = new Map<number, number>([
      [6, 0.9],
      [10, 0.86],
      [14, 0.8],
    ]);

    it("keeps an age when the model clears MIN_VINS_PER_AGE and both sides are positive", () => {
      const modelRetentions: AgeRetention[] = [{ age: 10, n2023: 500, retention: 0.9 }];
      const points = computeHazardRatioPoints(modelRetentions, fleetRetentionByAge, MIN_VINS_PER_AGE);
      expect(points).toEqual([{ age: 10, rho: 0.9 / 0.86, weight: 500 }]);
    });

    it("drops an age when the model's 2023-cohort VIN count is below the threshold", () => {
      const modelRetentions: AgeRetention[] = [{ age: 10, n2023: 199, retention: 0.9 }];
      expect(computeHazardRatioPoints(modelRetentions, fleetRetentionByAge, 200)).toEqual([]);
    });

    it("drops an age when the model's retention is non-positive (a collapsed/degenerate age)", () => {
      const modelRetentions: AgeRetention[] = [{ age: 10, n2023: 500, retention: 0 }];
      expect(computeHazardRatioPoints(modelRetentions, fleetRetentionByAge, MIN_VINS_PER_AGE)).toEqual([]);
    });

    it("drops an age the fleet map has no entry for", () => {
      const modelRetentions: AgeRetention[] = [{ age: 99, n2023: 500, retention: 0.9 }];
      expect(computeHazardRatioPoints(modelRetentions, fleetRetentionByAge, MIN_VINS_PER_AGE)).toEqual([]);
    });

    it("keeps only the ages that pass, from a mixed batch", () => {
      const modelRetentions: AgeRetention[] = [
        { age: 6, n2023: 500, retention: 0.92 },
        { age: 10, n2023: 50, retention: 0.9 }, // too thin
        { age: 14, n2023: 500, retention: 0.7 },
      ];
      const points = computeHazardRatioPoints(modelRetentions, fleetRetentionByAge, MIN_VINS_PER_AGE);
      expect(points.map((p) => p.age)).toEqual([6, 14]);
    });
  });

  describe("aggregateHazardRatio", () => {
    it("Corolla worked example: rho~1.039 -> c~0.746 (below-fleet hazard, longer life)", () => {
      const fleetRetentionByAge = new Map([[10, FLEET_RETENTION_MID_LIFE]]);
      const points = [{ age: 10, rho: 1.039, weight: 1000 }];
      const c = aggregateHazardRatio(points, fleetRetentionByAge);
      expect(c).not.toBeNull();
      expect(c!).toBeCloseTo(0.7463, 3);
    });

    it("Malibu worked example: rho~0.859 -> c~2.007 (above-fleet hazard, shorter life)", () => {
      const fleetRetentionByAge = new Map([[10, FLEET_RETENTION_MID_LIFE]]);
      const points = [{ age: 10, rho: 0.859, weight: 1000 }];
      const c = aggregateHazardRatio(points, fleetRetentionByAge);
      expect(c).not.toBeNull();
      expect(c!).toBeCloseTo(2.0077, 3);
    });

    it("weights the aggregate by each age's sample size", () => {
      const fleetRetentionByAge = new Map([
        [6, FLEET_RETENTION_MID_LIFE],
        [10, FLEET_RETENTION_MID_LIFE],
      ]);
      // Two ages with the same rho -> the aggregate should equal that age's c
      // regardless of weight split (sanity: weighting doesn't distort an
      // already-uniform ratio).
      const points = [
        { age: 6, rho: 1.039, weight: 100 },
        { age: 10, rho: 1.039, weight: 9000 },
      ];
      const c = aggregateHazardRatio(points, fleetRetentionByAge);
      expect(c!).toBeCloseTo(0.7463, 3);
    });

    it("returns null when no points are supplied", () => {
      expect(aggregateHazardRatio([], new Map())).toBeNull();
    });

    it("returns null when every point's fleet retention is missing", () => {
      const points = [{ age: 10, rho: 1.0, weight: 500 }];
      expect(aggregateHazardRatio(points, new Map())).toBeNull();
    });
  });

  describe("scaleMedianAgeByHazardRatio", () => {
    it("Corolla worked example: c~0.746, k~4.2 -> ~1.072x the fleet median age", () => {
      const medianAge = scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 0.7463, FLEET_K);
      expect(medianAge).not.toBeNull();
      expect(medianAge! / FLEET_MEDIAN_AGE).toBeCloseTo(1.072, 2);
    });

    it("Malibu worked example: c~2.007, k~4.2 -> ~0.848x the fleet median age", () => {
      const medianAge = scaleMedianAgeByHazardRatio(FLEET_MEDIAN_AGE, 2.0077, FLEET_K);
      expect(medianAge).not.toBeNull();
      expect(medianAge! / FLEET_MEDIAN_AGE).toBeCloseTo(0.848, 2);
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

  it("no capping, no <1 censoring needed: a model at S~1.0 raw retention still yields a finite, usable c", () => {
    // The defect this fix addresses: the OLD absolute-curve path pinned
    // leakage-corrected survival to exactly 1.0 for a model retaining better
    // than the fleet ceiling, and medianAgeFromWeibull's `0 < S < 1` filter
    // then discarded that point outright. The ratio-based path never
    // constructs a capped survival value in the first place — a retention
    // at/above the fleet's is just a rho slightly above 1, not an undefined
    // boundary case.
    const fleetRetentionByAge = new Map([[10, 0.86]]);
    const points = computeHazardRatioPoints(
      [{ age: 10, n2023: 1000, retention: 0.9 }], // model retention > fleet retention
      fleetRetentionByAge,
      MIN_VINS_PER_AGE,
    );
    expect(points).toHaveLength(1);
    const c = aggregateHazardRatio(points, fleetRetentionByAge);
    expect(c).not.toBeNull();
    expect(Number.isFinite(c!)).toBe(true);
    expect(c!).toBeGreaterThan(0);
    expect(c!).toBeLessThan(1); // better-than-fleet retention -> below-fleet hazard
  });
});

describe("Step 8 coverage fallback (chooseBasis / isLevelUsable)", () => {
  const usable: LevelResult = {
    medianAge: 18,
    r2: 0.95,
    usablePoints: 9,
  };
  const unusable: LevelResult = {
    medianAge: null,
    r2: null,
    usablePoints: 0,
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
