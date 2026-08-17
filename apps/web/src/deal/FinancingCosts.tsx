import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import { calcFinancing, resolveMilesBasis } from "./financing.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;
const fmtUsd = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString()}`;

const TERM_PRESETS = [36, 48, 60, 72];
const DEFAULT_PRICE = 20_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Standalone "what does financing cost me vs. paying cash" calculator —
 *  independent of any one car's cost model (see design doc). Opportunistically
 *  reuses the Deal Analyzer's price/holding-miles when available. */
export function FinancingCosts({
  inputs,
  dealPrice,
  lifetimeMiles,
}: {
  inputs: EngineInputs;
  dealPrice: number | null;
  lifetimeMiles: number | null;
}) {
  const [price, setPrice] = useState(DEFAULT_PRICE);
  const [downPaymentMode, setDownPaymentMode] = useState<"$" | "%">("$");
  const [downPaymentUsd, setDownPaymentUsd] = useState(Math.round(DEFAULT_PRICE * 0.2));
  const [aprPct, setAprPct] = useState(6.5);
  const [termMonths, setTermMonths] = useState(60);
  const [customTerm, setCustomTerm] = useState(false);
  const [opportunityRatePct, setOpportunityRatePct] = useState(
    () => Math.round((inputs.discountRate ?? 0.07) * 1000) / 10,
  );

  // FinancingCosts now stays mounted across tab switches (so its own state
  // survives leaving Analyze), which means it can mount before the Deal
  // Analyzer's price has arrived. Prefill from dealPrice exactly once, the
  // first time it becomes available — never again after, so a later vehicle
  // change never silently resyncs the user's own price/down-payment edits.
  const prefilled = useRef(false);
  useEffect(() => {
    if (dealPrice != null && !prefilled.current) {
      prefilled.current = true;
      setPrice(dealPrice);
      setDownPaymentUsd(Math.round(dealPrice * 0.2));
    }
  }, [dealPrice]);

  const clampedDownPayment = clamp(downPaymentUsd, 0, price);
  const termIsPreset = TERM_PRESETS.includes(termMonths);

  const milesBasis = useMemo(
    () => resolveMilesBasis(termMonths, lifetimeMiles, inputs.holdMiles, inputs.annualMiles),
    [termMonths, lifetimeMiles, inputs.holdMiles, inputs.annualMiles],
  );

  const result = useMemo(
    () =>
      calcFinancing({
        price,
        downPaymentUsd: clampedDownPayment,
        aprPct,
        termMonths,
        opportunityRatePct,
        milesBasis,
      }),
    [price, clampedDownPayment, aprPct, termMonths, opportunityRatePct, milesBasis],
  );

  return (
    <div className="assumptions financing-costs">
      <h2 className="rail-title">Financing costs</h2>

      <label className="control">
        <span className="control-label">Price</span>
        <span className="control-inline">
          <span className="unit">$</span>
          <input
            type="number"
            className="mono"
            step={500}
            value={price}
            onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
          />
          {dealPrice != null && (
            <button type="button" className="sync-btn" onClick={() => setPrice(dealPrice)}>
              sync to deal price
            </button>
          )}
        </span>
      </label>

      <fieldset className="control">
        <legend className="control-label">Down payment</legend>
        <div className="horizon-strip" role="group" aria-label="Down payment unit">
          <button
            type="button"
            className={downPaymentMode === "$" ? "seg seg-active" : "seg"}
            onClick={() => setDownPaymentMode("$")}
          >
            $
          </button>
          <button
            type="button"
            className={downPaymentMode === "%" ? "seg seg-active" : "seg"}
            onClick={() => setDownPaymentMode("%")}
          >
            %
          </button>
        </div>
        <span className="control-inline">
          {downPaymentMode === "$" ? (
            <>
              <span className="unit">$</span>
              <input
                type="number"
                className="mono"
                step={500}
                value={clampedDownPayment}
                onChange={(e) => setDownPaymentUsd(clamp(Number(e.target.value), 0, price))}
              />
            </>
          ) : (
            <>
              <input
                type="number"
                className="mono"
                step={1}
                value={price > 0 ? Math.round((clampedDownPayment / price) * 1000) / 10 : 0}
                onChange={(e) =>
                  setDownPaymentUsd(clamp((Number(e.target.value) / 100) * price, 0, price))
                }
              />
              <span className="unit">%</span>
            </>
          )}
        </span>
      </fieldset>

      <label className="control">
        <span className="control-label">Loan APR</span>
        <span className="control-inline">
          <input
            type="number"
            className="mono"
            step={0.25}
            min={0}
            value={aprPct}
            onChange={(e) => setAprPct(Math.max(0, Number(e.target.value)))}
          />
          <span className="unit">%/yr</span>
        </span>
      </label>

      <fieldset className="control">
        <legend className="control-label">Loan term</legend>
        <div className="horizon-strip" role="group" aria-label="Loan term">
          {TERM_PRESETS.map((months) => (
            <button
              key={months}
              type="button"
              className={!customTerm && termMonths === months ? "seg seg-active" : "seg"}
              onClick={() => {
                setCustomTerm(false);
                setTermMonths(months);
              }}
            >
              {months}mo
            </button>
          ))}
          <button
            type="button"
            className={customTerm || !termIsPreset ? "seg seg-active" : "seg"}
            onClick={() => setCustomTerm(true)}
          >
            custom
          </button>
        </div>
        {(customTerm || !termIsPreset) && (
          <span className="control-inline">
            <input
              type="number"
              className="mono"
              min={1}
              step={1}
              value={termMonths}
              onChange={(e) => setTermMonths(Math.max(1, Number(e.target.value)))}
            />
            <span className="unit">months</span>
          </span>
        )}
      </fieldset>

      <label className="control">
        <span className="control-label">
          Opportunity cost rate
          <span className="control-hint">nominal loan APR vs. effective-annual opportunity rate — not directly comparable 1:1, see breakeven below</span>
        </span>
        <span className="control-inline">
          <input
            type="number"
            className="mono"
            step={0.5}
            min={0}
            value={opportunityRatePct}
            onChange={(e) => setOpportunityRatePct(Math.max(0, Number(e.target.value)))}
          />
          <span className="unit">%/yr</span>
        </span>
      </label>

      <div className="deal-summary">
        <p className="deal-headline">
          <span className="mono">{fmtUsd(result.monthlyPayment)}</span>/mo for {termMonths} months
        </p>
        <p className="deal-line">
          Total interest paid: <span className="mono">{fmtUsd(result.totalInterestUsd)}</span>
        </p>
        <p className="deal-line">
          Financing vs. cash:{" "}
          <span className="mono">{fmtUsd(result.financingCostUsd)}</span>{" "}
          {result.financingCostUsd >= 0 ? "more" : "less"} than paying cash (
          <span className="mono">{fmt(Math.abs(result.financingCostPerMi))}</span>/mi{" "}
          {result.financingCostUsd >= 0 ? "added" : "saved"})
        </p>
        <p className="deal-line">
          Breakeven APR: <span className="mono">{result.breakevenAprPct.toFixed(2)}%</span> — a
          loan below this rate beats paying cash at your opportunity rate.
        </p>
      </div>
    </div>
  );
}
