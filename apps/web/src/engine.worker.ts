/// <reference lib="webworker" />
import { costPerMile, rankWithTiers, type RankableCar } from "@opencawr/core";
import type { Constants, EngineInputs, Vehicle } from "@opencawr/core";
import raw from "../../../opencawr_data.json";

const data = raw as unknown as { constants: Constants; vehicles: Vehicle[] };

export interface EngineRequest {
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

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  const { id, inputs } = e.data;
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
};
