import { CALIBRATION } from "@opencawr/core";
import { DEFAULTS, HORIZONS } from "../controls.js";
import { Markdown, MarkdownInline, findOpenRows, findRow, sliceSection } from "./markdown.js";

// Source from artifacts, not fresh prose (R6 brief): these three files are the
// living record. Vite inlines them as plain strings at build time via `?raw` —
// editing any of them and rebuilding changes this tab, with no copy to drift.
import ASSUMPTIONS_MD from "../../../../ASSUMPTIONS.md?raw";
import RELIABILITY_MD from "../../../../docs/reliability-methodology.md?raw";
import SPEC_MD from "../../../../OpenCAWR_SPEC.md?raw";

const SPEC_COST_MODEL = sliceSection(SPEC_MD, "\n## 2.", "\n## 6.");
const SPEC_LAUNCH_GATE = sliceSection(SPEC_MD, "\n## 9.", "\n## 10.");
const OPEN_ITEMS = findOpenRows(ASSUMPTIONS_MD);
const ENERGY_ROW = findRow(ASSUMPTIONS_MD, "Energy");

export function AssumptionsTab() {
  return (
    <div className="assumptions-tab">
      <section className="at-section gate-section">
        <h3>Launch gate — reliability data is not shippable yet</h3>
        <p className="md-source">Source: OpenCAWR_SPEC.md §9 (also recorded in DECISIONS.md)</p>
        <div className="gate-banner">
          <Markdown source={SPEC_LAUNCH_GATE} />
        </div>
      </section>

      <section className="at-section">
        <h3>Open items &amp; deferred limitations</h3>
        <p className="md-source">
          Every row tagged <code>OPEN</code> anywhere in ASSUMPTIONS.md, extracted live — see also
          §E's full decision log below.
        </p>
        <ul className="open-list">
          {OPEN_ITEMS.map((item, i) => (
            <li key={i}>
              <span className="open-tag">OPEN</span>
              <span className="open-heading">{item.heading}</span>
              <MarkdownInline text={item.cells.join(" — ")} />
            </li>
          ))}
        </ul>
        {ENERGY_ROW ? (
          <div className="callout">
            <strong>Energy sits outside the Monte Carlo (T5 limitation):</strong>{" "}
            <MarkdownInline text={ENERGY_ROW[1] ?? ""} />
          </div>
        ) : null}
      </section>

      <section className="at-section">
        <h3>The cost equation</h3>
        <p className="md-source">Source: OpenCAWR_SPEC.md §2–§5</p>
        <Markdown source={SPEC_COST_MODEL} />
      </section>

      <section className="at-section">
        <h3>What each rail input does</h3>
        <p className="md-source">
          Defaults read live from <code>apps/web/src/controls.tsx</code>'s <code>DEFAULTS</code> —
          not retyped here.
        </p>
        <div className="md-table-wrap">
          <table className="input-doc-table">
            <thead>
              <tr>
                <th>Input</th>
                <th>Default</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>How long you'll keep it</td>
                <td className="mono">
                  {HORIZONS.map((h) => h.label).join(" / ")}, or a custom mileage
                </td>
                <td>Sets the sell odometer (spec §3) — the single biggest lever on which car wins.</td>
              </tr>
              <tr>
                <td>Miles you drive per year</td>
                <td className="mono">{(DEFAULTS.annualMiles ?? 13_000).toLocaleString()} mi/yr</td>
                <td>Converts the holding horizon to miles and couples odometer to implied model year.</td>
              </tr>
              <tr>
                <td>Your money could earn (real)</td>
                <td className="mono">{((DEFAULTS.discountRate ?? 0.07) * 100).toFixed(1)}%/yr</td>
                <td>The discount rate — opportunity cost of capital enters ONLY here (spec §2). 0% = don't count it.</td>
              </tr>
              <tr>
                <td>Gas price</td>
                <td className="mono">${(DEFAULTS.gasUsdPerGal ?? 5.455).toFixed(3)}/gal</td>
                <td>Priced against each car's gallons/mile in the energy term.</td>
              </tr>
              <tr>
                <td>Electricity price</td>
                <td className="mono">${(DEFAULTS.elecUsdPerKwh ?? 0.38).toFixed(2)}/kWh</td>
                <td>Priced against each EV/PHEV's kWh/mile in the energy term.</td>
              </tr>
              <tr>
                <td>Insurance vs. average</td>
                <td className="mono">{(DEFAULTS.insuranceMultiplier ?? 0.8).toFixed(2)}×</td>
                <td>Multiplies the per-model premium; 0.8 = a 20% cheaper insurer than the seed data assumes.</td>
              </tr>
              <tr>
                <td>Sales / use tax</td>
                <td className="mono">{((DEFAULTS.useTaxRate ?? 0.07) * 100).toFixed(1)}%</td>
                <td>Applied once, to purchase price at t0.</td>
              </tr>
              <tr>
                <td>Vehicle registration</td>
                <td className="mono">${DEFAULTS.registrationUsdYr ?? 55}/yr</td>
                <td>Flat annual operating cost, discounted like the other operating-cost terms.</td>
              </tr>
              <tr>
                <td>Monte Carlo draws</td>
                <td className="mono">{DEFAULTS.draws ?? 1_100}</td>
                <td>Not user-editable in the rail. Randomizes EOL mileage, repair events, insurance noise, battery timing.</td>
              </tr>
              <tr>
                <td>Random seed</td>
                <td className="mono">{DEFAULTS.seed ?? 42}</td>
                <td>Not user-editable. Fixed so the engine reproduces the reference test outputs exactly.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="at-section">
        <h3>Engine calibration constants</h3>
        <p className="md-source">
          Read live from <code>packages/core/src/calibration.ts</code>'s <code>CALIBRATION</code> —
          not retyped here.
        </p>
        <div className="md-table-wrap">
          <table className="calibration-table">
            <thead>
              <tr>
                <th>Constant</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Repair-cost lognormal σ</td>
                <td className="mono">{CALIBRATION.sigmaRepair}</td>
                <td>
                  <span className="status-badge status-documented">DOCUMENTED</span>
                </td>
              </tr>
              <tr>
                <td>Insurance noise σ (Normal(1, σ) per year)</td>
                <td className="mono">{CALIBRATION.insuranceNoiseSigma}</td>
                <td>
                  <span className="status-badge status-documented">DOCUMENTED</span>
                </td>
              </tr>
              <tr>
                <td>Major-repair tail starts at odometer</td>
                <td className="mono">{CALIBRATION.repairOdoThreshold.toLocaleString()} mi</td>
                <td>
                  <span className="status-badge status-documented">DOCUMENTED</span>
                </td>
              </tr>
              <tr>
                <td>Repair hazard ramp scale</td>
                <td className="mono">{CALIBRATION.repairRampScaleMiles.toLocaleString()} mi</td>
                <td>
                  <span className="status-badge status-documented">DOCUMENTED</span>
                </td>
              </tr>
              <tr>
                <td>Calendar-age escalator (rate / start age)</td>
                <td className="mono">
                  {(CALIBRATION.calAgeEscPerYr * 100).toFixed(0)}%/yr past age {CALIBRATION.calAgeEscStartAge}
                </td>
                <td>
                  <span className="status-badge status-documented">DOCUMENTED</span>{" "}
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
              <tr>
                <td>Fallback EOL dispersion σ</td>
                <td className="mono">{CALIBRATION.sigmaEolFallback}</td>
                <td>
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
              <tr>
                <td>Tie-tier "beats leader" probability</td>
                <td className="mono">{CALIBRATION.tieTierBeatProb}</td>
                <td>
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
              <tr>
                <td>Buy-point sweep draws/point</td>
                <td className="mono">{CALIBRATION.sweepDraws}</td>
                <td>
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
              <tr>
                <td>Buy-point sweep grid step</td>
                <td className="mono">{CALIBRATION.sweepStepMiles.toLocaleString()} mi</td>
                <td>
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
              <tr>
                <td>Buy-point sweep "worthwhile" tolerance</td>
                <td className="mono">{(CALIBRATION.worthwhileP50Tolerance * 100).toFixed(0)}% of cheapest P50</td>
                <td>
                  <span className="status-badge status-judgment">JUDGMENT</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="at-section">
        <h3>Full assumptions ledger</h3>
        <p className="md-source">Source: ASSUMPTIONS.md</p>
        <Markdown source={ASSUMPTIONS_MD} />
      </section>

      <section className="at-section">
        <h3>Reliability re-derivation methodology</h3>
        <p className="md-source">Source: docs/reliability-methodology.md</p>
        <Markdown source={RELIABILITY_MD} />
      </section>
    </div>
  );
}
