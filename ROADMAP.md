# OpenCAWR — Roadmap / Feature Queue

Ordered backlog. Nothing here is in progress. When an item is picked up, plan it with
`superpowers:writing-plans` into `docs/superpowers/plans/`, then execute it. When it ships,
move the line to **Shipped** with its commit and add any new assumption to `ASSUMPTIONS.md`.

Conventions that apply to every item: ONE engine (all cost math in `packages/core`),
reference tests stay exact (`npm test -w @opencawr/core`), a ledger row for every new
assumption, estimates-not-advice copy, Node ≥ 20.

---

## P0 — Correctness and honesty (do first)

**R8. "Ideal mileage" is degenerate for most of the field** (found in R4's own live
verification, 2026-07-28 — needs an owner decision on what "ideal" should mean).
`packages/core/src/buypoint.ts`, `apps/web/src/App.tsx` car-meta line. R4 shipped
`buyPointSweep`, whose `idealOdo` is the unconstrained argmin of P50 across the feasible
odometer range. Measured across all 71 seed vehicles at default assumptions: **`idealOdo`
sits at the lowest feasible odometer for 60/71 (85%), and at literally 0 mi for 53/71
(75%)**; only 11 cars have an interior optimum. This is structural, not a bug — at r = 7%
real, present-value $/mi decreases monotonically with newness for most cars, which is the
same monotonicity `DECISIONS.md` already notes ("at r=0 the newest-buy-is-always-cheapest
monotonicity no longer holds"). Consequences: the column mostly reads "buy new," which is
uninformative for a used-car tool and drifts toward advice. **Owner decision required** on
the definition — candidates: argmin subject to a purchase-price budget; the knee of the
cost-vs-odometer curve (where marginal savings flatten) rather than its minimum; a used-car
odometer floor; or reporting the whole curve instead of a single point. `upperOdo` and the
5% tolerance walk are unaffected by whichever is chosen. Do not re-derive
`feasibleOdoRange`/`deriveBuyYear` — reuse them.

**R2. Model year as a designed surface, not an axis label** (rewritten and re-queued
2026-07-28 at the owner's direction; the original framing — "put implied model year on the
heatmap axis" — was rejected as too small for the problem).
A model year is not merely a repair-cost multiplier applied to an odometer. It implies a
specific **drivetrain** (engine/transmission combination, which can change mid-generation),
**mid-cycle refreshes** (facelifts that alter parts availability, safety content, and
resale), and **model-specific known issues** that are year-bounded rather than
tier-bounded. Today the engine collapses all of that into
`model_year_reliability` (landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95) on repair costs
only. What's wanted is a designed year-level surface answering *which years to buy and why,
and what changed between them* — not a second axis on an existing chart.
Prerequisites and constraints:
- `impliedModelYear`, `deriveBuyYear` and `isFeasibleBuy` already exist in
  `packages/core/src/feasibility.ts` — reuse, never re-derive.
- **The data layer needs new per-year fields** to carry drivetrain, refresh boundaries, and
  known-issue detail. None exist today; `model_year_reliability` is three arrays of years.
  Designing that schema (and where the data comes from) is the first task, not the last.
- Anything year-level that touches repair cost is gated behind the reliability launch gate
  (spec §9) exactly as the current multipliers are.
- Estimates, not advice: "what changed in 2019" is a fact; "buy the 2019" is not.

## P1 — Readability of what we already show

*(R4's line shipped; R8 above tracks the one substantive problem found with it.)*

## P2 — New surface

*(R6 shipped — see Shipped below.)*

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
- `role="img"` on the four chart SVGs (unchanged from the earlier review).

## Owner decisions still open (from ASSUMPTIONS.md §E)

- **What "ideal mileage" should mean** — see R8 above. Currently the unconstrained argmin,
  which lands on "buy new" for 75% of the field.
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
- **Reliability re-derivation = the public-launch gate.** `npm run reliability-report -w
  @opencawr/pipeline` derives tiers from real NHTSA data; 4/6 match the seed. Replacing the
  seed tiers is an owner decision, not an agent's.
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
