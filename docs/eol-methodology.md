# End-of-life mileage re-derivation methodology (launch gate, spec §9)

Seed `eol_maintained_miles` values traced back to the lost prototype's Consumer-Reports-flavoured
judgment call (ASSUMPTIONS.md §B: "`eol_maintained_miles` = iSeeCars empirical × 1.30 'maintained'
bonus (baked in)"). R12 (2026-07-29) re-derived `reliability_tier` from NHTSA and cleared half of
spec §9's launch gate; it explicitly left this field and `repair_cost_multiplier_by_make` open,
because both still trace to the same lost judgment (ρ = −0.838 between the old seed tier and
`eol_maintained_miles`, ρ = +0.602 against the make multiplier — "one judgment wearing three
hats," ASSUMPTIONS.md §D/§E). `repair_cost_multiplier_by_make` was resolved 2026-07-30 as a
negative result (collapsed to 1.0 — no public per-make repair-cost source exists). **This document
specifies the other half: exactly how `eol_maintained_miles` is re-derived.**
`packages/pipeline/src/reliability/derive-eol.ts` implements it and
`packages/pipeline/src/reliability/corpus-eol.ts` maps the 71 seed vehicles onto NY State DMV
inspection queries — no code should diverge from what's written here without updating this file in
the same commit.

Per-vehicle derived results and the blast radius of writing them belong in
`docs/investigations/2026-07-30-eol-repair-corpus.md`, not here — that run is still in progress.
This document is the method spec only.

## Why this re-derivation exists

Spec §9 is a hard gate before public launch: Consumer Reports aggressively polices
commercial/public reuse of its ratings, so nothing in `opencawr_data.json` may trace to it.
R12 handled `reliability_tier`. It stopped there deliberately — re-deriving one of three
CR-correlated fields and leaving the other two in place broke the seed's internal consistency
without removing the CR dependency (a car can now carry a derived `high` reliability tier next to
an EOL mileage that still comes from the same lost CR-flavoured judgment). `eol_maintained_miles`
is not a cosmetic field: it sets the whole holding horizon, the resale floor, and the buy-point
sweep's grid cap, so it moves real money in the same way `reliability_tier` does.

## Source and licence

**New York State DMV Vehicle Inspections** (`data.ny.gov/resource/vezn-fmmk`, Socrata SODA API,
62.8M rows, no auth). NY requires annual inspection of virtually every registered vehicle and
records the odometer at each one, so a model's distinct-VIN count in a calendar year is close to a
census of that model still on the road in the state.

**Licence position, verified by reading the actual OPEN-NY Terms of Use PDF directly, not a
summary**: no attribution, no share-alike, no pre-approval, no commercial restriction — usable "as
you wish, subject to no other requirements" beyond lawful use. Same posture as the NHTSA data
R12 already ships. Contrast with the sources rejected below: iSeeCars (proprietary dataset, licence
position not established as open), IIHS-HLDI (copyrighted, explicit ban on repetitive/commercial
use without written permission), CarComplaints/RepairPal (commercial, restrictive ToS, no free
API — the same posture spec §9 clause 2 already struck for reliability).

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
- **iSeeCars longevity study** — this is the source the legacy `eol_maintained_miles` value traces
  to (ASSUMPTIONS.md §B). ROADMAP.md's R14 entry flags it as a proprietary dataset requiring the
  same licence check R13 ran for IIHS-HLDI before building on it ("iSeeCars publishes model-level
  figures in press releases (quotable) but the underlying dataset is proprietary; establish the
  licence position *before* building on it"). That licence position was not established as open
  reuse, so the field could not simply be re-sourced from the same provider under a clean licence —
  it needed a genuinely different, publicly-licensed source, which is why this derivation exists at
  all.
- **IIHS-HLDI** — permission-gated. R13 (2026-07-29, `docs/investigations/2026-07-29-insurance-source.md`)
  read IIHS's own published policy directly: content is copyrighted with an explicit ban on
  *repetitive* and *commercial* use without written permission, and report PDFs are additionally
  stamped "DISTRIBUTION RESTRICTED." A public web app that ships HLDI-derived figures and stays up
  is squarely "repetitive use" by IIHS's own definition. Declined for the same reason in this
  derivation.
- **CarComplaints.com / RepairPal** — commercial sites, restrictive ToS, no free API; obtaining
  their aggregates means extracting a compilation, the exact exposure spec §9 clause 2 exists to
  avoid. Already struck from spec §9 by R12/R14 for the same reason.
- **State DMV registration time series (other states), NMVTIS (National Motor Vehicle Title
  Information System)** — vehicle-title and theft/salvage records, not an odometer census; no
  general public bulk-query interface comparable to NY's Socrata endpoint was found.
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

### Step 6 — age to miles

Median odometer at the CY2025-cohort age nearest the fitted MECHANICAL median age, scaled linearly:

```
medianLifetimeMiles = nearestOdometer × (fittedMedianAge / nearestObservedAge)
```

### Step 7 — anchor to a national number, corrected back up to crash-inclusive terms

This is the key design decision. NY vehicles accumulate fewer miles per year than the national
average (measured: MY2013 Camry median odometer 124,671 at age 12, ≈10.4k/yr, against the 13k
national default). So NY supplies only the *relative* per-model spread; the *absolute* level comes
from a national, public-domain, crash-inclusive (fleet-observed) source, and a `maintainedBonus`
factor lifts that absolute level to mechanical-only terms:

```
ratio(model)     = modelMechanicalMedianMiles / fleetMechanicalMedianMiles     (NY-internal — NY's mileage deflation cancels exactly)
maintainedBonus  = fleetMechanicalMedianAge / fleetObservedMedianAge           (computed once, fleet-wide, from the two Weibull fits)
eol(model)       = nationalAnchor(bodyClass) × maintainedBonus × ratio(model)
```

`nationalAnchor` is NHTSA/DOT "Vehicle Survivability and Travel Mileage Schedules," DOT HS 809 952
(Jan 2006), public domain, still cited by NHTSA's current CAFE rulemakings, and is
fleet-OBSERVED (crash-inclusive): **passenger car 152,137 mi, light truck (pickup/SUV/van) 179,954
mi**. Seed `body` values map to these two classes as `car` = {Car, EV, PHEV, Sport} and
`light-truck` = {SUV, SUV AWD, EV SUV, PHEV SUV AWD, Truck, Van}.

This construction **derives** the legacy 1.30 "maintained" bonus instead of inheriting it: measured
this session, `maintainedBonus` = 1.165 on an age basis.

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
   the query is not restricted to it. Requires ≥5 usable cohort points (`MIN_WEIBULL_POINTS`) AND
   real (non-zero) odometer data at the nearest age; otherwise falls through.
2. **`make`** — pools the make's models instead of one nameplate (an empty `modelNames` array
   queries the whole make, since `ny-inspections.ts`'s adapter only exposes `model_name IN (...)`
   queries, not a true wildcard). Always flagged `provisional`.
3. **`fleet`** — no per-model adjustment: `ratioToFleet = 1`, so `eol = nationalAnchor ×
   maintainedBonus`. Never invents a ratio. Always flagged `provisional`.

**~39 of 71 seed vehicles have thin or zero history in the 4-20 age window; 8 have none at all**
(Kia K4, VW ID.4, Kia Telluride, Hyundai Palisade, Mazda CX-90, Jeep Grand Cherokee L, Toyota RAV4
Prime, Toyota Sienna Hybrid). The fallback exists specifically to prevent those rows from producing
a confident, wrong "lasts forever" number instead of a disclosed, provisional one.

## Known limitations — read these before quoting a number

1. **Single-state (NY) sample.** This measures New York's fleet, not a national one. NY drives less
   than the national average — measured: MY2013 Camry median odometer 124,671 at age 12, ≈10.4k/yr
   against the 13k national default. This is precisely why the method never uses NY's *absolute*
   mileage level: NY supplies only the RELATIVE spread between models (Step 7's `ratio`), and the
   NHTSA national anchor supplies the absolute level. If that design were skipped and NY's raw
   odometers were used directly, every model's EOL would be under-stated by the NY/national mileage
   gap.
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
   with out-of-state moves and inspection non-compliance. The leakage correction (Step 2) assumes
   that combined leak is model-independent — the same baseline rate applies whether the car is a
   Corolla or a Suburban. That assumption is the method's central load-bearing premise, stated
   plainly: **if it is false — for example if luxury or enthusiast cars leave the state, or fall out
   of compliance, at systematically different rates than ordinary cars — the leakage-corrected
   survival curve, and therefore every EOL mileage derived from it, would be biased in whatever
   direction that differential leak runs.** No independent check of model-level leakage-rate
   uniformity was run; this is disclosed rather than resolved.
5. **Refresh cadence.** The derivation runs against a 2023/2025 NY DMV snapshot. That snapshot ages;
   re-pull periodically rather than treating it as permanently current.

## The one piece of external validation

The leakage-corrected fleet median survival age (OBSERVED, crash-inclusive) is **~18.15 years**.
This independently matches the real-world consensus for US passenger cars (~17-18 years) — a number
this derivation was never tuned toward, since the leakage ceiling `L` is computed from the fleet's
own retention curve with no target value supplied. That agreement is the main evidence the leakage
correction (Step 2) is sound, and it is pinned as a regression test ("recovers a realistic fleet
median").

There is a second corroboration, weaker but consistent: dividing the current seed's car-shaped
values by the NHTSA car anchor (152,137 mi) reproduces something close to the legacy 1.30
"maintained" bonus — measured this session, the derived `maintainedBonus` (fleet mechanical median
age ÷ fleet observed median age) is 1.165, and `derive-eol.test.ts` separately pins that this stays
below the legacy un-derived 1.30. That the derived bonus lands in the same neighborhood as the
legacy judgment, without having been aimed at it, is consistent with the anchor choice being a
reasonable match for how the seed was originally built, rather than a contradiction of it.

## What this produces

`npm run eol-report -w @opencawr/pipeline` re-derives the full 71-vehicle corpus (skipping the 2
underivable Porsche 996 rows) and prints it against the current seed `eol_maintained_miles`. It is
read-only by default; `-- --write` applies the derived values to `opencawr_data.json`.

**Writing EOL values is a numbers-change event, not a routine refresh**: `eol_maintained_miles`
anchors the odometer axis of the whole cost curve — the holding horizon, the resale floor, and the
buy-point sweep's grid cap all derive from it. It must be followed by
`npm run gen-reference -w @opencawr/core` and reviewed, the same discipline R12 applied when writing
`reliability_tier`. Per-vehicle results and the measured blast radius belong in
`docs/investigations/2026-07-30-eol-repair-corpus.md`, not this file.

Estimates, not advice.
