/**
 * Sequential green ramp for the survey heatmap (spec: dataviz skill, sequential —
 * one hue, monotone lightness, magnitude encoding). Costliest cells (highest P50 in
 * the current 12x8 grid) take the darkest step; cells lighten toward the most
 * saturated step as they get cheaper. Validated with `validate_palette.js
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
// Index 0 is the `cheapness == 0` (costliest) end, so the legend bar — which
// renders HEAT_RAMP_STEPS in index order under a left "costliest" label — stays
// in agreement with the cells by construction. Reverse this array to flip the
// ramp and both flip together.
//
// The intended reading is "cheapest = darkest green", which is the OPPOSITE of
// the hex values below, deliberately: the ramp is calibrated for a forced-dark
// browser extension that inverts page lightness, so #22c55e (cheapest) paints as
// the darkest cell there. Without that extension the ramp reads inverted. Don't
// flip this back on the hex values alone — see ASSUMPTIONS.md §I.
const HEAT_FILLS = ["#14532d", "#15803d", "#16a34a", "#22c55e"]; // darkest(costliest) -> lightest(cheapest)

/** Text color that clears 4.5:1 against the matching HEAT_FILLS step (computed
 * against each step's actual sRGB luminance), mirroring the tierColor/
 * tierTextColor idiom in ./tierColors.ts. */
const HEAT_TEXT = ["#ffffff", "#ffffff", "#14191d", "#14191d"];

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
