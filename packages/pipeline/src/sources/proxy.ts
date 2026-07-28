/** Segment-peer proxy fallback: everything EPA/NHTSA can't supply (price
 *  curve, EOL, maintenance curve, tiers, seats/cargo/insurance, battery) is
 *  copied from the closest seed vehicle sharing body + etype.
 *
 *  Peer selection is two stages (see ASSUMPTIONS.md §F):
 *    1. Pre-filter the same-body+etype pool to peers sharing the query's EPA
 *       VClass size tier (e.g. "compact" vs "midsize" vs "micro") — real EPA
 *       data fetched per candidate peer, not guessed. Falls back to the full
 *       body+etype pool if no peer shares the tier (or its VClass couldn't be
 *       resolved).
 *    2. Tiebreak within that pool by distance in mpg_combined (kwh_per_100mi
 *       for ev) — the one comparable EPA-supplied efficiency metric, as a
 *       last-mile footprint stand-in among same-size-tier peers.
 *  Already-proxied seed vehicles (provenance !== "curated", e.g. Kia K4) are
 *  never eligible peers, to avoid chaining proxy-of-proxy uncertainty. */
import type { EType, Vehicle } from "@opencawr/core";
import { classifySizeTier, epaVehicleDetail, epaVehicleIdsForYear, type SizeTier } from "./epa.js";

export interface ProxyQuery {
  body: string;
  etype: EType;
  mpg_combined: number | null;
  kwh_per_100mi: number | null;
  sizeTier: SizeTier;
}

/** Seed `name`/`make` don't always form a valid EPA make/model query string
 *  (title-casing quirks, "VW" vs "Volkswagen", trim-name suffixes). Explicit
 *  overrides for the cases known not to parse naively; everything else falls
 *  through to the generic guess in peerEpaQuery(). JUDGMENT. */
const EPA_MODEL_HINTS: Record<string, { make: string; model: string }> = {
  "VW Passat": { make: "Volkswagen", model: "Passat" },
  "VW GTI": { make: "Volkswagen", model: "GTI" },
  "Mini Cooper": { make: "MINI", model: "Cooper Hardtop 2 Door" },
};

function peerEpaQuery(peer: Vehicle): { make: string; model: string } {
  const hint = EPA_MODEL_HINTS[peer.name];
  if (hint) return hint;
  const make = peer.make.charAt(0).toUpperCase() + peer.make.slice(1);
  const model = peer.name.replace(new RegExp(`^${peer.make}\\s*`, "i"), "").trim() || peer.name;
  return { make, model };
}

/** Real EPA VClass for a seed peer, at its own `pinned_buy_year_est`. Never
 *  throws: any lookup failure (no EPA data under the guessed name, offline
 *  with no fixture, network error) means "unknown" — the peer then only
 *  participates in the broad-body-bucket fallback, never a false size match. */
async function peerSizeTier(peer: Vehicle): Promise<SizeTier> {
  try {
    const { make, model } = peerEpaQuery(peer);
    const ids = await epaVehicleIdsForYear(make, model, peer.pinned_buy_year_est);
    if (ids.length === 0) return "unknown";
    const detail = await epaVehicleDetail(ids[0]!);
    return classifySizeTier(detail.VClass);
  } catch {
    return "unknown";
  }
}

export async function pickProxyPeer(peers: Vehicle[], query: ProxyQuery): Promise<Vehicle> {
  const pool = peers.filter(
    (p) => p.body === query.body && p.etype === query.etype && p.provenance === "curated",
  );
  if (pool.length === 0) {
    throw new Error(`No segment-peer in seed data for body="${query.body}" etype="${query.etype}"`);
  }

  const tiers = await Promise.all(pool.map(peerSizeTier));
  const sizeMatched = pool.filter((_, i) => tiers[i] === query.sizeTier);
  const candidates = sizeMatched.length > 0 ? sizeMatched : pool;

  const metricOf = (v: number | null): number => v ?? 0;
  const queryMetric =
    query.etype === "ev" ? metricOf(query.kwh_per_100mi) : metricOf(query.mpg_combined);

  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const peer of candidates) {
    const peerMetric =
      query.etype === "ev" ? metricOf(peer.specs.kwh_per_100mi) : metricOf(peer.specs.mpg_combined);
    const dist = Math.abs(peerMetric - queryMetric);
    if (dist < bestDist) {
      bestDist = dist;
      best = peer;
    }
  }
  return best;
}
