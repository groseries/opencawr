import type { ModelYearBestAtHold } from "../engine.worker.js";

/** New-car premium panel (drawer-only): what this car's NEWEST model year costs
 * over its own sweet spot, at each of the rail's fixed holding periods.
 *
 * Every figure here is a point the model-year ranking beneath it already
 * computed — the sweet spot is that ranking's rank-1 row, and the "newest year"
 * column is its last row, each priced at its OWN cheapest odometer on the same
 * grid. Nothing is priced a second time, so this panel cannot disagree with the
 * one below it.
 *
 * Why it exists: whether buying new is worth it varies a lot by car AND by how
 * long you hold, and neither the Rankings row nor the model-year table states
 * that gap directly. It is also strongly hold-dependent — spreading a new car's
 * higher purchase price over more miles shrinks the premium — which is why this
 * is a row per holding period rather than a single number.
 *
 * Same honesty rules as its sibling panel: where the tie tiers can't separate
 * the newest year from the sweet spot, this says so instead of printing a
 * percentage the model can't stand behind (R15); and every row is priced at ONE
 * fixed hold, never at "until it dies", because an open-ended horizon is itself
 * a function of the buy odometer (R10). The cheapest-year cell applies R15 a
 * second way, matching `ByHoldSummary` in ModelYearRanking.tsx word-for-word:
 * where more than one year shares the top tie tier there is no single cheapest
 * year to name, so the cell says so instead of picking one — otherwise this
 * panel could name a year the table directly beneath it refuses to. */

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtK = (x: number) => `${Math.round(x / 1000)}k`;

export function NewCarPremium({
  byHold,
  discontinued,
}: {
  byHold: ModelYearBestAtHold[];
  discontinued: boolean;
}) {
  if (byHold.length === 0) return null;

  // Every year of this car prices identically (its whole production window sits
  // outside the feasible odometer range), so "new vs the sweet spot" is not a
  // comparison — it is one point measured against itself. Same refusal the
  // model-year panel already makes for the same cars.
  if (byHold.every((h) => h.degenerate)) {
    return (
      <p className="results-note">
        Every model year of this car prices identically at these assumptions — its whole
        production window sits outside the feasible odometer range, so each year clamps to
        the same odometer. There is no new-versus-used gap to report here: the newest year
        and the cheapest year are literally the same point.
      </p>
    );
  }

  const newestYear = byHold[0]!.newYear;
  const anyClamped = byHold.some((h) => !h.degenerate && h.newClamped);
  const usable = byHold.filter((h) => !h.degenerate);
  const newWins = usable.filter((h) => h.newIsBest);
  const quantified = usable.filter(
    (h) => !h.newIsBest && !h.newTiedWithBest && h.newPremium !== null,
  );

  return (
    <>
      <table className="myr-table myr-byhold">
        <thead>
          <tr>
            <th>If you hold</th>
            <th>Cheapest year · mileage · $/mi</th>
            <th>Newest year · mileage · $/mi</th>
            <th className="num">Cost of buying new</th>
          </tr>
        </thead>
        <tbody>
          {byHold.map((h) => (
            <tr key={h.holdMiles}>
              <td className="mono">{fmtK(h.holdMiles)} mi</td>
              <td className="mono">
                {h.degenerate
                  ? "—"
                  : h.tiedTopYears.length > 1
                    ? "no single cheapest year"
                    : `${h.bestYear} · ${fmtK(h.bestOdo)} mi · ${fmt(h.bestP50)}`}
              </td>
              <td className="mono">
                {h.degenerate
                  ? "—"
                  : `${h.newYear} · ${fmtK(h.newOdo)} mi · ${fmt(h.newP50)}`}
                {!h.degenerate && h.newClamped ? (
                  <abbr
                    className="myr-clamped"
                    title="No mileage of this model year's own is feasible for this car (production years, end-of-life cap, or the first point on its price curve), so this row is priced at the nearest usable odometer instead. Compare it with care."
                  >
                    *
                  </abbr>
                ) : null}
              </td>
              <td className="num mono">
                {h.degenerate
                  ? "every year prices the same"
                  : h.newIsBest
                    ? "none — the newest year IS the cheapest"
                    : h.newTiedWithBest
                      ? "tied with the cheapest year"
                      : h.newPremium === null
                        ? "—"
                        : `+${(h.newPremium * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="myr-caption">
        {newWins.length === usable.length
          ? "At every holding period shown, this car's newest model year is also its cheapest per mile — nothing older beats it on the model's own numbers."
          : newWins.length > 0
            ? "At some holding periods the newest model year is also the cheapest one outright, and at others it is not — how long you keep the car decides whether buying new costs anything at all."
            : quantified.length === 0
              ? "At no holding period shown can the model separate the newest model year from the cheapest one — the gap is inside its own noise, so there is no new-car premium worth quoting."
              : "The cost of buying new shrinks as the holding period grows, because a newer car's higher purchase price is spread over more miles."}{" "}
        Both columns are that model year priced at its OWN cheapest mileage on the same
        grid, at the same fixed holding period — so the gap between them is the cost of
        insisting on the newest year, not an artifact of comparing two different mileages.
        Where the two land in the same statistical tie tier the model cannot honestly order
        them, and this says so rather than quoting a percentage.{" "}
        {discontinued
          ? `This car is no longer sold new — ${newestYear} is the last model year it was built, so the "newest year" column is the newest one you could find used, not a dealer purchase.`
          : ""}{" "}
        Estimates, not advice.
      </p>
      {anyClamped ? (
        <p className="myr-caption">
          * No mileage of the newest model year&rsquo;s own is feasible for this car at
          that holding period, so it is priced at the nearest usable odometer instead —
          still a real price, but not a like-for-like comparison against the cheapest year
          beside it.
        </p>
      ) : null}
    </>
  );
}
