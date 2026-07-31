import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { EngineWorkerResponse, ModelYearRankResponse } from "./engine.worker.js";
import { getSharedWorker } from "./sharedWorker.js";

/** Runs the per-car drawer's model-year ranking (R2) over the shared worker,
 * whenever the selected car or the rail's assumptions change. `vehicleName:
 * null` means the drawer is closed — no request is sent. Mirrors
 * `useSurveyEngine`'s single-vehicle-debounced shape. */
export function useModelYearRank(inputs: EngineInputs, vehicleName: string | null) {
  const worker = useMemo(() => getSharedWorker(), []);
  const [result, setResult] = useState<ModelYearRankResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent<EngineWorkerResponse>) => {
      if (e.data.kind !== "modelyearrank" || e.data.id !== reqId.current) return; // not ours, or stale
      setResult(e.data);
      setComputing(false);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [worker]);

  useEffect(() => {
    if (!vehicleName) {
      setResult(null);
      return;
    }
    setComputing(true);
    const id = ++reqId.current;
    const t = setTimeout(
      () => worker.postMessage({ kind: "modelyearrank", id, inputs, vehicleName }),
      150,
    );
    return () => clearTimeout(t);
  }, [worker, inputs, vehicleName]);

  return { result, computing };
}
