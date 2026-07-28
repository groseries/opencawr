/// <reference lib="webworker" />
import { costPerMile, curveAt, parseCurve, rankWithTiers, type RankableCar } from "@opencawr/core";
import type { Constants, EngineInputs, Vehicle } from "@opencawr/core";
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

self.onmessage = (e: MessageEvent<EngineRequest | DealRequest>) => {
  if (e.data.kind === "deal") {
    handleDeal(e.data);
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
      const rawYear = data.constants.now_year - res.buyOdo / am;
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
  const rawYear = data.constants.now_year - deal.odo / am;
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
