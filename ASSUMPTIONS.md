# OpenCAWR — Assumptions Ledger

The single written record of every assumption in the model: explicit, implicit, inferred,
and contested. **Owner directive (2026-07-27): the 71 seed `model_output` rows are a
calibration REFERENCE, not absolute truth** — they were produced by a lost prototype
(`build_v7.py`) that itself evolved past its own documentation. Update this file whenever
an assumption is added, changed, generalized, or retired. Statuses:

- **SOURCED** — traceable to a real dataset/publication
- **DOCUMENTED** — stated in the prototype's own docs (`CAWR.xlsx` "Assumptions" / "Model & Method" tabs)
- **INFERRED** — reverse-engineered by fitting the 71 reference outputs; no independent source
- **CONFLICT** — documentation and reference outputs disagree; resolution recorded
- **USER-SPECIFIC** — true for the owner's situation only; must become a user input before general release

## A. User-specific assumptions to generalize (all become inputs; owner's values are the defaults)

| Assumption | Value | Status | Generalization path |
|---|---|---|---|
| Annual mileage | 13,000 mi/yr | USER-SPECIFIC, user-confirmed not measured | intake question; biggest single lever (xlsx "STILL OPEN") |
| Insurance multiplier | ×0.80 (USAA active-duty) | USER-SPECIFIC | replace with real quote or ZIP-based basis; applies to full coverage AND the $1,176 liability floor (→ ~$941) per v2b |
| Registration | $55/yr flat (FL home-of-record) | USER-SPECIFIC | per-state table (CA = VLF ~0.65% + smog + $118 ZEV fee — deliberately NOT charged for the owner); omits FL one-time ~$225 initial + ~$77 title |
| Gas / electricity | $5.455/gal / $0.32 kWh (CA) | USER-SPECIFIC | ZIP-derived regional prices |
| Use tax on purchase | 7% (CA rate) | USER-SPECIFIC + DOCUMENTED (v2 fix I-12) | per-state rate from ZIP |
| EV home charging | ~85% home / 15% DCFC | USER-SPECIFIC + DOCUMENTED (I-22) | intake question; no-home-charger sharply raises EV $/mi |
| Discount rate | 7%/yr real | DOCUMENTED-CONFLICT: xlsx narrative says 5%, JSON constants + verified opp-cost columns say 7% | already a live input; 7% is the operative default (S&P long-run real) |

## B. Model structure (prototype-documented; engine status)

| Mechanism | Documented form (xlsx) | In TS engine today? |
|---|---|---|
| Cost equation | [dep + Σ disc(ops) + tires + battery] ÷ miles + energy × avg discount factor | ✅ |
| Depreciation | price curve at buy odo → resale (scrap at EOL; curve value at earlier sell), extrapolated never clamped, floored at scrap | ✅ |
| Use tax | +7% × purchase price at t0 | ❌ not yet (see §E1) |
| Total-loss charge | 1.5%/yr × $750 deductible while full-coverage; × full book value when liability-only; does NOT truncate life (open limitation) | ❌ not yet (see §E1) |
| Insurance | per-model full-coverage premium (JSON stores pre-USAA) × 0.8, drop to liability-only < $6k book | ✅ (liability×0.8 missing — with §E1) |
| Major-repair tail | Poisson past 120k mi; **rate ramps ×(1+(odo−120k)/100k)**; cost lognormal σ=0.5 × make-mult × year-mult + $600 hassle | ⚠ flat rate today, σ=0.33 fitted; ramp not yet in |
| Calendar-age escalator | ×(1 + 2%/yr past age 8), age still = odo÷13k (their "PARTIAL" fix — real calendar age remains open) | ⚠ approximated by a fitted ×3.5 late-maintenance slope; replace with documented form (§E1) |
| Year-reliability multiplier | landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95, applied to REPAIR only | ⚠ engine currently also applies to maintenance (fitted); revisit with §E1 |
| Battery | Bernoulli × lognormal cost at ~65% of life: hybrid 15%×$2.5k, PHEV 22%×$4k, EV 30%×$12k, **Tesla $14k, Leaf 55%×$8k**; σ 0.40/0.40/0.35 | ⚠ close (EV 33%×$11.5k inferred); needs per-model fields in data (§E4) |
| Energy | outside the Monte Carlo; EV kWh ×1.08 degradation, elec ×1.09 (EV) / ×1.06 (PHEV) DCFC premium; 0%/yr price escalation | ⚠ multipliers not yet in |
| Sport class | 70k-mile ownership (not drive-to-death), resale ≈ purchase (0.60–1.0 retention) | ❌ engine has no class-specific horizon; explains the two Porsche reference rows (§D) |
| EOL | iSeeCars empirical × 1.30 "maintained" bonus (already baked into `eol_maintained_miles`) | ✅ |
| Opportunity cost | ONLY via discounting; the +5%/yr capital charge was proven double-counting and removed (v2b) | ✅ |
| Monte Carlo | N=1,100, numpy seed 42; P50 stable ±$0.004 | ✅ (own PRNG; statistical equivalence only) |

## C. Distribution parameters

| Parameter | Documented | Fitted vs reference outputs | Resolution |
|---|---|---|---|
| EOL dispersion σ | 0.12 lognormal, uniform across makes | 0.07–0.08 fits the published bands | **CONFLICT — unresolved** (§E2). Note xlsx itself flags "uniform σ misrepresents a Fiat vs a Corolla" |
| Repair cost σ | 0.50 | 0.33 | CONFLICT — likely coupled to the missing ramp/escalator; re-fit after §E1 |
| Insurance noise | Normal(1, 0.08) per year | lognormal 0.05 on total | reconcile with §E1 (per-year form is better; averages to ~2–3% of PV) |
| Battery cost σ | 0.35–0.40 | not fitted (fixed cost) | adopt documented |

## D. Data-quality flags (seed set)

- **Porsche 996 Carrera / Turbo**: reference rows follow the sport rule (70k-mi hold, value retention) — not comparable to drive-to-death rows. Exempted from opp-cost tests; treat all their outputs as sport-rule outputs.
- **Fiat 500**: forced landmine ×1.40 in v2b ("no 500 model year is reliable") — the JSON's `model_year_reliability` does NOT encode this; fix belongs in data, not engine special-cases (§E5).
- **Maintenance curves are shared** across 42 of ~70 cars (Elantra=Sorento, CX-90=Suburban, …) — per-car precision is an illusion; fine for tiers, not for head-to-head claims.
- **Kia K4** is `proxied` (no used history). Reference outputs for it inherit every proxy assumption.
- **Reliability tiers + per-make multipliers are judgment calls**, not sourced tables (xlsx Part 4c), and reliability data traces to Consumer Reports → **public-launch blocked** until re-derived (spec §9).
- The Any-Car Calculator tab used a *simpler second model* (RUNBASE) — never port it; one engine only.

## E. Open questions requiring owner input (2026-07-27)

1. **Which model is canonical?** The reference outputs match neither the base model nor the fully-documented v2b stack — `build_v7` evolved further, and component on/off fits are degenerate (many subsets score identically). Recommended: implement the documented v2b structure faithfully (tax, total-loss, ramp, escalator, energy adders, per-model battery), then **regenerate the reference outputs from our engine** and retire the JSON numbers to historical status.
2. **σ_EOL**: keep documented 0.12 (wider, more honest bands) or the 0.07 that reproduces the published bands? (Moot if #1 = regenerate.) Per-tier dispersion is the eventual fix (spec §10).
3. **Real insurance quotes**: the prototype repeatedly notes premiums are estimates pending the owner's real USAA numbers. Provide if available; otherwise premiums stay per-model estimates.
4. **Battery fields into the vehicle schema** (prob, pack cost, σ per model incl. Tesla/Leaf overrides) instead of engine constants — approve schema addition.
5. **Fiat 500 data fix**: move all its model years to `bad` in the data (with a provenance note) — approve.
6. **Sport-class policy**: keep a hard-coded 70k-mi/value-retention rule, or drop the special case and let the holding-horizon input express it (recommended), accepting the two Porsche reference rows are then untargetable?
