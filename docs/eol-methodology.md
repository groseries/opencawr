# End-of-life mileage re-derivation methodology

**Status: SHIPPED 2026-07-31.** This document specifies how `eol_maintained_miles` is re-derived
from public-domain NY State DMV vehicle inspection data.
`packages/pipeline/src/reliability/derive-eol.ts` implements it and
`packages/pipeline/src/reliability/corpus-eol.ts` maps the 71 seed vehicles onto NY State DMV
inspection queries — no code should diverge from what's written here without updating this file in
the same commit.

The values are written to `opencawr_data.json`. Details of per-vehicle results and blast radius
belong in methodology ledger references, not here. This document is the method spec only.

## Source

**New York State DMV Vehicle Inspections** (`data.ny.gov/resource/vezn-fmmk`, Socrata SODA API,
62.8M rows, no auth). Public-domain data; no attribution, share-alike, pre-approval, or
commercial restrictions. NY requires annual inspection of virtually every registered vehicle and
records the odometer at each one.

**NY-state-only caveat, stated up front because it shapes the whole method**: this dataset only
reflects vehicles inspected in New York, not a national fleet sample. See "Known limitations"
below for how that caveat is handled, not waved away.

## Sources evaluated and rejected

- **NHTSA DOT HS 809 952 alone** ("Vehicle Survivability and Travel Mileage Schedules," Jan 2006,
  public domain) — this is the source the shipped method *does* use, but only as a national
  absolute-mileage anchor for two body classes (car / light truck), never as the only signal. Using
  it alone to rank all 71 vehicles was evaluated and rejected: it has only two body-class buckets,
  far too coarse to produce a per-model ordering, and it cannot distinguish a Toyota Camry from a
  Fiat 500 — both are `car`. Both are `car`-body-class, both would receive the identical anchor
  before any per-model adjustment, which is disqualifying given Fiat 500 is flagged `bad` for every
  model year in ASSUMPTIONS.md §D ("no 500 model year is reliable").
  The counterfactual was measured rather than argued, by collapsing all 71 vehicles to the two
  anchors (car 152,137 / light truck 179,954) and re-running the engine at the reference settings
  (1,100 draws, seed 42) against the then-current `model_output`: $/mi P50 mean absolute shift
  **15.9%**, largest single shift **52.8%** (Toyota Sequoia), rank movement mean **11.2** places
  with max **30** and only **4/71** unmoved, and **51/71** `stat_tier` changes. The disqualifying
  result is not the size of the shift but its direction: **Fiat 500 rose to the top tier (T2 → T1)
  and Fiat 500X from T4 → T2, while Toyota Camry fell T1 → T4 and Corolla and Prius both T1 → T3.**
  A method that promotes the one car the ledger explicitly flags as bad for every model year, at the
  expense of the field's most durable cars, is measuring body shape rather than durability. This is
  the run reproduced in `docs/investigations/2026-07-30-eol-repair-corpus.md`.
- **NHTSA complaint "age at incident" as a longevity proxy** — evaluated and rejected: complaint
  timing tracks when an owner discovers and reports a defect, not when the vehicle leaves the
  fleet. A car with a well-known recall-driven defect spike (Hyundai's 2011-2014 Theta II GDI
  engine failures — the same failure mode R12's reliability re-derivation documents as pushing
  Hyundai/Kia powertrain-complaint share to 50-84%, the highest in the corpus) generates a burst of
  *early* complaints that has nothing to do with how long the car ultimately survives.
  This was tested rather than assumed, on a controlled cohort: **model year 2012 only**, so every
  make shares the same maximum possible age (14 years) and the metric cannot be confounded by
  cohort age. Scoring each model by the share of its NHTSA complaints filed **10 or more years
  after** its model year — the fraction that would be high if late-life complaints tracked late-life
  survival — gives: Hyundai Sonata **0.205**, Ford Escape **0.147**, Honda Civic **0.119**, Toyota
  Camry **0.101**, Fiat 500 **0.066**, Toyota Corolla **0.045**. The ordering is close to inverted
  against every independent expectation: Fiat 500 and Corolla, at opposite ends of the durability
  consensus, sit adjacent at the bottom, while Sonata tops the field — consistent with the Theta II
  recall wave producing a burst of late complaints years after the fact, which is a
  defect-discovery artifact rather than evidence that more Sonatas survived to file them. Rejected
  on that basis.
- **iSeeCars, IIHS-HLDI** — proprietary or restricted; not used.
- **CarComplaints.com / RepairPal** — commercial sites, no free API; not used.
- **State DMV registration time series (other states), NMVTIS (National Motor Vehicle Title
  Information System)** — vehicle-title and theft/salvage records, not an odometer census; no
  general public bulk-query interface comparable to NY's Socrata endpoint was found.
- **Washington State registration data** — no odometer field; not suitable for mileage derivation.
- **S&P Global Mobility / IHS Markit Polk VIO (Vehicles in Operation)** — the industry-standard
  fleet-survival dataset; commercial, subscription-only, no public access.
- **Academic literature (e.g. Greene & Leard, vehicle survival/scrappage modeling)** — publishes
  aggregate survival curves and coefficients, not queryable per-model data; useful as a sanity
  check on shape (see "External validation" below) but not as a per-model data source.
- **J.D. Power, Kelley Blue Book, Edmunds, CarMD** — commercial reliability/ownership-cost data
  products; no free API, restrictive reuse terms, same posture as CarComplaints/RepairPal.

## The method

### Step 1 — raw 2-year retention

For a cohort at age `a` in calendar year 2023 (`model_year = 2023 - a`):

```
retention(a) = distinctVinCount(makeCode, modelNames, modelYear, CY2025)
             / distinctVinCount(makeCode, modelNames, modelYear, CY2023)
```

The same model-year cohort, resurveyed 2 years later (age `a+2` by then). `distinctVinCount` is
`count(distinct vin)` server-side via SoQL, verified exact (not an approximation) at the row counts
this adapter deals with.

### Step 2 — leakage correction (load-bearing)

Raw retention is **not** survival. Measured fleet-wide retention at age 4 is only 0.9016, and a
4-year-old car obviously isn't being scrapped at ~10% every two years. There is a large,
model-independent baseline leak: vehicles moving out of NY, inspection-timing drift, and
non-compliance.

```
trueSurvival(a) = min(retention(a) / L, 1)
```

`L` is a fleet-wide leakage ceiling, computed from live fleet data (`deriveFleetContext`), never
hard-coded, but asserted to land within tolerance of the value measured this session (0.9293) so a
dataset-shape change fails loudly instead of silently deriving every model against a wrong
baseline.

**`L` is not simply the raw max retention over ages 4-8, and why matters.** The obvious
definition — `L = max(retention)` over ages 4, 6, 8 (measured: age4 0.9016, age6 0.8969, age8
0.8869, monotonically falling, so the max is at age 4) — forces `trueSurvival = 1.0` exactly at
that age, i.e. it asserts zero attrition there. That contradicts Step 4.5 below, which removes a
1.5%/yr crash hazard implying ~6% of those cars should already be gone by age 4. The two
corrections disagree, and the disagreement is not cosmetic: the raw-max ceiling drove
`S_mechanical` to a capped 1.0 for every age from 4 through 12, leaving only **4 usable points** —
below the 5-point Weibull minimum, so the fleet context failed to resolve at all and the
derivation could not run.

The fix: divide the raw max by one 2-year step of crash-only survival, `(1 - total_loss_rate_per_yr)^2`
(measured: 0.9016 / 0.9702 = 0.9293). This calibrates `L` so that the best young age has mechanical
survival of exactly 1.0 *after* crash removal — the physically correct statement (at age 4
essentially nothing has worn out, but crashes have still happened). With the crash-consistent
ceiling, the same real curve yields 6 usable mechanical points and crosses S=0.5 near age 19.
Leakage correction and crash removal now agree instead of fighting.

### Step 3 — age window: 4 through 20, even ages only

```
SURVIVAL_AGES = [4, 6, 8, 10, 12, 14, 16, 18, 20]
```

- **Age 2 excluded**: measured retention 0.79, anomalously low against its neighbors — lease
  turnover and new-car churn, not scrappage.
- **Ages ≥22 excluded**: measured retention *rises* again (0.7618 @20, 0.7867 @22, 0.8545 @24) —
  small-n plus a collector/enthusiast survivorship artifact, not a real reversal of scrappage.

### Step 4 — cumulative survival

```
S_observed(2) = 1
S_observed(a) = S_observed(prev age) × trueSurvival(a)
```

Chained across the age range.

### Step 4.5 — remove crash attrition (load-bearing)

`S_observed` bundles mechanical wear-out together with crash total-losses. The cost engine
(`packages/core/src/engine.ts:154`) already models crash exposure separately every year via
`constants.total_loss_rate_per_yr` (0.015). Anchoring straight to a crash-inclusive lifetime would
double-count crash attrition on top of the engine's own per-year hazard, so the observed curve is
inflated back up to a mechanical-only curve before fitting:

```
S_mechanical(t) = min(S_observed(t) / (1 - total_loss_rate_per_yr)^t, 1)
```

`total_loss_rate_per_yr` is read from `opencawr_data.json`'s `constants.total_loss_rate_per_yr` at
runtime, never a local literal, so it can never drift from the engine's own constant.

### Step 5 — Weibull fit for right-censored curves

Durable models (Corolla, 4Runner, Tacoma, Sequoia, Highlander, ...) never cross S=0.5 within age
20, so a naive interpolated median is undefined for them — this is required, not optional, for
exactly the most durable cars in the corpus. A Weibull curve `S(t) = exp(-(t/λ)^k)` is fit by OLS
on the linearized form `ln(-ln S) = k·ln(t) - k·ln(λ)`, then:

```
medianAge = λ × (ln 2)^(1/k)
```

Points with `S ≤ 0` or `S ≥ 1` are dropped before the transform (undefined there). Fewer than 5
usable points (`MIN_WEIBULL_POINTS`) yields a `provisional` result with a null median rather than a
number. Measured this session on the real fleet curve: OBSERVED k=4.192, λ=19.81, R²=0.9866, median
age 18.15yr; MECHANICAL (crash removed) k=5.095, λ=22.71, R²=0.9759, median age 21.13yr. The
R²≈0.98 fits confirm Weibull is the right family for this data. A fit below R²=0.85
(`MIN_ACCEPTABLE_R2`) is flagged `provisional` rather than trusted silently.

### Step 6 — fleet age to miles

Median odometer at the CY2025-cohort age nearest the fitted MECHANICAL median age, scaled linearly:

```
medianLifetimeMiles = nearestOdometer × (fittedMedianAge / nearestObservedAge)
```

Steps 1–6 run **once, fleet-wide**, never per model.

### Step 6.5 — the per-model path: leak-separating hazard regression

Rewritten 2026-07-31. The previous version computed a per-age retention ratio against the fleet on
the stated premise that "the leakage term is model-independent by assumption and cancels exactly in
the ratio." **That premise is false**, and it is what put Fiat 500 at rank 2 of the corpus. Fitting
each model its own leak gives a leak hazard spanning 0.006 to 0.172 against a fleet leak of 0.0733 —
a ~27× spread on the term assumed to cancel — and it clusters by make, segment and sibling model
rather than looking like noise. Worse, the contamination is largest exactly where scrappage is
smallest: fleet-wide, the leak is **70.8% of total measured hazard at age 4** and **27.0% at age
20**, so a young-age hazard ratio is mostly a ratio of two leakages. Full evidence in
`docs/investigations/2026-07-31-eol-leak-correction.md`.

So: don't assume the leak cancels, fit it. Decompose each 2-year exit hazard
`h(age) = -ln(retention(age))` into an age-independent LEAK plus an age-varying EXIT term:

```
h_fleet(age) = leakFleet + m_fleet(age),   leakFleet = -ln(L)
h_model(age) = leakModel + c · m_fleet(age)
```

`m_fleet(age)` is exactly the leakage-corrected fleet hazard Step 2 already computes — dividing
retention by `L` is subtracting `-ln(L)` in hazard terms — so the two steps share one decomposition
rather than defining two. A VIN-count-weighted OLS of `h_model` on `m_fleet` returns the slope `c`
(durability, the output) and the intercept `leakModel` (a fact about the NY used-car market, reported
and then discarded). Ages below `MIN_VINS_PER_AGE` = 200 distinct 2023-cohort VINs are dropped.

The slope maps to a lifetime scale through the fleet's fitted MECHANICAL Weibull shape `k` — scaling
a Weibull hazard by `c` scales its median by `c^(-1/k)`:

```
medianAge(model) = fleetMechanicalMedianAge × c^(-1/k)
```

**Acceptance.** A fit needs ≥ `MIN_WEIBULL_POINTS` ages, a positive slope, and a slope standard error
within `MAX_RELATIVE_SLOPE_SE` = **0.35** of the slope. That last guard is what refuses to invent a
durability number for a nameplate that has never been old — the failure mode Step 8 exists for.
Measured: Corolla 0.725 ± 0.080 (11%, kept); Fiat 500 1.123 ± 0.740 (66%, rejected); Camry Hybrid
0.525 ± 0.489 (93%, rejected).

**Stability, measured not asserted.** Three leak-aware variants — this regression on all ages, the
same on ages ≥8, and the same with the intercept clamped ≥0 — agree on the per-model ordering at
Spearman ρ = **0.956–0.995**. The superseded ratio estimator sits outside that cluster at ρ = 0.484.

### Step 7 — age to miles, then anchor to a national number

Also rewritten 2026-07-31, as an explicit owner decision between two measured options. Everything
above this step is denominated in **years**; the field is denominated in **miles**, and the data
cannot settle the conversion on its own.

**Rejected — one fleet rate for every model.** The argument for it is real: `eol_maintained_miles` is
reached by applying the *user's* annual-mileage input, so a per-nameplate implied mileage fights the
engine's own input, and who buys a Mini Cooper is not a durability fact. It was rejected on
measurement — it leaves every unmeasurable nameplate asserted to be exactly average while cutting
20–27% off the measured durable ones, putting Fiat 500 at rank 2 and Fiat 500X at rank 5.

**Shipped — each model's own measured rate.** An odometer value can only be observed by observing
odometers; measuring retirement age and converting at a borrowed rate is a substitution, and the
substitution is large — accumulation spans **2.1×** across this corpus (Fiat 500 6,243 mi/yr,
Suburban 12,627, fleet 9,420). Two corrections make it usable:

- measured on **`registration_class='PASSENGER'` only**, because NYC livery inflates exactly the
  models most exposed to it (Camry Hybrid 15,685 mi/yr blended vs 11,912 private; Prius unchanged at
  11,303 → 11,283, so it is not a livery car);
- expressed as a **ratio to the fleet over the same ages** the model has data at, never as an
  absolute rate. Cars accumulate faster when young, so a young-only nameplate would otherwise be
  over-rated; the age-for-age ratio cancels the fleet's accumulation profile, and it also cancels
  NY's mileage deflation against the national anchor exactly as the age ratio does.

```
ageRatio(model)  = medianAge(model) / fleetMechanicalMedianAge
rateRatio(model) = Σ(age · odo_model) / Σ(age · odo_fleet)     over shared ages, private registrations
relRate(model)   = rateRatio(model) / classMeanRateRatio(bodyClass)
maintainedBonus  = fleetMechanicalMedianAge / fleetObservedMedianAge
eol(model)       = nationalAnchor(bodyClass) × maintainedBonus × ageRatio × relRate
```

The division by the body class's mean rate ratio (measured: car 0.9502, light-truck 1.0386) exists
because `nationalAnchor` already carries a car/light-truck split that itself partly reflects trucks
being driven more — without it, class-level mileage is counted twice. **That normalisation is a
JUDGMENT, not a sourced quantity.**

`nationalAnchor` is NHTSA/DOT "Vehicle Survivability and Travel Mileage Schedules," DOT HS 809 952
(Jan 2006), public domain, still cited by NHTSA's current CAFE rulemakings, and is
fleet-OBSERVED (crash-inclusive): **passenger car 152,137 mi, light truck (pickup/SUV/van) 179,954
mi**. Seed `body` values map to these two classes as `car` = {Car, EV, PHEV, Sport} and
`light-truck` = {SUV, SUV AWD, EV SUV, PHEV SUV AWD, Truck, Van}.

This construction **derives** the legacy 1.30 "maintained" bonus instead of inheriting it: measured
on the shipped run, `maintainedBonus` = **1.1072**.

### Step 8 — three-level coverage fallback (load-bearing)

The age-4..20 survival fit needs cohort model years 2003-2019 (observed in 2023). Many seed
vehicles are simply too new to have that history at all: Kia K4 (first_year 2025), VW ID.4,
Toyota RAV4 Prime, Toyota Sienna Hybrid (2021), Hyundai Palisade, Kia Telluride (2020), Mazda CX-90
(2024), Jeep Grand Cherokee L (2021) have **zero** usable cohort points at the nameplate level —
every too-old age bucket has 0 rows in both calendar years, retention collapses to 0 and stays 0
for every age after it. Fitting a Weibull to 1-2 young-age points would produce a wildly
overconfident "lasts forever" extrapolation; that failure mode must not ship. So each model
resolves through a fallback, the level always recorded on the result (`basis`), never silent:

1. **`nameplate` (preferred)** — the nameplate's `model_name` strings, queried across every model
   year it has actually existed. Durability is substantially a nameplate/manufacturer property
   ("Camrys last" is the claim being measured), and a generation-strict window starves most of the
   corpus. Several nameplate strings pre-date their most recent generation (Volvo XC60 used since
   ~2010, Volvo XC90 since ~2003) — a seed row's own generation window would undercount them, so
   the query is not restricted to it. Requires a hazard fit that clears Step 6.5's acceptance
   (≥5 ages, positive slope, slope SE within `MAX_RELATIVE_SLOPE_SE`); otherwise falls through.
2. **`make`** — pools the make's models instead of one nameplate (an empty `modelNames` array
   queries the whole make, since `ny-inspections.ts`'s adapter only exposes `model_name IN (...)`
   queries, not a true wildcard). Always flagged `provisional`.
3. **`fleet`** — no per-model durability adjustment: `ageRatio = 1`, so
   `eol = nationalAnchor × maintainedBonus × relRate`. Never invents a durability ratio. Always
   flagged `provisional`.

**The mileage rate (Step 7) has its own, separate fallback**, and deliberately so: the two halves
fail for different reasons. A nameplate can be unmeasurable for durability (no old cohorts) while
still having a perfectly measurable mileage rate at the ages it does have — which is exactly the
case for the three `fleet`-basis rows, and is what keeps them from being asserted average. The rate
prefers the nameplate, falls back to the make, and needs only `MIN_ODOMETER_RATE_AGES` = 2 shared
ages because it is a ratio of two sums, not a fitted slope. Preferring the nameplate here matters:
Tesla Model 3's own rate is 9,786 mi/yr while the TESLA make rate is 6,564, dragged down by Model
S/X.

Measured on the shipped run: **nameplate 47 / make 19 / fleet 3** of 69, with 45 flagged
`provisional`. The three `fleet` rows are Tesla Model 3, Fiat 500 and Fiat 500X.

## Known limitations — read these before quoting a number

1. **Single-state (NY) sample.** This measures New York's fleet, not a national one. NY drives less
   than the national average — measured: the whole-fleet private-registration rate is 9,420 mi/yr
   against the 13k national default. This is precisely why the method never uses NY's *absolute*
   mileage level: both of Step 7's per-model factors are NY-internal ratios, so the deflation
   cancels, and the NHTSA national anchor supplies the absolute level. If that design were skipped
   and NY's raw odometers were used directly, every model's EOL would be under-stated by the
   NY/national mileage gap.
1a. **The field mixes durability with how hard a model's NY owners drive it.** This is the disclosed
   cost of Step 7's shipped choice, not an oversight — see that step for the rejected alternative and
   why it was worse. Where usage differs for reasons unrelated to the car, the derived EOL carries a
   demographic fact wearing a durability label: Mini Cooper (0.755 relative rate) and Buick Encore
   (0.787) are second cars, not short-lived ones.
1b. **The `PASSENGER` filter removes livery but not rideshare**, which registers as private. Toyota
   Camry Hybrid still carries a 1.331 relative rate and is also on the `make` durability basis, so
   both halves of its number are indirect — treat it as the least reliable row in the set. Fixing it
   properly needs VIN-level cohort following: fix the cohort on the *earlier* year's registration
   class and follow those VINs regardless of later class. A same-year filter on both ends gives a
   false answer, because retired taxis re-register as passenger.
2. **EVs mostly land on the make basis**, which measures that manufacturer's GAS-car durability. An
   EV has no engine or transmission but does have a battery — a structural mismatch, not a modeled
   one. R12 solved the analogous problem for `reliability_tier` by giving EVs their own reference
   group; there is not enough EV-specific history in NY DMV data to do the same here (the oldest
   EVs in the corpus barely reach age 8), and no EV adjustment factor was invented to paper over it.
3. **The 2 Porsche 996 rows are not derivable at all.** NY DMV lumps every 911 variant (Carrera,
   Turbo, GT2/GT3) across MY1999-2006 into a single bare `911` `model_name` string with no
   trim/engine/drivetrain field to split on — worse than NHTSA's partial split for the same cars.
   Both rows are `reliability_tier = "sport"` and already excluded from derivation as an owner
   carve-out (R12 applied the same rule); this is a documented gap, not a blocker.
4. **Retention measures "still being inspected in NY,"** which bundles genuine scrappage together
   with out-of-state moves and inspection non-compliance. An earlier version of this document said
   the method assumed that combined leak was *model-independent*, and warned that "if it is false…
   every EOL mileage derived from it would be biased." **It is false, it was measured on 2026-07-31,
   and Step 6.5 no longer assumes it** — each model's leak is now a fitted intercept rather than a
   term presumed to cancel. What remains assumed is weaker but still load-bearing: that a given
   model's leak is roughly *age-independent* across ages 4–20. It probably is not exactly — an
   8-year-old car is more nationally tradeable than a 19-year-old one — and since a leak that
   declines with age is negatively correlated with the regressor, the residual bias runs toward
   understating the hazard slope (making a high-leak model look more durable) for exactly the
   high-leak models. Toyota Camry, the corpus's second-highest leak, also has its worst fit
   (R² 0.359). Disclosed, not resolved.
5. **A model-year quality trend confounds the period table.** Every age is measured in one calendar
   window, so comparing across ages is comparing across model years; a nameplate that genuinely got
   better or worse over its production run reads as an age effect. Not corrected.
6. **Refresh cadence.** The derivation runs against a 2023/2025 NY DMV snapshot. That snapshot ages;
   re-pull periodically rather than treating it as permanently current.

## The one piece of external validation

The leakage-corrected fleet median survival age (OBSERVED, crash-inclusive) is **16.90 years** at
R² 0.9953. This independently matches the real-world consensus for US passenger cars (~17-18 years) —
a number this derivation was never tuned toward, since the leakage ceiling `L` is computed from the
fleet's own retention curve with no target value supplied. That agreement is the main evidence the
leakage correction (Step 2) is sound, and it is pinned as a regression test ("recovers a realistic
fleet median").

Two weaker corroborations, both consistent:

- The derived `maintainedBonus` (fleet mechanical median age ÷ fleet observed median age) is
  **1.1072**, and `derive-eol.test.ts` pins that it stays below the legacy un-derived 1.30. Landing
  in the same neighbourhood as the legacy judgment without having been aimed at it is consistent
  with the anchor choice matching how the seed was originally built.
- The per-model durability ordering was not tuned toward any expectation, and the ends of it are
  what a knowledgeable person would expect: the lowest fitted hazards are Toyota Highlander (0.424),
  Honda CR-V (0.551), Toyota Tacoma (0.660) and Toyota Sequoia (0.711); the highest are Chevy Equinox
  (3.292), Chrysler Pacifica (2.947), Chevy Traverse (2.941) and VW Passat (2.395). This is a weak
  check — "matches reputation" is not a measurement, and it is the same intuition the Consumer
  Reports judgment encoded — so it is listed as corroboration, never as validation.

## What this produces

`npm run eol-report -w @opencawr/pipeline` re-derives the full 71-vehicle corpus (skipping the 2
underivable Porsche 996 rows) and prints it against the current seed `eol_maintained_miles`. It is
read-only by default; `-- --write` applies the derived values to `opencawr_data.json`.

**Writing EOL values is a numbers-change event, not a routine refresh**: `eol_maintained_miles`
anchors the odometer axis of the whole cost curve — the holding horizon, the resale floor, and the
buy-point sweep's grid cap all derive from it. It must be followed by
`npm run gen-reference -w @opencawr/core` and reviewed, the same discipline R12 applied when writing
`reliability_tier`. Per-vehicle results and the measured blast radius belong in
`docs/investigations/2026-07-31-eol-leak-correction.md`, not this file.

Estimates, not advice.
