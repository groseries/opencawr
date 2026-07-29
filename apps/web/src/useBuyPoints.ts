import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { BuyPointsResponse, EngineWorkerResponse } from "./engine.worker.js";
import { getSharedWorker } from "./sharedWorker.js";

/** Debounce for the buy-point sweep request — longer than rank's 60ms
 * (ASSUMPTIONS.md §I) because the sweep's grid search is several times the
 * cost of a rank pass; coupling it to rank's fast debounce made re-ranking
 * feel laggy on every slider drag (R4 review fixup). Rank stays live at 60ms;
 * this fills in idealOdo/idealYear/upperOdo a bit after. */
const BUYPOINTS_DEBOUNCE_MS = 300;

/** Runs the buy-point sweep for the whole field, over the shared worker,
 * decoupled from `useEngine`'s rank request so the rank response stays live
 * on every input change. Rows should treat `computing: true` as "no ideal/
 * upper mileage yet for the current inputs" rather than showing a stale
 * value from the previous input state. */
export function useBuyPoints(inputs: EngineInputs) {
  const worker = useMemo(() => getSharedWorker(), []);
  const [points, setPoints] = useState<BuyPointsResponse["points"] | null>(null);
  const [computing, setComputing] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent<EngineWorkerResponse>) => {
      if (e.data.kind !== "buypoints" || e.data.id !== reqId.current) return; // not ours, or stale
      setPoints(e.data.points);
      setComputing(false);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [worker]);

  useEffect(() => {
    setComputing(true);
    const id = ++reqId.current;
    const t = setTimeout(
      () => worker.postMessage({ kind: "buypoints", id, inputs }),
      BUYPOINTS_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [worker, inputs]);

  return { points, computing };
}
