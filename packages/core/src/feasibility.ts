import type { Vehicle } from "./types.js";

/**
 * Odometer ↔ model-year coupling (spec §4). At `annualMiles`/yr, an odometer reading
 * implies a model year. Feasibility is TWO-SIDED: a buy point is invalid if the implied
 * model year is before the car's first production year OR after its last.
 */

export function impliedModelYear(odo: number, annualMiles: number, nowYear: number): number {
  return nowYear - odo / annualMiles;
}

/** Model year assigned to a buy point: rounded implied year, clamped into production range. */
export function deriveBuyYear(
  v: Vehicle,
  odo: number,
  annualMiles: number,
  nowYear: number,
): number {
  const y = Math.round(impliedModelYear(odo, annualMiles, nowYear));
  return Math.min(Math.max(y, v.first_year), v.last_year);
}

export function isFeasibleBuy(
  v: Vehicle,
  odo: number,
  annualMiles: number,
  nowYear: number,
): boolean {
  const y = Math.round(impliedModelYear(odo, annualMiles, nowYear));
  return y >= v.first_year && y <= v.last_year;
}

/** Feasible odometer window [min, max] for this vehicle at the given annual mileage. */
export function feasibleOdoRange(
  v: Vehicle,
  annualMiles: number,
  nowYear: number,
): [number, number] {
  return [
    Math.max(0, (nowYear - v.last_year) * annualMiles),
    (nowYear - v.first_year) * annualMiles,
  ];
}
