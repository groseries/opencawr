import { useMemo, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import { Assumptions, DEFAULTS, RankBasisToggle, type RankBasis } from "./controls.js";
import { useEngine } from "./useEngine.js";
import { Ladder } from "./charts/Ladder.js";
import { tierColor, tierTextColor } from "./charts/tierColors.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;
const ETYPE_LABEL: Record<string, string> = {
  gas: "gas",
  hybrid: "hybrid",
  ev: "EV",
  phev: "PHEV",
};

export function App() {
  const [inputs, setInputs] = useState<EngineInputs>(DEFAULTS);
  const [rankBasis, setRankBasis] = useState<RankBasis>("p50");
  const [view, setView] = useState<"table" | "ladder">("table");
  const { byP50, byP75, ms, computing } = useEngine(inputs);
  const rows = rankBasis === "p50" ? byP50 : byP75;

  const horizonLabel =
    inputs.holdMiles === "eol"
      ? "until it dies"
      : `${((inputs.holdMiles as number) / 1000).toFixed(0)}k mi hold`;

  // remember previous P50s so changed values can flash
  const prev = useMemo(() => new Map<string, number>(), []);
  const flashKeys = useMemo(() => {
    if (!rows) return new Map<string, boolean>();
    const out = new Map<string, boolean>();
    for (const r of rows) {
      const was = prev.get(r.name);
      out.set(r.name, was !== undefined && Math.abs(was - r.p50) > 0.0005);
      prev.set(r.name, r.p50);
    }
    return out;
  }, [rows, prev]);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="wordmark">
          OPEN<span className="wordmark-cawr">CAWR</span>
        </div>
        <p className="thesis">
          What a used car <em>really</em> costs per mile — with the uncertainty shown, not
          hidden.
        </p>
        <div className="context-line">
          <span>{rows ? rows.length : "…"} vehicles</span>
          <span>{horizonLabel}</span>
          <span>{(inputs.annualMiles ?? 13000).toLocaleString()} mi/yr</span>
          <span>{(((inputs.discountRate ?? 0.07) * 100)).toFixed(1)}% real</span>
          <span className="context-ms">{computing ? "computing…" : `${ms.toFixed(0)} ms`}</span>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <Assumptions inputs={inputs} onChange={setInputs} />
          <p className="disclaimer">
            Estimates from a simulation, not advice. Every assumption is editable above and
            documented in the project's assumptions ledger.
          </p>
        </aside>

        <main className="results">
          <div className="results-head">
            <h2>Ranking</h2>
            <p className="results-note">
              Cars in the same tie tier are statistically indistinguishable — the model can't
              honestly order them.
            </p>
          </div>
          <div className="results-controls">
            <RankBasisToggle value={rankBasis} onChange={setRankBasis} />
            <div className="view-switcher" role="group" aria-label="View">
              <button
                type="button"
                className={view === "table" ? "seg seg-active" : "seg"}
                onClick={() => setView("table")}
              >
                Table
              </button>
              <button
                type="button"
                className={view === "ladder" ? "seg seg-active" : "seg"}
                onClick={() => setView("ladder")}
              >
                Ladder
              </button>
            </div>
          </div>
          {!rows ? (
            <div className="loading">Running {DEFAULTS.draws ?? 1100} simulations per car…</div>
          ) : view === "ladder" ? (
            <Ladder rows={rows} />
          ) : (
            <table className="ranking">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-tier">tier</th>
                  <th>vehicle</th>
                  <th className="num">
                    $/mi <span className="th-sub">median</span>
                  </th>
                  <th className="num">
                    90% band <span className="th-sub">P05–P95</span>
                  </th>
                  <th className="num">
                    bad luck <span className="th-sub">P90</span>
                  </th>
                  <th className="num">
                    beats next <span className="th-sub">prob.</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const newTier = i === 0 || rows[i - 1]!.statTier !== r.statTier;
                  return (
                    <tr key={r.name} className={newTier ? "tier-start" : undefined}>
                      <td
                        className="col-rank mono"
                        style={{ borderLeft: `3px solid ${tierColor(r.statTier)}` }}
                      >
                        {r.rank}
                      </td>
                      <td className="col-tier">
                        {newTier ? (
                          <span
                            className="tier-chip"
                            style={{
                              background: tierColor(r.statTier),
                              color: tierTextColor(r.statTier),
                              borderColor: tierColor(r.statTier),
                            }}
                          >
                            TIE {r.statTier}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className="car-name">{r.name}</span>
                        <span className="car-meta">
                          {ETYPE_LABEL[r.etype]} · buy ~{Math.round(r.buyOdo / 1000)}k mi ·{" "}
                          {r.impliedBuyYear}
                          {r.feasNote ? ` · ${r.feasNote}` : ""}
                        </span>
                      </td>
                      <td
                        key={`${r.name}-${r.p50.toFixed(4)}`}
                        className={`num p50 mono${flashKeys.get(r.name) ? " flash" : ""}`}
                      >
                        {fmt(r.p50)}
                      </td>
                      <td className="num band mono">
                        {fmt(r.p05)}–{fmt(r.p95)}
                      </td>
                      <td className="num band mono">{fmt(r.p90)}</td>
                      <td className="num band mono">
                        {r.beatsNext === null ? "—" : `${Math.round(r.beatsNext * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <footer className="foot">
            <span>
              OpenCAWR · reliability inputs pending public re-derivation (see ledger) ·
              estimates, not advice
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
