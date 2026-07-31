/// <reference lib="webworker" />
import {
  CALIBRATION,
  costPerMile,
  curveAt,
  impliedModelYear,
  isFeasibleBuy,
  modelYearRank,
  parseCurve,
  priceAtSweetSpot,
  rankWithTiers,
  type RankableCar,
} from "@opencawr/core";
import type {
  Constants,
  CostBreakdown,
  EngineInputs,
  EngineResult,
  ModelYearRankPoint,
  Vehicle,
} from "@opencawr/core";
import raw from "../../../opencawr_data.json";
// The rail's own preset holding periods — reused so the per-hold summary always
// offers exactly the holds the user can actually pick, rather than a second
// hardcoded list that could drift from the control. Imported from the
// React-free `horizons.js`, not `controls.tsx`, to keep React out of the worker.
import { HORIZONS } from "./horizons.js";

const data = raw as unknown as { constants: Constants; vehicles: Vehicle[] };

export interface EngineRequest {
  kind: "rank";
  id: number;
  inputs: EngineInputs;
}

export interface RankedRow {
  name: string;
  etype: string;
  body: string;
  seats: number;
  rank: number;
  statTier: number;
  p50: number;
  p75: number;
  p90: number;
  p05: number;
  p95: number;
  beatsNext: number | null;
  /** Median TOTAL dollars, and the median miles it spans — always shown together, since
   *  at `"eol"` different rows span different lifespans (see EngineResult's JSDoc). */
  lifetimeCostUsdP50: number;
  lifetimeMilesP50: number;
  /** THE buy point of this row: the odometer, its price, and the model year it
   *  implies. Every money figure above is `costPerMile` evaluated here — there
   *  is no second buy point in a row (see `handleRank`). */
  buyOdo: number;
  buyPrice: number;
  impliedBuyYear: number;
  /** Last odometer still within tolerance of the sweet spot's P50
   *  (`buyPointSweep`'s `upperOdo`) — "still worth buying up to here". `null`
   *  when `atSweetSpot` is false (no sweep ran) or the walk can't take a step. */
  upperOdo: number | null;
  /** True when `buyOdo` is this car's own cost-minimizing buy point rather than
   *  its default `pinned_buy_odo` — i.e. the rail names a fixed hold. False at
   *  `"eol"`, where there is no sweet spot to price at (R10). The UI needs the
   *  distinction only for wording; the row is coherent either way. */
  atSweetSpot: boolean;
  /** Human note when the odometer↔year coupling is off in either direction. */
  feasNote: string | null;
  /** Human note when this car's end of life cuts the requested holding period
   *  short (`EngineResult.truncatedDrawFraction`) — the fact behind a lifetime
   *  total whose miles fall short of the hold on the rail. `null` at `"eol"`
   *  (nothing is being cut short) and below
   *  `CALIBRATION.truncatedDrawDisclosureFraction` when the median hold still
   *  completes. */
  truncNote: string | null;
}

export interface EngineResponse {
  kind: "rank";
  id: number;
  ms: number;
  byP50: RankedRow[];
  byP75: RankedRow[];
}

/** A single real-world listing to score against the modeled field (Deal Analyzer). */
export interface DealInput {
  vehicleName: string;
  year: number;
  odo: number;
  price: number;
}

export interface DealRequest {
  kind: "deal";
  id: number;
  inputs: EngineInputs;
  deal: DealInput;
}

/** Quantile summary for the deal's own scored draws. */
export interface DealSummary {
  p50: number;
  p75: number;
  p90: number;
  p05: number;
  p95: number;
}

export interface DealResponse {
  kind: "deal";
  id: number;
  /** Fraction of this car's draws AT THE DEAL'S OWN ODOMETER (curve-priced, same
   *  holding assumptions) that come out cheaper than the deal's P50 — so "an Nth
   *  percentile outcome for this model at this odometer" is literally what it is. */
  percentile: number;
  cpm: DealSummary;
  priceVsCurveUsd: number;
  notes: string[];
}

/** Survey drawer request (Task F): one car's cost-vs-buy-point grid, its default
 * breakdown, and two sensitivity sweeps. All grid/sweep cells run at reduced
 * draws (see SURVEY_DRAWS) — a documented speed/precision tradeoff (ASSUMPTIONS.md §I). */
export interface SurveyRequest {
  kind: "survey";
  id: number;
  inputs: EngineInputs;
  vehicleName: string;
}

export interface SurveyCell {
  buyOdo: number;
  holdMiles: number;
  p50: number;
  /** Two-sided odometer↔model-year rule (isFeasibleBuy) — grayed in the heatmap. */
  feasible: boolean;
}

export interface SweepPoint {
  x: number;
  p50: number;
}

export interface SurveyResponse {
  kind: "survey";
  id: number;
  vehicleName: string;
  /** This car's P50 at the SAME buy point the Rankings row it was opened from
   * prices at — its sweet spot at a fixed hold, its default `pinned_buy_odo` at
   * `"eol"` (see `handleRank`). Priced here at full draws, so it reproduces the
   * row's own $/mi rather than merely being close to it. */
  p50: number;
  /** The odometer `p50` and `breakdown` are priced at, shown beside them in the
   * drawer headline. */
  buyOdo: number;
  breakdown: CostBreakdown;
  buyOdoAxis: number[];
  holdMilesAxis: number[];
  /** Length buyOdoAxis.length * holdMilesAxis.length, holdMilesAxis outer, buyOdoAxis inner. */
  cells: SurveyCell[];
  sensAnnualMiles: SweepPoint[];
  sensGasPrice: SweepPoint[];
}

/** Model-year ranking request (R2, drawer-only): one car's own feasible model
 * years, ranked by cost at a single fixed holding horizon. This is a VIEW of
 * the buy-point sweep's own grid grouped by model year (see modelyear.ts), so
 * its rank-1 row is the same (year, odometer) pair the Rankings row shows —
 * still a distinct question from the survey heatmap's hold-vs-buy grid. */
export interface ModelYearRankRequest {
  kind: "modelyearrank";
  id: number;
  inputs: EngineInputs;
  vehicleName: string;
}

export interface ModelYearRankEntry {
  year: number;
  odo: number;
  clamped: boolean;
  p50: number;
  rank: number;
  /** Statistical tie tier (1 = cheapest tier), from the same `rankWithTiers`
   *  walk the Rankings table uses on whole cars (R15). Years sharing a tier are
   *  indistinguishable and must not be presented in an order. `null` when the
   *  row's draws weren't retained — unreachable for an unclamped row. */
  tier: number | null;
  beatsNextProb: number | null;
  reliabilityMark: "bad" | "caution" | "good" | "normal";
  drivetrain: string | null;
  specChangeFromPriorYear: boolean;
  topComplaintCategory: string | null;
  topComplaintShare: number | null;
}

/** The best model year at ONE fixed holding horizon. Answering "which year"
 *  still requires a fixed hold (R10) — but the answer can be given at each
 *  fixed hold in turn, which is what this carries. */
export interface ModelYearBestAtHold {
  holdMiles: number;
  bestYear: number;
  /** The odometer that goes with `bestYear` — the answer is a (year, mileage)
   *  pair, not a year (owner, 2026-07-30). Same point the sweep would report as
   *  `idealOdo` at this hold. */
  bestOdo: number;
  bestP50: number;
  /** Best year's cost minus the SECOND-best year's, as a fraction of the best —
   *  how much the year choice is actually worth at this hold. `null` when the
   *  car has only one feasible model year (nothing to be better than).
   *  Meaningless on its own when `tiedTopYears.length > 1`: the panel must not
   *  quote a margin it can't distinguish from zero (R15). */
  marginVsRunnerUp: number | null;
  runnerUpYear: number | null;
  /** P(the best year is cheaper than the runner-up) over paired draws — the
   *  number the tie tier is cut on, so a margin the panel DOES claim can be
   *  quantified rather than just asserted. `null` with only one year. */
  beatsRunnerUpProb: number | null;
  /** Every model year in the cheapest tie tier, in rank order (so [0] is the
   *  sweet spot). Length 1 means the model can actually separate a best year at
   *  this hold; longer means it can't, and callers must not name one — that is
   *  R15's whole point. `degenerate` below is the limiting case of this. */
  tiedTopYears: number[];
  /** How many model years were compared at this hold, so "N of M years tied"
   *  can be stated rather than a bare count. */
  yearsCompared: number;
  /** Every model year clamped to the SAME odometer, so all years priced
   *  identically and `bestYear` is only the tie-break (year ascending), not a
   *  finding. Happens when a car's whole production window sits outside the
   *  feasible range at these assumptions — both Porsche 996 rows at defaults.
   *  Callers must not present `bestYear` as an answer when this is true. */
  degenerate: boolean;
}

export interface ModelYearRankResponse {
  kind: "modelyearrank";
  id: number;
  vehicleName: string;
  /** The full year ranking at the rail's OWN holding period. `null` when the
   *  rail is `"eol"`/undefined: an open-ended horizon is a function of the buy
   *  odometer, so years priced under it aren't on equal footing (R10). The
   *  `byHold` summary below is what answers the question in that case. */
  points: ModelYearRankEntry[] | null;
  bestYear: number | null;
  bestOdo: number | null;
  /** Best model year at each of the rail's own preset fixed holds, ALWAYS
   *  populated (owner, 2026-07-29: "we should still show and explain the best
   *  model year selected for every hold #"). Each row is internally valid under
   *  R10 because each is computed at a single fixed hold; comparing rows to each
   *  other shows whether the best year is stable across holding periods, which
   *  is the actual "intertwined but distinct" relationship between the two
   *  questions. Priced at the sweep's own reduced draws (`CALIBRATION.sweepDraws`),
   *  like every other number in this panel. */
  byHold: ModelYearBestAtHold[];
}

/** All response kinds share one worker (see sharedWorker.ts) — hooks filter their
 * own `onmessage` listener on `kind` (and their own request id) so a rank/deal/
 * survey/modelyearrank response can never be consumed by a different hook. */
export type EngineWorkerResponse =
  | EngineResponse
  | DealResponse
  | SurveyResponse
  | ModelYearRankResponse;

self.onmessage = (
  e: MessageEvent<EngineRequest | DealRequest | SurveyRequest | ModelYearRankRequest>,
) => {
  if (e.data.kind === "deal") {
    handleDeal(e.data);
  } else if (e.data.kind === "survey") {
    handleSurvey(e.data);
  } else if (e.data.kind === "modelyearrank") {
    handleModelYearRank(e.data);
  } else {
    void handleRank(e.data); // chunked/async at a fixed hold — see handleRank
  }
};

/** Cars priced between yields to the worker's message queue, and the id of the
 * most recent `rank` request so a chunked pass can tell it has been superseded
 * mid-field and stop. Inherited from the buy-point sweep this pass absorbed
 * (R4): 8 cars is ~1/9th of the field, so a request that arrives during a pass
 * waits at most that long, and an abandoned pass wastes at most that much. */
const RANK_CHUNK_CARS = 8;
let latestRankId = -1;

/**
 * Rank the whole field — at each car's OWN sweet spot when the rail names a
 * fixed hold, at each car's default `pinned_buy_odo` at `"eol"`.
 *
 * The pricing basis (owner's decision, 2026-07-30). A Rankings row states one
 * buy point and one price. It used to state two: the meta line showed
 * `buyPointSweep`'s sweet spot while every money column was priced at
 * `vehicle.pinned_buy_odo` (68/71 seed vehicles disagreed on the odometer at a
 * 100k hold). Now the sweep and the price are one call — `priceAtSweetSpot` —
 * so `RankedRow.buyOdo`/`impliedBuyYear` ARE the odometer and year the money
 * came from, and the UI has nothing else to render.
 *
 * Why this is one response and not two. R4 originally split the sweep into its
 * own `buypoints` message with a longer debounce, so the rank response could
 * stay live while the rail was being dragged. Pricing at the sweet spot makes
 * rank DEPEND on the sweep, so that split is no longer available: a fast
 * default-priced first render would be exactly the mismatched row this change
 * removes. Total worker cost per input change is unchanged — the app already
 * paid for both passes (measured 1,606 ms sweep + 121 ms rank) — but at a fixed
 * hold the table now updates once, ~1.7 s after the input settles, instead of
 * updating the money at ~0.12 s and the mileage at ~1.6 s. DECISIONS.md's
 * "live re-ranking on every input change" was knowingly renegotiated for this;
 * see ASSUMPTIONS.md. At `"eol"` no sweep runs (R10) and the pass stays
 * synchronous and live at ~0.12 s.
 */
async function handleRank(req: EngineRequest) {
  const { id, inputs } = req;
  latestRankId = id;
  const t0 = performance.now();
  const am = inputs.annualMiles ?? data.constants.annual_miles;
  const { holdMiles } = inputs;
  const atSweetSpot = typeof holdMiles === "number";

  const results: { vehicle: Vehicle; res: EngineResult; upperOdo: number | null }[] = [];
  if (typeof holdMiles === "number") {
    for (let i = 0; i < data.vehicles.length; i++) {
      const v = data.vehicles[i]!;
      const { sweep, priced } = priceAtSweetSpot(v, data.constants, { ...inputs, holdMiles });
      results.push({ vehicle: v, res: priced, upperOdo: sweep.upperOdo });
      if ((i + 1) % RANK_CHUNK_CARS === 0 && i + 1 < data.vehicles.length) {
        await new Promise((r) => setTimeout(r, 0));
        // A newer request landed during the yield (the inputs changed again):
        // abandon this one silently. The hook ignores stale ids anyway, and
        // finishing would only delay the request the user is waiting on — no
        // response is posted, so the UI keeps saying "computing" rather than
        // presenting a half-updated table as current.
        if (latestRankId !== id) return;
      }
    }
  } else {
    // "eol": buyPointSweep cannot answer an open-ended horizon (R10), so there
    // is no sweet spot to price at. Price at each car's default buy odometer
    // and say so — the row is still self-consistent, it just answers
    // "what does the default example cost" instead of "where is this car cheapest".
    for (const v of data.vehicles) {
      results.push({ vehicle: v, res: costPerMile(v, data.constants, inputs), upperOdo: null });
    }
  }
  const byName = new Map(results.map((r) => [r.vehicle.name, r]));

  // Rank by a given quantile: rankWithTiers sorts/tiers on the `p50` field of
  // RankableCar, so feeding it P75 there produces the P75 ordering, tiers, and
  // beatsNext — a second, independent ranking over the same draws.
  const buildRows = (sortField: "p50" | "p75"): RankedRow[] => {
    const ranked = rankWithTiers(
      results.map(({ vehicle, res }): RankableCar => ({
        id: vehicle.name,
        p50: sortField === "p50" ? res.p50 : res.p75,
        drawsCpm: res.drawsCpm,
      })),
    );
    return ranked.map((rk) => {
      const { vehicle, res, upperOdo } = byName.get(rk.id)!;
      // Computed from the odometer this row is PRICED at, which is now the same
      // odometer it displays — so the note can no longer contradict the mileage
      // beside it. At a fixed hold it goes quiet for 69/71 seed cars (the sweep
      // only proposes feasible odometers); it still fires for the two Porsche
      // 996 rows, whose feasible range collapses onto the `eol_maintained_miles`
      // cap ABOVE the production window, so the note is telling the truth there.
      const rawYear = impliedModelYear(res.buyOdo, am, data.constants.now_year);
      const feasNote =
        Math.round(rawYear) > vehicle.last_year
          ? `low-mileage example (last built ${vehicle.last_year})`
          : Math.round(rawYear) < vehicle.first_year
            ? "more miles than plausible for this model's age"
            : null;
      // End-of-life truncation, stated as fact. The first branch needs no
      // threshold at all: it fires exactly when the median miles print SHORTER
      // than the hold at the k-mi resolution this very line renders at, so the
      // note can neither restate the hold back to itself nor contradict the
      // mileage in the lifetime-total column. The minority case does need a
      // cutoff (CALIBRATION.truncatedDrawDisclosureFraction, ASSUMPTIONS.md §I).
      const holdK = typeof holdMiles === "number" ? Math.round(holdMiles / 1000) : null;
      const medianK = Math.round(res.lifetimeMilesP50 / 1000);
      const truncNote =
        holdK === null
          ? null
          : medianK < holdK
            ? `end of life cuts this ${holdK}k mi hold to ~${medianK}k mi`
            : res.truncatedDrawFraction >= CALIBRATION.truncatedDrawDisclosureFraction
              ? `${Math.round(res.truncatedDrawFraction * 100)}% of outcomes end before ${holdK}k mi`
              : null;
      return {
        name: vehicle.name,
        etype: vehicle.etype,
        body: vehicle.body,
        seats: vehicle.specs.seats,
        rank: rk.rank,
        statTier: rk.tier,
        p50: res.p50,
        p75: res.p75,
        p90: res.p90,
        p05: res.p05,
        p95: res.p95,
        beatsNext: rk.beatsNextProb,
        lifetimeCostUsdP50: res.lifetimeCostUsdP50,
        lifetimeMilesP50: res.lifetimeMilesP50,
        buyOdo: res.buyOdo,
        buyPrice: res.buyPrice,
        impliedBuyYear: res.impliedBuyYear,
        upperOdo,
        atSweetSpot,
        feasNote,
        truncNote,
      };
    });
  };

  const msg: EngineResponse = {
    kind: "rank",
    id,
    ms: performance.now() - t0,
    byP50: buildRows("p50"),
    byP75: buildRows("p75"),
  };
  self.postMessage(msg);
}

function handleDeal(req: DealRequest) {
  const { id, inputs, deal } = req;
  const vehicle = data.vehicles.find((v) => v.name === deal.vehicleName);
  if (!vehicle) return; // the form only ever offers names from the 71-car field

  const am = inputs.annualMiles ?? data.constants.annual_miles;
  const scrap = data.constants.scrap_usd_by_body[vehicle.body] ?? 400;
  const priceCurve = parseCurve(vehicle.price_vs_odometer_usd);

  // The yardstick for "how good is this specific price/mileage combo": this car at
  // THE DEAL'S OWN odometer, priced off the modeled market curve, under the rail's
  // own holding/mileage assumptions. Same buy point as the deal, so the only thing
  // separating the two runs is the price actually paid — which is exactly what the
  // rendered sentence ("an Nth-percentile outcome for this model at this odometer")
  // claims to be measuring. It used to be the car's DEFAULT buy point
  // (`vehicle.pinned_buy_odo`), which is a different odometer from the one the user
  // typed for all but a coincidence, so the sentence was scoring the deal against a
  // distribution for a car it wasn't describing.
  const baselineRes = costPerMile(vehicle, data.constants, { ...inputs, buyOdo: deal.odo });
  const dealRes = costPerMile(vehicle, data.constants, {
    ...inputs,
    buyOdo: deal.odo,
    purchasePrice: deal.price,
  });

  let below = 0;
  for (const v of baselineRes.drawsCpm) if (v < dealRes.p50) below++;
  const percentile = below / baselineRes.drawsCpm.length;

  // "cheaper than N of the field" is NOT computed here any more. It used to be a
  // second field pass at every car's default buy point, which was the same basis
  // the Rankings table used — but the table now prices at each car's sweet spot
  // (see handleRank), so this worker-side count would have silently meant
  // something different from the ladder rendered directly beneath it. The count
  // is now taken in DealAnalyzer from the very rows on screen, so the headline
  // and the ladder can never disagree, and the deal path drops 71 costPerMile
  // calls it was repeating on every keystroke.

  const priceVsCurveUsd = deal.price - curveAt(priceCurve, deal.odo, scrap);

  const notes: string[] = [];
  const myr = vehicle.model_year_reliability;
  if (myr.bad.includes(deal.year)) {
    notes.push(`${deal.year} is flagged as a landmine model year for this model.`);
  } else if (myr.caution.includes(deal.year)) {
    notes.push(`${deal.year} is flagged as a caution model year for this model.`);
  }

  // Same odometer↔year feasibility check as the Rankings view (feasNote), applied
  // to the odometer the deal was actually bought at.
  const rawYear = impliedModelYear(deal.odo, am, data.constants.now_year);
  if (Math.round(rawYear) > vehicle.last_year) {
    notes.push(`low-mileage example (last built ${vehicle.last_year})`);
  } else if (Math.round(rawYear) < vehicle.first_year) {
    notes.push("more miles than plausible for this model's age");
  }

  notes.push(
    "reliability tier is derived from NHTSA complaint mix, not a measured defect rate — treat repair and tail-risk estimates with caution",
  );

  const msg: DealResponse = {
    kind: "deal",
    id,
    percentile,
    cpm: {
      p50: dealRes.p50,
      p75: dealRes.p75,
      p90: dealRes.p90,
      p05: dealRes.p05,
      p95: dealRes.p95,
    },
    priceVsCurveUsd,
    notes,
  };
  self.postMessage(msg);
}

// Survey drawer (Task F, spec §6.1/§6.4): fixed axes shared by every car, so the
// grid always shows some infeasible (grayed) cells at the odometer extremes and a
// consistent hold-miles range, rather than a per-car window that would always be
// entirely "feasible" by construction.
const BUY_ODO_AXIS = [
  10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 110_000,
  120_000,
];
// A cell's holdMiles is nominal, not guaranteed miles actually driven: costPerMile
// clamps sell odo to each draw's own (randomly sampled) EOL, so a cell whose
// buyOdo + holdMiles would exceed a car's EOL quietly reflects fewer miles held
// for that draw — correct engine behavior, just non-obvious from the cell's label.
const HOLD_MILES_AXIS = [
  25_000, 50_000, 75_000, 100_000, 125_000, 150_000, 175_000, 200_000,
];
const ANNUAL_MILES_AXIS = [
  6_000, 8_000, 10_000, 12_000, 14_000, 16_000, 18_000, 20_000, 22_000, 24_000,
];
const GAS_PRICE_AXIS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];

/** Draws per cell for the 96-cell grid + 20 sensitivity points (reduced from the
 * default 1,100 for speed — documented tradeoff, ASSUMPTIONS.md §I). */
const SURVEY_DRAWS = 400;

function handleSurvey(req: SurveyRequest) {
  const { id, inputs, vehicleName } = req;
  const vehicle = data.vehicles.find((v) => v.name === vehicleName);
  if (!vehicle) return; // the drawer only ever opens from a row naming a real car

  const am = inputs.annualMiles ?? data.constants.annual_miles;

  // Headline + breakdown, priced at the SAME buy point the Rankings row shows
  // (full draws): the sweet spot at a fixed hold, the default buy odometer at
  // "eol". Opening a row must not restate its cost at a different buy point —
  // that is the disagreement this change exists to remove, and it would simply
  // have moved into the drawer. Costs one extra single-car sweep (~23 ms); the
  // model-year panel in the same drawer already runs one.
  const { holdMiles } = inputs;
  const headline =
    typeof holdMiles === "number"
      ? priceAtSweetSpot(vehicle, data.constants, { ...inputs, holdMiles }).priced
      : costPerMile(vehicle, data.constants, inputs);

  const cells: SurveyCell[] = [];
  for (const holdMiles of HOLD_MILES_AXIS) {
    for (const buyOdo of BUY_ODO_AXIS) {
      const res = costPerMile(vehicle, data.constants, {
        ...inputs,
        buyOdo,
        holdMiles,
        draws: SURVEY_DRAWS,
      });
      cells.push({
        buyOdo,
        holdMiles,
        p50: res.p50,
        feasible: isFeasibleBuy(vehicle, buyOdo, am, data.constants.now_year),
      });
    }
  }

  const sensAnnualMiles: SweepPoint[] = ANNUAL_MILES_AXIS.map((annualMiles) => ({
    x: annualMiles,
    p50: costPerMile(vehicle, data.constants, { ...inputs, annualMiles, draws: SURVEY_DRAWS })
      .p50,
  }));
  const sensGasPrice: SweepPoint[] = GAS_PRICE_AXIS.map((gasUsdPerGal) => ({
    x: gasUsdPerGal,
    p50: costPerMile(vehicle, data.constants, { ...inputs, gasUsdPerGal, draws: SURVEY_DRAWS })
      .p50,
  }));

  const msg: SurveyResponse = {
    kind: "survey",
    id,
    vehicleName,
    p50: headline.p50,
    buyOdo: headline.buyOdo,
    breakdown: headline.breakdown,
    buyOdoAxis: BUY_ODO_AXIS,
    holdMilesAxis: HOLD_MILES_AXIS,
    cells,
    sensAnnualMiles,
    sensGasPrice,
  };
  self.postMessage(msg);
}

/** Model-year ranking (R2) for one car, opened from the drawer.
 *
 * Two answers, because there are two situations:
 *  - The rail names a fixed holding period -> the full year ranking at THAT
 *    hold (`points`).
 *  - The rail is open-ended ("eol") -> `points: null`, because an open-ended
 *    horizon is itself a function of the buy odometer, so years priced under it
 *    aren't on equal footing (R10, same rule `handleRank` enforces).
 *
 * `byHold` is populated EITHER way (owner, 2026-07-29: "we should still show and
 * explain the best model year selected for every hold #"). It sidesteps R10
 * rather than violating it: each row is one ranking at one FIXED hold, never at
 * "eol", so each row is internally valid — and reading the rows against each
 * other answers whether the best year even depends on the holding period. */
function handleModelYearRank(req: ModelYearRankRequest) {
  const { id, inputs, vehicleName } = req;
  const vehicle = data.vehicles.find((v) => v.name === vehicleName);
  if (!vehicle) return; // the drawer only ever opens from a row naming a real car

  const myr = vehicle.model_year_reliability;
  const decorate = (p: ModelYearRankPoint): ModelYearRankEntry => {
    const detail = vehicle.model_year_detail?.[String(p.year)];
    const reliabilityMark = myr.bad.includes(p.year)
      ? "bad"
      : myr.caution.includes(p.year)
        ? "caution"
        : myr.good.includes(p.year)
          ? "good"
          : "normal";
    return {
      year: p.year,
      odo: p.odo,
      clamped: p.clamped,
      p50: p.p50,
      rank: p.rank,
      tier: p.tier,
      beatsNextProb: p.beatsNextProb,
      reliabilityMark,
      drivetrain: detail?.drivetrain ?? null,
      specChangeFromPriorYear: detail?.specChangeFromPriorYear ?? false,
      topComplaintCategory: detail?.topComplaintCategory ?? null,
      topComplaintShare: detail?.topComplaintShare ?? null,
    };
  };

  const { holdMiles } = inputs;
  const railHold = typeof holdMiles === "number" ? holdMiles : null;

  // The full ranking at the rail's own hold, when it names one.
  const railResult =
    railHold === null ? null : modelYearRank(vehicle, data.constants, { ...inputs, holdMiles: railHold });

  // Best year at each preset fixed hold. HORIZONS is the rail's own list, so
  // these rows are exactly the holds the user can pick — filtered to the
  // numeric ones ("eol" is the case this summary exists to answer).
  //
  // Every row runs at the SAME draw count as the full ranking, and the row whose
  // hold IS the rail's reuses that very result. Both matter: model years often
  // sit within a fraction of a percent of each other, so a reduced-draw summary
  // would pick a different winner than the full ranking directly beneath it and
  // the panel would contradict itself.
  const byHold: ModelYearBestAtHold[] = HORIZONS.filter(
    (h): h is { label: string; value: number } => typeof h.value === "number",
  ).map((h) => {
    const r =
      railHold === h.value && railResult
        ? railResult
        : modelYearRank(vehicle, data.constants, { ...inputs, holdMiles: h.value });
    const sorted = [...r.points].sort((a, b) => a.rank - b.rank);
    const runnerUp = sorted[1];
    return {
      holdMiles: h.value,
      bestYear: r.bestYear,
      bestOdo: r.bestOdo,
      bestP50: r.bestP50,
      marginVsRunnerUp:
        runnerUp && r.bestP50 > 0 ? (runnerUp.p50 - r.bestP50) / r.bestP50 : null,
      runnerUpYear: runnerUp?.year ?? null,
      beatsRunnerUpProb: runnerUp ? (sorted[0]?.beatsNextProb ?? null) : null,
      // Rank order, so the sweet spot stays first — the summary can then say
      // "these years are tied" without reordering anything the ranking below it
      // shows (R15).
      tiedTopYears: sorted.filter((p) => p.tier === 1).map((p) => p.year),
      yearsCompared: r.points.length,
      degenerate: r.points.length > 1 && new Set(r.points.map((p) => p.odo)).size === 1,
    };
  });

  const msg: ModelYearRankResponse = {
    kind: "modelyearrank",
    id,
    vehicleName,
    points: railResult ? railResult.points.map(decorate) : null,
    bestYear: railResult ? railResult.bestYear : null,
    bestOdo: railResult ? railResult.bestOdo : null,
    byHold,
  };
  self.postMessage(msg);
}
