# New-Car Premium vs Sweet Spot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-car drawer panel showing what the newest model year costs over that car's own cost-minimizing sweet spot, at each fixed holding-period preset.

**Architecture:** A pure function in `@opencawr/core` (`newestYearPremium`) reads an existing `ModelYearRankResult` and reports the newest model year's own local optimum against the sweet spot. `engine.worker.ts`'s `handleModelYearRank` already computes a full `modelYearRank` per hold preset inside its `byHold` loop, so the worker calls the new function on results it already has — **zero additional `costPerMile` calls, zero additional worker round trips**. A new presentational component renders it in the drawer between the survey heatmap and the model-year ranking.

**Tech Stack:** TypeScript, React 18, Vite, Vitest. Monorepo npm workspaces: `packages/core` (pure engine, the only place cost math lives), `apps/web` (Vite/React frontend).

Design doc: `docs/superpowers/specs/2026-08-15-new-car-premium-design.md` (commit `fc0b33e`).

## Global Constraints

- **Node 22 is required.** The default shell node in this environment is **v16.14.1**, and `vitest` dies on it with `TypeError: crypto$2.getRandomValues is not a function`. Prefix every test/build command with `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (verified: `node -v` → `v22.23.1`). `.nvmrc` says `22`.
- **Baseline before any change:** `npm test -w @opencawr/core` is **133 passed (133)** across 6 files. Any drop is a regression, not a new baseline.
- **ONE engine.** All cost math lives in `packages/core`. `apps/web` has **no test infrastructure at all** (no vitest dependency, no test files) — this is exactly why the arithmetic goes in core and the worker only wires it.
- **This is NOT a numbers-change event.** `newestYearPremium` is a read-only view over `buyPointSweep`'s existing grid. `costPerMile` is untouched, so `reference.test.ts` must stay **74/74 byte-identical**. Never run `npm run gen-reference -w @opencawr/core`.
- **Estimates, not advice.** Copy states facts about the model's own draws. Never "you should buy new".
- **Do not overclaim past the model's own noise (R15).** Where the tie tiers can't separate the newest year from the sweet spot, the panel says so instead of printing a percentage.
- **A ledger row for every new assumption** — `ASSUMPTIONS.md` §I (Task 4).
- Match surrounding style: heavy explanatory doc comments on exported types, prose captions under tables, `fmt`/`fmtK` local formatting helpers.

---

### Task 1: Core `newestYearPremium` function

**Files:**
- Modify: `packages/core/src/modelyear.ts` (append after `modelYearViewOf`, which ends at line 220)
- Modify: `packages/core/src/index.ts:19-20` (add export beside the existing `modelYearRank` exports)
- Test: `packages/core/test/modelyear.test.ts` (append a new top-level `describe` after the existing `describe("modelYearRank", ...)` block closes at line 351)

**Interfaces:**
- Consumes: `ModelYearRankResult` and `ModelYearRankPoint` from `packages/core/src/modelyear.ts` (already exported). `ModelYearRankResult` = `{ points: ModelYearRankPoint[]; bestYear: number; bestOdo: number; bestP50: number }`. `ModelYearRankPoint` = `{ year, odo, clamped, p50, rank, tier: number | null, beatsNextProb: number | null }`.
- Produces: `newestYearPremium(result: ModelYearRankResult): NewestYearPremium` and the `NewestYearPremium` type, both consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to the very end of `packages/core/test/modelyear.test.ts` (after the closing `});` of the `describe("modelYearRank", ...)` block on line 351). The module-level `makeVehicle`/`makeConstants` helpers are in scope.

Also add `newestYearPremium` to the existing import on line 2 and `ModelYearRankResult`/`ModelYearRankPoint` as type imports:

```typescript
import { modelYearRank, newestYearPremium } from "../src/modelyear.js";
import type { ModelYearRankPoint, ModelYearRankResult } from "../src/modelyear.js";
```

```typescript
/**
 * The newest model year is what a "buy new" shopper is choosing, and this
 * reports what that choice costs against the same car's own sweet spot.
 *
 * Two of these tests drive the REAL `modelYearRank` so the function is pinned
 * against what the engine actually produces; the rest hand-build a
 * `ModelYearRankResult` to reach branches (a tie with the sweet spot, a clamped
 * newest year, out-of-order points) that are fiddly to force through a Monte
 * Carlo fixture and would otherwise be pinned by guesswork.
 */
describe("newestYearPremium", () => {
  it("prices the newest model year against the sweet spot, on the real ranking", () => {
    // Zeroed fixture -> $/mi collapses to price / (eol - buyOdo), exactly.
    // am=10,000, now_year=2025, step 10,000 -> one grid point per year band:
    // 2025->0, 2024->10k, 2023->20k, 2022->30k, 2021->40k, 2020->50k.
    // The dip at 30k makes 2022 the sweet spot at 50,000/970,000 = 5/97,
    // while the newest year (2025, odo 0) is 100,000/1,000,000 = 1/10.
    // Premium = (1/10) / (5/97) - 1 = 97/50 - 1 = 0.94 exactly.
    const vehicle = makeVehicle({
      eol_maintained_miles: 1_000_000,
      price_vs_odometer_usd: {
        "0": 100_000,
        "10000": 95_000,
        "20000": 90_000,
        "30000": 50_000,
        "40000": 88_000,
        "50000": 87_000,
      },
    });
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });
    const premium = newestYearPremium(result);

    expect(result.bestYear).toBe(2022);
    expect(premium.year).toBe(2025);
    expect(premium.odo).toBe(0);
    expect(premium.p50).toBeCloseTo(0.1, 10);
    expect(premium.clamped).toBe(false);
    expect(premium.premiumVsBest).toBeCloseTo(0.94, 10);
    expect(premium.isBest).toBe(false);
    // No noise in this fixture, so every year separates into its own tier.
    expect(premium.tiedWithBest).toBe(false);
  });

  it("reports the newest year AS the sweet spot when buying new is cost-minimizing", () => {
    // Flat price curve -> $/mi = price / (eol - odo), strictly increasing in
    // odometer, so the newest year (odo 0) IS the cheapest point on the grid.
    // This is the case worth naming in the UI: for this car, new wins outright.
    const vehicle = makeVehicle();
    const constants = makeConstants();

    const result = modelYearRank(vehicle, constants, { holdMiles: 1_000_000 }, { step: 10_000 });
    const premium = newestYearPremium(result);

    expect(result.bestYear).toBe(2025);
    expect(premium.year).toBe(2025);
    expect(premium.isBest).toBe(true);
    expect(premium.premiumVsBest).toBe(0);
    expect(premium.tiedWithBest).toBe(true); // rank 1 is always tier 1
  });

  it("flags a newest year the tie tiers cannot separate from the sweet spot", () => {
    // Hand-built: the newest year sits 3.4% above the sweet spot but shares
    // tier 1, so the model cannot say the two differ (R15). Callers must not
    // present premiumVsBest as a finding here.
    const result = makeRankResult(
      [
        { year: 2024, odo: 10_000, p50: 0.29, rank: 1, tier: 1 },
        { year: 2025, odo: 0, p50: 0.3, rank: 2, tier: 1 },
      ],
      { bestYear: 2024, bestOdo: 10_000, bestP50: 0.29 },
    );

    const premium = newestYearPremium(result);

    expect(premium.year).toBe(2025);
    expect(premium.tiedWithBest).toBe(true);
    expect(premium.isBest).toBe(false);
    expect(premium.premiumVsBest).toBeCloseTo(0.0344827586, 8);
  });

  it("carries the clamped marking through, so the UI can caveat the row", () => {
    const result = makeRankResult(
      [
        { year: 2024, odo: 30_000, p50: 0.29, rank: 1, tier: 1 },
        { year: 2025, odo: 30_000, p50: 0.29, rank: 2, tier: 1, clamped: true },
      ],
      { bestYear: 2024, bestOdo: 30_000, bestP50: 0.29 },
    );

    const premium = newestYearPremium(result);

    expect(premium.year).toBe(2025);
    expect(premium.clamped).toBe(true);
  });

  it("picks the highest model year, not the last array element", () => {
    // modelYearRank emits points year-ascending, but this function must not
    // depend on that ordering to name "the newest year".
    const result = makeRankResult(
      [
        { year: 2025, odo: 0, p50: 0.4, rank: 2, tier: 2 },
        { year: 2023, odo: 20_000, p50: 0.2, rank: 1, tier: 1 },
      ],
      { bestYear: 2023, bestOdo: 20_000, bestP50: 0.2 },
    );

    const premium = newestYearPremium(result);

    expect(premium.year).toBe(2025);
    expect(premium.p50).toBe(0.4);
    expect(premium.premiumVsBest).toBeCloseTo(1.0, 10);
  });

  it("returns a null premium rather than dividing by a zero sweet-spot price", () => {
    const result = makeRankResult([{ year: 2025, odo: 0, p50: 0, rank: 1, tier: 1 }], {
      bestYear: 2025,
      bestOdo: 0,
      bestP50: 0,
    });

    expect(newestYearPremium(result).premiumVsBest).toBeNull();
  });
});
```

Add this helper immediately above that `describe` block (module scope, beside `makeVehicle`/`makeConstants`):

```typescript
/** Builds a `ModelYearRankResult` directly, for the `newestYearPremium`
 *  branches that are impractical to force through a Monte Carlo fixture
 *  (a tie with the sweet spot, a clamped newest year, out-of-order points).
 *  Every field `newestYearPremium` reads is set explicitly. */
function makeRankResult(
  points: Array<Partial<ModelYearRankPoint> & { year: number; p50: number }>,
  best: { bestYear: number; bestOdo: number; bestP50: number },
): ModelYearRankResult {
  return {
    points: points.map((p) => ({
      year: p.year,
      odo: p.odo ?? 0,
      clamped: p.clamped ?? false,
      p50: p.p50,
      rank: p.rank ?? 1,
      tier: p.tier ?? null,
      beatsNextProb: p.beatsNextProb ?? null,
    })),
    ...best,
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx vitest run --root packages/core test/modelyear.test.ts
```

Expected: FAIL — `newestYearPremium` is not exported from `../src/modelyear.js` (TypeScript/import error, all 6 new tests failing).

- [ ] **Step 3: Write the implementation**

Append to the end of `packages/core/src/modelyear.ts` (after `modelYearViewOf` closes on line 220):

```typescript
/**
 * The newest model year's own local optimum, measured against the sweet spot —
 * the "what does buying new cost me?" question, answered from the ranking that
 * has already been computed.
 *
 * A pure view over an existing `ModelYearRankResult`: it prices nothing, calls
 * no engine function, and is safe to run on a result the caller already holds.
 * That is deliberate — `handleModelYearRank` already runs one `modelYearRank`
 * per holding-period preset, so the newest year and the sweet spot are both
 * points it has in hand, and reporting the gap between them must not cost a
 * second pass over the grid.
 *
 * "New" here means **the vehicle's newest model year priced at ITS OWN cheapest
 * odometer**, not odometer zero. That follows the panel's existing rule (every
 * model-year row is that year's own local optimum, `ModelYearRankPoint.odo`)
 * rather than inventing a second definition, and it keeps the comparison
 * like-for-like: both sides of the premium are a cheapest-point-in-a-band
 * figure off the same grid. It also stays inside R11's floor — the sweep grid
 * never runs below the price curve's first observed odometer, so this never
 * quotes a price the curve did not observe.
 *
 * Requires the same fixed holding period everything upstream of it does (R10):
 * the caller's `ModelYearRankResult` cannot exist at `"eol"`, because
 * `modelYearRank` refuses that horizon outright.
 */
export interface NewestYearPremium {
  /** The vehicle's newest model year (`vehicle.last_year`) — for a
   *  discontinued car this is the last year it was SOLD, which is not the same
   *  as a car you can buy new today. Callers close to the user must say so. */
  year: number;
  /** That year's own cheapest odometer on the sweep grid — the same
   *  `ModelYearRankPoint.odo` the model-year table shows for this row. */
  odo: number;
  p50: number;
  /** No odometer of this year's own band was feasible, so the figures come from
   *  the nearest usable grid point instead (`ModelYearRankPoint.clamped`). Not
   *  a like-for-like comparison against the sweet spot; the UI marks it. */
  clamped: boolean;
  /** `(p50 - bestP50) / bestP50` — what the newest year costs over the sweet
   *  spot, as a fraction of the sweet spot. `0` when the newest year IS the
   *  sweet spot. `null` when `bestP50` is not positive, mirroring the guard
   *  `handleModelYearRank` already applies to `marginVsRunnerUp` (unreachable
   *  with real prices; a zeroed test fixture can produce it). */
  premiumVsBest: number | null;
  /** The newest year shares the cheapest tie tier with the sweet spot, so the
   *  model cannot separate the two (R15) and `premiumVsBest` must not be
   *  presented as a finding — it is inside the model's own noise. Always true
   *  when `isBest` is, since rank 1 is tier 1 by construction. */
  tiedWithBest: boolean;
  /** The newest year IS the sweet spot: buying new is the cost-minimizing
   *  choice for this car at this holding period, not merely indistinguishable
   *  from it. A stronger and much more useful statement than `tiedWithBest`,
   *  which is why it is reported separately. */
  isBest: boolean;
}

export function newestYearPremium(result: ModelYearRankResult): NewestYearPremium {
  // Highest year, not the last element: `modelYearRank` emits points
  // year-ascending today, but nothing about this view should depend on that.
  let newest = result.points[0]!;
  for (const p of result.points) if (p.year > newest.year) newest = p;

  return {
    year: newest.year,
    odo: newest.odo,
    p50: newest.p50,
    clamped: newest.clamped,
    premiumVsBest:
      result.bestP50 > 0 ? (newest.p50 - result.bestP50) / result.bestP50 : null,
    tiedWithBest: newest.tier === 1,
    isBest: newest.year === result.bestYear,
  };
}
```

Then in `packages/core/src/index.ts`, replace lines 19-20:

```typescript
export { modelYearRank } from "./modelyear.js";
export type { ModelYearRankPoint, ModelYearRankResult } from "./modelyear.js";
```

with:

```typescript
export { modelYearRank, newestYearPremium } from "./modelyear.js";
export type {
  ModelYearRankPoint,
  ModelYearRankResult,
  NewestYearPremium,
} from "./modelyear.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm test -w @opencawr/core
```

Expected: PASS — **139 passed (139)** across 6 files (133 baseline + 6 new). `reference.test.ts` must still report **74** passing; if it does not, stop — something touched `costPerMile` and that is out of scope for this plan.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modelyear.ts packages/core/src/index.ts packages/core/test/modelyear.test.ts
git commit -m "feat(core): newestYearPremium — newest model year vs the sweet spot

Pure view over an existing ModelYearRankResult: reports the newest model
year's own cheapest point against the sweep's sweet spot, plus whether the
two are statistically separable (R15 tie tiers) or the same point. Prices
nothing and calls no engine function, so callers that already hold a
ranking pay nothing for it. reference.test.ts unchanged, 74/74."
```

---

### Task 2: Worker wiring

**Files:**
- Modify: `apps/web/src/engine.worker.ts` — import block (lines 2-13), `ModelYearBestAtHold` (ends line 235), `ModelYearRankResponse` (lines 237-257), `handleModelYearRank`'s `byHold` map (lines 655-680) and its response object (lines 682-691)

**Interfaces:**
- Consumes: `newestYearPremium` and `NewestYearPremium` from `@opencawr/core` (Task 1).
- Produces: seven new fields on `ModelYearBestAtHold` — `newYear: number`, `newOdo: number`, `newP50: number`, `newClamped: boolean`, `newPremium: number | null`, `newTiedWithBest: boolean`, `newIsBest: boolean` — plus `newestYearDiscontinued: boolean` on `ModelYearRankResponse`. All consumed by Task 3.

There is no test framework in `apps/web`, so this task's gate is the typecheck plus the core suite staying green.

- [ ] **Step 1: Add the import**

In `apps/web/src/engine.worker.ts`, the value import block on lines 2-13 is alphabetized. Add `newestYearPremium` after `modelYearRank`:

```typescript
import {
  CALIBRATION,
  costPerMile,
  curveAt,
  impliedModelYear,
  isFeasibleBuy,
  modelYearRank,
  newestYearPremium,
  parseCurve,
  priceAtSweetSpot,
  rankWithTiers,
  type RankableCar,
} from "@opencawr/core";
```

- [ ] **Step 2: Extend `ModelYearBestAtHold`**

In `apps/web/src/engine.worker.ts`, the `ModelYearBestAtHold` interface currently ends with the `degenerate: boolean;` field and its doc comment. Insert these fields immediately after `degenerate: boolean;`, before the interface's closing `}`:

```typescript
  /** The newest model year this car offers, priced at ITS OWN cheapest
   *  odometer on the same grid — the "buy new" choice, from `newestYearPremium`
   *  (packages/core). Same hold, same grid, same draws as `bestYear` above, so
   *  the two are directly comparable by construction. */
  newYear: number;
  newOdo: number;
  newP50: number;
  /** The newest year had no feasible odometer of its own, so its figures come
   *  from the nearest usable grid point — the same `*` caveat the model-year
   *  table already applies to clamped rows. */
  newClamped: boolean;
  /** What the newest year costs OVER the sweet spot, as a fraction of the
   *  sweet spot. `0` when they are the same point. `null` when `degenerate` —
   *  every year prices identically there, so "new vs sweet spot" is not a real
   *  comparison, only a tie-break against itself. */
  newPremium: number | null;
  /** The newest year shares the cheapest tie tier with the sweet spot, so
   *  `newPremium` is inside the model's own noise and must not be quoted as a
   *  finding (R15, same rule `tiedTopYears` enforces above). */
  newTiedWithBest: boolean;
  /** The newest year IS the sweet spot at this hold — buying new is the
   *  cost-minimizing choice for this car, which is a stronger statement than
   *  being tied with it. */
  newIsBest: boolean;
```

- [ ] **Step 3: Extend `ModelYearRankResponse`**

In the same file, `ModelYearRankResponse` currently ends with the `byHold: ModelYearBestAtHold[];` field. Insert after it, before the closing `}`:

```typescript
  /** This car's newest model year is older than `constants.now_year`, so it is
   *  no longer sold new: the "new" column is the last model year that WAS
   *  sold, not a car anyone can buy new today. Resolved here because
   *  `now_year` lives in the worker's own constants and is never sent to the
   *  client. ~9 of the 71 seed rows are discontinued (ASSUMPTIONS.md's
   *  anchor-guard log). */
  newestYearDiscontinued: boolean;
```

- [ ] **Step 4: Populate the fields in `handleModelYearRank`**

The `byHold` map callback currently reads (lines 662-679):

```typescript
    const sorted = [...r.points].sort((a, b) => a.rank - b.rank);
    const runnerUp = sorted[1];
    return {
      holdMiles: h.value,
```

and ends with:

```typescript
      yearsCompared: r.points.length,
      degenerate: r.points.length > 1 && new Set(r.points.map((p) => p.odo)).size === 1,
    };
  });
```

Hoist `degenerate` into a local (behavior-identical — the same expression, evaluated once) so the new-car fields can read it, and add the premium. Replace the callback body so it reads:

```typescript
    const sorted = [...r.points].sort((a, b) => a.rank - b.rank);
    const runnerUp = sorted[1];
    // Hoisted out of the object literal below so the new-car fields can read it:
    // when every year prices identically there is no new-vs-sweet-spot gap to
    // report, only a tie-break compared against itself.
    const degenerate = r.points.length > 1 && new Set(r.points.map((p) => p.odo)).size === 1;
    // Free: `r` is the ranking this loop already computed at this hold, and
    // `newestYearPremium` prices nothing — it only reads that result.
    const newest = newestYearPremium(r);
    return {
      holdMiles: h.value,
```

...leaving every existing field between untouched, and replacing the final two lines of the object literal with:

```typescript
      yearsCompared: r.points.length,
      degenerate,
      newYear: newest.year,
      newOdo: newest.odo,
      newP50: newest.p50,
      newClamped: newest.clamped,
      newPremium: degenerate ? null : newest.premiumVsBest,
      newTiedWithBest: newest.tiedWithBest,
      newIsBest: newest.isBest,
    };
  });
```

Then in the response object (currently lines 682-691), add `newestYearDiscontinued` after `byHold`:

```typescript
  const msg: ModelYearRankResponse = {
    kind: "modelyearrank",
    id,
    vehicleName,
    points: railResult ? railResult.points.map(decorate) : null,
    bestYear: railResult ? railResult.bestYear : null,
    bestOdo: railResult ? railResult.bestOdo : null,
    byHold,
    newestYearDiscontinued: vehicle.last_year < data.constants.now_year,
  };
  self.postMessage(msg);
```

- [ ] **Step 5: Verify the typecheck passes and core stays green**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx tsc --noEmit -p apps/web/tsconfig.json
npm test -w @opencawr/core
```

Expected: `tsc` exits 0 with no output; core suite **139 passed (139)**.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/engine.worker.ts
git commit -m "feat(web): carry the new-car premium on the model-year worker response

handleModelYearRank already runs one modelYearRank per hold preset, so the
newest model year and the sweet spot are both points it holds. Reports the
gap between them per hold, plus whether the tie tiers separate the two and
whether the car is still sold new. No new costPerMile calls and no new
worker request kind."
```

---

### Task 3: Drawer panel

**Files:**
- Create: `apps/web/src/charts/NewCarPremium.tsx`
- Modify: `apps/web/src/drawer/CarDrawer.tsx` (import block lines 1-8; insert a section between the Survey section closing on line 137 and the Model years section opening on line 139)

**Interfaces:**
- Consumes: `ModelYearBestAtHold` (with Task 2's seven new fields) and `ModelYearRankResponse.newestYearDiscontinued`, both from `apps/web/src/engine.worker.js`.
- Produces: `NewCarPremium({ byHold, discontinued }: { byHold: ModelYearBestAtHold[]; discontinued: boolean })`.

No new CSS. The component reuses the existing `.myr-table`, `.myr-byhold`, `.myr-caption`, `.myr-clamped`, `.results-note`, `.num` and `.mono` classes already defined in `apps/web/src/styles.css` (lines 431, 883-985).

- [ ] **Step 1: Create the component**

Create `apps/web/src/charts/NewCarPremium.tsx`:

```tsx
import type { ModelYearBestAtHold } from "../engine.worker.js";

/** New-car premium panel (drawer-only): what this car's NEWEST model year costs
 * over its own sweet spot, at each of the rail's fixed holding periods.
 *
 * Every figure here is a point the model-year ranking beneath it already
 * computed — the sweet spot is that ranking's rank-1 row, and the "newest year"
 * column is its last row, each priced at its OWN cheapest odometer on the same
 * grid. Nothing is priced a second time, so this panel cannot disagree with the
 * one below it.
 *
 * Why it exists: whether buying new is worth it varies a lot by car AND by how
 * long you hold, and neither the Rankings row nor the model-year table states
 * that gap directly. It is also strongly hold-dependent — spreading a new car's
 * higher purchase price over more miles shrinks the premium — which is why this
 * is a row per holding period rather than a single number.
 *
 * Same honesty rules as its sibling panel: where the tie tiers can't separate
 * the newest year from the sweet spot, this says so instead of printing a
 * percentage the model can't stand behind (R15); and every row is priced at ONE
 * fixed hold, never at "until it dies", because an open-ended horizon is itself
 * a function of the buy odometer (R10). */

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtK = (x: number) => `${Math.round(x / 1000)}k`;

export function NewCarPremium({
  byHold,
  discontinued,
}: {
  byHold: ModelYearBestAtHold[];
  discontinued: boolean;
}) {
  if (byHold.length === 0) return null;

  // Every year of this car prices identically (its whole production window sits
  // outside the feasible odometer range), so "new vs the sweet spot" is not a
  // comparison — it is one point measured against itself. Same refusal the
  // model-year panel already makes for the same cars.
  if (byHold.every((h) => h.degenerate)) {
    return (
      <p className="results-note">
        Every model year of this car prices identically at these assumptions — its whole
        production window sits outside the feasible odometer range, so each year clamps to
        the same odometer. There is no new-versus-used gap to report here: the newest year
        and the cheapest year are literally the same point.
      </p>
    );
  }

  const newestYear = byHold[0]!.newYear;
  const anyClamped = byHold.some((h) => !h.degenerate && h.newClamped);
  const usable = byHold.filter((h) => !h.degenerate);
  const newWins = usable.filter((h) => h.newIsBest);
  const quantified = usable.filter(
    (h) => !h.newIsBest && !h.newTiedWithBest && h.newPremium !== null,
  );

  return (
    <>
      <table className="myr-table myr-byhold">
        <thead>
          <tr>
            <th>If you hold</th>
            <th>Cheapest year · mileage</th>
            <th>Newest year · mileage</th>
            <th className="num">$/mi cheapest</th>
            <th className="num">$/mi newest</th>
            <th className="num">Cost of buying new</th>
          </tr>
        </thead>
        <tbody>
          {byHold.map((h) => (
            <tr key={h.holdMiles}>
              <td className="mono">{fmtK(h.holdMiles)} mi</td>
              <td className="mono">
                {h.degenerate ? "—" : `${h.bestYear} · ${fmtK(h.bestOdo)} mi`}
              </td>
              <td className="mono">
                {h.degenerate ? "—" : `${h.newYear} · ${fmtK(h.newOdo)} mi`}
                {!h.degenerate && h.newClamped ? (
                  <abbr
                    className="myr-clamped"
                    title="No mileage of this model year's own is feasible for this car (production years, end-of-life cap, or the first point on its price curve), so this row is priced at the nearest usable odometer instead. Compare it with care."
                  >
                    *
                  </abbr>
                ) : null}
              </td>
              <td className="num mono">{h.degenerate ? "—" : fmt(h.bestP50)}</td>
              <td className="num mono">{h.degenerate ? "—" : fmt(h.newP50)}</td>
              <td className="num mono">
                {h.degenerate
                  ? "every year prices the same"
                  : h.newIsBest
                    ? "none — the newest year IS the cheapest"
                    : h.newTiedWithBest
                      ? "tied with the cheapest year"
                      : h.newPremium === null
                        ? "—"
                        : `+${(h.newPremium * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="myr-caption">
        {newWins.length === usable.length
          ? "At every holding period shown, this car's newest model year is also its cheapest per mile — nothing older beats it on the model's own numbers."
          : newWins.length > 0
            ? "At some holding periods the newest model year is also the cheapest one outright, and at others it is not — how long you keep the car decides whether buying new costs anything at all."
            : quantified.length === 0
              ? "At no holding period shown can the model separate the newest model year from the cheapest one — the gap is inside its own noise, so there is no new-car premium worth quoting."
              : "The cost of buying new shrinks as the holding period grows, because a newer car's higher purchase price is spread over more miles."}{" "}
        Both columns are that model year priced at its OWN cheapest mileage on the same
        grid, at the same fixed holding period — so the gap between them is the cost of
        insisting on the newest year, not an artifact of comparing two different mileages.
        Where the two land in the same statistical tie tier the model cannot honestly order
        them, and this says so rather than quoting a percentage.{" "}
        {discontinued
          ? `This car is no longer sold new — ${newestYear} is the last model year it was built, so the "newest year" column is the newest one you could find used, not a dealer purchase.`
          : ""}{" "}
        Estimates, not advice.
      </p>
      {anyClamped ? (
        <p className="myr-caption">
          * No mileage of the newest model year&rsquo;s own is feasible for this car at
          that holding period, so it is priced at the nearest usable odometer instead —
          still a real price, but not a like-for-like comparison against the cheapest year
          beside it.
        </p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Wire it into the drawer**

In `apps/web/src/drawer/CarDrawer.tsx`, add the import after the `ModelYearRanking` import on line 8:

```typescript
import { NewCarPremium } from "../charts/NewCarPremium.js";
```

Then insert this section between the Survey section's closing `</section>` (line 137) and the Model years section's opening `<section className="drawer-section">` (line 139):

```tsx
            <section className="drawer-section">
              <h3 className="drawer-section-title">
                Buying new: what the newest model year costs
              </h3>
              {myrResult && myrResult.vehicleName === vehicleName ? (
                <NewCarPremium
                  byHold={myrResult.byHold}
                  discontinued={myrResult.newestYearDiscontinued}
                />
              ) : (
                <p className="results-note">Pricing the newest model year…</p>
              )}
            </section>

```

- [ ] **Step 3: Verify the build passes**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run build -w @opencawr/web
```

Expected: `tsc --noEmit` clean, then a successful `vite build`. Any TS error here means a field name drifted from Task 2 — fix the name, do not loosen the type.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/charts/NewCarPremium.tsx apps/web/src/drawer/CarDrawer.tsx
git commit -m "feat(web): new-car premium panel in the car drawer

Row per holding period: the cheapest model year and the newest one, each at
its own cheapest mileage on the same grid, and the gap between them. Says
'tied' rather than quoting a percentage where the tie tiers can't separate
the two (R15), names the case where the newest year IS the sweet spot, and
flags cars no longer sold new. Reuses the existing model-year table styles;
no new CSS, no new hook, no new worker request kind."
```

---

### Task 4: Browser verification and ledger

**Files:**
- Modify: `ASSUMPTIONS.md` §I (the table starting at line 202 — append a row at the end of that section's table)
- Modify: `ROADMAP.md` (add a Shipped entry)

**Interfaces:**
- Consumes: the shipped feature from Tasks 1-3. Produces nothing consumed by other tasks.

- [ ] **Step 1: Build and serve a production build**

`vite preview` binds IPv6 `[::1]` only while Chrome resolves `localhost` to IPv4, so browser automation silently lands on an error page unless the host is pinned. This is a known, previously-costly trap in this repo.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run build -w @opencawr/web
npm run preview -w @opencawr/web -- --host 127.0.0.1
```

- [ ] **Step 2: Verify the panel in a browser at three cars**

Open the preview URL (using `127.0.0.1`, never `localhost`), then for each of **Toyota Prius (hybrid)**, **Toyota RAV4**, and **Tesla Model 3**: click the car's Rankings row to open the drawer and screenshot the new section.

Confirm all of:
1. The new section sits **between** "Survey: buy point x hold miles" and "Model years: which year is the best buy".
2. Three rows (50k / 100k / 150k), each with both `$/mi` columns populated and a premium cell.
3. The rank-1 year and `$/mi` in the "Cheapest year · mileage" column **match** the corresponding row of the "Model years" panel's own by-hold summary directly below it. They come from the same `modelYearRank` result, so any disagreement is a wiring bug.
4. No console errors; no text overflow at **1440×1000** and at **390×844**.
5. The default rail setting is `"until it dies"` — confirm the panel still renders (it reads `byHold`, which is populated at every rail setting) rather than blanking.

Record the actual observed premium figures — they go in the ledger row in Step 4.

- [ ] **Step 3: Verify a degenerate car refuses**

Open **Porsche 996 Carrera** (or **Porsche 996 Turbo**) — both collapse to a single feasible grid point at defaults. Confirm the panel renders the "Every model year of this car prices identically…" refusal instead of a table of identical numbers.

- [ ] **Step 4: Add the ledger row**

Append this row to the end of the §I table in `ASSUMPTIONS.md`. The one bracketed span must be replaced with the premiums **actually read off the screen in Step 2** — do not carry over the figures from the session that motivated this feature (Prius +1.7%/RAV4 +10.9%/Model 3 +11.2% at a 100k hold). Those came from `buyPointSweep`'s grid floor, which is the lowest feasible odometer of the whole grid; this panel reports the newest model year's own band optimum. The two coincide only when the grid floor happens to fall inside the newest year's band, so treat the old numbers as a rough expectation to sanity-check against, not as the values to paste. If what you measure is far from them, say so in the row rather than smoothing it over.

```markdown
| **The drawer states what buying the newest model year costs over the sweet spot** (2026-08-16; `packages/core/src/modelyear.ts` `newestYearPremium`, `charts/NewCarPremium.tsx`) | A row per fixed holding preset (50k/100k/150k): the cheapest model year and the NEWEST model year, **each priced at its own cheapest odometer on the same sweep grid**, and the gap between them as a percentage of the cheapest. "New" is deliberately the newest model year at its own local optimum, **not odometer zero** — it reuses the model-year panel's existing per-row rule rather than inventing a second definition of "new", keeps both sides of the comparison like-for-like, and stays above R11's curve floor so no invented near-new price is ever quoted. Every figure is a point `modelYearRank` already computed for the panel below it (`newestYearPremium` prices nothing and calls no engine function), so the two panels cannot disagree and the feature costs **zero additional `costPerMile` calls**. Where the newest year shares the cheapest tie tier the cell reads *"tied with the cheapest year"* instead of a percentage (R15's rule, reusing `CALIBRATION.tieTierBeatProb`, no new constant); where it IS the sweet spot it reads *"none — the newest year IS the cheapest"*; where every year clamps to one odometer the whole panel refuses, as its sibling already does. Never computed at `"eol"` (R10) | JUDGMENT (reuses existing calibrated constants; adds none) | **Why it earns a panel:** the premium is large, car-specific AND hold-specific, and no existing surface stated it. Measured at defaults: [REPLACE with the figures observed in the browser, one clause per car, naming the hold each belongs to — e.g. "Toyota Prius (hybrid) +N.N% at a 100k hold, +N.N% at 150k; Toyota RAV4 …; Tesla Model 3 …"]. The expected direction is that a longer hold shrinks the premium, because a newer car's higher purchase price is spread over more miles — which is exactly why this is a row per holding period and not one number. **`"new" ≠ purchasable new`:** for a discontinued car (`last_year < now_year`, ~9 of the 71 seed rows per the anchor-guard log above) the column is the last model year that was SOLD, and the caption says so — `now_year` is resolved worker-side into `ModelYearRankResponse.newestYearDiscontinued` because it never reaches the client. **Limitation, inherited not introduced:** these figures come from the sweep's own reduced draws (`CALIBRATION.sweepDraws`), like every other number in this drawer, and the whole comparison rests on `price_vs_odometer_usd` having no year dimension (R19) — so the premium is very largely the shape of one smooth cost-vs-odometer curve, not a measured market premium for a newer model year. **Not a numbers-change event**: read-only over the existing grid, `reference.test.ts` 74/74 byte-identical |
```

- [ ] **Step 5: Add the ROADMAP entry**

In `ROADMAP.md`, under `## Shipped`, add:

```markdown
- **New-car premium panel (drawer)** — 2026-08-16. `packages/core/src/modelyear.ts`'s new
  `newestYearPremium` (a pure view over an existing `ModelYearRankResult` — prices nothing,
  calls no engine function) plus `apps/web/src/charts/NewCarPremium.tsx`, rendered between
  the survey heatmap and the model-year ranking. States what the newest model year costs
  over the car's own sweet spot at each fixed hold, reusing the ranking `handleModelYearRank`
  already computes per hold — **zero additional `costPerMile` calls, no new worker request
  kind, no new CSS**. Honours the existing refusals rather than adding thresholds: "tied with
  the cheapest year" where R15's tie tiers can't separate the two, the degenerate refusal
  where every year clamps to one odometer, and never computed at `"eol"` (R10). 6 new core
  tests; `npm test -w @opencawr/core` 139/139, `reference.test.ts` 74/74 byte-identical.
  Reads `data.vehicles` and the selected car's own grid at request time, so it needs no
  follow-up when the catalogue grows past its current 71 rows. Ledger: `ASSUMPTIONS.md` §I.
```

- [ ] **Step 6: Final verification**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm test -w @opencawr/core
npm run build -w @opencawr/web
git status
```

Expected: **139 passed (139)** with `reference.test.ts` at 74; build clean; `git status` shows only `ASSUMPTIONS.md` and `ROADMAP.md` modified (Tasks 1-3 already committed).

- [ ] **Step 7: Commit**

```bash
git add ASSUMPTIONS.md ROADMAP.md
git commit -m "docs(assumptions,roadmap): ledger the new-car premium panel

Records the 'new = newest model year at its own cheapest odometer, not
odometer zero' definition, the discontinued-car caveat, the measured
premiums at defaults, and the R19 limitation the figures inherit."
```

---

## Notes for the implementer

**Why the arithmetic is in `packages/core` and not the worker.** `apps/web` has no test framework at all — no vitest dependency, no test files. Putting the calculation in the worker would make it untestable, and the repo's standing convention is that all cost math lives in `packages/core`. The worker's job here is wiring only.

**Why `newPremium` is nulled in the worker rather than in core.** `degenerate` is already computed in `handleModelYearRank`'s `byHold` loop and is a property of the whole ranking, not of the newest year. Duplicating that predicate in core would create two definitions that could drift. The worker owns it; core stays a pure function of its input.

**What NOT to do:**
- Do not add a new worker request kind. The data is already in `handleModelYearRank`.
- Do not call `priceAtSweetSpot` or `costPerMile` anywhere in this feature.
- Do not run `gen-reference`. If `reference.test.ts` goes red, something is wrong with the change, not with the reference outputs.
- Do not add a "premium > X%" threshold constant. The tie tiers already answer "is this gap real?" with `CALIBRATION.tieTierBeatProb`.
- Do not hardcode any vehicle list or count — a separate effort is expanding the catalogue, and this panel must pick that up with no changes.
