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
 *   const { runs, start } = useAgentStream()
 *   const run = runs[variantId] ?? IDLE_RUN      // this variant's own trace and result
 *   <button onClick={() => start(variantId)}>Analyze</button>
 *
 * Each variant has its own Run, so switching variants never shows another variant's
 * result, and going back to an analyzed variant shows its result without a new LLM run.
 * A run keeps going if the user looks at another variant meanwhile.
 * (In-memory only: a page reload forgets everything. Step 5 stores annotations on the
 * backend so they survive reloads.)
 *
 * Each start() opens an EventSource on /api/variants/{id}/analyze (proxied by Vite to
 * FastAPI). An EventSource is ALWAYS closed on "done", on "error", on a new start()
 * for the same variant, and on unmount. Otherwise the browser auto-reconnects when the
 * server ends the stream, which restarts the agent in a loop and pays for LLM calls
 * nobody asked for. Closing it early also lets the backend cancel the run (see main.py).
 */
export function useAgentStream() {
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

  const start = useCallback(
    (id: string) => {
      close(id); // re-analyzing must not leave the previous run of this variant open
      setRuns((prev) => ({ ...prev, [id]: { ...IDLE_RUN, status: "running" } }));

      const source = new EventSource(`/api/variants/${id}/analyze`);
      sourcesRef.current.set(id, source);

      // Each SSE "data: {...}" line arrives as one message event.
      source.onmessage = (msg: MessageEvent<string>) => {
        const event = JSON.parse(msg.data) as AgentEvent;
        updateRun(id, (run) => ({ events: [...run.events, event] }));

        if (event.type === "annotation") updateRun(id, () => ({ annotation: event.annotation }));
        if (event.type === "done") {
          updateRun(id, () => ({ status: "done" }));
          close(id);
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

  return { runs, start };
}
