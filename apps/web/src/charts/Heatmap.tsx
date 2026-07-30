import type { SurveyCell } from "../engine.worker.js";
import { HEAT_RAMP_STEPS, heatColor, heatTextColor } from "./heatColor.js";

/** Survey heatmap (spec §6.1): median $/mi across buy-odometer x hold-miles
 * combinations for one car, at reduced draws (see engine.worker.ts, ASSUMPTIONS.md
 * §I). Green ramp = cheaper; infeasible odo/year combinations (two-sided rule) are
 * hatched gray, never colored. */

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
  const span = max - min || 1;

  const cols = buyOdoAxis.length;
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
        aria-label="Survey heatmap: median cost per mile across buy odometer and holding-mileage combinations. Grayed, hatched cells are not feasible odometer or model-year combinations for this model."
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
          const cheapness = c.feasible ? (max - c.p50) / span : 0;
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
        <span className="heatmap-legend-label">{fmt(max)} costliest</span>
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
        <span className="heatmap-legend-label">{fmt(min)} cheapest</span>
        <span className="heatmap-legend-infeasible">
          <svg width={SWATCH_W} height={SWATCH_H} aria-hidden="true">
            <rect width={SWATCH_W} height={SWATCH_H} fill="url(#heatmap-infeasible)" />
          </svg>
          not feasible
        </span>
      </div>
      <div className="heatmap-legend-caption">
        Scale is per-car: {fmt(min)}–{fmt(max)} spans only this model's own feasible
        cells, not a scale shared across cars.
      </div>
    </div>
  );
}
