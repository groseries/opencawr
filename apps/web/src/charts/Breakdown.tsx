import type { CostBreakdown } from "@opencawr/core";

/** Cost breakdown (spec §6.4): part-to-whole stacked bar of one car's expected
 * $/mi by component. Segments are ordered by descending share (the order itself
 * is the story: "biggest driver first") and shaded as monotone steps of a single
 * --ink wash — not a new categorical palette, since every segment is directly
 * labeled in the list below, which also serves as the chart's table view. */

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

const fmt = (x: number) => `$${x.toFixed(3)}`;

export function Breakdown({ breakdown }: { breakdown: CostBreakdown }) {
  const total = breakdown.total || 1;
  const rows = (Object.keys(LABELS) as (keyof typeof LABELS)[])
    .map((key) => ({ key, label: LABELS[key], value: breakdown[key] }))
    .sort((a, b) => b.value - a.value);

  // Monotone opacity steps over a single --ink hue, darkest = biggest driver.
  const n = rows.length;
  const opacityFor = (rank: number) => (n <= 1 ? 0.85 : 0.9 - (rank / (n - 1)) * 0.68);

  let offset = 0;
  const segments = rows.map((r, i) => {
    const widthPct = (Math.max(r.value, 0) / total) * 100;
    const seg = { ...r, offsetPct: offset, widthPct, opacity: opacityFor(i) };
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
            style={{ width: `${s.widthPct}%`, background: `rgba(20, 25, 29, ${s.opacity})` }}
            tabIndex={s.widthPct > 0 ? 0 : undefined}
            title={`${s.label}: ${fmt(s.value)}/mi (${Math.round((s.value / total) * 100)}%)`}
          />
        ))}
      </div>
      <ul className="breakdown-list">
        {segments.map((s) => (
          <li key={s.key} className="breakdown-row">
            <span
              className="breakdown-swatch"
              style={{ background: `rgba(20, 25, 29, ${s.opacity})` }}
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
