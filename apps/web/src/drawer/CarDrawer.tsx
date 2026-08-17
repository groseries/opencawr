import { useEffect, useRef } from "react";
import type { EngineInputs } from "@opencawr/core";
import { useSurveyEngine } from "../useSurveyEngine.js";
import { useModelYearRank } from "../useModelYearRank.js";
import { Heatmap } from "../charts/Heatmap.js";
import { Breakdown } from "../charts/Breakdown.js";
import { Sensitivity } from "../charts/Sensitivity.js";
import { ModelYearRanking } from "../charts/ModelYearRanking.js";
import { NewCarPremium } from "../charts/NewCarPremium.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;
// Restores the powertrain-type token dropped from the Rankings row (R4 review
// fixup) — this is the only place in the UI it's shown now.
const ETYPE_LABEL: Record<string, string> = {
  gas: "gas",
  hybrid: "hybrid",
  ev: "EV",
  phev: "PHEV",
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Per-car drawer (spec §6.1/§6.4), opened by clicking a row in either the
 * ranking table or the ladder: survey heatmap, cost breakdown, and sensitivity
 * lines for that one car, all at the rail's current assumptions. `vehicleName:
 * null` renders nothing — the drawer is closed. */
export function CarDrawer({
  vehicleName,
  etype,
  inputs,
  onClose,
}: {
  vehicleName: string | null;
  etype: string | null;
  inputs: EngineInputs;
  onClose: () => void;
}) {
  const { result } = useSurveyEngine(inputs, vehicleName);
  const { result: myrResult } = useModelYearRank(inputs, vehicleName);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  // The element that had focus before the drawer opened (the row that
  // triggered it) — restored on close so keyboard users land back where
  // they started, never dropped onto the (now-obscured) page body.
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Focus management: move focus into the drawer on open, restore it to the
  // triggering row on close. Guarded against re-firing on car-to-car
  // switches (vehicleName truthy -> different truthy), which must not
  // re-capture the trigger or re-steal focus off whatever's focused inside.
  useEffect(() => {
    const isOpen = vehicleName !== null;
    if (isOpen && !wasOpenRef.current) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      closeBtnRef.current?.focus();
    } else if (!isOpen && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [vehicleName]);

  // Escape closes; Tab/Shift+Tab cycle within the panel only (minimal focus
  // trap) so keyboard focus never falls through to the obscured page behind
  // the scrim.
  useEffect(() => {
    if (!vehicleName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [vehicleName, onClose]);

  if (!vehicleName) return null;
  // Guard against showing the previous car's result for one render tick while
  // the new car's request is in flight (useSurveyEngine debounces 60ms).
  const ready = result && result.vehicleName === vehicleName;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        className="drawer-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${vehicleName} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeBtnRef}
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="drawer-title">
          {vehicleName}
          {etype ? <span className="drawer-etype">{ETYPE_LABEL[etype] ?? etype}</span> : null}
        </h2>
        {!ready ? (
          <div className="loading">Running the survey grid…</div>
        ) : (
          <>
            <p className="drawer-headline">
              <span className="mono">{fmt(result.p50)}/mi</span> bought at{" "}
              <span className="mono">{Math.round(result.buyOdo / 1000)}k mi</span>, at your
              current assumptions
            </p>

            <section className="drawer-section">
              <h3 className="drawer-section-title">Survey: buy point x hold miles</h3>
              <Heatmap
                cells={result.cells}
                buyOdoAxis={result.buyOdoAxis}
                holdMilesAxis={result.holdMilesAxis}
              />
            </section>

            <section className="drawer-section">
              <h3 className="drawer-section-title">
                Buying new: what the newest model year costs
              </h3>
              {myrResult && myrResult.vehicleName === vehicleName ? (
                <NewCarPremium
                  byHold={myrResult.byHold}
                  discontinued={myrResult.newestYearDiscontinued}
                />
              ) : (
                <p className="results-note">Pricing the newest model year…</p>
              )}
            </section>

            <section className="drawer-section">
              <h3 className="drawer-section-title">Model years: which year is the best buy</h3>
              {myrResult && myrResult.vehicleName === vehicleName ? (
                <ModelYearRanking points={myrResult.points} byHold={myrResult.byHold} />
              ) : (
                <p className="results-note">Ranking model years…</p>
              )}
            </section>

            <section className="drawer-section">
              <h3 className="drawer-section-title">Cost breakdown</h3>
              <Breakdown breakdown={result.breakdown} />
            </section>

            <section className="drawer-section">
              <h3 className="drawer-section-title">Sensitivity</h3>
              <Sensitivity
                sensAnnualMiles={result.sensAnnualMiles}
                sensGasPrice={result.sensGasPrice}
                currentAnnualMiles={inputs.annualMiles ?? 13_000}
                currentGasPrice={inputs.gasUsdPerGal ?? 5.455}
              />
            </section>

            <p className="drawer-disclaimer">
              Survey grid and sensitivity lines run at 400 simulation draws per point
              (reduced from the {inputs.draws ?? 1_100}-draw default) for responsiveness —
              estimates, not advice.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
