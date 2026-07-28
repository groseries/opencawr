/**
 * Sequential ink-depth ramp for statistical tie tiers (spec: dataviz skill, ordinal
 * ramp — one hue, monotone lightness, NOT a rainbow). Tier 1 (cheapest / most
 * confident) is darkest; later tiers step lighter. Same hue as --ink (~242°),
 * validated with `validate_palette.js --ordinal` against the --paper surface:
 * lightness monotone, adjacent steps >= 0.06 L apart. The lightest step clears
 * 3.20:1 against --paper — WCAG 1.4.11's 3:1 floor for graphical objects, not
 * just the dataviz skill's generic 2:1 ordinal floor, since this step is the
 * catch-all fill for every tier past the 5th and so can cover many bars.
 * Beyond the last defined tier, further tiers reuse the lightest step — color
 * is a secondary cue here, not the only one (the tier number and the
 * tier-start rule carry identity too).
 */
const TIER_FILLS = ["#14191d", "#303941", "#505961", "#667078", "#79838c"];

/** Text color that clears 4.5:1 against the matching TIER_FILLS chip background. */
const TIER_TEXT = ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#14191d"];

function clampIndex(tier: number, length: number): number {
  return Math.min(Math.max(Math.round(tier), 1), length) - 1;
}

export function tierColor(tier: number): string {
  return TIER_FILLS[clampIndex(tier, TIER_FILLS.length)]!;
}

export function tierTextColor(tier: number): string {
  return TIER_TEXT[clampIndex(tier, TIER_TEXT.length)]!;
}
