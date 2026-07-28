# OpenCAWR — Assumptions Ledger

The single written record of every assumption in the model: explicit, implicit, inferred,
and contested. **Owner directive (2026-07-27): the 71 seed `model_output` rows from the
lost prototype are a REFERENCE, not truth.** On 2026-07-27 the owner made the v2b model
(as documented in the prototype's own `CAWR.xlsx` "Assumptions"/"Model & Method" tabs)
canonical, and the reference outputs were **regenerated from our engine**; the prototype's
originals are preserved per-vehicle as `model_output_prototype` (revision-log ethos: keep
old numbers, never delete). Update this file whenever an assumption is added, changed,
generalized, or retired. Statuses:

- **SOURCED** — traceable to a real dataset/publication
- **DOCUMENTED** — stated in the prototype's own docs (CAWR.xlsx tabs)
- **JUDGMENT** — a deliberate, labeled modeling choice with no external source
- **USER-SPECIFIC** — true for the owner's situation only; must become a user input before general release

## A. User-specific assumptions to generalize (all become inputs; owner's values are the defaults)

| Assumption | Value | Status | Generalization path |
|---|---|---|---|
| Annual mileage | 13,000 mi/yr | USER-SPECIFIC, user-confirmed not measured | intake question; biggest single lever |
| Insurance multiplier | ×0.80 (USAA active-duty), applied to full coverage AND the $1,176 liability floor | USER-SPECIFIC | engine input; an explicit real-quote input bypasses the multiplier entirely |
| Registration | $55/yr flat (FL home-of-record) | USER-SPECIFIC | per-state table (CA = VLF ~0.65% + smog + $118 ZEV — deliberately NOT charged for the owner); omits FL one-time ~$225 initial + ~$77 title |
| Gas / electricity | $5.455/gal / $0.32 kWh (CA) | USER-SPECIFIC | ZIP-derived regional prices |
| Use tax on purchase | 7% (CA rate; `constants.use_tax_rate`, engine input `useTaxRate`) | USER-SPECIFIC + DOCUMENTED | per-state rate from ZIP |
| EV home charging | ~85% home / 15% DCFC baked into the ×1.09/×1.06 electricity multipliers | USER-SPECIFIC + DOCUMENTED | intake question; no-home-charger raises EV $/mi sharply |
| Discount rate | 7%/yr real (xlsx narrative says 5% in places; 7% is operative) | DOCUMENTED | already a live input; r=0 = "ignore opportunity cost" |

## B. Model structure (v2b, canonical since 2026-07-27 — all implemented in `@opencawr/core`)

| Mechanism | Form | Status |
|---|---|---|
| Cost equation | [dep + use tax + Σ disc(maint, ins, reg, total-loss, repairs) + tires + battery] ÷ miles + energy × avg discount factor | DOCUMENTED |
| Depreciation | price curve at buy odo → resale (scrap at EOL; curve value at earlier sell), extrapolated, floored at scrap | DOCUMENTED |
| Use tax | rate × purchase price at t0 | DOCUMENTED |
| Total-loss exposure | 1.5%/yr × $750 deductible while full-coverage; × full book value when liability-only. Does NOT truncate life (open limitation) | DOCUMENTED |
| Insurance | per-model premium (pre-multiplier in data) × multiplier; liability-only once book < $6k; noise Normal(1, 0.08) per year | DOCUMENTED |
| Major-repair tail | Poisson past 120k mi, hazard ×(1+(odo−120k)/100k); cost lognormal σ=0.5 × make-mult × year-mult + $600 hassle | DOCUMENTED |
| Calendar-age escalator | ×(1 + 2%/yr past age 8) on scheduled maintenance AND repair-event costs (doc says "repairs"; broad reading is a JUDGMENT). Age = odo ÷ annual miles — real calendar age still open (worst for garage-kept/passion cars) | DOCUMENTED + JUDGMENT |
| Year-reliability multiplier | landmine ×1.40 / caution ×1.15 / sweet-spot ×0.95, repair costs only | DOCUMENTED |
| Battery | per-vehicle data fields (prob, pack $, σ): EV 30%×$12k, Tesla 30%×$14k, Leaf 55%×$8k, PHEV 22%×$4k, hybrid 15%×$2.5k; Bernoulli × lognormal at 65% of life | DOCUMENTED (values are labeled judgment) |
| Energy | outside the Monte Carlo (deterministic horizon); EV kWh ×1.08 degradation; elec ×1.09 EV / ×1.06 PHEV DCFC premium; 0%/yr price escalation | DOCUMENTED |
| EOL | `eol_maintained_miles` = iSeeCars empirical × 1.30 "maintained" bonus (baked in); lognormal dispersion per tier (§C) | SOURCED × JUDGMENT |
| Opportunity cost | ONLY via discounting; +5%/yr capital charge proven double-counting, removed v2b | DOCUMENTED |
| Sport/passion vehicles | NO special-case rule (owner decision): a vehicle of passion runs through the same engine with its own inputs (low annual miles, chosen horizon, curve-based resale). The calendar-age limitation bites hardest here | OWNER DECISION |
| Monte Carlo | N=1,100 default, seed 42, own deterministic PRNG; P50 stability ~±$0.004 across seeds | DOCUMENTED |

## C. Distribution parameters (resolved 2026-07-27)

| Parameter | Value | Status |
|---|---|---|
| EOL dispersion σ | per tier: low 0.10 / mid 0.12 / high 0.15 / sport 0.15 (`constants.eol_sigma_by_tier`) | OWNER DECISION (spec §10 fix; prototype's uniform 0.12 was DOCUMENTED, its published bands implied ~0.07 — superseded by regeneration) |
| Repair cost σ | 0.50 lognormal per event | DOCUMENTED |
| Insurance noise | Normal(1, 0.08) per year | DOCUMENTED |
| Battery cost σ | per-vehicle field (0.35 EV / 0.40 PHEV+hybrid) | DOCUMENTED |

## D. Data-quality flags (seed set)

- **`model_output` is generated by our engine** (meta.reference_engine records draws/seed/date); `model_output_prototype` is the lost prototype's original — historical only, never asserted.
- **Porsche 996 Carrera / Turbo**: prototype rows used a special sport rule (70k-mi hold, resale ≈ purchase). Our reference computes them drive-to-death like everything else — their headline $/mi is not meaningful for a passion-use case; use per-car inputs instead.
- **Fiat 500**: all model years marked `bad` (v2b audit: "no 500 model year is reliable") — encoded in data, not code.
- **Maintenance curves shared** across 43 cars (`maintenance_curve_shared_with` field) — per-car precision is an illusion; fine for tiers, not head-to-head claims.
- **Kia K4** is `proxied` (no used history); inherits every proxy assumption.
- **Reliability tiers + per-make multipliers are judgment calls** (xlsx Part 4c), and reliability data traces to Consumer Reports → **public-launch blocked** until re-derived from NHTSA/CarComplaints/RepairPal (spec §9).
- The prototype's Any-Car Calculator used a *simpler second model* — never port it; one engine only.

## E. Decision log / open items

| Date | Item | Resolution |
|---|---|---|
| 2026-07-27 | Canonical model | v2b structure implemented; reference outputs regenerated from our engine; prototype numbers preserved as `model_output_prototype` |
| 2026-07-27 | EOL dispersion | per-tier σ (see §C) |
| 2026-07-27 | Battery / Fiat / shared-curve data fixes | approved and applied to `opencawr_data.json` |
| 2026-07-27 | Sport class | no hard-coded rule; passion vehicles = same engine, per-car inputs |
| OPEN | Real insurance quotes | premiums remain per-model estimates until the owner provides real USAA numbers (engine accepts `fullCoverageUsdYr` as-is) |
| OPEN | Real calendar age as a state variable | age is still odometer-derived; garage-kept old cars under-aged (matters most for passion vehicles) |
| OPEN | Total-loss life truncation | a totaled car should end the holding period; currently only an annual $ charge |
| OPEN | Reliability re-derivation (launch gate) | NHTSA/CarComplaints/RepairPal pipeline — spec §9, blocks public launch |
