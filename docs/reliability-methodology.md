# Reliability re-derivation methodology (Task D, launch gate)

Seed `reliability_tier` values trace back to the lost prototype's Consumer-Reports-derived
judgment calls (ASSUMPTIONS.md §D) — public launch is blocked until tiers are re-derived from
a free, keyless, no-Consumer-Reports source. This document specifies that derivation exactly;
`packages/pipeline/src/reliability/derive.ts` implements it — no code should diverge from what's
written here without updating this file in the same commit.

## Source

NHTSA `complaintsByVehicle` (`api.nhtsa.gov/complaints/complaintsByVehicle`), the same free/keyless
endpoint `src/sources/nhtsa.ts` already uses for `model_year_reliability`. Two things are read off
each complaint record: its existence (a count) and its `components` field (a comma-separated list
of NHTSA component categories, e.g. `"ENGINE,FUEL/PROPULSION SYSTEM"`) — never `summary` (free text)
or `vin`, matching the "counts only" discipline already documented at the top of `nhtsa.ts`.

## Why not complaints-per-1000-sold

The textbook reliability metric is complaints (or repairs) per 1,000 vehicles sold. NHTSA doesn't
publish sales, and no free/keyless source does either (that's exactly the gap Consumer Reports fills
commercially, and CR is off the table — global constraint). So sales-volume is replaced with a proxy:
**complaints per model-year per year-on-road.**

## Step 1 — per-model-year rate

For a model year `Y`, with `currentYear` the year the derivation runs:

```
yearsOnRoad(Y) = max(1, currentYear - Y)
rate(Y) = complaints(Y) / yearsOnRoad(Y)
```

`yearsOnRoad` stands in for "how long this model year has had to accumulate complaints and
odometer miles" — a 2018 model year has had far longer to generate complaints than a 2022 one, so
raw complaint counts alone would make newer model years look artificially reliable. This is the
same shape of correction sales-volume would otherwise provide, using time-on-road instead of units-sold.
Floored at 1 to avoid divide-by-zero for the current model year.

**JUDGMENT**: this proxy conflates "complaints accumulate with calendar time" with "complaints
accumulate with sales × usage," which isn't exactly true (a low-volume model with a devoted following
that reports issues aggressively could look worse than a high-volume model that would objectively
have more complaints if it had equal owners-with-a-NHTSA-account). Documented, not solved — no free
sales data exists to solve it properly.

## Step 2 — per-model raw score

```
rawScore(model) = median( rate(Y) for Y in the model's queried model years )
```

Median (not mean) so that a single unusually bad or unusually clean model year doesn't dominate the
model's overall score — the *model-year*-level landmine signal (Step 4) is a separate output.

## Step 3 — normalize within body-class, then bucket by quartile

Different body classes have structurally different complaint baselines (a minivan and a two-seater
aren't complained about the same way regardless of reliability), so raw scores are compared only
within the same seed `body` value, not globally:

```
bodyClassMedian(body) = median( rawScore(m) for m in the reference set with that body )
index(model) = rawScore(model) / bodyClassMedian(model.body)
```

`index` is a body-class-relative "how much worse/better than a typical peer of the same body type"
figure: `1.0` = exactly the body-class median.

Tiers are then assigned by quartile of `index` across the whole reference set (all models being
derived together, regardless of body class — the normalization in the step above is what makes this
cross-body comparison fair):

```
Q1 = 25th percentile of all indices
Q3 = 75th percentile of all indices

index <= Q1  -> "low"   (bottom quartile: fewest normalized complaints -> most reliable)
Q1 < index <= Q3 -> "mid"
index > Q3   -> "high"  (top quartile: most normalized complaints -> least reliable)
```

Percentiles use linear interpolation between order statistics (the common "R type 7" / NumPy-default
method) — the exact same formula intentionally used on both sides of every comparison so results are
reproducible from the raw complaint counts alone.

**`sport` is never derived.** It's an owner judgment for passion/collector vehicles (ASSUMPTIONS.md
§B: "no special-case rule... a vehicle of passion runs through the same engine") and isn't a
reliability statement at all, so it's out of scope for this pipeline.

**JUDGMENT — reference-set size**: quartiles are only as meaningful as the population they're computed
over. For this launch-gate validation, the reference set is exactly the 6 named seed models the task
specifies (spanning all 4 non-sport tiers in the seed data: Corolla/CX-5 = low, Odyssey/Sorento = mid,
Escape/Fiat 500 = high). Two of the four `body` groups among those 6 (`SUV AWD` → Sorento only,
`Van` → Odyssey only) have exactly one member, so `bodyClassMedian` for those bodies trivially equals
the model's own `rawScore` and `index` trivially equals `1.0` — i.e. for singleton body classes this
derivation can only ever place the model near the *global* median (by construction), not truly compare
it to same-body peers. That is an accurate description of what a 6-model reference set can support,
not a bug; a full-corpus re-derivation (all ~90 seed vehicles, or better, the live make/model catalog)
would need every seed vehicle's complaint history fetched and is out of scope for this task — noted as
an open item in `ASSUMPTIONS.md` §E.

**JUDGMENT — singleton indices shift the shared quartile cut points for every other model, not just
themselves.** `Q1`/`Q3` (Step 3, above) are computed once, across all 6 models' `index` values
together — Sorento's and Odyssey's artificial `1.0`s are two of the six numbers that decide where
those cut points land, exactly as much as Corolla's, CX-5's, Escape's, or Fiat 500's real indices are.
Concretely, with this task's 6-model batch the two `1.0`s sit in the middle of the sorted index list,
which pulls `Q1`/`Q3` toward the center and makes the `low`/`high` bands narrower (easier to fall into)
than they would be with only the 4 models that have a real same-body comparison. This is a
cross-contamination effect, not a bug in the quartile math itself — it's what "compute quartiles over
the whole batch together" necessarily does when some of the batch's indices aren't independently
informative. Disclosed here (and in `ASSUMPTIONS.md` §G and the `reliability-report` output) rather
than "fixed", per the launch-gate review: the fix would require either a larger reference set (so no
body class is a singleton) or excluding singleton-body models from the quartile computation entirely —
both are methodology changes for the owner to decide on, not a code bug to patch silently.

## Step 4 — landmine model years (independent of tier)

Within a model's queried years:

```
countMedian = median( complaints(Y) for Y in the model's queried years )   -- raw counts, not rate
powertrainShare(Y) = ( complaints in Y whose components include a powertrain category ) / complaints(Y)

landmine(Y)  <=>  complaints(Y) > 2 * countMedian  AND  powertrainShare(Y) > 0.30
```

A "powertrain category" is a complaint whose `components` field has a top-level segment (split on `,`,
then on `:` — NHTSA's `components` string is comma-separated top-level categories, each optionally
followed by `:`-delimited subcategories) that starts with `ENGINE` (covers `ENGINE`, `ENGINE AND
ENGINE COOLING`), starts with `POWER TRAIN` (covers `POWER TRAIN`, `POWER TRAIN:AUTOMATIC
TRANSMISSION`, etc.), or starts with `TRANSMISSION`.

This mirrors — and is intended to eventually replace — the placeholder `caution`-only heuristic
already flagged `launchBlocked: true` in `assemble.ts`'s `classifyModelYearReliability` (2× median
complaints, no component check, never emits `bad`). The Task D landmine rule is stricter (requires a
powertrain-component majority too) and is the one that should feed `model_year_reliability.bad`
once this derivation graduates from validation to production — see `ASSUMPTIONS.md` §F.

**JUDGMENT**: the `2x` count threshold, the `30%` powertrain-share threshold, and the specific
`ENGINE` / `POWER TRAIN` / `TRANSMISSION` keyword set are all judgment calls with no external
benchmark — chosen because they're the values given in the task brief, not derived from data.

## What this task does — and does not — do

This derivation is run and validated against the 6 named seed models
(`packages/pipeline/src/reliability/derive.ts`, `npm run reliability-report -w @opencawr/pipeline`),
producing an agreement table of derived tier vs. current seed `reliability_tier`. **It does not
rewrite `opencawr_data.json`.** Rewriting seed tiers — for these 6 or the other ~85 seed vehicles —
is an explicit owner review gate (ASSUMPTIONS.md §D/§E); the validation report is this task's
deliverable, not a data migration.
