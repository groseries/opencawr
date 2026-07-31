# R14 follow-up — `eol_maintained_miles`: the left-truncation diagnosis was wrong

Written 2026-07-31. Supersedes the "Why the output is not shipped" and "Recommendation" sections of
`docs/investigations/2026-07-30-eol-repair-corpus.md`; everything else in that file still stands,
including the whole of Part 1 (`repair_cost_multiplier_by_make`, closed as a negative result) and
the fleet-half validation. Method spec: `docs/eol-methodology.md`.

**Outcome in one line:** the 2026-07-30 session's derivation failed for a diagnosable and fixable
reason that is **not** left-truncation, the fix is a leak-separating hazard regression plus a
per-model mileage rate, and the values **are now written** — spec §9's Consumer Reports gate is
closed.

---

## 1. What the previous session concluded, and why it is not supported

The 2026-07-30 record attributes the failed ranking (Fiat 500 at rank 2, Camry/Tacoma/4Runner/
Sequoia falling 27–36%) to **left-truncation**: "the dataset begins 2020-12-29, so every retention
measurement is conditional on the vehicle having already survived to the base year… the selection is
differential: the worse the model, the more flattering the selection applied to it," and concludes
"nothing available fixes this… more signal has to come from a *later* endpoint (2023 vs 2027), not
an earlier one — i.e. from waiting."

Two problems with that.

**A period life table does not require observing cars from birth.** The method builds a synthetic
cohort from conditional 2-year survival probabilities measured across ages in one calendar window.
That is the standard construction precisely because it is immune to not having watched the fleet
since 1998. Frailty selection within a model does depress the conditional hazard at older ages, but
the chained product remains the correct population survival curve, because each factor applies to
the pool actually alive at that age.

**The differential-selection prediction is not what the data does.** If bad models were being
flattered toward average by selection, their measured hazard ratio should shrink toward 1 as age
rises. Measured across the 38 models with both windows populated, 21 diverge from 1 at older ages
and 17 converge — and the fragile end diverges hard in the wrong direction for the hypothesis:

| model | hazard ratio, ages ≤11 | ages ≥12 |
|---|---|---|
| Chevy Equinox | 1.576 | **2.341** |
| VW Passat | 1.420 | **1.999** |
| Kia Sportage | 1.601 | **1.916** |
| Kia Sorento | 1.658 | **1.887** |
| Ford Escape | 1.309 | **1.837** |

The models that *do* converge (Camry 1.397→0.833, Suburban 1.682→0.958, Camry Hybrid 1.602→0.998)
are exactly the models whose young-age figure was inflated in the first place, for the reason below.
This evidence is suggestive, not decisive on its own; §2 is the decisive part.

## 2. What actually broke it: the leak does not cancel

`derive-eol.ts`'s Step 6.5 rested on one written premise — "the leakage term is model-independent by
assumption and cancels exactly in the ratio." It was never tested. It is false.

Decompose each measured 2-year exit hazard `h(age) = -ln(retention(age))` into an age-independent
LEAK term (left NY, or fell out of inspection compliance) plus an age-varying EXIT term (scrappage
plus crash), and fit each model its own:

```
h_fleet(age) = leakFleet + m_fleet(age),   leakFleet = -ln(L) = 0.0733
h_model(age) = leakModel + c * m_fleet(age)
```

VIN-count-weighted OLS gives a per-model `leakModel` spanning **0.006 to 0.172** against a fleet
leak of 0.0733 — a ~27× spread on the term assumed to cancel. It is not noise. It clusters by make,
segment and sibling model, which a noise term does not do:

| model | fitted leak ÷ fleet leak |
|---|---|
| Chevy Suburban / Chevy Tahoe | 2.34 / 1.46 |
| Toyota Camry / Toyota Camry Hybrid | 2.02 / 2.33 |
| Hyundai Elantra / Hyundai Sonata | 1.84 / 1.76 |
| Toyota Corolla / Honda Civic / Honda CR-V / Toyota RAV4 | 0.96 / 1.08 / 0.97 / 0.89 |
| Subaru Forester / Subaru Outback | 0.33 / 0.17 |
| Toyota Sienna / Honda Odyssey | 0.11 / 0.09 |

And the contamination is **amplified at young ages**, because that is where scrappage is smallest.
Fleet-wide, the leak's share of total measured hazard:

| age | 4 | 8 | 12 | 16 | 20 |
|---|---|---|---|---|---|
| leak share of `h_fleet` | **0.708** | 0.611 | 0.388 | 0.296 | **0.270** |

So `c(age) = h_model(age) / h_fleet(age)` at age 4 is roughly a ratio of two leakages. That is the
whole failure: Fiat 500 has cohorts only at ages 7–11 (US launch MY2012), so its entire estimate came
from the region where the estimator measures the used-car market rather than the car — while Camry
and Suburban were pushed down for leaking, not for wearing out. The taxi component of that is
directly visible: **Camry MY2015 carries 2,540 `OMNIBUS TAXI` VINs out of ~12,000 (21%)**, against
Corolla's 60 of 7,715 (0.8%) and Prius's 109 of 3,566 (3%). Taxis are a Camry phenomenon, not a
Prius one.

## 3. The fix, and its stability

Do not assume the leak cancels — fit it, and keep only the slope. `fitLeakSeparatedHazard` returns
`c` (durability) and `leakModel` (a fact about the NY used-car market, reported and then discarded).

Stability was measured, not asserted. Spearman rank correlation of the per-model ordering across
estimators, over the 38 models all five can compute:

|  | A regression | B ages ≥8 | C leak ≥0 | D ratio ≥12 | E shipped-before |
|---|---|---|---|---|---|
| **A** regression, all ages | 1.000 | 0.957 | 0.995 | 0.878 | 0.484 |
| **B** regression, ages ≥8 | 0.957 | 1.000 | 0.956 | 0.847 | 0.465 |
| **C** regression, intercept clamped ≥0 | 0.995 | 0.956 | 1.000 | 0.888 | 0.511 |
| **D** old ratio estimator, ages ≥12 | 0.878 | 0.847 | 0.888 | 1.000 | 0.828 |
| **E** ratio estimator, all ages (what shipped before) | 0.484 | 0.465 | 0.511 | 0.828 | 1.000 |

The three leak-aware variants agree at ρ = 0.956–0.995. The previous estimator sits outside that
cluster at ρ ≈ 0.48. The ordering is not an artifact of the age window or of the handful of models
that fit a negative intercept.

A slope is only trusted when its standard error is within `MAX_RELATIVE_SLOPE_SE` (0.35) of the
slope. This is what refuses to invent a number for a nameplate that has never been old: Fiat 500
fits at c = 1.123 ± 0.740 (66%) and Camry Hybrid at 0.525 ± 0.489 (93%), both rejected to the
coverage fallback; Corolla fits at 0.725 ± 0.080 (11%) and is kept.

## 4. The age→miles fork, and why the previous choice was reversed

The derivation natively produces a median survival **age**. Step 7 turned that into miles at one
fleet-wide rate, on the argument that per-model rates smuggle in owner demographics. Both options
were implemented and their full-corpus blast radius measured (engine at 1,100 draws, seed 42, against
the then-current `model_output`) before the owner chose:

| | A — one fleet rate | B′ — each model's own rate |
|---|---|---|
| $/mi P50 mean abs shift | 12.35% | **11.86%** |
| largest single | 47.0% (Prius) | 35.4% (Leaf) |
| rank movement mean / max | 7.24 / 33 | **6.37 / 23** |
| `stat_tier` changed | 57/71 | **35/71** |
| Fiat 500 rank | **2** (from 14) | **15** (from 14) |
| Fiat 500X rank | **5** (from 38) | 28 (from 38) |
| corpus spread | 1.81× | 2.77× (seed 2.14×) |

**Variant A still fails, and now for an identified reason.** Fiat 500 and 500X have no measurable
durability, land on the coverage fallback, and are thereby asserted to be exactly average — while
the models we *did* measure get cut 20–27% off inflated seed values. The promotion comes from
cutting Toyota, not from lifting Fiat.

**Variant B′ was chosen** (owner decision 2026-07-31). `eol_maintained_miles` is an odometer reading;
the only way to observe one is to observe odometers, and measuring retirement age then converting at
a rate borrowed from other cars is a substitution, not a measurement. The substitution is large:
accumulation spans **2.1×** across this corpus (Fiat 500 6,243 mi/yr, Chevy Suburban 12,627, fleet
9,420). NY Fiat 500s reach 79,306 median miles at age 12 against the fleet's 116,917.

Two corrections were needed to make the rate usable, and each was measured:

1. **`registration_class='PASSENGER'` only.** Blended, Camry Hybrid measures 15,685 mi/yr; on private
   registrations alone, 11,912 (−24%). Camry 10,640 → 9,425. Prius is unchanged (11,303 → 11,283),
   confirming it is not livery-driven. ~20% of rows carry a blank class and are excluded too, so this
   is "definitely private," not "not commercial."
2. **A ratio to the fleet age-for-age, never an absolute rate.** Cars accumulate faster when young
   (the fleet's own implied rate falls from 10,383 mi/yr at age 6 to 8,392 at age 16), so a
   young-only nameplate would otherwise be over-rated. Taking the ratio at matched ages cancels that
   profile — and it is also what fixed Tesla Model 3, whose own rate is 9,786 mi/yr while the TESLA
   make rate is 6,564, dragged down by Model S/X. Under the uncorrected variant B, Model 3 derived to
   120,167 mi and fell 58 ranks; corrected, it derives to 169,294.

The rate ratio is divided by its body class's mean (car 0.9502, light-truck 1.0386) so the NHTSA
anchor's own car/light-truck split — which partly reflects trucks being driven more — is not counted
twice. **That normalisation is a judgment, not a sourced quantity.**

## 5. What was written

`npm run eol-report -w @opencawr/pipeline -- --write`, then `npm run gen-reference -w @opencawr/core`.

Coverage: **nameplate 47 / make 19 / fleet 3** of 69 (the 2 Porsche `sport` rows remain underivable).
45 of 69 are flagged `provisional`. Derived `maintainedBonus` = **1.1072**, replacing the legacy
un-derived 1.30. Fleet observed median age 16.90 yr (R² 0.9953) — still independently in the
real-world consensus band, and still not tuned toward.

Both ends of the derived ordering:

```
longest   Highlander Hybrid 275,085 | Sequoia 264,491 | Highlander 259,496 | Tahoe 248,911
          Camry Hybrid 242,380 | Suburban 238,637 | Camry 230,414 | 4Runner 229,570
shortest  Leaf 99,230 | Fiat 500 110,135 | Encore 125,575 | Mini Cooper 128,906
          Volt 130,181 | Fiat 500X 141,063 | Equinox 141,678 | Passat 141,193
```

## 6. Limitations — read these before quoting a number

- **The field now mixes durability with how hard a model's NY owners drive it.** Where those differ
  for reasons unrelated to the car, the derived EOL carries a demographic fact wearing a durability
  label. Mini Cooper (0.755 relative rate) and Buick Encore (0.787) are the clearest cases: both are
  second cars. This is the disclosed cost of choosing variant B′ over A, not an oversight.
- **The `PASSENGER` filter removes livery but not rideshare**, which registers as private. Camry
  Hybrid still carries a 1.331 relative rate and is the corpus's most exposed row; it is also on the
  `make` durability basis, so both halves of its number are indirect. Treat it as the least reliable
  row in the set. Fixing it properly needs VIN-level cohort following (fix the cohort on the earlier
  year's registration class and follow those VINs regardless of later class) — a same-year filter on
  both ends gives a false answer, because retired taxis re-register as passenger.
- **Single-state sample.** NY only, and NY drives less than the national average. The method never
  uses NY's absolute mileage — both the age ratio and the rate ratio are NY-internal, so the
  deflation cancels, and NHTSA supplies the absolute level.
- **Three rows have no measurable durability at all** (Tesla Model 3, Fiat 500, Fiat 500X) and take
  the body-class anchor scaled by their own measured mileage rate. That is an honest "we cannot
  measure how long this lasts, but we can measure how far it goes," not a durability claim.
- **Low-R² fits are kept but flagged.** Toyota Camry fits at R² 0.359, wrecked by the MY2015–2017
  taxi cohort; Camry Hybrid at 0.095 was rejected outright and fell to the make basis. Read the
  `provisional` column.
- **EVs mostly land on the make basis**, which measures that manufacturer's gas-car durability. No EV
  adjustment factor was invented.
- **A model-year quality trend would confound the period table.** All ages are measured in one
  calendar window, so the comparison across ages is a comparison across model years; a nameplate that
  genuinely got better or worse over time reads as an age effect. Not corrected, disclosed.
- **Refresh cadence.** 2023/2025 NY DMV snapshot. Re-pull periodically.

Estimates, not advice.
