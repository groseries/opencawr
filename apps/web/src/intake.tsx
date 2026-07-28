import { useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import { HORIZONS } from "./controls.js";
import { regionForZip } from "./region.js";

interface Props {
  inputs: EngineInputs;
  /** Applies a patch into the SAME `EngineInputs` state the rail edits — no
   * second copy of these values ever exists. */
  onApply: (patch: Partial<EngineInputs>) => void;
  onSetMinSeats: (seats: number | null) => void;
  onDismiss: () => void;
}

/** First-visit, dismissible, never-a-gate intake: four optional questions
 * that seed the same `EngineInputs`/filter state the Assumptions rail edits.
 * "Skip" leaves every value at its existing default. */
export function IntakeCard({ inputs, onApply, onSetMinSeats, onDismiss }: Props) {
  const [zip, setZip] = useState("");
  const [miles, setMiles] = useState(inputs.annualMiles ?? 13_000);
  const [seats, setSeats] = useState<number | "">("");
  const [hold, setHold] = useState<number | "eol">(inputs.holdMiles ?? "eol");

  const region = zip.length >= 3 ? regionForZip(zip) : null;
  const zipUnrecognized = zip.length >= 3 && region === null;

  const apply = () => {
    const patch: Partial<EngineInputs> = { annualMiles: miles, holdMiles: hold };
    if (region) {
      patch.gasUsdPerGal = region.gasUsdPerGal;
      patch.elecUsdPerKwh = region.elecUsdPerKwh;
      patch.useTaxRate = region.useTaxRate;
      patch.registrationUsdYr = region.registrationUsdYr;
    }
    onApply(patch);
    onSetMinSeats(seats === "" ? null : seats);
    onDismiss();
  };

  return (
    <div className="intake-scrim">
      <div className="intake-card" role="dialog" aria-modal="true" aria-label="Quick setup">
        <button type="button" className="intake-close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
        <h2 className="rail-title">Quick setup</h2>
        <p className="intake-sub">
          Four optional questions to tailor prices to you. Skip any time — every value
          defaults sensibly and stays editable in the rail.
        </p>

        <label className="control">
          <span className="control-label">Your ZIP code</span>
          <span className="control-inline">
            <input
              type="text"
              inputMode="numeric"
              className="mono"
              maxLength={5}
              placeholder="90210"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </span>
          <span className="control-hint">
            {zipUnrecognized
              ? "ZIP not recognized — regional prices will use defaults"
              : "Sets gas, electricity, tax, and registration for your state"}
          </span>
        </label>

        <label className="control">
          <span className="control-label">Miles you drive per year</span>
          <span className="control-inline">
            <input
              type="number"
              className="mono"
              step={1_000}
              min={1_000}
              value={miles}
              onChange={(e) => setMiles(Number(e.target.value))}
            />
            <span className="unit">mi/yr</span>
          </span>
        </label>

        <label className="control">
          <span className="control-label">Seats you need</span>
          <span className="control-inline">
            <input
              type="number"
              className="mono"
              min={2}
              max={9}
              placeholder="no preference"
              value={seats}
              onChange={(e) => setSeats(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </span>
          <span className="control-hint">
            Cars with fewer seats are grayed out in the results, never hidden
          </span>
        </label>

        <fieldset className="control control-hero">
          <legend>How long will you keep it?</legend>
          <div className="horizon-strip" role="group" aria-label="Holding horizon">
            {HORIZONS.map((h) => (
              <button
                key={h.label}
                type="button"
                className={hold === h.value ? "seg seg-active" : "seg"}
                onClick={() => setHold(h.value)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="intake-actions">
          <button type="button" className="reset" onClick={onDismiss}>
            Skip — use defaults
          </button>
          <button type="button" className="intake-continue" onClick={apply}>
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}
