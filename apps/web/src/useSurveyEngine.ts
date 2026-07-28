import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { EngineWorkerResponse, SurveyResponse } from "./engine.worker.js";
import { getSharedWorker } from "./sharedWorker.js";

/** Runs the per-car drawer's survey grid + breakdown + sensitivity sweeps over the
 * shared worker, whenever the selected car or the rail's assumptions change.
 * `vehicleName: null` means the drawer is closed — no request is sent. */
export function useSurveyEngine(inputs: EngineInputs, vehicleName: string | null) {
  const worker = useMemo(() => getSharedWorker(), []);
  const [result, setResult] = useState<SurveyResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent<EngineWorkerResponse>) => {
      if (e.data.kind !== "survey" || e.data.id !== reqId.current) return; // not ours, or stale
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
      () => worker.postMessage({ kind: "survey", id, inputs, vehicleName }),
      60,
    );
    return () => clearTimeout(t);
  }, [worker, inputs, vehicleName]);

  return { result, computing };
}
