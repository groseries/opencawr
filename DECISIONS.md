# OpenCAWR — Product & Engineering Decisions

Decisions agreed with the owner (2026-07-27). The spec (`OpenCAWR_SPEC.md`) is the source of
truth for the model; this file records product-flow and implementation decisions layered on top.

## Product flow (owner's vision, agreed)

1. **Intake** — short questionnaire (4–5 high-leverage questions: miles/yr, holding horizon,
   seats/type, ZIP), everything else defaulted. Intake and the results-view controls share ONE
   input state — "answer a little, refine forever," never a gate before results.
2. **Assortment** — engine ranks the whole field; user-need filters are SOFT (non-matching cars
   grayed/collapsed, never removed) so the marketplace-wide picture and tie-tiers stay visible.
3. **Drill-down** — full analysis suite (§6), live re-ranking on every input change.
4. **Deal evaluation** — score pasted listings vs the marketplace, vs the user's other deals, and
   vs community-submitted deals for the same car.

## Specific decisions

- **Rename**: project is **OpenCAWR** everywhere (repo `groseries/opencawr`, done 2026-07-27).
- **Opportunity cost**: implemented ONLY as the discount rate `r` (one engine, no boolean
  branch). "Don't factor it" = r `0%`; default `7%`; always user-adjustable (expected market
  return input). Copy must note that at r=0 the "newest buy is always cheapest" monotonicity
  no longer holds.
- **ZIP code** drives regionalization: state registration fee, gas $, electricity $, insurance
  basis (garaging ZIP per spec §4).
- **Both §5 descriptors kept**, explained in plain English: (a) "lowest $/mi ↔ least cash up
  front" slider (buy-point tiebreaker among statistical ties), and (b) rank by P50 vs P75
  ("expected cost" vs "protects against bad luck") as a risk-tolerance toggle.
- **Deal scoring is a percentile, not a verdict** ("18th percentile of simulated outcomes for
  this model at this odometer" + $ vs modeled curve). Estimates, never advice (§9).
- **Community deals are pipeline inputs** (the §7 flywheel): keyed on VIN where available
  (dedupes relistings, price-drop history), freshness decay, and a QUALITY-CONTROL layer is
  required before community data influences curves (owner requirement): provenance tracking,
  outlier/plausibility checks vs the modeled curve, VIN-decode consistency, rate limiting.
- **Seed outputs are a calibration REFERENCE, not truth** (owner, 2026-07-27): the 71
  `model_output` rows were audited but are not perfect, contain owner-specific assumptions
  to generalize, and were produced by a prototype that evolved past its own docs. Every
  assumption — explicit and implicit — is tracked in **ASSUMPTIONS.md**; keep it current
  as we work. Spec §10 improvements (per-tier EOL dispersion, total-loss truncation, real
  model-year aging) ship as deliberate model revisions with regenerated reference outputs.
- **`build_v7.py` is lost** (not in handoff, not on disk). Every reverse-engineered distribution
  or constant not present in the spec/data lives in `packages/core/src/calibration.ts` with a
  comment stating it is inferred, not sourced.
- **Golden tolerances**: ±$0.005/mi on P50/P75, ±$0.01/mi on P05/P95, exact-determinism of the
  TS engine vs itself (fixed seed), slack on tie-tier flips near the 85% boundary.

## Launch gate (spec §9 — machine-readable)

`opencawr_data.json` meta confirms reliability multipliers were NOT re-derived from
NHTSA/CarComplaints/RepairPal. Until that happens, every seed vehicle's reliability figure is
**public-launch-blocked**. The app must carry this flag; do not remove it in a refactor.
