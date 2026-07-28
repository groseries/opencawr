import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { DealInput, DealResponse } from "./engine.worker.js";

/** Scores one real-world listing (Deal Analyzer) in its own worker, on every change. */
export function useDealEngine(inputs: EngineInputs, deal: DealInput | null) {
  const worker = useMemo(
    () => new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" }),
    [],
  );
  const [result, setResult] = useState<DealResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    worker.onmessage = (e: MessageEvent<DealResponse>) => {
      if (e.data.id !== reqId.current) return; // stale
      setResult(e.data);
      setComputing(false);
    };
    return () => worker.terminate();
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
