# Full-corpus reliability re-derivation — investigation report

**Task**: R1 launch gate (spec §9). Re-derive reliability tiers for all 71 seed vehicles from
public, zero-takedown-risk data. **Analysis only** — `opencawr_data.json`, `packages/core` and
`packages/pipeline` were not modified and nothing was committed.

**Date**: 2026-07-29 · **Scratch**: `.tmpreliability/` (queries, aliases, pull, detail, inv, analyze.py; raw
output in `.tmpreliability/data/full-output.txt`) · **Cache**: `packages/pipeline/.cache/` (999 entries)

---

## 0. Headline findings, in order of how much they matter

1. **The metric the current methodology is built on does not measure reliability.**
   `rate` (complaints ÷ years-on-road, median across model years) correlates with the seed
   `reliability_tier` at **Spearman ρ = +0.11, p = 0.34** across all 69 non-sport vehicles — i.e. not
   at all. It is a **sales-volume ranking**. Under the current method the full corpus agrees with the
   seed **28/69 (41 %)**, which is *worse than answering `mid` for every vehicle* (32/69, 46 %) and
   inside the noise band of randomly shuffling the seed labels (mean 25.1, 95th pct 31).

2. **The owner's hypothesis is half right, and right for the wrong reason.** `etype` does explain
   more variance in complaint rate than `body` does (η² 0.19, p = 0.003 vs η² 0.10, p = 0.59) — but
   that entire effect is a sales-mix artifact, provable from same-make/same-model pairs. What
   actually dominates every metric is **`make`** (η² 0.50–0.64, p < 0.001), which is the closest
   available stand-in for the owner's "quality of work".

3. **One volume-invariant signal survives: the *share* of a model's complaints that are powertrain
   complaints** (ρ = +0.385, p = 0.0013). Every count-based signal — complaints, recalls,
   investigations — fails (ρ = +0.04, −0.005, +0.20). Recommended method: **global percentile cuts on
   powertrain complaint share, no per-class partition at all.** Full-corpus agreement
   **34/69 (49 %)**, and — the important part — it makes **1 two-tier inversion instead of the current
   method's 11**.

4. **Even the best method is weak, and I am not going to dress it up.** Within the 55 gas vehicles
   (where powertrain type is held constant) it scores 23/55 (42 %) against a chance baseline of 20.9
   (95th pct 26). Bootstrap 90 % CI on the headline 49 % is **39 %–59 %**, which contains the
   all-`mid` baseline. **No NHTSA-only signal in this corpus reproduces the seed tiers with
   confidence.** What it *can* do defensibly is order vehicles coarsely and avoid catastrophic
   inversions.

5. **"Agreement with the seed tier" is not validation.** The seed tier is the Consumer-Reports-derived
   judgment we are trying to remove, and it is internally near-deterministic: ρ(seed tier,
   `eol_maintained_miles`) = **−0.838** and ρ(seed tier, `repair_cost_multiplier_by_make`) = **+0.602**.
   Those two fields are seed-internal restatements of the same judgment, so they cannot be used as
   independent "complexity" predictors without circularity. High agreement would mean *"we
   successfully reproduced CR"*, which is the opposite of the launch-gate goal.

---

## 1. The query set — mapping 71 seed vehicles to NHTSA

Built in `.tmpreliability/queries.ts` (make/model) + `.tmpreliability/aliases.ts` (per-year matchers).
All 71 vehicles mapped; **none dropped**.

### 1.1 Year window

`yearsFor(v)`: at most **6 model years, ending no later than MY2022** (so every queried model year
has ≥ 4 years on road), intersected with `[first_year, last_year]`. Models that start after 2022
(Kia K4, Mazda CX-90) fall back to their own short span. Result: **383 vehicle-model-years**.

### 1.2 The big mapping finding: NHTSA's model catalogue is trim-fragmented AND year-inconsistent

This is the single largest fidelity defect in the current pipeline, and it is invisible unless you
check. `api.nhtsa.gov/products/vehicle/models` (NHTSA's own list of queryable model strings) changes
the string for the *same physical car* from year to year:

| seed vehicle | NHTSA model string, by model year |
|---|---|
| Ford Ranger (2019+) | `RANGER` (2019–20) → `RANGER SUPER CAB` + `RANGER SUPER CREW` (2021–22) |
| Volvo XC60 | `XC60` (2017) → `XC60 T5/T6/T8` (2018–21) → `XC60 B5 AWD/B5 FWD/B6 AWD` (2022) |
| Volvo XC90 | never a bare `XC90` in the window — only `T5/T6/T8`, then `T5 AWD/T5 FWD/T6 AWD` |
| Chevy Bolt EV | `BOLT` (2017–18) → `BOLT EV` (2019+) |
| Chrysler Pacifica PHEV | `PACIFICA PHEV` (2017–19) → `PACIFICA HYBRID` (2020+) |
| Chevy Suburban | `SUBURBAN 1500` (2016–21) → `SUBURBAN` (2021+) |
| Mini Cooper | `COOPER`/`COOPER S`/`HARDTOP` … and **no `COOPER` at all in MY2021** (`HARDTOP 2DR`/`4DR`) |
| Toyota Sienna | `SIENNA` (≤2020) → `SIENNA HYBRID` + a junk `REDUNDANT SIENNA` row (2021+) |
| Kia Niro | `NIRO HYBRID` (2017–20) → pooled `NIRO` (2021+) |
| VW GTI | `GOLF GTI` and `GTI` **both** listed in 2018–19 |

**Consequence for the existing code**: `packages/pipeline/src/sources/nhtsa.ts` takes one `model`
string and applies it to every year. For `Volvo XC90` that returns **zero complaints for every year in
the window** — which the current derivation would read as a perfectly reliable car, not as a failed
query. The fix used here: resolve the per-year catalogue, apply an include/exclude predicate, query
every matching string, and **de-duplicate complaints by `odiNumber`** across strings.

### 1.3 Vehicles whose mapping is genuinely ambiguous (owner's call, not mine)

| vehicle | ambiguity | what I chose |
|---|---|---|
| `Ford Ranger (old compact)` / `Ford Ranger (2019+ midsize)` | identical NHTSA model token; only the year window separates them | 2006–2011 vs 2019–2022. **NHTSA has no Ford models at all for MY2018** (catalogue gap) |
| `Toyota Sienna (V6)` / `Toyota Sienna Hybrid` | identical string `SIENNA` pre-2021 | MY≤2020 = V6, MY2021+ = `SIENNA HYBRID`. Safe: MY2021+ Sienna is hybrid-only |
| `Porsche 996 Carrera` / `Porsche 996 Turbo` | NHTSA strings are `911`, `911 CARRERA`, `911 CARRERA/CARRERA CABRIO`, `911 GT2/TARGA/TURBO`… and vary yearly | Carrera = Carrera-prefixed strings; Turbo = `911 TURBO`/`911 GT*`. The **bare `911`** string (MY1999–2001) is assigned to *neither* to avoid double-counting. Irrelevant to tiers — `sport` is never derived |
| `Chrysler Pacifica PHEV` | mid-life string rename | both `PACIFICA PHEV` and `PACIFICA HYBRID` matched |
| `Kia Niro (hybrid)` | NHTSA pools HEV/PHEV/BEV into a bare `NIRO` from MY2021 | bare `NIRO` included; MY2021–22 therefore folds some PHEV/EV complaints into the hybrid row |
| `Hyundai Santa Fe` | MY2017–18 `SANTA FE` is the 3-row (later "Santa Fe XL"); the 2-row of those years is `SANTA FE SPORT` | `SANTA FE` only. The seed row therefore spans two physically different vehicles |
| `Toyota Corolla` | `COROLLA HATCHBACK` / `COROLLA CROSS` / `COROLLA IM` / `COROLLA HYBRID` listed separately | exact `COROLLA` only |
| `Volvo XC60` / `XC90` | T8/Recharge/Polestar strings are the PHEV | excluded, to match the seed rows' `etype: gas` |
| `Kia K4` | MY2025+, essentially no history (49 complaints) | queried anyway; seed row is already `provenance: proxied` |
| `Mazda CX-90` | MY2024+; NHTSA writes it `CX-90-MHEV`, `CX-90 MHEV`, `CX-90` | gas/MHEV strings only, PHEV excluded |

**Model-years where NHTSA returned nothing at all** (3 of 383): Fiat 500 MY2019, Fiat 500X MY2021,
Volvo V90 Cross Country MY2021 — NHTSA simply does not list those model strings for those years.
Handled as missing years, not as zeros. **No vehicle ended up with zero complaints overall.**

---

## 2. Sources: what was used, what was rejected, and what each actually proxies

### 2.1 In scope (US-government public domain, free, keyless — zero takedown risk)

| source | endpoint | what it *actually* measures |
|---|---|---|
| Complaints | `api.nhtsa.gov/complaints/complaintsByVehicle` | **owner-initiated reports.** Scales with units sold × owner propensity to file. Not a defect rate |
| Recalls | `api.nhtsa.gov/recalls/recallsByVehicle` | **manufacturer- or NHTSA-initiated safety campaigns.** A regulatory event, not an owner-experienced failure; a recall is arguably evidence a defect is now *fixed at the maker's expense* |
| Investigations | ODI flat file `static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip` | **regulator attention.** Rarest signal (0–15 per model); heavily biased to high-volume models and to safety-of-life issues, not wear-out |

### 2.2 Explicitly out of scope

- **Consumer Reports** — permanently off the table (spec §9). Nothing here derives from it.
- **CarComplaints.com / RepairPal** — although spec §9 names them, **both are commercial sites with
  restrictive ToS and no free API.** Obtaining their aggregates means scraping a compilation, which is
  precisely the "substantial extract of a site's compilation" exposure §9 §2 was written to avoid.
  **Recommend striking them from §9's re-derivation list**, since as written the spec instructs a
  launch-gate remedy that itself creates a launch-gate risk.
- `api.nhtsa.gov/investigations/investigationsByVehicle` → **403 "Missing Authentication Token"** (no
  such route). `api.nhtsa.gov/investigations?make=…&model=…` returns 200 but **silently ignores the
  filters** and pages the entire 4,171-row corpus — a trap; do not use it. The ODI flat file is the
  only working public route, and its `MODEL` column uses **base names** (`VOLVO`/`XC60`), unlike the
  complaints API's trim strings.

### 2.3 Do recalls or investigations improve the signal? **No. Quantified:**

| signal | volume-invariant? | ρ vs seed tier | p |
|---|---|---:|---:|
| `rate` (current method) | no | **+0.114** | 0.35 |
| total complaints | no | +0.037 | 0.76 |
| **recalls / model-year** | no | **−0.005** | 0.97 |
| **investigations / model-year** | no | **+0.197** | 0.10 |
| wear-category complaints / model-year | no | +0.114 | 0.35 |
| **powertrain complaint share** | **YES** | **+0.385** | **0.0013** |
| wear+powertrain share | YES | +0.378 | 0.0014 |
| engine-only share | YES | +0.328 | 0.0062 |
| electrical share | YES | +0.164 | 0.18 |
| ADAS/airbag share | YES | −0.233 | 0.052 |
| crash-flagged share | YES | −0.228 | 0.060 |
| fire-flagged share | YES | +0.038 | 0.76 |
| injury/death share | YES | −0.260 | 0.033 |

Combining them makes things **worse**, not better: rank(powertrain share) + rank(investigations/MY)
scores 30/69; + rank(recalls/MY) scores 30/69 — both below powertrain share alone (34/69). Recalls
and investigations were fetched, evaluated, and are **recommended for exclusion from the tier score**.
They remain useful as *disclosure* (a per-model "N open investigations" badge), just not as a tier input.

**Why they fail is not mysterious — it is the volume confound, measured directly:**
ρ(total complaints, total recalls) = **+0.697**; ρ(total complaints, investigations) = **+0.549**.
All three scale together because all three scale with units sold. None of the three scales with quality.

---

## 3. Data pull

Every request went through the pipeline's own `fetchCached` (on-disk cache, `packages/pipeline/.cache/`),
`OPENCAWR_PIPELINE_OFFLINE` was **not** set, concurrency held at 2.

| | count |
|---|---:|
| `complaintsByVehicle` (model-year × NHTSA string) | 439 |
| `recallsByVehicle` | 439 |
| `products/vehicle/models` (catalogue) | 121 |
| **unique successful URLs cached** | **999** |
| ODI investigations flat file | 1 download (4.3 MB zip → 390 MB, 154,208 rows) |
| **failures in the final clean run** | **0** |

### 3.1 Two `fetchCached` defects found while doing this — both will bite the production pipeline

1. **NHTSA's recalls endpoint answers HTTP `400` with a *valid* body** when a model-year simply has
   no recalls:
   `{"Count":0,"Message":"Results returned successfully","results":[]}`.
   `fetchCached`'s `if (!res.ok) throw` converts that real answer into a hard failure. **130 of 439
   recall queries (30 %) hit this.** Any recall support added to `sources/nhtsa.ts` must special-case it.

2. **NHTSA's edge (Akamai) blocks some User-Agent strings with a `403` HTML "Access Denied" page.**
   `fetchCached` sends **no** `User-Agent` at all, and Node/undici's default is among those blocked —
   which is why `Ford Escape` MY2017 (a 2.6 MB, 2,639-complaint response) failed repeatedly. A plain
   token UA (`opencawr-pipeline/0.1`) fixes it; a UA containing `(+https://…)` is *also* blocked, so
   the conventional bot-contact-URL form must be avoided. Recommend `fetchCached` set a default UA.

---

## 4. Testing the owner's hypothesis

> *"powertrain seems like a primary driver of reliability while body style seems unrelated.
> Ultimately reliability is tied to durability, complexity, and quality of work."*

### 4.1 Variance explained (η², one-way ANOVA on log1p; permutation p, 20,000 shuffles, n = 69)

| factor | `rate` | powertrain share | recalls/MY | investigations/MY |
|---|---|---|---|---|
| `etype` (powertrain) | 0.188 **[p 0.003]** | 0.143 **[p 0.014]** | 0.193 **[p 0.003]** | 0.187 **[p 0.012]** |
| `body` | 0.101 [p 0.587] | 0.254 **[p 0.011]** | 0.150 [p 0.258] | 0.253 [p 0.055] |
| **`make`** | **0.621 [p 0.000]** | **0.498 [p 0.001]** | **0.550 [p 0.000]** | **0.636 [p 0.000]** |
| AWD (from `body`) | 0.006 [p 0.524] | 0.012 [p 0.365] | 0.002 [p 0.749] | 0.003 [p 0.678] |
| has `battery` block | 0.063 [p 0.037] | 0.095 [p 0.010] | 0.017 [p 0.279] | 0.070 [p 0.026] |

**Verdict: the owner's intuition partly holds, and is contradicted in one important way.**

- **Body style unrelated — CONFIRMED for complaint rate.** η² = 0.10 across 9 groups, p = 0.59; with
  9 unbalanced groups you would expect roughly that much "explained" variance from noise alone.
- **Powertrain matters — CONFIRMED as a statistical fact (p = 0.003), REFUTED as a causal claim.** See §4.2.
- **Body style is NOT unrelated to complaint *mix*** (η² = 0.254, p = 0.011 on powertrain share) —
  but that is compositional, not causal: `SUV` (median 50 % powertrain share) is mostly compact
  crossovers from Hyundai/Kia/Ford, while `SUV AWD` (26 %) is mostly Toyota/Honda/Subaru three-rows.
  It is `make` leaking through `body`, not a body effect.
- **AWD is flat-out irrelevant** on every metric (η² ≤ 0.012, all p > 0.36). Worth knowing, since
  `body` currently encodes it.
- **The dominant factor is `make`** — 0.50–0.64 of variance, p < 0.001 on all four metrics. Of the
  owner's three named drivers ("durability, complexity, quality of work"), the data says **quality of
  work**, at the manufacturer level, is the one that shows up.

### 4.2 The natural experiment that kills the powertrain result

Same make, same model, same body, **different powertrain only**:

| gas variant | `rate` | pt share | electrified variant | `rate` | pt share | rate ratio |
|---|---:|---:|---|---:|---:|---:|
| Toyota RAV4 | 58.3 | 26 % | Toyota RAV4 Hybrid | 2.7 | 14 % | **22.0×** |
| Toyota RAV4 | 58.3 | 26 % | Toyota RAV4 Prime | 12.4 | 10 % | 4.7× |
| Toyota Highlander | 53.6 | 42 % | Toyota Highlander Hybrid | 1.5 | 32 % | **35.7×** |
| Toyota Camry | 37.4 | 33 % | Toyota Camry Hybrid | 1.6 | 10 % | **23.6×** |
| Toyota Sienna (V6) | 8.1 | 20 % | Toyota Sienna Hybrid | 5.1 | 10 % | 1.6× |
| Chrysler Pacifica | 59.9 | 55 % | Chrysler Pacifica PHEV | 9.2 | 47 % | 6.5× |

A Highlander Hybrid is not 36× more reliable than a Highlander. **The hybrid trim is a minority of
that model's units sold, so it generates proportionally fewer complaints.** That is the entire `etype`
effect on `rate`. Powertrain share moves in the same direction but only ~1.2–3×, which is a plausible
magnitude for a real mechanical difference (a hybrid's e-CVT and Atkinson engine genuinely generate
fewer transmission/engine complaints than a conventional torque-converter automatic).

**So: powertrain is a real but modest signal on complaint *mix*, and a pure artifact on complaint *count*.**

### 4.3 Complexity proxies — does anything beat both?

- `has battery` — η² 0.06–0.10, significant but small, and confounded with `etype` (it *is* `etype`).
- AWD — nothing (§4.1).
- Model span, `seats` — nothing usable.
- `repair_cost_multiplier_by_make` (ρ +0.602 vs seed tier) and `eol_maintained_miles` (ρ **−0.838**)
  correlate strongly with the seed tier — **but both are seed-internal fields set from the same CR-derived
  judgment as `reliability_tier` itself.** Using them to predict the tier is circular and cannot appear
  in a launch-gate derivation. Their strength does prove something useful, though: **the seed's own
  reliability fields are effectively one variable wearing three hats**, so the corpus contains far less
  independent evidence about reliability than 71 rows suggests.

**Nothing beats `make`.** The honest recommendation is that `make` is where the reliability signal
lives, and a defensible future method should model a make-level effect explicitly from public data —
but *not* by normalising it away (see §5.3).

### 4.4 A data-model smell worth fixing regardless

`body` **conflates powertrain with body shape**. Its 10 values are `SUV AWD` (28), `Car` (14), `SUV` (11),
`Van` (5), `Truck` (4), `EV` (3), `PHEV` (2), `Sport` (2), `EV SUV` (1), `PHEV SUV AWD` (1) — so `EV`,
`PHEV`, `EV SUV` and `PHEV SUV AWD` are mixtures of three orthogonal facts (shape, drive layout,
powertrain), all of which are already available separately (`etype` exists; AWD could be its own flag).
A Nissan Leaf is a hatchback, not a body style called "EV". This is why `body` has singleton classes at
all, and it makes `body` unusable as a normalisation key. **Recommend splitting `body` into
`shape` + `drive` and letting `etype` carry powertrain** — a schema change, out of scope here, logged as a finding.

---

## 5. Recommended normalization

### 5.1 What was tested

All cut points below are **marginal-matched** (low ≤ p32, high > p78 — the seed's own 22/32/15
tier mix) so no method is penalised for producing the wrong *proportion* of tiers.

| method | agree | rate | 2-tier inversions |
|---|---:|---:|---:|
| **A. `rate`, body-normalised, quartile cuts — CURRENT METHOD** | 28/69 | 41 % | **11** |
| A′. `rate`, body-normalised, marginal-matched cuts | 31/69 | 45 % | 10 |
| B. `rate`, **etype**-normalised (owner's suggestion) | 29/69 | 42 % | 10 |
| C. `rate`, **no** normalisation | 34/69 | 49 % | 11 |
| **D. powertrain share, NO normalisation — RECOMMENDED** | **34/69** | **49 %** | **1** |
| E. powertrain share, body-normalised | 34/69 | 49 % | 3 |
| F. powertrain share, etype-normalised | 29/69 | 42 % | 2 |
| G. powertrain share, make-normalised | 32/69 | 46 % | 11 |
| H. wear+powertrain share, no normalisation | 36/69 | 52 % | 3 |
| I. rank(pt share) + rank(investigations/MY) | 30/69 | 43 % | 3 |
| J. rank(pt share) + rank(recalls/MY) | 30/69 | 43 % | 5 |
| — all-`mid` baseline | 32/69 | 46 % | 0 |
| — random permutation of seed labels | 25.1/69 | 36 % | — |

Also tested and **rejected**:

- **Absolute thresholds calibrated once** (brief's option 3): best variant 24/69 (35 %) — clearly worse
  than percentile cuts, because the share distribution is not stable enough to hard-code.
- **Empirical-Bayes shrinkage** toward the corpus-wide 34.8 % powertrain share, to damp thin
  denominators (Volvo V90 CC has only 20 complaints): ρ **falls monotonically** with the shrinkage
  constant (k=0 → +0.370, k=100 → +0.339, k=400 → +0.319) and agreement drops 32 → 25. **Do not shrink.**
  The thin-denominator vehicles are instead flagged for review (§6.4).
- **Pooling powertrain into complexity bands** (brief's option 2): F (etype-normalised) is the
  strongest form of this and it *loses* 5 vehicles of agreement. Pooling into fewer bands cannot beat
  it, because the underlying effect it would encode is the sales-mix artifact of §4.2.

### 5.2 The recommendation

> **Score** = powertrain complaint share = (complaints whose NHTSA top-level `components` category
> starts with `ENGINE`, `POWER TRAIN`, or `TRANSMISSION`) ÷ (all that model's complaints), pooled
> across the queried model years, de-duplicated by `odiNumber`.
>
> **Tiers** = percentile cuts of that score over **one single global distribution across the whole
> corpus** — *no per-class partition of any kind*. `low ≤ p32` (0.2371), `high > p78` (0.5599) on the
> current corpus.
>
> **`sport` is still never derived** — the 2 Porsches are excluded from both the score distribution and
> the cut-point computation, exactly as today. This preserves the owner-judgment carve-out.

Rationale, in the order the brief asked for it:

1. **It solves the small-class problem by dissolving it.** There are no classes. The 1-member `EV SUV`
   and `PHEV SUV AWD` groups, the 2-member `PHEV` and `Sport` groups, and the 4-member `ev`/`phev`
   `etype` groups all stop mattering, along with the cross-contamination effect documented in
   `docs/reliability-methodology.md` §3 (singleton `bodyClassIndex ≡ 1.0` shifting everyone else's cuts).
2. **It is volume-invariant by construction.** Numerator and denominator both scale with units sold,
   so the sales confound that destroys `rate` cancels exactly. That is *why* it is the only signal with
   p < 0.01.
3. **It is the version of the owner's intuition the data supports.** The owner said powertrain drives
   reliability; the data says powertrain *counts* are a volume artifact but powertrain *share* is real.
   The recommendation keeps the owner's mechanism and drops the artifact.
4. **It fails safely.** 1 two-tier inversion vs the current method's 11. For a tool that ranks cars by
   lifetime cost, calling a `high` car `low` is the expensive error; this method almost never does it.
5. **Group effects, if wanted, enter as an explicit adjustment — not a partition** (brief's option 1).
   The measured `etype` medians of powertrain share are gas 33 %, PHEV 38 %, hybrid 16 %, EV 12 %. A
   single documented multiplicative factor per `etype` would be auditable. **I do not recommend applying
   one yet**: it scores worse (F, 29/69), and with n = 4 EVs and n = 4 PHEVs the factor cannot be
   estimated to better than a factor of two. Record the medians; revisit at a larger corpus.

### 5.3 Do **not** normalise by `make`

Tempting, since `make` explains the most variance — but `make` *is* the signal (§4.1/§4.3). Method G
confirms it empirically: make-normalisation drops agreement to 32/69 and restores **11** two-tier
inversions, because it deliberately erases the one thing that discriminates.

### 5.4 The structural caveat that must ship with this method

**EVs and hybrids have structurally deflated powertrain share** — an EV has no engine and no
transmission, so it *cannot* generate those complaint categories. Median powertrain share: gas 33 %,
PHEV 38 %, hybrid 16 %, **EV 12 %**. Tesla Model 3 scores 3.0 % and derives `low` while carrying 15 open
investigations and 97 recall campaigns.

I tested the obvious fix — folding NHTSA's `FUEL/PROPULSION SYSTEM` and `HYBRID PROPULSION SYSTEM`
categories in, which are the EV/hybrid analogues of "engine":

| definition | gas | hybrid | PHEV | EV | ρ | agree |
|---|---:|---:|---:|---:|---:|---:|
| `ENGINE`/`POWER TRAIN`/`TRANSMISSION` | 33 % | 16 % | 38 % | 12 % | +0.385 | 34/69 |
| + `FUEL/PROPULSION` + `HYBRID PROPULSION` | 42 % | 24 % | 59 % | 23 % | +0.328 | 26/69 |
| + `ELECTRICAL SYSTEM` too | 64 % | 46 % | 98 % | 73 % | +0.392 | 30/69 |

It narrows the EV gap but costs agreement. **Recommendation: keep the narrow definition and mark all
4 EVs' derived tiers `provisional`.** With n = 4 there is no honest way to calibrate them; battery
risk is already modelled separately in the `battery` block, which is where EV reliability actually lives
for this engine.

---

## 6. Full-corpus agreement table

Method D (§5.2). Sorted worst → best powertrain share. `move` is derived vs seed.
Cuts: `low ≤ 0.2371`, `high > 0.5599`.

| # | vehicle | make | body | etype | MY window | complaints | powertrain share | derived | seed | move |
|---:|---|---|---|---|---|---:|---:|---|---|---|
| 1 | Kia Soul | kia | SUV | gas | 2017–2022 | 1290 | 84.3% | high | mid | **worse +1** |
| 2 | Hyundai Kona | hyundai | SUV | gas | 2018–2022 | 618 | 75.1% | high | mid | **worse +1** |
| 3 | Ford Escape | ford | SUV | gas | 2017–2022 | 6992 | 73.5% | high | high | = |
| 4 | Hyundai Tucson | hyundai | SUV | gas | 2017–2022 | 2445 | 72.3% | high | high | = |
| 5 | Hyundai Santa Fe | hyundai | SUV AWD | gas | 2017–2022 | 1798 | 70.2% | high | mid | **worse +1** |
| 6 | Chrysler Pacifica | chrysler | Van | gas | 2017–2022 | 3361 | 64.6% | high | high | = |
| 7 | Kia Sportage | kia | SUV AWD | gas | 2017–2022 | 873 | 63.1% | high | mid | **worse +1** |
| 8 | Chevy Suburban | chevrolet | SUV AWD | gas | 2017–2022 | 622 | 62.4% | high | mid | **worse +1** |
| 9 | Chrysler Pacifica PHEV | chrysler | Van | phev | 2017–2022 | 540 | 59.3% | high | high | = |
| 10 | VW GTI | volkswagen | Car | gas | 2017–2022 | 643 | 59.1% | high | mid | **worse +1** |
| 11 | Chevy Volt | chevrolet | PHEV | phev | 2016–2019 | 1110 | 59.0% | high | mid | **worse +1** |
| 12 | Fiat 500 | fiat | Car | gas | 2014–2019 | 248 | 58.9% | high | high | = |
| 13 | Chevy Traverse | chevrolet | SUV AWD | gas | 2018–2022 | 1247 | 58.6% | high | high | = |
| 14 | Hyundai Sonata | hyundai | Car | gas | 2017–2022 | 1660 | 58.3% | high | mid | **worse +1** |
| 15 | Fiat 500X | fiat | SUV AWD | gas | 2017–2022 | 33 | 57.6% | high | high | = |
| 16 | Buick Encore | buick | SUV | gas | 2017–2022 | 279 | 55.6% | mid | mid | = |
| 17 | Chevy Tahoe | chevrolet | SUV AWD | gas | 2017–2022 | 1027 | 55.3% | mid | mid | = |
| 18 | Kia Niro (hybrid) | kia | SUV | hybrid | 2017–2022 | 304 | 54.9% | mid | mid | = |
| 19 | Kia Sorento | kia | SUV AWD | gas | 2017–2022 | 1767 | 54.7% | mid | mid | = |
| 20 | Chevy Colorado | chevrolet | Truck | gas | 2017–2022 | 734 | 54.5% | mid | mid | = |
| 21 | Mazda CX-5 | mazda | SUV | gas | 2017–2022 | 831 | 52.7% | mid | low | **worse +1** |
| 22 | Ford Ranger (2019+ midsize) | ford | Truck | gas | 2019–2022 | 526 | 51.5% | mid | mid | = |
| 23 | Hyundai Elantra | hyundai | Car | gas | 2017–2022 | 1828 | 49.9% | mid | mid | = |
| 24 | Chevy Equinox | chevrolet | SUV | gas | 2017–2022 | 1496 | 48.0% | mid | high | better -1 |
| 25 | Toyota Highlander | toyota | SUV AWD | gas | 2017–2022 | 1993 | 45.0% | mid | low | **worse +1** |
| 26 | Honda Pilot | honda | SUV AWD | gas | 2017–2022 | 3218 | 44.6% | mid | low | **worse +1** |
| 27 | VW Tiguan | volkswagen | SUV AWD | gas | 2018–2022 | 966 | 43.7% | mid | mid | = |
| 28 | Toyota Camry | toyota | Car | gas | 2017–2022 | 1740 | 37.4% | mid | low | **worse +1** |
| 29 | Toyota Highlander Hybrid | toyota | SUV AWD | hybrid | 2017–2022 | 265 | 35.1% | mid | low | **worse +1** |
| 30 | Toyota Corolla | toyota | Car | gas | 2017–2022 | 1102 | 34.3% | mid | low | **worse +1** |
| 31 | Toyota Tacoma | toyota | Truck | gas | 2017–2022 | 868 | 34.0% | mid | low | **worse +1** |
| 32 | Ford Explorer | ford | SUV AWD | gas | 2017–2022 | 4502 | 33.4% | mid | high | better -1 |
| 33 | Kia K4 | kia | Car | gas | 2025–2026 | 49 | 32.7% | mid | mid | = |
| 34 | Volvo XC90 | volvo | SUV AWD | gas | 2017–2022 | 234 | 30.3% | mid | high | better -1 |
| 35 | Honda Accord | honda | Car | gas | 2017–2022 | 3773 | 30.0% | mid | low | **worse +1** |
| 36 | Honda Odyssey | honda | Van | gas | 2017–2022 | 2566 | 29.7% | mid | mid | = |
| 37 | Subaru Ascent | subaru | SUV AWD | gas | 2019–2022 | 905 | 29.6% | mid | mid | = |
| 38 | Nissan Rogue | nissan | SUV | gas | 2017–2022 | 2196 | 28.0% | mid | high | better -1 |
| 39 | Mini Cooper | mini | Car | gas | 2017–2022 | 79 | 27.8% | mid | high | better -1 |
| 40 | Toyota RAV4 | toyota | SUV | gas | 2017–2022 | 2639 | 27.4% | mid | low | **worse +1** |
| 41 | Buick Enclave | buick | SUV AWD | gas | 2017–2022 | 373 | 26.5% | mid | mid | = |
| 42 | Mini Countryman | mini | SUV AWD | gas | 2017–2022 | 38 | 26.3% | mid | high | better -1 |
| 43 | Honda CR-V | honda | SUV | gas | 2017–2022 | 5799 | 26.1% | mid | low | **worse +1** |
| 44 | Jeep Grand Cherokee L | jeep | SUV AWD | gas | 2021–2022 | 286 | 25.9% | mid | high | better -1 |
| 45 | Kia Telluride | kia | SUV AWD | gas | 2020–2022 | 1389 | 24.9% | mid | mid | = |
| 46 | Hyundai Palisade | hyundai | SUV AWD | gas | 2020–2022 | 1227 | 24.6% | mid | mid | = |
| 47 | Mazda CX-90 | mazda | SUV AWD | gas | 2024–2026 | 341 | 24.0% | mid | mid | = |
| 48 | VW Atlas | volkswagen | SUV AWD | gas | 2018–2022 | 1571 | 23.0% | low | mid | better -1 |
| 49 | Toyota Sienna (V6) | toyota | Van | gas | 2015–2020 | 606 | 21.9% | low | low | = |
| 50 | VW Passat | volkswagen | Car | gas | 2017–2022 | 191 | 20.9% | low | mid | better -1 |
| 51 | Mazda3 (SkyActiv) | mazda | Car | gas | 2017–2022 | 367 | 20.4% | low | low | = |
| 52 | Toyota Prius (hybrid) | toyota | Car | hybrid | 2017–2022 | 209 | 18.7% | low | low | = |
| 53 | Toyota Prius Prime | toyota | PHEV | phev | 2017–2022 | 200 | 17.0% | low | low | = |
| 54 | Subaru Forester | subaru | SUV AWD | gas | 2017–2022 | 2794 | 16.5% | low | mid | better -1 |
| 55 | Toyota RAV4 Hybrid | toyota | SUV AWD | hybrid | 2017–2022 | 379 | 14.0% | low | low | = |
| 56 | Chevy Bolt EV | chevrolet | EV | ev | 2017–2022 | 860 | 13.6% | low | low | = |
| 57 | Volvo XC60 | volvo | SUV AWD | gas | 2018–2022 | 189 | 13.2% | low | mid | better -1 |
| 58 | VW ID.4 (AWD avail) | volkswagen | EV SUV | ev | 2021–2022 | 457 | 11.6% | low | high | better -2 |
| 59 | Nissan Leaf | nissan | EV | ev | 2018–2022 | 614 | 11.6% | low | mid | better -1 |
| 60 | Toyota RAV4 Prime | toyota | PHEV SUV AWD | phev | 2021–2022 | 119 | 10.9% | low | low | = |
| 61 | Toyota Camry Hybrid | toyota | Car | hybrid | 2017–2022 | 200 | 10.5% | low | low | = |
| 62 | Toyota Sienna Hybrid | toyota | Van | hybrid | 2021–2022 | 48 | 10.4% | low | low | = |
| 63 | Toyota 4Runner | toyota | SUV AWD | gas | 2017–2022 | 262 | 9.9% | low | low | = |
| 64 | Honda Civic | honda | Car | gas | 2017–2022 | 2914 | 9.8% | low | low | = |
| 65 | Toyota Sequoia | toyota | SUV AWD | gas | 2017–2022 | 43 | 9.3% | low | low | = |
| 66 | Subaru Outback | subaru | SUV AWD | gas | 2017–2022 | 4394 | 8.2% | low | mid | better -1 |
| 67 | Volvo V90 Cross Country | volvo | SUV AWD | gas | 2017–2022 | 20 | 5.0% | low | mid | better -1 |
| 68 | Ford Ranger (old compact) | ford | Truck | gas | 2006–2011 | 1431 | 4.3% | low | mid | better -1 |
| 69 | Tesla Model 3 | tesla | EV | ev | 2018–2022 | 3415 | 3.0% | low | mid | better -1 |
| 70 | Porsche 996 Carrera | porsche | Sport | gas | 1999–2004 | 59 | 55.9% | _not derived_ | sport | — |
| 71 | Porsche 996 Turbo | porsche | Sport | gas | 2001–2005 | 117 | 97.4% | _not derived_ | sport | — |

**Overall agreement: 34/69 = 49 %** (the 2 `sport` Porsches are excluded by design).
Mean ordinal error **0.522** tier steps. **1** vehicle moves a full 2 tiers.
Bootstrap 90 % CI on the agreement rate: **39 %–59 %**.

### 6.1 Confusion matrix (rows = seed, columns = derived)

| | derived low | derived mid | derived high |
|---|---:|---:|---:|
| **seed low** (22) | **12** | 10 | 0 |
| **seed mid** (32) | 9 | **15** | 8 |
| **seed high** (15) | 1 | 7 | **7** |

The zero in the top-right and the single 1 in the bottom-left are the point of this method: it
essentially never confuses a seed-`low` car for `high` or vice versa. Compare the current method's 11
such inversions.

### 6.2 Disagreement by make — the systematic patterns

| make | agree | vehicles that move |
|---|---:|---|
| toyota | 9/15 | Corolla, Camry, RAV4, Tacoma, Highlander, Highlander Hybrid — **all six `low → mid`** |
| honda | 2/5 | Accord, CR-V, Pilot — **all three `low → mid`** |
| hyundai | 3/6 | Sonata, Kona, Santa Fe — **all three `mid → high`** |
| kia | 4/6 | Soul, Sportage — both `mid → high` |
| volkswagen | 1/5 | ID.4 `high → low`; Passat, Atlas `mid → low`; GTI `mid → high` |
| volvo | 0/3 | XC60, V90 CC `mid → low`; XC90 `high → mid` |
| chevrolet | 4/7 | Volt, Suburban `mid → high`; Equinox `high → mid` |
| subaru | 1/3 | Outback, Forester both `mid → low` |
| mini | 0/2 | Cooper, Countryman both `high → mid` |
| nissan | 0/2 | Leaf `mid → low`; Rogue `high → mid` |
| ford | 2/4 | Ranger (old) `mid → low`; Explorer `high → mid` |
| mazda | 2/3 | CX-5 `low → mid` |
| jeep | 0/1 | Grand Cherokee L `high → mid` |
| tesla | 0/1 | Model 3 `mid → low` |

Two clean, interpretable systematic effects:

- **Toyota and Honda are compressed upward** (9 vehicles, all `low → mid`). Their powertrain shares
  land 26–45 %, i.e. mid-pack. The seed's Japanese-brand `low` tiers come from CR's long-run
  owner-survey reputation, which NHTSA complaint *mix* cannot see.
- **Hyundai and Kia are pushed downward** (5 vehicles, all `mid → high`) with powertrain shares of
  50–84 % — the highest in the corpus. This is real and independently well-known (the Theta II GDI
  engine failures and the resulting recalls/settlements), and it is arguably the derivation *correcting*
  the seed rather than erring.

### 6.3 Disagreement by powertrain and direction

| powertrain | agree |
|---|---|
| gas | 25/55 (45 %) |
| hybrid | 5/6 (83 %) |
| phev | 3/4 (75 %) |
| **ev** | **1/4 (25 %)** |

Direction is balanced — **18 derived worse than seed, 17 derived better** — so the method is not
systematically harsher or softer than the seed; it disagrees about *which* cars, not about the average.
EVs are the weak spot, per §5.4.

**Gas-only sanity check (the real test):** restricting to the 55 gas vehicles and recomputing the cuts
within them, agreement is **23/55 (42 %)** against a chance baseline of 20.9 (95th pct 26) — barely
above noise. Much of the headline 49 % is the method correctly placing hybrids/PHEVs `low`, which per
§4.2 is partly the sales-mix artifact leaking back in through the share metric.

### 6.4 Vehicles the owner should eyeball

**Full 2-tier move (1):**

| vehicle | seed | derived | evidence |
|---|---|---|---|
| **VW ID.4** | high | **low** | 11.6 % powertrain share on 457 complaints (MY2021–22 only). An EV, so §5.4 applies directly — its seed `high` almost certainly reflects the well-publicised software/12V/charging problems, which land in `ELECTRICAL SYSTEM`, not `POWER TRAIN`. **Do not accept this one.** |

**Thin evidence — score is noisy regardless of which way it lands:**

| vehicle | complaints | model years | seed → derived |
|---|---:|---:|---|
| Volvo V90 Cross Country | 20 | 6 | mid → low |
| Fiat 500X | 33 | 6 | high → high |
| Mini Countryman | 38 | 6 | high → mid |
| Toyota Sequoia | 43 | 6 | low → low |
| Toyota Sienna Hybrid | 48 | 2 | low → low |
| Kia K4 | 49 | 2 | mid → mid (already `provenance: proxied`) |

**Blocs worth a single judgment call rather than 9 individual ones:** the Toyota/Honda `low → mid`
group (§6.2) and the Hyundai/Kia `mid → high` group. Both are systematic; deciding whether the seed or
the derivation is right for each *bloc* is one decision, not nine.

---

## 7. What would have to change to implement this — NOT IMPLEMENTED

### 7.1 `docs/reliability-methodology.md`

| section | change |
|---|---|
| **Source** | Add that `complaintsByVehicle` must be driven from the **per-model-year** catalogue (`products/vehicle/models?issueType=c`), not a single model string, and that results are unioned + de-duplicated by `odiNumber`. Document why (§1.2). Add recalls/investigations as **evaluated and rejected for scoring** (§2.3) with the ρ table, so the decision is auditable and nobody re-litigates it. |
| **"Why not complaints-per-1000-sold"** | Rewrite. The current text presents years-on-road as an acceptable stand-in for sales volume. §0.1 and §4.2 show it is not: the resulting metric correlates with the seed tier at ρ = +0.11. State plainly that **count-based metrics are unusable** and that the fix is a *ratio* metric, not a better denominator. |
| **Step 1 — per-model-year rate** | **Delete.** `yearsOnRoad` and `perYearOnRoadRate` no longer feed the tier. (Keep the raw per-year counts — Step 4 still needs them.) |
| **Step 2 — per-model raw score** | Replace "median of per-year rates" with "pooled powertrain complaint share across the queried model years", including the `odiNumber` de-duplication rule. |
| **Step 3 — normalize within body-class, then bucket by quartile** | **Delete the whole normalisation step.** Replace with: one global distribution, percentile cuts at the seed's own tier marginals (p32 / p78), `sport` excluded from both the distribution and the cut computation. Carry over the §5.1 comparison table as the justification, and **retire the three long JUDGMENT notes about singleton body classes and cross-contamination** — they describe a problem that no longer exists once the partition is gone. |
| **Step 4 — landmine model years** | Unchanged. It already uses a *share* (`powertrainShare > 0.30`) and is therefore already volume-invariant — worth saying so explicitly, since it is now the same family of statistic as the tier score. |
| **new: Known limitations** | (a) EV/hybrid structural deflation and the `provisional` marking (§5.4); (b) gas-only agreement is 42 % vs a 38 % chance baseline — the method is coarse and must not be presented as precise; (c) `make` is the dominant factor and is deliberately *not* normalised away; (d) shrinkage and absolute thresholds were tested and rejected, with numbers. |
| **new: Year window** | Document `yearsFor` (≤ 6 model years, ending ≤ MY2022) and the 3 model-years NHTSA returns nothing for. |

### 7.2 `packages/pipeline/src/reliability/derive.ts`

| what | change |
|---|---|
| `ReliabilityQuery` | `model: string` → a per-year resolution step. Either `models: (year: number) => string[]` or a `modelMatcher` predicate applied to the fetched catalogue. `body: string` is **no longer needed by the derivation** (it only fed `bodyClassMedian`) — keep it for reporting only. |
| new fn | `resolveModelStrings(make, year, matcher)` — fetch `products/vehicle/models?modelYear&make&issueType=c`, filter, return the matched strings. Cache-friendly (121 requests for the whole corpus). |
| `deriveReliability` | Fetch every matched string per year; **de-duplicate complaints by `odiNumber`** before counting (today `complaintComponents` returns one array per year with no cross-string dedupe). |
| `rawScore` | `median(perYearOnRoad)` → `sum(powertrainComplaints) / sum(complaints)` pooled over the window. |
| `perYearOnRoadRate` | **Delete** (or keep exported for the report's diagnostics only — it no longer feeds any tier). |
| `bodyClassIndex`, `rawScoresByBody` | **Delete both.** No group medians, no per-class partition. `ReliabilityDerivation.bodyClassIndex` disappears from the public shape. |
| quartile cuts | `percentile(indices, 0.25/0.75)` → `percentile(scores, 0.32/0.78)` — and the constants must be *named and documented* as "the seed corpus's own tier marginals", not left as bare literals. |
| `sport` exclusion | Currently implicit (the 6-model batch had no sport car). Must become **explicit**: filter `sport` vehicles out of the score distribution *and* the cut-point computation before assigning. |
| new field | `evidence: { complaints: number; modelYears: number; provisional: boolean }` — `provisional` when `etype` is `ev`/`phev` (§5.4) or `complaints < ~100` (§6.4), so the report and the UI can mark low-confidence tiers instead of silently asserting them. |
| `classifyLandmineYears` | Unchanged. |

### 7.3 `packages/pipeline/src/sources/nhtsa.ts`

- New `modelsForVehicle(make, year, issueType)` adapter over `products/vehicle/models`.
- `complaintComponents` must accept **multiple** model strings per year and de-duplicate by `odiNumber`.
- If recalls are ever added (for *disclosure*, not scoring): handle the **HTTP 400-with-valid-body**
  empty-result case (§3.1).

### 7.4 `packages/pipeline/src/fetchCached.ts`

- Send a default `User-Agent` (`opencawr-pipeline/<version>`, **without** a `(+https://…)` suffix —
  that form is blocked, §3.1).
- Optionally allow an adapter to opt into "non-2xx but parseable JSON is a valid answer".

### 7.5 `packages/pipeline/src/reliability/report.ts`

- Replace the hardcoded 6-model `QUERIES` array with the full corpus, derived from `loadSeedData()`.
- Drop the singleton-body caveat line (no longer applicable); add the §5.4 EV caveat and the
  gas-only-vs-chance honesty line.
- Keep "**DO NOT rewrite `opencawr_data.json` from this report**" — still true, still an owner gate.

### 7.6 `ASSUMPTIONS.md` / `OpenCAWR_SPEC.md` / `DECISIONS.md`

- **§H**: replace the body-normalisation and quartile rows wholesale; add rows for the share metric,
  the rejected recalls/investigations, shrinkage, and absolute thresholds — each with its measured number.
- **§E**: the "Full-corpus reliability re-derivation" OPEN item now has evidence attached but stays OPEN.
- **§D**: note that `reliability_tier`, `repair_cost_multiplier_by_make` and `eol_maintained_miles` are
  not three independent judgments but one (ρ = −0.838 / +0.602).
- **Spec §9**: recommend striking **CarComplaints and RepairPal** from the prescribed re-derivation
  sources (§2.2) — as written, §9 tells us to clear a legal gate using two sources that create one.
- New finding to log: `body` conflates shape, drive layout and powertrain (§4.4).

---

## 8. Scope discipline

- `opencawr_data.json` — **not modified.**
- `packages/core`, `packages/pipeline` — **not modified.**
- Nothing committed; `git status` shows only untracked `.tmpreliability/` (and a pre-existing,
  unrelated `.tmpinsurance/`), nothing staged.
- New files: `.tmpreliability/*` (throwaway scripts + cached results) and this report.
  `packages/pipeline/.cache/` gained 999 gitignored cache entries.
- **Rewriting seed tiers remains an owner review gate.** This report is evidence for that decision, not the decision.
