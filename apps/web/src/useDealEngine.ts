import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { DealInput, DealResponse, EngineWorkerResponse } from "./engine.worker.js";
import { getSharedWorker } from "./sharedWorker.js";

/** Scores one real-world listing (Deal Analyzer) over the shared worker, on every change. */
export function useDealEngine(inputs: EngineInputs, deal: DealInput | null) {
  const worker = useMemo(() => getSharedWorker(), []);
  const [result, setResult] = useState<DealResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent<EngineWorkerResponse>) => {
      if (e.data.kind !== "deal" || e.data.id !== reqId.current) return; // not ours, or stale
      setResult(e.data);
      setComputing(false);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [worker]);

  useEffect(() => {
    if (!deal) return;
    setComputing(true);
    const id = ++reqId.current;
    const t = setTimeout(() => worker.postMessage({ kind: "deal", id, inputs, deal }), 60);
    return () => clearTimeout(t);
  }, [worker, inputs, deal]);

  return { result, computing };
}
