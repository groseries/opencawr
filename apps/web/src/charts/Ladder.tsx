import type { RankedRow } from "../engine.worker.js";
import { tierColor } from "./tierColors.js";

/** Horizontal dot-and-whisker uncertainty ladder: one row per car, sorted by the
 * current rank basis. Whisker = P05-P95, thicker inner bar = P50->P75, dot =
 * the active rank-basis quantile (P50 or P75), colored by tie tier. */

/** One extra row (Deal Analyzer) inserted into the ladder at its rank position,
 * drawn in needle-red instead of a tier color. */
export interface LadderExtraRow {
  name: string;
  p50: number;
  p75: number;
  p05: number;
  p95: number;
}

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

export function Ladder({
  rows,
  basis,
  extraRow,
  dimmed,
  onOpenCar,
}: {
  rows: RankedRow[];
  basis: "p50" | "p75";
  /** Deal Analyzer: one extra needle-red row, inserted at its rank position. */
  extraRow?: LadderExtraRow;
  /** Soft filter: car names that miss a filter (e.g. seats needed) — grayed
   * out (opacity .35), never removed. Applied to car rows only. */
  dimmed?: Set<string>;
  /** Row click/Enter opens the per-car drawer (Task F). Car rows only — the
   * Deal Analyzer's extra row isn't wired to it. */
  onOpenCar?: (name: string) => void;
}) {
  const emphasizedOf = (r: { p50: number; p75: number }) => (basis === "p75" ? r.p75 : r.p50);

  const rawMin = Math.min(...rows.map((r) => r.p05), ...(extraRow ? [extraRow.p05] : []));
  const rawMax = Math.max(...rows.map((r) => r.p95), ...(extraRow ? [extraRow.p95] : []));
  const pad = (rawMax - rawMin) * 0.08 || 0.02;
  const domainMin = Math.max(0, rawMin - pad);
  const domainMax = rawMax + pad;

  // Insert the extra row into the sorted field at the position its own value
  // would rank — car rows keep their own tier-boundary logic (computed against
  // neighboring cars only, never against the injected row).
  const insertAt = extraRow
    ? (() => {
        const idx = rows.findIndex((r) => emphasizedOf(r) > emphasizedOf(extraRow));
        return idx === -1 ? rows.length : idx;
      })()
    : -1;
  const entries: { car?: RankedRow; extra?: LadderExtraRow; newTier: boolean }[] = [];
  rows.forEach((r, i) => {
    if (i === insertAt) entries.push({ extra: extraRow, newTier: false });
    entries.push({ car: r, newTier: i === 0 || rows[i - 1]!.statTier !== r.statTier });
  });
  if (insertAt === rows.length && extraRow) entries.push({ extra: extraRow, newTier: false });

  const chartW = VB_W - MARGIN.left - MARGIN.right;
  const vbH = MARGIN.top + entries.length * ROW_H + MARGIN.bottom;
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
        aria-label={`Uncertainty ladder: median cost per mile, 90% range, and P75 bad-luck estimate, per vehicle${
          extraRow ? ", plus your deal highlighted in red" : ""
        }`}
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

        {entries.map((entry, i) => {
          const rowTop = MARGIN.top + i * ROW_H;
          const cy = rowTop + ROW_H / 2;

          if (entry.extra) {
            const r = entry.extra;
            const emphasized = emphasizedOf(r);
            return (
              <g key="deal-row">
                <line x1={0} x2={VB_W} y1={rowTop} y2={rowTop} className="ladder-tier-rule" />
                <text
                  x={MARGIN.left - 8}
                  y={cy}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="ladder-label ladder-label-deal"
                >
                  {r.name}
                </text>
                <line
                  x1={x(r.p05)}
                  x2={x(r.p95)}
                  y1={cy}
                  y2={cy}
                  className="ladder-whisker ladder-whisker-deal"
                />
                <line
                  x1={x(r.p50)}
                  x2={x(r.p75)}
                  y1={cy}
                  y2={cy}
                  stroke="var(--needle)"
                  strokeWidth={6}
                  strokeLinecap="round"
                />
                <circle
                  cx={x(emphasized)}
                  cy={cy}
                  r={5}
                  fill="var(--needle)"
                  className="ladder-dot"
                />
                <rect
                  x={0}
                  y={rowTop}
                  width={VB_W}
                  height={ROW_H}
                  className="ladder-hit"
                  tabIndex={0}
                  aria-label={`Your deal — ${r.name}: ${
                    basis === "p75" ? "bad-luck cost P75" : "median"
                  } ${fmtExact(emphasized)} per mile, 90% range ${fmtExact(r.p05)}-${fmtExact(
                    r.p95,
                  )}`}
                >
                  <title>
                    {`Your deal — ${r.name} — ${
                      basis === "p75" ? "bad-luck cost P75" : "median"
                    } ${fmtExact(emphasized)}/mi · 90% range ${fmtExact(r.p05)}–${fmtExact(
                      r.p95,
                    )}`}
                  </title>
                </rect>
              </g>
            );
          }

          const r = entry.car!;
          const color = tierColor(r.statTier);
          const emphasized = emphasizedOf(r);
          const isDimmed = dimmed?.has(r.name) ?? false;
          const missesNote = isDimmed ? " — misses 1 filter" : "";
          return (
            <g key={r.name} style={isDimmed ? { opacity: 0.35 } : undefined}>
              {entry.newTier && (
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
                onClick={() => onOpenCar?.(r.name)}
                onKeyDown={(e) => {
                  if (onOpenCar && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpenCar(r.name);
                  }
                }}
                aria-label={`${r.name}: ${
                  basis === "p75" ? "bad-luck cost P75" : "median"
                } ${fmtExact(emphasized)} per mile, 90% range ${fmtExact(r.p05)}-${fmtExact(
                  r.p95,
                )}, ${basis === "p75" ? "typical P50" : "P75"} ${fmtExact(
                  basis === "p75" ? r.p50 : r.p75,
                )}, tier ${r.statTier}${missesNote}`}
              >
                <title>
                  {`${r.name} — ${basis === "p75" ? "bad-luck cost P75" : "median"} ${fmtExact(
                    emphasized,
                  )}/mi · 90% range ${fmtExact(r.p05)}–${fmtExact(r.p95)} · ${
                    basis === "p75" ? "typical P50" : "P75"
                  } ${fmtExact(basis === "p75" ? r.p50 : r.p75)} · tier ${r.statTier}${missesNote}`}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <p className="ladder-caption">
        Overlapping bars = the model cannot tell these cars apart.
        {extraRow ? " Red = your deal." : ""}
        {dimmed && dimmed.size > 0 ? " Faded = misses your seats filter." : ""}
      </p>
    </div>
  );
}
