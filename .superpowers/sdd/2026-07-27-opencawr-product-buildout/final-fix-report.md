# Final fix wave — apps/web (2026-07-27/28)

Scope: apps/web only. packages/core and packages/pipeline untouched.

## Finding 1 — App.tsx unguarded localStorage (MUST-FIX, crash risk)

Added `safeLocalGet` / `safeLocalSet` helpers (try/catch) right below `INTAKE_SEEN_KEY`
in `apps/web/src/App.tsx`. The lazy `useState` initializer now calls `safeLocalGet`
(read failure → treated as "not seen", intake shows) and `dismissIntake` calls
`safeLocalSet` (write failure → silent no-op). Nothing else in the initializer or
render path touches storage, so this closes the top-level-render crash risk in
storage-disabled browsers.

## Finding 2 — engine.worker.ts duplicated implied-model-year arithmetic (MUST-FIX)

`handleRank`'s `buildRows` used to recompute `data.constants.now_year - res.buyOdo / am`
inline. Replaced with the already-imported `impliedModelYear(res.buyOdo, am,
data.constants.now_year)` (same helper `handleDeal` already calls), matching its
exact definition in `packages/core/src/feasibility.ts` (`nowYear - odo / annualMiles`).
Verified in the browser at default inputs: Chevy Volt still shows `feasNote`
"low-mileage example (last built 2019)" on row 2, byte-identical to before the change.

## Finding 3 — three independent workers → one shared singleton (Important)

- Added `apps/web/src/sharedWorker.ts`: `getSharedWorker()` lazily creates one
  module-level `Worker` (same `new URL("./engine.worker.ts", ...)` construction) and
  returns it on every call — one OS thread, one parse of `opencawr_data.json`.
- `useEngine.ts`, `useDealEngine.ts`, `useSurveyEngine.ts` now call `getSharedWorker()`
  instead of constructing their own `Worker`.
- Because the worker is now shared, each hook's message handling switched from
  `worker.onmessage = ...` (which would let the three hooks stomp on each other) to
  `worker.addEventListener("message", ...)` / `removeEventListener` on cleanup, and
  filters on **both** `kind` and its own `reqId` (`e.data.kind !== "rank"`, `"deal"`,
  `"survey"` respectively) before consuming a response — a rank response can never
  reach the deal or survey hook and vice versa.
- Closed a gap that would have broken that filter: `EngineResponse` (the "rank" reply)
  didn't carry a `kind` field the way `DealResponse`/`SurveyResponse` already did.
  Added `kind: "rank"` to the interface and to the constructed message in `handleRank`,
  and added an exported `EngineWorkerResponse` union type for the three hooks' listener
  typing.
- No hook calls `worker.terminate()` anymore — the singleton is intentionally never
  torn down on a hook's unmount; only its own listener is removed.

No assumption in ASSUMPTIONS.md (§A–I) changed — these are defect fixes with required
identical behavior (verified for Finding 2's feasNote), not product/model changes, so
no row was appended.

## Verification

- `npm run build -w @opencawr/web` (tsc --noEmit && vite build) — clean, no errors.
  Note: the gate's literal `... build ... clean` argument doesn't exist as an npm
  script or vite flag (`clean` gets treated as a vite build entry path and fails
  immediately: `Could not resolve entry module "clean/index.html"`) — ran the plain
  `build` script instead, which is a "clean" (no stale artifacts, fresh `dist/`)
  production build in the ordinary sense.
- `npm test -w @opencawr/core` — 89/89 passing, unchanged (no core files touched).
- `vite preview` (port 4321) exercised in a real Chrome tab:
  - Rankings compute and render (71 vehicles, tiers, bands).
  - Changing "miles you drive per year" from 13,000 → 20,000 re-ranked all rows
    (Chevy Bolt EV $0.340 → $0.312) with no errors.
  - Deal Analyzer tab scored a Buick Enclave listing (2019, 90k mi, $16,667 →
    "$0.573/mi — cheaper than 7 of 71 modeled cars").
  - Opening the Chevy Bolt EV car drawer rendered the survey heatmap, cost
    breakdown, and both sensitivity charts (annual mileage, gas price).
  - `read_console_messages` (onlyErrors) reported no console errors/exceptions
    throughout the whole session (initial load, re-rank, tab switch, drawer open).
