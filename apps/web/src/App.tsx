import { useMemo, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import { Assumptions, DEFAULTS, RankBasisToggle, type RankBasis } from "./controls.js";
import { useEngine } from "./useEngine.js";
import { useBuyPoints } from "./useBuyPoints.js";
import { Ladder } from "./charts/Ladder.js";
import { tierColor, tierTextColor } from "./charts/tierColors.js";
import { DealAnalyzer } from "./deal/DealAnalyzer.js";
import { IntakeCard } from "./intake.js";
import { CarDrawer } from "./drawer/CarDrawer.js";

const fmt = (x: number) => `$${x.toFixed(3)}`;

const INTAKE_SEEN_KEY = "opencawr:intake-seen";

// localStorage can throw (Safari private mode, hardened settings) — never let
// that crash top-level render. Read failure behaves as "not seen yet"; write
// failure is a silent no-op.
function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function App() {
  const [inputs, setInputs] = useState<EngineInputs>(DEFAULTS);
  const [rankBasis, setRankBasis] = useState<RankBasis>("p50");
  const [view, setView] = useState<"table" | "ladder">("table");
  const [tab, setTab] = useState<"rankings" | "deal">("rankings");
  const [minSeats, setMinSeats] = useState<number | null>(null);
  const [showIntake, setShowIntake] = useState(() => !safeLocalGet(INTAKE_SEEN_KEY));
  const [drawerCar, setDrawerCar] = useState<string | null>(null);
  const { byP50, byP75, ms, computing } = useEngine(inputs);
  const rows = rankBasis === "p50" ? byP50 : byP75;
  // Decoupled from the rank request (R4 review fixup) so re-ranking stays live
  // while dragging the rail — see useBuyPoints.ts. `computing: true` here must
  // never be papered over with the previous inputs' figures.
  const { points: buyPoints, computing: buyPointsComputing } = useBuyPoints(inputs);

  const dismissIntake = () => {
    safeLocalSet(INTAKE_SEEN_KEY, "1");
    setShowIntake(false);
  };

  // Soft filter: cars below the seats-needed threshold are grayed, never
  // removed. Recomputed from `rows` + `minSeats` only — no parallel list.
  const dimmed = useMemo(() => {
    const s = new Set<string>();
    if (minSeats !== null && rows) {
      for (const r of rows) if (r.seats < minSeats) s.add(r.name);
    }
    return s;
  }, [rows, minSeats]);

  // The primary (emphasized) column follows the active rank basis; the other
  // quantile moves to the secondary column instead of going stale/hidden.
  const primaryValue = (r: { p50: number; p75: number }) =>
    rankBasis === "p75" ? r.p75 : r.p50;
  const secondaryValue = (r: { p50: number; p75: number; p90: number }) =>
    rankBasis === "p75" ? r.p50 : r.p90;
  const primaryLabel = rankBasis === "p75" ? "bad-luck cost" : "$/mi";
  // Disclose the pricing odometer here because the row's "ideal mileage" (buy-point
  // sweep argmin) can land on a different odometer than this column's own price.
  const primarySub = rankBasis === "p75" ? "P75 · at buy odo" : "median · at buy odo";
  const secondaryLabel = rankBasis === "p75" ? "typical cost" : "bad luck";
  const secondarySub = rankBasis === "p75" ? "P50" : "P90";

  const horizonLabel =
    inputs.holdMiles === "eol"
      ? "until it dies"
      : `${((inputs.holdMiles as number) / 1000).toFixed(0)}k mi hold`;

  // Remember each car's previous P50 AND P75 (regardless of which is on
  // display) so the flash means "this changed because an assumption changed" —
  // never "the user toggled which stat is shown". Both maps are updated from
  // every recompute, so switching rankBasis alone never flags a flash: the
  // quantile's own history already tracks it from before the toggle.
  const prevP50 = useMemo(() => new Map<string, number>(), []);
  const prevP75 = useMemo(() => new Map<string, number>(), []);
  const flashKeys = useMemo(() => {
    if (!byP50) return new Map<string, boolean>();
    const out = new Map<string, boolean>();
    for (const r of byP50) {
      const prevMap = rankBasis === "p75" ? prevP75 : prevP50;
      const was = prevMap.get(r.name);
      const now = rankBasis === "p75" ? r.p75 : r.p50;
      out.set(r.name, was !== undefined && Math.abs(was - now) > 0.0005);
    }
    for (const r of byP50) {
      prevP50.set(r.name, r.p50);
      prevP75.set(r.name, r.p75);
    }
    return out;
  }, [byP50, prevP50, prevP75, rankBasis]);

  return (
    <div className="shell">
      {showIntake && (
        <IntakeCard
          inputs={inputs}
          onApply={(patch) => setInputs({ ...inputs, ...patch })}
          onSetMinSeats={setMinSeats}
          onDismiss={dismissIntake}
        />
      )}
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

      <div className="tab-strip" role="group" aria-label="Section">
        <button
          type="button"
          className={tab === "rankings" ? "seg seg-active" : "seg"}
          onClick={() => setTab("rankings")}
        >
          Rankings
        </button>
        <button
          type="button"
          className={tab === "deal" ? "seg seg-active" : "seg"}
          onClick={() => setTab("deal")}
        >
          Deal Analyzer
        </button>
      </div>

      <div className="layout">
        <aside className="rail">
          <Assumptions inputs={inputs} onChange={setInputs} />
          <p className="disclaimer">
            Estimates from a simulation, not advice. Every assumption is editable above and
            documented in the project's assumptions ledger.
          </p>
        </aside>

        <main className="results">
          {tab === "rankings" ? (
            <>
              <div className="results-head">
                <h2>Ranking</h2>
                <p className="results-note">
                  Cars in the same tie tier are statistically indistinguishable — the model
                  can't honestly order them.
                </p>
                <p className="results-note">
                  Each row's ideal mileage marks that car's own cost-minimizing buy point, not a
                  recommendation — the $/mi columns are still priced at that car's default buy
                  odometer, so the two figures can disagree.
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
              {minSeats !== null && (
                <p className="filter-status">
                  Filtering: seats ≥ {minSeats}.{" "}
                  <button type="button" className="filter-clear" onClick={() => setMinSeats(null)}>
                    Clear
                  </button>
                </p>
              )}
            </>
          ) : (
            <div className="results-head">
              <h2>Deal Analyzer</h2>
              <p className="results-note">
                Score a specific listing against the modeled field. Estimates only — never
                advice.
              </p>
            </div>
          )}
          {tab === "rankings" &&
            (!rows ? (
              <div className="loading">
                Running {DEFAULTS.draws ?? 1100} simulations per car…
              </div>
            ) : view === "ladder" ? (
              <Ladder rows={rows} basis={rankBasis} dimmed={dimmed} onOpenCar={setDrawerCar} />
            ) : (
            <table className="ranking">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-tier">tier</th>
                  <th>vehicle</th>
                  <th className="num">
                    {primaryLabel} <span className="th-sub">{primarySub}</span>
                  </th>
                  <th className="num">
                    90% band <span className="th-sub">P05–P95</span>
                  </th>
                  <th className="num">
                    {secondaryLabel} <span className="th-sub">{secondarySub}</span>
                  </th>
                  <th className="num">
                    beats next <span className="th-sub">prob.</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const newTier = i === 0 || rows[i - 1]!.statTier !== r.statTier;
                  const isDimmed = dimmed.has(r.name);
                  const rowClass =
                    ["row-clickable", newTier && "tier-start", isDimmed && "row-dimmed"]
                      .filter(Boolean)
                      .join(" ");
                  const openDrawer = () => setDrawerCar(r.name);
                  const bp = buyPoints?.[r.name];
                  return (
                    <tr
                      key={r.name}
                      className={rowClass}
                      tabIndex={0}
                      onClick={openDrawer}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDrawer();
                        }
                      }}
                    >
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
                          {buyPointsComputing || !bp ? (
                            <span className="mono">…</span>
                          ) : (
                            <>
                              <span className="mono">{bp.idealYear}</span> ·{" "}
                              <span className="mono">{Math.round(bp.idealOdo / 1000)}k mi</span>
                              {bp.upperOdo !== null ? (
                                <>
                                  {" "}
                                  · up to{" "}
                                  <span className="mono">{Math.round(bp.upperOdo / 1000)}k mi</span>
                                </>
                              ) : null}
                            </>
                          )}
                          {r.feasNote ? ` · ${r.feasNote}` : ""}
                          {isDimmed ? " · misses 1 filter" : ""}
                        </span>
                      </td>
                      <td
                        key={`${r.name}-${r.p50.toFixed(4)}-${r.p75.toFixed(4)}`}
                        className={`num p50 mono${flashKeys.get(r.name) ? " flash" : ""}`}
                      >
                        {fmt(primaryValue(r))}
                      </td>
                      <td className="num band mono">
                        {fmt(r.p05)}–{fmt(r.p95)}
                      </td>
                      <td className="num band mono">{fmt(secondaryValue(r))}</td>
                      <td className="num band mono">
                        {r.beatsNext === null ? "—" : `${Math.round(r.beatsNext * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            ))}
          <div style={{ display: tab === "deal" ? "block" : "none" }}>
            {rows ? (
              <DealAnalyzer inputs={inputs} rows={rows} />
            ) : (
              <div className="loading">
                Running {DEFAULTS.draws ?? 1100} simulations per car…
              </div>
            )}
          </div>
          <footer className="foot">
            <span>
              OpenCAWR · reliability inputs pending public re-derivation (see ledger) ·
              estimates, not advice
            </span>
          </footer>
        </main>
      </div>
      <CarDrawer
        vehicleName={drawerCar}
        etype={rows?.find((r) => r.name === drawerCar)?.etype ?? null}
        inputs={inputs}
        onClose={() => setDrawerCar(null)}
      />
    </div>
  );
}
