/// <reference lib="webworker" />
import {
  costPerMile,
  curveAt,
  impliedModelYear,
  isFeasibleBuy,
  parseCurve,
  rankWithTiers,
  type RankableCar,
} from "@opencawr/core";
import type { Constants, CostBreakdown, EngineInputs, Vehicle } from "@opencawr/core";
import raw from "../../../opencawr_data.json";

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
  buyOdo: number;
  buyPrice: number;
  impliedBuyYear: number;
  /** Human note when the odometer↔year coupling is off in either direction. */
  feasNote: string | null;
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
  /** Fraction of this car's own default-buy draws that are cheaper than the deal's P50. */
  percentile: number;
  /** How many of the field's cars (at their default buy point) this deal's P50 beats. */
  beats: number;
  fieldSize: number;
  cpm: DealSummary;
  priceVsCurveUsd: number;
  notes: string[];
}

/** Survey drawer request (Task F): one car's cost-vs-buy-point grid, its default
 * breakdown, and two sensitivity sweeps. All grid/sweep cells run at reduced
 * draws (see SURVEY_DRAWS) — a documented speed/precision tradeoff (ASSUMPTIONS.md §H). */
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
  /** This car's own default-buy-point P50 (current rail assumptions) — drawer headline. */
  p50: number;
  breakdown: CostBreakdown;
  buyOdoAxis: number[];
  holdMilesAxis: number[];
  /** Length buyOdoAxis.length * holdMilesAxis.length, holdMilesAxis outer, buyOdoAxis inner. */
  cells: SurveyCell[];
  sensAnnualMiles: SweepPoint[];
  sensGasPrice: SweepPoint[];
}

/** All response kinds share one worker (see sharedWorker.ts) — hooks filter their
 * own `onmessage` listener on `kind` (and their own request id) so a rank/deal/
 * survey response can never be consumed by a different hook. */
export type EngineWorkerResponse = EngineResponse | DealResponse | SurveyResponse;

self.onmessage = (e: MessageEvent<EngineRequest | DealRequest | SurveyRequest>) => {
  if (e.data.kind === "deal") {
    handleDeal(e.data);
  } else if (e.data.kind === "survey") {
    handleSurvey(e.data);
  } else {
    handleRank(e.data);
  }
};

function handleRank(req: EngineRequest) {
  const { id, inputs } = req;
  const t0 = performance.now();

  const results = data.vehicles.map((v) => ({
    vehicle: v,
    res: costPerMile(v, data.constants, inputs),
  }));
  const byName = new Map(results.map((r) => [r.vehicle.name, r]));
  const am = inputs.annualMiles ?? data.constants.annual_miles;

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
      const { vehicle, res } = byName.get(rk.id)!;
      const rawYear = impliedModelYear(res.buyOdo, am, data.constants.now_year);
      const feasNote =
        Math.round(rawYear) > vehicle.last_year
          ? `low-mileage example (last built ${vehicle.last_year})`
          : Math.round(rawYear) < vehicle.first_year
            ? "more miles than plausible for this model's age"
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
        buyOdo: res.buyOdo,
        buyPrice: res.buyPrice,
        impliedBuyYear: res.impliedBuyYear,
        feasNote,
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

  // The car's own default-buy distribution — the yardstick for "how good is this
  // specific price/mileage combo", as opposed to the pooled field comparison below.
  const defaultRes = costPerMile(vehicle, data.constants, inputs);
  const dealRes = costPerMile(vehicle, data.constants, {
    ...inputs,
    buyOdo: deal.odo,
    purchasePrice: deal.price,
  });

  let below = 0;
  for (const v of defaultRes.drawsCpm) if (v < dealRes.p50) below++;
  const percentile = below / defaultRes.drawsCpm.length;

  // Where the deal's P50 lands against the rest of the field, each at ITS OWN
  // default buy point (the same comparison the Rankings view shows).
  const fieldP50s = data.vehicles.map((v) => costPerMile(v, data.constants, inputs).p50);
  const beats = fieldP50s.filter((p) => p > dealRes.p50).length;

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
    "reliability inputs are seed data pending public re-derivation — treat repair and tail-risk estimates with caution",
  );

  const msg: DealResponse = {
    kind: "deal",
    id,
    percentile,
    beats,
    fieldSize: fieldP50s.length,
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
 * default 1,100 for speed — documented tradeoff, ASSUMPTIONS.md §H). */
const SURVEY_DRAWS = 400;

function handleSurvey(req: SurveyRequest) {
  const { id, inputs, vehicleName } = req;
  const vehicle = data.vehicles.find((v) => v.name === vehicleName);
  if (!vehicle) return; // the drawer only ever opens from a row naming a real car

  const am = inputs.annualMiles ?? data.constants.annual_miles;

  // The car's own current default-buy result (full draws) — drawer headline + breakdown.
  const defaultRes = costPerMile(vehicle, data.constants, inputs);

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
    p50: defaultRes.p50,
    breakdown: defaultRes.breakdown,
    buyOdoAxis: BUY_ODO_AXIS,
    holdMilesAxis: HOLD_MILES_AXIS,
    cells,
    sensAnnualMiles,
    sensGasPrice,
  };
  self.postMessage(msg);
}
