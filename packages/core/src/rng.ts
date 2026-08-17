/**
 * Deterministic, seedable PRNG. Same seed → bit-identical stream on every platform,
 * which is the engine's refactor-drift guardrail (spec §8).
 */

/** FNV-1a 32-bit string hash, for deriving per-vehicle/per-component substream seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** MurmurHash3 32-bit finalizer — spreads nearby integers to distant seeds. */
export function mixInt(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  /** This stream's own seed, kept so `reseedDraw` can re-derive from it. */
  private readonly base: number;
  private s!: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.base = seed >>> 0;
    this.reseed(this.base);
  }

  /**
   * Restart the stream at `seed`. Clears the Box–Muller spare: a cached normal left
   * over from the previous position would otherwise leak across the restart and make
   * the new stream depend on how the old one ended — exactly the coupling reseeding
   * exists to remove.
   */
  reseed(seed: number): void {
    this.s = seed >>> 0;
    this.spare = null;
    // Burn a few: `mixInt` already spreads the seed, but mulberry32's state is a plain
    // counter and its first output from a raw seed is its weakest.
    for (let i = 0; i < 4; i++) this.next();
  }

  /**
   * Restart this stream at its position for one Monte Carlo draw (R16, ROADMAP.md).
   * Draw `i` must start from the same state no matter what any earlier draw consumed,
   * which is what lets two runs of the same vehicle at different buy points share
   * their randomness draw-for-draw.
   *
   * Takes `mixInt(drawIndex)` rather than the index so one hash serves every substream
   * of a draw instead of each recomputing it. The second mix is what stops streams
   * whose seeds differ by a small constant from aliasing onto each other once the
   * draw index exceeds that constant.
   */
  reseedDraw(mixedIndex: number): void {
    this.reseed(mixInt(this.base ^ mixedIndex));
  }

  /** mulberry32 — uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal via Box–Muller (cached spare). */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Poisson via Knuth (fine for the small λ this model uses). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}
