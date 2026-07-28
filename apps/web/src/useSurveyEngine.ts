import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { SurveyResponse } from "./engine.worker.js";

/** Runs the per-car drawer's survey grid + breakdown + sensitivity sweeps in its
 * own worker, whenever the selected car or the rail's assumptions change.
 * `vehicleName: null` means the drawer is closed — no request is sent. */
export function useSurveyEngine(inputs: EngineInputs, vehicleName: string | null) {
  const worker = useMemo(
    () => new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" }),
    [],
  );
  const [result, setResult] = useState<SurveyResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    worker.onmessage = (e: MessageEvent<SurveyResponse>) => {
      if (e.data.id !== reqId.current) return; // stale
      setResult(e.data);
      setComputing(false);
    };
    return () => worker.terminate();
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
