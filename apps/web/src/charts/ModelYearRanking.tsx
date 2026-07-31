import type { ModelYearBestAtHold, ModelYearRankEntry } from "../engine.worker.js";
import { tierColor, tierTextColor } from "./tierColors.js";

/** Model-year ranking panel (R2, drawer-only): one car's own feasible model
 * years, each shown at ITS OWN cheapest mileage, ranked at a single fixed
 * holding horizon. Every row is a point on the buy-point sweep's grid, so the
 * rank-1 row is exactly the sweet spot the Rankings row reports (year AND
 * mileage) and the two can't disagree. See modelyear.ts. Still a distinct
 * question from the survey heatmap (hold x buy-odo, Heatmap.tsx).
 *
 * Rank alone was overclaiming (R15): a car's model years often sit hundredths
 * of a percent apart, and this panel was reporting a cheapest year "0.0%
 * cheaper" than the runner-up. Each row now also carries the tie tier the
 * Rankings table already uses on whole cars, and where the top tier holds more
 * than one year the panel says they're tied instead of naming one. Rank 1 is
 * unchanged — it is still the sweep's sweet spot — it just stops being reported
 * as a finding when the model can't separate it. */

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtK = (x: number) => `${Math.round(x / 1000)}k`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The sentence the Rankings table already uses for tie tiers, kept word-for-word
 * so the two views read as one rule rather than two policies. */
const TIE_NOTE =
  "Years in the same tie tier are statistically indistinguishable — the model can't honestly order them.";

// Same vocabulary the deal analyzer already uses for this tier field
// (engine.worker.ts's DealResponse notes: "flagged as a landmine/caution
// model year") — kept consistent rather than inventing new labels.
const RELIABILITY_LABEL: Record<ModelYearRankEntry["reliabilityMark"], string> = {
  bad: "landmine",
  caution: "caution",
  good: "sweet spot",
  normal: "normal",
};

/** Best year at each preset fixed hold. Shown at every rail setting, because
 * the answer to "which year" genuinely depends on how long you hold — and when
 * the rail is open-ended this is the only honest answer available (each row is
 * one ranking at one FIXED hold; none is computed at "until it dies"). */
function ByHoldSummary({ byHold }: { byHold: ModelYearBestAtHold[] }) {
  if (byHold.length === 0) return null;
  // A car whose whole production window sits outside the feasible odometer range
  // prices every year identically — there is no best year to report, and saying
  // one would be reporting a tie-break as a finding.
  if (byHold.every((h) => h.degenerate)) {
    return (
      <p className="results-note">
        Every model year of this car prices identically at these assumptions: its whole
        production window sits outside the feasible odometer range (at{" "}
        {fmtK(byHold[0]!.holdMiles)}
        –{fmtK(byHold[byHold.length - 1]!.holdMiles)} mi holds), so each year clamps to the
        same odometer. There is no cheapest model year to report here — not a tie worth
        breaking, just no separation in the data. It is the extreme form of the tie tiers
        used throughout this panel: every year lands in the top tier because every year is
        literally the same point.
      </p>
    );
  }
  const usable = byHold.filter((h) => !h.degenerate);
  // A hold whose top tie tier holds more than one year has no cheapest year to
  // report (R15) — the panel names one only where the tiers separate one.
  const decided = usable.filter((h) => h.tiedTopYears.length <= 1);
  const years = new Set(decided.map((h) => h.bestYear));
  return (
    <>
      <table className="myr-table myr-byhold">
        <thead>
          <tr>
            <th>If you hold</th>
            <th>Cheapest year · mileage</th>
            <th className="num">$/mi</th>
            <th className="num">vs. next-best year</th>
          </tr>
        </thead>
        <tbody>
          {byHold.map((h) => {
            const tied = !h.degenerate && h.tiedTopYears.length > 1;
            return (
              <tr key={h.holdMiles}>
                <td className="mono">{fmtK(h.holdMiles)} mi</td>
                <td className="mono">
                  {h.degenerate
                    ? "—"
                    : tied
                      ? "no single cheapest year"
                      : `${h.bestYear} · ${fmtK(h.bestOdo)} mi`}
                </td>
                <td className="num mono">{h.degenerate ? "—" : fmt(h.bestP50)}</td>
                <td className="num mono">
                  {h.degenerate
                    ? "every year prices the same"
                    : tied
                      ? `${h.tiedTopYears.length} of ${h.yearsCompared} years tied`
                      : h.marginVsRunnerUp === null || h.runnerUpYear === null
                        ? "—"
                        : `${(h.marginVsRunnerUp * 100).toFixed(1)}% cheaper than ${h.runnerUpYear}${
                            h.beatsRunnerUpProb === null
                              ? ""
                              : ` · cheaper in ${pct(h.beatsRunnerUpProb)} of draws`
                          }`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="myr-caption">
        {decided.length === 0
          ? "No holding period shown here has a single cheapest model year: at each one the top years are statistically tied, so the model can't name one."
          : decided.length < usable.length
            ? "One model year comes out ahead at some of these holding periods but not others — where the years are tied, nothing here separates them."
            : years.size === 1
              ? `The same model year (${[...years][0]}) is cheapest at every holding period shown, so for this car the year choice doesn't depend on how long you keep it.`
              : "The cheapest model year changes with the holding period — a longer hold spreads a newer car's higher purchase price over more miles, so the two choices interact."}{" "}
        {TIE_NOTE} Each row&rsquo;s figures come from one sweet spot — a year and the
        mileage to buy it at, the cheapest single point on that car&rsquo;s whole
        cost-vs-odometer grid at that hold — named as the answer only where the tie tiers
        separate one. Each is priced at that one fixed holding period; none is priced at
        &ldquo;until it dies,&rdquo; because an open-ended horizon is itself a function of
        the buy odometer and would put the years on unequal footing.
      </p>
    </>
  );
}

export function ModelYearRanking({
  points,
  byHold,
}: {
  points: ModelYearRankEntry[] | null;
  byHold: ModelYearBestAtHold[];
}) {
  const bestP50 =
    points === null ? 0 : (points.find((p) => p.rank === 1)?.p50 ?? points[0]?.p50 ?? 0);
  const rows = points === null ? [] : [...points].sort((a, b) => a.rank - b.rank);
  // Years the model cannot separate from the cheapest one. More than one member
  // means rank 1 is a tie-break, not a finding, and the "vs. best" column says so
  // instead of quoting a +0.0% that is Monte Carlo noise (R15).
  const topTie = rows.filter((p) => p.tier === 1);

  return (
    <>
      <ByHoldSummary byHold={byHold} />

      {points === null ? (
        <p className="results-note">
          Your holding period is set to &ldquo;until it dies,&rdquo; so the full
          year-by-year ranking below it isn&rsquo;t shown — pick 50k, 100k or 150k on the
          left to rank every one of this car&rsquo;s model years at that horizon.
        </p>
      ) : (
        <table className="myr-table">
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th className="col-tier">tier</th>
              <th>Year</th>
              <th className="num">Cheapest at</th>
              <th className="num">$/mi</th>
              <th className="num">vs. best</th>
              <th>Reliability</th>
              <th>Drivetrain</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const deltaPct = bestP50 > 0 ? ((p.p50 - bestP50) / bestP50) * 100 : 0;
              const newTier = i > 0 && rows[i - 1]!.tier !== p.tier;
              return (
                <tr key={p.year} className={newTier ? "tier-start" : undefined}>
                  <td className="num mono">{p.rank}</td>
                  <td className="col-tier">
                    {p.tier === null ? (
                      <span className="myr-detail">—</span>
                    ) : (
                      <span
                        className="tier-chip"
                        style={{
                          background: tierColor(p.tier),
                          color: tierTextColor(p.tier),
                          borderColor: tierColor(p.tier),
                        }}
                      >
                        TIE {p.tier}
                      </span>
                    )}
                  </td>
                  <td className="mono">{p.year}</td>
                  <td className="num mono">
                    {fmtK(p.odo)} mi
                    {p.clamped ? (
                      <abbr
                        className="myr-clamped"
                        title="No mileage of this model year's own is feasible for this car (production years, end-of-life cap, or the first point on its price curve), so this row is priced at the nearest usable odometer instead. Compare it with care."
                      >
                        *
                      </abbr>
                    ) : null}
                  </td>
                  <td className="num mono">{fmt(p.p50)}</td>
                  <td className="num mono">
                    {topTie.length > 1 && p.tier === 1
                      ? "tied"
                      : p.rank === 1
                        ? "best"
                        : `+${deltaPct.toFixed(1)}%`}
                  </td>
                  <td>
                    <span className={`myr-mark myr-mark-${p.reliabilityMark}`}>
                      {RELIABILITY_LABEL[p.reliabilityMark]}
                    </span>
                  </td>
                  <td className="myr-detail">
                    {p.drivetrain ?? "—"}
                    {p.specChangeFromPriorYear ? (
                      <span className="myr-badge">possible spec change</span>
                    ) : null}
                    {p.topComplaintCategory ? (
                      <span className="myr-complaint">
                        most-reported: {p.topComplaintCategory}
                        {p.topComplaintShare !== null
                          ? ` (${Math.round(p.topComplaintShare * 100)}%)`
                          : ""}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {points !== null ? (
        <p className="myr-caption">
          Each row shows that model year at its OWN cheapest mileage — the lowest-cost
          point among the odometers a car of that year would plausibly show — so the row
          ranked 1 is the same year and mileage the Rankings list calls this car&rsquo;s
          sweet spot. {TIE_NOTE}{" "}
          {topTie.length > 1
            ? `Here ${topTie.length} of ${rows.length} years share the cheapest tier (${topTie
                .map((p) => p.year)
                .join(", ")}): rank 1 is where the tie-break landed, not a year the model can show is cheaper than the others.`
            : rows[0]?.beatsNextProb != null
              ? `Here rank 1 is alone in the top tier — it came out cheaper than the next year in ${pct(rows[0]!.beatsNextProb)} of paired draws.`
              : ""}{" "}
          Estimates, not advice: read down the list to find a year and mileage you can
          actually shop for.
        </p>
      ) : null}
      {rows.some((p) => p.clamped) ? (
        <p className="myr-caption">
          * No mileage of that model year&rsquo;s own is feasible for this car (its whole
          band falls outside the production window, the end-of-life cap, or the first
          observed point on its price curve), so the row is priced at the nearest usable
          odometer instead. Those rows are still real prices, but they are not a
          like-for-like comparison against the others.
        </p>
      ) : null}
    </>
  );
}
