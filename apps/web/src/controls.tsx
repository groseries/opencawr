import { useState } from "react";
import type { EngineInputs } from "@opencawr/core";

export const DEFAULTS: EngineInputs = {
  holdMiles: "eol",
  annualMiles: 13_000,
  discountRate: 0.07,
  gasUsdPerGal: 5.455,
  elecUsdPerKwh: 0.32,
  insuranceMultiplier: 0.8,
  useTaxRate: 0.07,
  draws: 1100,
  seed: 42,
};

export const HORIZONS: { label: string; value: number | "eol" }[] = [
  { label: "50k", value: 50_000 },
  { label: "100k", value: 100_000 },
  { label: "150k", value: 150_000 },
  { label: "until it dies", value: "eol" },
];

interface Props {
  inputs: EngineInputs;
  onChange: (next: EngineInputs) => void;
}

export function Assumptions({ inputs, onChange }: Props) {
  const set = (patch: Partial<EngineInputs>) => onChange({ ...inputs, ...patch });
  const [customHold, setCustomHold] = useState(false);
  const holdIsPreset = HORIZONS.some((h) => h.value === inputs.holdMiles);

  return (
    <div className="assumptions">
      <h2 className="rail-title">Your assumptions</h2>

      <fieldset className="control control-hero">
        <legend>How long will you keep it?</legend>
        <div className="horizon-strip" role="group" aria-label="Holding horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.label}
              type="button"
              className={
                !customHold && inputs.holdMiles === h.value ? "seg seg-active" : "seg"
              }
              onClick={() => {
                setCustomHold(false);
                set({ holdMiles: h.value });
              }}
            >
              {h.label}
            </button>
          ))}
          <button
            type="button"
            className={customHold || !holdIsPreset ? "seg seg-active" : "seg"}
            onClick={() => {
              setCustomHold(true);
              if (inputs.holdMiles === "eol") set({ holdMiles: 80_000 });
            }}
          >
            custom
          </button>
        </div>
        {(customHold || !holdIsPreset) && (
          <label className="control-inline">
            <input
              type="number"
              className="mono"
              min={10_000}
              step={10_000}
              value={inputs.holdMiles === "eol" ? 80_000 : (inputs.holdMiles as number)}
              onChange={(e) => set({ holdMiles: Math.max(10_000, Number(e.target.value)) })}
            />
            <span className="unit">miles held</span>
          </label>
        )}
      </fieldset>

      <NumberControl
        label="Miles you drive per year"
        value={inputs.annualMiles ?? 13_000}
        step={1_000}
        min={4_000}
        max={40_000}
        unit="mi/yr"
        onChange={(v) => set({ annualMiles: v })}
      />
      <NumberControl
        label="Your money could earn (real)"
        hint="0% = don't count opportunity cost"
        value={Math.round((inputs.discountRate ?? 0.07) * 1000) / 10}
        step={0.5}
        min={0}
        max={15}
        unit="%/yr"
        onChange={(v) => set({ discountRate: v / 100 })}
      />
      <NumberControl
        label="Gas price"
        value={inputs.gasUsdPerGal ?? 5.455}
        step={0.25}
        min={1}
        max={9}
        unit="$/gal"
        onChange={(v) => set({ gasUsdPerGal: v })}
      />
      <NumberControl
        label="Electricity price"
        value={inputs.elecUsdPerKwh ?? 0.32}
        step={0.02}
        min={0.05}
        max={0.8}
        unit="$/kWh"
        onChange={(v) => set({ elecUsdPerKwh: v })}
      />
      <NumberControl
        label="Insurance vs. average"
        hint="0.8 = a 20% cheaper insurer"
        value={inputs.insuranceMultiplier ?? 0.8}
        step={0.05}
        min={0.5}
        max={1.6}
        unit="×"
        onChange={(v) => set({ insuranceMultiplier: v })}
      />
      <NumberControl
        label="Sales / use tax"
        value={Math.round((inputs.useTaxRate ?? 0.07) * 1000) / 10}
        step={0.5}
        min={0}
        max={11}
        unit="%"
        onChange={(v) => set({ useTaxRate: v / 100 })}
      />
      <NumberControl
        label="Vehicle registration"
        value={inputs.registrationUsdYr ?? 55}
        step={5}
        min={0}
        max={400}
        unit="$/yr"
        onChange={(v) => set({ registrationUsdYr: v })}
      />

      <button type="button" className="reset" onClick={() => onChange(DEFAULTS)}>
        Reset to defaults
      </button>
    </div>
  );
}

export type RankBasis = "p50" | "p75";

/** Owner-decision plain-English rank-basis toggle: re-sorts table + ladder by
 * the chosen quantile (worker precomputes both orderings, no recompute here). */
export function RankBasisToggle({
  value,
  onChange,
}: {
  value: RankBasis;
  onChange: (v: RankBasis) => void;
}) {
  return (
    <div className="rank-basis" role="group" aria-label="Rank basis">
      <span className="rank-basis-label">Rank by</span>
      <div className="rank-basis-strip">
        <button
          type="button"
          className={value === "p50" ? "seg seg-active" : "seg"}
          onClick={() => onChange("p50")}
        >
          expected cost (P50)
        </button>
        <button
          type="button"
          className={value === "p75" ? "seg seg-active" : "seg"}
          onClick={() => onChange("p75")}
        >
          protects against bad luck (P75)
        </button>
      </div>
    </div>
  );
}

function NumberControl(props: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="control">
      <span className="control-label">
        {props.label}
        {props.hint ? <span className="control-hint">{props.hint}</span> : null}
      </span>
      <span className="control-inline">
        <input
          type="number"
          className="mono"
          value={props.value}
          step={props.step}
          min={props.min}
          max={props.max}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <span className="unit">{props.unit}</span>
      </span>
    </label>
  );
}
