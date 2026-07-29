import { useLayoutEffect, useRef, useState } from "react";
import type { CostBreakdown } from "@opencawr/core";
import { breakdownColor, breakdownTextColor } from "./breakdownColors.js";

/** Cost breakdown (spec §6.4): part-to-whole stacked bar of one car's expected
 * $/mi by component. Segments are ordered by descending share (the order itself
 * is the story: "biggest driver first") and colored with a fixed categorical
 * palette keyed by component (`./breakdownColors.ts`), not by sort rank, so a
 * component's color stays stable across cars. Wide segments (>8% of total)
 * carry a direct in-bar label; the `breakdown-list` below remains the full
 * table view for every segment regardless of width. */

const LABELS: Record<Exclude<keyof CostBreakdown, "total">, string> = {
  depreciation: "Depreciation",
  useTax: "Use / sales tax",
  maintenance: "Maintenance",
  insurance: "Insurance",
  registration: "Registration",
  totalLoss: "Total-loss exposure",
  repairs: "Repairs (major)",
  tires: "Tires",
  battery: "Battery",
  energy: "Fuel / energy",
};

const IN_BAR_LABEL_MIN_PCT = 8;

const fmt = (x: number) => `$${x.toFixed(3)}`;

/** In-bar segment label, candidate above IN_BAR_LABEL_MIN_PCT but measured
 * against its actual rendered width (spec: dataviz skill, "a label that won't
 * fit doesn't get clipped — measure first"): if the text still overflows its
 * segment once laid out, it un-renders itself before paint rather than
 * showing a truncated ellipsis. The tooltip and the full list below always
 * carry the name regardless. */
function SegLabel({ text, color }: { text: string; color: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth) setFits(false);
  }, [text]);
  if (!fits) return null;
  return (
    <span ref={ref} className="breakdown-seg-label" style={{ color }}>
      {text}
    </span>
  );
}

export function Breakdown({ breakdown }: { breakdown: CostBreakdown }) {
  const total = breakdown.total || 1;
  const rows = (Object.keys(LABELS) as (keyof typeof LABELS)[])
    .map((key) => ({ key, label: LABELS[key], value: breakdown[key] }))
    .sort((a, b) => b.value - a.value);

  let offset = 0;
  const segments = rows.map((r) => {
    const widthPct = (Math.max(r.value, 0) / total) * 100;
    const seg = { ...r, offsetPct: offset, widthPct };
    offset += widthPct;
    return seg;
  });

  return (
    <div className="breakdown-wrap">
      <div
        className="breakdown-bar"
        role="img"
        aria-label={`Cost breakdown, ${fmt(breakdown.total)} per mile total: ${rows
          .map((r) => `${r.label} ${fmt(r.value)}`)
          .join(", ")}`}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className="breakdown-seg"
            style={{ width: `${s.widthPct}%`, background: breakdownColor(s.key) }}
            tabIndex={s.widthPct > 0 ? 0 : undefined}
            title={`${s.label}: ${fmt(s.value)}/mi (${Math.round((s.value / total) * 100)}%)`}
          >
            {s.widthPct > IN_BAR_LABEL_MIN_PCT && (
              <SegLabel text={s.label} color={breakdownTextColor(s.key)} />
            )}
          </div>
        ))}
      </div>
      <ul className="breakdown-list">
        {segments.map((s) => (
          <li key={s.key} className="breakdown-row">
            <span
              className="breakdown-swatch"
              style={{ background: breakdownColor(s.key) }}
            />
            <span className="breakdown-name">{s.label}</span>
            <span className="breakdown-value mono">{fmt(s.value)}</span>
            <span className="breakdown-pct mono">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
        <li className="breakdown-row breakdown-total">
          <span className="breakdown-name">Total</span>
          <span className="breakdown-value mono">{fmt(breakdown.total)}</span>
        </li>
      </ul>
    </div>
  );
}
