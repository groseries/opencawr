# OpenCAWR

**What a used car really costs per mile — with the uncertainty shown, not hidden.**

### [→ opencawr.com](https://opencawr.com)

[![CI](https://github.com/groseries/opencawr/actions/workflows/ci.yml/badge.svg)](https://github.com/groseries/opencawr/actions/workflows/ci.yml)

OpenCAWR runs a Monte Carlo cost-per-mile simulation across a 107-vehicle catalogue —
depreciation, fuel/energy, maintenance, repairs, insurance, and end-of-life risk — and reports a
full uncertainty band (P05–P95) instead of a single point estimate. Three views:

- **Rankings** — every vehicle priced at your inputs, tie-tiered so the app never claims a false
  ordering between statistically indistinguishable cars.
- **Analyze** — score a specific real-world listing (year, odometer, price) against the modeled
  field.
- **Assumptions** — every constant, data source, and open limitation, rendered live from this
  repo's own ledger (`ASSUMPTIONS.md`) so the app can't drift from what it discloses.

Estimates from a simulation, not advice.

## Data provenance

All reliability and durability inputs are derived from public sources (NHTSA complaint data, NY
State DMV vehicle inspections) — none trace to Consumer Reports or any other compilation that
restricts commercial/public use. Price curves ship as fitted coefficients only, never stored
copies of a listing site's data. See [`OpenCAWR_SPEC.md`](OpenCAWR_SPEC.md) §9 and
[`ASSUMPTIONS.md`](ASSUMPTIONS.md) for the full methodology and disclosed limitations.

## Development

Requires Node 22 (see `.nvmrc`).

```bash
npm install

# core cost-engine tests
npm test -w @opencawr/core

# data pipeline tests (offline fixtures, no live API calls)
OPENCAWR_PIPELINE_OFFLINE=1 npm test -w @opencawr/pipeline

# web app dev server
npm run dev -w @opencawr/web

# production build
npm run build -w @opencawr/web
```

## Structure

- `packages/core` — the cost-per-mile simulation engine (pure TypeScript, no I/O).
- `packages/pipeline` — data derivation from public sources (NHTSA, NY DMV, EPA) into the vehicle
  catalogue.
- `apps/web` — the Vite/React frontend, deployed as a Cloudflare Worker.

**Pushing to `master` deploys to [opencawr.com](https://opencawr.com) automatically**, via a
Cloudflare git integration configured in the Cloudflare dashboard — not by anything in this repo
(`.github/workflows/ci.yml` stops at `npm run build`). Verified 2026-09-26: the live asset hash
changed within 30 seconds of a `master` push. The vehicle catalogue is bundled into the worker at
build time (`apps/web/src/engine.worker.ts` imports `opencawr_data.json`), so a seed-data change
only reaches the site after that rebuild — merging alone is not enough, and pushing a branch does
nothing.

Project ledger and roadmap: [`ASSUMPTIONS.md`](ASSUMPTIONS.md), [`ROADMAP.md`](ROADMAP.md),
[`OpenCAWR_SPEC.md`](OpenCAWR_SPEC.md).
