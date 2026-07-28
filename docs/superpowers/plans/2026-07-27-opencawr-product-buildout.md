# OpenCAWR Product Buildout — Implementation Plan (steps 4–6 + vision)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the OpenCAWR build order — rankings visual layer (step 4), Deal Analyzer (step 5), any-car data pipeline (step 6) — plus the owner-approved intake/regionalization flow.

**Architecture:** One pure cost engine (`@opencawr/core`) consumed by a Vite+React app (`apps/web`, engine in a Web Worker) and a new data-pipeline package (`packages/pipeline`). All charts are SVG components fed by worker output; all new data carries provenance.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest, Observable Plot is NOT used — charts are hand-rolled SVG (no new runtime deps without strong reason).

## Global Constraints (every task inherits these)

- **ONE engine.** Never re-implement cost math outside `packages/core/src/engine.ts`. UI/pipeline consume it.
- **Reference tests are exact.** `npm test -w @opencawr/core` (89 tests) must stay green. If a task deliberately changes model numbers it must run `npm run gen-reference -w @opencawr/core`, and say so in the commit body — never to fix an accidental failure.
- **Node ≥ 20**: use `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (default node is v16 and fails).
- **Assumptions ledger**: any new assumption (constant, threshold, data source) gets a row in `ASSUMPTIONS.md` in the same commit.
- **Copy**: outputs are "estimates, not advice" — never "buy this" language. Plain sentence case.
- **Launch gate**: nothing may present seed reliability data as shippable; keep the pending-re-derivation footer note.
- **Design tokens** (already in `apps/web/src/styles.css`): paper `#E8EAEC`, panel `#F4F5F6`, ink `#14191D`, muted `#5C6870`, needle `#C7350F` (reserved for live/changed values), band `#7C8B94`, rule `#C9CED2`; Archivo (UI) + IBM Plex Mono (all numerals). No new colors except the tier ramp defined in Task A.
- **Charts**: before writing any chart code, invoke the `dataviz` skill (Skill tool) and follow it.
- **Commits**: small, imperative subject, body explains why; end with the project's Co-Authored-By trailer.
- **No Consumer Reports data anywhere.**

## File map (who owns what)

- Task A: `apps/web/src/charts/Ladder.tsx` (new), `apps/web/src/charts/tierColors.ts` (new), `apps/web/src/App.tsx`, `apps/web/src/controls.tsx`, `apps/web/src/styles.css`, `apps/web/src/engine.worker.ts` (extend RankedRow only)
- Task B: `packages/pipeline/**` (all new), root `README.md` (new, short)
- Task C: `apps/web/src/deal/DealAnalyzer.tsx` (new), `apps/web/src/deal/score.ts` (new in worker scope), `apps/web/src/engine.worker.ts` (add deal message), `apps/web/src/App.tsx` (tab strip)
- Task D: `packages/pipeline/src/reliability/**` (new), `docs/reliability-methodology.md` (new)
- Task E: `apps/web/src/intake/**` (new), `apps/web/src/region.ts` (new static dataset), `apps/web/src/App.tsx`
- Task F: `apps/web/src/charts/Heatmap.tsx`, `apps/web/src/charts/Sensitivity.tsx` (new), detail drawer in `App.tsx`

Wave 1 = A ∥ B (disjoint). Wave 2 = C ∥ D (C after A; D after B). Wave 3 = E then F.

---

### Task A: Rankings visual layer (build-order step 4)

**Files:** see map. **Test:** `apps/web` has no test rig — gate is `npm run build -w @opencawr/web` clean + visual check via dev server.

**Interfaces:**
- Consumes: `RankedRow` from `engine.worker.ts` (p50/p75/p90/p05/p95, statTier, beatsNext).
- Produces: `<Ladder rows={RankedRow[]} rankBasis={"p50"|"p75"} />`; `tierColor(tier: number): string` in `charts/tierColors.ts`.

- [ ] **Invoke the `dataviz` skill before any chart code.**
- [ ] **Tier color ramp** (`tierColors.ts`): a sequential ink-depth ramp (tier 1 darkest → later tiers lighter grays), NOT a rainbow; must read on the paper background and pass 4.5:1 for text chips. Export `tierColor` + `tierTextColor`.
- [ ] **Uncertainty ladder** (`Ladder.tsx`): horizontal dot-and-whisker SVG, one row per car sorted by current rank basis: whisker = P05–P95, thicker inner bar = P50→P75, dot = median, colored by `tierColor(statTier)`. X axis in $/mi with gridlines; car names as y labels (mono, 11px). Height = rows × 22px, responsive width via viewBox + preserveAspectRatio, horizontal-scroll container on mobile. Hover/focus a row → tooltip with exact numbers (title attr is acceptable v1). The caption must state: *overlapping bars = the model cannot tell these cars apart.*
- [ ] **Rank-basis toggle** in `controls.tsx`: "Rank by: [expected cost (P50)] [protects against bad luck (P75)]" — plain-English descriptors per owner decision. It re-sorts table + ladder by the chosen quantile (recompute NOT needed — same draws; sort client-side; tie tiers still computed on P50 by the worker — pass both orderings from worker: add `rankP75: number` to `RankedRow` by sorting p75 in the worker and reusing `rankWithTiers` with p75 as the sort key for tier assignment when basis=p75; simplest correct approach: worker computes and returns TWO ranked arrays, `byP50` and `byP75`, each with its own tiers/beatsNext).
- [ ] **Tie-tier coloring in the table**: row left-border (3px) in `tierColor`, tier chip background matching. Keep the tier-start rules.
- [ ] **View switcher**: "Table / Ladder" segmented control above results (same `.seg` styles).
- [ ] **Verify**: `npm run build -w @opencawr/web` clean; dev-server screenshot shows ladder with visibly overlapping tier-1 bars at defaults.
- [ ] **Commit** (subject: `feat(web): uncertainty ladder, tier colors, P50/P75 rank basis`).

### Task B: Pipeline package skeleton + EPA/NHTSA adapters (build-order step 6, part 1)

**Files:** `packages/pipeline/{package.json,tsconfig.json,src/...,test/...}` — mirror `packages/core` config (type module, vitest, tsx). Name `@opencawr/pipeline`. Depends on `@opencawr/core` for types only.

**Interfaces:**
- Produces: `assembleVehicle(query: {make: string; model: string; years?: [number, number]}, opts?): Promise<{vehicle: Vehicle; report: ProvenanceReport}>` in `src/assemble.ts`; `ProvenanceReport = { field: string; source: "epa"|"nhtsa"|"seed"|"proxy"; detail: string; launchBlocked?: boolean }[]`.
- Sources (free, keyless): EPA fueleconomy.gov REST (`https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=&make=&model=`, then `/ws/rest/vehicle/{id}` — XML; request JSON via `Accept: application/json`); NHTSA complaints API (`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=&model=&modelYear=`), NHTSA VPIC for make/model normalization (`https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/{make}?format=json`).
- [ ] **HTTP layer** `src/fetchCached.ts`: fetch with 1 retry, 10s timeout, on-disk cache in `packages/pipeline/.cache/` keyed by URL hash (JSON files, gitignored). All tests run from recorded fixtures in `test/fixtures/` — no network in CI (`OPENCAWR_PIPELINE_OFFLINE=1` forces fixtures; tests set it).
- [ ] **EPA adapter** `src/sources/epa.ts`: `epaSpecs(make, model, year) → {mpg_combined, kwh_per_100mi, etype hints}` mapped to the `VehicleSpecs` shape. Record one real response as a fixture (Toyota Camry 2020) during development, commit the fixture.
- [ ] **NHTSA adapter** `src/sources/nhtsa.ts`: `complaintCounts(make, model, years[]) → {year, complaints, odiIds}[]` (counts only — store no complaint text beyond IDs).
- [ ] **Assembly** `src/assemble.ts`: builds a partial `Vehicle` — specs from EPA; `model_year_reliability` heuristic = years whose complaint count > 2× the model's median year flagged `caution` (documented in ledger as JUDGMENT); everything else (price curve, EOL, maintenance curve, tiers) falls back to **segment-peer proxy**: pick the seed vehicle with same body+etype and closest footprint, copy its curves, mark every proxied field `source: "proxy"` and the vehicle `provenance: "proxied"`. Reliability fields always `launchBlocked: true` until Task D lands.
- [ ] **CLI** `src/cli.ts` (`npm run assemble -w @opencawr/pipeline -- "Honda" "Fit"`): prints the assembled vehicle JSON + provenance table, and the engine's p50 for it (import `costPerMile` — proving the pipeline output feeds the ONE engine).
- [ ] **Tests** (vitest, fixtures only): adapter mapping, proxy fallback picks correct peer, assembled vehicle passes a schema check and runs through `costPerMile` without NaN.
- [ ] **Ledger + commit** (`feat(pipeline): EPA/NHTSA adapters, proxy assembly, CLI`) — add ASSUMPTIONS.md rows for the caution heuristic and proxy rules.

### Task C: Deal Analyzer (build-order step 5)

**Interfaces:**
- Consumes: engine worker; `Ladder` from Task A.
- Produces: worker message `{kind:"deal", id, inputs, deal:{vehicleName, year, odo, price}}` → `{kind:"deal", id, percentile, cpm: EngineSummary, priceVsCurveUsd, notes: string[]}`.

- [ ] **Scoring** in worker: run `costPerMile(vehicle, constants, {...inputs, buyOdo: deal.odo, purchasePrice: deal.price})`; percentile = fraction of the FIELD's pooled default-input p50s the deal's p50 beats is WRONG — instead: (a) deal-vs-itself: where `deal.p50` falls inside the deal car's own default-buy draw distribution (`fraction of drawsCpm < deal.p50`), (b) rank position: insert deal.p50 into the current 71-car p50 ranking, (c) `priceVsCurveUsd = deal.price − curveAt(priceCurve at deal.odo)` (import `curveAt`/`parseCurve` from core). Notes: bad-model-year membership (`model_year_reliability`), feasibility direction (reuse `feasNote` wording), `launchBlocked` reliability caveat.
- [ ] **UI** `deal/DealAnalyzer.tsx`: form (vehicle dropdown from the 71, year, odometer, price paid) → results panel: "$X.XXX/mi — cheaper than N of 71 modeled cars"; "listed $Y above/below the modeled curve at this mileage"; percentile phrased as *"an 18th-percentile outcome for this model at this odometer"*; the deal rendered as an extra needle-red row injected into the `Ladder`. Copy stays estimate-toned; NEVER "good deal/bad deal".
- [ ] **Tab strip** in `App.tsx`: "Rankings / Deal Analyzer" using `.seg` styles; state preserved when switching.
- [ ] **Verify** build + screenshot (deal row visible in ladder); **commit** (`feat(web): deal analyzer with percentile scoring`).

### Task D: Reliability re-derivation (launch gate — step 6, part 2)

- [ ] **Methodology first** (`docs/reliability-methodology.md`): tier = quartiles of complaints-per-1000-sold... sales denominators are unavailable free — document the chosen proxy: complaints per model-year per year-on-road, normalized within body-class; map quartiles → tiers low/mid/high (sport stays judgment). Landmine years = years > 2× model median complaints AND a powertrain component share > 30% (NHTSA `components` field). All thresholds are JUDGMENT rows in the ledger.
- [ ] **Implementation** `packages/pipeline/src/reliability/derive.ts` + fixtures for 6 seed models spanning tiers (Corolla, CX-5, Sorento, Escape, Fiat 500, Odyssey).
- [ ] **Validation report** `npm run reliability-report -w @opencawr/pipeline`: derived tier vs seed tier for those 6; agreement table printed. DO NOT rewrite seed tiers in data yet — that is an owner review gate; the report is the deliverable.
- [ ] **Commit** (`feat(pipeline): NHTSA-based reliability derivation + methodology`).

### Task E: Intake + ZIP regionalization (vision step 1)

- [ ] `region.ts`: static per-state table {gas $, elec $, use-tax %, registration $/yr} (EIA 2025 state averages for energy; state DMV/DOR published rates for tax/reg — cite source per row in a `sources` field; ledger rows). ZIP→state via first-3-digit prefix table (static, ~900 entries, public-domain).
- [ ] Intake card (first visit, dismissible, never a gate): 4 questions — ZIP, miles/yr, seats needed, how long you'll keep it — writing into the SAME `EngineInputs`/filter state the rail edits; "skip" uses defaults.
- [ ] **Soft filters**: seats filter grays non-matching rows/bars (opacity .35 + "misses 1 filter" note), never removes. Filter state in App, applied in table + ladder.
- [ ] Verify + commit (`feat(web): intake flow, ZIP regionalization, soft filters`).

### Task F: Survey heatmap + sensitivity charts (§6.1, §6.4)

- [ ] Invoke `dataviz` skill. Worker message `{kind:"survey", vehicleName}` → grid of p50 over buyOdo × holdMiles (12×8 grid, engine per cell at draws=400 for speed — document the reduced-draws tradeoff in ledger); infeasible cells (two-sided rule) grayed.
- [ ] `Heatmap.tsx` (green=cheap sequential ramp consistent with dataviz skill guidance) in a per-car drawer opened from table row click; drawer also shows the breakdown (stacked bar from `EngineResult.breakdown`) — worker must return breakdown for the selected car.
- [ ] `Sensitivity.tsx`: p50 vs annual-mileage and vs gas price lines for the selected car (10 points each, draws=400).
- [ ] Verify + commit (`feat(web): survey heatmap, breakdown, sensitivity charts`).

### Deferred (planned, not dispatched)

- Community deals + accounts (needs Supabase auth — currently unauthenticated in tooling; owner QC requirements recorded in DECISIONS.md).
- Passion-vehicle preset (per-car annual miles/horizon UI) — small; fold into a later UI pass.
- Licensed listing feeds (Marketcheck) for price curves — §9 requires fitted coefficients only.

## Self-review notes

- Spec coverage: §6.1 (F), §6.2 (A), §6.3 (C), §6.4 (A+F), §7 (B+D), §4 inputs (done step 3 + E regionalization), §9 gate (D + persistent footer). Community layer deferred explicitly.
- Interfaces named consistently: `RankedRow`, `tierColor`, `assembleVehicle`, `curveAt` all match existing exports.
- No placeholder steps; thresholds that are judgment calls are marked as ledger rows rather than left vague.
