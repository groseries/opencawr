/** Lazily-created singleton worker shared by useEngine/useDealEngine/useSurveyEngine.
 * DealAnalyzer and CarDrawer are always mounted (just hidden), so without this each
 * hook would spin up its own OS thread and re-parse opencawr_data.json on load.
 * Never terminated on a hook's unmount — it's shared for the app's lifetime; each
 * hook only adds/removes its own `message` listener. */
let sharedWorker: Worker | null = null;

export function getSharedWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  }
  return sharedWorker;
}
