import type { RankedRow } from "../engine.worker.js";
import { tierColor } from "./tierColors.js";

/** Horizontal dot-and-whisker uncertainty ladder: one row per car, sorted by the
 * current rank basis. Whisker = P05-P95, thicker inner bar = P50->P75, dot =
 * the active rank-basis quantile (P50 or P75), colored by tie tier. */

const ROW_H = 22;
const MARGIN = { top: 30, right: 16, bottom: 4, left: 200 };
const VB_W = 760;

const fmtExact = (x: number) => `$${x.toFixed(3)}`;
const fmtTick = (x: number) => `$${x.toFixed(2)}`;

function niceStep(range: number): number {
  if (!(range > 0)) return 0.05;
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

export function Ladder({ rows, basis }: { rows: RankedRow[]; basis: "p50" | "p75" }) {
  const rawMin = Math.min(...rows.map((r) => r.p05));
  const rawMax = Math.max(...rows.map((r) => r.p95));
  const pad = (rawMax - rawMin) * 0.08 || 0.02;
  const domainMin = Math.max(0, rawMin - pad);
  const domainMax = rawMax + pad;

  const chartW = VB_W - MARGIN.left - MARGIN.right;
  const vbH = MARGIN.top + rows.length * ROW_H + MARGIN.bottom;
  const x = (v: number) =>
    MARGIN.left + ((v - domainMin) / (domainMax - domainMin || 1)) * chartW;

  const step = niceStep(domainMax - domainMin);
  const ticks: number[] = [];
  for (let t = Math.ceil(domainMin / step) * step; t <= domainMax; t += step) {
    ticks.push(Math.round(t * 1000) / 1000);
  }

  return (
    <div className="ladder-wrap">
      <svg
        viewBox={`0 0 ${VB_W} ${vbH}`}
        preserveAspectRatio="xMidYMin meet"
        className="ladder-svg"
        role="img"
        aria-label="Uncertainty ladder: median cost per mile, 90% range, and P75 bad-luck estimate, per vehicle"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={MARGIN.top - 12}
              y2={vbH}
              className="ladder-grid"
            />
            <text x={x(t)} y={MARGIN.top - 16} textAnchor="middle" className="ladder-tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const rowTop = MARGIN.top + i * ROW_H;
          const cy = rowTop + ROW_H / 2;
          const newTier = i === 0 || rows[i - 1]!.statTier !== r.statTier;
          const color = tierColor(r.statTier);
          const emphasized = basis === "p75" ? r.p75 : r.p50;
          return (
            <g key={r.name}>
              {newTier && (
                <line x1={0} x2={VB_W} y1={rowTop} y2={rowTop} className="ladder-tier-rule" />
              )}
              <text
                x={MARGIN.left - 8}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
                className="ladder-label"
              >
                {r.name}
              </text>
              <line
                x1={x(r.p05)}
                x2={x(r.p95)}
                y1={cy}
                y2={cy}
                className="ladder-whisker"
              />
              <line
                x1={x(r.p50)}
                x2={x(r.p75)}
                y1={cy}
                y2={cy}
                stroke={color}
                strokeWidth={6}
                strokeLinecap="round"
              />
              <circle cx={x(emphasized)} cy={cy} r={5} fill={color} className="ladder-dot" />
              <rect
                x={0}
                y={rowTop}
                width={VB_W}
                height={ROW_H}
                className="ladder-hit"
                tabIndex={0}
                aria-label={`${r.name}: ${
                  basis === "p75" ? "bad-luck cost P75" : "median"
                } ${fmtExact(emphasized)} per mile, 90% range ${fmtExact(r.p05)}-${fmtExact(
                  r.p95,
                )}, ${basis === "p75" ? "typical P50" : "P75"} ${fmtExact(
                  basis === "p75" ? r.p50 : r.p75,
                )}, tier ${r.statTier}`}
              >
                <title>
                  {`${r.name} — ${basis === "p75" ? "bad-luck cost P75" : "median"} ${fmtExact(
                    emphasized,
                  )}/mi · 90% range ${fmtExact(r.p05)}–${fmtExact(r.p95)} · ${
                    basis === "p75" ? "typical P50" : "P75"
                  } ${fmtExact(basis === "p75" ? r.p50 : r.p75)} · tier ${r.statTier}`}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <p className="ladder-caption">
        Overlapping bars = the model cannot tell these cars apart.
      </p>
    </div>
  );
}
