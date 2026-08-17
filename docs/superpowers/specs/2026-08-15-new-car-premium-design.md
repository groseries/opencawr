# New-car premium vs sweet spot — design

2026-08-15. Drawer-only feature: for the selected car, show how much more a buyer pays
choosing the newest available model year over the car's own cost-minimizing sweet spot,
at each fixed holding-period preset.

## Motivation

Ad hoc analysis this session (buy-point sweep across Prius/RAV4/Model 3 at 100k/150k
holds) showed the new-vs-used premium varies a lot by car and by hold length — from
~0% (Prius, RAV4 at 150k) to over 10% (RAV4, Model 3 at 100k). That's a useful number
per car, not just for three cars picked ad hoc. This makes it a permanent, per-car
figure in the drawer, computed live from the same engine, for every vehicle in the
catalogue (71 today, ~150 after the separate catalogue-expansion effort — see
"Scales with the catalogue" below).

## Placement

New drawer section, between the existing "Survey: buy point x hold miles" (Heatmap)
section and "Model years: which year is the best buy" section in
`apps/web/src/drawer/CarDrawer.tsx`. Per-car, not a field-wide list — consistent with
every other drawer panel (Heatmap, Model years, Breakdown, Sensitivity all answer for
one selected car).

## Data source — no new engine calls

`engine.worker.ts`'s `handleModelYearRank` already computes, for each numeric hold in
`HORIZONS` (50k/100k/150k — `apps/web/src/horizons.ts`), a full `modelYearRank(vehicle,
constants, { ...inputs, holdMiles })` result. That result's `points` array (one entry
per feasible model year, sorted by year ascending — `packages/core/src/modelyear.ts`,
`modelYearViewOf`) already contains, at `points[points.length - 1]`, the vehicle's
newest feasible model year (`vehicle.last_year`) priced at ITS OWN cheapest odometer
within that year's band. The same result's `bestP50`/`bestYear`/`bestOdo` is the sweep's
sweet spot (by construction, since rank 1 of that same grouped grid).

So "new" and "sweet spot" are both already computed inside the existing `byHold` loop —
adding this feature costs zero additional `costPerMile` calls and zero additional
worker request/response round trips. This was chosen over a new `newpremium` request
kind (which would re-run `priceAtSweetSpot` and double worker traffic for numbers
already in hand).

## Type change

Extend `ModelYearBestAtHold` (`apps/web/src/engine.worker.ts`) with:

```ts
newYear: number;
newOdo: number;
newP50: number;
/** (newP50 - bestP50) / bestP50. null only when `degenerate` (no premium to report —
 *  every year prices identically, so "new" and "sweet spot" aren't a real comparison). */
newPremium: number | null;
/** True when the newest year's own point shares tier 1 with the sweet spot (R15's tie
 *  machinery) — statistically indistinguishable, so `newPremium` must not be presented
 *  as a finding even though it's a real (small) number. */
newTiedWithBest: boolean;
```

Filled in `handleModelYearRank`'s existing `byHold` map from the `r.points` array
already in scope — no new computation, just reading fields already there.

## Edge cases and disclosure (reusing existing conventions in this exact panel)

- **Degenerate** (whole car clamps to one grid point — 2/71 seed vehicles today, both
  Porsche 996 rows): no premium shown. Reuse `ByHoldSummary`'s existing degenerate
  branch/copy rather than writing new refusal text.
- **Tied** (`newTiedWithBest`): show "tied with the sweet spot — no reliable new-car
  premium" instead of a percentage that Monte Carlo noise could flip in sign (same
  discipline as R15's `tiedTopYears` handling elsewhere in this file).
- **Newest year clamped** (`points[length-1].clamped`, e.g. the newest model year's
  whole band sits outside the feasible odometer range): inherit the existing `*`
  caveat text/footnote pattern from `ModelYearRanking.tsx`.
- **Discontinued car** (`vehicle.last_year < constants.now_year` — ~9/71 seed rows per
  `ASSUMPTIONS.md`'s anchor-guard log): one caption sentence clarifying "new" here means
  "the last model year sold," not "currently purchasable new from a dealer" — these
  cars can't literally be bought new today.
- **`"eol"` rail**: unaffected — this table is populated from `byHold`, which (like the
  rest of this panel) only ever runs at the three fixed numeric holds, never at `"eol"`
  (R10: an open-ended horizon is a function of the buy odometer, not comparable across
  buy points).

## UI

New file `apps/web/src/charts/NewCarPremium.tsx`. Table shaped like
`ModelYearRanking.tsx`'s `ByHoldSummary`: one row per `HORIZONS` preset, columns `If
you hold | Sweet spot (year · mileage · $/mi) | Newest year (year · mileage · $/mi) |
New-car premium`. Same caption/disclosure conventions as the sibling table (plain
prose paragraph beneath explaining what the numbers mean and the tie/clamped/degenerate
caveats above).

Wired into `CarDrawer.tsx` as its own `<section className="drawer-section">`, reusing
the drawer's existing `myrResult.byHold` (from `useModelYearRank`) — no new hook, no
new worker request kind, no new drawer-level state.

## Scales with the catalogue

Reads `data.vehicles` (the shared seed data already loaded into the worker) and the
selected vehicle's own `first_year`/`last_year`/grid at request time. Nothing is
hardcoded to today's 71-vehicle count and nothing is precomputed/cached at build time —
so when the separate catalogue-expansion effort lands ~150 vehicles, this panel works
identically for all of them with no follow-up change.

## Testing

Extend `packages/core/test/modelyear.test.ts` with cases for: the new-vs-sweet-spot
arithmetic on a synthetic fixture, the degenerate branch (premium `null`), the tied
branch (`newTiedWithBest: true` suppresses a percentage claim), and the clamped-newest-
year branch. No change to `costPerMile`, no reference-output regeneration — this is a
read-only view over `buyPointSweep`'s existing grid, same guarantee R2's
`model_year_detail` had.

## Out of scope

- No field-wide "every model ranked by new-car premium" list — that's a different
  surface (deferred; see conversation, owner chose drawer-only for now).
- No change to the Rankings table, the heatmap, or the rail's existing model-year
  ranking table — additive only.
