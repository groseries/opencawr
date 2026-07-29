import { CALIBRATION } from "./calibration.js";
import { parseCurve } from "./curves.js";
import { costPerMile } from "./engine.js";
import { deriveBuyYear, feasibleOdoRange } from "./feasibility.js";
import type { Constants, EngineInputs, Vehicle } from "./types.js";

/** One point on the buy-point sweep grid (reduced-draws P50 — see `CALIBRATION.sweepDraws`). */
export interface BuyPointSweepPoint {
  odo: number;
  p50: number;
}

export interface BuyPointSweepResult {
  /** Odometer minimizing P50 over the feasible grid — a cost-minimizing buy point,
   *  not a recommendation to buy this car. */
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
}

export interface BuyPointSweepOpts {
  draws?: number;
  step?: number;
}

/**
 * Buy-point sweep (spec §4/R4): grid-searches `costPerMile`'s own `buyOdo` input
 * across a vehicle's feasible odometer range to find the point that minimizes
 * P50 $/mi. Adds no new pricing logic — `costPerMile` itself is untouched, this
 * is purely a grid search over its existing input (one engine, one cost model).
 */
export function buyPointSweep(
  vehicle: Vehicle,
  constants: Constants,
  inputs: EngineInputs = {},
  opts: BuyPointSweepOpts = {},
): BuyPointSweepResult {
  const am = inputs.annualMiles ?? constants.annual_miles;
  const draws = opts.draws ?? CALIBRATION.sweepDraws;
  const step = opts.step ?? CALIBRATION.sweepStepMiles;

  const [rangeLo, rangeHi] = feasibleOdoRange(vehicle, am, constants.now_year);
  const hi = Math.min(rangeHi, vehicle.eol_maintained_miles);
  // Floor at the price curve's first observed odometer (R11): below that,
  // `curveAt` clamps flat rather than inventing a price, so offering buy
  // points there would price a 0-mile car identically to a 10k-mile one —
  // the grid must not offer buy points where there's no real depreciation
  // data to distinguish them.
  const firstCurveOdo = parseCurve(vehicle.price_vs_odometer_usd)[0]!.x;
  // The year-implied minimum can exceed the eol_maintained_miles cap (e.g. a
  // low-production car whose oldest-in-window odometer already tops out past
  // its typical maintained life at high annual miles) — collapse to the single
  // capped point rather than produce an inverted (empty) range.
  const lo = Math.min(Math.max(0, rangeLo, firstCurveOdo), hi);

  const grid: BuyPointSweepPoint[] = [];
  let idealIdx = 0;
  for (let odo = lo; odo <= hi; odo += step) {
    // Fixed seed (matches costPerMile's own default) so every grid point is
    // deterministic and directly comparable point-to-point.
    const res = costPerMile(vehicle, constants, { ...inputs, buyOdo: odo, draws, seed: 42 });
    if (grid.length > 0 && res.p50 < grid[idealIdx]!.p50) idealIdx = grid.length;
    grid.push({ odo, p50: res.p50 });
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

  return {
    idealOdo: ideal.odo,
    idealP50: ideal.p50,
    idealYear: deriveBuyYear(vehicle, ideal.odo, am, constants.now_year),
    upperOdo: upperIdx > idealIdx ? grid[upperIdx]!.odo : null,
    grid,
  };
}
