# Financing Costs — design

## Purpose

A standalone "what does financing cost me vs. paying cash" calculator, shown
on the Analyze page. It answers: given a loan APR, term, down payment, and
what you could otherwise earn on your money (opportunity cost), how much
does financing add to (or save off) the total cost and $/mi — independent of
any specific car's cost model.

## Non-goal / invariant to respect

`packages/core/src/engine.ts:20-22` documents that opportunity cost enters
the cost engine **only** through `discountRate`, deliberately with no
separate capital charge — the prototype double-counted this once and it was
removed in v2b. This feature does **not** touch `packages/core`, `EngineInputs`,
or the Monte Carlo engine. It is a pure client-side calculator in `apps/web`
that happens to share a page (and, opportunistically, a couple of numbers)
with the Deal Analyzer.

## Placement

Left rail (`<aside className="rail">` in `App.tsx`), directly below the
existing `<Inputs>` control panel, visible only when `tab === "analyze"`.

## Math

NPV of financing vs. paying cash, discounted at the opportunity-cost rate.
Zero at the breakeven APR (see below); negative (financing beats cash) below
it; positive above it.

```
loanAmount   = price - downPayment
monthlyAPR   = APR / 12
payment      = loanAmount <= 0            ? 0
             : monthlyAPR === 0           ? loanAmount / termMonths
             : loanAmount * monthlyAPR / (1 - (1 + monthlyAPR) ** -termMonths)

monthlyOpp   = (1 + opportunityRate) ** (1/12) - 1   // effective monthly, matches
                                                       // the engine's annual-compounding style
pvPayments   = monthlyOpp === 0 ? payment * termMonths
             : payment * (1 - (1 + monthlyOpp) ** -termMonths) / monthlyOpp

financingCostUsd   = (downPayment + pvPayments) - price
financingCostPerMi = financingCostUsd / milesBasis
totalInterestUsd   = payment * termMonths - loanAmount   // nominal, undiscounted
breakevenAPR       = monthlyOpp * 12   // the loan APR (nominal, same quoting convention as
                                         // the APR input) at which financingCostUsd = 0
```

**Rate conventions are deliberately different, not a bug.** `APR` is nominal,
monthly-compounding — how auto loans are actually quoted. `opportunityRate`
is effective annual — matches how `inputs.discountRate` is used elsewhere in
the app (`engine.ts`'s `(1+r)^-T`). Because of this, typing the same headline
percentage into both fields will **not** net exactly $0 (same reason a 6.5%
APR loan and a 6.5% APY savings account aren't equivalent) — the calculator
should carry a short inline note saying so. `breakevenAPR` is provable to be
independent of price/term/down payment — it reduces to `monthlyOpp * 12`
regardless of loan size, via the standard annuity-NPV identity (an annuity's
PV, discounted at its own defining rate, always equals its principal). It
will read a bit below `opportunityRate` numerically (nominal vs. effective
conversion) — e.g. a 6.5% effective-annual opportunity rate has a ~6.31%
breakeven APR.

## Inputs (local state, own module — not the global `EngineInputs`)

| Field | Default | Notes |
|---|---|---|
| Price | prefilled from Deal Analyzer's `price` field | independently editable; a "sync to deal price" button re-copies the current deal price on click (no auto-resync — see below) |
| Down payment | 20% of price, rounded | `$`/`%` toggle, mirrors how people actually think about it; canonical value stored in $, clamped `[0, price]` |
| Loan APR (%) | 6.5 | clamped `≥ 0`; nominal, monthly-compounding (standard loan quoting) |
| Loan term | 60mo | preset strip — 36/48/60/72mo — plus a "custom" toggle + number field, mirroring the holding-horizon control in `controls.tsx` (`HORIZONS` strip); clamped `≥ 1` |
| Opportunity cost rate (%) | prefilled from `inputs.discountRate` | independently editable, clamped `≥ 0`; effective annual (matches the engine's convention) |

**Price sync:** prefill happens once, on first mount only; after that the two
fields are fully decoupled (editing one doesn't touch the other, and changing
the vehicle/price in the Deal Analyzer above does not push into this section),
per the earlier design decision that financing is independent of any one car.
The sync button is the escape hatch for "actually I do want this to match the
deal above right now."

## Miles basis (for $/mi)

Priority order — use whatever the user has already told the app, most
specific first:

1. Deal Analyzer above has a valid scored deal → its `result.lifetimeMilesP50`
2. Else `inputs.holdMiles` is a fixed number (not `"eol"`) → use it directly
3. Else → `(inputs.annualMiles ?? 13_000) * termMonths / 12`

### State lifting required

`result` (and thus `lifetimeMilesP50`) currently lives only inside
`DealAnalyzer`'s local state. `DealAnalyzer` gains one new optional prop:

```ts
onLifetimeMiles?: (miles: number | null) => void
```

Fired from a `useEffect` on `result` (null when there's no valid scored
deal). `App.tsx` holds the value in one `useState<number | null>` and passes
it down to `FinancingCosts` as the priority-1 miles basis.

## Output display

- Monthly payment
- Total interest paid (nominal, undiscounted)
- Financing cost vs. cash (signed; negative reads as "saves you $X")
- Financing cost per mile (signed)
- Breakeven APR — "a loan below N% beats paying cash at your current opportunity rate"

## Edge cases

- `downPayment >= price` → `loanAmount <= 0` → no loan, `financingCostUsd = 0`
- `APR = 0` → straight-line payment, no compounding
- `opportunityRate = 0` → `pvPayments` is a flat sum, no discounting; `breakevenAPR = 0` (any positive-rate loan costs more than $0-opportunity-cost cash)
- `termMonths` clamped to `≥ 1` to avoid divide-by-zero
- Down payment `%` mode clamped to `[0, 100]`; converting to $ then re-clamps to `[0, price]`

## Components / files touched

- New: `apps/web/src/deal/financing.ts` — pure calc functions, no React
- New: `apps/web/src/deal/FinancingCosts.tsx` — the rail section (inputs + output)
- Edit: `apps/web/src/deal/DealAnalyzer.tsx` — add `onLifetimeMiles` prop + effect
- Edit: `apps/web/src/App.tsx` — lift miles state, render `FinancingCosts` in rail when `tab === "analyze"`
- Edit: `apps/web/src/styles.css` — reuse existing `.control`, `.control-inline`, `.rail-title` classes; add minimal new rules only if layout needs them

## Testing

- Unit tests for `financing.ts`: zero-cost at `APR == breakevenAPR` (not raw `APR == opportunityRate` — see rate-convention note above), negative below breakeven, positive above it, `loanAmount <= 0` edge case, `APR = 0` and `opportunityRate = 0` edge cases, `breakevenAPR` independent of price/term/down-payment (same result across varied inputs at a fixed `opportunityRate`).
- Manual verification in browser: Analyze tab shows the section under Inputs, numbers update live, Rankings/Assumptions tabs do not show it, term presets and down-payment %/$ toggle behave, sync-to-deal-price button works and doesn't auto-resync afterward.
