# OpenCAWR

**What a used car really costs per mile — with the uncertainty shown, not hidden.**

### [→ opencawr.com](https://opencawr.com)

[![CI](https://github.com/groseries/opencawr/actions/workflows/ci.yml/badge.svg)](https://github.com/groseries/opencawr/actions/workflows/ci.yml)

OpenCAWR runs a Monte Carlo cost-per-mile simulation across a 71-vehicle catalogue —
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
State DMV vehicle inspections). Price curves ship as fitted coefficients only, never stored
copies of a listing site's data. See [`OpenCAWR_SPEC.md`](OpenCAWR_SPEC.md) and
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

Project ledger and roadmap: [`ASSUMPTIONS.md`](ASSUMPTIONS.md), [`ROADMAP.md`](ROADMAP.md),
[`OpenCAWR_SPEC.md`](OpenCAWR_SPEC.md).
