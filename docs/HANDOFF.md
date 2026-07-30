# Handoff prompt for the next agent

Copy everything below the line into a fresh session started in
`/Users/jig/VSCode Projects/opencawr`.

Written 2026-07-29, after the R1–R14 session. Replaces the previous handoff.

---

You're picking up **OpenCAWR** ("Open Car Analysis — What's it Really cost"), a web app that
computes the true lifetime cost-per-mile of owning a used car — bought at a chosen odometer, kept
for a holding period the user picks — with the uncertainty shown as error bars rather than hidden.
It's the opposite of Edmunds/KBB, which only model a new car over a fixed 5-year window.

The original build order plus roadmap items R1–R14 are on `master` (merged and pushed
2026-07-29). Your job is the next round of work, not a rewrite.

## Read these first, in this order

1. `ROADMAP.md` — the backlog. **R14 is the next item.** R9/R2 are the other big ones.
2. `ASSUMPTIONS.md` — the written ledger of every assumption. Kept current, non-negotiably.
3. `DECISIONS.md` — product and engineering decisions already taken.
4. `OpenCAWR_SPEC.md` — the model's source of truth, especially §2–§5 and §9.
5. `docs/investigations/` — four deep analyses from the last session. **Read the relevant one
   before touching its area.** They contain measured numbers you should not re-derive.

## Hard constraints — not negotiable

- **One engine.** Never implement or duplicate cost math outside `packages/core`. Reuse its
  helpers (`curveAt`, `impliedModelYear`, `deriveBuyYear`, `isFeasibleBuy`, `feasibleOdoRange`,
  `buyPointSweep`) rather than re-deriving them.
- **Reference tests are exact.** `npm test -w @opencawr/core` (103 tests) asserts the engine
  reproduces every vehicle's stored `model_output` bit-for-bit at seed 42. If a change is
  *supposed* to move the numbers, run `npm run gen-reference -w @opencawr/core` and say so
  explicitly in the commit body. **Never regenerate to make a failing test pass.**
- **Estimates, not advice.** No "good deal / bad deal", no recommendations. Percentiles and dollar
  deltas only.
- **Launch gate (spec §9) is PARTIALLY cleared.** `reliability_tier` is now NHTSA-derived, but
  `repair_cost_multiplier_by_make` and `eol_maintained_miles` still trace to the same Consumer
  Reports judgment. **Do not describe the gate as closed** anywhere — spec, ledger, or app copy —
  until R14 lands. Consumer Reports, CarComplaints and RepairPal are all off the table as sources.
- **Ledger row in the same commit** as any new constant, threshold, or data source.
- **Node ≥ 20**: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` before any npm command. The
  default node is v16 and fails; plain `/opt/homebrew/opt/node` is broken too (missing icu4c).
  Pipeline tests need `OPENCAWR_PIPELINE_OFFLINE=1`.

## Environment gotchas that cost the last session real time

- **`vite dev` hangs** in sandboxed sessions. Verify on a production build instead.
- **`vite preview` binds IPv6 `[::1]` only**, while Chrome resolves `localhost` to IPv4 — so the
  browser silently gets an error page (`Frame with ID 0 is showing error page`) while `curl`
  succeeds. **Pass `--host 127.0.0.1`** and navigate to `127.0.0.1`, not `localhost`. Three
  subagents in a row reported "couldn't verify visually" before this was diagnosed.
- **`vite preview` serves whatever is already in `apps/web/dist`.** Rebuild first, or you will
  verify a stale bundle and conclude a shipped change is missing.
- **The intake dialog (`.intake-scrim`) is modal** and intercepts every click on first load.
  Dismiss it (button text "Skip") before interacting. `tr.row-clickable` opens the per-car drawer.
- No Playwright in this repo, but a working one is at
  `/Users/jig/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core` (CommonJS — import the
  default export, then destructure `chromium`), driving Chrome for Testing under
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/`. Pass `executablePath`
  explicitly; Playwright's own resolution points at a build that isn't downloaded.
- **NHTSA API traps** (all handled in `packages/pipeline` now, but know them): its model catalogue
  is trim-fragmented and inconsistent year-to-year, and returns the *same* complaints under
  multiple trim strings (XC90: 148 summed vs 74 de-duplicated by `odiNumber`); the complaints and
  recalls endpoints return **HTTP 400 with a valid `count: 0` body** for empty results; the edge
  **403s Node's default User-Agent** and any UA containing `(+https://…)`; and
  `api.nhtsa.gov/investigations` accepts `make`/`model` filters and **silently ignores them**.
- **`.superpowers/` is gitignored.** Durable analysis belongs in `docs/investigations/`.

## The big items

### R14 — close the Consumer Reports gate (next item)

Re-derive `eol_maintained_miles` and `repair_cost_multiplier_by_make`. Full entry in `ROADMAP.md`;
the short version is that these two correlate with the *old* seed tier at −0.838 and +0.602, so
they are the same judgment R12 just removed from `reliability_tier` — meaning R12 broke the seed's
internal consistency without removing the CR dependency.

Two traps specific to this one:
- **Do not derive them from the new tiers.** That recreates the three-hats problem in the other
  direction. They need genuinely independent sources, or an explicit statement that they are not
  derived.
- **A well-argued negative result is an acceptable outcome.** If no public per-make repair-cost
  source exists (RepairPal is struck; NHTSA has no cost data), collapsing the multiplier toward 1.0
  and saying plainly that make-level repair cost is not modeled beats inventing a source. Establish
  the licence position *before* building on iSeeCars, the way R13 did for IIHS-HLDI.

### R9 + R2 — the heatmap and model year

The owner's words: the heatmap "was a map of years and miles originally but it morphed into a map
of hold vs buy miles". R9 is that fix; R2 is the wider "model year as a designed surface" item.
Read both entries — R9 carries the context, including the one thing that will bite you:

**The hold axis is load-bearing.** Holding hold-miles constant per row is exactly what makes that
chart trustworthy. At a fixed hold, 65 of 67 cars show a sensible interior cheapest buy point; at
an open-ended horizon, only 9 of 71 do. If the hold axis goes, replace it with a *fixed* hold —
never `"eol"` — or you reintroduce the artifact that took most of the last session to find.

Also: odometer and model year are **coupled**, not independent
(`impliedModelYear = nowYear − odo/annualMiles`). At the default 13,000 mi/yr, putting model year
on the buy axis is close to a relabel of the axis that is already there. And note the heatmap's
low-odometer columns for the three big SUVs now show a flat run, because their first real price
observation is at 30,000 miles.

### The used-price re-pull (an OPEN ledger row, not yet a roadmap item)

36 in-production vehicles now carry an OEM MSRP anchor at 0 miles. But the retention test says
**20 of those 36 fail** the 0.80–0.90 band, and with the 7 rejected anchors that is **27 of 43
priced rows wanting a fresh used-price pull**. The MSRP anchor was never the real defect — the
existing used-price curves are too high at their low end. Fixing it properly means new listing
data, which runs straight into spec §9: ship fitted coefficients, never stored copies of a site's
listing tables.

### Known data bugs, logged unfixed

`last_year: 2026` is wrong for at least four rows — Toyota's own 2026 price sheet lists no gas
Camry and no gas RAV4 (both hybrid-only now), Kia has no 2026 Soul page, and Buick serves the
Encore from its "Legacy Vehicles" page. `last_year` feeds `feasibleOdoRange`, so fixing these
**will** move reference outputs and deserves its own commit.

## Two things awaiting the owner, not you

- **IIHS-HLDI permission.** Per-model insurance loss data would fix R13's known blind spot: value
  scaling cannot see theft or repair-cost outliers, and the Hyundai/Kia theft wave is exactly what
  it misses (the Elantra now reads near-cheapest in the field). The units bridge is already
  specified and validated; only the licence blocks it, and only the owner can write to
  `legal@iihs.org`.
- **What "ideal mileage" should mean**, if R8 still looks wrong after R10/R11. Re-measure before
  proposing a redefinition — most of the original problem is already gone.

## Working with this owner

They read carefully and push back on framing, not just conclusions. When the last session called
the discount-rate issue a "distortion", they correctly objected that miles don't appreciate and
that the real problem was unequal lifespans — the explanation was wrong, not merely imprecise.
Expect to explain *why* in plain terms before they'll approve a change, and expect the explanation
to be checked.

They also asked repeatedly for measured numbers rather than reasoning. Give them that: run the
counterfactual, report what it actually says, and say so plainly when the answer is inconvenient or
when a fix didn't work. Two of the most useful moments last session were reporting that a shipped
fix moved a metric the *wrong* way, and catching that a commit had quietly upgraded the launch gate
to "CLEARED" when two fields still traced to Consumer Reports.

Start by reading `ROADMAP.md` and confirming with the owner which items to take.
