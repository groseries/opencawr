# Reliability re-derivation methodology (launch gate, spec §9)

Seed `reliability_tier` values traced back to the lost prototype's Consumer-Reports-derived
judgment calls (ASSUMPTIONS.md §D). Public launch was blocked until they were re-derived from a
free, keyless, no-Consumer-Reports source. **This document specifies that derivation exactly, and
as of 2026-07-29 it is the source of every non-`sport` `reliability_tier` in `opencawr_data.json`.**
`packages/pipeline/src/reliability/derive.ts` implements it and
`packages/pipeline/src/reliability/corpus.ts` maps the 71 seed vehicles onto NHTSA — no code should
diverge from what's written here without updating this file in the same commit.

Evidence for every choice below: `docs/investigations/2026-07-29-reliability-corpus.md`.

## Source

NHTSA `complaintsByVehicle` (`api.nhtsa.gov/complaints/complaintsByVehicle`) — free, keyless,
US-government public domain, zero takedown risk. Two things are read off each complaint record: its
`odiNumber` (identity, for de-duplication) and its `components` field (a comma-separated list of
NHTSA component categories, e.g. `"ENGINE,FUEL/PROPULSION SYSTEM"`) — never `summary` (free text)
or `vin`, matching the "counts only" discipline documented at the top of `nhtsa.ts`.

**Queries are driven from the per-model-year catalogue, never from one hard-coded model string.**
`api.nhtsa.gov/products/vehicle/models?modelYear=&make=&issueType=c` is NHTSA's own list of
queryable model strings, and it is **trim-fragmented and inconsistent year to year for the same
physical car**:

| seed vehicle | NHTSA model string, by model year |
|---|---|
| Ford Ranger (2019+) | `RANGER` (2019–20) → `RANGER SUPER CAB` + `RANGER SUPER CREW` (2021–22) |
| Volvo XC60 | `XC60` (2017) → `XC60 T5/T6/T8` (2018–21) → `XC60 B5 AWD/B5 FWD/B6 AWD` (2022) |
| Volvo XC90 | **never a bare `XC90`** in the window — only `T5/T6/T8`, then `T5 AWD/T5 FWD/T6 AWD` |
| Mini Cooper | `COOPER`/`COOPER S`/`HARDTOP` … and **no `COOPER` at all in MY2021** |
| Nissan Leaf | no bare `LEAF` in MY2022 — trim strings only |
| Chevy Bolt EV | `BOLT` (2017–18) → `BOLT EV` (2019+) |
| Chevy Suburban | `SUBURBAN 1500` (2016–21) → `SUBURBAN` (2021+) |

A single string therefore returns **nothing at all** for whole model years — for Volvo XC90, for
every year in the window. NHTSA answers such a query with **HTTP 400 carrying a valid
`{"count":0,"message":"Results returned successfully","results":[]}` body**, so depending on how the
caller treats the status it is either a hard fetch failure or, worse, a silent zero that a
share-based derivation reads as a flawless car. Neither is acceptable.

The fix, in `complaintComponentsByCatalogue`: resolve the catalogue for each model year, apply the
vehicle's include/exclude predicate (`corpus.ts`), query **every** matching string, and
**de-duplicate the results by `odiNumber`**. De-duplication is load-bearing, not hygiene: NHTSA
returns the *same* complaint set for `XC90 T5` and `XC90 T6` (it ignores the trim suffix), so
unioning without it exactly doubles that vehicle's counts. `GOLF GTI` and `GTI` are both listed in
MY2018–19 and are genuinely disjoint — both cases are handled by the same rule.

Two fetch-layer defects found and fixed alongside (`fetchCached.ts`):

- **NHTSA's edge (Akamai) 403s Node/undici's default User-Agent** with an HTML "Access Denied" page.
  `fetchCached` previously sent no `User-Agent` at all. It now sends `opencawr-pipeline/0.1`. A UA
  containing the conventional `(+https://…)` contact-URL suffix is **also** blocked — do not add one.
- **Non-2xx-with-valid-JSON**: `fetchCached` takes an opt-in `acceptNonOkJson` flag for the
  `{"count":0}`-with-HTTP-400 answer described above. Off by default, so every other adapter still
  fails loudly on a real error status.

### Sources evaluated and rejected

- **Consumer Reports** — permanently off the table (spec §9). Nothing here derives from it.
- **CarComplaints.com / RepairPal** — both are commercial sites with restrictive ToS and no free
  API; obtaining their aggregates means extracting a compilation, which is precisely the exposure
  spec §9's second clause exists to avoid. **Struck from spec §9** in the same commit as this
  derivation: the spec was prescribing a launch-gate remedy that created a launch-gate risk.
- **NHTSA recalls** (`recalls/recallsByVehicle`) and **ODI investigations** (the
  `static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip` flat file) were both fetched and evaluated across the
  full corpus, and are **rejected as tier inputs** — they measure regulator/manufacturer action, not
  owner-experienced failure, and empirically they carry no signal:

  | signal | volume-invariant? | ρ vs seed tier | p |
  |---|---|---:|---:|
  | `rate` (complaints ÷ years-on-road — the *previous* method) | no | +0.114 | 0.35 |
  | total complaints | no | +0.037 | 0.76 |
  | recalls / model-year | no | −0.005 | 0.97 |
  | investigations / model-year | no | +0.197 | 0.10 |
  | **powertrain complaint share** | **yes** | **+0.385** | **0.0013** |

  Combining them makes it worse: rank(share)+rank(investigations) and rank(share)+rank(recalls) both
  score below powertrain share alone. They remain useful as *disclosure* (a per-model "N open
  investigations" badge), never as a tier input. Do not re-litigate this without new evidence.
- **Trap, documented so nobody loses a day to it**: `api.nhtsa.gov/investigations?make=…&model=…`
  returns HTTP 200 and **silently ignores the `make`/`model` filters**, paging the entire corpus.
  `api.nhtsa.gov/investigations/investigationsByVehicle` does not exist (403 "Missing Authentication
  Token"). The ODI flat file is the only working public route.

## Why not complaints-per-1000-sold, and why not any count at all

The textbook reliability metric is complaints (or repairs) per 1,000 vehicles sold. NHTSA doesn't
publish sales and no free/keyless source does — that gap is exactly what Consumer Reports fills
commercially, and CR is off the table.

The previous version of this document substituted *years-on-road* for units-sold. **That does not
work, and the failure is measurable, not theoretical**: `complaints ÷ years-on-road`, medianed
across model years, correlates with the seed tier at **ρ = +0.11, p = 0.34** across all 69 non-sport
vehicles. It is a sales-volume ranking. Under it the full corpus agreed with the seed 28/69, *worse
than answering `mid` for every vehicle* (32/69) and inside the noise band of randomly shuffled
labels.

The proof that this is a volume artifact rather than a real powertrain effect is a natural
experiment — same make, same model, same body, different powertrain only:

| gas variant | rate | electrified variant | rate | ratio |
|---|---:|---|---:|---:|
| Toyota Highlander | 53.6 | Toyota Highlander Hybrid | 1.5 | **35.7×** |
| Toyota Camry | 37.4 | Toyota Camry Hybrid | 1.6 | **23.6×** |
| Toyota RAV4 | 58.3 | Toyota RAV4 Hybrid | 2.7 | **22.0×** |

No car is 22× more reliable than itself. The hybrid trim is a minority of that model's units sold,
so it generates proportionally fewer complaints.

**The fix is a ratio metric, not a better denominator.** Count-based metrics are unusable here.

## Step 1 — per-model score: powertrain complaint SHARE

```
powertrainComplaints(model) = complaints, pooled over the queried model years and
                              de-duplicated by odiNumber, having at least one `components`
                              top-level category (before any ":" subcategory) that starts
                              with ENGINE, POWER TRAIN, or TRANSMISSION

rawScore(model) = powertrainComplaints(model) / complaints(model)
```

Numerator and denominator both scale with units sold, so the sales confound cancels **exactly**.
That is why this is the only signal in the corpus with p < 0.01 (ρ = +0.385).

Two deliberate details:

- **Pooled across the window, not a median of per-year shares.** A 12-complaint model year would
  otherwise weigh as much as a 2,000-complaint one.
- **Each complaint counts once**, however many powertrain categories it carries. `rawScore` is a
  share, bounded in [0, 1]. *(The investigation's tabulated `pt%` column summed per-category counts
  instead, so a complaint tagged both `ENGINE` and `POWER TRAIN` counted twice and its percentages
  can exceed 100% — Porsche 996 Turbo 97.4%. The implemented per-complaint definition gives
  systematically lower percentages and shifts a handful of vehicles across a cut. It does **not**
  change the signal: ρ vs the seed tier is +0.384 here against +0.385 there.)*

## Step 2 — one global distribution, percentile cuts, no per-class partition

```
low   <=  p32 of the reference group's rawScore distribution
high  >   p78
mid       everything between
```

`p32`/`p78` are **the seed corpus's own tier marginals** (22 `low` / 32 `mid` / 15 `high` across the
69 non-sport vehicles), so the derivation is not penalised for producing the wrong *proportion* of
tiers. They are named constants (`TIER_CUT_LOW`/`TIER_CUT_HIGH`), not bare literals. Percentiles use
linear interpolation between order statistics (the common "R type 7" / NumPy-default method).

**There is no normalization step and no per-class partition — not by body, not by etype, not by
make.** All three were tested on the full corpus and all three score worse:

| method | agreement with seed | 2-tier inversions |
|---|---:|---:|
| `rate`, body-normalised, quartile cuts (the previous method) | 28/69 | **11** |
| `rate`, etype-normalised | 29/69 | 10 |
| powertrain share, body-normalised | 34/69 | 3 |
| powertrain share, etype-normalised | 29/69 | 2 |
| powertrain share, **make**-normalised | 32/69 | **11** |
| **powertrain share, no normalisation (this method)** | 34/69 | **1** |

Dropping the partition **dissolves** the small-class problem rather than relocating it: the
1-member `EV SUV` and `PHEV SUV AWD` body groups, the 2-member `PHEV` and `Sport` groups, and the
cross-contamination effect the previous version of this document spent three JUDGMENT notes
disclosing (a singleton body class pinned to `bodyClassIndex ≡ 1.0` shifting everyone else's cut
points) all simply stop existing. Those notes are retired because the mechanism is gone.

**Do not normalise by `make`.** It is tempting — `make` explains the most variance of any factor
(η² 0.50–0.64, p < 0.001, more than `etype`'s 0.14–0.19 and far more than `body`'s). But `make`
*is* the signal, the closest available stand-in for the owner's "quality of work"; normalising by it
deliberately erases the one thing that discriminates, which is why it restores 11 two-tier
inversions.

Also tested and rejected, with numbers: **absolute thresholds calibrated once** (best variant 24/69,
clearly worse — the share distribution is not stable enough to hard-code) and **empirical-Bayes
shrinkage** toward the corpus mean to damp thin denominators (ρ falls monotonically with the
shrinkage constant, agreement 32 → 25). **Do not shrink.** Thin-denominator vehicles are flagged
`provisional` instead.

## Step 3 — reference groups: `sport` and EVs

**`sport` is never derived.** It's an owner judgment for passion/collector vehicles (ASSUMPTIONS.md
§B: "no special-case rule… a vehicle of passion runs through the same engine") and isn't a
reliability statement at all. The 2 Porsche 996 rows are excluded **from the score distribution and
from the cut-point computation**, not merely left unassigned — an explicit filter, and a unit test
pins that removing a vehicle into the carve-out moves the cut points for everyone else.

**EVs are derived against an EV-only reference, with an EV-appropriate numerator.** An EV has no
engine and no transmission, so the Step-1 numerator is *structurally impossible* for it, not merely
small: measured median powertrain share is 33% for gas but **12% for EVs**. Left in the main
distribution, a powertrain-share metric ranks EVs as the most reliable cars in the field for the
wrong reason — the VW ID.4 derived a 2-tier improvement that way, an artifact that was rejected.

So for `etype: "ev"` only:

- the numerator is the Step-1 set **plus** `FUEL/PROPULSION SYSTEM`, `HYBRID PROPULSION SYSTEM` and
  `ELECTRICAL SYSTEM` — the categories NHTSA files an electric drivetrain's failures under;
- the cut points are percentiles of **the 4 EVs' own distribution**, not the main one.

**Stated plainly: with n = 4 this is an ordering of four cars, not a calibrated tier.** At n = 4 the
p32/p78 cuts necessarily produce 1 `low`, 2 `mid`, 1 `high`. All four EV tiers are marked
`provisional`. It is used anyway because the alternative — keeping the seed values — would leave
four rows still traceable to Consumer Reports, which is the one thing this gate exists to remove.

**PHEVs and hybrids stay in the main distribution with the standard numerator.** They have both an
engine and a transmission, so the metric is well defined for them, and the measured PHEV median
share (38%) sits right alongside gas (33%). Hybrids run lower (16%), which is partly a real
mechanical difference — an e-CVT and an Atkinson engine genuinely generate fewer transmission and
engine complaints than a torque-converter automatic — and partly the same sales-mix effect leaking
back in. Disclosed, not corrected: a per-`etype` adjustment factor was tested and scores worse
(29/69), and with n = 4 EVs and n = 4 PHEVs it cannot be estimated to better than a factor of two.
Record the medians (gas 33%, PHEV 38%, hybrid 16%, EV 12%); revisit at a larger corpus.

## Step 4 — landmine model years (independent of tier)

Unchanged. Within a model's queried years:

```
countMedian = median( complaints(Y) for Y in the model's queried years )   -- raw counts
powertrainShare(Y) = ( complaints in Y with a powertrain category ) / complaints(Y)

landmine(Y)  <=>  complaints(Y) > 2 * countMedian  AND  powertrainShare(Y) > 0.30
```

Worth saying explicitly now: this rule already uses a *share*, so it is already volume-invariant —
the same family of statistic as the tier score, arrived at independently.

**JUDGMENT**: the `2x` count threshold, the `30%` share threshold and the `ENGINE` / `POWER TRAIN` /
`TRANSMISSION` keyword set are judgment calls with no external benchmark — they are the values the
original task brief gave, not values derived from data.

This mirrors — and is intended to eventually replace — the placeholder `caution`-only heuristic in
`assemble.ts`'s `classifyModelYearReliability` (2× median complaints, no component check, never
emits `bad`), which is still what pipeline-*assembled* (non-seed) vehicles get. See ASSUMPTIONS.md §F.

## Year window

`corpusQueries()` gives each vehicle at most **6 model years, ending no later than MY2022**, so
every queried model year has ≥ 4 years on road to accumulate complaints, intersected with
`[first_year, last_year]`. Models that begin after 2022 (Kia K4, Mazda CX-90) fall back to their own
short span. That is 383 vehicle-model-years across the corpus.

**3 of those 383 return no matching model string at all** — Fiat 500 MY2019, Fiat 500X MY2021,
Volvo V90 Cross Country MY2021. They are handled as missing years, never as zeros. After the
catalogue fix, no vehicle ends up with zero complaints overall.

## Known limitations — read these before quoting a tier

1. **This is a coarse ordering, not a measurement.** Restricted to the 55 gas vehicles (where
   powertrain type is held constant) and recomputing the cuts within them, agreement with the seed
   is 23/55 against a chance baseline of 20.9 — barely above noise. The bootstrap 90% CI on the
   headline agreement rate contains the all-`mid` baseline. **No NHTSA-only signal in this corpus
   reproduces a per-model reliability judgment with confidence.** What this method does defensibly
   is order vehicles coarsely and avoid catastrophic inversions (1 two-tier inversion against the
   old method's 11; 0 vehicles moved 2 tiers when the tiers were actually written).
2. **Complaint share measures the *mix* of what owners report, not a defect rate.** A model whose
   owners complain mostly about infotainment scores "reliable" on this metric. It cannot see
   anything owners don't report to NHTSA, and it cannot see severity or cost.
3. **EV tiers rest on 4 vehicles** (Step 3). Battery risk — where EV reliability actually lives for
   this engine — is modelled separately in each vehicle's `battery` block and is unaffected.
4. **`make` is the dominant factor and is deliberately not normalised away** (Step 2). Two
   systematic consequences are visible in the results and are the derivation's biggest judgment
   call: Toyota/Honda are compressed upward (their powertrain shares are mid-pack, and the seed's
   Japanese-brand `low` tiers came from CR's long-run owner-survey reputation, which complaint *mix*
   cannot see), and Hyundai/Kia are pushed downward (shares of 50–77%, the highest in the corpus —
   the Theta II GDI engine failures, which is arguably the derivation correcting the seed).
5. **Agreement with the seed tier is not validation.** The seed tier is the CR-derived judgment
   being replaced, and it is internally near-deterministic: ρ(seed tier, `eol_maintained_miles`) =
   −0.838 and ρ(seed tier, `repair_cost_multiplier_by_make`) = +0.602. Those two fields are
   restatements of the same judgment, so they cannot serve as independent predictors, and high
   agreement would only mean "we successfully reproduced CR". The rate is reported as an
   observation; it is never a target and nothing here was tuned toward it.
6. **Some NHTSA mappings are genuinely ambiguous** and are disclosed rather than resolved — the two
   Ford Rangers and the two Toyota Siennas share a model string and are separated only by year
   window; Hyundai Santa Fe's seed row spans two physically different vehicles; Kia Niro's MY2021+
   string pools HEV/PHEV/BEV. `MAPPING_NOTES` in `corpus.ts` carries all 19, and the report prints them.

## What this produces

`npm run reliability-report -w @opencawr/pipeline` re-derives the full 71-vehicle corpus and prints
it against the current seed `reliability_tier`. It is read-only by default; `-- --write` applies the
derived tiers to `opencawr_data.json`.

**Writing tiers is a numbers-change event, not a routine refresh**: `reliability_tier` selects the
repair-frequency and median-repair-cost row in `constants.reliability_tiers` and the EOL dispersion
σ, so it moves real money. It must be followed by `npm run gen-reference -w @opencawr/core` and
reviewed. The 2026-07-29 run — the one that cleared the launch gate — is recorded with its full
blast radius in ASSUMPTIONS.md §E.

Estimates, not advice.
