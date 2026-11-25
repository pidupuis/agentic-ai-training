import { useCallback, useEffect, useRef, useState } from "react"

import type { AgentEvent, Annotation } from "@/types"

export type StreamStatus = "idle" | "running" | "done" | "error"

/**
 * Runs the agent on a variant and exposes its live trace.
 *
 * Usage:
 *   const { events, annotation, status, error, start } = useAgentStream()
 *   <button onClick={() => start("braf-v600e")}>Analyze</button>
 *
 * Opens an EventSource on /api/variants/{id}/analyze (proxied by Vite to FastAPI),
 * appends every event to `events`, and stores the annotation apart.
 *
 * The EventSource is ALWAYS closed on "done", on "error", on a new start() and on
 * unmount. Otherwise the browser auto-reconnects when the server ends the stream,
 * which restarts the agent in a loop and pays for LLM calls nobody asked for.
 * Closing it early also lets the backend cancel the run (see main.py).
 */
export function useAgentStream() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [annotation, setAnnotation] = useState<Annotation | null>(null)
  const [status, setStatus] = useState<StreamStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  // A ref, not state: changing it must not re-render, and it must survive renders.
  const sourceRef = useRef<EventSource | null>(null)

  const close = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const start = useCallback(
    (variantId: string) => {
      close() // a second click must not leave a first agent running
      setEvents([])
      setAnnotation(null)
      setError(null)
      setStatus("running")

      const source = new EventSource(`/api/variants/${variantId}/analyze`)
      sourceRef.current = source

      // Each SSE "data: {...}" line arrives as one message event.
      source.onmessage = (msg: MessageEvent<string>) => {
        const event = JSON.parse(msg.data) as AgentEvent
        // Functional update: always appends to the latest array, even when
        // several events arrive before React re-renders.
        setEvents((prev) => [...prev, event])

        if (event.type === "annotation") setAnnotation(event.annotation)
        if (event.type === "done") {
          setStatus("done")
          close()
        }
        if (event.type === "error") {
          setError(event.message)
          setStatus("error")
          close()
        }
      }

      // Network failure, server down, or 404/500 before the stream started.
      // (A normal end never gets here: "done" closed the source first.)
      source.onerror = () => {
        setError("Connection to the agent stream failed")
        setStatus("error")
        close()
      }
    },
    [close],
  )

  // Cleanup on unmount: leaving the page stops the stream (and the agent).
  useEffect(() => close, [close])

  return { events, annotation, status, error, start }
}