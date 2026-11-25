import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentEvent, Annotation } from "@/types";

export type StreamStatus = "idle" | "running" | "done" | "error";

/** Everything known about one variant's analysis. */
export type Run = {
  events: AgentEvent[];
  annotation: Annotation | null;
  status: StreamStatus;
  error: string | null;
};

/** What a variant that was never analyzed in this session looks like. */
export const IDLE_RUN: Run = { events: [], annotation: null, status: "idle", error: null };

/**
 * Runs the agent and keeps one analysis per variant, in memory.
 *
 * Usage:
 *   const { runs, start, load } = useAgentStream({ onDone: (id) => refresh(id) })
 *   const run = runs[variantId] ?? IDLE_RUN      // this variant's own trace and result
 *   <button onClick={() => start(variantId)}>Analyze</button>
 *   <button onClick={() => start(variantId, { replay: true })}>Replay</button>  // free
 *   load(variantId, savedRun.events)             // show a saved run, no stream at all
 *
 * Each variant has its own Run, so switching variants never shows another variant's
 * result, and going back to an analyzed variant shows its result without a new LLM run.
 * A run keeps going if the user looks at another variant meanwhile.
 * Runs live in memory; the backend saves each successful run, and the page reloads
 * saved runs at startup with load().
 *
 * Each start() opens an EventSource on /api/variants/{id}/analyze (proxied by Vite to
 * FastAPI). An EventSource is ALWAYS closed on "done", on "error", on a new start()
 * for the same variant, and on unmount. Otherwise the browser auto-reconnects when the
 * server ends the stream, which restarts the agent in a loop and pays for LLM calls
 * nobody asked for. Closing it early also lets the backend cancel the run (see main.py).
 */
export function useAgentStream({ onDone }: { onDone?: (id: string) => void } = {}) {
  // Kept in a ref so the latest callback is used without recreating start().
  // Updated in an effect: React forbids writing refs during render.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // One Run per variant id. Record<K, V> is a plain object used as a map.
  const [runs, setRuns] = useState<Record<string, Run>>({});

  // Open connections, one per variant at most. A ref, not state: changing it must not
  // re-render, and it must survive renders.
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  /** Merge `patch` into one variant's Run, keeping every other variant untouched. */
  const updateRun = useCallback((id: string, patch: (run: Run) => Partial<Run>) => {
    // Functional update: always starts from the latest state, even when several
    // events arrive before React re-renders.
    setRuns((prev) => {
      const run = prev[id] ?? IDLE_RUN;
      return { ...prev, [id]: { ...run, ...patch(run) } };
    });
  }, []);

  const close = useCallback((id: string) => {
    sourcesRef.current.get(id)?.close();
    sourcesRef.current.delete(id);
  }, []);

  /**
   * Show a saved run as finished, without any stream or LLM call.
   * Used at page load with the events from GET /api/variants/{id}/run.
   * Does nothing if a live run of this variant is already in progress.
   */
  const load = useCallback((id: string, events: AgentEvent[]) => {
    // findLast + type guard: TypeScript then knows `found` is an annotation event.
    const found = events.findLast(
      (e): e is Extract<AgentEvent, { type: "annotation" }> => e.type === "annotation",
    );
    setRuns((prev) =>
      prev[id]?.status === "running"
        ? prev
        : {
            ...prev,
            [id]: { events, annotation: found?.annotation ?? null, status: "done", error: null },
          },
    );
  }, []);

  /**
   * Analyze a variant, streaming its events live.
   *
   * replay=false: a real agent run (LLM calls, costs a few cents), saved on success.
   * replay=true:  the saved run streamed again with its original timing: no LLM call,
   *               no cost. Same events, same UI: useful to work on the design or demo.
   */
  const start = useCallback(
    (id: string, { replay = false }: { replay?: boolean } = {}) => {
      close(id); // re-analyzing must not leave the previous run of this variant open
      setRuns((prev) => ({ ...prev, [id]: { ...IDLE_RUN, status: "running" } }));

      const source = new EventSource(`/api/variants/${id}/analyze${replay ? "?replay=true" : ""}`);
      sourcesRef.current.set(id, source);

      // Each SSE "data: {...}" line arrives as one message event.
      source.onmessage = (msg: MessageEvent<string>) => {
        const event = JSON.parse(msg.data) as AgentEvent;
        updateRun(id, (run) => ({ events: [...run.events, event] }));

        if (event.type === "annotation") updateRun(id, () => ({ annotation: event.annotation }));
        if (event.type === "done") {
          updateRun(id, () => ({ status: "done" }));
          close(id);
          onDoneRef.current?.(id); // e.g. let the page reload what the backend just saved
        }
        if (event.type === "error") {
          updateRun(id, () => ({ status: "error", error: event.message }));
          close(id);
        }
      };

      // Network failure, server down, or 404/500 before the stream started.
      // (A normal end never gets here: "done" closed the source first.)
      source.onerror = () => {
        updateRun(id, () => ({ status: "error", error: "Connection to the agent stream failed" }));
        close(id);
      };
    },
    [close, updateRun],
  );

  // Cleanup on unmount: leaving the page closes every stream (and cancels the agents).
  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      sources.forEach((s) => s.close());
      sources.clear();
    };
  }, []);

  return { runs, start, load };
}
