# Investigation — no replacement vehicle is charged when a hold ends (R21)

**Date:** 2026-07-31 · **Branch:** `worktree-bridge-cse_01UbT1rucGngcqqYDQfwGKcD` (worktree)
**Scope:** investigation + UI copy only. **No engine file was modified and no reference output
moved.** All experiments ran from a throw-away copy of `costPerMile` in `.tmpr21/engine-cf.ts`,
verified bit-identical to the shipped engine with every counterfactual switch off — `max |Δ| = 0`
across 71 vehicles × 6 holds, **per draw**, not merely per quantile (`.tmpr21/verify.ts`).

**Method.** `.tmpr21/measure.ts`, defaults from `opencawr_data.json`, each vehicle at its own
`pinned_buy_odo`, 1,100 draws, seed 42, holds {25k, 50k, 75k, 100k, 125k, 150k, 175k, 200k,
`"eol"`}. Three metrics are computed on the *same* per-draw stream:

| | numerator | denominator | tires |
|---|---|---|---|
| **TODAY** | PV dollars | undiscounted miles | nominal (as shipped) |
| **F2** | PV dollars | PV of miles | nominal — this is R10 option 2 *as R10 specified it* |
| **EAC** | PV dollars | PV of miles | discounted — a true repeat-the-hold-forever equivalent annual cost |

---

## Verdict (short)

**R21's defect is real and large: today's $/mi says "hold the car as long as possible" for
63 of 71 vehicles, and the direction reverses once each option is charged for the car that
follows it.** But the fix R21 sketches — annuitize to a common horizon — is **not a single
well-defined change.** Its answer is set almost entirely by a parameter R21 names in passing and
does not resolve: *what is the next car?* On the seed field's Corolla the same 50k-vs-`"eol"`
comparison lands at **+11.9%, +2.6% or +0.7%** depending on that choice — a 18× spread, larger
than the defect being corrected.

Three further findings change what a fix should look like:

1. **The cheapest stand-in — "the same car again, forever" — collapses algebraically to R10's
   declined option 2** (PV dollars ÷ PV miles), *plus* a tires correction R10 never specified. It
   is also the choice most flattering to short holds, and it is the one stand-in whose
   continuation weight cancels — which is exactly why it looks canonical.
2. **It re-creates R21's own defect on a second axis.** The price a car pays under the levelized
   metric correlates **+0.912 with `eol_maintained_miles`**: a short-lived car delivers its miles
   sooner, is discounted less, and is still never charged for the replacement its early death
   forces. Fiat 500 — the field's worst reliability tier — moves rank **15 → 4**. Spec §9's
   own limitation note wants that car demoted, not promoted.
3. **Roughly two-thirds of today's hold-length gradient is R20's resale blend, not the metric.**
   Reverting only the blend (hard cliff, pre-`acab1d2`) drops the 100k-vs-`"eol"` gap from
   −4.31% to −1.36% and takes the long-hold preference from 63/71 to 25/71.

**Recommendation: do not change `costPerMile`.** Ship the UI refusal (R21 option 2, mirroring
R10's shipped fix — done in this change), and put the stand-in choice to the owner as a named
decision with the numbers below attached. A metric change made before that decision would be
answering a question nobody has picked.

---

## 1. How big is the effect today?

Percentage change in $/mi from a fixed hold to `"eol"`, all 71 vehicles, 1,100 draws. Negative
means `"eol"` reads cheaper — i.e. the model prefers driving the car to death.

| hold → `"eol"` | TODAY mean | median | range | EAC mean | median | range |
|---|---|---|---|---|---|---|
| 50k | **−11.3%** | −9.2% | [−35.9, +11.1] | **+3.8%** | +4.0% | [−8.8, +22.7] |
| 100k | −4.3% | −2.7% | [−22.8, +0.3] | +0.9% | +0.3% | [−2.2, +8.2] |
| 150k | −1.0% | −0.0% | [−13.3, +0.4] | −0.0% | +0.0% | [−1.6, +1.7] |

The sign flips at 50k and 100k. That is the whole of R21 in one table: today a short hold is
penalised relative to a long one by an amount that is mostly an artifact of dividing
present-value dollars by nominal miles over a horizon the user is choosing.

### 1a. …but "which hold is cheapest" is not a measurable quantity today

This is the caveat that killed a stronger version of this finding, and it belongs in the table,
not a footnote. Under TODAY's metric the per-vehicle argmin over the 9-hold grid is **noise**:

- Identical across 12 seeds for only **5 of 71** vehicles (mean 3.11 distinct winners per car).
- Best-vs-runner-up gap is under 1 standard error for **63 of 71** vehicles at 1,100 draws
  (median *t* = 0.16).
- **58 of 71** vehicles price 200k and `"eol"` within 0.1% of each other, and **54 of 71** have
  all of {150k, 175k, 200k, `"eol"`} within 0.5% — because a nominal hold truncates at each
  draw's own sampled EOL (§4). The long end of the grid is largely the same experiment repeated.

So a nine-bin histogram of "today's best hold" is not reportable. What **is** stable is the
coarse long-vs-short split, and it is stable enough to publish (8 seeds, 400 draws):

| | vehicles preferring a long hold (≥125k or `"eol"`) | group identical across 8 seeds |
|---|---|---|
| TODAY | **58–63 of 71** (per-seed: 61, 60, 61, 61, 61, 62, 63, 58) | 56/71 |
| EAC | **6–7 of 71** (per-seed: 7, 6, 7, 7, 7, 6, 7, 6) | 67/71 |

At seed 42, 1,100 draws: TODAY prefers long for **63/71**, EAC prefers short (≤100k) for
**64/71**, and **57/71** are genuine long→short transitions. The levelized argmin is far better
identified than today's (52/71 seed-stable vs 5/71), which is itself a finding: today's metric is
flattest exactly where the user is asked to choose.

Both counts should be re-measured after **R16** (common random numbers) lands — a paired
comparison this noisy is precisely what R16 says is broken.

---

## 2. The replacement stand-in *is* the fix

R21 option 1 says "annuitize each option to a common horizon … requires picking a common
comparison horizon and a stand-in cost for 'the next car'." The horizon turns out to be nearly
free; the stand-in turns out to be everything.

For hold option X evaluated against a continuation policy S repeated forever:

```
$/mi_X = (C_X + df(T_X)·V_chain,S) / (M_X + df(T_X)·M_chain,S)
```

with `C_X`, `M_X` the PV dollars and PV miles of one cycle of X, and `V_chain,S = C_S/(1−df(T_S))`
the PV of S repeated. **Setting S = X gives `C_X/M_X` exactly** — self-replication is the unique
continuation whose weight cancels, which is why it collapses to a pure metric change.

Toyota Corolla, buy odo 55,000, `eol_maintained_miles` 181,624, 1,100 draws:

| hold | TODAY | S = same hold forever (self-replicating) | S = this car, driven to death | S = a 100k-mi example, held 50k |
|---|---|---|---|---|
| 50k | 0.4543 | **0.5249** | 0.5717 | 0.6058 |
| 100k | 0.4377 | 0.5691 | 0.5789 | 0.6052 |
| 150k | 0.4260 | 0.5873 | 0.5864 | 0.6097 |
| `"eol"` | 0.4264 | 0.5876 | 0.5865 | 0.6098 |
| **50k → `"eol"` gap** | −6.2% | **+11.9%** | **+2.6%** | **+0.7%** |

The correction R21 asks for is anywhere between +0.7% and +11.9% depending on a car nobody has
named. Self-replication is the largest of the three because the short hold's continuation is, by
construction, another cheap short hold; a continuation that is *shared* between the two options
(the textbook unequal-lives construction) mostly cancels.

**Self-replication is also not expressible in the engine as built.** `buyPrice`, the model-year
reliability multiplier and feasibility all flow from
`deriveBuyYear(vehicle, buyOdo, am, now_year)` (`packages/core/src/feasibility.ts`,
`engine.ts:67-76`) with `now_year` pinned at 2026. Cycle 2 buys the same odometer *T years later*
— a different model year with a different landmine/caution/sweet-spot multiplier — and for
discontinued nameplates, a car that cannot be bought at all. The chain is also frictionless: the
same `price_vs_odometer_usd` curve supplies both the purchase price and the resale
(`engine.ts:62`, `engine.ts:137`), so the implied "sell at 105k, rebuy at 55k, forever" pays no
spread, no dealer margin and no search cost. Only `use_tax_rate` repeats, correctly.

### Conditions the perpetuity identity actually needs

State these wherever the identity is used; several are not satisfied today.

1. The replacement is **the evaluated cycle itself** — same vehicle, same `buyOdo`, same
   `buyPrice`, same `holdMiles`, forever. Any continuation *shared* between the options breaks it.
2. Real terms, constant real `r`, no calendar drift in price, model year or availability.
3. **Every numerator term is a true PV of the cycle.** Fails today for tires — see §3.
4. Energy folded in on the **same discounting convention as the denominator**. The shipped
   `avgDf` is continuous while the yearly loop is discrete end-of-year; the two differ by ~3.5% in
   level (a constant, not a horizon artifact).
5. Per draw, the sampled `eol` is **frozen and reused by every cycle**, so the identity holds
   per-draw and commutes with the P50.
6. Horizon infinite, or finite and long (≤0.6% error at a 10-year stub).
7. `holdMiles` read as the **realized** hold `min(buyOdo + holdMiles, eol)`, not the nominal
   request — the repeating cycle is the truncated one (§4).

---

## 3. A real defect found on the way: undiscounted tires in a PV numerator

`packages/core/src/engine.ts:202` — `const tires = tiresPerMi * miles;` — puts **nominal** dollars
into a present-value numerator. Under a correct chain this term should contribute a flat
`tiresPerMi`; as written it contributes `tiresPerMi / avgDf`, which **grows with the horizon**.

Corolla, F2 (tires nominal, as R10 option 2 specified) against EAC (tires discounted):

| hold | TODAY | F2 | EAC | F2 − EAC |
|---|---|---|---|---|
| 25k | 0.5097 | 0.5568 | 0.5549 | +0.0019 (0.34%) |
| 100k | 0.4377 | 0.5750 | 0.5691 | +0.0059 (1.04%) |
| `"eol"` | 0.4264 | 0.5951 | 0.5876 | +0.0075 (1.28%) |

Field-wide at `"eol"`: mean F2 − EAC = **0.94 ¢/mi**, max 2.79 ¢/mi. Two consequences:

- Part of R10 option 2's declined "+48% headline" was this bug being unmasked, not levelization.
- Under **today's** metric the error is invisible in $/mi (nominal over nominal), so this is not
  urgent — but it is a genuine defect and it must be fixed *before* any levelization, or the
  levelized number inherits a horizon-growing artifact of its own. Filed as its own roadmap item.

---

## 4. Nominal holds are not realized holds

`costPerMile` truncates the sell odometer at each draw's own sampled EOL, so a "150k hold" is a
request, not a fact:

| nominal hold | mean truncated-draw fraction | mean realized ÷ nominal miles | vehicles realizing <90% |
|---|---|---|---|
| 100k | 0.318 | 0.961 | 10/71 |
| 150k | 0.781 | 0.773 | 52/71 |
| 200k | 0.958 | 0.602 | 66/71 |

This is correct engine behavior (already noted at `engine.worker.ts:514-517`) but it is why the
long end of the hold axis is nearly degenerate, and why §1a's identification problem exists. It
also means "compare a 150k hold against drive-to-death" is, for most of the field, comparing two
descriptions of nearly the same experiment.

---

## 5. How much of the gradient is R20?

R20 (`acab1d2`, shipped 2026-07-31) replaced the hard resale cliff at `sell >= eol` with a linear
blend over the last `resaleBlendWindowFraction` (0.25) of each draw's own life. That penalty
applies **only** to holds ending inside the last quarter of life — never to short holds, and
never to `"eol"` (where `sell == eol` and resale is scrap either way). It is therefore a U-shaped
penalty across the hold grid, and it pushes the argmin toward the extremes.

Re-running the same measurement with the pre-R20 cliff restored:

| | prefer long (≥125k/`"eol"`) | 100k → `"eol"` gap | long→short flips vs EAC |
|---|---|---|---|
| pre-R20 (hard cliff) | **25/71** | **−1.36%** | 20/71 |
| post-R20 (shipped) | **63/71** | **−4.31%** | 57/71 |

`"eol"` mode is **bit-identical pre/post R20 for 71/71 vehicles**, exactly as R20's entry claims —
so this does not touch the reference set or §6's blast radius. But it does mean the premise
"today's metric prefers long holds" is roughly two-thirds a judgment constant shipped the same
day, and only one-third the PV/nominal mismatch. R20's own entry already flags the repair ramp and
the age escalator as unfixed compounding causes; `resaleBlendWindowFraction` belongs on that list
and is now filed as its own item.

---

## 6. Blast radius if the metric changed anyway

At the reference basis (`holdMiles: "eol"`, each vehicle at `pinned_buy_odo`, 1,100 draws), TODAY
→ EAC:

| | |
|---|---|
| mean headline $/mi | **0.5438 → 0.7422 (+36.5%)** |
| mean absolute rank shift | **5.94 places**, max **29** (Toyota Highlander Hybrid) |
| tie tiers | **9 → 12**; `stat_tier` changes for **55/71** |
| top 10, today | Camry Hybrid, Prius Prime, Camry, Bolt EV, Niro, Prius, RAV4 Hybrid, K4, Elantra, Corolla |
| top 10, EAC | Prius Prime, Camry Hybrid, Bolt EV, **Fiat 500**, Niro, Elantra, Volt, Corolla, K4, Accord |

All 71 `model_output` rows move — a deliberate numbers-change event under `DECISIONS.md`.
Consequences that are **not** covered by re-running `gen-reference`:

- **`reference.test.ts:58-62` goes red.** It is a hand-written guardrail (`top6` must contain
  Bolt EV *and* Prius (hybrid)) that the generator does not touch. Measured under EAC: Bolt EV in,
  **Prius (hybrid) out** (rank 6 → 12). The only way to green it is to weaken the guardrail, which
  `DECISIONS.md:50` names as never a CI fix.
- **Spec §2's formula is normative** (`DECISIONS.md:3-4`: the spec is the source of truth), so it
  must be amended first — both halves of the `$/mi` line, plus the `energy_per_mile ×
  avg_discount_factor` term, which is *deleted* rather than moved (PV(energy)/PV(miles) ≡ `epm`).
- **Spec §5's "the top ~13 cars are 2 tie-tiers"** — rendered live in the Assumptions tab — becomes
  false at 9 → 12 tiers.
- **Three engine outputs stop agreeing with the headline** unless fixed in the same commit:
  `engine.ts:212-221` divides breakdown components by undiscounted miles; `engine.ts:210`'s
  `lifetimeUsd = total * miles` stops being dollars (breaks the ledger row at `ASSUMPTIONS.md` §B
  and `engine.test.ts:198,219-222`); `engine.ts:244`'s `oppCostPerMi` keeps the old denominator.
- **R10's own restriction becomes arguable.** If $/mi is horizon-invariant, `buyPointSweep`'s
  refusal to run at `"eol"` (`buypoint.ts:18,125-129`) — and the user-facing explanation at
  `App.tsx:179-186` — rest on a reason that no longer holds. Every R10/R2-era statistic would need
  re-measuring before that could be reasoned about.

### The corollary that argues against the fix on its own terms

Under EAC, how much a car's price inflates is almost entirely a function of how long it lives:
**corr(inflation %, `eol_maintained_miles`) = +0.912**.

| vehicle | EOL miles | rank today → EAC | $/mi today → EAC |
|---|---|---|---|
| Fiat 500 | 110,135 | **15 → 4** | 0.4565 → 0.5543 |
| Toyota Prius (hybrid) | 186,701 | 6 → 12 | 0.4158 → 0.6028 |
| Toyota Highlander Hybrid | 275,085 | **11 → 40** | 0.4335 → 0.7166 |

A short-lived car delivers its miles sooner, so its denominator is discounted less — and under
self-replication it is *still* never charged for the replacement its early death forces. That is
R21's defect, moved from the hold-length axis to the vehicle-longevity axis. Promoting the Fiat
500 to rank 4 is the visible symptom; `OpenCAWR_SPEC.md` §9's limitation note wants that car
demoted on P75, not promoted on P50.

---

## Proposed fixes

**P1 — refuse the comparison in the UI (R21 option 2). SHIPPED with this investigation.**
Mirrors R10's shipped refusal: the heatmap caption says reading *down* the hold axis is not
like-for-like (no replacement vehicle is charged), the rail's horizon control says the same at the
point of choice, and the Rankings `"eol"` note carries the hold-length half of the same statement.

**The heatmap's color scale is also normalized per row** (owner-directed 2026-08-01, after the
copy landed). The caption alone was contradicted by the picture: one grid-wide ramp painted the
long-hold rows uniformly light, which *is* the cross-horizon claim this entry says the model
cannot make. Measured on the Camry Hybrid's own grid, the grid-wide scale collapsed **4 of 8 rows**
into a single ramp bucket; per row, **0 of 8** collapse and all 8 span the full 4-step ramp — so
the within-row buy-point comparison (the only one R10 sanctions) is legible for the first time.
The hold axis and `HOLD_MILES_AXIS` are untouched (R9/R10: the axis is load-bearing), and every
cell still prints and announces its own $/mi, so only the encoding is scoped. Accepted trade-off:
two cells in different rows sharing a shade no longer mean the same $/mi — the caveat the per-car
scale already carried between cars, now also between rows, and stated in the caption.

No engine, worker, calibration or reference change; `reference.test.ts` untouched. Verified
in-browser (Playwright, 1440×1000 and 390×844): color monotone in price within all 8 rows, both
captions and the rail hint visible at every horizon preset with no overflow, no console errors.

**P2 — fix undiscounted tires (`engine.ts:202`). Small, standalone, owner sign-off.**
Independent of R21's direction. Must land *before* any levelization. Own roadmap entry.

**P3 — sensitivity-test `resaleBlendWindowFraction`. No sign-off needed to measure.**
§5 shows the constant, not the metric, drives most of the current hold gradient. Own roadmap entry.

**P4 — the metric change (R21 option 1 / R10 option 2). NOT taken; owner decision.**
Blocked on a decision, not on work: *what is the next car?* The three candidates and their
measured consequences are §2's table. Preconditions if it is ever taken: P2 first; spec §2/§5
amended in a separate commit; the three arithmetic consequences in §6 fixed in the same commit as
the metric; `reference.test.ts:58-62` re-argued explicitly rather than relaxed; `gen-reference`
changed to snapshot the *outgoing* `model_output` (today it only snapshots on first run, so the
current numbers survive only in git history) and to report the shift against the outgoing values
rather than the lost prototype; regeneration in an isolated commit; and sequencing against R16,
which is a second declared numbers-change event on the same 639 `model_output` value lines.

Framing constraint for any of this, from `docs/HANDOFF.md`: write it as **unequal lives /
equivalent annual cost**, never as "miles lose value over time." The owner rejected that framing
once already and was right to.

---

## Ledger rows this investigation adds to `ASSUMPTIONS.md` §B

1. $/mi is not horizon-invariant on the **hold-length** axis either (R10's row covers the
   buy-point axis): 50k vs `"eol"` measures −11.3% today and +3.8% levelized.
2. Comparing hold lengths charges no replacement vehicle, and the size of the correction is set by
   an unmodeled stand-in — 0.7% to 11.9% on the Corolla's 50k-vs-`"eol"` comparison.
3. Nominal `holdMiles` truncates at each draw's sampled EOL: at 150k nominal the field realizes
   77.3% of nominal miles with 78.1% of draws truncated, and 58/71 vehicles price 200k and
   `"eol"` within 0.1%.
4. `engine.ts:202` charges tires as nominal dollars inside a PV numerator — invisible in today's
   $/mi, worth 0.34%–1.28% by horizon under any levelized metric.
