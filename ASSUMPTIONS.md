# OpenCAWR — Assumptions Ledger

The single written record of every assumption in the model: explicit, implicit, inferred,
and contested. **Owner directive (2026-07-27): the 71 seed `model_output` rows from the
lost prototype are a REFERENCE, not truth.** On 2026-07-27 the owner made the v2b model
(as documented in the prototype's own `CAWR.xlsx` "Assumptions"/"Model & Method" tabs)
canonical, and the reference outputs were **regenerated from our engine**; the prototype's
originals are preserved per-vehicle as `model_output_prototype` (revision-log ethos: keep
old numbers, never delete). Update this file whenever an assumption is added, changed,
generalized, or retired. Statuses:

- **SOURCED** — traceable to a real dataset/publication
- **DOCUMENTED** — stated in the prototype's own docs (CAWR.xlsx tabs)
- **JUDGMENT** — a deliberate, labeled modeling choice with no external source
- **USER-SPECIFIC** — true for the owner's situation only; must become a user input before general release

## A. User-specific assumptions to generalize (all become inputs; owner's values are the defaults)

| Assumption | Value | Status | Generalization path |
|---|---|---|---|
| Annual mileage | 13,000 mi/yr | USER-SPECIFIC, user-confirmed not measured | intake question; biggest single lever |
| Insurance multiplier | ×0.80 (USAA active-duty), applied to full coverage AND the $1,176 liability floor | USER-SPECIFIC | engine input; an explicit real-quote input bypasses the multiplier entirely |
| Registration | $55/yr flat (FL home-of-record) | USER-SPECIFIC | **IMPLEMENTED (Task E)** — per-state table (`apps/web/src/region.ts`), applied via the ZIP intake question and now also a rail control (`registrationUsdYr`); still omits one-time title fees and states' separate ad valorem vehicle property tax (see §G) |
| Gas / electricity | $5.455/gal / $0.32 kWh (CA) | USER-SPECIFIC | **IMPLEMENTED (Task E)** — ZIP-derived regional prices (see §G); `DEFAULTS` in `controls.tsx` unchanged, region data is an optional overlay applied only when the intake's ZIP resolves |
| Use tax on purchase | 7% (CA rate; `constants.use_tax_rate`, engine input `useTaxRate`) | USER-SPECIFIC + DOCUMENTED | **IMPLEMENTED (Task E)** — per-state rate from ZIP (see §G); local/county add-ons not modeled |
| EV home charging | ~85% home / 15% DCFC baked into the ×1.09/×1.06 electricity multipliers | USER-SPECIFIC + DOCUMENTED | intake question; no-home-charger raises EV $/mi sharply |
| Discount rate | 7%/yr real (xlsx narrative says 5% in places; 7% is operative) | DOCUMENTED | already a live input; r=0 = "ignore opportunity cost" |

## B. Model structure (v2b, canonical since 2026-07-27 — all implemented in `@opencawr/core`)

| Mechanism | Form | Status |
|---|---|---|
| Cost equation | [dep + use tax + Σ disc(maint, ins, reg, total-loss, repairs) + tires + battery] ÷ miles + energy × avg discount factor | DOCUMENTED |
| Depreciation | price curve at buy odo → resale (scrap at EOL; curve value at earlier sell), extrapolated, floored at scrap | DOCUMENTED |
| Use tax | rate × purchase price at t0 | DOCUMENTED |
| Total-loss exposure | 1.5%/yr × $750 deductible while full-coverage; × full book value when liability-only. Does NOT truncate life (open limitation) | DOCUMENTED |
| Insurance | per-model premium (pre-multiplier in data) × multiplier; liability-only once book < $6k; noise Normal(1, 0.08) per year | DOCUMENTED |
| Major-repair tail | Poisson past 120k mi, hazard ×(1+(odo−120k)/100k); cost lognormal σ=0.5 × make-mult × year-mult + $600 hassle | DOCUMENTED |
| Calendar-age escalator | ×(1 + 2%/yr past age 8) on scheduled maintenance AND repair-event costs (doc says "repairs"; broad reading is a JUDGMENT). Age = odo ÷ annual miles — real calendar age still open (worst for garage-kept/passion cars) | DOCUMENTED + JUDGMENT |
| Year-reliability multiplier | landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95, repair costs only | DOCUMENTED |
| Battery | per-vehicle data fields (prob, pack $, σ): EV 30%×$12k, Tesla 30%×$14k, Leaf 55%×$8k, PHEV 22%×$4k, hybrid 15%×$2.5k; Bernoulli × lognormal at 65% of life | DOCUMENTED (values are labeled judgment) |
| Energy | outside the Monte Carlo (deterministic horizon); EV kWh ×1.08 degradation; elec ×1.09 EV / ×1.06 PHEV DCFC premium; 0%/yr price escalation | DOCUMENTED |
| EOL | `eol_maintained_miles` = iSeeCars empirical × 1.30 "maintained" bonus (baked in); lognormal dispersion per tier (§C) | SOURCED × JUDGMENT |
| Opportunity cost | ONLY via discounting; +5%/yr capital charge proven double-counting, removed v2b | DOCUMENTED |
| Sport/passion vehicles | NO special-case rule (owner decision): a vehicle of passion runs through the same engine with its own inputs (low annual miles, chosen horizon, curve-based resale). The calendar-age limitation bites hardest here | OWNER DECISION |
| Monte Carlo | N=1,100 default, seed 42, own deterministic PRNG; P50 stability ~±$0.004 across seeds | DOCUMENTED |

## C. Distribution parameters (resolved 2026-07-27)

| Parameter | Value | Status |
|---|---|---|
| EOL dispersion σ | per tier: low 0.10 / mid 0.12 / high 0.15 / sport 0.15 (`constants.eol_sigma_by_tier`) | OWNER DECISION (spec §10 fix; prototype's uniform 0.12 was DOCUMENTED, its published bands implied ~0.07 — superseded by regeneration) |
| Repair cost σ | 0.50 lognormal per event | DOCUMENTED |
| Insurance noise | Normal(1, 0.08) per year | DOCUMENTED |
| Battery cost σ | per-vehicle field (0.35 EV / 0.40 PHEV+hybrid) | DOCUMENTED |

## D. Data-quality flags (seed set)

- **`model_output` is generated by our engine** (meta.reference_engine records draws/seed/date); `model_output_prototype` is the lost prototype's original — historical only, never asserted.
- **Porsche 996 Carrera / Turbo**: prototype rows used a special sport rule (70k-mi hold, resale ≈ purchase). Our reference computes them drive-to-death like everything else — their headline $/mi is not meaningful for a passion-use case; use per-car inputs instead.
- **Fiat 500**: all model years marked `bad` (v2b audit: "no 500 model year is reliable") — encoded in data, not code.
- **Maintenance curves shared** across 43 cars (`maintenance_curve_shared_with` field) — per-car precision is an illusion; fine for tiers, not head-to-head claims.
- **Kia K4** is `proxied` (no used history); inherits every proxy assumption.
- **Reliability tiers + per-make multipliers are judgment calls** (xlsx Part 4c), and reliability data traces to Consumer Reports → **public-launch blocked** until re-derived from NHTSA/CarComplaints/RepairPal (spec §9).
- The prototype's Any-Car Calculator used a *simpler second model* — never port it; one engine only.

## E. Decision log / open items

| Date | Item | Resolution |
|---|---|---|
| 2026-07-27 | Canonical model | v2b structure implemented; reference outputs regenerated from our engine; prototype numbers preserved as `model_output_prototype` |
| 2026-07-27 | EOL dispersion | per-tier σ (see §C) |
| 2026-07-27 | Battery / Fiat / shared-curve data fixes | approved and applied to `opencawr_data.json` |
| 2026-07-27 | Sport class | no hard-coded rule; passion vehicles = same engine, per-car inputs |
| OPEN | Real insurance quotes | premiums remain per-model estimates until the owner provides real USAA numbers (engine accepts `fullCoverageUsdYr` as-is) |
| OPEN | Real calendar age as a state variable | age is still odometer-derived; garage-kept old cars under-aged (matters most for passion vehicles) |
| OPEN | Total-loss life truncation | a totaled car should end the holding period; currently only an annual $ charge |
| OPEN | Reliability re-derivation (launch gate) | NHTSA/CarComplaints/RepairPal pipeline — spec §9, blocks public launch |
| 2026-07-27 | P75 ("protects against bad luck") rank basis | Web UI adds a second ranking, sorted and tie-tiered on each car's P75 draw instead of P50, reusing the same `tieTierBeatProb` (0.85) threshold for the tier walk. JUDGMENT: no separate significance threshold was defined for the P75 ordering; the P50 threshold is assumed to transfer unchanged. |
| 2026-07-28 | Deal Analyzer reliability caveat | Task B/D's per-vehicle `launchBlocked` provenance flag does not exist yet on `Vehicle` (assemble.ts hasn't landed). JUDGMENT: every scored deal unconditionally shows the same "reliability inputs are seed data pending public re-derivation" note (global launch gate) rather than a per-vehicle conditional; revisit once `launchBlocked` lands. |
| 2026-07-28 | Deal Analyzer bad-model-year note | Uses the *user-entered* listing year against `model_year_reliability`, distinct from the odometer-implied year used for the feasibility note (reused verbatim from the Rankings view's `feasNote`). JUDGMENT: a real listing's actual year is a more direct reliability signal than the odometer/annualMiles-derived year. |
| 2026-07-28 | Intake + ZIP regionalization + soft filters (Task E) | See §G for the full data write-up. JUDGMENT: (1) a "Vehicle registration" `NumberControl` was added to the Assumptions rail (`controls.tsx`) even though the brief didn't explicitly ask for a new rail control — `registrationUsdYr` is one of the four `EngineInputs` fields the region table sets, and the rail's own disclaimer already promises "every assumption is editable above"; leaving it silently set with no visible/editable control would break that promise. (2) The seats-needed intake question defaults to blank ("no preference"), not a real number — so skipping through the intake, or leaving that one field empty, never silently activates a filter the user didn't ask for. (3) A small "Filtering: seats ≥ N · Clear" line was added next to the results controls — the brief didn't ask for this affordance, but a stateful filter that can only ever be *set* (the intake shows once per browser, ever) with no way to *clear* it without a page reload would be a real usability dead end, not a speculative feature. |
| 2026-07-28 | Reliability re-derivation (Task D) validation report | `npm run reliability-report -w @opencawr/pipeline` derives tiers for the 6 named seed models (docs/reliability-methodology.md) from real NHTSA complaint fixtures: **4/6 agree with the current seed `reliability_tier`** (Mazda CX-5, Kia Sorento, Ford Escape, Honda Odyssey match; Toyota Corolla and Fiat 500 don't — see §F row below for why). **`opencawr_data.json` was NOT modified** — rewriting seed tiers stays an owner review gate; this is still OPEN, now with real evidence attached. |

## F. Pipeline (`@opencawr/pipeline`, Task B) assumptions

| Assumption | Value | Status | Notes |
|---|---|---|---|
| Caution model-year heuristic | A model year is flagged `caution` when its NHTSA `complaintsByVehicle` count > 2× the median count across the queried model years (`good` otherwise; `bad` is never derived here) | JUDGMENT | Placeholder only — `model_year_reliability` and `reliability_tier` are always emitted with `launchBlocked: true` until Task D's real reliability re-derivation lands; matches the launch gate in §D above |
| Segment-peer "footprint" proxy (revised, code review) | Within the same `body` + `etype` pool of **`provenance: "curated"`** seed vehicles: (1) pre-filter to peers sharing the query's EPA **size tier** — a coarser-than-VClass bucket (`micro`/`compact`/`midsize`/`large`/`small-suv`/`standard-suv`/`small-truck`/`standard-truck`/`minivan`/`van`/`two-seater`; subcompact cars and small station wagons/hatchbacks group with compact, minicompact stays its own smaller tier) computed from each candidate peer's own real, live-fetched EPA VClass at its `pinned_buy_year_est` — falling back to the full body+etype pool if no peer shares the tier or none could be resolved; (2) within that pool, tiebreak by `mpg_combined` (`kwh_per_100mi` for EVs) distance, as before | JUDGMENT | **Original v1 (mpg-distance only, no size pre-filter, no curated-only guard) picked Fiat 500 — a Minicompact-tier, high-repair-multiplier, steep-depreciation peer — for a Honda Fit, an EPA Small-Station-Wagon/Compact-tier car; unflagged fields (price curve, maintenance curve, repair multiplier) fed straight into costPerMile.** Real EPA VClass for the query is already parsed (epa.ts); the fix additionally fetches real VClass for each same-body+etype seed candidate (`proxy.ts`'s `peerSizeTier`, via the existing EPA adapter + fixture/cache infra) rather than inventing a synthetic size signal. A handful of seed peer names don't form a valid EPA query string naively (`"VW Passat"` → make is `"volkswagen"` not `"VW"`; `"Mini Cooper"` needs EPA's exact `"MINI"`/`"Cooper Hardtop 2 Door"` strings) — small explicit override table in `proxy.ts`. Real EPA data also has a few live-confirmed gaps (bare `"Civic"`, `"3"`, `"K4"` model strings return no data under fueleconomy.gov's API) — those peers resolve to `unknown` tier and only ever appear in the fallback pool, never falsely tier-matched. With Honda Fit, this now yields **Toyota Corolla** (both size-tier and mpg match) instead of Fiat 500. Already-proxied peers (e.g. Kia K4) are now excluded from eligibility entirely, to avoid chaining proxy-of-proxy uncertainty. Every field the peer supplies (price curve, maintenance curve, EOL, tiers, seats, cargo, insurance, battery, shared-maintenance-curve flag) is marked `source: "proxy"` and the assembled vehicle gets `provenance: "proxied"` |
| EPA body/etype mapping | `atvType`/`fuelType1` → etype (ev/phev/hybrid/gas); EPA `VClass` string-matched to the seed's body vocabulary (Car/SUV/SUV AWD/Van/Truck/Sport), then folded with etype for ev/phev (e.g. "EV SUV", "PHEV SUV AWD") to mirror seed convention | JUDGMENT | No canonical EPA→seed body mapping exists; string-matching VClass keywords is the simplest defensible heuristic |
| EV/PHEV tailpipe CO2 | For `etype: "ev"`, EPA's `co2TailpipeGpm` (~0) is discarded and `co2_g_per_mi` falls back to the segment peer instead | JUDGMENT | Seed's `co2_g_per_mi` is a grid/upstream-emissions estimate for EVs, not raw tailpipe; using EPA's ~0 tailpipe value would misrepresent that convention |
| Default query year window | `[currentYear − 9, currentYear]` when `assembleVehicle` isn't given `years` | JUDGMENT | Wide enough to catch most discontinued models (e.g. Honda Fit, last sold 2020) without an explicit range |
| VPIC model normalization | `make`/`model` casing normalized against NHTSA VPIC `getmodelsformake/{make}` (case-insensitive match); input passed through unchanged if no match | JUDGMENT | Keyless, free; only case-normalizes, doesn't correct misspellings |

## G. ZIP regionalization + intake + soft filters (`apps/web`, Task E)

| Assumption | Value | Status | Notes |
|---|---|---|---|
| Per-state region table (`apps/web/src/region.ts`) | 50 states + DC, each with `gasUsdPerGal`, `elecUsdPerKwh`, `useTaxRate`, `registrationUsdYr` | SOURCED | gas: AAA state avg retail regular gasoline (snapshot ~2026-07-27); electricity: EIA state avg all-sector price, as compiled/republished by ElectricChoice.com's EIA-sourced state table (~2026-07); use tax: state DOR/DMV published vehicle sales-or-use tax rate (statewide statutory rate — local/county add-ons, which run several more points in some states, are NOT modeled); registration: midpoint of the state DMV's published base annual registration-fee *range* (autoinsurance.org compilation) — excludes one-time title/plate fees and the separate recurring ad valorem vehicle property tax some states charge (CT, VA, MS, RI and others) — that property tax is a real, sizeable, and harder-to-generalize annual cost, logged here as an OPEN item rather than folded into `registrationUsdYr` |
| DC use tax / registration | 6% / $100/yr | JUDGMENT | DC wasn't in the compiled 50-state tax/registration source tables (both are state-level compilations that skip DC); estimated separately from DC OTR/DMV published rates and flagged with a distinct `sources` string in `region.ts` (`SOURCES_DC`) rather than silently reusing the 50-state methodology string |
| ZIP→state prefix table (`region.ts`'s `ZIP3_RANGES`) | ~50 contiguous ZIP3 ranges | SOURCED | USPS assigns ZIP3 prefixes in contiguous blocks per state — the standard public-domain "ZIP Code prefix" chart. Representing it as ~50 ranges is functionally equivalent to enumerating all ~900 individual 3-digit prefixes (every prefix in a range resolves to that range's state) but far more reviewable. A handful of prefixes are deliberately left unmapped — military APO/FPO (090-098), Puerto Rico/territories, a couple of single-digit edge cases — `stateForZip`/`regionForZip` return `null` for these; the intake card treats `null` as "ZIP not recognized" and falls back to the current defaults, never blocking |
| Intake card (`apps/web/src/intake.tsx`) | First-visit only (localStorage key `opencawr:intake-seen`), dismissible via "×" or "Skip — use defaults", 4 questions (ZIP, miles/yr, seats needed, how long you'll keep it) | OWNER DECISION (brief) | Writes directly into the same `EngineInputs` state `App` passes to the rail (`onApply` → `setInputs({...inputs, ...patch})`) — no parallel copy. The "how long you'll keep it" question reuses the rail's own `HORIZONS` array/labels verbatim (50k/100k/150k/until it dies) so the two surfaces can never drift. Region fields (gas/elec/tax/registration) are only patched in if the ZIP resolves; miles/yr and hold-horizon are always applied on "Use this" (harmless even if left at their prefilled defaults) |
| Seats-needed soft filter | New `minSeats: number \| null` state in `App.tsx`, set only by the intake card | OWNER DECISION (brief) | Dims (opacity 0.35) rows/bars where `car.seats < minSeats`, in both the ranking table (`row-dimmed` class + "misses 1 filter" appended to the car-meta line) and the Ladder (`dimmed?: Set<string>` prop, opacity on the row's `<g>`, "misses 1 filter" folded into the SVG `aria-label`/`<title>`, plus a one-line caption addendum "Faded = misses your seats filter.") — never removes a row, per the brief. JUDGMENT: only one filter dimension exists today, so the note text is hardcoded to the singular "misses 1 filter"; if a second filter dimension is ever added this needs to become a count |
| OPEN | Ad valorem vehicle property tax | Several states (CT, VA, MS, RI, and others) charge a real recurring annual property tax on vehicles, distinct from and often larger than the flat DMV registration fee modeled here — not generalized in this task; `registrationUsdYr` remains DMV-fee-only |
| OPEN | Local/county sales tax add-ons | `useTaxRate` is the state statutory rate only; local add-ons (up to several more points in some states) are not modeled |
## H. Reliability re-derivation (`@opencawr/pipeline`, Task D — launch gate) assumptions

Full derivation: `docs/reliability-methodology.md`; implementation: `src/reliability/derive.ts`;
validation report: `npm run reliability-report -w @opencawr/pipeline` (`src/reliability/report.ts`).
**Does not modify `opencawr_data.json`** — see §E row above.

| Assumption | Value | Status | Notes |
|---|---|---|---|
| Complaints-per-1000-sold proxy | `complaints(modelYear) / max(1, currentYear − modelYear)` ("years-on-road"), median across a model's queried model years = its raw score | JUDGMENT | No free/keyless sales-volume data exists; this substitutes calendar time for sales as the exposure denominator. **Validated limitation (see below): this proxy still tracks absolute NHTSA complaint volume, which itself correlates with sales volume** — a genuinely low-volume model can score as "more reliable" than a high-volume one with the same or worse real defect rate, purely because it generated fewer total complaints. This is exactly why the Fiat 500 (US sales were a small fraction of Corolla's) derives `low` against a seed `high`: its raw NHTSA complaint counts (0-92/yr across MY2015-2019) are far smaller in absolute terms than the high-volume Corolla's (95-302/yr), even though per-car-owned the 500 is the more failure-prone vehicle. Flagged, not solved — no free sales data to solve it with |
| Body-class normalization | `index(model) = rawScore(model) / median(rawScore of all models sharing the same seed `body` value, within the batch being derived)` | JUDGMENT | "Batch" = only the 6 named seed models for this task, not the full ~90-vehicle seed corpus (out of scope — see open item below). 2 of the 4 `body` groups among the 6 (`SUV AWD`: Sorento only; `Van`: Odyssey only) are singletons, so their `index` is trivially `1.0`; only the `Car` (Corolla/Fiat 500) and `SUV` (CX-5/Escape) pairs get a real same-body comparison |
| Quartile → tier mapping | `index ≤ Q1 → low`; `Q1 < index ≤ Q3 → mid`; `index > Q3 → high`; `Q1`/`Q3` = 25th/75th percentile (linear interpolation between order statistics, numpy's default "linear" method) of `index` across the whole batch | JUDGMENT | Literal reading of the brief's "map quartiles → tiers low/mid/high"; `sport` is never derived (owner judgment for passion vehicles, unaffected). **Undisclosed-until-review cross-contamination effect (launch-gate review finding, fixed by disclosure not by re-tuning the math)**: `Q1`/`Q3` are computed once across all 6 models' `index` values together, so Sorento's and Odyssey's artificial `1.0`s (see row above) are two of the six numbers deciding where the cut points land — they shift `low`/`high` band width for Corolla/CX-5/Escape/Fiat 500 too, not just place themselves. With this 6-model batch the two `1.0`s land mid-sort, pulling `Q1`/`Q3` toward the center and narrowing the bands. Documented in `docs/reliability-methodology.md` §3 and surfaced as a one-line caveat in the `reliability-report` output; the real fix (a larger reference set with no singleton body classes, or excluding singleton-body models from the shared quartile computation) is a methodology decision for the owner, not something patched silently here |
| Landmine year | `complaints(Y) > 2 × median(complaints across the model's queried years)` (raw counts, not the years-on-road rate) **AND** `powertrainShare(Y) > 0.30`, where `powertrainShare` = the fraction of year `Y`'s complaints whose NHTSA `components` field has a top-level category starting with `ENGINE`, `POWER TRAIN`, or `TRANSMISSION` | JUDGMENT | Values (`2×`, `30%`, the 3 keyword prefixes) are exactly what the task brief specifies, not independently derived. Distinct from (and intended to eventually replace) `assemble.ts`'s placeholder `caution`-only heuristic (§F above), which has no component check and never emits `bad` |
| `components` field retained per-complaint | NHTSA `complaintsByVehicle` results' `components` string (comma-separated category list) is fetched and kept (`src/sources/nhtsa.ts`'s new `complaintComponents`), alongside the pre-existing counts-only `complaintCounts` | JUDGMENT | Still no complaint `summary` (free text) or `vin` is ever fetched into this field — matches the "counts only" discipline the module docstring already states; `components` is a structured category, not text or an identifier |
| Reference-year windows (6 named models) | Corolla/CX-5/Sorento/Escape/Odyssey: MY2018-2022 (still in production); Fiat 500: MY2015-2019 (discontinued after MY2019) | JUDGMENT | Recent-enough used-car-relevant window kept small (5 years/model) given NHTSA's `complaintsByVehicle` endpoint's real-world latency (~15-30s/request, occasional 504s under concurrent load) |
| OPEN | Full-corpus reliability re-derivation | This task validates the methodology against 6 named models only; re-deriving (and then, as a separate owner-approved step, writing) tiers for the full seed corpus is future work — see §E's Task D row |
