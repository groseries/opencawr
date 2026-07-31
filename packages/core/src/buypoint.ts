import { CALIBRATION } from "./calibration.js";
import { parseCurve } from "./curves.js";
import { costPerMile } from "./engine.js";
import { deriveBuyYear, feasibleOdoRange } from "./feasibility.js";
import type { Constants, EngineInputs, EngineResult, Vehicle } from "./types.js";

/**
 * `buyPointSweep`'s own input type: identical to `EngineInputs` except
 * `holdMiles` is required and numeric — `"eol"` is unrepresentable here.
 * Comparing $/mi across buy points only makes sense when every grid point
 * shares one holding horizon (R10, ASSUMPTIONS.md §B): at `"eol"` the horizon
 * is itself a function of the buy odometer, so an identical cost stream
 * reports cheaper for whichever candidate implies the longer hold — the
 * unequal-lives problem (a shorter hold is never charged for the replacement
 * car it will need). Making the open-ended horizon a type error, rather than
 * silently defaulting to one, is the point.
 */
export type SweepInputs = Omit<EngineInputs, "holdMiles"> & { holdMiles: number };

/** One point on the buy-point sweep grid (reduced-draws P50 — see `CALIBRATION.sweepDraws`). */
export interface BuyPointSweepPoint {
  odo: number;
  p50: number;
  /** Model year this odometer implies, from `deriveBuyYear` (reused, never
   *  re-derived). Carried on the point so the model-year view (`modelYearRank`)
   *  can group THIS grid by year instead of running a second, separately-sampled
   *  optimization that could name a different year than `idealYear`. */
  year: number;
}

export interface BuyPointSweepResult {
  /** Odometer minimizing P50 over the feasible grid — a cost-minimizing buy point,
   *  not a recommendation to buy this car. Together with `idealYear` this is THE
   *  sweet spot: one (model year, odometer) pair, from one optimization. Ties are
   *  resolved to the LOWEST odometer (strict `<` while walking the grid upward);
   *  `modelYearRank` breaks its own ties the same way so its rank-1 row is this
   *  exact point. */
  idealOdo: number;
  idealP50: number;
  idealYear: number;
  /** Walking upward from `idealOdo`, the last odometer whose P50 stays within
   *  `CALIBRATION.worthwhileP50Tolerance` of `idealP50`, stopping at the first
   *  violation (contiguous — a later dip back under tolerance does not count).
   *  `null` when the walk can't take a single step: `idealOdo` is the grid's last
   *  point, or the very next point already violates. */
  upperOdo: number | null;
  grid: BuyPointSweepPoint[];
  /** Raw per-draw $/mi, keyed by odometer, for the handful of grid points the
   *  model-year view can report as a row — only present when `keepRowDraws` is
   *  set, and never for the whole grid. Carried for the same reason `year` is
   *  carried on each point: so `modelYearRank` can put its rows in tie tiers
   *  (`rankWithTiers`, spec §2/R15) using the very draws this sweep already
   *  produced, instead of re-pricing them. See `keepRowDraws` for which points
   *  are retained and why that set is enough. */
  rowDraws?: Map<number, Float64Array>;
}

export interface BuyPointSweepOpts {
  draws?: number;
  step?: number;
  /** Retain `drawsCpm` for the points `modelYearRank` can display: the cheapest
   *  point of each model year's own band, plus the grid's first and last point
   *  (a year with no feasible odometer of its own falls back to the grid point
   *  nearest its canonical odometer, which lies outside the swept range and so
   *  resolves to an end — 234/234 such rows across the seed field x 50k/100k/150k
   *  holds). At most `years + 2` draw arrays are alive at once, not one per grid
   *  point: a band's superseded winner is dropped as soon as a cheaper point in
   *  the same band appears. Off by default — no other caller needs the draws, and
   *  the Rankings path (`priceAtSweetSpot`) must not pay for them. */
  keepRowDraws?: boolean;
}

/**
 * Feasible buy-odometer bounds shared by every sweep over a vehicle's own
 * odometer range (R11 floor + eol cap): the year-implied `feasibleOdoRange`,
 * capped above at `eol_maintained_miles` and floored below at the price
 * curve's first observed odometer (below that, `curveAt` clamps flat rather
 * than inventing a price). Collapses to a single point (`lo === hi`) rather
 * than inverting when the year-implied minimum already exceeds the cap (e.g.
 * a low-production car at high annual miles) or the floor exceeds the
 * year-implied range (a curve with no early observations) — callers must not
 * assume `lo < hi`. Extracted so `buyPointSweep` and `modelYearRank` share
 * one definition of "which odometers are on the table" rather than drifting.
 */
export function feasibleSweepOdoRange(
  vehicle: Vehicle,
  constants: Constants,
  annualMiles: number,
): [number, number] {
  const [rangeLo, rangeHi] = feasibleOdoRange(vehicle, annualMiles, constants.now_year);
  const hi = Math.min(rangeHi, vehicle.eol_maintained_miles);
  const firstCurveOdo = parseCurve(vehicle.price_vs_odometer_usd)[0]!.x;
  const lo = Math.min(Math.max(0, rangeLo, firstCurveOdo), hi);
  return [lo, hi];
}

/**
 * Buy-point sweep (spec §4/R4): grid-searches `costPerMile`'s own `buyOdo` input
 * across a vehicle's feasible odometer range to find the point that minimizes
 * P50 $/mi. Adds no new pricing logic — `costPerMile` itself is untouched, this
 * is purely a grid search over its existing input (one engine, one cost model).
 *
 * This is the app's ONLY cost-minimizing search. Its result is a single sweet
 * spot — a (model year, odometer) pair, `idealYear`/`idealOdo` — and the
 * model-year panel is a view of this same grid grouped by year (`modelYearRank`),
 * never a second optimization on a different sample of the same curve. Owner,
 * 2026-07-30: *"We are trying to determine the best year AND mileage to buy at -
 * the true sweetspot. So it should be one."*
 *
 * Requires a numeric `holdMiles` (R10): every grid point must share the same
 * holding horizon for the comparison to be valid, and `"eol"` makes the
 * horizon itself a function of the buy odometer under comparison. Callers
 * holding an open-ended horizon must not run this sweep at all — see
 * `engine.worker.ts`'s `handleRank`, which prices at the default buy odometer instead.
 */
export function buyPointSweep(
  vehicle: Vehicle,
  constants: Constants,
  inputs: SweepInputs,
  opts: BuyPointSweepOpts = {},
): BuyPointSweepResult {
  // Runtime backstop: the type signature is the primary gate (a typed caller
  // cannot compile a call passing "eol"), but this guards untyped/`any`
  // callers too — see the "refuses" test in buypoint.test.ts.
  if ((inputs.holdMiles as unknown) === "eol") {
    throw new TypeError(
      'buyPointSweep requires a numeric holdMiles; "eol" is not comparable across buy points (R10, ASSUMPTIONS.md §B)',
    );
  }
  const am = inputs.annualMiles ?? constants.annual_miles;
  const draws = opts.draws ?? CALIBRATION.sweepDraws;
  const step = opts.step ?? CALIBRATION.sweepStepMiles;

  const [lo, hi] = feasibleSweepOdoRange(vehicle, constants, am);

  const grid: BuyPointSweepPoint[] = [];
  let idealIdx = 0;
  // Draw retention for the model-year view (`keepRowDraws`). Held per YEAR while
  // sweeping — a band's superseded winner is released the moment a cheaper point
  // in the same band replaces it — so the peak is `years + 2` arrays, not `grid`.
  const bandWinner = opts.keepRowDraws
    ? new Map<number, { odo: number; p50: number; drawsCpm: Float64Array }>()
    : null;
  let firstDraws: Float64Array | null = null;
  let lastDraws: Float64Array | null = null;
  for (let odo = lo; odo <= hi; odo += step) {
    // Fixed seed (matches costPerMile's own default) so every grid point is
    // deterministic and directly comparable point-to-point. The shared seed is
    // also what makes `rowDraws` comparable draw-for-draw (common random
    // numbers), which is the pairing `beatProb` assumes.
    const res = costPerMile(vehicle, constants, { ...inputs, buyOdo: odo, draws, seed: 42 });
    if (grid.length > 0 && res.p50 < grid[idealIdx]!.p50) idealIdx = grid.length;
    const year = deriveBuyYear(vehicle, odo, am, constants.now_year);
    if (bandWinner) {
      // Same rule, same direction as modelYearRank's own band grouping: strict
      // `<` while walking upward, so ties keep the lowest odometer.
      const cur = bandWinner.get(year);
      if (cur === undefined || res.p50 < cur.p50) {
        bandWinner.set(year, { odo, p50: res.p50, drawsCpm: res.drawsCpm });
      }
      if (firstDraws === null) firstDraws = res.drawsCpm;
      lastDraws = res.drawsCpm;
    }
    grid.push({ odo, p50: res.p50, year });
  }

  const ideal = grid[idealIdx]!;
  let upperIdx = idealIdx;
  for (let i = idealIdx + 1; i < grid.length; i++) {
    if (grid[i]!.p50 <= ideal.p50 * (1 + CALIBRATION.worthwhileP50Tolerance)) {
      upperIdx = i;
    } else {
      break;
    }
  }

  let rowDraws: Map<number, Float64Array> | undefined;
  if (bandWinner) {
    rowDraws = new Map();
    for (const w of bandWinner.values()) rowDraws.set(w.odo, w.drawsCpm);
    rowDraws.set(grid[0]!.odo, firstDraws!);
    rowDraws.set(grid[grid.length - 1]!.odo, lastDraws!);
  }

  return {
    idealOdo: ideal.odo,
    idealP50: ideal.p50,
    idealYear: ideal.year,
    upperOdo: upperIdx > idealIdx ? grid[upperIdx]!.odo : null,
    grid,
    ...(rowDraws ? { rowDraws } : {}),
  };
}

export interface SweetSpotPricing {
  /** The sweep that located the sweet spot. `idealP50` is its reduced-draw
   *  estimate; `priced.p50` below is the full-draw price of the same point. */
  sweep: BuyPointSweepResult;
  /** `costPerMile` evaluated AT the sweet spot, at the caller's own draw count.
   *  By construction `priced.buyOdo === sweep.idealOdo` and
   *  `priced.impliedBuyYear === sweep.idealYear` (both derive the year through
   *  `deriveBuyYear` from that one odometer), so a caller that reports the buy
   *  point from `sweep` and the money from `priced` cannot describe two
   *  different buy points. */
  priced: EngineResult;
}

/**
 * Price a vehicle at its OWN sweet spot: find the cost-minimizing (model year,
 * odometer) pair, then run the full cost model there.
 *
 * Exists so the two halves of a Rankings row — "which year and mileage" and
 * "what it costs" — are one answer instead of two. Before 2026-07-30 the app
 * displayed `buyPointSweep`'s sweet spot beside money priced at
 * `vehicle.pinned_buy_odo`, and at a 100k hold those disagreed on the odometer
 * for 68 of the 71 seed vehicles. Owner's decision that day: price the money at
 * the sweet spot. Pairing the two calls here, rather than at each call site,
 * is what makes the invariant testable in one place.
 *
 * Adds no pricing logic of its own: it is `buyPointSweep` followed by the same
 * `costPerMile` every other view calls, with `buyOdo` set to the sweep's answer.
 * Requires a numeric `holdMiles` for the same reason `buyPointSweep` does (R10)
 * — there is no sweet spot to price at an open-ended horizon, and callers
 * holding one must price at the default buy point instead.
 */
export function priceAtSweetSpot(
  vehicle: Vehicle,
  constants: Constants,
  inputs: SweepInputs,
  opts: BuyPointSweepOpts = {},
): SweetSpotPricing {
  const sweep = buyPointSweep(vehicle, constants, inputs, opts);
  const priced = costPerMile(vehicle, constants, { ...inputs, buyOdo: sweep.idealOdo });
  return { sweep, priced };
}
