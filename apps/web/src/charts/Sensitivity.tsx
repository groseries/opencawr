import type { SweepPoint } from "../engine.worker.js";

/** Sensitivity lines (spec §6.4): how one car's P50 $/mi moves as annual mileage
 * or gas price change, holding every other assumption fixed at the rail's current
 * values (reduced draws — see engine.worker.ts, ASSUMPTIONS.md §I). Single series
 * per chart (no legend needed — the title names it); the point nearest the rail's
 * current value is marked in needle-red ("this is your live assumption"), the
 * rest in ink. */

const CHART_W = 380;
const CHART_H = 150;
const MARGIN = { top: 10, right: 8, bottom: 22, left: 48 };

const fmtCpm = (x: number) => `$${x.toFixed(3)}`;

function niceStep(range: number): number {
  if (!(range > 0)) return 0.01;
  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

function SensChart({
  title,
  points,
  currentX,
  xFmt,
  yFmt,
}: {
  title: string;
  points: SweepPoint[];
  currentX: number;
  xFmt: (x: number) => string;
  yFmt: (x: number) => string;
}) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.p50);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rawYMin = Math.min(...ys);
  const rawYMax = Math.max(...ys);
  const pad = (rawYMax - rawYMin) * 0.12 || 0.01;
  const yMin = Math.max(0, rawYMin - pad);
  const yMax = rawYMax + pad;

  const chartW = CHART_W - MARGIN.left - MARGIN.right;
  const chartH = CHART_H - MARGIN.top - MARGIN.bottom;
  const x = (v: number) =>
    MARGIN.left + ((v - xMin) / (xMax - xMin || 1)) * chartW;
  const y = (v: number) =>
    MARGIN.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

  const step = niceStep(yMax - yMin);
  const yTicks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) {
    yTicks.push(Math.round(t * 1000) / 1000);
  }

  // Nearest sampled point to the rail's actual current assumption.
  let nearestIdx = 0;
  let nearestDist = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(p.x - currentX);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x)},${y(p.p50)}`).join(" ");

  return (
    <div className="sens-chart">
      <h3 className="sens-title">{title}</h3>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="sens-svg"
        role="img"
        aria-label={`${title}: ${points
          .map((p) => `${xFmt(p.x)} → ${yFmt(p.p50)} per mile`)
          .join(", ")}. Red point is the current assumption.`}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={CHART_W - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              className="sens-grid"
            />
            <text x={MARGIN.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="sens-tick">
              {yFmt(t)}
            </text>
          </g>
        ))}
        <path d={path} className="sens-line" />
        {points.map((p, i) => {
          const isCurrent = i === nearestIdx;
          return (
            <g key={p.x}>
              <circle
                cx={x(p.x)}
                cy={y(p.p50)}
                r={4}
                className={isCurrent ? "sens-dot sens-dot-current" : "sens-dot"}
                tabIndex={0}
                aria-label={`${xFmt(p.x)}: ${yFmt(p.p50)} per mile${isCurrent ? " — your current assumption" : ""}`}
              >
                <title>
                  {xFmt(p.x)} — {yFmt(p.p50)}/mi{isCurrent ? " (your current assumption)" : ""}
                </title>
              </circle>
              {(i % 2 === 0 || i === points.length - 1) && (
                <text x={x(p.x)} y={CHART_H - 4} textAnchor="middle" className="sens-xtick">
                  {xFmt(p.x)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Sensitivity({
  sensAnnualMiles,
  sensGasPrice,
  currentAnnualMiles,
  currentGasPrice,
}: {
  sensAnnualMiles: SweepPoint[];
  sensGasPrice: SweepPoint[];
  currentAnnualMiles: number;
  currentGasPrice: number;
}) {
  return (
    <div className="sens-wrap">
      <SensChart
        title="Cost vs. annual mileage"
        points={sensAnnualMiles}
        currentX={currentAnnualMiles}
        xFmt={(v) => `${Math.round(v / 1000)}k`}
        yFmt={fmtCpm}
      />
      <SensChart
        title="Cost vs. gas price"
        points={sensGasPrice}
        currentX={currentGasPrice}
        xFmt={(v) => `$${v.toFixed(2)}`}
        yFmt={fmtCpm}
      />
    </div>
  );
}
