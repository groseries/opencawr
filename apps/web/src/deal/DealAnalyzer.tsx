import { useMemo, useState } from "react";
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

/** Score one real-world listing against the modeled 71-car field: percentile
 * within this car's own default-buy outcomes, rank position against the field,
 * and price vs. the modeled market curve. Estimates only — never "good/bad deal". */
export function DealAnalyzer({ inputs, rows }: { inputs: EngineInputs; rows: RankedRow[] }) {
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

  const deal = useMemo(
    () => (vehicleName ? { vehicleName, year, odo, price } : null),
    [vehicleName, year, odo, price],
  );
  const { result, computing } = useDealEngine(inputs, deal);

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

      {!result ? (
        <div className="loading">
          {computing ? "Scoring this deal…" : "Enter a listing above to score it."}
        </div>
      ) : (
        <>
          <div className="deal-summary">
            <p className="deal-headline">
              <span className="mono">{fmt(result.cpm.p50)}/mi</span> — cheaper than{" "}
              <strong>{result.beats}</strong> of {result.fieldSize} modeled cars
            </p>
            <p className="deal-line">
              Listed <span className="mono">{fmtUsd(result.priceVsCurveUsd)}</span>{" "}
              {result.priceVsCurveUsd >= 0 ? "above" : "below"} the modeled curve at this
              mileage.
            </p>
            <p className="deal-line">
              {article(Math.round(result.percentile * 100)) === "an" ? "An" : "A"}{" "}
              {ordinal(Math.round(result.percentile * 100))}-percentile outcome for this model
              at this odometer.
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
