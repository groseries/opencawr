/** End-of-life mileage re-derivation from NY State DMV inspection data.
 *  Replaces the seed data's Consumer-Reports-derived `eol_maintained_miles`
 *  judgment call (ASSUMPTIONS.md §B: "iSeeCars empirical x 1.30 'maintained'
 *  bonus (baked in)") with a survival-analysis estimate, using the same
 *  free/keyless data layer as reliability re-derivation (`sources/ny-inspections.ts`
 *  — read its docstring first for the API traps this module relies on).
 *
 *  THE SHAPE OF THE METHOD: Steps 1-6 below build ONE absolute survival
 *  curve — the WHOLE NY DMV fleet, no make filter and no model filter — and
 *  fit a Weibull to it (`deriveFleetContext`, computed once). It is
 *  deliberately NOT pooled from just the batch's own nameplates: the
 *  national anchor this curve gets multiplied against in Step 7
 *  (`NATIONAL_ANCHOR_MILES`, NHTSA DOT HS 809 952) describes the entire US
 *  light-vehicle fleet, and pooling ~70 mainstream seed nameplates instead
 *  measures a different, mainstream-skewed population — see
 *  `wholeFleetRetentionAtAge` for the measured damage that mismatch does.
 *  The per-model path does NOT repeat that recipe per nameplate/make; see
 *  "Step 6.5" below for why, and for what it does instead.
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
 *  Step 6.5 — the PER-MODEL path: leak-separating hazard regression. Two
 *  earlier versions of this step were built, measured, and rejected; the
 *  reasons are worth keeping because each rules out an approach that looks
 *  obviously right.
 *
 *  REJECTED v1 — a second absolute survival curve per nameplate (repeat
 *  Steps 1-6 at model level). `leakageCorrect` pins any model with
 *  better-than-fleet retention to exactly `S=1.0` at young ages, and
 *  `medianAgeFromWeibull`'s `0 < S < 1` filter then DISCARDS those points, so
 *  the more durable a model is the fewer points survive. Toyota Corolla, the
 *  highest-retention model measured anywhere in this work, fell all the way
 *  to the coarse body-class constant, landing on the identical number as
 *  Fiat 500; 24 of 69 vehicles collapsed onto that constant.
 *
 *  REJECTED v2 — a per-age RETENTION RATIO against the fleet,
 *  `rho(age) = retention_model(age) / retention_fleet(age)`, converted to a
 *  hazard ratio `c(age) = h_model(age) / h_fleet(age)` and averaged over
 *  ages. Its premise, stated explicitly at the time, was that "the leakage
 *  term is model-independent by assumption and cancels exactly in the
 *  ratio." **That premise is false, and measuring it is what fixed this
 *  step.** Fitting each model its own leak (below) gives a leak hazard
 *  ranging from 0.006 (Honda Odyssey) to 0.172 (Chevy Suburban, Toyota Camry
 *  Hybrid) against a fleet leak of 0.0733 — a ~27x spread on the term
 *  assumed to cancel. It is not noise: it clusters by make, segment and
 *  sibling model (Camry 2.02x fleet / Camry Hybrid 2.33x; Sienna 0.11x /
 *  Odyssey 0.09x; Outback 0.17x / Forester 0.33x; Corolla 0.96x / Civic
 *  1.08x / CR-V 0.97x / RAV4 0.89x). And the contamination is AMPLIFIED at
 *  young ages, because that is where scrappage is smallest: the fleet leak
 *  is **70.8% of total measured hazard at age 4** and only **27.0% at age
 *  20**, so `c(age)` at a young age is mostly a ratio of two leakages. That
 *  is why v2 put Fiat 500 — which has cohorts only at ages 7-11 — at rank 2
 *  of the whole corpus, and pushed Camry and Suburban down for leaking, not
 *  for wearing out.
 *
 *  THE SHIPPED ESTIMATOR. Do not assume the leak cancels; fit it. Decompose
 *  each 2-year exit hazard `h(age) = -ln(retention(age))` into an
 *  age-independent LEAK term (left NY, or fell out of inspection compliance)
 *  plus an age-varying EXIT term (scrappage + crash):
 *      h_fleet(age) = leakFleet + m_fleet(age),   leakFleet = -ln(L)
 *      h_model(age) = leakModel + c * m_fleet(age)
 *  `m_fleet(age)` is exactly the leakage-corrected fleet hazard Step 2
 *  already computes (`leakageCorrect` divides retention by `L`, which is
 *  subtracting `-ln(L)` in hazard terms), so the two steps share one
 *  decomposition rather than two. A VIN-count-weighted OLS of `h_model` on
 *  `m_fleet` (`fitLeakSeparatedHazard`) returns:
 *    - slope `c` — the durability scalar, this step's whole output;
 *    - intercept `leakModel` — that model's own leak, reported but not used
 *      downstream, since it is a fact about the NY used-car market rather
 *      than about the car.
 *  An age is dropped when the model has fewer than `MIN_VINS_PER_AGE`
 *  distinct 2023-cohort VINs. The fit must clear `MIN_WEIBULL_POINTS` ages,
 *  produce a positive slope, and have a slope standard error no worse than
 *  `MAX_RELATIVE_SLOPE_SE` of the slope itself — otherwise the level is
 *  unusable and Step 8's coverage fallback takes over. That last guard is
 *  what refuses to derive a durability number for a nameplate that has never
 *  been old: Fiat 500 fits at c = 1.12 +/- 0.74, a 66% relative error, and is
 *  correctly rejected rather than reported.
 *
 *  Estimator stability was measured rather than asserted. Across three
 *  leak-aware variants — this regression on all ages, the same regression on
 *  ages >= 8, and the same regression with the intercept clamped at >= 0 —
 *  the per-model ordering agrees at Spearman **rho = 0.956 to 0.995**. The
 *  rejected v2 ratio estimator sits outside that cluster at **rho = 0.484**
 *  against it.
 *
 *  The slope is then mapped to a lifetime scale via the fleet's fitted
 *  MECHANICAL Weibull shape `k`: scaling a Weibull hazard by `c` scales its
 *  characteristic life (and median age) by `c^(-1/k)`, so
 *    medianAge_model = fleetMechanicalMedianAge x c^(-1/k)
 *  (`scaleMedianAgeByHazardRatio`). A model with below-fleet hazard
 *  (`c < 1`, e.g. Toyota Highlander at 0.424) gets a LONGER life than the
 *  fleet median; above-fleet (`c > 1`, e.g. Chevy Equinox at 3.292) a
 *  shorter one.
 *
 *  Step 7 — age to miles, then anchor to a national number, corrected back
 *  up to crash-inclusive terms. This step is denominated in MILES while
 *  everything above it is denominated in YEARS, and how the conversion is
 *  done is a genuine judgment the data cannot settle. Both options were
 *  implemented and their full-corpus blast radius measured before one was
 *  chosen (owner decision 2026-07-31; numbers in
 *  docs/investigations/2026-07-31-eol-leak-correction.md).
 *
 *  REJECTED — convert every model at the FLEET's single mileage-vs-age rate.
 *  The argument for it: `eol_maintained_miles` is an odometer value the
 *  engine reaches by applying the USER's own annual-mileage input to it, so
 *  baking a per-nameplate implied annual mileage into the constant fights
 *  the engine's own input, and a model's NY owner demographics (who buys a
 *  Mini Cooper) are not a durability fact. That argument is real and is why
 *  this was the shipped choice until 2026-07-31. It was rejected on
 *  measurement: it leaves every unmeasurable nameplate asserted to be
 *  exactly average, while cutting 20-27% off the measured durable ones, and
 *  the ranking that falls out puts **Fiat 500 at rank 2 and Fiat 500X at
 *  rank 5** of the corpus — a car ASSUMPTIONS.md §D flags `bad` for every
 *  model year, promoted purely because nothing about it can be measured.
 *
 *  SHIPPED — convert each model at its OWN measured mileage-accumulation
 *  rate. `eol_maintained_miles` is an odometer reading; the only way to
 *  observe one is to observe odometers. Measuring a model's retirement AGE
 *  and converting it at a rate borrowed from other cars is a substitution,
 *  not a measurement, and the substitution is large: measured across this
 *  corpus, accumulation spans **2.1x** (Fiat 500 6,243 mi/yr, Chevy Suburban
 *  12,627 mi/yr, fleet 9,420 mi/yr). Two corrections make the rate usable:
 *    - it is measured on `registration_class='PASSENGER'` only
 *      (`PRIVATE_REGISTRATION_CLASS`), because NYC taxi and livery mileage
 *      otherwise inflates exactly the models most exposed to it — Camry
 *      Hybrid measures 15,685 mi/yr blended against 11,912 mi/yr private;
 *    - it is expressed as a RATIO to the fleet's rate over the SAME ages the
 *      model has data at (`computeRateRatio`), never as an absolute rate.
 *      Cars accumulate miles faster when young, so a nameplate with only
 *      young cohorts would otherwise be over-rated; taking the ratio
 *      age-for-age cancels the fleet's own accumulation profile. It also
 *      cancels NY's mileage deflation against the national anchor, the same
 *      way the age ratio does.
 *  The rate ratio is then divided by its BODY CLASS's mean rate ratio
 *  (`classMeanRateRatio`), because `nationalAnchor` already carries a
 *  car/light-truck split that itself partly reflects trucks being driven
 *  more — without this, class-level mileage would be counted twice. That
 *  normalisation is a JUDGMENT, not a sourced quantity.
 *
 *    ageRatio(model)  = medianAge_model / fleetMechanicalMedianAge
 *    rateRatio(model) = model private mi/yr / fleet private mi/yr, age-for-age
 *    relRate(model)   = rateRatio(model) / classMeanRateRatio(bodyClass)
 *    maintainedBonus  = fleetMechanicalMedianAge / fleetObservedMedianAge        (computed once, fleet-wide, from the two Weibull fits)
 *    eol(model)       = nationalAnchor(bodyClass) x maintainedBonus x ageRatio x relRate
 *
 *  `nationalAnchor` is NHTSA/DOT "Vehicle Survivability and Travel Mileage
 *  Schedules," DOT HS 809 952 (Jan 2006), public domain, still cited by
 *  NHTSA's current CAFE rulemakings, and is fleet-OBSERVED (crash-inclusive):
 *  passenger car 152,137mi, light truck (pickup/SUV/van) 179,954mi. See
 *  `bodyClassFor` for the seed `body` -> class mapping.
 *
 *  WHAT THIS COSTS, disclosed rather than compensated for: the field now
 *  mixes durability with how hard a model's NY owners drive it. Where those
 *  differ for reasons unrelated to the car — a Mini Cooper as a second car
 *  at 0.755 relative rate — the derived EOL is low for a demographic reason
 *  wearing a durability label. The `PASSENGER` filter removes livery but not
 *  rideshare, which registers as private: Camry Hybrid still carries a 1.331
 *  relative rate and is the corpus's most exposed row.
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
import {
  PRIVATE_REGISTRATION_CLASS,
  distinctVinCount,
  medianOdometer,
} from "../sources/ny-inspections.js";
import { loadSeedData } from "../seedData.js";

// ---------------------------------------------------------------------------
// Age range (Step 3)
// ---------------------------------------------------------------------------

/** Ages used for the survival chain and the Weibull fit. See module
 *  docstring "Step 3" for why 2 and 22+ are excluded.
 *
 *  EVERY age in 4..20, not every OTHER age. The earlier even-only list was a
 *  self-inflicted coverage limit, not a property of the data: with a 2023
 *  base year, age `a` maps to model_year `2023 - a`, so even-only ages
 *  sampled only MY2003/2005/.../2019 and threw away half the available
 *  cohorts. That fell hardest on recent nameplates, which have model years
 *  but no old ones — a Tesla Model 3 (MY2018+) got at most ONE usable
 *  cohort (age 4 = MY2019) and was then pushed down the coverage fallback
 *  to a coarser basis, which read as "not enough data" when the raw counts
 *  were in fact thousands of VINs per model year. Measured live: Model 3
 *  MY2018-2023 carry 1,900-8,000 distinct VINs each, Telluride MY2020-2024
 *  2,500-6,200, Palisade MY2020-2024 2,000-5,200, Grand Cherokee L
 *  MY2021-2024 3,600-8,500. Sampling every age nearly doubles the points
 *  available to every fit and gives recent nameplates a real chance to
 *  resolve at nameplate level. Consecutive ages are independent
 *  measurements — age 4 and age 5 are different model-year cohorts, not the
 *  same cars counted twice. */
export const SURVIVAL_AGES = [4, 6, 8, 10, 12, 14, 16, 18, 20] as const;

/** Ages used for the PER-MODEL hazard ratio (Step 6.5) — every age in 4..20,
 *  not every other one.
 *
 *  These two lists differ on purpose, and conflating them is a real bug that
 *  was caught by measurement. `SURVIVAL_AGES` feeds `cumulativeSurvival`,
 *  which CHAINS one 2-year retention per step and therefore requires the
 *  steps to cover DISJOINT intervals — ages must be 2 apart. Sampling every
 *  age there makes consecutive steps overlap (age 4's retention covers 4->6,
 *  age 5's covers 5->7) so attrition is counted roughly twice: measured
 *  live, the fleet observed median age collapsed from 16.90yr to 13.20yr,
 *  out of the real-world consensus band, exactly the ~2^(-1/k) factor a
 *  doubled cumulative hazard predicts under a Weibull.
 *
 *  The per-model path has no such constraint: `rho(age)` is an independent
 *  ratio computed at each age and aggregated, never chained, so overlapping
 *  windows are harmless there. Using every age nearly doubles the points
 *  behind each model's hazard ratio and, critically, lets RECENT nameplates
 *  resolve at all — with a 2023 base year, age maps to model_year 2023-age,
 *  so even-only sampling gave a Tesla Model 3 (MY2018+) at most ONE usable
 *  cohort and pushed it down the coverage fallback, which read as "not
 *  enough data" when the raw counts were thousands of VINs per model year
 *  (Model 3 MY2018-2023: 1,900-8,000 each; Telluride MY2020-2024:
 *  2,500-6,200; Palisade: 2,000-5,200; Grand Cherokee L: 3,600-8,500).
 *  Consecutive ages are different model-year cohorts, not the same cars
 *  counted twice. */
export const RATIO_AGES = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;

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
// Step 6.5 — per-model path: leak-separating hazard regression
//
// See the module docstring for the two rejected predecessors and for the
// measured evidence that the per-model LEAK does not cancel. In short:
//   h_model(age) = leakModel + c * m_fleet(age)
// fit by VIN-count-weighted OLS. The slope `c` is the durability scalar; the
// intercept is that model's own leak, which is a fact about the NY used-car
// market rather than about the car and is reported but never used
// downstream. An age is dropped below `MIN_VINS_PER_AGE` 2023-cohort VINs.
// ---------------------------------------------------------------------------

/** Minimum distinct-VIN count (the 2023-cohort denominator of the raw
 *  2-year retention) at a given age for that age to enter a model's hazard
 *  regression. Below this, a single noisy VIN count can swing the point
 *  wildly, so the age is dropped rather than fitted. */
export const MIN_VINS_PER_AGE = 200;

/** A fitted slope is only trusted when its standard error is no worse than
 *  this fraction of the slope itself. This is the guard that refuses to
 *  invent a durability number for a nameplate that has never been old: with
 *  only young cohorts, `m_fleet` barely varies, so the slope is
 *  unidentified and its standard error explodes. Measured on the real
 *  corpus: Toyota Corolla fits at c = 0.725 +/- 0.080 (11%), Fiat 500 at
 *  c = 1.123 +/- 0.740 (66%) and is rejected; Toyota Camry Hybrid at
 *  c = 0.525 +/- 0.489 (93%) and is rejected. */
export const MAX_RELATIVE_SLOPE_SE = 0.35;

export interface AgeRetention {
  age: number;
  /** Distinct-VIN count of the 2023 cohort at this age — the retention
   *  denominator, used both to compute `retention` and as the sample-size
   *  threshold/weight for the hazard regression. */
  n2023: number;
  /** Raw (NOT leakage-corrected) 2-year retention: distinctVinCount(CY2025)
   *  / distinctVinCount(CY2023) for this model_year cohort. */
  retention: number;
}

export interface HazardFit {
  /** Slope: the model's exit hazard relative to the fleet's. The output. */
  c: number;
  /** Intercept: the model's own age-independent leak hazard. Reported for
   *  diagnostics; deliberately not used downstream. */
  leak: number;
  /** Standard error of `c`, against `MAX_RELATIVE_SLOPE_SE`. */
  seC: number;
  r2: number;
  /** Number of ages that cleared `MIN_VINS_PER_AGE`. */
  n: number;
}

/** Fleet EXIT hazard by age: `m_fleet(age) = -ln(retention_fleet(age)) -
 *  -ln(L)`, i.e. total measured hazard less the fleet's own leak. This is
 *  the same decomposition Step 2's `leakageCorrect` performs — dividing
 *  retention by `L` is subtracting `-ln(L)` in hazard terms — expressed as a
 *  hazard so it can be a regressor. Ages whose leakage-corrected retention
 *  would be at or above 1 (no measurable exit at all) carry no information
 *  about a slope and are omitted. */
export function fleetExitHazardByAge(
  fleetRetentionByAge: ReadonlyMap<number, number>,
  leakageCeiling: number,
): Map<number, number> {
  const leakFleet = -Math.log(leakageCeiling);
  const out = new Map<number, number>();
  for (const [age, retention] of fleetRetentionByAge) {
    if (!(retention > 0)) continue;
    const m = -Math.log(retention) - leakFleet;
    if (Number.isFinite(m) && m > 0) out.set(age, m);
  }
  return out;
}

/** VIN-count-weighted OLS of the model's total exit hazard on the fleet's
 *  EXIT hazard (module docstring "THE SHIPPED ESTIMATOR"). Returns `null`
 *  when fewer than `MIN_WEIBULL_POINTS` ages survive the guards, or when the
 *  fit degenerates — the caller then falls through Step 8's coverage
 *  hierarchy rather than reporting a number nothing supports. */
export function fitLeakSeparatedHazard(
  modelRetentions: AgeRetention[],
  fleetExitHazard: ReadonlyMap<number, number>,
  minVinsPerAge: number,
): HazardFit | null {
  const pts: Array<{ x: number; y: number; w: number }> = [];
  for (const m of modelRetentions) {
    if (m.n2023 < minVinsPerAge || m.retention <= 0) continue;
    const x = fleetExitHazard.get(m.age);
    if (x === undefined) continue;
    const y = -Math.log(m.retention);
    if (!Number.isFinite(y)) continue;
    pts.push({ x, y, w: m.n2023 });
  }
  if (pts.length < MIN_WEIBULL_POINTS) return null;

  const totalW = pts.reduce((s, p) => s + p.w, 0);
  const xMean = pts.reduce((s, p) => s + p.w * p.x, 0) / totalW;
  const yMean = pts.reduce((s, p) => s + p.w * p.y, 0) / totalW;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += p.w * (p.x - xMean) * (p.y - yMean);
    sxx += p.w * (p.x - xMean) ** 2;
  }
  if (!(sxx > 0)) return null;
  const c = sxy / sxx;
  const leak = yMean - c * xMean;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    ssRes += p.w * (p.y - (leak + c * p.x)) ** 2;
    ssTot += p.w * (p.y - yMean) ** 2;
  }
  const seC = Math.sqrt(ssRes / (pts.length - 2) / sxx);
  if (!Number.isFinite(c) || !Number.isFinite(seC)) return null;
  return { c, leak, seC, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n: pts.length };
}

/** A hazard fit is trusted only with a positive slope whose standard error
 *  is within `MAX_RELATIVE_SLOPE_SE` of the slope (see that constant). */
export function isHazardFitUsable(fit: HazardFit | null): fit is HazardFit {
  return fit !== null && fit.c > 0 && fit.seC / fit.c <= MAX_RELATIVE_SLOPE_SE;
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
// Step 7 — mileage-accumulation rate, relative to the fleet
// ---------------------------------------------------------------------------

/** Ages at which each model's private-registration median odometer is
 *  sampled to measure how fast it accumulates miles (module docstring "Step
 *  7"). Stops at 16: past that the per-nameplate slices thin out and the
 *  surviving cars are an enthusiast tail. */
export const ODOMETER_RATE_AGES = [6, 8, 10, 12, 14, 16] as const;

/** A rate ratio needs at least this many ages with real odometer data on
 *  both sides. Two is enough because the ratio is taken age-for-age against
 *  the fleet, so it does not have to also identify an accumulation curve —
 *  it is a ratio of two sums, not a fitted slope. */
export const MIN_ODOMETER_RATE_AGES = 2;

export interface RateRatio {
  /** Model private mi/yr divided by fleet private mi/yr, age-for-age. */
  ratio: number;
  /** Ages that contributed — fewer means a thinner measurement. */
  ages: number[];
}

/** `sum(age * odo_model) / sum(age * odo_fleet)` over the ages where BOTH
 *  sides have a real median (module docstring "Step 7"). Taking the ratio
 *  age-for-age rather than fitting each side's own rate is what cancels the
 *  fleet's accumulation profile — cars accumulate faster when young, so a
 *  nameplate observed only at young ages would otherwise look
 *  higher-mileage than it is. Returns `null` below
 *  `MIN_ODOMETER_RATE_AGES` shared ages. */
export function computeRateRatio(
  modelOdometerByAge: ReadonlyMap<number, number>,
  fleetOdometerByAge: ReadonlyMap<number, number>,
): RateRatio | null {
  let num = 0;
  let den = 0;
  const ages: number[] = [];
  for (const age of ODOMETER_RATE_AGES) {
    const model = modelOdometerByAge.get(age);
    const fleet = fleetOdometerByAge.get(age);
    if (!model || model <= 0 || !fleet || fleet <= 0) continue;
    num += age * model;
    den += age * fleet;
    ages.push(age);
  }
  if (ages.length < MIN_ODOMETER_RATE_AGES || !(den > 0)) return null;
  const ratio = num / den;
  return Number.isFinite(ratio) && ratio > 0 ? { ratio, ages } : null;
}

// ---------------------------------------------------------------------------
// Step 8 — three-level coverage fallback
// ---------------------------------------------------------------------------

export type EolBasis = "nameplate" | "make" | "fleet";

/** One survival-analysis result at a given query granularity (nameplate or
 *  make) — module docstring "Step 8". `r2` is this level's own hazard
 *  regression R^2 (Step 6.5), not the fleet Weibull's: the regression is
 *  fitted per model, so its goodness of fit is a per-model diagnostic and
 *  the flat models (Toyota Camry at 0.359, dragged down by a MY2015-2017
 *  taxi cohort) are visible rather than hidden behind a fleet number. */
export interface LevelResult {
  medianAge: number | null;
  r2: number | null;
  usablePoints: number;
  /** The fitted hazard regression, for reporting; `null` when unusable. */
  fit: HazardFit | null;
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
   *  `RATIO_AGES` age, keyed by age. Kept for reporting; the regressor
   *  itself is `fleetExitHazard` below. */
  rawRetentionByAge: ReadonlyMap<number, number>;
  /** Fleet EXIT hazard by age — the regressor every per-model hazard fit is
   *  run against (module docstring "Step 6.5"). */
  fleetExitHazard: ReadonlyMap<number, number>;
  /** Fleet-wide private-registration median odometer at each
   *  `ODOMETER_RATE_AGES` age — the denominator of every model's rate ratio
   *  (module docstring "Step 7"). */
  fleetPrivateOdometerByAge: ReadonlyMap<number, number>;
  /** Mean rate ratio across the batch, per body class. Divides each model's
   *  own rate ratio so the national anchor's car/light-truck split isn't
   *  counted twice (module docstring "Step 7"). A JUDGMENT, not sourced. */
  classMeanRateRatio: Readonly<Record<BodyClass, number>>;
  /** Each batch nameplate's rate ratio, computed once here so
   *  `deriveEolForModel` doesn't re-derive what the class means already
   *  needed. Keyed by `EolQuery.name`. */
  rateRatioByName: ReadonlyMap<string, RateRatio>;
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
   *  Weibull median by this model's fitted hazard slope (module docstring
   *  "Step 6.5"); `null` for the `"fleet"` basis (no usable per-model fit). */
  medianAge: number | null;
  /** R^2 of this model's own hazard regression — `null` for the `"fleet"`
   *  basis, where no per-model fit was usable. */
  r2: number | null;
  /** `medianAge / fleetContext.fleetMechanicalMedianAge` — the AGE half of
   *  Step 7. 1 exactly for the `"fleet"` basis. */
  ratioToFleet: number | null;
  /** `rateRatio / classMeanRateRatio(bodyClass)` — the MILEAGE half of Step
   *  7. 1 exactly when no rate ratio could be measured at either the
   *  nameplate or the make level. */
  relativeRate: number;
  eolMiles: number | null;
  /** True whenever `basis !== "nameplate"`, the hazard fit's R^2 is below
   *  `MIN_ACCEPTABLE_R2`, or the rate ratio could not be measured at
   *  nameplate level. */
  provisional: boolean;
  evidence: {
    usableSurvivalPoints: number;
    /** Fitted per-model leak hazard — the term the rejected v2 estimator
     *  assumed cancelled (module docstring "Step 6.5"). Diagnostic only. */
    leakHazard: number | null;
    /** Standard error of the fitted slope, relative to the slope. */
    relativeSlopeSe: number | null;
    /** How many ages backed the mileage-rate measurement. */
    rateAges: number;
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

/** Runs Step 1 plus the Step 6.5 leak-separating hazard regression for one
 *  query granularity (nameplate or make level) against an already-computed
 *  `fleetContext`. No per-model Weibull fit: the curve SHAPE is borrowed
 *  from `fleetContext.fleetMechanicalK` and only the hazard SCALING is
 *  fitted per model. */
async function deriveLevelMedian(
  level: EolLevelQuery,
  fleetContext: FleetContext,
): Promise<LevelResult> {
  // RATIO_AGES, not SURVIVAL_AGES — this path fits independent per-age
  // observations and never chains them, so it can (and should) use every
  // age. See RATIO_AGES' docstring for why the two lists must stay distinct.
  const modelRetentions: AgeRetention[] = await Promise.all(
    RATIO_AGES.map(async (age) => {
      const { n2023, retention } = await retentionAtAge(level.makeCode, level.modelNames, age);
      return { age, n2023, retention };
    }),
  );
  const fit = fitLeakSeparatedHazard(
    modelRetentions,
    fleetContext.fleetExitHazard,
    MIN_VINS_PER_AGE,
  );
  const usable = isHazardFitUsable(fit);
  const medianAge = usable
    ? scaleMedianAgeByHazardRatio(
        fleetContext.fleetMechanicalMedianAge,
        fit.c,
        fleetContext.fleetMechanicalK,
      )
    : null;

  return {
    medianAge,
    r2: medianAge === null ? null : (fit?.r2 ?? null),
    usablePoints: fit?.n ?? 0,
    fit: medianAge === null ? null : fit,
  };
}

/** Private-registration median odometer by age for one query granularity —
 *  the model side of `computeRateRatio` (module docstring "Step 7"). */
async function privateOdometerByAge(level: EolLevelQuery): Promise<Map<number, number>> {
  const entries = await Promise.all(
    ODOMETER_RATE_AGES.map(async (age): Promise<[number, number]> => [
      age,
      await medianOdometer(
        level.makeCode,
        level.modelNames,
        2025 - age,
        2025,
        PRIVATE_REGISTRATION_CLASS,
      ),
    ]),
  );
  return new Map(entries);
}

/** A model's mileage-accumulation rate relative to the fleet, preferring the
 *  nameplate and falling back to the make (module docstring "Step 7"). The
 *  make fallback matters and is not cosmetic: Tesla Model 3's own rate ratio
 *  is measurable from two ages, while the TESLA make rate is dragged down by
 *  Model S/X, so preferring the nameplate whenever it resolves is what keeps
 *  a Model 3 from being derived as a low-mileage luxury car. */
async function deriveRateRatio(
  query: EolQuery,
  fleetPrivateOdometerByAge: ReadonlyMap<number, number>,
): Promise<RateRatio | null> {
  const nameplate = computeRateRatio(
    await privateOdometerByAge(query.nameplate),
    fleetPrivateOdometerByAge,
  );
  if (nameplate) return nameplate;
  if (!query.make) return null;
  return computeRateRatio(await privateOdometerByAge(query.make), fleetPrivateOdometerByAge);
}

/** Whole-NY-fleet raw 2-year retention at `age` — NO make filter, NO model
 *  filter (`ny-inspections.ts`'s `distinctVinCount("", [], ...)`). This is
 *  the fleet baseline `deriveFleetContext` anchors against: the national
 *  anchor it's multiplied against (`NATIONAL_ANCHOR_MILES`, NHTSA DOT HS 809
 *  952) describes the ENTIRE US light-vehicle fleet, not a basket of the
 *  batch's own nameplates, so the denominator of every per-model ratio
 *  (module docstring "Step 7") must refer to that same whole-fleet
 *  population — pooling only the batch's own nameplates measures a
 *  different, mainstream-skewed population instead. */
async function wholeFleetRetentionAtAge(age: number): Promise<number> {
  const { retention } = await retentionAtAge("", [], age);
  return retention;
}

/** Whole-NY-fleet median odometer at `age` — same whole-fleet basis as
 *  `wholeFleetRetentionAtAge` (module docstring "Step 7" needs a fleet-wide
 *  `medianOdometer` to anchor the age-to-miles step against). */
async function wholeFleetOdometerAtAge(age: number): Promise<number> {
  return odometerAtAge("", [], age);
}

/** Computes the shared `FleetContext` (leakage ceiling, crash-removal rate,
 *  derived maintained bonus, mechanical-miles anchor) from the WHOLE NY DMV
 *  fleet — no make filter, no model filter — not from the batch's own
 *  nameplates (see `wholeFleetRetentionAtAge`). `queries` is still the batch
 *  being derived (mirrors `deriveReliability`'s percentile cuts, also
 *  computed once per batch) but is no longer the source of the fleet
 *  baseline itself — NOT invoked against all 71 seed vehicles by this
 *  module; that's a later step's job. */
export async function deriveFleetContext(queries: EolQuery[]): Promise<FleetContext> {
  if (queries.length === 0) {
    throw new Error("deriveFleetContext: need at least one query");
  }

  const { constants } = loadSeedData();
  const totalLossRatePerYr = constants.total_loss_rate_per_yr;

  const ceilingRetentions = await Promise.all(
    LEAKAGE_CEILING_AGES.map((age) => wholeFleetRetentionAtAge(age)),
  );
  const leakageCeiling = computeLeakageCeiling(ceilingRetentions, totalLossRatePerYr);

  const survivalRetentions = await Promise.all(
    SURVIVAL_AGES.map((age) => wholeFleetRetentionAtAge(age)),
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

  const odometers = await Promise.all(SURVIVAL_AGES.map((age) => wholeFleetOdometerAtAge(age)));
  const nearestIdx = nearestAgeIndex(SURVIVAL_AGES, mechanicalFit.medianAge);
  const nearestAge = SURVIVAL_AGES[nearestIdx]!;
  const fleetMechanicalMedianLifetimeMiles =
    odometers[nearestIdx]! * (mechanicalFit.medianAge / nearestAge);

  // The per-model hazard ratio (Step 6.5) divides by fleet retention at
  // RATIO_AGES — every age, including the odd ones the fleet CHAIN above
  // deliberately skips (see RATIO_AGES' docstring). Fetch the missing odd
  // ages so every model ratio has a denominator; the even ones are already
  // in hand from the chain and are reused rather than re-fetched.
  const evenByAge = new Map<number, number>(
    SURVIVAL_AGES.map((age, i) => [age, survivalRetentions[i]!]),
  );
  const rawRetentionByAge = new Map<number, number>(
    await Promise.all(
      RATIO_AGES.map(async (age): Promise<[number, number]> => {
        const known = evenByAge.get(age);
        return [age, known ?? (await wholeFleetRetentionAtAge(age))];
      }),
    ),
  );

  const fleetExitHazard = fleetExitHazardByAge(rawRetentionByAge, leakageCeiling);

  // Step 7's mileage half. The fleet denominator is measured on the same
  // private-registration basis as every model's numerator, so the filter
  // cancels out of the ratio rather than shifting its level.
  const fleetPrivateOdometerByAge = await privateOdometerByAge({ makeCode: "", modelNames: [] });

  // Each batch nameplate's rate ratio, then the per-class means that
  // normalise it. Computed here rather than per model so the class means and
  // the values they normalise come from one pass over the same batch.
  const rateRatioByName = new Map<string, RateRatio>();
  for (const query of queries) {
    const rr = await deriveRateRatio(query, fleetPrivateOdometerByAge);
    if (rr) rateRatioByName.set(query.name, rr);
  }
  const classMeanRateRatio = {} as Record<BodyClass, number>;
  for (const cls of ["car", "light-truck"] as const) {
    const ratios = queries
      .filter((q) => bodyClassFor(q.body) === cls)
      .map((q) => rateRatioByName.get(q.name)?.ratio)
      .filter((r): r is number => r !== undefined);
    if (ratios.length === 0) {
      throw new Error(
        `deriveFleetContext: no measurable mileage-accumulation rate for any "${cls}" vehicle in the batch — ` +
          `cannot normalise Step 7's rate ratio without one.`,
      );
    }
    classMeanRateRatio[cls] = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

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
    fleetExitHazard,
    fleetPrivateOdometerByAge,
    classMeanRateRatio,
    rateRatioByName,
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

  // Step 7's mileage half. Precomputed for the batch by `deriveFleetContext`
  // (the class means needed it anyway); derived on demand for a caller
  // passing a query that wasn't in that batch.
  const rateRatio =
    fleetContext.rateRatioByName.get(query.name) ??
    (await deriveRateRatio(query, fleetContext.fleetPrivateOdometerByAge));
  const relativeRate = rateRatio ? rateRatio.ratio / fleetContext.classMeanRateRatio[bodyClass] : 1;
  const anchor = NATIONAL_ANCHOR_MILES[bodyClass] * fleetContext.maintainedBonus * relativeRate;
  const evidence = {
    leakHazard: level.fit?.leak ?? null,
    relativeSlopeSe: level.fit ? level.fit.seC / level.fit.c : null,
    rateAges: rateRatio?.ages.length ?? 0,
  };

  if (basis === "fleet") {
    return {
      name: query.name,
      body: query.body,
      bodyClass,
      basis,
      medianAge: null,
      r2: null,
      ratioToFleet: 1,
      relativeRate,
      eolMiles: anchor,
      provisional: true,
      evidence: { usableSurvivalPoints: level.usablePoints, ...evidence },
    };
  }

  const ratioToFleet = level.medianAge! / fleetContext.fleetMechanicalMedianAge;
  const lowR2 = level.r2 !== null && level.r2 < MIN_ACCEPTABLE_R2;

  return {
    name: query.name,
    body: query.body,
    bodyClass,
    basis,
    medianAge: level.medianAge,
    r2: level.r2,
    ratioToFleet,
    relativeRate,
    eolMiles: anchor * ratioToFleet,
    provisional: basis !== "nameplate" || lowR2 || rateRatio === null,
    evidence: { usableSurvivalPoints: level.usablePoints, ...evidence },
  };
}
