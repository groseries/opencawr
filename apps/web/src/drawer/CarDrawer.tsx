import { useEffect } from "react";
import type { EngineInputs } from "@opencawr/core";
import { useSurveyEngine } from "../useSurveyEngine.js";
import { Heatmap } from "../charts/Heatmap.js";
import { Breakdown } from "../charts/Breakdown.js";
import { Sensitivity } from "../charts/Sensitivity.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;

/** Per-car drawer (spec §6.1/§6.4), opened by clicking a row in either the
 * ranking table or the ladder: survey heatmap, cost breakdown, and sensitivity
 * lines for that one car, all at the rail's current assumptions. `vehicleName:
 * null` renders nothing — the drawer is closed. */
export function CarDrawer({
  vehicleName,
  inputs,
  onClose,
}: {
  vehicleName: string | null;
  inputs: EngineInputs;
  onClose: () => void;
}) {
  const { result } = useSurveyEngine(inputs, vehicleName);

  useEffect(() => {
    if (!vehicleName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        role="dialog"
        aria-modal="true"
        aria-label={`${vehicleName} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="drawer-title">{vehicleName}</h2>
        {!ready ? (
          <div className="loading">Running the survey grid…</div>
        ) : (
          <>
            <p className="drawer-headline">
              <span className="mono">{fmt(result.p50)}/mi</span> at your current assumptions
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
