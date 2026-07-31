# OpenCAWR — Blueprint for the web app

**OpenCAWR = "Car Analysis — What's it Really cost."** This document is the handoff spec for rebuilding the
spreadsheet prototype (`OpenCAWR.xlsx`, built by `build_v7.py`) as a full web application. The seed data is in
`opencawr_data.json`. Read this before writing code — it captures the model math, the design decisions, the hard-won
gotchas, and the things the web app should do *better* than the spreadsheet could.

---

## 1. What OpenCAWR is, and why it's different

Every mainstream tool (Edmunds True Cost to Own, KBB 5-Year Cost to Own, AAA Your Driving Costs) answers **one**
question: what does a **new** car cost over a **fixed 5-year** window? OpenCAWR answers a different, under-served
question:

> **What does it truly cost, per mile, to own THIS specific used car — bought at a given odometer and kept for a
> holding period I choose — and how confident can we even be in that number?**

The three things that make OpenCAWR different, and which must survive the rewrite:

1. **Lifetime / any-horizon cost per mile**, not a fixed 5-year window. The user chooses how long to keep the car.
2. **Uncertainty is a first-class output.** Every number is a distribution (Monte Carlo), not a point estimate.
   The app should *show the error bars* and tell the user when two cars are a statistical tie.
3. **Opportunity cost of capital** is priced in — the cash you sink into a car isn't compounding in the market.

The tagline is "the true cost of ownership of **any** car." The spreadsheet hardcodes 71 vehicles; the web app's
job is to make it work for **any** car via a data pipeline (Section 7).

---

## 2. The cost-per-mile model (the core engine)

For a vehicle bought at odometer `buy_odo` for price `P`, held until a **sell point** `sell_odo`, the cost per mile
is a present value:

```
$/mi = [ depreciation + Σ discounted(operating costs) + tires + battery reserve ] / (sell_odo − buy_odo)
       + energy_per_mile × avg_discount_factor
```

Components:

- **depreciation** = `P − resale(sell_odo) / (1+r)^T`, where `T = (sell_odo − buy_odo) / annual_miles`, `r` = the
  real discount rate. `resale(sell_odo)` is the market value at the sell odometer (from the price-vs-odometer curve,
  **extrapolated** past the last data point, floored at scrap — never clamped flat).
- **operating costs**, each discounted at `r` per year: base maintenance (rises with age), a **probabilistic
  major-repair tail** past ~120k mi (Poisson events × per-make cost multiplier + a hassle dollar value), insurance
  (full coverage while book value > threshold, else liability-only), registration.
- **energy** = gallons/mi × gas$ + kWh/mi × elec$, times an average discount factor over the holding period.
- **battery reserve** (EV/PHEV/hybrid) = P(pack failure) × pack cost, discounted to mid-life.

**Discount rate `r` = the market opportunity cost.** Default 7% real (S&P 500 long-run real return, NYU Stern
1928–2024 ≈ 6.9–7.2%). Discounting at the market rate **is** how the opportunity cost of tied-up capital enters the
model — do **not** add a separate per-year capital charge on top (that double-counts; the prototype had this bug and
it was removed). Make `r` a real, live input.

### Monte Carlo
Run N draws (prototype uses 1,100) randomizing: end-of-life mileage (lognormal), major-repair event count & cost,
insurance noise, battery-failure occurrence & timing. Report **P50 (median = the headline), P75, P90 (bad-luck
tail), and P05/P95 (the 90% band)**. The estimation error of the median is tiny (±$0.001–0.002 at N=1,100) — the
spread the user sees is genuine outcome variance, which is the point.

### Statistical significance (a core feature, not a nicety)
From the draws, compute **P(car A cheaper than car B)** for adjacent ranks, and group cars into **statistical tie
tiers** (walk the ranking; a car joins the current tier while the tier leader doesn't beat it with ≥85% probability).
The honest headline of the whole model is: *the top ~13 cars are 2 tie-tiers — specific ranks within a tier are
noise.* The UI must communicate this or it will mislead. See the uncertainty-ladder chart (Section 6).

---

## 3. THE HOLDING HORIZON (new, first-class feature — build this in from day one)

The prototype assumed "drive to death" (sell at end-of-life). **The single most valuable addition is letting the
user choose how long they keep the car**, because it flips which cars win:

- **Short hold (e.g. sell at 50k mi / 3 yrs):** depreciation dominates. Cars that hold value (Toyotas, trucks) win;
  fast depreciators look terrible even if cheap to run.
- **Long hold / drive-to-death:** operating cost dominates. Fuel-efficient, cheap-to-maintain cars win; the up-front
  premium amortizes away.

The same $/mi formula already supports this — just set `sell_odo = min(buy_odo + horizon_miles, EOL)` and use
`resale(sell_odo)` instead of scrap. **The engine already has a `horizon` hook** (`det(m, ..., horizon=)` in the
prototype), so this is a small lift.

Make it a primary control: **"How long will you keep it?" → [50k mi] [100k mi] [150k mi] [custom] [until it dies]**,
expressed in miles AND years (they're linked by annual mileage). Re-rank live. Show how the ranking reshuffles
across horizons — that contrast is genuinely insightful and no competitor offers it.

---

## 4. Inputs the user must be able to set (all live, all re-ranking)

| Input | Prototype default | Why it matters |
|---|---|---|
| **Holding horizon** (miles or years, or EOL) | drive-to-death | Section 3 — biggest lever on *which* car wins |
| **Annual mileage** | 13,000 | Biggest lever on absolute $/mi; also maps odometer↔model-year |
| **Discount / opportunity-cost rate** | 7% real | Market opportunity cost; higher rate favors cheaper-to-buy cars |
| **Gas $ / Electricity $** | CA $5.455 / $0.32 | Regional; drives energy cost |
| **Purchase price** (per car / per listing) | modeled curve | The single number the user can verify against a real listing |
| **Insurance basis** | USAA ×0.80, FL reg | Should come from a real quote; premium is set by *garaging ZIP*, not registration state |

Note the odometer↔year coupling: at 13k mi/yr, 20k mi ⇒ a ~2024 car. Feasibility is **two-sided** — a buy point is
invalid if the implied model year is before the car's first year OR after its last (discontinued) year. The
prototype got this wrong in both directions initially; the fixed logic is in `build_v7.py` (`_optbuy` cap +
heatmap greying).

---

## 5. Buy-point logic (and an honest subtlety to preserve)

For each car the prototype finds a "buy point" — the odometer to purchase at. Key truth discovered during
development: **with opportunity cost already in the $/mi (via 7% discounting), the cost curve is monotonic —
the newest car is always cheapest per mile.** The prototype's "pinned buy" is NOT the per-mile minimum; it's a
*tiebreaker*: among buy points within ~1.5¢/mi of the minimum (a statistical tie), pick the one that ties up the
**least cash**. Present both honestly: "lowest $/mi (newest, most cash)" vs "buy pick (least cash among ties)."
Don't claim opportunity cost pushes the buy older — it doesn't; the tiebreaker does. In the app, expose this as a
slider ("optimize for: lowest $/mi ↔ least cash up front").

---

## 6. The 4-layer UX (keep the structure; make it interactive)

1. **Survey (heat map).** $/mi across every odometer × implied-model-year for a car. Green = cheaper. Shows the
   near-flat cost curve and where buying is feasible. In the app: a proper heatmap, hover for the listing behind
   each cell.
2. **Rankings.** All cars ranked by $/mi at the chosen horizon/inputs, WITH the statistical tie-tier coloring,
   90% band, "beats next" probability, and the opportunity-cost columns.
3. **Deal Analyzer.** User pastes a real listing (year, odometer, price — ideally a VIN or URL) → scores THAT car
   against the idealized field. This is the money feature for a real buyer.
4. **Analysis suite.** Diagnostic charts. The most important one is the **uncertainty ladder**: each car as a
   floating bar spanning P05→P95 with the median marked, sorted, colored by tie-tier. *Overlapping bars = the
   model can't tell those cars apart.* (In the spreadsheet this was painful — Sheets ignores marker shapes, drops
   multi-domain scatter series, and won't render "invisible" chart segments. **In a real web charting lib all of
   that pain disappears** — build the ladder as a proper dot-and-whisker / interval plot.) Other charts: cost
   breakdown (stacked), payback curve, $/mi vs annual mileage, vs gas price, vs discount rate, cost-vs-risk quadrant.

---

## 7. Making it work for ANY car (the data pipeline — this is the real product)

The spreadsheet's 71 hardcoded vehicles are a **seed set**, not the product. To deliver "true cost of any car,"
each vehicle needs five data objects, which the app should source via a pipeline (with the seed set as fallback /
validation):

| Data object | What it is | Where to get it |
|---|---|---|
| **price vs odometer** | market $ at each mileage | live listing aggregation (cars.com / Marketcheck / Carvana APIs), fit a curve per model-year |
| **end-of-life mileage** | miles before scrapped | iSeeCars longevity study; owner-reported (CarComplaints, forums, high-mileage registries) |
| **reliability tier + bad model-years** | repair frequency/severity | NHTSA complaints, public data |
| **maintenance curve** | scheduled + wear cost by age | RepairPal / YourMechanic aggregates; OEM maintenance schedules |
| **specs** | mpg/kWh, seats, cargo, CO₂, insurance | EPA fueleconomy.gov API, manufacturer specs, insurance quote API |

`opencawr_data.json` gives the schema and 71 worked examples. A brand-new model (like the 2025 Kia K4 in the seed set)
has no used history — the app should detect this, fall back to **segment-peer proxies**, and **label the result as
an estimate** (the seed data has a `provenance` field for exactly this).

---

## 8. Recommended architecture

- **One canonical cost engine.** The prototype has TWO deterministic engines (`det` and `_fixedcpm`) that disagree
  by ~1–2¢; unify to a single pure function `costPerMile(vehicle, inputs) → {p50,p75,p90,p05,p95,breakdown}`. Run it
  in a Web Worker or server function; it's cheap (N≈1,000 draws × ~70 cars is milliseconds).
- **Pure model core, separate from data and UI.** `core/` (the math, fully unit-tested against the values in
  `opencawr_data.json.model_output`), `data/` (the pipeline + cache), `ui/`.
- **Live everything.** Every input in Section 4 re-runs the engine — no precomputed lookup tables (that was a
  spreadsheet limitation, faked with a discount-rate grid; throw it away).
- **Deterministic seed for tests.** Fix the RNG seed; assert the engine reproduces `model_output` for the seed
  vehicles so refactors can't silently drift the numbers.
- Suggested stack: TypeScript + React, a real charting lib (Observable Plot, Recharts, or ECharts — all handle
  interval/whisker charts natively), the model core as framework-agnostic TS.

---

## 9. Data provenance & legal

All data fields are sourced from publicly available, unrestricted datasets:
- **`reliability_tier`** — NHTSA complaint data, public domain, keyless, per `docs/reliability-methodology.md`.
- **`eol_maintained_miles`** — New York State DMV vehicle inspections (data.ny.gov), public data, per `docs/eol-methodology.md`.
- **`repair_cost_multiplier_by_make`** — set to 1.0 (no public per-make repair-cost source exists).

Price curves ship as **fitted coefficients** (a price-vs-odometer slope), never stored copies of a site's listing
tables. Prefer licensed feeds (Marketcheck, etc.) for a commercial product.

Present output as **estimates, not advice** (disclaimer; you're not a licensed advisor). Form an LLC before
taking money, and — the owner is **active-duty military** — clear a commercial venture with the installation ethics
counsellor first (DoD 5500.07-R; don't use rank/position/government resources to promote it).

---

## 10. Known limitations to fix or flag (from the assumptions ledger)

- **Annual mileage (13k) is assumed, not measured** — get the user's real number; it's the biggest lever.
- **EOL dispersion is uniform (σ=0.12) across makes** — so a Fiat's uncertainty band is too narrow vs a Corolla's.
  Make dispersion depend on reliability tier so unreliable cars show honestly wider bands.
- **Calendar age ≈ odometer ÷ 13k** — a garage-kept low-mileage old car is treated as young. Carry real model-year
  as a separate state variable so rubber/seals/rust/electronics age on a clock, not just on mileage.
- **Ranking is on P50 median** — offer a "rank by P75 (reliability-decisive)" toggle.
- **Total-loss doesn't truncate life** — a totaled car should end the holding period, not keep accruing.
- **A few `last`-production-years and prices need a fresh audit** — the pipeline (Section 7) supersedes the hand
  curves. `provenance` flags which seed rows are curated vs proxied.
- **Fiat 500 / cheap-but-unreliable cars** still rank mid-pack on P50 because cheap price + good mpg offset a real
  reliability penalty; ranking on P75 or widening per-make dispersion demotes them, which is more honest.

---

## 11. Files in this handoff

- `OpenCAWR.xlsx` — the working prototype (11 user tabs + 2 data-helper tabs). Reference for behavior & copy.
- `opencawr_data.json` — 71 seed vehicles, full schema + computed `model_output` (use as the engine's golden test set).
- `build_v7.py` — the prototype source. The model math lives in `sim()`, `det()`, `_fixedcpm()`, `_optbuy()`,
  `opp_growth()`, `beat_prob()` / tie-tier logic, and the constants at the top. Port the math, discard the openpyxl
  charting and the Google-Sheets workarounds.
- `OpenCAWR_SPEC.md` — this document.

**Build order suggestion:** (1) port the cost engine as pure TS, validated against `model_output`; (2) wire the
Section-4 inputs live incl. the holding horizon; (3) rankings + uncertainty ladder; (4) Deal Analyzer; (5) the data
pipeline for arbitrary cars; (6) provenance cleanup before any public launch.
