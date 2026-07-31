# Model-year detail methodology (R2, "model year as a designed surface")

`Vehicle.model_year_detail` (`packages/core/src/types.ts`) is a per-model-year map of purely
descriptive facts — what changed between model years, and (where the data allows it) what owners
complained about that year. **It is never read by `costPerMile`** (`packages/core/src/engine.ts`):
adding and populating this field changes zero cost-per-mile output, for any vehicle, at any input.
`packages/pipeline/src/modelyear/deriveModelYearDetail.ts` implements the derivation below;
`npm run model-year-report -w @opencawr/pipeline [-- --write]` (`packages/pipeline/src/modelyear/report.ts`)
populates it for the full 71-vehicle seed corpus.

## Sources

Two, both already flowing through this pipeline for free/public/keyless reasons — no new licensing
exposure, spec §9 stays clear.

1. **EPA fueleconomy.gov vehicle-detail** (`epaVehicleDetail`, `packages/pipeline/src/sources/epa.ts`)
   — the same endpoint already used to populate `mpg_combined`/`co2_g_per_mi`/etc. Its JSON response
   already carries `displ` (engine displacement, liters), `cylinders`, and `trany` (transmission
   descriptor) on the wire; this derivation is the first thing in the pipeline to read them.
   `drivetrainDescriptor()` formats them alongside the existing `drive` field into a single string,
   e.g. `"2.5L I4, Automatic (AM-S8), Front-Wheel Drive"` — best-effort: any missing/blank piece is
   omitted, never throws. Which vehicle-config the descriptor comes from is resolved per model year
   against **EPA's own model catalogue** (`epaModelsForYear`, `menu/model?year=&make=`) — see
   "`drivetrain`" below.
2. **NHTSA complaint components** (`complaintComponentsByCatalogue`, `packages/pipeline/src/sources/nhtsa.ts`)
   — reused verbatim from the R12 reliability derivation's existing query. Same make/matcher/year-window
   per vehicle (`corpusQueries`, `packages/pipeline/src/reliability/corpus.ts`), same on-disk
   `fetchCached` cache, same `components: string[][]` per-complaint category lists. No second NHTSA
   query path exists or should be built.

## `drivetrain`

**Queries are driven from EPA's per-model-year catalogue, never from one hard-coded model string.**
`fueleconomy.gov/ws/rest/vehicle/menu/model?year=&make=` is EPA's own list of queryable model
strings, and — exactly like NHTSA's complaint catalogue (`docs/reliability-methodology.md`,
"Source") — it is **drivetrain/trim-fragmented and inconsistent year to year for the same physical
car**:

| seed vehicle | EPA model string, by model year |
|---|---|
| Honda CR-V | `CR-V 2WD` + `CR-V 4WD` (2009–16) → `CR-V AWD` + `CR-V FWD` (2017+), plus a separate `CR-V Hybrid AWD` (2020–23) — **never a bare `CR-V`** |
| Mazda3 | `3` (2010–13) → `3 4-Door`/`3 5-Door` (2014–18) → `3 4-Door 2WD`/`4WD` (2019+) — the nameplate string is `3`, not `Mazda3` |
| Volvo XC60 | `XC60 AWD`/`FWD` (2016–21) → `XC60 B5`/`B5 AWD`/`B6 AWD` (2022+) — never a bare `XC60` |
| Mini Cooper | `Cooper (3-doors)` (2014–15) → `Cooper Hardtop 2 door` (2016–25) → `Cooper C 2 Door` (2026) |
| Ford Ranger | `Ranger Pickup 2WD/4WD` (2001–09) → `Ranger 2WD/4WD` (2010–11, 2019+) |
| Porsche 911 | `911 Carrera` → `911 Carrera 2/4` → `Carrera 2 Coupe` (the `911` prefix is dropped in 2003) → `Turbo 4 911 Cab` (2004–05) |

EPA answers a query for a string it doesn't list with a **bare JSON `null`**, which the adapter
correctly reads as "no configs" — so a single hard-coded string silently yields a blank `drivetrain`
for whole model years, or for a vehicle's entire production span. That is precisely what the first
pass of this derivation did: reusing the segment-peer proxy's single-string guess (`peerEpaQuery`)
left `drivetrain` empty for **49 of 71 seed vehicles** (only 230 of 883 model-years populated).

The fix, in `packages/pipeline/src/modelyear/epaCorpus.ts` (the EPA-side twin of
`reliability/corpus.ts`): every seed vehicle carries an EPA **make** string plus a **model-string
matcher**, applied to that model year's real catalogue. Two rules:

- **etype include/exclude.** EPA lists electrified and alt-fuel variants as separate model strings
  under the same nameplate, so a `gas` seed row must never match one — seed `Honda CR-V` matches
  `CR-V AWD`/`CR-V FWD` and **excludes** `CR-V Hybrid AWD` and `CR-V e-FCEV` — and an electrified
  row must match the corresponding electrified string — seed `Toyota RAV4 Hybrid` matches
  `RAV4 Hybrid AWD`, which seed `Toyota RAV4` excludes. (`FFV` flex-fuel strings are deliberately
  *not* excluded from gas rows: a flex-fuel car is a gasoline car.)
- **One deterministic variant per model year — disclosed, not hidden.** A model year usually offers
  several matching strings (`CR-V AWD` *and* `CR-V FWD`), each with its own config ids and therefore
  its own `drive`/`trany`. `pickModelForYear()` sorts the matches case-insensitively and takes the
  first, then takes that string's first config id, so `specChangeFromPriorYear` compares like for
  like year over year. **A shown `drivetrain` is therefore "a configuration EPA lists for that model
  year", not "the only one that year".** A CR-V shown as All-Wheel Drive was also sold as FWD.

A year for which EPA lists no matching catalogue string, or lists one with no vehicle-config ids, is
a gap, `null` — never an error, never inferred from a neighboring year. `epaCorpus.ts` throws rather
than silently dropping a seed vehicle whose mapping is missing, and `MAPPING_NOTES` there records
every ambiguous case (shared strings separated only by year window, mid-life renames, nameplates
that outlive their EPA string).

Coverage after catalogue resolution: **873 of 883 model-years (98.9%)**, up from 230 (26%); **0 of
71 seed vehicles have no drivetrain data at all**, down from 49. The 10 remaining gaps are genuine
EPA gaps, listed under "Known limitations" below.

## `specChangeFromPriorYear` — a PROXY, not a facelift detector

**Stated prominently and plainly: this is a spec-discontinuity proxy, not a confirmed styling
refresh or facelift, and must never be described as detecting a "refresh" in any UI copy or docs.**
EPA's fueleconomy.gov data carries no styling signal at all — no photos, no trim/generation labels,
nothing about sheet metal, interior, or infotainment. `classifySpecChangeYears()`
(`deriveModelYearDetail.ts`) flags a model year when EITHER of two EPA-supplied signals differs from
the immediately preceding model year:

- the formatted `drivetrain` descriptor (a new transmission, cylinder count, or displacement), or
- the raw `VClass` string (EPA's own size-class label changing, e.g. "Compact Cars" → "Midsize Cars").

A change in either is consistent with — but not proof of — a mid-cycle refresh or a generational
change: manufacturers also swap transmissions or trims independently of any styling change, and EPA's
own VClass label can shift between two visually identical model years for classification reasons
unrelated to the car itself. **Treat every `true` value as "EPA's own numbers moved," not "the car
was redesigned."**

Missing data is handled as "insufficient evidence," not as "no change": if either side of a
comparison has a `null` drivetrain (no EPA data that year), that comparison is skipped and `VClass`
is checked independently. Only when *both* signals are unavailable on either side does the year fall
back to `false`. The first model year in a vehicle's range is always `false` (there is no prior year
to compare against).

## `topComplaintCategory` / `topComplaintShare`

For each model year present in the reliability derivation's own NHTSA query window
(`YearComplaintComponents[]`, same fetch as `deriveReliability`), `topComplaintCategoryByYear()`
tallies every top-level component category (the part of a `components` entry before any `:`
subcategory — the same convention `reliability/derive.ts` uses for its powertrain-prefix check)
across that year's complaints, counting a category **once per complaint** regardless of how many of
its subcategories appear in that complaint (the same "counts once per complaint" discipline
`classifyLandmineYears`/`isPowertrainComponent` already use). The category with the highest count is
`topComplaintCategory`; its share of that year's complaint total is `topComplaintShare`. Ties are
broken alphabetically, for a deterministic result. A model year with zero complaints yields
`{topComplaintCategory: null, topComplaintShare: null}`.

## Known limitations

**Model-years EPA genuinely has no matching entry for** (10 of 883, all at the trailing edge of a
seed row's declared span, none of them a mapping failure):

| seed vehicle | missing model years | why |
|---|---|---|
| Buick Encore | 2023, 2024, 2025, 2026 | the Encore proper ends at MY2022; `Encore GX` (MY2020+) is a different platform and is excluded, matching `reliability/corpus.ts`'s NHTSA row |
| Toyota Camry | 2025, 2026 | MY2025+ Camry is hybrid-only — EPA lists no non-`HEV` Camry string, so the gas seed row has nothing to match (the `Toyota Camry Hybrid` row covers those years) |
| Toyota Prius Prime | 2026 | EPA lists no MY2026 plug-in Prius string yet (`Prius Prime` 2017–24 → `Prius PHEV` 2025) |
| Toyota RAV4 Prime | 2026 | as above (`RAV4 Prime 4WD` 2021–24 → `RAV4 PHEV AWD` 2025) |
| Kia Soul | 2026 | US sales ended after MY2025 |
| Kia Telluride | 2026 | not listed by EPA yet |

Each is `null`, and `classifySpecChangeYears` treats a `null` as "insufficient evidence" rather than
"no change" (above), so a gap never fabricates a flag.

**A single-variant sample, not a census**: see the deterministic-pick rule under "`drivetrain`" — one
configuration per model year, chosen for year-over-year comparability, not the full option list.

**Known limitation, disclosed not hidden**: `topComplaintCategory`/`topComplaintShare` are only
populated for model years inside `corpusQueries()`'s own window — at most 6 model years ending no
later than MY2022, intersected with `[first_year, last_year]` (`docs/reliability-methodology.md`,
"Year window"). Years outside that window are `null`, exactly as R12's `landmineYears` already
accepts for the same reason — re-querying every model year in a vehicle's full production span would
multiply NHTSA request volume for no signal outside the window the reliability tier itself doesn't
already use.

## What this produces

`npm run model-year-report -w @opencawr/pipeline` derives `model_year_detail` for the full 71-vehicle
seed corpus and prints, per vehicle, how many model years have EPA drivetrain data, how many are
flagged `specChangeFromPriorYear`, and how many have a dominant NHTSA complaint category. Read-only
by default; `-- --write` applies the full map to `opencawr_data.json`.

**Unlike the reliability report, writing this is NOT a numbers-change event.** `model_year_detail` is
never read by `costPerMile`, so populating it changes zero `$/mi` output for any vehicle at any
input — no `npm run gen-reference -w @opencawr/core` re-run is required after writing it.

Estimates, not advice.
