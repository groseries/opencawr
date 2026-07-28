/** Segment-peer proxy fallback: everything EPA/NHTSA can't supply (price
 *  curve, EOL, maintenance curve, tiers, seats/cargo/insurance, battery) is
 *  copied from the closest seed vehicle sharing body + etype.
 *
 *  "Closest footprint" (brief's words) would ideally be real vehicle
 *  footprint (track width x wheelbase, the CAFE regulatory term), but that
 *  isn't exposed by the free/keyless EPA or NHTSA endpoints this pipeline
 *  uses. JUDGMENT: within the same body+etype pool we use distance in the
 *  one comparable EPA-supplied efficiency metric (mpg_combined for
 *  gas/hybrid/phev, kwh_per_100mi for ev) as a footprint stand-in — bigger
 *  vehicles are reliably less efficient within a body class. Documented in
 *  ASSUMPTIONS.md. */
import type { EType, Vehicle } from "@opencawr/core";

export interface ProxyQuery {
  body: string;
  etype: EType;
  mpg_combined: number | null;
  kwh_per_100mi: number | null;
}

export function pickProxyPeer(peers: Vehicle[], query: ProxyQuery): Vehicle {
  const pool = peers.filter((p) => p.body === query.body && p.etype === query.etype);
  if (pool.length === 0) {
    throw new Error(`No segment-peer in seed data for body="${query.body}" etype="${query.etype}"`);
  }
  const metricOf = (v: number | null): number => v ?? 0;
  const queryMetric =
    query.etype === "ev" ? metricOf(query.kwh_per_100mi) : metricOf(query.mpg_combined);

  let best = pool[0]!;
  let bestDist = Infinity;
  for (const peer of pool) {
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
