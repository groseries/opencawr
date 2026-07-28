# OpenCAWR — Roadmap / Feature Queue

Ordered backlog. Nothing here is in progress. When an item is picked up, plan it with
`superpowers:writing-plans` into `docs/superpowers/plans/`, then execute it. When it ships,
move the line to **Shipped** with its commit and add any new assumption to `ASSUMPTIONS.md`.

Conventions that apply to every item: ONE engine (all cost math in `packages/core`),
reference tests stay exact (`npm test -w @opencawr/core`), a ledger row for every new
assumption, estimates-not-advice copy, Node ≥ 20.

---

## P0 — Correctness and honesty (do first)

**R1. Heatmap legend direction is wrong / cells show no numbers.**
`apps/web/src/charts/heatColor.ts`, `charts/Heatmap.tsx`. The legend reads as "darker =
cheaper" but the ramp actually renders lighter = cheaper. Fix the legend/ramp so they agree
(pick one direction and label it explicitly, e.g. "cheaper ← → costlier" with $ endpoints),
and print the actual $/mi in each cell (mono, 2–3 decimals) — a color-only grid can't be
read as data. Include the min/max $ of the current car's grid in the legend so the scale is
honest about being per-car, not global. Owner-reported 2026-07-28.

**R2. Heatmap must show which model year each cell means.**
Same files + `engine.worker.ts` survey handler. Odometer maps to an implied model year
through annual mileage, and years are not interchangeable — `model_year_reliability`
(landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95) materially moves cost. Surface the
implied year per column (axis label showing both odometer and year), and mark landmine /
sweet-spot years visually so a user can see *which year to buy*, not just which mileage.
`impliedModelYear` and `isFeasibleBuy` already exist in `packages/core/src/feasibility.ts` —
do not re-derive them. Owner-reported 2026-07-28.

**R3. Default electricity price 0.32 → 0.38 $/kWh.**
Three places, and they are not the same decision — change deliberately:
`opencawr_data.json` `constants.elec_usd_per_kwh` (**this one regenerates the reference
outputs** — run `npm run gen-reference -w @opencawr/core` and say so in the commit body),
`apps/web/src/controls.tsx` `DEFAULTS.elecUsdPerKwh` + the fallback literal at the control,
and note that `apps/web/src/region.ts` per-state values override it once a ZIP resolves, so
the default only applies pre-intake. Add the source for 0.38 to `ASSUMPTIONS.md` §A.
Owner-reported 2026-07-28.

## P1 — Readability of what we already show

**R4. Rankings car description line reads poorly.**
`apps/web/src/App.tsx` (car-meta span) — currently a terse chain of fragments
("PHEV · buy ~55k mi · 2019 · low-mileage example (last built 2019)"). Rewrite as a clean
sentence describing the **sweet-spot pick**: what to buy and why, in plain English — e.g.
"Buy a 2019 around 55,000 miles — the cheapest point that's still a good model year."
Keep it one line, keep the feasibility caveat readable, and keep the mono/UI type split.
Owner-reported 2026-07-28.

**R5. Cost breakdown colors read as black; drawer plots too small.**
`apps/web/src/charts/Breakdown.tsx`, `Sensitivity.tsx`, `drawer/CarDrawer.tsx`. The stacked
segments are indistinguishable at a glance. Give the breakdown a categorical palette that is
distinguishable in both light and dark rendering (load the `dataviz` skill first; this is a
categorical, not sequential, problem — the tier ramp in `tierColors.ts` is sequential and is
the wrong tool), label segments directly where they're wide enough, and increase the
sensitivity/breakdown chart heights so the axes are legible. Owner-reported 2026-07-28.

## P2 — New surface

**R6. "How this works" tab — the open in OpenCAWR.**
A first-class tab (alongside Rankings / Deal Analyzer) where a user can read the whole model:
the cost equation term by term, what each input does, where every number comes from, and
what we know is wrong with it. Source it from the real artifacts rather than re-prose them:
`ASSUMPTIONS.md` (sections A–I), `docs/reliability-methodology.md`, `OpenCAWR_SPEC.md` §2–§5,
and `packages/core/src/calibration.ts`. Requirements: show the status of every assumption
(SOURCED / DOCUMENTED / JUDGMENT / USER-SPECIFIC), state the launch gate plainly, link each
claim to the file that backs it, and — the point of the tab — make the open items as visible
as the answers. Consider generating it from the markdown at build time so it can never drift
from the ledger. Owner-requested 2026-07-28.

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

## Owner decisions still open (from ASSUMPTIONS.md §E)

- Real USAA premiums (engine already accepts `fullCoverageUsdYr` as a real quote).
- **Reliability re-derivation = the public-launch gate.** `npm run reliability-report -w
  @opencawr/pipeline` derives tiers from real NHTSA data; 4/6 match the seed. Replacing the
  seed tiers is an owner decision, not an agent's.
- Real calendar age as a state variable (age is still odometer-derived).
- Total-loss should truncate the holding period, not just charge annually.

## Shipped

- Steps 1–6 of the original build order (engine, reference tests, live inputs, rankings +
  ladder, Deal Analyzer, data pipeline) — master as of `972d52a`, 2026-07-28.
