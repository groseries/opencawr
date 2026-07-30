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
- **`build_v7.py` is lost**, but `CAWR.xlsx`'s "Assumptions"/"Model & Method" tabs document
  the v2b model. **Owner decisions 2026-07-27**: (1) v2b is canonical — implemented in the
  engine, reference outputs regenerated from it (prototype originals preserved as
  `model_output_prototype`); (2) EOL dispersion is per-tier (low .10 / mid .12 / high .15 /
  sport .15); (3) battery risk, Fiat-500 all-years-bad, and shared-curve flags moved into the
  data schema; (4) no hard-coded sport-class rule — passion vehicles use the same engine with
  their own inputs (low annual miles, chosen horizon).
- **Test policy**: the engine must reproduce the stored reference outputs EXACTLY (fixed seed);
  regenerating them is a deliberate, reviewed numbers-change event, never a CI fix.

## Launch gate (spec §9 — machine-readable)

**CLEARED 2026-07-29 for the seed set.** Every non-`sport` `reliability_tier` in
`opencawr_data.json` is re-derived from NHTSA complaint data alone (`docs/reliability-methodology.md`;
`npm run reliability-report -w @opencawr/pipeline`), and `meta.provenance_note` records that.
**CarComplaints and RepairPal were evaluated and deliberately NOT used** — commercial sites, no free
API, extracting their aggregates would create the very exposure spec §9's second clause guards
against; they are struck from §9. Owner decision the same day: "we have made sufficient changes that
deviations from the seed are expected at this point," releasing the seed-agreement constraint.

Two things this does **not** clear, and which must keep their flags: pipeline-**assembled**
(non-seed) vehicles still get a proxied `reliability_tier` and a placeholder model-year heuristic,
both still marked in the provenance report; and the derivation is a coarse ordering with real
limitations (methodology, "Known limitations"). Do not remove those flags in a refactor.
