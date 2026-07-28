import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { EngineWorkerResponse, RankedRow } from "./engine.worker.js";
import { getSharedWorker } from "./sharedWorker.js";

/** Runs the whole 71-car field through the engine, over the shared worker, on every
 * input change. */
export function useEngine(inputs: EngineInputs) {
  const worker = useMemo(() => getSharedWorker(), []);
  const [byP50, setByP50] = useState<RankedRow[] | null>(null);
  const [byP75, setByP75] = useState<RankedRow[] | null>(null);
  const [ms, setMs] = useState(0);
  const [computing, setComputing] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent<EngineWorkerResponse>) => {
      if (e.data.kind !== "rank" || e.data.id !== reqId.current) return; // not ours, or stale
      setByP50(e.data.byP50);
      setByP75(e.data.byP75);
      setMs(e.data.ms);
      setComputing(false);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [worker]);

  useEffect(() => {
    setComputing(true);
    const id = ++reqId.current;
    const t = setTimeout(() => worker.postMessage({ kind: "rank", id, inputs }), 60);
    return () => clearTimeout(t);
  }, [worker, inputs]);

  return { byP50, byP75, ms, computing };
}
