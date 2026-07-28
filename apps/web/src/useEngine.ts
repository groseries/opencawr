import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineInputs } from "@opencawr/core";
import type { EngineResponse, RankedRow } from "./engine.worker.js";

/** Runs the whole 71-car field through the engine in a worker on every input change. */
export function useEngine(inputs: EngineInputs) {
  const worker = useMemo(
    () => new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" }),
    [],
  );
  const [byP50, setByP50] = useState<RankedRow[] | null>(null);
  const [byP75, setByP75] = useState<RankedRow[] | null>(null);
  const [ms, setMs] = useState(0);
  const [computing, setComputing] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      if (e.data.id !== reqId.current) return; // stale
      setByP50(e.data.byP50);
      setByP75(e.data.byP75);
      setMs(e.data.ms);
      setComputing(false);
    };
    return () => worker.terminate();
  }, [worker]);

  useEffect(() => {
    setComputing(true);
    const id = ++reqId.current;
    const t = setTimeout(() => worker.postMessage({ id, inputs }), 60);
    return () => clearTimeout(t);
  }, [worker, inputs]);

  return { byP50, byP75, ms, computing };
}
