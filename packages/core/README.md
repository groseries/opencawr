# @opencawr/core

The **one** OpenCAWR cost engine (spec §8): a pure, framework-agnostic TypeScript function

```ts
costPerMile(vehicle, constants, inputs) → { p50, p75, p90, p05, p95, breakdown, … }
```

Monte Carlo (deterministic seeded PRNG) over end-of-life miles, major-repair events,
insurance noise, and EV battery failure. Opportunity cost of capital enters **only**
through discounting at the market rate — there is intentionally no separate capital
charge (spec §2). `holdMiles` implements the holding horizon (spec §3); `rankWithTiers`
implements beat-probabilities and statistical tie tiers; `feasibility.ts` implements the
two-sided odometer↔model-year check (spec §4).

Requires Node ≥ 20 (`nvm use` / Homebrew `node@22`; the tests won't run on Node 16).

## Fidelity to the prototype (READ BEFORE TOUCHING NUMBERS)

The prototype source (`build_v7.py`) was **lost before handoff**. This engine was
reverse-engineered from `OpenCAWR_SPEC.md` plus the 71 golden `model_output` rows in
`opencawr_data.json`. Inferred parameters live in `src/calibration.ts` and nowhere else.

Current fidelity (fleet mean absolute error vs golden): **≈ $0.007/mi on P50** (57/71
cars within $0.01; tie tiers within ±1 everywhere; opportunity-cost columns exact except
the two Porsches, whose golden rows provably came from a different prototype run).

Two test layers guard this:

1. `test/golden.test.ts` — per-car deltas vs golden must stay within
   `test/fidelity-manifest.json` allowances, plus fleet-MAE ceilings. **Never regenerate
   the manifest to make CI pass** — regeneration (`npm run gen-manifest`) is only for
   deliberate, reviewed calibration changes.
2. `test/determinism.test.ts` — with a fixed seed the engine must be bit-identical to
   its pinned snapshots forever. This is the refactor guardrail.

## Launch gate

Reliability inputs in the seed data trace to Consumer Reports and are **not publicly
shippable** until re-derived from NHTSA/CarComplaints/RepairPal (spec §9, DECISIONS.md).
All outputs are estimates, not advice.
