/** End-of-life mileage re-derivation from NY State DMV inspection data.
 *  Replaces the seed data's Consumer-Reports-derived `eol_maintained_miles`
 *  judgment call (ASSUMPTIONS.md §B: "iSeeCars empirical x 1.30 'maintained'
 *  bonus (baked in)") with a survival-analysis estimate, using the same
 *  free/keyless data layer as reliability re-derivation (`sources/ny-inspections.ts`
 *  — read its docstring first for the API traps this module relies on).
 *
 *  THE SHAPE OF THE METHOD: Steps 1-6 below build ONE absolute survival
 *  curve — fleet-wide, pooled across every model in the batch — and fit a
 *  Weibull to it (`deriveFleetContext`, computed once). The per-model path
 *  does NOT repeat that recipe per nameplate/make; see "Step 6.5" below for
 *  why, and for what it does instead.
 *
 *  Step 1 — raw 2-year retention. For a cohort at age `a` in calendar year
 *  2023 (model_year = 2023 - a), retention(a) = distinctVinCount(CY2025) /
 *  distinctVinCount(CY2023) — the same model_year cohort, resurveyed 2 years
 *  later (age a+2 by then).
 *
 *  Step 2 — leakage correction (LOAD-BEARING). Raw retention is NOT survival:
 *  measured fleet-wide retention at age 4 is only 0.9016 and a 4-year-old car
 *  obviously isn't being scrapped at ~10%/2yr. There's a large model-
 *  independent baseline leak (vehicles moving out of NY, inspection-timing
 *  drift, non-compliance). `trueSurvival(a) = min(retention(a) / L, 1)`,
 *  where `L` is the fleet-wide leakage ceiling: the max fleet retention over
 *  ages 4-8 (measured this session: age4 0.9016, age6 0.8969, age8 0.8869 —
 *  monotonically falling, so the max is at age 4). `L` must be computed from
 *  live fleet data (`deriveFleetContext`), not hard-coded — but is asserted
 *  to land near the measured 0.9016 so a dataset-shape change fails loudly
 *  instead of silently producing garbage (`computeLeakageCeiling`).
 *
 *  Step 3 — age range: even ages 4,6,8,10,12,14,16,18,20 only.
 *    - age 2 EXCLUDED: measured retention 0.79, anomalously low vs.
 *      neighboring ages — lease turnover / new-car churn, not scrappage.
 *    - ages >=22 EXCLUDED: measured retention *rises* again (0.7618 @20,
 *      0.7867 @22, 0.8545 @24) — small-n plus a collector/enthusiast
 *      survivorship artifact, not a real reversal of scrappage.
 *
 *  Step 4 — cumulative survival: S_observed(2) = 1, then S_observed(a) =
 *  S_observed(prev) x trueSurvival(a), chained across the age range
 *  (`cumulativeSurvival`).
 *
 *  Step 4.5 — remove crash attrition (LOAD-BEARING). `S_observed` bundles
 *  together mechanical wear-out AND crash total-losses, but the cost engine
 *  (`packages/core/src/engine.ts:154`) already models crash exposure
 *  separately every year via `constants.total_loss_rate_per_yr` (0.015).
 *  Anchoring straight to a crash-inclusive lifetime would double-count crash
 *  attrition on top of the engine's own per-year hazard. So the observed
 *  curve is inflated back up to a mechanical-only curve before fitting:
 *  `S_mechanical(t) = min(S_observed(t) / (1 - total_loss_rate_per_yr)^t, 1)`
 *  (`removeCrashAttrition`). The rate is READ from `opencawr_data.json`'s
 *  `constants.total_loss_rate_per_yr` (via `seedData.ts`), never
 *  hard-coded, so it can never drift from the engine's own constant.
 *
 *  Step 5 — right-censoring via a parametric fit, on the MECHANICAL curve.
 *  Durable models (Corolla, 4Runner, Tacoma, Sequoia, Highlander, ...) never
 *  cross S=0.5 within age 20, so a naive interpolated median is undefined
 *  for them. A Weibull curve `S(t) = exp(-(t/lambda)^k)` is fit by OLS on
 *  the linearized form `ln(-ln S) = k*ln(t) - k*ln(lambda)` (`fitWeibull`),
 *  then median survival age = `lambda * (ln 2)^(1/k)` (`medianAgeFromWeibull`).
 *  Points with S<=0 or S>=1 are dropped before the transform (undefined
 *  there); fewer than `MIN_WEIBULL_POINTS` usable points yields a
 *  provisional result instead of a number. Measured this session on the
 *  real fleet curve: OBSERVED k=4.192, lambda=19.81, R^2=0.9866, median age
 *  18.15yr; MECHANICAL (crash removed) k=5.095, lambda=22.71, R^2=0.9759,
 *  median age 21.13yr. The R^2~=0.98 fits confirm Weibull is the right
 *  family here. The OBSERVED fleet median (18.15yr) independently matches
 *  the real-world consensus for US passenger cars (~17-18yr) — the main
 *  external validation that the leakage correction (Step 2) is sound; see
 *  the "recovers a realistic fleet median" test. A fit with R^2 below
 *  `MIN_ACCEPTABLE_R2` is flagged `provisional` rather than trusted silently.
 *
 *  Step 6 — age to miles: `medianOdometer` at the CY2025 cohort age nearest
 *  the fitted MECHANICAL median age, scaled linearly by (fittedMedianAge /
 *  nearestObservedAge). Steps 1-6 above run ONCE, fleet-wide, inside
 *  `deriveFleetContext` — never per model.
 *
 *  Step 6.5 — the PER-MODEL path: ratio-based hazard scaling, not a second
 *  absolute curve. An earlier version of this module repeated Steps 1-6 at
 *  the nameplate/make level — build a per-model survival curve, leakage-
 *  correct it, fit its own Weibull. That failed a full-corpus run three
 *  ways, and shipping it was rejected: (1) `leakageCorrect` pins any model
 *  with better-than-fleet retention to exactly `S=1.0` at young ages, and
 *  `medianAgeFromWeibull`'s `0 < S < 1` filter then DISCARDS those points —
 *  so the more durable a model is, the fewer points survive, the likelier it
 *  falls through the coverage fallback to a coarse body-class constant; (2)
 *  that bias hits hardest exactly where the measurement matters most —
 *  Toyota Corolla, the highest-retention model measured anywhere in this
 *  work, fell all the way to the fleet constant on a real full-corpus run,
 *  landing on the identical number as Fiat 500 (0 usable points); (3) 24 of
 *  69 vehicles collapsed to that constant on the same run — a coarse
 *  body-class number is precisely what this whole re-derivation exists to
 *  replace. The fix: borrow the curve SHAPE from the fleet-wide fit (already
 *  well-determined, R^2 typically 0.93-0.99) and give each model only a
 *  hazard SCALING relative to it. A retention RATIO is well-defined at every
 *  age even when absolute survival is at/near 1, so this needs no capping
 *  and no `<1` censoring:
 *    1. rho(age) = retention_model(age) / retention_fleet(age), RAW (not
 *       leakage-corrected) retention on both sides — the leakage term is
 *       model-independent by assumption and cancels exactly in the ratio.
 *       An age is dropped when the model side has fewer than
 *       `MIN_VINS_PER_AGE` distinct 2023-cohort VINs (`computeHazardRatioPoints`).
 *    2. Convert to a per-step hazard ratio, `h = -ln(S_step)`:
 *         h_model(age) = h_fleet(age) - ln(rho(age))
 *         c(age)       = h_model(age) / h_fleet(age)
 *       aggregated across surviving ages with a mean weighted by the model's
 *       2023-cohort VIN count at that age (`aggregateHazardRatio`).
 *    3. Map the aggregate hazard ratio to a lifetime scale via the fleet's
 *       fitted MECHANICAL Weibull shape `k`: scaling a Weibull hazard by `c`
 *       scales its characteristic life (and median age) by `c^(-1/k)`:
 *         medianAge_model = fleetMechanicalMedianAge x c^(-1/k)
 *       (`scaleMedianAgeByHazardRatio`). A model with below-fleet hazard
 *       (`c < 1`, e.g. Corolla) gets a LONGER life than the fleet median; a
 *       model with above-fleet hazard (`c > 1`, e.g. Chevy Malibu) gets a
 *       shorter one.
 *    4. Convert `medianAge_model` to miles by scaling the FLEET's own
 *       age-to-miles rate by the age ratio — deliberately NOT the model's
 *       own `medianOdometer` data. See Step 7 for why.
 *  `MIN_WEIBULL_POINTS` is reused as the minimum number of adequately-
 *  sampled ages required to trust the aggregate — the level falls through
 *  the Step 8 coverage hierarchy below `MIN_WEIBULL_POINTS` usable ages, or
 *  when the aggregate `c` is non-positive/non-finite, exactly as before.
 *
 *  Step 7 — ratio to fleet, then anchor to a national number, corrected back
 *  up to crash-inclusive terms (the key design decision). The ratio is
 *  AGE-based, not miles-based — an earlier version of this module converted
 *  each model's own median age to miles via that model's own NY
 *  `medianOdometer` curve, and that was wrong: it imports the NY owner
 *  population's ANNUAL MILEAGE for that nameplate (e.g. a Corolla buyer's
 *  driving habits) into what's supposed to be a national DURABILITY
 *  constant, and those are different things a model can differ on
 *  independently of how long it lasts. Concretely, that mistake dragged
 *  Toyota Corolla — the highest-retention model measured anywhere in this
 *  work — below Camry Hybrid and several less-durable models in the derived
 *  output, because Corolla owners in NY happen to drive fewer miles/year,
 *  not because Corollas wear out faster. It also double-counts a variable
 *  the cost engine already owns: `eol_maintained_miles` is an odometer
 *  value the engine reaches by applying the USER's own annual-mileage input
 *  (a separate field) to it, so baking a different implied annual mileage
 *  into each model's EOL constant fights the engine's own input. Converting
 *  every model at the FLEET's single mileage-vs-age rate removes annual
 *  mileage from the per-model comparison entirely, leaving only measured
 *  durability:
 *    ratio(model)     = medianAge_model / fleetMechanicalMedianAge   (AGE-based: every model shares the fleet's mileage-vs-age rate, so no per-model annual-mileage assumption is smuggled in)
 *    maintainedBonus  = fleetMechanicalMedianAge / fleetObservedMedianAge        (computed once, fleet-wide, from the two Weibull fits)
 *    eol(model)       = nationalAnchor(bodyClass) x maintainedBonus x ratio(model)
 *  `nationalAnchor` is NHTSA/DOT "Vehicle Survivability and Travel Mileage
 *  Schedules," DOT HS 809 952 (Jan 2006), public domain, still cited by
 *  NHTSA's current CAFE rulemakings, and is fleet-OBSERVED (crash-inclusive):
 *  passenger car 152,137mi, light truck (pickup/SUV/van) 179,954mi. See
 *  `bodyClassFor` for the seed `body` -> class mapping. What this GIVES UP,
 *  disclosed rather than compensated for: genuine CLASS-level
 *  mileage-accumulation differences (a pickup really is driven more per
 *  year than a compact) are no longer expressed in this field — every
 *  vehicle in the corpus is converted at one shared national rate. No class
 *  adjustment factor is invented to claw that back; `nationalAnchor`'s
 *  car/light-truck split is the only accumulation-rate differentiation this
 *  field carries.
 *
 *  Step 8 — coverage fallback (LOAD-BEARING). Even with ratio-based scaling,
 *  a nameplate/make can still be too thin: too few ages clear
 *  `MIN_VINS_PER_AGE`, or the too-new nameplates that have literally zero
 *  cohort history at these ages at all — e.g. Kia K4 (first_year 2025), VW
 *  ID.4 / Toyota RAV4 Prime / Toyota Sienna Hybrid (2021), Hyundai Palisade
 *  / Kia Telluride (2020), Mazda CX-90 (2024), Jeep Grand Cherokee L (2021).
 *  So each model resolves through a three-level fallback (`chooseBasis` /
 *  `deriveEolForModel`), the level ALWAYS recorded on the result (`basis`),
 *  never silent:
 *    Level 1 "nameplate" (preferred) — `EolQuery.nameplate`: the nameplate's
 *      model_name strings, queried across every model year it has actually
 *      existed (durability is substantially a nameplate/manufacturer
 *      property — "Camrys last" is the claim being measured — and a
 *      generation-strict window starves most of the corpus). Callers should
 *      NOT trust a "years sold" column at face value: several nameplate
 *      strings pre-date their most recent generation (Volvo XC60 used since
 *      ~2010, Chevy Volt since 2011, Nissan Leaf since ~2011, Volvo XC90
 *      since ~2003) and a seed row's own generation window undercounts them.
 *      Requires >= `MIN_WEIBULL_POINTS` usable ages (Step 6.5); otherwise
 *      falls through. With ratio-based scaling this level should resolve
 *      for the large majority of the corpus — it no longer needs 5 sub-1.0
 *      absolute survival points, only 5 adequately-sampled ages.
 *    Level 2 "make" — `EolQuery.make` (optional): pools the make's models
 *      instead of one nameplate. The ideal query is `make_code` alone with
 *      NO `model_name` filter, but `ny-inspections.ts`'s adapter only
 *      exposes `model_name IN (...)` queries (no wildcard/no-filter mode),
 *      and this module is constrained to that adapter — no direct API
 *      calls, no adapter edits (see its module docstring). So callers must
 *      supply a broad `modelNames` list approximating "every model this
 *      make sells" for this level; omit `make` entirely to skip straight to
 *      Level 3. Always flagged `provisional`.
 *    Level 3 "fleet" — no per-model adjustment: `ratioToFleet = 1`, so
 *      `eol = nationalAnchor x maintainedBonus`. Never invents a ratio.
 *      Always flagged `provisional`.
 *  EV caveat (not modelled around, just stated): EVs in the corpus (ID.4,
 *  Model 3, Bolt EV, Leaf) will mostly land on the "make" basis, which
 *  measures that manufacturer's GAS-car durability — an EV has no engine or
 *  transmission but does have a battery, so this is a known mismatch.
 *  Reliability re-derivation (derive.ts) solved the analogous problem for
 *  `reliability_tier` by giving EVs their own reference group; there simply
 *  isn't enough EV-specific history in NY DMV data to do that here (the
 *  oldest EVs barely reach age 8) — no invented EV adjustment factor.
 *  `EolQuery`/`EolLevelQuery` take the make/model mapping as a parameter
 *  rather than importing a corpus module, so this file stays decoupled from
 *  whatever seed-to-NY-DMV mapping data ends up backing the "later step"
 *  that runs this across all 71 vehicles. */
import { distinctVinCount, medianOdometer } from "../sources/ny-inspections.js";
import { loadSeedData } from "../seedData.js";

// ---------------------------------------------------------------------------
// Age range (Step 3)
// ---------------------------------------------------------------------------

/** Ages used for the survival chain and the Weibull fit. See module
 *  docstring "Step 3" for why 2 and 22+ are excluded. */
export const SURVIVAL_AGES = [4, 6, 8, 10, 12, 14, 16, 18, 20] as const;

/** Ages used to compute the fleet leakage ceiling `L` (Step 2): retention is
 *  monotonically falling across 4/6/8, so the max (= the least-leaked point)
 *  is the ceiling. */
export const LEAKAGE_CEILING_AGES = [4, 6, 8] as const;

// ---------------------------------------------------------------------------
// Step 2 — leakage correction
// ---------------------------------------------------------------------------

/** Fleet-wide leakage ceiling measured this session (module docstring "Step
 *  2"). `computeLeakageCeiling` asserts a freshly-computed `L` lands within
 *  `LEAKAGE_CEILING_TOLERANCE` of this — a large drift means the dataset
 *  changed shape, not that the model fleet did.
 *
 *  This is the CRASH-CONSISTENT ceiling (0.9293), not the raw max retention
 *  over ages 4-8 (0.9016) — see `computeLeakageCeiling` for why the raw max
 *  is wrong. Measured 2026-07-30: raw max retention 0.9016 at age 4, divided
 *  by one 2-year step of crash-only survival (1 - 0.015)^2 = 0.9702. */
export const EXPECTED_LEAKAGE_CEILING = 0.9293;
export const LEAKAGE_CEILING_TOLERANCE = 0.03;

/** `trueSurvival(a) = min(retention(a) / ceiling, 1)` — module docstring
 *  "Step 2". Capped at 1: leakage-corrected survival can never exceed
 *  certainty even if a model's raw retention happens to exceed the fleet
 *  ceiling in a given sample. */
export function leakageCorrect(retention: number, ceiling: number): number {
  return Math.min(retention / ceiling, 1);
}

/** `L` = (max fleet-wide retention over ages 4-8) / (one 2-year step of
 *  crash-only survival) — module docstring "Step 2".
 *
 *  **Why the raw max is wrong, and why this division is load-bearing.** The
 *  obvious definition, `L = max retention`, forces `trueSurvival = 1.0`
 *  exactly at whichever young age retained best — i.e. it asserts ZERO
 *  attrition there. That contradicts Step 4.5, which then removes a
 *  `total_loss_rate_per_yr` (0.015/yr) crash hazard that says ~6% of those
 *  cars should already be gone by age 4. The two corrections disagree, and
 *  the damage is not cosmetic: measured on the real 2026-07-30 fleet curve,
 *  the raw-max ceiling drove `S_mechanical` to a capped 1.0 for ages 4
 *  through 12, leaving only **4 usable points** — below `MIN_WEIBULL_POINTS`,
 *  so `medianAgeFromWeibull` returned null and the whole fleet context failed
 *  to resolve.
 *
 *  Dividing by `(1 - rate)^2` instead calibrates `L` so that the best young
 *  age has mechanical survival of exactly 1.0 *after* crash removal — the
 *  physically correct statement (at age 4 essentially nothing has worn out,
 *  but crashes have still happened). Same real curve, crash-consistent
 *  ceiling: **6 usable mechanical points**, and the mechanical curve crosses
 *  S=0.5 near age 19 as expected. Leakage correction and crash removal now
 *  agree instead of fighting.
 *
 *  Asserted near the measured `EXPECTED_LEAKAGE_CEILING` — fails loudly
 *  rather than silently deriving every model against a wrong baseline. */
export function computeLeakageCeiling(
  retentionAges4to8: number[],
  totalLossRatePerYr: number,
): number {
  if (retentionAges4to8.length === 0) {
    throw new Error("computeLeakageCeiling: need at least one retention value");
  }
  const crashSurvivalOneStep = Math.pow(1 - totalLossRatePerYr, 2);
  const L = Math.max(...retentionAges4to8) / crashSurvivalOneStep;
  if (Math.abs(L - EXPECTED_LEAKAGE_CEILING) > LEAKAGE_CEILING_TOLERANCE) {
    throw new Error(
      `fleet leakage ceiling L=${L.toFixed(4)} is more than ${LEAKAGE_CEILING_TOLERANCE} away from ` +
        `the ~${EXPECTED_LEAKAGE_CEILING} measured this session — the NY DMV dataset may have changed shape.`,
    );
  }
  return L;
}

// ---------------------------------------------------------------------------
// Step 4 — cumulative survival
// ---------------------------------------------------------------------------

export interface SurvivalPoint {
  age: number;
  survival: number;
}

/** Chains leakage-corrected 2-year retention into cumulative survival,
 *  S(2) = 1 (module docstring "Step 4"). `trueSurvivalByAge` need not be
 *  pre-sorted; ages must be 2 years apart from their predecessor in the
 *  sorted order (the age range this module uses always is). */
export function cumulativeSurvival(
  trueSurvivalByAge: Array<{ age: number; trueSurvival: number }>,
): SurvivalPoint[] {
  const sorted = [...trueSurvivalByAge].sort((a, b) => a.age - b.age);
  let cumulative = 1;
  return sorted.map((p) => {
    cumulative *= p.trueSurvival;
    return { age: p.age, survival: cumulative };
  });
}

// ---------------------------------------------------------------------------
// Step 4.5 — remove crash attrition
// ---------------------------------------------------------------------------

/** `S_mechanical(t) = min(S_observed(t) / (1 - totalLossRatePerYr)^t, 1)` —
 *  module docstring "Step 4.5". Inflates the observed (crash-inclusive)
 *  survival curve back up to a mechanical-only curve, since the cost engine
 *  already models crash exposure separately every year; capped at 1 for the
 *  same reason as `leakageCorrect`. `totalLossRatePerYr` should come from
 *  `opencawr_data.json`'s `constants.total_loss_rate_per_yr`, never a local
 *  literal, so it can't drift from `engine.ts`'s own constant. */
export function removeCrashAttrition(
  observed: SurvivalPoint[],
  totalLossRatePerYr: number,
): SurvivalPoint[] {
  return observed.map((p) => ({
    age: p.age,
    survival: Math.min(p.survival / Math.pow(1 - totalLossRatePerYr, p.age), 1),
  }));
}

// ---------------------------------------------------------------------------
// Step 5 — Weibull fit for right-censored curves
// ---------------------------------------------------------------------------

export interface WeibullPoint {
  age: number;
  survival: number;
}

export interface WeibullFit {
  lambda: number;
  k: number;
  r2: number;
  n: number;
}

/** OLS on the Weibull linearization `ln(-ln S) = k*ln(t) - k*ln(lambda)`,
 *  i.e. `y = k*x + b` with `b = -k*ln(lambda)` (module docstring "Step 5").
 *  Callers must pre-filter to `0 < survival < 1` — `ln(-ln S)` is undefined
 *  at the boundaries. `medianAgeFromWeibull` does that filtering plus the
 *  minimum-point / provisional-result policy; this function is the bare
 *  regression, kept separately unit-testable against known lambda/k. */
export function fitWeibull(points: WeibullPoint[]): WeibullFit {
  if (points.length < 2) {
    throw new Error(`fitWeibull: need at least 2 points, got ${points.length}`);
  }
  const xs = points.map((p) => Math.log(p.age));
  const ys = points.map((p) => Math.log(-Math.log(p.survival)));
  const n = points.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - xMean) * (ys[i]! - yMean);
    sxx += (xs[i]! - xMean) ** 2;
  }
  const k = sxy / sxx;
  const b = yMean - k * xMean;
  const lambda = Math.exp(-b / k);

  const predicted = xs.map((x) => k * x + b);
  const ssRes = ys.reduce((s, y, i) => s + (y - predicted[i]!) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { lambda, k, r2, n };
}

/** Below this many usable (0 < S < 1) points, a fleet-wide Weibull fit is too
 *  thin to trust — module docstring "Step 5". Reused at the per-model level
 *  as the minimum number of adequately-sampled ages required before the
 *  ratio-based hazard scaling (module docstring "the fix") is trusted; both
 *  are "need at least N data points to trust a statistic" thresholds, so one
 *  constant covers both. Doubles as the Level 1/2 fallback acceptance
 *  threshold. */
export const MIN_WEIBULL_POINTS = 5;

/** Below this R^2, a fit is flagged provisional rather than trusted silently
 *  (module docstring "Step 5"). Measured real fits this session: observed
 *  R^2=0.9866, mechanical R^2=0.9759 — well clear of this floor. */
export const MIN_ACCEPTABLE_R2 = 0.85;

export interface MedianAgeResult {
  medianAge: number | null;
  fit: WeibullFit | null;
  usablePoints: number;
  provisional: boolean;
}

/** Filters to usable points, requires `MIN_WEIBULL_POINTS`, fits a Weibull
 *  curve, and converts it to a median survival age via `lambda *
 *  (ln 2)^(1/k)` — the extrapolated median for right-censored curves that
 *  never cross S=0.5 within the observed age range (the Corolla case,
 *  module docstring "Step 5"). Returns `provisional: true` with a `null`
 *  median rather than a bogus number when there isn't enough data or the
 *  fit degenerates (non-finite / non-positive `k`); a low-but-valid R^2 is
 *  reported (not filtered here) and left for the caller to flag — see
 *  `MIN_ACCEPTABLE_R2` and `deriveEolForModel`. */
export function medianAgeFromWeibull(points: WeibullPoint[]): MedianAgeResult {
  const usable = points.filter((p) => p.survival > 0 && p.survival < 1);
  if (usable.length < MIN_WEIBULL_POINTS) {
    return { medianAge: null, fit: null, usablePoints: usable.length, provisional: true };
  }
  const fit = fitWeibull(usable);
  if (!Number.isFinite(fit.lambda) || !Number.isFinite(fit.k) || fit.k <= 0) {
    return { medianAge: null, fit, usablePoints: usable.length, provisional: true };
  }
  const medianAge = fit.lambda * Math.pow(Math.LN2, 1 / fit.k);
  return { medianAge, fit, usablePoints: usable.length, provisional: false };
}

// ---------------------------------------------------------------------------
// Step 7 — body class -> national anchor
// ---------------------------------------------------------------------------

export type BodyClass = "car" | "light-truck";

/** DOT HS 809 952 (Jan 2006), "Vehicle Survivability and Travel Mileage
 *  Schedules" — public domain, still cited by NHTSA's current CAFE
 *  rulemakings. Fleet-OBSERVED (crash-inclusive) — module docstring "Step 7"
 *  explains the `maintainedBonus` factor that lifts this to mechanical-only
 *  terms. */
export const NATIONAL_ANCHOR_MILES: Record<BodyClass, number> = {
  car: 152_137,
  "light-truck": 179_954,
};

/** Seed `body` values, split car-shaped vs. light-truck-shaped (module
 *  docstring "Step 7"). */
const CAR_BODIES = new Set(["Car", "EV", "PHEV", "Sport"]);
const LIGHT_TRUCK_BODIES = new Set(["SUV", "SUV AWD", "EV SUV", "PHEV SUV AWD", "Truck", "Van"]);

export function bodyClassFor(body: string): BodyClass {
  if (CAR_BODIES.has(body)) return "car";
  if (LIGHT_TRUCK_BODIES.has(body)) return "light-truck";
  throw new Error(`bodyClassFor: unrecognized seed body value "${body}"`);
}

// ---------------------------------------------------------------------------
// Step 6.5 — per-model path: ratio-based hazard scaling
//
// Replaces building an absolute per-model survival curve (leakage-correct,
// chain, remove crash attrition, fit a Weibull — the Step 1-6 recipe above)
// at the nameplate/make level. That approach failed three ways on the real
// full-corpus run (module docstring "the fix"): it needs `0 < S < 1` points,
// but `leakageCorrect` pins high-retention models to exactly `S=1.0` at
// young ages, and those points are then DISCARDED by the Weibull filter —
// biased hardest against the MOST durable models (Corolla, the highest-
// retention model measured anywhere in this work, fell all the way through
// to the "fleet" body-class constant). 24 of 69 vehicles landed on "fleet"
// this way.
//
// Instead, take the curve SHAPE from the fleet-wide fit (well-determined,
// R^2 ~ 0.93-0.99) and give each model only a hazard SCALING relative to it.
// A retention RATIO is well-defined at every age even when absolute
// survival is at/near 1, so no capping and no `<1` filtering is needed:
//   1. rho(age) = retention_model(age) / retention_fleet(age), using RAW
//      (not leakage-corrected) retention on both sides — the leakage term is
//      model-independent by assumption and cancels exactly in the ratio.
//      An age is dropped when the model side has fewer than
//      `MIN_VINS_PER_AGE` distinct 2023-cohort VINs (too thin to trust).
//   2. Convert to a per-step hazard ratio, `h = -ln(S_step)`:
//        h_model(age) = h_fleet(age) - ln(rho(age))
//        c(age)       = h_model(age) / h_fleet(age)
//      Aggregated across ages via a weighted mean, weighted by the model's
//      2023-cohort VIN count at that age (`aggregateHazardRatio`).
//   3. Map the aggregate hazard ratio to a lifetime scale using the fleet's
//      fitted MECHANICAL Weibull shape `k`: scaling the hazard by `c` scales
//      the characteristic life by `c^(-1/k)` (Weibull property), so
//        medianAge_model = fleetMechanicalMedianAge * c^(-1/k)
//      (`scaleMedianAgeByHazardRatio`).
//   4. Continue exactly as before: age -> miles via the model's own
//      odometer data at the nearest surveyed age, then ratio-to-fleet and
//      the three-factor anchor (Step 7, unchanged).
// ---------------------------------------------------------------------------

/** Minimum distinct-VIN count (the 2023-cohort denominator of the raw
 *  2-year retention) at a given age for a model's retention ratio at that
 *  age to be trusted. Below this, a single noisy VIN count can swing the
 *  ratio wildly, so the age is dropped rather than averaged in. */
export const MIN_VINS_PER_AGE = 200;

export interface AgeRetention {
  age: number;
  /** Distinct-VIN count of the 2023 cohort at this age — the retention
   *  denominator, used both to compute `retention` and as the sample-size
   *  threshold/weight for the hazard-ratio aggregation. */
  n2023: number;
  /** Raw (NOT leakage-corrected) 2-year retention: distinctVinCount(CY2025)
   *  / distinctVinCount(CY2023) for this model_year cohort. */
  retention: number;
}

export interface HazardRatioPoint {
  age: number;
  rho: number;
  /** Weight for the aggregation step: the model's 2023-cohort VIN count at
   *  this age. */
  weight: number;
}

/** `rho(age) = retention_model(age) / retention_fleet(age)` at every age
 *  where the model side clears `minVinsPerAge` and both sides have positive
 *  raw retention — the ratio-based fix's core building block (module
 *  docstring "Step 6.5"). No leakage correction, no capping, no `<1`
 *  filtering: a ratio of raw retentions is well-defined even when a model's
 *  retention is at/near 1. */
export function computeHazardRatioPoints(
  modelRetentions: AgeRetention[],
  fleetRetentionByAge: ReadonlyMap<number, number>,
  minVinsPerAge: number,
): HazardRatioPoint[] {
  const points: HazardRatioPoint[] = [];
  for (const m of modelRetentions) {
    if (m.n2023 < minVinsPerAge || m.retention <= 0) continue;
    const fleetRetention = fleetRetentionByAge.get(m.age);
    if (!fleetRetention || fleetRetention <= 0) continue;
    points.push({ age: m.age, rho: m.retention / fleetRetention, weight: m.n2023 });
  }
  return points;
}

/** Converts each age's retention ratio to a per-step hazard ratio
 *  `c(age) = h_model(age) / h_fleet(age)` (`h = -ln(retention)`), then
 *  aggregates across ages with a VIN-count-weighted mean (module docstring
 *  "Step 6.5"). Since `rho = retention_model / retention_fleet`,
 *  `ln(rho) = h_fleet - h_model`, so `h_model = h_fleet - ln(rho)`. Returns
 *  `null` when no point survives the per-age guards or the aggregate is
 *  non-positive/non-finite — a model this scaling can't be trusted for. */
export function aggregateHazardRatio(
  points: HazardRatioPoint[],
  fleetRetentionByAge: ReadonlyMap<number, number>,
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of points) {
    const fleetRetention = fleetRetentionByAge.get(p.age);
    if (!fleetRetention || fleetRetention <= 0) continue;
    const hFleet = -Math.log(fleetRetention);
    if (!Number.isFinite(hFleet) || hFleet <= 0) continue;
    const hModel = hFleet - Math.log(p.rho);
    const c = hModel / hFleet;
    if (!Number.isFinite(c) || c <= 0) continue;
    weightedSum += c * p.weight;
    totalWeight += p.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

/** Maps an aggregate hazard ratio `c` to a model median age via the fleet's
 *  fitted MECHANICAL Weibull shape `k`: under a Weibull, scaling the hazard
 *  by `c` scales the characteristic life (and therefore the median age) by
 *  `c^(-1/k)` (module docstring "Step 6.5"). Guards against a
 *  non-positive/non-finite `c` or `k`, or a resulting non-positive/non-finite
 *  median age. */
export function scaleMedianAgeByHazardRatio(
  fleetMedianAge: number,
  c: number,
  k: number,
): number | null {
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(k) || k <= 0) return null;
  const medianAge = fleetMedianAge * Math.pow(c, -1 / k);
  return Number.isFinite(medianAge) && medianAge > 0 ? medianAge : null;
}

// ---------------------------------------------------------------------------
// Step 8 — three-level coverage fallback
// ---------------------------------------------------------------------------

export type EolBasis = "nameplate" | "make" | "fleet";

/** One survival-analysis result at a given query granularity (nameplate or
 *  make) — module docstring "Step 8". `r2` is the fleet-wide MECHANICAL
 *  Weibull fit's R^2 (the shape used to scale this level's hazard ratio),
 *  not a per-level fit — the ratio-based path (Step 6.5) doesn't fit its own
 *  curve per model. No per-model miles/odometer field: age-to-miles now
 *  happens once, at the fleet level, using the fleet's own mileage-vs-age
 *  rate for every model (module docstring "Step 7"). */
export interface LevelResult {
  medianAge: number | null;
  r2: number | null;
  usablePoints: number;
}

/** A level is usable when it produced a real (non-degenerate) median age —
 *  module docstring "Step 8"'s ">= MIN_WEIBULL_POINTS usable ages with
 *  adequate per-age sample size" requirement, made concrete. */
export function isLevelUsable(level: LevelResult): boolean {
  return level.medianAge !== null;
}

/** Picks the coverage level per the Step 8 fallback hierarchy: nameplate if
 *  usable, else make if supplied and usable, else fleet. Pure and
 *  independently testable — the exact case that must never be silent for a
 *  too-new nameplate (module docstring "Step 8"). */
export function chooseBasis(nameplate: LevelResult, make: LevelResult | null): EolBasis {
  if (isLevelUsable(nameplate)) return "nameplate";
  if (make && isLevelUsable(make)) return "make";
  return "fleet";
}

// ---------------------------------------------------------------------------
// Async orchestration — ny-inspections.ts is the only thing that talks to
// the network here; seedData.ts is a local JSON read, not network.
// ---------------------------------------------------------------------------

/** One NY DMV query granularity: a make plus the `model_name` strings to
 *  pool together (module docstring "Step 8"). */
export interface EolLevelQuery {
  /** NY DMV `make_code`. */
  makeCode: string;
  /** `model_name` values to pool. For `EolQuery.nameplate` this should span
   *  every model year the nameplate has actually existed, not just the seed
   *  row's own generation window. For `EolQuery.make` this should
   *  approximate "every model this make sells" (see module docstring "Step
   *  8, Level 2" for why that's a caller responsibility, not something this
   *  module can query directly). */
  modelNames: string[];
}

export interface EolQuery {
  name: string;
  /** Seed `body` field. */
  body: string;
  /** Level 1 (preferred). */
  nameplate: EolLevelQuery;
  /** Level 2 fallback. Omit to skip straight to the Level 3 fleet default
   *  when Level 1 is unusable. */
  make?: EolLevelQuery;
}

/** Fleet-wide parameters shared across every model's derivation: the
 *  leakage ceiling, the crash-removal rate, the derived maintained bonus,
 *  and the mechanical-miles anchor for Step 7's ratio. Computed once (see
 *  `deriveFleetContext`) and passed into every `deriveEolForModel` call —
 *  same batch-then-per-model shape as `deriveReliability`'s percentile
 *  cuts in derive.ts. */
export interface FleetContext {
  leakageCeiling: number;
  /** From `opencawr_data.json`'s `constants.total_loss_rate_per_yr`. */
  totalLossRatePerYr: number;
  fleetObservedMedianAge: number;
  fleetObservedR2: number;
  fleetMechanicalMedianAge: number;
  fleetMechanicalR2: number;
  /** Shape parameter `k` of the fleet-wide MECHANICAL Weibull fit — the
   *  curve SHAPE every per-model hazard-ratio scaling borrows (module
   *  docstring "Step 6.5"). */
  fleetMechanicalK: number;
  /** `fleetMechanicalMedianAge / fleetObservedMedianAge` — module docstring
   *  "Step 7". Derives the legacy 1.30 "maintained" judgment instead of
   *  inheriting it (measured this session: 1.165). */
  maintainedBonus: number;
  fleetMechanicalMedianLifetimeMiles: number;
  /** Fleet-wide RAW (not leakage-corrected) 2-year retention at each
   *  `SURVIVAL_AGES` age, keyed by age — the denominator side of `rho(age)`
   *  in the per-model hazard-ratio scaling (module docstring "Step 6.5"). */
  rawRetentionByAge: ReadonlyMap<number, number>;
  /** True when either fleet-level Weibull fit is below `MIN_ACCEPTABLE_R2` —
   *  surfaced rather than silently trusted (module docstring "Step 5"). */
  fleetProvisional: boolean;
  fleetQueryCount: number;
}

export interface EolDerivation {
  name: string;
  body: string;
  bodyClass: BodyClass;
  /** Which coverage level produced this result — module docstring "Step 8".
   *  Always populated, never silent. */
  basis: EolBasis;
  /** Median survival age in years, from scaling the fleet's mechanical
   *  Weibull median by this model's hazard ratio (module docstring "Step
   *  6.5"); `null` for the `"fleet"` basis (no per-model ratio was usable). */
  medianAge: number | null;
  /** R^2 of the fleet-wide mechanical Weibull fit whose shape underlies
   *  `medianAge` (module docstring "Step 6.5") — `null` for the `"fleet"`
   *  basis, where no per-model ratio was usable. */
  r2: number | null;
  /** `medianAge / fleetContext.fleetMechanicalMedianAge` — AGE-based, not
   *  miles-based (module docstring "Step 7"). 1 exactly for the `"fleet"`
   *  basis. */
  ratioToFleet: number | null;
  eolMiles: number | null;
  /** True whenever `basis !== "nameplate"`, or the winning fit's R^2 is
   *  below `MIN_ACCEPTABLE_R2`. */
  provisional: boolean;
  evidence: {
    usableSurvivalPoints: number;
  };
}

async function retentionAtAge(
  makeCode: string,
  modelNames: string[],
  age: number,
): Promise<{ n2023: number; n2025: number; retention: number }> {
  const modelYear = 2023 - age;
  const [n2023, n2025] = await Promise.all([
    distinctVinCount(makeCode, modelNames, modelYear, 2023),
    distinctVinCount(makeCode, modelNames, modelYear, 2025),
  ]);
  return { n2023, n2025, retention: n2023 > 0 ? n2025 / n2023 : 0 };
}

/** Median odometer for the cohort that is `age` years old in calendar year
 *  2025 (module docstring "Step 6") — a different model_year mapping than
 *  `retentionAtAge`, since here we want the CY2025 snapshot directly rather
 *  than a two-snapshot comparison. */
async function odometerAtAge(makeCode: string, modelNames: string[], age: number): Promise<number> {
  return medianOdometer(makeCode, modelNames, 2025 - age, 2025);
}

function nearestAgeIndex(ages: readonly number[], target: number): number {
  let bestIdx = 0;
  let bestDiff = Infinity;
  ages.forEach((a, i) => {
    const diff = Math.abs(a - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  return bestIdx;
}

/** Runs Step 1 plus the Step 6.5 ratio-based hazard scaling for one query
 *  granularity (nameplate or make level) against an already-computed
 *  `fleetContext`. No per-model Weibull fit and no per-model
 *  `medianOdometer` call: the curve shape is borrowed from
 *  `fleetContext.fleetMechanicalK`, and age-to-miles happens once at the
 *  fleet level (module docstring "Step 7") — this only needs enough
 *  adequately-sampled ages to trust the aggregate hazard ratio. */
async function deriveLevelMedian(
  level: EolLevelQuery,
  fleetContext: FleetContext,
): Promise<LevelResult> {
  const modelRetentions: AgeRetention[] = await Promise.all(
    SURVIVAL_AGES.map(async (age) => {
      const { n2023, retention } = await retentionAtAge(level.makeCode, level.modelNames, age);
      return { age, n2023, retention };
    }),
  );
  const ratioPoints = computeHazardRatioPoints(
    modelRetentions,
    fleetContext.rawRetentionByAge,
    MIN_VINS_PER_AGE,
  );
  const c =
    ratioPoints.length >= MIN_WEIBULL_POINTS
      ? aggregateHazardRatio(ratioPoints, fleetContext.rawRetentionByAge)
      : null;
  const medianAge =
    c === null
      ? null
      : scaleMedianAgeByHazardRatio(fleetContext.fleetMechanicalMedianAge, c, fleetContext.fleetMechanicalK);

  return {
    medianAge,
    r2: medianAge === null ? null : fleetContext.fleetMechanicalR2,
    usablePoints: ratioPoints.length,
  };
}

async function pooledRetentionAtAge(queries: EolQuery[], age: number): Promise<number> {
  const results = await Promise.all(
    queries.map((q) => retentionAtAge(q.nameplate.makeCode, q.nameplate.modelNames, age)),
  );
  let n2023 = 0;
  let n2025 = 0;
  for (const r of results) {
    n2023 += r.n2023;
    n2025 += r.n2025;
  }
  return n2023 > 0 ? n2025 / n2023 : 0;
}

/** Fleet odometer at `age`, weighted by each model's CY2025 distinct-VIN
 *  count — the closest available approximation to a true pooled median
 *  given that `ny-inspections.ts` only exposes per-model medians, not raw
 *  rows (module docstring "Step 7" needs a fleet-wide `medianOdometer`
 *  analogue to normalize against). */
async function pooledOdometerAtAge(queries: EolQuery[], age: number): Promise<number> {
  const [odometers, counts] = await Promise.all([
    Promise.all(queries.map((q) => odometerAtAge(q.nameplate.makeCode, q.nameplate.modelNames, age))),
    Promise.all(
      queries.map((q) => distinctVinCount(q.nameplate.makeCode, q.nameplate.modelNames, 2025 - age, 2025)),
    ),
  ]);
  let weightedSum = 0;
  let totalWeight = 0;
  odometers.forEach((med, i) => {
    const w = counts[i]!;
    if (med > 0 && w > 0) {
      weightedSum += med * w;
      totalWeight += w;
    }
  });
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/** Computes the shared `FleetContext` (leakage ceiling, crash-removal rate,
 *  derived maintained bonus, mechanical-miles anchor) from a batch of
 *  models, pooling their raw NY DMV counts into fleet-wide aggregates at
 *  each age using each query's `nameplate` level. `queries` should be the
 *  whole model set being derived (mirrors `deriveReliability`'s percentile
 *  cuts, also computed once per batch) — NOT invoked against all 71 seed
 *  vehicles by this module; that's a later step's job. */
export async function deriveFleetContext(queries: EolQuery[]): Promise<FleetContext> {
  if (queries.length === 0) {
    throw new Error("deriveFleetContext: need at least one query");
  }

  const { constants } = loadSeedData();
  const totalLossRatePerYr = constants.total_loss_rate_per_yr;

  const ceilingRetentions = await Promise.all(
    LEAKAGE_CEILING_AGES.map((age) => pooledRetentionAtAge(queries, age)),
  );
  const leakageCeiling = computeLeakageCeiling(ceilingRetentions, totalLossRatePerYr);

  const survivalRetentions = await Promise.all(
    SURVIVAL_AGES.map((age) => pooledRetentionAtAge(queries, age)),
  );
  const trueSurvivalByAge = SURVIVAL_AGES.map((age, i) => ({
    age,
    trueSurvival: leakageCorrect(survivalRetentions[i]!, leakageCeiling),
  }));
  const observedCurve = cumulativeSurvival(trueSurvivalByAge);
  const observedFit = medianAgeFromWeibull(observedCurve);
  if (observedFit.medianAge === null) {
    throw new Error(
      "deriveFleetContext: fleet-wide OBSERVED survival curve did not yield a usable Weibull fit",
    );
  }

  const mechanicalCurve = removeCrashAttrition(observedCurve, totalLossRatePerYr);
  const mechanicalFit = medianAgeFromWeibull(mechanicalCurve);
  if (mechanicalFit.medianAge === null) {
    throw new Error(
      "deriveFleetContext: fleet-wide MECHANICAL survival curve did not yield a usable Weibull fit",
    );
  }

  const maintainedBonus = mechanicalFit.medianAge / observedFit.medianAge;

  const odometers = await Promise.all(SURVIVAL_AGES.map((age) => pooledOdometerAtAge(queries, age)));
  const nearestIdx = nearestAgeIndex(SURVIVAL_AGES, mechanicalFit.medianAge);
  const nearestAge = SURVIVAL_AGES[nearestIdx]!;
  const fleetMechanicalMedianLifetimeMiles =
    odometers[nearestIdx]! * (mechanicalFit.medianAge / nearestAge);

  const rawRetentionByAge = new Map<number, number>(
    SURVIVAL_AGES.map((age, i) => [age, survivalRetentions[i]!]),
  );

  return {
    leakageCeiling,
    totalLossRatePerYr,
    fleetObservedMedianAge: observedFit.medianAge,
    fleetObservedR2: observedFit.fit!.r2,
    fleetMechanicalMedianAge: mechanicalFit.medianAge,
    fleetMechanicalR2: mechanicalFit.fit!.r2,
    fleetMechanicalK: mechanicalFit.fit!.k,
    maintainedBonus,
    fleetMechanicalMedianLifetimeMiles,
    rawRetentionByAge,
    fleetProvisional:
      observedFit.fit!.r2 < MIN_ACCEPTABLE_R2 || mechanicalFit.fit!.r2 < MIN_ACCEPTABLE_R2,
    fleetQueryCount: queries.length,
  };
}

/** Derives an end-of-life mileage estimate for one model against an
 *  already-computed `fleetContext` (module docstring, all steps), walking
 *  the Step 8 coverage fallback (nameplate -> make -> fleet). Pure
 *  orchestration over `ny-inspections.ts`'s `distinctVinCount` /
 *  `medianOdometer` — no other network access. */
export async function deriveEolForModel(
  query: EolQuery,
  fleetContext: FleetContext,
): Promise<EolDerivation> {
  const bodyClass = bodyClassFor(query.body);

  const nameplate = await deriveLevelMedian(query.nameplate, fleetContext);
  const make = query.make ? await deriveLevelMedian(query.make, fleetContext) : null;
  const basis = chooseBasis(nameplate, make);
  const level = basis === "nameplate" ? nameplate : basis === "make" ? make! : (make ?? nameplate);

  if (basis === "fleet") {
    return {
      name: query.name,
      body: query.body,
      bodyClass,
      basis,
      medianAge: null,
      r2: level.r2,
      ratioToFleet: 1,
      eolMiles: NATIONAL_ANCHOR_MILES[bodyClass] * fleetContext.maintainedBonus,
      provisional: true,
      evidence: { usableSurvivalPoints: level.usablePoints },
    };
  }

  // AGE-based ratio, not miles-based — module docstring "Step 7". Every
  // model is converted to miles at the FLEET's own mileage-vs-age rate, so
  // no per-model annual-mileage assumption (owner demographics) leaks into
  // a field meant to measure durability.
  const ratioToFleet = level.medianAge! / fleetContext.fleetMechanicalMedianAge;
  const eolMiles = NATIONAL_ANCHOR_MILES[bodyClass] * fleetContext.maintainedBonus * ratioToFleet;
  const lowR2 = level.r2 !== null && level.r2 < MIN_ACCEPTABLE_R2;

  return {
    name: query.name,
    body: query.body,
    bodyClass,
    basis,
    medianAge: level.medianAge,
    r2: level.r2,
    ratioToFleet,
    eolMiles,
    provisional: basis !== "nameplate" || lowR2,
    evidence: { usableSurvivalPoints: level.usablePoints },
  };
}
