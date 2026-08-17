import { useEffect, useMemo, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { RankedRow } from "../engine.worker.js";
import { useDealEngine } from "../useDealEngine.js";
import { Ladder, type LadderExtraRow } from "../charts/Ladder.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtUsd = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString()}`;

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "a"/"an" for a spoken percentile — the only vowel-sound numbers 0-100 are
 * eight, eleven, eighteen, and eighty-something. */
function article(n: number): string {
  return n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? "an" : "a";
}

const MAX_YEAR = new Date().getFullYear() + 1;
const MIN_YEAR = 1990;
const MAX_ODO = 500_000;

/** Guards against a cleared/negative/non-numeric field ever reaching the worker —
 * returns a plain-English note naming the first invalid field, or null if the
 * listing is scoreable. */
function validationError(year: number, odo: number, price: number): string | null {
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return `Enter a model year between ${MIN_YEAR} and ${MAX_YEAR}`;
  }
  if (!Number.isFinite(odo) || odo < 0 || odo > MAX_ODO) {
    return `Enter an odometer between 0 and ${MAX_ODO.toLocaleString()} mi`;
  }
  if (!Number.isFinite(price) || price <= 0) {
    return "Enter a price above $0";
  }
  return null;
}

/** Score one real-world listing against the modeled 71-car field: percentile
 * within this car's own outcomes at the deal's odometer, rank position against the
 * field, and price vs. the modeled market curve. Estimates only — never "good/bad deal". */
export function DealAnalyzer({
  inputs,
  rows,
  onLifetimeMiles,
  onPriceChange,
}: {
  inputs: EngineInputs;
  rows: RankedRow[];
  /** Fired whenever the scored deal's holding-period miles changes — null
   *  when there's no valid scored deal. Lets the Financing Costs section
   *  (rendered elsewhere) opportunistically share this car's own miles
   *  basis instead of falling back to a generic one. */
  onLifetimeMiles?: (miles: number | null) => void;
  /** Fired whenever the price-paid field changes, so Financing Costs can
   *  prefill/sync to it without the two sections being tightly coupled. */
  onPriceChange?: (price: number) => void;
}) {
  const sortedByName = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );
  const initial = sortedByName[0];
  const [vehicleName, setVehicleName] = useState(initial?.name ?? "");
  const [year, setYear] = useState(initial?.impliedBuyYear ?? 2020);
  const [odo, setOdo] = useState(initial?.buyOdo ?? 60_000);
  const [price, setPrice] = useState(Math.round(initial?.buyPrice ?? 20_000));

  const onVehicleChange = (name: string) => {
    setVehicleName(name);
    const r = rows.find((x) => x.name === name);
    if (r) {
      setYear(r.impliedBuyYear);
      setOdo(r.buyOdo);
      setPrice(Math.round(r.buyPrice));
    }
  };

  const invalidReason = validationError(year, odo, price);
  const deal = useMemo(
    () => (vehicleName && !invalidReason ? { vehicleName, year, odo, price } : null),
    [vehicleName, year, odo, price, invalidReason],
  );
  const { result, computing } = useDealEngine(inputs, deal);

  useEffect(() => {
    onPriceChange?.(price);
  }, [price, onPriceChange]);

  useEffect(() => {
    onLifetimeMiles?.(result?.lifetimeMilesP50 ?? null);
  }, [result, onLifetimeMiles]);

  // "cheaper than N of the field", counted over the very rows plotted in the
  // ladder below — not a separate worker-side pass at a different buy-point
  // basis. Those bases diverged on 2026-07-30 when the Rankings table moved to
  // sweet-spot pricing, so a count taken anywhere else would silently disagree
  // with the chart beside it. A comparison of already-computed $/mi, not cost
  // math (which stays in packages/core).
  const beats = result ? rows.filter((r) => r.p50 > result.cpm.p50).length : 0;

  const extraRow: LadderExtraRow | undefined = result
    ? {
        name: `Your deal · ${vehicleName}`,
        p50: result.cpm.p50,
        p75: result.cpm.p75,
        p05: result.cpm.p05,
        p95: result.cpm.p95,
      }
    : undefined;

  return (
    <div className="deal-analyzer">
      <form className="deal-form" onSubmit={(e) => e.preventDefault()}>
        <label className="control">
          <span className="control-label">Vehicle</span>
          <select
            className="deal-select"
            value={vehicleName}
            onChange={(e) => onVehicleChange(e.target.value)}
          >
            {sortedByName.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span className="control-label">Model year</span>
          <input
            type="number"
            className="mono"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label className="control">
          <span className="control-label">Odometer</span>
          <span className="control-inline">
            <input
              type="number"
              className="mono"
              step={1000}
              value={odo}
              onChange={(e) => setOdo(Number(e.target.value))}
            />
            <span className="unit">mi</span>
          </span>
        </label>
        <label className="control">
          <span className="control-label">Price paid</span>
          <span className="control-inline">
            <span className="unit">$</span>
            <input
              type="number"
              className="mono"
              step={500}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </span>
        </label>
      </form>

      {invalidReason ? (
        <div className="loading">{invalidReason}</div>
      ) : !result ? (
        <div className="loading">
          {computing ? "Scoring this deal…" : "Enter a listing above to score it."}
        </div>
      ) : (
        <>
          <div className="deal-summary">
            <p className="deal-headline">
              <span className="mono">{fmt(result.cpm.p50)}/mi</span> — cheaper than{" "}
              <strong>{beats}</strong> of {rows.length} modeled cars
              {inputs.holdMiles === "eol"
                ? " at their default buy points"
                : " at their own cheapest buy points"}
            </p>
            <p className="deal-line">
              Listed <span className="mono">{fmtUsd(result.priceVsCurveUsd)}</span>{" "}
              {result.priceVsCurveUsd >= 0 ? "above" : "below"} the modeled curve at this
              mileage.
            </p>
            {/* The percentile is now scored against this car at THE DEAL'S OWN
                odometer (see handleDeal), so "at this odometer" is literal; the
                clause names the distribution so the number can't be read as a
                percentile of the field. */}
            <p className="deal-line">
              {article(Math.round(result.percentile * 100)) === "an" ? "An" : "A"}{" "}
              {ordinal(Math.round(result.percentile * 100))}-percentile outcome for this model
              at this odometer, against the same car bought at the modeled price for that
              mileage.
            </p>
            {result.notes.length > 0 && (
              <ul className="deal-notes">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
          <Ladder rows={rows} basis="p50" extraRow={extraRow} />
        </>
      )}
    </div>
  );
}
