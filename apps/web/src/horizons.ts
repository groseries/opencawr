/** The rail's holding-period presets, in their own React-free module so the
 *  engine worker can reuse them without pulling React into the worker bundle.
 *  `controls.tsx` re-exports this as its public name; the worker's model-year
 *  per-hold summary reads it directly, so the holds it reports are always
 *  exactly the holds the user can pick. */
export const HORIZONS: { label: string; value: number | "eol" }[] = [
  { label: "50k", value: 50_000 },
  { label: "100k", value: 100_000 },
  { label: "150k", value: 150_000 },
  { label: "until it dies", value: "eol" },
];
