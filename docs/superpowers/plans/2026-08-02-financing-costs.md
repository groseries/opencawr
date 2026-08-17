# Financing Costs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Financing Costs" calculator to the Analyze tab's left rail — a standalone financing-vs-cash NPV tool (loan APR, term, down payment, opportunity cost) showing how financing changes total cost and $/mi.

**Architecture:** A pure calculation module (`financing.ts`, no React, no engine coupling) plus one new React component (`FinancingCosts.tsx`) rendered in `App.tsx`'s left rail, gated to the Analyze tab. `DealAnalyzer.tsx` gains two small callback props so the new section can opportunistically reuse the scored deal's price and holding-period miles, without being architecturally coupled to any one car.

**Tech Stack:** React 18 + TypeScript (apps/web), Vitest for unit tests (new to apps/web — packages/core already uses it).

## Global Constraints

- Node ≥22 (`.nvmrc`) — required to install deps and run tests.
- `apps/web/tsconfig.json` has `strict: true` and `noUncheckedIndexedAccess: true` — all new code must satisfy this (`tsc --noEmit` is part of `npm run build`).
- Do **not** modify `packages/core/src/engine.ts` or `EngineInputs` — opportunity cost enters the cost engine only via `discountRate` (documented invariant, `engine.ts:20-22`); this feature is a pure client-side calculator, deliberately separate.
- Follow the existing per-file `fmt`/`fmtUsd` duplication convention (every component that needs money formatting defines its own tiny local copy — see `DealAnalyzer.tsx`, `App.tsx`, every file under `apps/web/src/charts/`). Do **not** extract a shared formatting module.
- Match existing UI patterns: `.seg`/`.seg-active`/`.horizon-strip` for preset button strips (see `controls.tsx`'s holding-horizon control), `.control`/`.control-inline`/`.unit` for labeled number inputs, `.assumptions` for the rail panel container.

Full design context: `docs/superpowers/specs/2026-08-02-financing-costs-design.md`.

---

### Task 1: `financing.ts` — pure calculation module

**Files:**
- Create: `apps/web/src/deal/financing.ts`
- Create: `apps/web/src/deal/financing.test.ts`
- Modify: `apps/web/package.json` (add `vitest` devDependency + `test` script)

**Interfaces:**
- Produces:
  - `interface FinancingParams { price: number; downPaymentUsd: number; aprPct: number; termMonths: number; opportunityRatePct: number; milesBasis: number }`
  - `interface FinancingResult { monthlyPayment: number; totalInterestUsd: number; financingCostUsd: number; financingCostPerMi: number; breakevenAprPct: number }`
  - `function calcFinancing(p: FinancingParams): FinancingResult`
  - `function resolveMilesBasis(termMonths: number, lifetimeMiles: number | null, holdMiles: number | "eol" | undefined, annualMiles: number | undefined): number`

- [ ] **Step 1: Add vitest to apps/web**

Modify `apps/web/package.json`:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

Add to `devDependencies` (matches the version already used in `packages/core/package.json`):

```json
    "vitest": "^2.1.0"
```

Run: `npm install`
Expected: lockfile updates, `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/deal/financing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calcFinancing, resolveMilesBasis } from "./financing.js";

const base = {
  price: 25_000,
  downPaymentUsd: 5_000,
  aprPct: 6.5,
  termMonths: 60,
  opportunityRatePct: 6.5,
  milesBasis: 60_000,
};

describe("calcFinancing", () => {
  it("is exactly zero at the breakeven APR, for any price/term/down payment", () => {
    const atBreakeven = calcFinancing(base);
    const withBreakevenApr = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct });
    expect(withBreakevenApr.financingCostUsd).toBeCloseTo(0, 6);

    // breakeven is independent of loan size/term — vary them, same breakeven APR
    const other = calcFinancing({ ...base, price: 40_000, downPaymentUsd: 10_000, termMonths: 36 });
    expect(other.breakevenAprPct).toBeCloseTo(atBreakeven.breakevenAprPct, 9);
  });

  it("is negative (financing beats cash) below the breakeven APR", () => {
    const atBreakeven = calcFinancing(base);
    const below = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct - 2 });
    expect(below.financingCostUsd).toBeLessThan(0);
  });

  it("is positive (cash beats financing) above the breakeven APR", () => {
    const atBreakeven = calcFinancing(base);
    const above = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct + 2 });
    expect(above.financingCostUsd).toBeGreaterThan(0);
  });

  it("treats downPaymentUsd >= price as no loan needed", () => {
    const noLoan = calcFinancing({ ...base, downPaymentUsd: base.price });
    expect(noLoan.monthlyPayment).toBe(0);
    expect(noLoan.financingCostUsd).toBeCloseTo(0, 9);
  });

  it("APR = 0 is a straight-line payment with no compounding", () => {
    const r = calcFinancing({ ...base, aprPct: 0 });
    const loanAmount = base.price - base.downPaymentUsd;
    expect(r.monthlyPayment).toBeCloseTo(loanAmount / base.termMonths, 9);
    expect(r.totalInterestUsd).toBeCloseTo(0, 9);
  });

  it("opportunityRatePct = 0 gives a zero breakeven APR", () => {
    const r = calcFinancing({ ...base, opportunityRatePct: 0 });
    expect(r.breakevenAprPct).toBeCloseTo(0, 9);
    // any positive APR now costs strictly more than cash
    const positiveApr = calcFinancing({ ...base, opportunityRatePct: 0, aprPct: 1 });
    expect(positiveApr.financingCostUsd).toBeGreaterThan(0);
  });

  it("totalInterestUsd is monthlyPayment * termMonths - loanAmount", () => {
    const r = calcFinancing(base);
    const loanAmount = base.price - base.downPaymentUsd;
    expect(r.totalInterestUsd).toBeCloseTo(r.monthlyPayment * base.termMonths - loanAmount, 9);
  });
});

describe("resolveMilesBasis", () => {
  it("prefers the scored deal's lifetime miles when available", () => {
    expect(resolveMilesBasis(60, 72_000, "eol", 13_000)).toBe(72_000);
  });

  it("falls back to a fixed holdMiles when no deal is scored", () => {
    expect(resolveMilesBasis(60, null, 80_000, 13_000)).toBe(80_000);
  });

  it("falls back to annualMiles * termMonths/12 when holdMiles is 'eol' and no deal is scored", () => {
    expect(resolveMilesBasis(60, null, "eol", 12_000)).toBe(60_000);
  });

  it("defaults annualMiles to 13_000 when unset", () => {
    expect(resolveMilesBasis(24, null, "eol", undefined)).toBe(26_000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run financing.test.ts`
Expected: FAIL — `Cannot find module './financing.js'` (file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `apps/web/src/deal/financing.ts`:

```ts
/** Standalone financing-vs-cash NPV calculator (Analyze tab's Financing Costs
 *  section). Deliberately independent of the cost engine — see
 *  packages/core/src/engine.ts:20-22 for why opportunity cost never gets a
 *  second, separate capital charge there. This is a different question: given
 *  a loan offer and what your money could otherwise earn, does financing cost
 *  more or less than paying cash? */

export interface FinancingParams {
  price: number;
  downPaymentUsd: number;
  /** Nominal, monthly-compounding — how auto loans are actually quoted. */
  aprPct: number;
  termMonths: number;
  /** Effective annual — matches how `EngineInputs.discountRate` is used
   *  elsewhere in the app. Deliberately a different compounding convention
   *  than `aprPct`; see `breakevenAprPct` below. */
  opportunityRatePct: number;
  milesBasis: number;
}

export interface FinancingResult {
  monthlyPayment: number;
  /** Nominal total interest paid over the loan term, undiscounted. */
  totalInterestUsd: number;
  /** NPV of (down payment + loan payments) minus the cash price, discounted
   *  at the opportunity rate. Negative means financing beats paying cash. */
  financingCostUsd: number;
  financingCostPerMi: number;
  /** The loan APR (same nominal convention as `aprPct`) at which
   *  `financingCostUsd` is exactly zero. Provably independent of
   *  price/term/down payment — see docs/superpowers/specs/2026-08-02-financing-costs-design.md. */
  breakevenAprPct: number;
}

export function calcFinancing(p: FinancingParams): FinancingResult {
  const loanAmount = Math.max(p.price - p.downPaymentUsd, 0);
  const monthlyApr = p.aprPct / 100 / 12;
  const n = p.termMonths;

  const monthlyPayment =
    loanAmount === 0
      ? 0
      : monthlyApr === 0
        ? loanAmount / n
        : (loanAmount * monthlyApr) / (1 - Math.pow(1 + monthlyApr, -n));

  const monthlyOpp = Math.pow(1 + p.opportunityRatePct / 100, 1 / 12) - 1;
  const pvPayments =
    monthlyOpp === 0
      ? monthlyPayment * n
      : (monthlyPayment * (1 - Math.pow(1 + monthlyOpp, -n))) / monthlyOpp;

  const financingCostUsd = p.downPaymentUsd + pvPayments - p.price;
  const totalInterestUsd = monthlyPayment * n - loanAmount;
  const breakevenAprPct = monthlyOpp * 12 * 100;

  return {
    monthlyPayment,
    totalInterestUsd,
    financingCostUsd,
    financingCostPerMi: financingCostUsd / p.milesBasis,
    breakevenAprPct,
  };
}

/** Miles basis for $/mi, in priority order — whatever the user has already
 *  told the app, most specific first (see design doc). */
export function resolveMilesBasis(
  termMonths: number,
  lifetimeMiles: number | null,
  holdMiles: number | "eol" | undefined,
  annualMiles: number | undefined,
): number {
  if (lifetimeMiles != null) return lifetimeMiles;
  if (typeof holdMiles === "number") return holdMiles;
  return (annualMiles ?? 13_000) * (termMonths / 12);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run financing.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/deal/financing.ts apps/web/src/deal/financing.test.ts
git commit -m "feat: add financing-vs-cash NPV calculator (financing.ts)"
```

(If the repo uses a root lockfile instead of a per-package one, `git add package-lock.json` from the repo root instead.)

---

### Task 2: `FinancingCosts.tsx` + wire into the Analyze rail

**Files:**
- Create: `apps/web/src/deal/FinancingCosts.tsx`
- Modify: `apps/web/src/deal/DealAnalyzer.tsx` (add `onLifetimeMiles` / `onPriceChange` props)
- Modify: `apps/web/src/App.tsx` (lift price/miles state, render `FinancingCosts` in the rail)
- Modify: `apps/web/src/styles.css` (two small new rules)

**Interfaces:**
- Consumes: `calcFinancing`, `resolveMilesBasis`, `FinancingParams`, `FinancingResult` from Task 1's `./financing.js`.
- Produces: `FinancingCosts` component — `{ inputs: EngineInputs; dealPrice: number | null; lifetimeMiles: number | null }` props, no exported return values consumed elsewhere.

- [ ] **Step 1: Add the two callback props to `DealAnalyzer`**

In `apps/web/src/deal/DealAnalyzer.tsx`, change the import line (currently line 1):

```ts
import { useEffect, useMemo, useState } from "react";
```

Change the component signature (currently line 54):

```ts
export function DealAnalyzer({
  inputs,
  rows,
  onLifetimeMiles,
  onPriceChange,
}: {
  inputs: EngineInputs;
  rows: RankedRow[];
  /** Fired whenever the scored deal's holding-period miles changes — null
   *  when there's no valid scored deal. Lets the Financing Costs section
   *  (rendered elsewhere) opportunistically share this car's own miles
   *  basis instead of falling back to a generic one. */
  onLifetimeMiles?: (miles: number | null) => void;
  /** Fired whenever the price-paid field changes, so Financing Costs can
   *  prefill/sync to it without the two sections being tightly coupled. */
  onPriceChange?: (price: number) => void;
}) {
```

Add two effects right after the existing `const { result, computing } = useDealEngine(inputs, deal);` line:

```ts
  useEffect(() => {
    onPriceChange?.(price);
  }, [price, onPriceChange]);

  useEffect(() => {
    onLifetimeMiles?.(result?.lifetimeMilesP50 ?? null);
  }, [result, onLifetimeMiles]);
```

- [ ] **Step 2: Lift state in `App.tsx` and pass the callbacks**

In `apps/web/src/App.tsx`, add state near the other `useState` calls (e.g. right after `const [inputs, setInputs] = useState<EngineInputs>(DEFAULTS);`):

```ts
  const [dealPrice, setDealPrice] = useState<number | null>(null);
  const [lifetimeMiles, setLifetimeMiles] = useState<number | null>(null);
```

Update the `<DealAnalyzer>` render call to pass the new callbacks:

```tsx
              <DealAnalyzer
                inputs={inputs}
                rows={rows}
                onPriceChange={setDealPrice}
                onLifetimeMiles={setLifetimeMiles}
              />
```

- [ ] **Step 3: Write `FinancingCosts.tsx`**

Create `apps/web/src/deal/FinancingCosts.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import { calcFinancing, resolveMilesBasis } from "./financing.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtUsd = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString()}`;

const TERM_PRESETS = [36, 48, 60, 72];
const DEFAULT_PRICE = 20_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Standalone "what does financing cost me vs. paying cash" calculator —
 *  independent of any one car's cost model (see design doc). Opportunistically
 *  reuses the Deal Analyzer's price/holding-miles when available. */
export function FinancingCosts({
  inputs,
  dealPrice,
  lifetimeMiles,
}: {
  inputs: EngineInputs;
  dealPrice: number | null;
  lifetimeMiles: number | null;
}) {
  const [price, setPrice] = useState(() => dealPrice ?? DEFAULT_PRICE);
  const [downPaymentMode, setDownPaymentMode] = useState<"$" | "%">("$");
  const [downPaymentUsd, setDownPaymentUsd] = useState(() =>
    Math.round((dealPrice ?? DEFAULT_PRICE) * 0.2),
  );
  const [aprPct, setAprPct] = useState(6.5);
  const [termMonths, setTermMonths] = useState(60);
  const [customTerm, setCustomTerm] = useState(false);
  const [opportunityRatePct, setOpportunityRatePct] = useState(
    () => Math.round((inputs.discountRate ?? 0.07) * 1000) / 10,
  );

  const clampedDownPayment = clamp(downPaymentUsd, 0, price);
  const termIsPreset = TERM_PRESETS.includes(termMonths);

  const milesBasis = useMemo(
    () => resolveMilesBasis(termMonths, lifetimeMiles, inputs.holdMiles, inputs.annualMiles),
    [termMonths, lifetimeMiles, inputs.holdMiles, inputs.annualMiles],
  );

  const result = useMemo(
    () =>
      calcFinancing({
        price,
        downPaymentUsd: clampedDownPayment,
        aprPct,
        termMonths,
        opportunityRatePct,
        milesBasis,
      }),
    [price, clampedDownPayment, aprPct, termMonths, opportunityRatePct, milesBasis],
  );

  return (
    <div className="assumptions financing-costs">
      <h2 className="rail-title">Financing costs</h2>

      <label className="control">
        <span className="control-label">Price</span>
        <span className="control-inline">
          <span className="unit">$</span>
          <input
            type="number"
            className="mono"
            step={500}
            value={price}
            onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
          />
          {dealPrice != null && (
            <button type="button" className="sync-btn" onClick={() => setPrice(dealPrice)}>
              sync to deal price
            </button>
          )}
        </span>
      </label>

      <fieldset className="control">
        <legend className="control-label">Down payment</legend>
        <div className="horizon-strip" role="group" aria-label="Down payment unit">
          <button
            type="button"
            className={downPaymentMode === "$" ? "seg seg-active" : "seg"}
            onClick={() => setDownPaymentMode("$")}
          >
            $
          </button>
          <button
            type="button"
            className={downPaymentMode === "%" ? "seg seg-active" : "seg"}
            onClick={() => setDownPaymentMode("%")}
          >
            %
          </button>
        </div>
        <span className="control-inline">
          {downPaymentMode === "$" ? (
            <>
              <span className="unit">$</span>
              <input
                type="number"
                className="mono"
                step={500}
                value={clampedDownPayment}
                onChange={(e) => setDownPaymentUsd(clamp(Number(e.target.value), 0, price))}
              />
            </>
          ) : (
            <>
              <input
                type="number"
                className="mono"
                step={1}
                value={Math.round((clampedDownPayment / price) * 1000) / 10}
                onChange={(e) =>
                  setDownPaymentUsd(clamp((Number(e.target.value) / 100) * price, 0, price))
                }
              />
              <span className="unit">%</span>
            </>
          )}
        </span>
      </fieldset>

      <label className="control">
        <span className="control-label">Loan APR</span>
        <span className="control-inline">
          <input
            type="number"
            className="mono"
            step={0.25}
            min={0}
            value={aprPct}
            onChange={(e) => setAprPct(Math.max(0, Number(e.target.value)))}
          />
          <span className="unit">%/yr</span>
        </span>
      </label>

      <fieldset className="control">
        <legend className="control-label">Loan term</legend>
        <div className="horizon-strip" role="group" aria-label="Loan term">
          {TERM_PRESETS.map((months) => (
            <button
              key={months}
              type="button"
              className={!customTerm && termMonths === months ? "seg seg-active" : "seg"}
              onClick={() => {
                setCustomTerm(false);
                setTermMonths(months);
              }}
            >
              {months}mo
            </button>
          ))}
          <button
            type="button"
            className={customTerm || !termIsPreset ? "seg seg-active" : "seg"}
            onClick={() => setCustomTerm(true)}
          >
            custom
          </button>
        </div>
        {(customTerm || !termIsPreset) && (
          <span className="control-inline">
            <input
              type="number"
              className="mono"
              min={1}
              step={1}
              value={termMonths}
              onChange={(e) => setTermMonths(Math.max(1, Number(e.target.value)))}
            />
            <span className="unit">months</span>
          </span>
        )}
      </fieldset>

      <label className="control">
        <span className="control-label">
          Your money could earn (real)
          <span className="control-hint">nominal loan APR vs. effective-annual opportunity rate — not directly comparable 1:1, see breakeven below</span>
        </span>
        <span className="control-inline">
          <input
            type="number"
            className="mono"
            step={0.5}
            min={0}
            value={opportunityRatePct}
            onChange={(e) => setOpportunityRatePct(Math.max(0, Number(e.target.value)))}
          />
          <span className="unit">%/yr</span>
        </span>
      </label>

      <div className="deal-summary">
        <p className="deal-headline">
          <span className="mono">{fmtUsd(result.monthlyPayment)}</span>/mo for {termMonths} months
        </p>
        <p className="deal-line">
          Total interest paid: <span className="mono">{fmtUsd(result.totalInterestUsd)}</span>
        </p>
        <p className="deal-line">
          Financing vs. cash:{" "}
          <span className="mono">{fmtUsd(result.financingCostUsd)}</span>{" "}
          {result.financingCostUsd >= 0 ? "more" : "less"} than paying cash (
          <span className="mono">{fmt(Math.abs(result.financingCostPerMi))}</span>/mi{" "}
          {result.financingCostUsd >= 0 ? "added" : "saved"})
        </p>
        <p className="deal-line">
          Breakeven APR: <span className="mono">{result.breakevenAprPct.toFixed(2)}%</span> — a
          loan below this rate beats paying cash at your opportunity rate.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render `FinancingCosts` in the rail, gated to the Analyze tab**

In `apps/web/src/App.tsx`, add the import near the top:

```ts
import { FinancingCosts } from "./deal/FinancingCosts.js";
```

In the `<aside className="rail">` block, directly after `<Inputs inputs={inputs} onChange={setInputs} />`:

```tsx
          <Inputs inputs={inputs} onChange={setInputs} />
          {tab === "analyze" && (
            <FinancingCosts inputs={inputs} dealPrice={dealPrice} lifetimeMiles={lifetimeMiles} />
          )}
          <p className="disclaimer">
```

- [ ] **Step 5: Add the two small new CSS rules**

In `apps/web/src/styles.css`, after the existing `.disclaimer` rule:

```css
.financing-costs {
  margin-top: 16px;
}

.sync-btn {
  border: 0;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}

.sync-btn:hover {
  color: var(--ink);
}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the dev server and verify manually**

Run: `cd apps/web && npm run dev -- --host 127.0.0.1`

In a browser at the printed `127.0.0.1` URL (not the IPv6/`localhost` default — it silently returns an error page):

1. Open the Analyze tab. Confirm "Financing costs" appears in the left rail, below the existing inputs panel.
2. Switch to Rankings and Assumptions tabs — confirm the section is *not* shown there.
3. Back on Analyze: change loan APR to match the displayed "Breakeven APR" value — confirm "Financing vs. cash" reads ~$0.
4. Set APR below breakeven — confirm it reads "less than paying cash" (negative). Set it above — confirm "more than paying cash" (positive).
5. Toggle down payment between $ and % — confirm the values convert consistently and stay clamped to `[0, price]`.
6. Click a term preset, then "custom" — confirm the custom field appears and accepts an arbitrary value.
7. Score a valid deal in the Deal Analyzer above (pick a vehicle) — confirm the financing $/mi basis changes (it's now using the deal's `lifetimeMilesP50` per the priority order). Clear/invalidate the deal — confirm financing math still works (falls back per Task 1's `resolveMilesBasis`).
8. Click "sync to deal price" — confirm the Price field snaps to the Deal Analyzer's current price field value.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/deal/FinancingCosts.tsx apps/web/src/deal/DealAnalyzer.tsx apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add Financing Costs section to the Analyze rail"
```

---

## Self-Review Notes

- **Spec coverage:** purpose/placement (Task 2 Step 4) ✓, math incl. breakeven (Task 1) ✓, rate-convention note (Task 2 Step 3, control-hint) ✓, all 5 inputs incl. $/% toggle and term presets (Task 2 Step 3) ✓, price sync button (Task 2 Step 3+7.8) ✓, miles-basis priority order (Task 1 `resolveMilesBasis` + tests) ✓, state lifting (Task 2 Steps 1–2) ✓, output display incl. breakeven readout (Task 2 Step 3) ✓, edge cases (Task 1 tests) ✓, files-touched list matches (Tasks 1–2) ✓.
- **No placeholders:** all steps have complete, runnable code — no TBDs.
- **Type consistency:** `FinancingParams`/`FinancingResult`/`calcFinancing`/`resolveMilesBasis` signatures in Task 1 match every call site in Task 2's `FinancingCosts.tsx`. `onLifetimeMiles`/`onPriceChange` prop names match between the `DealAnalyzer` definition (Task 2 Step 1) and the `App.tsx` call site (Task 2 Step 2).
