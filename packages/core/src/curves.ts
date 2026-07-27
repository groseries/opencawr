/** Piecewise-linear curves: market price vs odometer, maintenance vs age. */

export interface CurvePoint {
  x: number;
  y: number;
}

export function parseCurve(raw: Record<string, number>): CurvePoint[] {
  return Object.entries(raw)
    .map(([k, v]) => ({ x: Number(k), y: v }))
    .sort((a, b) => a.x - b.x);
}

/**
 * Interpolate, extrapolating past both ends with the edge segment's slope
 * (spec §2: "extrapolated past the last data point ... never clamped flat"),
 * floored at `floor` (scrap value for price curves; 0 for maintenance).
 */
export function curveAt(pts: CurvePoint[], x: number, floor = 0): number {
  const n = pts.length;
  const first = pts[0]!;
  const last = pts[n - 1]!;
  let y: number;
  if (n === 1) {
    y = first.y;
  } else if (x <= first.x) {
    const s = (pts[1]!.y - first.y) / (pts[1]!.x - first.x);
    y = first.y + (x - first.x) * s;
  } else if (x >= last.x) {
    const s = (last.y - pts[n - 2]!.y) / (last.x - pts[n - 2]!.x);
    y = last.y + (x - last.x) * s;
  } else {
    let i = 0;
    while (pts[i + 1]!.x < x) i++;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    y = a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
  }
  return Math.max(y, floor);
}

/**
 * Maintenance $/yr at a given age. Below the first point: first value.
 * Past the last point the curve keeps rising at (last-segment slope × slopeMult) —
 * the calibrated late-life wear-out escalation (see calibration.ts).
 */
export function maintenanceAt(pts: CurvePoint[], age: number, slopeMult: number): number {
  const n = pts.length;
  const first = pts[0]!;
  const last = pts[n - 1]!;
  if (age <= first.x) return first.y;
  if (age >= last.x) {
    const s = ((last.y - pts[n - 2]!.y) / (last.x - pts[n - 2]!.x)) * slopeMult;
    return last.y + (age - last.x) * s;
  }
  let i = 0;
  while (pts[i + 1]!.x < age) i++;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  return a.y + ((age - a.x) * (b.y - a.y)) / (b.x - a.x);
}
