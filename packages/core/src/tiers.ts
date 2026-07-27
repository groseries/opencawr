import { CALIBRATION as CAL } from "./calibration.js";

/**
 * Statistical-significance layer (spec §2): beat probabilities between cars from the
 * raw Monte Carlo draws, and the tie-tier walk. Overlapping tiers mean the model
 * genuinely cannot tell those cars apart — the UI must say so.
 */

export interface RankableCar {
  id: string;
  p50: number;
  drawsCpm: Float64Array;
}

export interface RankedCar {
  id: string;
  rank: number;
  p50: number;
  /** Statistical tie tier (1 = cheapest tier). */
  tier: number;
  /** P(this car is cheaper than the next-ranked car); null for the last car. */
  beatsNextProb: number | null;
}

/** Fraction of paired draws where a is cheaper than b. */
export function beatProb(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let c = 0;
  for (let i = 0; i < n; i++) if (a[i]! < b[i]!) c++;
  return c / n;
}

/**
 * Sort by P50 and walk the ranking: a car joins the current tier unless the tier
 * LEADER beats it with ≥ tieTierBeatProb, which starts a new tier (spec §2).
 */
export function rankWithTiers(
  cars: RankableCar[],
  threshold: number = CAL.tieTierBeatProb,
): RankedCar[] {
  const order = [...cars].sort((a, b) => a.p50 - b.p50);
  const out: RankedCar[] = [];
  let tier = 1;
  let leader = order[0];
  for (let i = 0; i < order.length; i++) {
    const car = order[i]!;
    if (i > 0 && leader && beatProb(leader.drawsCpm, car.drawsCpm) >= threshold) {
      tier++;
      leader = car;
    }
    const next = order[i + 1];
    out.push({
      id: car.id,
      rank: i + 1,
      p50: car.p50,
      tier,
      beatsNextProb: next ? beatProb(car.drawsCpm, next.drawsCpm) : null,
    });
  }
  return out;
}
