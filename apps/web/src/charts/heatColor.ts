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
 * misrepresenting one for the other. See ASSUMPTIONS.md §I.
 */
const HEAT_FILLS = ["#22c55e", "#16a34a", "#15803d", "#14532d"]; // lightest(pricier) -> darkest(cheapest)

/** Text color that clears 4.5:1 against the matching HEAT_FILLS step (computed
 * against each step's actual sRGB luminance), mirroring the tierColor/
 * tierTextColor idiom in ./tierColors.ts. */
const HEAT_TEXT = ["#14191d", "#14191d", "#ffffff", "#ffffff"];

function heatIndex(cheapness: number): number {
  return Math.min(
    HEAT_FILLS.length - 1,
    Math.max(0, Math.round(cheapness * (HEAT_FILLS.length - 1))),
  );
}

/** `cheapness` in [0,1]: 1 = cheapest cell in the grid, 0 = priciest. */
export function heatColor(cheapness: number): string {
  return HEAT_FILLS[heatIndex(cheapness)]!;
}

/** Text color for the printed $/mi value in a cell at this `cheapness`. */
export function heatTextColor(cheapness: number): string {
  return HEAT_TEXT[heatIndex(cheapness)]!;
}

export const HEAT_RAMP_STEPS = HEAT_FILLS;
