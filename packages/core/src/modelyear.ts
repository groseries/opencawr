import { buyPointSweep } from "./buypoint.js";
import type {
  BuyPointSweepOpts,
  BuyPointSweepPoint,
  BuyPointSweepResult,
  SweepInputs,
} from "./buypoint.js";
import { rankWithTiers } from "./tiers.js";
import type { RankableCar } from "./tiers.js";
import type { Constants, Vehicle } from "./types.js";

/**
 * Model-year ranking (R2, unified with the buy-point sweep 2026-07-30): a VIEW
 * of `buyPointSweep`'s own grid, grouped by each grid point's implied model
 * year. It runs no optimization of its own and does not call `costPerMile` at
 * all — every number here is a point the sweep already priced.
 *
 * Why it changed. Until 2026-07-30 this priced each model year once, at its
 * CANONICAL odometer `(nowYear - year) * annualMiles`, which made it a second,
 * independently-sampled minimization of the same cost-vs-odometer curve. The
 * two answers then disagreed on the best year for 22 of the 71 seed vehicles —
 * almost all trivially (16 under 1.2% |Δ$/mi|), because both minimize the SAME
 * curve but sampled it on different grids (10,000-mile steps vs one point per
 * ~13,000-mile model year), so on a flat-bottomed curve they landed in
 * different year buckets. Owner's decision, 2026-07-30: *"We are trying to
 * determine the best year AND mileage to buy at - the true sweetspot. So it
 * should be one. The user should then be able to use our details panel to see
 * the breakdown of each layer and determine a local optimum for themselves."*
 *
 * So each row is that model year's own LOCAL optimum: the cheapest grid point
 * whose implied year (`deriveBuyYear`, reused not re-derived) is that year —
 * its odometer AND its $/mi. Because the rank-1 row is by construction the
 * cheapest point of the whole grid, it IS the sweep's `idealYear`/`idealOdo`,
 * identically, not merely close.
 *
 * The 2026-07-29 objection to grouping the grid this way — that a band's
 * cheapest point sits at the band edge, "borrowing cheapness" from the adjacent
 * newer year, degenerating toward "newest year always wins" (the R8 artifact) —
 * was measured before this shipped and did not hold. Across 71 vehicles x
 * 50k/100k/150k holds (2,415 year-bands) on the 2,500-mile grid: 44.5% of band
 * optima sit at the band's low edge, 45.1% at its HIGH edge, 10.2% strictly
 * inside. That near-symmetry is what a U-shaped curve produces (bands below the
 * sweet spot bottom out at their high edge, bands above it at their low edge) —
 * not a slide toward newness: the winning year is the newest feasible one for
 * only 5/6/14 of 71 cars at the three holds, against 3/4/9 under the old
 * canonical-odometer method. Nor is the ranking merely a restatement of "how
 * close is this year to the sweet spot": pure |year - bestYear| proximity
 * reproduces the order for only 12-20 of 71 cars, so year-specific inputs
 * (`model_year_reliability`, where the price curve sits, the reliability tier)
 * still move it. See ASSUMPTIONS.md §B.
 *
 * Requires a numeric `holdMiles`, same as `buyPointSweep` and for the same
 * reason (R10): every year's price must share one holding horizon to be
 * comparable.
 *
 * Ordering alone was not honest enough (R15, 2026-07-30): model years of one car
 * routinely sit a few hundredths of a percent apart, and the panel was reporting
 * a "cheapest year, 0.0% cheaper than" the runner-up. Each row therefore also
 * carries a `tier` from `rankWithTiers` — the SAME tie-tier walk the Rankings
 * table applies to whole cars, on the same `beatProb` and the same
 * `CALIBRATION.tieTierBeatProb`, with no threshold of this view's own. The tiers
 * are layered on top of the existing order: rank 1 is still the sweep's sweet
 * spot, it is simply no longer presented as a finding when other years share its
 * tier. The `degenerate` case the panel already refused (every year clamped onto
 * one point) is the limiting case of a tie tier — identical draws, so every year
 * lands in tier 1.
 */
export interface ModelYearRankPoint {
  year: number;
  /** The cheapest odometer for this model year: the argmin of P50 over the grid
   *  points falling inside this year's own odometer band. Half of the answer —
   *  "best year AND mileage" — not a nominal mileage. Ties inside a band resolve
   *  to the lowest odometer, matching `buyPointSweep`'s own tie-break. */
  odo: number;
  /** True when NO grid point falls inside this year's band, so the year could
   *  not be priced at any mileage of its own: its whole band sits outside the
   *  feasible sweep range (production window, R11 curve floor, eol cap) and the
   *  figures shown are the nearest feasible odometer instead. Not a like-for-like
   *  comparison against the unclamped rows — the UI marks these with `*`.
   *  A band merely TRUNCATED by the feasible range is not clamped: its optimum
   *  is still a real odometer for a car of that year. Note `deriveBuyYear`
   *  clamps into the production window, so the first and last model years'
   *  bands absorb every odometer past the window's edges and are correspondingly
   *  rarely flagged — that clamping is deliberate and shared with the Rankings
   *  row's `idealYear`, which is what keeps the two answers identical. */
  clamped: boolean;
  p50: number;
  /** 1 = cheapest year. Ties broken by odometer ascending, then unclamped rows
   *  ahead of clamped ones — deliberately, so that when years tie at the grid's
   *  minimum the rank-1 row is the same point `buyPointSweep` reports as
   *  `idealOdo`/`idealYear` (it also resolves ties to the lowest odometer). */
  rank: number;
  /** Statistical tie tier (1 = cheapest tier), from the same `rankWithTiers`
   *  walk the Rankings table uses on whole cars (spec §2, R15): years in one
   *  tier are statistically indistinguishable and must not be presented in an
   *  order. Layered ON TOP of `rank` — it never changes which row ranks 1, only
   *  whether that row is a finding. `null` only when the row's draws weren't
   *  retained, which cannot happen for an unclamped row (see
   *  `BuyPointSweepOpts.keepRowDraws`) and did not happen for any of the 234
   *  clamped rows across the seed field x 50k/100k/150k. */
  tier: number | null;
  /** P(this year is cheaper than the NEXT-ranked year), over paired draws;
   *  `null` for the last row (and for a row with no retained draws). This is the
   *  number the tie tier is cut on, exposed so the panel can quantify a claim it
   *  does make rather than only suppress ones it can't. */
  beatsNextProb: number | null;
}

export interface ModelYearRankResult {
  /** One entry per feasible model year (`vehicle.first_year`..`last_year`),
   *  sorted by year ascending. */
  points: ModelYearRankPoint[];
  /** The sweet spot — identical to the sweep's `idealYear`/`idealOdo`/`idealP50`
   *  by construction, since rank 1 is the cheapest point of that same grid. */
  bestYear: number;
  bestOdo: number;
  bestP50: number;
}

export function modelYearRank(
  vehicle: Vehicle,
  constants: Constants,
  inputs: SweepInputs,
  opts: BuyPointSweepOpts = {},
): ModelYearRankResult {
  // Runtime backstop, matching buyPointSweep's (R10): the type signature is
  // the primary gate, this guards untyped/`any` callers. The sweep below would
  // refuse too, but keeping the check here states the refusal where the caller
  // is looking.
  if ((inputs.holdMiles as unknown) === "eol") {
    throw new TypeError(
      'modelYearRank requires a numeric holdMiles; "eol" is not comparable across model years (R10, ASSUMPTIONS.md §B)',
    );
  }
  const am = inputs.annualMiles ?? constants.annual_miles;
  // `keepRowDraws` is what makes the tie tiers possible without a second pricing
  // pass: the sweep hands back the draws it already computed for the points this
  // view reports (year-band winners + the two grid ends), and nothing else.
  const sweep = buyPointSweep(vehicle, constants, inputs, { ...opts, keepRowDraws: true });
  return modelYearViewOf(vehicle, sweep, am, constants.now_year);
}

/**
 * The grouping itself, split out so the "one optimization" claim is checkable:
 * everything below reads `sweep.grid` and prices nothing.
 */
function modelYearViewOf(
  vehicle: Vehicle,
  sweep: BuyPointSweepResult,
  annualMiles: number,
  nowYear: number,
): ModelYearRankResult {
  const grid = sweep.grid;

  // Cheapest grid point per implied year. `<` (not `<=`) keeps the lowest
  // odometer among ties — the same rule buyPointSweep uses for `idealOdo`.
  const bandBest = new Map<number, BuyPointSweepPoint>();
  for (const p of grid) {
    const cur = bandBest.get(p.year);
    if (cur === undefined || p.p50 < cur.p50) bandBest.set(p.year, p);
  }

  const priced: Array<{ year: number; point: BuyPointSweepPoint; clamped: boolean }> = [];
  for (let year = vehicle.first_year; year <= vehicle.last_year; year++) {
    const own = bandBest.get(year);
    if (own) {
      priced.push({ year, point: own, clamped: false });
      continue;
    }
    // No point of this year's own band is feasible. Fall back to the grid point
    // nearest the year's canonical odometer — the exact inverse of
    // `impliedModelYear` with no rounding, the same anchor the pre-unification
    // ranking used. Staying ON the grid matters: an off-grid price could undercut
    // the sweep's own minimum and make the panel contradict the headline.
    const canonicalOdo = (nowYear - year) * annualMiles;
    let nearest = grid[0]!;
    for (const p of grid) {
      if (Math.abs(p.odo - canonicalOdo) < Math.abs(nearest.odo - canonicalOdo)) nearest = p;
    }
    priced.push({ year, point: nearest, clamped: true });
  }

  // p50, then odometer, then unclamped-before-clamped. The last key is what
  // keeps rank 1 equal to the sweep's `idealYear` when several years share one
  // point: the cheapest point always sits inside its OWN year's band (that row
  // is unclamped), while the years borrowing it are clamped. Without it a
  // single-point grid (the Porsche 996 case) would rank the oldest borrowing
  // year first and contradict the headline.
  const byRank = [...priced].sort(
    (a, b) =>
      a.point.p50 - b.point.p50 ||
      a.point.odo - b.point.odo ||
      Number(a.clamped) - Number(b.clamped),
  );
  const rankOf = new Map(byRank.map((p, i) => [p.year, i + 1]));

  // Tie tiers over those same rows, in that same order (R15). `rankWithTiers`
  // sorts by p50, which `byRank` is already sorted by, and Array#sort is stable
  // — so the tier walk sees the rows in exactly the ranked order above and
  // cannot re-order them. It only annotates.
  const rankable: RankableCar[] = [];
  for (const p of byRank) {
    const drawsCpm = sweep.rowDraws?.get(p.point.odo);
    if (drawsCpm) rankable.push({ id: String(p.year), p50: p.point.p50, drawsCpm });
  }
  const tiered = new Map(rankWithTiers(rankable).map((t) => [Number(t.id), t]));

  const points: ModelYearRankPoint[] = priced.map((p) => ({
    year: p.year,
    odo: p.point.odo,
    clamped: p.clamped,
    p50: p.point.p50,
    rank: rankOf.get(p.year)!,
    tier: tiered.get(p.year)?.tier ?? null,
    beatsNextProb: tiered.get(p.year)?.beatsNextProb ?? null,
  }));

  const best = byRank[0]!;
  return { points, bestYear: best.year, bestOdo: best.point.odo, bestP50: best.point.p50 };
}
