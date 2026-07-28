/**
 * Sequential green ramp for the survey heatmap (spec: dataviz skill, sequential —
 * one hue, monotone lightness, magnitude encoding). Cheapest cells (lowest P50 in
 * the current 12x8 grid) take the darkest/most saturated step; cells fade toward
 * the lightest step as they get pricier. Validated with `validate_palette.js
 * --ordinal` against the app's --panel surface (#F4F5F6): lightness monotone,
 * adjacent steps >= 0.06 L apart, light end clears the 2:1 ordinal-ramp floor
 * (2.09:1).
 *
 * Deliberate, task-scoped exception to global-constraints.md's "no new colors
 * except the tier ramp" rule: task-F-brief.md explicitly specifies a
 * green=cheap ramp for this chart, and the existing tier ramp (an --ink hue,
 * meaning "tie-tier order") can't double as a cost-magnitude encoding without
 * misrepresenting one for the other. See ASSUMPTIONS.md §H.
 */
const HEAT_FILLS = ["#22c55e", "#16a34a", "#15803d", "#14532d"]; // lightest(pricier) -> darkest(cheapest)

/** `cheapness` in [0,1]: 1 = cheapest cell in the grid, 0 = priciest. */
export function heatColor(cheapness: number): string {
  const idx = Math.min(
    HEAT_FILLS.length - 1,
    Math.max(0, Math.round(cheapness * (HEAT_FILLS.length - 1))),
  );
  return HEAT_FILLS[idx]!;
}

export const HEAT_RAMP_STEPS = HEAT_FILLS;
