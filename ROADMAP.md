# OpenCAWR — Roadmap / Feature Queue

Ordered backlog. Nothing here is in progress. When an item is picked up, plan it with
`superpowers:writing-plans` into `docs/superpowers/plans/`, then execute it. When it ships,
move the line to **Shipped** with its commit and add any new assumption to `ASSUMPTIONS.md`.

Conventions that apply to every item: ONE engine (all cost math in `packages/core`),
reference tests stay exact (`npm test -w @opencawr/core`), a ledger row for every new
assumption, estimates-not-advice copy, Node ≥ 20.

---

## P0 — Correctness and honesty (do first)

**R16. Common random numbers are broken — every paired comparison is far noisier than it should
be.** *(Found 2026-07-31 diagnosing why R15's tie tiers are so wide. Measured, not inferred.
Next item.)*
Two buy points of the SAME vehicle at the SAME seed should share nearly all their randomness, so
the *difference* between them is far tighter than either level — that is the whole point of
common random numbers, and it is what the tie test, the buy-point sweep and the model-year panel
all implicitly rely on. It does not hold. Toyota Corolla, 2020 (78k mi) vs 2022 (52k mi) at a
100k hold, 1,100 paired draws:
```
level sd             $0.0331/mi
PAIRED difference sd $0.0374/mi   <- LARGER than the level
noise cancelled      -13%          <- pairing makes it worse, not better
```
The two runs are effectively independent samples. **Cause, confirmed by reading the code:
per-draw random consumption is variable, so the substreams desynchronize.**
- `Rng.poisson` (`packages/core/src/rng.ts`) consumes `k + 1` uniforms for a sampled count `k`.
  Repair hazard `lambda` differs between buy points, so the two runs draw a different number of
  values and **every stream position after that point diverges**.
- The insurance loop in `costPerMile` runs `ny = ceil(T)` times, and `T` differs by buy point, so
  `rngIns` desynchronizes the same way — before the Poisson even runs.
**The codebase already knows the discipline and applies it in exactly one place**: the battery
block draws its normal even when the failure branch is not taken, commented *"always consume —
keeps the stream aligned."* That is the fix, generalized.
Fix: make per-draw consumption fixed-length — a constant-consumption Poisson (inverse-CDF from a
single uniform, or a fixed-size pre-draw with a documented cap), and a fixed number of insurance
normals with only the first `ny` used. **This is a deliberate NUMBERS-CHANGE EVENT**: random
consumption changes, so every `model_output` moves and `gen-reference` must be re-run with owner
sign-off — it is exactly the kind of change `reference.test.ts` exists to gate, and must never be
regenerated to green a failing test.
Sequencing: **measure the pairing cancellation before and after** (the script behind the numbers
above is in `.tmpcse/`) and report it, then re-measure R15's tie counts — a large part of "67 of
71 cars have tied model years" is expected to be this artifact rather than a real property of the
field. Do not re-tune `tieTierBeatProb` to compensate; fix the variance reduction first. Raising
the panel's 300 draws is NOT a substitute — it sharpens the estimate of a comparison that is
broken at the source.
Blast radius beyond the panel: this affects **every** paired comparison in the app — the
buy-point sweep's argmin between adjacent grid points, `upperOdo`'s tolerance walk (whose "%
accurate to about one grid step" caveat in `ASSUMPTIONS.md` §B is likely the same root cause),
and the Rankings tie tiers.

**R20. Resale is a hard cliff at EOL, not a smooth approach to scrap — SHIPPED 2026-07-31,
`acab1d2`.**
*(Found 2026-07-30, owner question: "why are vehicles cheaper at 150k hold vice keeping until
it dies"; filed as R15 originally, renumbered R20 — same investigation thread as R16.)*
`packages/core/src/engine.ts`:
`const resale = sell >= eol ? scrap : Math.max(curveAt(priceCurve, sell, scrap), scrap);` was a
step function: `holdMiles: "eol"` sets `sell = eol` **by construction** on every draw, so that
mode always landed on the cliff's scrap side, while a fixed-mileage hold one mile short of the
same odometer kept full market-curve value. This was the dominant reason a fixed-mileage hold
priced cheaper than "drive until it dies."
Fix (candidate 1 of the options this diagnosis logged): resale now interpolates linearly from
the curve value down to scrap over the last `CALIBRATION.resaleBlendWindowFraction` (0.25) of
that draw's own sampled `eol`, instead of stepping at `sell >= eol`. Outside the window,
behavior is byte-identical to before. `holdMiles: "eol"` itself is unaffected by design — `sell`
still equals `eol` exactly, so a car driven to literal death is still worth scrap; what changes
is every fixed-mileage hold that lands within a quarter-life of a plausible EOL, which is where
the old cliff quietly handed a resale bonus the `"eol"` comparison never got. New `CALIBRATION`
constant, 0.25 chosen against `constants.eol_sigma_by_tier` (0.10-0.15) — see `ASSUMPTIONS.md`
§B for the sizing argument. **Measured** on the seed field's Toyota Corolla (55k buy odo, 249.6k
median `eol_maintained_miles`) at a 205k-mile fixed hold vs. `"eol"` mode: the resale gap
narrows from **$7,150 to $5,110 (-28.5%)**. `reference.test.ts` (runs at the default
`holdMiles: "eol"`) is **byte-identical, 74/74** — not a numbers-change event for the reference
set, because `"eol"` mode's own resale was already always scrap and still is. Only fixed-hold
callers (buy-point sweep, model-year panel, Rankings at a numeric hold) see different numbers.
`npm test -w @opencawr/core` 133/133 green, after updating one `modelyear.test.ts` fixture whose
synthetic "two tied years" example moved to a different pair for the same reason (the old
fixture's near-EOL pair owed its tie to the cliff's extra dispersion, not the underlying
closeness the test meant to demonstrate).
Compounds with (not fixed by this entry): the existing quadratic major-repair hazard ramp past
120,000 mi (`repairOdoThreshold`/`repairRampScaleMiles`, engine.ts) and the linear age escalator
past age 8 (`calAgeEscPerYr`, engine.ts), both steepest in exactly the extra miles a
drive-to-death hold adds beyond a shorter fixed hold — a second, independent reason "drive to
death" reads as expensive that this fix does not touch.

**R9. Heatmap should be years × miles, not hold-miles × buy-miles — SHIPPED 2026-07-29,
folded into R2 (see below), heatmap left untouched.** Original framing (owner, 2026-07-29:
*"Our heat map was a map of years and miles originally but it morphed into a map of hold vs
buy miles"*) was to relabel `Heatmap.tsx`'s axes with model year. This entry was originally
assigned to a separate agent; the owner overrode that 2026-07-29 mid-session and directed
combining it with R2, with one clarification that changed the design: **"the optimum buy/hold
combo will be driven by the model year... though the questions are distinct."** That reframing
is why the heatmap itself was left alone (see R2's Shipped entry for the reasoning and what
shipped instead) rather than growing year labels on its columns.
`apps/web/src/charts/Heatmap.tsx`, `engine.worker.ts`'s `handleSurvey`, `SurveyCell` were all
investigated but ultimately **not modified** — kept here for the historical context:
- Odometer and model year are **coupled**, not independent: `impliedModelYear(odo, annualMiles,
  nowYear) = nowYear − odo/annualMiles` (`packages/core/src/feasibility.ts`). `handleSurvey`
  already computes this per cell as `impliedBuyYear` inside `costPerMile` and discards it.
- **The hold axis is load-bearing and was not touched.** Holding hold-miles constant per row
  is exactly what makes this chart trustworthy (R10). Confirmed during investigation:
  `handleSurvey` never called `buyPointSweep` at all — it loops two hardcoded axes
  (`BUY_ODO_AXIS` 10k–120k, `HOLD_MILES_AXIS` 25k–200k) directly through `costPerMile`, so
  R10's numeric-`holdMiles` constraint was already structurally satisfied here.
- `model_year_reliability` (landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95) is the data
  that makes a year axis worth having — it's surfaced instead in R2's new ranking panel.

**R10. The $/mi metric is not comparable across different holding periods —
SHIPPED 2026-07-29, option 1.**
Full analysis: `docs/investigations/2026-07-29-ideal-new.md`. Cost per mile is
present-value dollars ÷ **undiscounted** miles. With `holdMiles: "eol"` the horizon is a
function of the buy odometer (Corolla: 19.2 yr bought new vs 10.0 yr bought at 120k), so a
longer hold discounts costs harder while its miles still count in full, and an identical
cost stream reports ~23% cheaper for the newer car. **This is the dominant cause of R8's
"buy new" result — roughly 90% of it.**
Measured, and this is the number that matters: at a **fixed** hold the field behaves
normally — 65/67 cars have an interior cheapest buy point at a 50k hold, 63/67 at 100k —
while at `"eol"` only 9/71 do. **The heatmap is already correct** because it fixes the hold
per row; the rankings and `buyPointSweep` are not.
The framing to avoid: this is *not* "miles lose value over time" (owner's objection,
2026-07-29 — correct). It is the **unequal-lives problem**: comparing a 10-year hold against
a 20-year hold never charges the shorter option for the replacement car it will need. Options,
cheapest first:
1. **Run `buyPointSweep` at a fixed hold** instead of `"eol"` — `buypoint.ts` only, changes no
   reference output, takes the degenerate count 62/71 → ~7/71. Recommended. **SHIPPED**: the
   sweep's own input type now requires a numeric `holdMiles` (`"eol"` is a type error, backed by
   a runtime refusal for callers that bypass TypeScript) and uses the rail's own number
   verbatim, no substitution of its own. When the rail is `"eol"`, the sweep does not run at
   all and the Rankings row shows no ideal/upper mileage — the owner chose showing nothing over
   quietly answering a different question. Re-measured post-R11 (grid floored at the first
   price-curve point) at a 100k hold: **4/71 land at the grid floor, 3/71 collapse to a
   single-point grid, 64/71 have a genuine interior optimum** — see `ASSUMPTIONS.md` §B for the
   full write-up, the 50k/150k comparisons, and the copy changes in `App.tsx`/§I. This is a hard
   prerequisite for adding MSRP price anchors (tracked separately): anchoring would drop the
   sweep's grid floor toward 0, and at `"eol"` 9/13 anchored vehicles were measured to snap
   `idealOdo` back to 0, versus 0/13 at a fixed hold.
2. **Levelize the denominator** (discount miles as well — the standard equivalent-annual-cost
   correction, same construction as LCOE). Internally consistent at any horizon, but a large
   deliberate numbers-change: mean headline $0.520 → $0.770/mi (+48%), mean rank shift 6.3
   places, max 22, top 10 reshuffles. Owner sign-off required. Not taken.
3. Document only, and treat "until it dies" as a non-comparable basis. Not taken.
Secondary findings from the same investigation, both worth a ledger row: at r=0, half the
field *still* prefers the newest buy point, so `DECISIONS.md`'s claim that the monotonicity
disappears at r=0 is only partly true as implemented; and the odometer-implied-age limitation
contributes **exactly zero** at default settings, because at 13,000 mi/yr `deriveBuyYear`
reduces to the same arithmetic (it does bite at other mileages — 17 cars move at 20k mi/yr).

**R11. `curveAt` extrapolates left of the first price point — near-new prices are invented.**
Full analysis: `docs/investigations/2026-07-29-ideal-new.md`. `packages/core/src/curves.ts`.
Spec §2 sanctions extrapolating past the **last** curve point; the code also extrapolates past
the **first**. No seed vehicle has a price observation below 10,000 miles (the curves are
used-market pulls), so every price below that is off the end of the data. Because used-car
curves are relatively flat, extending them leftward makes a nearly-new car cost barely more
than a 10,000-mile one: **modeled year-one depreciation averages 9.3% against a real-world
~20%** — Civic 2.7%, Prius 3.6%, Suburban 5.3%. This is the second, independent reason new
cars look too cheap, and unlike R10 it is a plain defect.
Fix: clamp below the first point (mirroring what `maintenanceAt` already does) **and** floor
the sweep grid at that odometer — they must ship together, because clamping alone makes new
cars look cheaper still. Verified to change **no reference outputs** (no seed vehicle's
`pinned_buy_odo` sits below its first curve point). Live impact today: the heatmap's 10k/20k/30k
columns and the Deal Analyzer's price-vs-curve figure for low-mileage listings.

**R8. "Ideal mileage" is degenerate for most of the field** (found in R4's own live
verification, 2026-07-28). **Largely explained as of 2026-07-29 — see R10 and R11, which are
the actual causes.** The investigation found this is ~90% an artifact of the metric being
compared across unequal holding periods (R10) plus invented near-new prices (R11), not a
genuine property of the cost model. After both are fixed, 60+ of 71 cars have a real interior
optimum, which makes most of the redefinition candidates below unnecessary. **Fix R10 and R11
first, then re-measure before redefining anything.** Original entry follows.
`packages/core/src/buypoint.ts`, `apps/web/src/App.tsx` car-meta line. R4 shipped
`buyPointSweep`, whose `idealOdo` is the unconstrained argmin of P50 across the feasible
odometer range. Measured across all 71 seed vehicles at default assumptions: **`idealOdo`
sits at the lowest point of the car's own sweep grid for 62/71 (87%), and at literally 0 mi
for 53/71 (75%)**; only 9 cars have a true interior optimum, and 2 more have a single-point
grid (the `eol_maintained_miles` cap collapses their feasible range). 3 have no upper limit.
~~This is structural, not a bug — at r = 7% real, present-value $/mi decreases monotonically
with newness for most cars.~~ **Superseded 2026-07-29**: the 2026-07-28 reading was wrong. It
is ~90% artifact (R10 + R11), and `DECISIONS.md`'s "at r=0 the newest-buy-is-always-cheapest
monotonicity no longer holds" is itself only partly true as implemented — at r=0 half the field
still prefers the newest buy point. Consequences: the column mostly reads "buy new," which is
uninformative for a used-car tool and drifts toward advice. **Owner decision required** on
the definition — candidates: argmin subject to a purchase-price budget; the knee of the
cost-vs-odometer curve (where marginal savings flatten) rather than its minimum; a used-car
odometer floor; or reporting the whole curve instead of a single point. `upperOdo` and the
5% tolerance walk are unaffected by whichever is chosen. Do not re-derive
`feasibleOdoRange`/`deriveBuyYear` — reuse them.

**R14. Re-derive `eol_maintained_miles` and `repair_cost_multiplier_by_make` — SHIPPED, and it
closes the Consumer Reports gate.** *`repair_cost_multiplier_by_make` 2026-07-30 (negative result,
1.0 everywhere); `eol_maintained_miles` 2026-07-31 (NY DMV survival analysis, 69/71 rows rewritten,
reference outputs regenerated).* Method: `docs/eol-methodology.md`. Evidence:
`docs/investigations/2026-07-31-eol-leak-correction.md` and `2026-07-30-eol-repair-corpus.md`.
Construction, blast radius and residual open items: `ASSUMPTIONS.md` §B/§D/§E.
The one finding worth carrying forward, because it cost a session: the 2026-07-30 attempt failed
(Fiat 500 at rank 2 of the corpus) and diagnosed itself as **left-truncation**, concluding nothing
could fix it short of waiting for a 2027 endpoint. That was wrong. The real cause was that the
estimator assumed the NY out-of-state leakage term was model-independent and cancelled in a ratio;
measured, per-model leak spans ~27× and is 70.8% of total hazard at age 4 against 27.0% at age 20,
so young-age hazard ratios measure the used-car market rather than the car. **When a derivation
rests on a stated "by assumption" premise, measure the premise before blaming the data.**
The original problem statement, kept for the record:
R12 re-derived `reliability_tier` from NHTSA and stopped there. These two fields still trace to
the same lost-prototype CR judgment, and they are not incidental: they correlate with the old seed
tier at **−0.838** and **+0.602** — one judgment wearing three hats. So R12 broke the seed's
internal consistency **without removing the CR dependency**, and `OpenCAWR_SPEC.md` §9 is
deliberately marked PARTIALLY CLEARED until this lands. Both fields move real money:
`repair_cost_multiplier_by_make` multiplies every major-repair event cost, and
`eol_maintained_miles` sets the end-of-life distribution's median, so it drives the holding
horizon, the resale floor and the sweep's grid cap.
Why this is harder than R12 was:
- **`eol_maintained_miles`** — spec §9's own table cites the iSeeCars longevity study plus
  owner-reported/high-mileage registries. iSeeCars publishes model-level figures in press releases
  (quotable) but the underlying dataset is proprietary; establish the licence position *before*
  building on it, the same way R13 did for IIHS-HLDI. There is no NHTSA equivalent — complaint data
  says nothing about longevity.
- **`repair_cost_multiplier_by_make`** — the obvious source (RepairPal) has just been struck from
  §9 as a scraping target, so the easy answer is closed by our own decision. NHTSA carries no cost
  data at all. Candidates worth evaluating: BLS producer/consumer price series for motor vehicle
  maintenance and repair (public domain, but economy-wide, not per-make); published OEM parts
  pricing; insurance physical-damage severity by make, which runs into the same IIHS licence wall
  R13 hit. **A well-argued negative result is an acceptable outcome** — if no public per-make repair
  cost source exists, the honest move is to collapse the multiplier toward 1.0, say plainly that
  make-level repair cost is not modeled, and log what that costs in accuracy.
Sequencing note: do NOT re-derive these to agree with the current tiers. R12's tiers are now NHTSA
-derived; deriving these from the tiers would recreate the three-hats problem in the other
direction. They need genuinely independent sources or an explicit statement that they are not
derived.

*(R20 was filed here as an open item — see the P0 section above, right after R16: SHIPPED
2026-07-31, `acab1d2`.)*

**R21. No replacement-vehicle cost is charged when a fixed hold ends — option 2 SHIPPED
2026-07-31; option 1 is an OWNER DECISION, not a piece of work.** *(Found 2026-07-30, same
investigation as R20; filed as R16 originally, renumbered — R16 was already taken on master by
the common-random-numbers finding. Investigated 2026-07-31:
`docs/investigations/2026-07-31-hold-length-replacement.md`.)*
Distinct from R10: R10 fixed the *buy-point* sweep so different buy odometers are compared at the
same fixed hold. This is the *hold-length* axis for a single vehicle — comparing a fixed hold
(e.g. 150k mi, which cashes out resale and stops) against `"eol"` (which cashes out scrap and
stops) never charges either side for the car the owner has to buy next.
**The defect is confirmed and large.** All 71 vehicles at their own `pinned_buy_odo`, 1,100 draws,
% change from a fixed hold to `"eol"` (negative = `"eol"` reads cheaper): **50k −11.3% today vs
+3.8% levelized**, 100k −4.3% vs +0.9%, 150k −1.0% vs −0.0%. The sign flips. Today's metric
prefers a long hold for **63/71** vehicles; charged for a replacement it prefers ≤100k for
**64/71**.
**Caveat that must travel with those counts**: today's per-vehicle *best hold* is not an
identified quantity — stable across 12 seeds for only **5/71**, best-vs-runner-up under 1 SE for
**63/71**, and **58/71** price 200k and `"eol"` within 0.1% because a nominal hold truncates at
each draw's sampled EOL. Only the coarse long-vs-short split is stable (58–63 of 71 prefer long
across 8 seeds). Re-measure after R16.
**Why option 1 is not a fix that can just be built.** Its answer is set by the stand-in for "the
next car," which R21 named in passing and never resolved. Corolla, 50k vs `"eol"`, three
defensible stand-ins: **+11.9%** (same hold repeated forever), **+2.6%** (continuation: this car
driven to death), **+0.7%** (continuation: a 100k-mi example held 50k). An 18× spread — larger
than the defect. Self-replication is the cheapest *and* the most flattering to short holds: it is
the unique continuation whose weight cancels, which is why it collapses algebraically to R10's
declined option 2 (PV dollars ÷ PV miles) — plus a tires correction R10 never specified (R22).
It is also not expressible in the engine (`deriveBuyYear` pins `now_year`, so cycle 2 buys a
different model year; discontinued cars cannot be rebought) and implies a frictionless resale
chain — same curve for buy and sell, no spread, no dealer margin.
**And it re-creates R21's own defect on a second axis**: corr(price inflation, `eol_maintained_miles`)
= **+0.912**. A short-lived car delivers its miles sooner, is discounted less, and is still never
charged for the replacement its early death forces. Fiat 500 (worst reliability tier) moves rank
**15 → 4**; Highlander Hybrid **11 → 40**; Prius (hybrid) 6 → 12. Spec §9 wants the Fiat demoted,
not promoted.
**Blast radius, measured, if the metric changed anyway** (at the reference basis `"eol"`): mean
headline **0.5438 → 0.7422 (+36.5%)**, mean rank shift **5.94**, max **29** (Highlander Hybrid),
tie tiers **9 → 12**, `stat_tier` moves for **55/71**, all 71 `model_output` rows change.
Regeneration alone is NOT sufficient: **`reference.test.ts:58-62` goes red** (hand-written
top-6 guardrail; Prius (hybrid) drops out) and greening it means weakening a guardrail, which
`DECISIONS.md:50` forbids; spec §2's normative formula and §5's "top ~13 cars are 2 tie-tiers"
both need amending first; and `engine.ts:210` (`lifetimeUsd`), `:212-221` (breakdown denominators)
and `:244` (`oppCostPerMi`) stay on the old denominator unless fixed in the same commit.
**SHIPPED (option 2)**: refusal mirroring R10's, in `Heatmap.tsx`'s legend caption, `controls.tsx`
under the horizon presets, and `App.tsx`'s `"eol"` results note — reading *down* the hold axis is
not like-for-like; reading *across* a row (buy points at one hold) is what the chart supports.
**Plus the heatmap's color scale is now normalized per row** (owner-directed 2026-08-01): the copy
alone was contradicted by the picture, since one grid-wide ramp painted long-hold rows uniformly
light. Measured on the Camry Hybrid grid, the old scale collapsed **4 of 8 rows** to a single ramp
bucket; per row, **0/8** collapse and every row spans the full ramp, so the within-row buy-point
comparison is legible for the first time. Axes and `HOLD_MILES_AXIS` untouched (R9/R10 — the hold
axis is load-bearing); every cell still prints and announces its own $/mi. No engine, worker,
calibration or reference change; `reference.test.ts` 74/74 byte-identical. Verified in-browser at
1440×1000 and 390×844.
**OWNER DECISION REQUIRED** — not "should we annuitize" but **which stand-in**: self-replication
(collapses to R10 option 2, flatters short holds and short-lived cars), a shared continuation
(smaller correction, needs a named continuation vehicle), or an explicit transaction-friction term
(sell-side haircut / acquisition cost). Sequencing if taken: **R22 first**, then spec §2/§5
amendment, then the metric with §6's three arithmetic consequences in the same commit, then
regeneration in an isolated commit — and coordinated against R16, a second declared
numbers-change event on the same 639 `model_output` value lines.

**R22. Tires are charged as nominal dollars inside a present-value numerator.** *(Found
2026-07-31 in R21's investigation; independent of R21's direction.)*
`packages/core/src/engine.ts:202` — `const tires = tiresPerMi * miles;` — is nominal dollars added
to a PV numerator. Under any horizon-consistent metric this term should contribute a flat
`tiresPerMi`; as written it contributes `tiresPerMi / avgDf`, which **grows with the horizon**:
Corolla 0.34% at a 25k hold, 1.04% at 100k, 1.28% at `"eol"`; field-wide at `"eol"` mean 0.94
¢/mi, max 2.79 ¢/mi.
Invisible in today's $/mi (nominal over nominal), so this is not urgent on its own — but it is a
plain defect, and **part of R10 option 2's declined "+48% headline" was this bug being unmasked,
not levelization**. It must be fixed BEFORE any levelization or the new metric inherits a
horizon-growing artifact. Small, standalone **numbers-change event** (moves the reference set;
own sign-off). Discounting it changes `sums.tires` from a flat `tiresPerMi` to a discounted
figure, so the breakdown's tires row moves too.

**R23. `resaleBlendWindowFraction` (0.25), not the metric, drives most of today's hold-length
gradient.** *(Found 2026-07-31 in R21's investigation. Measurement, not a defect claim.)*
R20's blend penalizes only holds ending inside the last quarter of a draw's own life — never a
short hold, never `"eol"` (where `sell == eol` and resale is scrap either way). That is a U-shaped
penalty across the hold grid, and it pushes the argmin to the extremes. Re-running R21's
measurement with the pre-R20 hard cliff restored: vehicles preferring a long hold **25/71
(pre-R20) vs 63/71 (post)**; 100k → `"eol"` gap **−1.36% vs −4.31%**. `"eol"` mode is
**bit-identical pre/post for 71/71**, exactly as R20's entry claims — so this touches no reference
output and is not a correction to R20, which fixed a real cliff.
What it means: the premise "the model prefers driving to death" is roughly two-thirds a judgment
constant shipped 2026-07-31 and one-third the PV/nominal mismatch. R20's own entry already lists
the quadratic repair ramp past 120k and the age escalator past year 8 as unfixed compounding
causes; `resaleBlendWindowFraction` belongs on that list. Sensitivity-test it (0.10 / 0.25 / 0.40
against `constants.eol_sigma_by_tier`) and ledger the result before anyone reads the hold axis as
a finding about cars.

**R2. Model year as a designed surface, not an axis label — SHIPPED 2026-07-29** (rewritten
and re-queued 2026-07-28 at the owner's direction; the original framing — "put implied model
year on the heatmap axis" — was rejected as too small for the problem; combined with R9
2026-07-29 at the owner's direction).
A model year is not merely a repair-cost multiplier applied to an odometer. It implies a
specific **drivetrain** (engine/transmission combination, which can change mid-generation) and
**model-specific known issues** that are year-bounded rather than tier-bounded. What shipped:
a NEW engine primitive, `packages/core/src/modelyear.ts`'s `modelYearRank`, and a new
per-model-year data schema, `Vehicle.model_year_detail`, surfaced together in a new drawer
panel ("Model years: which year is the best buy").
**Design decision, from mid-session owner feedback**: the first draft of this plan annotated
the *existing* heatmap's columns with implied model year. The owner pushed back — "the hold vs
buy odometer is comparing the sweet spot of how long to hold vs when the vehicle was
purchased... our goal here is to answer the question what model year should be purchased all
else being equal" — and asked for a rankable list of a car's own model years instead ("the
2020-2023 model years of the prius are all better than the next model year"), while noting the
two questions are "intertwined" (odometer implies year) "though distinct." Two consequences:
- **The heatmap was left completely untouched** (see R9 above) — it keeps answering hold-vs-buy;
  model year got its own panel instead of a second axis on an existing chart, matching R2's own
  original text ("not a second axis on an existing chart").
- **Ranking method — first shipped canonical-odometer, then UNIFIED at the owner's direction.**
  The first version priced each year once at its own **canonical odometer**
  (`(nowYear − year) × annualMiles`), deliberately *not* bucketing `buyPointSweep`'s grid by
  year, on the reasoning that a year's band is `annualMiles` wide so its cheapest grid point
  often sits at the band edge, borrowing cheapness from the next year. **That shipped and was
  then corrected**: it made the app compute *two* optima over the same cost curve on *different*
  grids, which disagreed on the year for **22 of 71** vehicles at a 100k hold (14 under
  1.2% |Δ$/mi|; Civic 120,000 mi→2017 vs 104,000 mi→2018). The owner caught it in the live app
  and ruled (2026-07-30): *"We are trying to determine the best year AND mileage to buy at - the
  true sweetspot. So it should be one. The user should then be able to use our details panel to
  see the breakdown of each layer and determine a local optimum for themselves."*
  **Shipped now**: ONE grid search. `buyPointSweep` carries `deriveBuyYear` on every grid point
  (`BuyPointSweepPoint.year`) and `modelYearRank` **groups that same grid by model year**,
  reporting per year the cheapest point inside that year's own band *plus its odometer* — which
  answers the original band-edge objection by disclosing the mileage rather than hiding it. Ties
  break toward the lowest odometer in both, so the panel's rank-1 row **is** the sweep's
  `idealOdo`/`idealYear`/`idealP50` by construction. Measured: **71/71 agreement at 50k/100k/150k
  holds**, up from 49/71. `CALIBRATION.sweepStepMiles` 10,000 → **2,500** (a year band is only
  ~13,000 mi wide, so the old step gave ~1.3 samples per band); blast radius, ledgered in
  `ASSUMPTIONS.md` §B: ideal year moved 19/71, ideal odometer 49/71 (mean |Δ| 5,153 mi), **no
  year moved 2+**, and the P50 at the ideal is **never worse** (mean 0.457% cheaper) — the
  correctness check for a strict grid refinement. `handleBuyPoints` is now chunked (8 cars per
  yield, with a supersede check) to hold `DECISIONS.md`'s live-re-ranking requirement against the
  ~4× grid cost.
- Both still require a numeric `holdMiles`, same type-level + runtime refusal (R10). At `"eol"`
  the full ranking is withheld, but the panel still answers via a **per-hold summary** — best
  (year, mileage) at each preset fixed hold — added at the owner's request 2026-07-30 (*"we
  should still show and explain the best model year selected for every hold #"*). That sidesteps
  R10 rather than breaking it: each row is one ranking at one fixed hold, and reading the rows
  against each other shows whether the best year even depends on the horizon (Bolt EV: 2021 at
  50k, 2022 at 100k, 2023 at 150k). The summary reuses the rail's own result for the matching
  hold, after an earlier bug where it ran at 400 draws while the table ran at 1,100 and the two
  named different years 0.5% apart — noise, not signal.
- **Degenerate and clamped cases are disclosed, not papered over.** 2/71 vehicles (both Porsche
  996 rows) clamp every model year to one odometer, so all years price identically and any
  "best year" is only the tie-break — the panel refuses to name one. 32/71 have *some* clamped
  year; those rows are marked `*` with a footnote that they aren't a like-for-like comparison.
- `packages/core/test/modelyear.test.ts` (9 tests) + `buypoint.test.ts` (9), same zeroed-fixture
  discipline: per-year band optimum, a year's cheapest point landing strictly inside its band,
  R11-floor clamping, single-year runs, the `"eol"` refusal, hold-reprices-every-year, and **the
  regression this unification exists to prevent — the panel's rank-1 row and the sweep's sweet
  spot are the same (year, odometer, P50) at three different grid steps**.
  `npm test -w @opencawr/core`: **113/113**, `reference.test.ts` 74/74 **byte-identical** — no
  regeneration; `buyPointSweep`/`modelYearRank`/`model_year_detail` are all outside `costPerMile`.
**Data**: `Vehicle.model_year_detail` (per-model-year `drivetrain`, `specChangeFromPriorYear`,
`topComplaintCategory`, `topComplaintShare`) populated for all 71 seed vehicles, reusing
existing free/keyless infrastructure with **no new licensing exposure** (spec §9 stays clear):
EPA fueleconomy.gov's `displ`/`cylinders`/`trany` fields (already on the wire in the same
`epaVehicleDetail` response used for MPG/CO2, just previously undeclared) for `drivetrain`, and
R12's own NHTSA `complaintComponentsByCatalogue` (same cached fetch, same query window, no
second NHTSA query path) for `topComplaintCategory`. **`specChangeFromPriorYear` is explicitly
a spec-discontinuity proxy** (EPA drivetrain/VClass changed year over year) **and is documented,
in three places (`docs/model-year-detail-methodology.md`, `ASSUMPTIONS.md` §K, and the UI's own
"possible spec change" badge copy), as NOT a confirmed styling refresh or facelift** — EPA data
carries no styling signal at all. `packages/pipeline/test/modelyear.test.ts` (10 tests);
`OPENCAWR_PIPELINE_OFFLINE=1 npm test -w @opencawr/pipeline`: 44/44 (34 pre-existing + 10 new).
Population is **read-only to cost math** — `model_year_detail` is never read by `costPerMile`,
so writing it was explicitly NOT a numbers-change event and required no `gen-reference` re-run.
Verified live at 1400×1600 in headless Chrome against a production build (`vite preview --host
127.0.0.1`): drawer's new "Model years" panel renders the ranking (rank, year, $/mi, % vs best,
reliability marker, drivetrain, spec-change badge, dominant-complaint line) at a fixed hold, and
correctly shows the "needs a fixed holding period" message at `"eol"`.

**R12. Reliability re-derivation — SHIPPED 2026-07-29, launch gate PARTIALLY cleared** (investigation
2026-07-29, `docs/investigations/2026-07-29-reliability-corpus.md`). Owner released the
seed-agreement constraint ("we have moved past the original 71 framework"); the recommended method
below was implemented, **41 of 71 tiers were rewritten and reference outputs regenerated**, EVs got
their own reference group, the fetch-layer bugs were fixed, and CarComplaints/RepairPal were struck
from spec §9. Method, blast radius and residual limitations: `ASSUMPTIONS.md` §E/§H and
`docs/reliability-methodology.md`. The findings that drove it, kept for the record:
All 71 vehicles were mapped and pulled from NHTSA (999 cached requests, 0 failures). Findings,
in order of how much they matter:
- **The shipped method does not work.** Full-corpus agreement with the seed is **28/69 (41%)** —
  *worse* than answering "mid" for everything (46%) and inside the random-shuffle noise band.
  Correlation between its `rate` and the seed tier is ρ=+0.11, p=0.34.
- **The owner's powertrain hypothesis is statistically real but causally false.** η²=0.19,
  p=0.003 — but same-model pairs expose it as a sales-mix artifact: RAV4 58.3 vs RAV4 Hybrid
  2.7, Highlander 53.6 vs Highlander Hybrid 1.5, Camry 37.4 vs Camry Hybrid 1.6. No car is 36×
  more reliable than itself; the hybrid trim just sells fewer units. Body style *is* unrelated
  (η²=0.10, p=0.59), confirming the other half of the owner's intuition. `make` dominates
  everything (η² 0.50–0.64, p<0.001) — the closest proxy to "quality of work".
- **Recommended replacement: powertrain complaint *share*** (engine/powertrain/transmission
  complaints ÷ that model's total), percentile cuts on **one global distribution, no per-class
  partition**. Numerator and denominator both scale with sales, so the volume confound cancels
  exactly — the only signal tested with p<0.01 (ρ=+0.385). This **dissolves** the small-class
  problem rather than relocating it. `sport` stays an owner carve-out. Agreement 34/69 (49%),
  bootstrap CI 39–59%, but the real gain is failing safely: **1 two-tier inversion vs 11**.
- **Caveat the owner must weigh:** agreement with the seed is *not* validation. ρ(seed tier,
  `eol_maintained_miles`) = −0.838 and ρ(seed tier, `repair_cost_multiplier_by_make`) = +0.602 —
  those three fields are one Consumer-Reports-derived judgment wearing three hats. High
  agreement would only prove we reproduced CR, which is the thing the gate exists to escape.
- **Recommend striking CarComplaints and RepairPal from spec §9.** Both are commercial sites
  with restrictive ToS and no free API; §9 currently prescribes clearing a legal gate using two
  sources that create one. NHTSA alone is public-domain and takedown-safe. Recalls and
  investigations were fetched and **evaluated, then rejected** for scoring (ρ=−0.005 and +0.197;
  adding them lowers agreement) — they measure regulator action, not owner-experienced failure.
- **Two live bugs found in the fetch layer**, worth fixing regardless: NHTSA's model catalogue is
  trim-fragmented and inconsistent year-to-year (`RANGER` → `RANGER SUPER CAB`; `XC60` → `XC60
  T5/T6/T8` → `B5 AWD`), and the current single-string query therefore returns **zero complaints
  for every year of Volvo XC90**, which the method reads as a perfect car. Also
  `api.nhtsa.gov/investigations` accepts `make`/`model` filters and **silently ignores them**,
  the recalls endpoint returns HTTP 400 with a valid `Count: 0` body for empty results, and the
  NHTSA edge 403s Node's default User-Agent *and* any UA containing `(+https://…)`.
Report §7 lists file-by-file what would change. Rewriting seed tiers stays an owner review gate.

**R13. Insurance re-basing — SHIPPED 2026-07-29 without IIHS-HLDI** (launch gate; investigation
2026-07-29, `docs/investigations/2026-07-29-insurance-source.md`). Owner decision 2026-07-29:
re-base on NAIC + BLS, **drop IIHS-HLDI entirely** rather than wait on written permission, and
recover per-model and per-year variation by splitting the NAIC state premium by what each
coverage insures — liability flat, collision + comprehensive scaled by the car's own modeled
book value. Landed with per-state regionalization (three new `region.ts` columns) and a
deliberate reference regeneration; see `ASSUMPTIONS.md` §A/§E/§G for the formula, sourcing,
licence posture, measured blast radius and the OPEN items. The notes below are the original
investigation summary, kept for the HLDI revisit path:
- **IIHS-HLDI** publishes per-series *relative* loss indices standardizing out state,
  demographics, deductible and model year — exactly the vehicle effect needed, covering
  2004-06 through 2022-24. **But its site policy permits "limited noncommercial, educational and
  personal use only"** and explicitly treats anything "distributed for a period of time" (i.e. a
  live web app) as prohibited repetitive use; the report PDFs are marked "COPYRIGHTED DOCUMENT,
  DISTRIBUTION RESTRICTED." NAIC is standard all-rights-reserved. Only BLS CPI-U is public domain.
- **The units bridge is sound**: `premium(v,s) = E × [P_liab(s) + idx_coll(v)/100 × P_coll(s) +
  idx_comp(v)/100 × P_comp(s)]`, anchoring HLDI relativities to NAIC state dollars. It is an
  identity at index 100 (reproduces NAIC's published CA combined premium exactly). Main residual:
  applying a *loss* relativity to a *premium* average overstates model-to-model spread.
- **Recommended split.** *Step A, clean and unblocked*: re-base the level and add regionalization
  from NAIC + BLS. Insurance is currently the **only** major cost component with zero regional
  variation, against a real **2.15× state spread** ($926 ME → $1,994 FL) — wider than gas.
  `region.ts` has no insurance column today and three NAIC columns fit its existing shape.
  *Step B, gated*: write to `legal@iihs.org` (they have a published request process) before
  shipping HLDI relativities. *If refused*: fall back to state × body-class and say plainly that
  it is coarser — measured cost of that fallback is retaining only **25%** of per-model variance.
- **Evidence the seed numbers need replacing**: 64/71 vehicles matched to HLDI; correlation
  between the seed estimates and the re-basing is only **Pearson 0.43 / Spearman 0.47**. Hyundai
  Elantra is seeded near-cheapest but HLDI puts its collision index at 159 (the Hyundai/Kia theft
  wave); Chevy Bolt is seeded mid-pack and lands lowest in the field.
- **Blast radius is small**: insurance is 17.6% of $/mi (3rd of 10), and full re-basing moves the
  median premium −26% but reorders by a mean of **1.21 rank places** (max 7); 8 of the top 10
  stay, and only 2/71 stat tiers change. Every reference output regenerates; the field does not
  materially reorder.
- **Constants**: `insurance_multiplier_USAA` is *not* a double-count — it becomes correct for the
  first time once the base is a real average (recommend renaming, defaulting to 1.0, USAA 0.8 as
  a preset — owner call). `full_cov_threshold_usd` ($6,000) looks too low on its own terms
  (~$480/yr expected recovery vs ~$780–970/yr premium) — flagged, and recommended **not** to be
  changed in the same commit. Design trap: `fullCoverageUsdYr` means "real quote, bypass the
  multiplier", so `region.ts` must not write into it.

## P1 — Readability of what we already show

*(R4's line shipped; R8 above tracks the one substantive problem found with it.)*

**R15. The model-year panel declares a winner among statistically tied years — SHIPPED
2026-07-30.** Fixed with the existing `rankWithTiers`/`beatProb` machinery and **no new
threshold constant**: `buyPointSweep` grew an opt-in `keepRowDraws` that retains draws for each
year-band's winning point only (peak `years + 2` arrays, never one per grid point), and
`modelYearRank` annotates each year with a tie `tier`. `rank`/`bestYear`/`bestOdo`/`bestP50` are
untouched, so the 71/71 sweet-spot invariant is undisturbed. Corolla now reads *"no single
cheapest year — 13 of 18 years tied"* where it read *"0.0% cheaper than 2022"*.
**The finding matters more than the fix, and is the reason R16 exists**: tied top groups turned
out to be the norm — **67 of 71 cars at a 100k hold** (56/71 at 50k, 68/71 at 150k), mean
top-tier size **7.4 model years**, and for 6 cars *every* year ties. Read at face value that
says the model usually cannot pick a model year for you. **R16 shows a large part of that is an
artifact of broken variance reduction, not a real property of the field** — revisit these counts
after R16 lands. Ledger: `ASSUMPTIONS.md` §I.
*(Original entry, kept for the record.)* The panel ranks a car's model
years 1..N by P50 and names a "cheapest year" even when the separation is pure Monte Carlo
noise. Live examples at defaults: Toyota Corolla at a 100k hold reports *"2020 · 73k mi — 0.0%
cheaper than 2022"*, and 4Runner reports 0.1% margins at both 100k and 150k. A 0.0% margin is
not a finding.
**The app already refuses to do this elsewhere and has the machinery for it**: the Rankings
table groups cars into tie tiers via `rankWithTiers`/`beatProb` (`packages/core/src/tiers.ts`)
under the note *"Cars in the same tie tier are statistically indistinguishable — the model can't
honestly order them."* The model-year ranking should use that same machinery rather than a
strict order.
Why it isn't a trivial swap: `rankWithTiers` needs each candidate's raw `drawsCpm`
(`Float64Array`), and `buyPointSweep`'s grid keeps only `p50` per point — so the shared grid
would have to retain draws for the per-year winners, which costs memory on a 2,500-mile grid.
Cheapest honest interim fix is to suppress the "cheapest year" claim (and the `vs. next-best`
figure) when the margin falls under a stated threshold, but **a threshold is a new JUDGMENT
constant and needs a ledger row** — using the existing `beatProb` is the principled route.
Note this is a *presentation* bug: the underlying (year, mileage) sweet spot is unaffected, and
`upperOdo`'s own "accurate to about one grid step" caveat (§B) is the same class of issue.

**R17. Rank model-year GENERATIONS, not individual years.** *(Filed 2026-07-31.)*
Closest thing to what the owner originally asked for, in their own words (2026-07-30): *"allowing
perhaps a user to see that the 2020-2023 model years of the prius are all better than the next
model year in the ranking."* Ranking years individually produces 7-8-way ties (R15) that are hard
to act on; ranking a handful of generations produces fewer, better-separated groups, and is
*honest* rather than a workaround — within a generation the years genuinely are alike.
The data now exists: R2's `model_year_detail.specChangeFromPriorYear` marks where the EPA
drivetrain descriptor or VClass changes, so contiguous years sharing a drivetrain can be grouped
into eras without inventing a new source. Two cautions: that flag is a **spec-discontinuity
proxy, not a confirmed facelift** (`docs/model-year-detail-methodology.md`) so a generation
boundary drawn from it is a modelled boundary, not a manufacturer's; and it is `null` for the 10
model-years with genuine EPA gaps, which must be handled as unknown rather than "no change".
Do R16 first — it may separate individual years well enough to change how much grouping is worth.

**R18. Report the effect and its uncertainty, not just a rank.** *(Filed 2026-07-31.)*
*"2020 is $0.013/mi cheaper than 2022, but the sign flips in 40% of simulations"* carries more
than either a rank or a tie chip: it states the size of the difference AND how confident the
model is, in one line, and it degrades gracefully when years are indistinguishable (the honest
answer becomes visible rather than hidden behind a tie badge). The paired difference distribution
is already computable — R16 is what makes it *tight enough to be worth showing*, so sequence this
after it. Applies to the model-year panel first, and to the Rankings' `beatsNext` column by the
same argument. Estimates, not advice: a signed dollar delta with its flip rate is a fact.

## P2 — New surface

*(R6 shipped — see Shipped below.)*

**R19. The price curve has no year dimension — "ranking model years" is largely ranking
odometers.** *(Filed 2026-07-31, measured while diagnosing R15.)*
`price_vs_odometer_usd` is keyed by odometer alone. The ONLY year-specific input anywhere in
`costPerMile` is `model_year_reliability`'s repair multiplier (landmine ×1.40 / caution ×1.15 /
sweet-spot ×0.95), and it barely moves anything. Measured across 40 seed vehicles, spread from a
car's cheapest to priciest model year:
```
with model_year_reliability active:      53.8%
with it neutralized (odometer only):     52.7%
```
**~1 point of 53.** So model years differ from each other almost entirely because they sit at
different odometers on a smooth curve — a real-world year effect (a redesign year commanding a
market premium, a known-bad year trading at a discount) is *structurally invisible* to the model.
Until the curve knows about years, the model-year panel is the buy-point sweep wearing a
different label, and no amount of ranking work changes that.
What would fix it is year-level price observations, which runs straight into the **used-price
re-pull** already logged OPEN in `ASSUMPTIONS.md` (20 of 36 MSRP-anchored vehicles fail the
0.80–0.90 retention band; with the 7 rejected anchors that is 27 of 43 priced rows wanting fresh
listing data). Bundle the two: the same pull that fixes the low-mileage end of the curves is the
one that could carry a year dimension. Spec §9 governs — ship **fitted coefficients**, never
stored copies of a site's listing tables.
Do R16 first regardless: it is free, and it determines how much of the current year-to-year
flatness is artifact versus this genuine data ceiling.

## P3 — Deferred (previously planned)

- **Community deals layer** — submitted deals become pipeline inputs (VIN-keyed, freshness
  decay, QC: provenance, outlier checks vs the modeled curve, rate limiting). Needs Supabase
  auth, which is not connected — authorize via `/mcp` in an interactive session first.
- **Passion-vehicle preset** — per-car annual miles / horizon UI so a low-mileage enthusiast
  car is evaluated on its own terms (the calendar-age limitation bites hardest here).
- **Licensed listing feeds** (e.g. Marketcheck) for price curves — ship fitted coefficients
  only, never stored listing tables (spec §9).

## Known-deferred minors (from code review, logged not fixed)

- `role="img"` on the four chart SVGs flattens focusable descendants for some screen readers
  (`Ladder`, `Heatmap`, `Sensitivity`, `Breakdown`).
- Drawer focus-restore is a silent no-op if the triggering row unmounted while open.
- Deal Analyzer recomputes the whole field per keystroke and scores in the background before
  the tab is first opened.
- Pipeline's comma-safe NHTSA component parsing protects a 4-name allowlist; unknown
  comma-bearing category names still fragment (confined to the non-shipping report).
- Deal Analyzer shows the reliability caveat unconditionally because no per-vehicle
  `launchBlocked` flag exists on `Vehicle` yet.
- Drawer headline P50 and the cost-breakdown total differ (e.g. $0.354 vs $0.360) — the
  headline is the median of draws, the breakdown is the mean of per-component draws. Both
  are correct; no copy explains the gap. Pre-existing, surfaced during R1/R5 verification.
- `SegLabel`'s `useLayoutEffect` in `Breakdown.tsx` depends on `[text]`, not the segment
  width, so a same-car width-only change could leave a stale fit decision. Not reachable
  today (the drawer unmounts `Breakdown` on car switch and its scrim blocks the rail).
- The breakdown palette's *adjacent-pair* contrast passes comfortably, but its all-pairs
  CVD ΔE does not clear the dataviz skill's ceiling — ten fixed categorical identities
  exceed what any palette can separate. Mitigated by the always-visible list and tooltips;
  documented in `ASSUMPTIONS.md` §I.
- **`NewCarPremium.tsx`'s `newTied` conditional has no automated coverage at all, and it has
  already been wrong twice** (2026-08-16). Both errors were the same class — the newest model
  year reaching rank 1 via a *tie-break* is not the same as being separably cheapest — and both
  produced a panel that contradicted `ModelYearRanking.tsx` on the same screen: first calling
  ties solo wins (14/204 seed rows), then, after an over-correction, swallowing genuine solo
  wins (10/204). The settled rule is
  `h.newTiedWithBest && !(h.newIsBest && h.tiedTopYears.length === 1)`, measured over the seed
  field as 10 solo wins / 70 tied / 124 quantified. **It cannot be unit-tested today: `apps/web`
  has no test framework — no vitest dependency, no test directory** — so `packages/core` tests
  reach `newestYearPremium` but never the ternary that consumes it, and a third regression
  would be caught only by manual browser inspection. Adding a web test setup is a real decision
  (new dev dependency + config) and was deliberately left outside the feature's scope. Note the
  three per-task code reviews all passed this defect; only the whole-branch review caught it,
  because it is a cross-layer property no single task's diff exposes.
- `packages/core/test/modelyear.test.ts`'s "picks the highest model year, not the last array
  element" places the newest year at `points[0]`, so a naive `points[0]` implementation would
  also pass it — it rules out only the last-element bug. The order-independence property IS
  pinned, twice, by the two tests that drive the real `modelYearRank` (their fixtures emit years
  ascending, so `points[0]` is the OLDEST year while both assert the newest is returned). The
  test's name overpromises; the coverage is not actually missing. Left as-is on that basis.

## Owner decisions still open (from ASSUMPTIONS.md §E)

- ~~**The Consumer Reports gate is only PARTIALLY cleared**~~ — **CLOSED 2026-07-31 by R14.** All
  three CR-correlated fields are now independently sourced: `reliability_tier` from NHTSA (R12),
  `eol_maintained_miles` from NY DMV inspections (R14, `docs/eol-methodology.md`), and
  `repair_cost_multiplier_by_make` as a deliberate 1.0 (R14, negative result). None was derived
  from either of the others. Spec §9 clause 1 is cleared; **clause 2 (scraped listing data) is
  not** — see the used-price re-pull item, which is still gated on it.
- **What "ideal mileage" should mean** — see R8, and R10/R11 which now explain most of it.
  Largely a metric artifact plus a price-curve defect, not a definition problem.
- ~~The $/mi metric across unequal holding periods (R10) — fix the sweep's horizon only, or
  levelize the denominator and accept a +48% headline shift.~~ **Decided and shipped
  2026-07-29**: option 1 (fix the sweep's horizon; the sweep refuses to run at `"eol"` at all).
  See `ASSUMPTIONS.md` §B/§E.
- **Which stand-in for "the next car" (R21)** — the same hold repeated forever, a shared
  continuation vehicle, or an explicit transaction-friction term. The measured answer to
  "how much does a short hold really cost" spans 0.7%–11.9% across those three on one car, so
  this is the decision, not the arithmetic. The UI now refuses the cross-horizon comparison
  (R21 option 2, shipped); changing `costPerMile` is blocked on this choice.
  See `docs/investigations/2026-07-31-hold-length-replacement.md` §2.
- ~~**Reliability method replacement** (R12) — the shipped derivation has no measurable signal.~~
  **Decided and shipped 2026-07-29**: powertrain complaint share on a single global distribution,
  EVs on their own reference, tiers written and reference outputs regenerated.
- **IIHS-HLDI licence** (R13) — needs a written request to `legal@iihs.org` before HLDI-derived
  relativities can ship. Only the owner can send that. The NAIC/BLS half needs no permission.
- ~~**Strike CarComplaints and RepairPal from spec §9** (R12) — the spec currently prescribes
  clearing a legal gate using two sources that create one.~~ **Struck 2026-07-29.**
- **Electricity default vs. the region table.** R3 raised the bare default to $0.38/kWh, but
  `region.ts`'s CA entry is $0.3525/kWh, so resolving a CA ZIP now *lowers* the price below
  the default. The two were sourced independently and neither is wrong on its own terms;
  which is authoritative is an owner call. Related: the defaults are CA-flavored (gas
  $5.455, use tax 7%) while registration defaults to FL ($55, home-of-record) — pre-existing.
- **Powertrain type in the rankings row.** R4's line shape (`Year · Ideal mileage · Upper
  mileage limit`) left no slot for gas/hybrid/EV/PHEV, which had made it invisible app-wide;
  it was restored in the drawer header instead (`.drawer-etype`, `CarDrawer.tsx`). Revert
  that one span if it isn't wanted.
- **Chrysler Pacifica PHEV seed inconsistency**: `kwh_per_100mi` = 40 traces to the 2017–18
  EPA certification while `pinned_buy_year_est` = 2021 (41 from 2020 on). Disclosed in
  `ASSUMPTIONS.md` §B during R7, deliberately not reconciled.
- Real USAA premiums (engine already accepts `fullCoverageUsdYr` as a real quote).
- ~~**Reliability re-derivation = the public-launch gate.**~~ **Cleared 2026-07-29** for the 71
  seed vehicles. Still open underneath it: `eol_maintained_miles` and
  `repair_cost_multiplier_by_make` were NOT re-derived and still trace to the same CR-derived
  judgment, and pipeline-*assembled* vehicles still get a proxied tier (`ASSUMPTIONS.md` §E).
- Real calendar age as a state variable (age is still odometer-derived).
- Total-loss should truncate the holding period, not just charge annually.

## Shipped

- Steps 1–6 of the original build order (engine, reference tests, live inputs, rankings +
  ladder, Deal Analyzer, data pipeline) — master as of `972d52a`, 2026-07-28.

Session of 2026-07-28, branch `feat/r1-r7-session` (plan:
`docs/superpowers/plans/2026-07-28-opencawr-r1-r7.md`):

- **R1. Heatmap legibility** — `2ebf894`. Every feasible cell now prints its $/mi (mono,
  3 decimals, per-step text color), and the legend's endpoints are this car's own min/max
  feasible P50 with a "scale is per-car" caption. The reported legend/ramp contradiction did
  **not** reproduce — they already agreed (darkest = cheapest); the ramp was not flipped.
  Note the saturated green still reads as "good" while encoding *priciest*, which is
  probably the underlying complaint; the printed values make direction unambiguous.
- **R5. Categorical breakdown palette, larger drawer plots** — `c065359`. Ten-hue palette in
  the new `charts/breakdownColors.ts` keyed by component identity (not sort rank), in-bar
  labels that self-suppress when they don't actually fit, bar 22→34px, sensitivity charts
  300×108→380×150, `.drawer-panel` 620→840px.
- **R4. `Year · Ideal mileage · Upper mileage limit`** — `e10280e`, `ec12770`. New
  `packages/core/src/buypoint.ts` (`buyPointSweep`: argmin over a 10k-mile grid, plus a
  contiguous upward walk within 5% for the upper limit), three new `CALIBRATION` constants,
  4 unit tests. The sweep initially added ~630 ms to `handleRank`, breaking
  `DECISIONS.md`'s live re-ranking requirement; `ec12770` decoupled it onto its own
  `"buypoints"` worker kind with a 300 ms debounce, added the missing regression test for an
  inverted-feasible-range crash, and restored powertrain type in the drawer. **See R8 —
  the definition of "ideal" needs an owner decision.**
- **R3. Default electricity price 0.32 → 0.38 $/kWh** — `ddc93f0`. Reference outputs
  deliberately regenerated. Classified JUDGMENT/USER-SPECIFIC, not SOURCED: no source found
  supports 0.38 exactly (EIA EPM 5.6.a CA residential 33.25¢ May 2026; EnergySage CA $0.39).
- **R7. PHEV energy model revision** — `f181d2f`, `d103b53`. Mileage-dependent utility factor
  anchored to each car's seed UF (a **J2841-shaped approximation, not J2841**), new optional
  `electric_range_mi` EPA-verified per generation, PHEV pack degradation applied both ways
  (kWh ×1.08, range ÷1.08), `dcfc_elec_mult_phev` 1.06→1.00 (kept in the data). Reference
  outputs deliberately regenerated; only the four PHEVs' own cost fields moved.
- **R6. Assumptions tab** — `808de76`, `054218b`. Rendered live from `ASSUMPTIONS.md`,
  `docs/reliability-methodology.md` and `OpenCAWR_SPEC.md` via Vite `?raw` through an
  in-repo markdown-subset renderer (no new dependency), so it cannot drift from the ledger.
  Tabs are now `Rankings | Analyze | Assumptions`; the left rail was renamed **Inputs** and
  its component `Assumptions` → `Inputs`. Lazy-loaded, so the main chunk is unchanged at
  ~185 kB. Launch gate stated verbatim; OPEN items get their own prominent section.

Verified live at 1600×1200 in headless Chrome against a production build. Worth recording
for the next agent: **`vite preview` binds IPv6 `[::1]` only while Chrome resolves
`localhost` to IPv4**, so browser automation always got an error page — pass
`--host 127.0.0.1`. (`vite dev` still hangs in sandboxed sessions.)

- **New-car premium panel (drawer)** — 2026-08-16. `packages/core/src/modelyear.ts`'s new
  `newestYearPremium` (a pure view over an existing `ModelYearRankResult` — prices nothing,
  calls no engine function) plus `apps/web/src/charts/NewCarPremium.tsx`, rendered between
  the survey heatmap and the model-year ranking. States what the newest model year costs
  over the car's own sweet spot at each fixed hold, reusing the ranking `handleModelYearRank`
  already computes per hold — **zero additional `costPerMile` calls, no new worker request
  kind, no new CSS**. A 4-column table (`If you hold | Cheapest year · mileage · $/mi |
  Newest year · mileage · $/mi | Cost of buying new`) — shipped first at 6 columns, then
  narrowed to 4 (folding each `$/mi` into its own year·mileage cell) in a fix round
  (`1759214`) after browser verification at 390×844 found the extra two columns pushed
  "Cost of buying new" — the panel's whole point — entirely off-screen with no scroll
  affordance; the owner's ruling was to cut columns rather than add CSS. Honours the
  existing refusals rather than adding thresholds: "tied with the cheapest year" where
  R15's tie tiers can't separate the newest year from the sweet spot, "no single cheapest
  year" in the cheapest-year cell where R15's tiers can't separate a single winner among
  the cheapest years either (matching `ByHoldSummary` in `ModelYearRanking.tsx`
  word-for-word — also added in the same fix round, after verification found this panel
  naming a year its sibling panel refused to), the degenerate refusal where every year
  clamps to one odometer, and never computed at `"eol"` (R10). 6 new core tests;
  `npm test -w @opencawr/core` 139/139, `reference.test.ts` 74/74 byte-identical. Reads
  `data.vehicles` and the selected car's own grid at request time, so it needs no
  follow-up when the catalogue grows past its current 71 rows. Ledger: `ASSUMPTIONS.md` §I.
