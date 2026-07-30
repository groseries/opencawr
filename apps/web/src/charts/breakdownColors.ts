import type { CostBreakdown } from "@opencawr/core";

/**
 * Categorical palette for the ten cost-breakdown segments (spec: dataviz skill,
 * categorical — identity, not magnitude or order). Each of the ten cost
 * components gets one fixed hue, assigned by key so a component's color is
 * stable across cars regardless of where it lands once segments are sorted by
 * descending share (color follows the entity, never its rank).
 *
 * Deliberate, task-scoped exception to global-constraints.md's "no new colors
 * except the tier ramp" rule — the second such exception after the heatmap's
 * green ramp (`./heatColor.ts`). `tierColors.ts` is a sequential ink ramp
 * meaning "tie-tier order"; reusing it here would misrepresent ten unordered
 * identities as a ranking. Ten categories exceed the dataviz skill's
 * documented 8-hue/all-pairs ceiling, so this palette is validated on
 * *adjacent* pairs only (the skill's own rule for stacks/bars/lines) using the
 * fixed key order below as the reference order, with the persistent
 * `breakdown-list` (every segment, always labeled with name/value/%) as the
 * mandatory secondary-encoding channel color alone does not carry identity.
 * See ASSUMPTIONS.md §I for the full validator output.
 */
const FILLS: Record<Exclude<keyof CostBreakdown, "total">, string> = {
  depreciation: "#933900",
  useTax: "#d7ab1b",
  maintenance: "#4a6300",
  insurance: "#00cec5",
  registration: "#00688f",
  totalLoss: "#56b8ff",
  repairs: "#434baa",
  tires: "#c697fe",
  battery: "#862f7b",
  energy: "#fd85aa",
};

/** Text color that clears 4.5:1 against the matching FILLS entry, mirroring
 * the tierColor/tierTextColor idiom in ./tierColors.ts. */
const TEXT: Record<Exclude<keyof CostBreakdown, "total">, string> = {
  depreciation: "#ffffff",
  useTax: "#14191d",
  maintenance: "#ffffff",
  insurance: "#14191d",
  registration: "#ffffff",
  totalLoss: "#14191d",
  repairs: "#ffffff",
  tires: "#14191d",
  battery: "#ffffff",
  energy: "#14191d",
};

export function breakdownColor(key: Exclude<keyof CostBreakdown, "total">): string {
  return FILLS[key];
}

export function breakdownTextColor(key: Exclude<keyof CostBreakdown, "total">): string {
  return TEXT[key];
}
