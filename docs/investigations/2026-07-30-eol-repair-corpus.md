# R14 — `eol_maintained_miles` and `repair_cost_multiplier_by_make`

Written 2026-07-30. Method spec lives in `docs/eol-methodology.md`; this file records what the
full-corpus runs actually produced and why one half shipped and the other did not.

**Outcome in one line:** `repair_cost_multiplier_by_make` is re-derived and shipped (as a negative
result — 1.0 everywhere). `eol_maintained_miles` is **NOT written**; the derivation is built,
validated and committed, but its corpus output is not shippable and the reason is a real finding
rather than a bug.

---

## Part 1 — `repair_cost_multiplier_by_make`: shipped, 1.0 everywhere

Every candidate source is closed: RepairPal and CarComplaints are struck from spec §9 by our own R12
decision, IIHS-HLDI is permission-gated and was declined in R13, NHTSA carries no cost data, and BLS
CPI `CUUR0000SETD` (457.313, Jun 2026) and PPI `WPU5521` (194.306p, Jun 2026) were confirmed
directly on BLS's own series pages to have no make or brand dimension in existence.

Shipped in `a397793`. 32 of 71 rows changed value; the 2 `sport` rows keep 1.3 as an owner
carve-out. Blast radius was small: $/mi P50 mean absolute shift **$0.0007 (0.13%)**, largest single
**−$0.0059** (Volvo XC90), rank movement mean **0.11** with **64/71 unmoved**, top-10 membership
unchanged. `stat_tier` moved for 31/71, which overstates it — the field went 8 tiers → 9 because a
boundary near the top split, so nearly every vehicle below it is renumbered without changing
neighbours.

Cost in accuracy, stated plainly: the model can no longer express that a Volvo or Mini costs more
per repair event than a Toyota. That is a real effect we cannot source publicly.

---

## Part 2 — `eol_maintained_miles`: derivation built and validated, output not shipped

### What was built

Full NY DMV survival-analysis pipeline, committed across `8409272`, `8e273e4`, `826c22b`,
`b59c385`, `1207925`, `3eead4f`, `2151fc4`. Source licence verified by reading the actual OPEN-NY
Terms of Use PDF: no attribution, share-alike, pre-approval or commercial restriction.

### The fleet half validates well

| quantity | value |
|---|---|
| leakage ceiling `L` | 0.9293 |
| fleet observed median age | 16.90 yr (Weibull R² **0.9953**) |
| fleet mechanical median age | 18.71 yr (R² **0.9664**) |
| derived `maintainedBonus` | **1.1072** (legacy un-derived assumption: 1.30) |

The observed fleet median sits in the real-world consensus band for US passenger cars (~17 yr),
which was not tuned toward — it fell out of the leakage correction. That is the main external
evidence the correction is sound.

Corpus coverage after the ratio-based rework: **nameplate 45, make 21, fleet 3** of 69 (the 2
Porsche `sport` rows are not derivable at all — NY DMV lumps every 911 variant into a bare `911`).

### Three defects found and fixed along the way, each by measurement

1. **Leakage ceiling contradicted crash removal.** Defining `L` as raw max retention asserts zero
   attrition at the best young age, while crash removal simultaneously removes a 1.5%/yr hazard
   saying ~6% are already gone by age 4. Consequence: `S_mechanical` capped at 1.0 for ages 4–12,
   leaving **4 usable points** against a 5-point minimum, so the fleet context failed to resolve.
   Fixed by dividing `L` by one 2-year step of crash-only survival → 6 usable points.
2. **The per-model path was biased against durable cars.** Building an absolute survival curve per
   model pinned any better-than-fleet model to `S=1.0` at young ages, and the fit then *discarded*
   those points — so the more durable a model, the likelier it fell to a coarse constant. Toyota
   Corolla, the highest-retention model measured anywhere here, fell to the fleet constant and
   landed on the identical number as Fiat 500. 24 of 69 collapsed onto one of two constants. Fixed
   by ratio-based hazard scaling.
3. **Fleet baseline didn't match the anchor.** The context pooled the 69 seed nameplates while the
   NHTSA anchor describes the whole US light-vehicle fleet. Fixing it moved `L` 0.9144 → 0.9293,
   mechanical R² 0.9289 → 0.9664, and `maintainedBonus` 1.0366 → 1.1072.

### Why the output is not shipped

Applying the derived values to all 69 rows and re-running the engine (1,100 draws, seed 42):

- $/mi P50 mean absolute shift **10.9%**, largest **+53.6%** (Toyota Camry Hybrid)
- rank movement mean **9.2** places, max **37**, only **2/71** unmoved
- `stat_tier` changed for **51/71**

and the resulting top ten:

```
Nissan Leaf | Fiat 500 | Chevy Bolt EV | Chevy Volt | Buick Encore |
Kia K4 | Fiat 500X | Toyota Prius | Kia Niro | Ford Ranger (old compact)
```

**Fiat 500 ranks #2 and Fiat 500X #7** — the same outcome that disqualified the NHTSA-alone
approach earlier in this work, and against a car ASSUMPTIONS.md §D flags `bad` for every model year.
Meanwhile the field's most durable vehicles (Camry, Tacoma, 4Runner, Sequoia) fall 27–36%.

### The finding underneath it, which is real and not an artifact

The measured per-model longevity spread is **1.156×** (min Kia K4 0.930, max Toyota Sequoia 1.075)
against the seed's judgment-based **2.139×** (140,400 Leaf → 300,300 Sequoia).

This compression was tested for estimator bias and is not one. The suspicion was that averaging the
per-age hazard ratio weighted by VIN count over-weights young ages, where nothing has died and every
model's ratio is ≈1. Re-estimating with the ratio of *cumulative* hazards over the window — which
weights by hazard magnitude, so old ages dominate — gives Toyota Corolla `c = 0.836` versus `0.835`
for the VIN-weighted estimator: identical to three decimals, both a **1.044** lifetime ratio. The
narrow spread is what the data says.

Two things follow, and they pull against each other:

- **Genuine result:** mainstream vehicles really do cluster tightly in survival age (most between 17
  and 20 years). The seed's 2.14× spread was Consumer Reports judgment, not measurement.
- **Genuine problem:** at that spread, a car with *no* measurement falls back to the fleet default
  and is thereby asserted to be average. For a cheap car that is known-bad, average is generous
  enough to promote it up the $/mi ranking. Fiat 500 has almost no NY history (4 usable points) and
  gets exactly this treatment; its derived value *rises* above its seed.

So the ranking failure is not the compression alone — it is the compression combined with a
fallback that flatters unmeasured cheap cars.

### Recommendation

Do **not** write these values wholesale. The measured compression is a real and reportable finding,
but shipping it would trade a Consumer-Reports-derived judgment for a ranking the field would
reject on sight — and spec §9 exists to remove a legal dependency, not to buy it with an
indefensible product outcome.

Options for whoever picks this up, in rough order of preference:

1. **Ship the derived value only where it is actually measured** (`basis: "nameplate"`, 45 of 69)
   and leave the rest at seed, flagged. Avoids asserting "average" for cars we never measured.
   Needs a decision on the resulting mixed provenance.
2. **Keep the seed's spread and re-centre only the level**, using the derived `maintainedBonus`
   (1.1072) against the legacy 1.30 — a smaller, defensible change that removes the un-derived
   bonus without flattening the field.
3. Ship nothing and record the negative result; `eol_maintained_miles` stays the last open item on
   the spec §9 gate.

### Known limitations, whichever option is taken

- **Single-state sample.** NY only. NY drives less than the national average (MY2013 Camry median
  odometer 124,671 at age 12, ≈10.4k/yr vs the 13k default), which is why NY supplies only the
  relative spread and NHTSA the absolute level.
- **Commercial-fleet contamination, measured.** Toyota Camry Hybrid derives to 150,801 — below
  plain Camry — and the cause is visible in the raw counts: MY2015 shows 2,185 VINs against ~1,000
  at neighbouring ages, paired with the worst retention in its series (0.707 vs Camry's 0.832).
  That signature is NYC livery/taxi purchasing, driven hard and retired early. Real signal about NY
  Camry Hybrids, not about Camry Hybrids nationally. Hybrid sedans are the exposed class.
- **EVs mostly land on the make basis**, which measures that manufacturer's *gas-car* durability. An
  EV has no engine or transmission but does have a battery. R12 gave EVs their own reference group;
  there is not enough EV history here to do the same, and no EV adjustment factor was invented.
- **The leakage correction assumes the leak is model-independent.** That is the method's central
  assumption. It would break if some classes leave the state at systematically different rates.
- The 2 Porsche `sport` rows are not derivable and remain an owner carve-out.

Estimates, not advice.
