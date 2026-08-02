import type { SurveyCell } from "../engine.worker.js";
import { HEAT_RAMP_STEPS, heatColor, heatTextColor } from "./heatColor.js";

/** Survey heatmap (spec §6.1): median $/mi across buy-odometer x hold-miles
 * combinations for one car, at reduced draws (see engine.worker.ts, ASSUMPTIONS.md
 * §I). Lighter green = cheaper; infeasible odo/year combinations (two-sided rule) are
 * hatched gray, never colored.
 *
 * Color is normalized PER ROW, not across the grid (R21). Each row is one holding
 * period, so shading a row against its own cheapest and costliest cell is exactly the
 * buy-point comparison the chart supports (R10: valid only at a fixed hold). A single
 * grid-wide ramp instead painted the long-hold rows uniformly light, which reads as
 * "hold longer, always" — a cross-horizon claim the cost model cannot make, because it
 * charges neither hold for the car bought next. The per-cell $/mi is still printed and
 * announced, so absolute comparison stays available; only the shading is scoped. */

const CELL_W = 54;
const CELL_H = 30;
const MARGIN = { top: 26, right: 12, bottom: 14, left: 40 };
const SWATCH_W = 16;
const SWATCH_H = 12;

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtK = (x: number) => `${Math.round(x / 1000)}k`;

export function Heatmap({
  cells,
  buyOdoAxis,
  holdMilesAxis,
}: {
  cells: SurveyCell[];
  buyOdoAxis: number[];
  holdMilesAxis: number[];
}) {
  const feasibleP50s = cells.filter((c) => c.feasible).map((c) => c.p50);
  const min = feasibleP50s.length ? Math.min(...feasibleP50s) : 0;
  const max = feasibleP50s.length ? Math.max(...feasibleP50s) : 1;

  const cols = buyOdoAxis.length;
  // One color scale per row (per holding period) — see the note above. `cells` is
  // holdMilesAxis-outer, buyOdoAxis-inner (engine.worker.ts's handleSurvey), so a row
  // is a contiguous run of `cols`. A row with no spread (one feasible cell, or every
  // cell equal) has no cheaper buy point to point at, so it paints mid-ramp rather
  // than claiming an extreme.
  const rowScales = holdMilesAxis.map((_, ri) => {
    const vals = cells
      .slice(ri * cols, (ri + 1) * cols)
      .filter((c) => c.feasible)
      .map((c) => c.p50);
    if (vals.length === 0) return null;
    const rowMax = Math.max(...vals);
    const rowSpan = rowMax - Math.min(...vals);
    return { rowMax, rowSpan };
  });
  const cheapnessOf = (c: SurveyCell, ri: number) => {
    const s = rowScales[ri];
    if (!c.feasible || !s) return 0;
    return s.rowSpan === 0 ? 0.5 : (s.rowMax - c.p50) / s.rowSpan;
  };
  const chartW = cols * CELL_W;
  const chartH = holdMilesAxis.length * CELL_H;
  const vbW = MARGIN.left + chartW + MARGIN.right;
  const vbH = MARGIN.top + chartH + MARGIN.bottom;

  return (
    <div className="heatmap-wrap">
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="heatmap-svg"
        role="img"
        aria-label="Survey heatmap: median cost per mile across buy odometer and holding-mileage combinations. Each row of miles held is shaded against its own cheapest and costliest buy point, so color compares along a row, not down a column. Grayed, hatched cells are not feasible odometer or model-year combinations for this model."
      >
        <defs>
          <pattern
            id="heatmap-infeasible"
            width={6}
            height={6}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width={6} height={6} fill="var(--rule)" />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--muted)" strokeWidth={2} />
          </pattern>
        </defs>

        {buyOdoAxis.map((odo, ci) => (
          <text
            key={odo}
            x={MARGIN.left + ci * CELL_W + CELL_W / 2}
            y={MARGIN.top - 10}
            textAnchor="middle"
            className="heatmap-tick"
          >
            {fmtK(odo)}
          </text>
        ))}
        {holdMilesAxis.map((hold, ri) => (
          <text
            key={hold}
            x={MARGIN.left - 6}
            y={MARGIN.top + ri * CELL_H + CELL_H / 2}
            textAnchor="end"
            dominantBaseline="middle"
            className="heatmap-tick"
          >
            {fmtK(hold)}
          </text>
        ))}

        {cells.map((c, i) => {
          const ci = i % cols;
          const ri = Math.floor(i / cols);
          const x = MARGIN.left + ci * CELL_W;
          const y = MARGIN.top + ri * CELL_H;
          const cheapness = cheapnessOf(c, ri);
          const label = c.feasible
            ? `Buy ${fmtK(c.buyOdo)} mi, hold ${fmtK(c.holdMiles)} mi — ${fmt(c.p50)} per mile`
            : `Buy ${fmtK(c.buyOdo)} mi, hold ${fmtK(c.holdMiles)} mi — not a feasible odometer for this model's production years`;
          return (
            <g key={`${c.buyOdo}-${c.holdMiles}`}>
              <rect
                x={x + 1}
                y={y + 1}
                width={CELL_W - 2}
                height={CELL_H - 2}
                fill={c.feasible ? heatColor(cheapness) : "url(#heatmap-infeasible)"}
                tabIndex={0}
                className="heatmap-cell"
                aria-label={label}
              >
                <title>{label}</title>
              </rect>
              {c.feasible && (
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="heatmap-cell-label"
                  style={{ fill: heatTextColor(cheapness) }}
                  pointerEvents="none"
                >
                  {fmt(c.p50)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="heatmap-axis-labels">
        <span>buy odometer, thousands of miles →</span>
        <span>↑ miles held</span>
      </div>
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">costliest in its row</span>
        {/* Swatches are inline SVG <rect fill> — the same element and attribute the
         * cells use — so a forced-dark browser extension can't remap the legend and
         * the grid through two different code paths and invert one relative to the
         * other (it did, when these were HTML spans with a CSS background). */}
        <svg
          className="heatmap-legend-swatches"
          width={HEAT_RAMP_STEPS.length * SWATCH_W}
          height={SWATCH_H}
          aria-hidden="true"
        >
          {HEAT_RAMP_STEPS.map((hex, i) => (
            <rect key={hex} x={i * SWATCH_W} width={SWATCH_W} height={SWATCH_H} fill={hex} />
          ))}
        </svg>
        <span className="heatmap-legend-label">cheapest in its row</span>
        <span className="heatmap-legend-infeasible">
          <svg width={SWATCH_W} height={SWATCH_H} aria-hidden="true">
            <rect width={SWATCH_W} height={SWATCH_H} fill="url(#heatmap-infeasible)" />
          </svg>
          not feasible
        </span>
      </div>
      <div className="heatmap-legend-caption">
        Color runs across each row on its own: every row of miles held is shaded against
        its own cheapest and costliest buy point. Over the whole grid this car spans{" "}
        {fmt(min)}–{fmt(max)}, which is this model's own range, not one shared across cars.
      </div>
      {/* R21: reading DOWN a column compares different holding periods, which the cost
       * model does not charge for the car you buy next — so a longer hold looks cheaper
       * partly because its costs are discounted further while its miles still count in
       * full. Reading ACROSS a row holds the period fixed and is the comparison this
       * chart supports (the same reason R10 fixed the buy-point sweep's horizon). */}
      <div className="heatmap-legend-caption">
        Compare along a row (same miles held) — that's what the color shows. Comparing down
        a column isn't like-for-like: neither hold is charged for the next car you'd have
        to buy.
      </div>
    </div>
  );
}
