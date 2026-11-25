"""HTTP API: the variant list and the live agent trace as Server-Sent Events (SSE).

Run from backend/:  uv run uvicorn app.main:app --reload --port 8000
Docs (generated):   http://localhost:8000/docs
Stream test:        curl -N localhost:8000/api/variants/braf-v600e/analyze

How a streamed analysis works (one request to /analyze):

    browser ──GET /analyze──▶ analyze()
                                 │ starts
                                 ▼
                       worker thread: run_agent(on_event=events.put, cancel=cancel)
                                 │ each step: events.put(event)
                                 ▼
                       events (queue.Queue)  ◀── thread-safe hand-off between the two
                                 │ await asyncio.to_thread(events.get)
                                 ▼
                       stream() async generator ──"data: {...}\\n\\n"──▶ browser

Why a thread: run_agent is blocking (several seconds of LLM and HTTP calls). Running it
in its own thread keeps the server free, and on_event pushes each event out immediately.

Why the cancel flag: if the browser disconnects (tab closed, second click, EventSource
closed), Starlette cancels stream(); its `finally` sets `cancel`, and the agent stops
before its next LLM call instead of finishing a run nobody will see.
"""

import asyncio
import json
import logging
import queue
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from app.agent import AgentCancelled, run_agent
from app.variants import VARIANTS, VARIANTS_BY_ID, Variant

# Show our own INFO logs (e.g. "braf-v600e: turn 2/8") in the uvicorn terminal.
# uvicorn configures only its own loggers; this sets up the root logger for app.*.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     [%(name)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Variant Copilot")

# Sentinel: a unique object that means "end of stream". It is compared with `is`
# (same object in memory), so no real event can ever be mistaken for it.
_DONE = object()


def _variant_dict(v: Variant) -> dict:
    """A Variant as JSON-ready dict.

    asdict() converts the dataclass fields; hgvs_g is a @property, not a field,
    so it is added by hand.

    Example output:
        {"id": "braf-v600e", "gene": "BRAF", "protein": "p.Val600Glu",
         "protein_short": "V600E", "chrom": "7", "pos": 140753336,
         "ref": "A", "alt": "T", "hgvs_g": "7:g.140753336A>T"}
    """
    return {**asdict(v), "hgvs_g": v.hgvs_g}


def _get_variant(variant_id: str) -> Variant:
    """The Variant for this id, or an HTTP 404 response.

    Raising HTTPException inside a route makes FastAPI answer with that status
    code and {"detail": "..."} as JSON body.
    """
    if variant_id not in VARIANTS_BY_ID:
        raise HTTPException(status_code=404, detail=f"Unknown variant: {variant_id}")
    return VARIANTS_BY_ID[variant_id]


@app.get("/api/variants")
def list_variants() -> list[dict]:
    """The demo variants (see _variant_dict). The last expert decision is added at step 5."""
    return [_variant_dict(v) for v in VARIANTS]


@app.get("/api/variants/{variant_id}/analyze")
def analyze(variant_id: str) -> StreamingResponse:
    """Run the agent on one variant and stream each event as it happens.

    `{variant_id}` in the path becomes the `variant_id` argument (FastAPI matches names).

    SSE format: each event is one line "data: <json>" followed by an empty line.
        data: {"type": "tool_call", "tool": "get_vep_annotation", "args": {...}, "ts": 1764...}

        data: {"type": "tool_result", "tool": "get_vep_annotation", "result": {...}, "ts": ...}

    Event types (same names in frontend/src/types.ts):
        tool_call, tool_result, annotation  -> emitted by run_agent (see its docstring)
        done                                -> the agent finished, always after "annotation"
        error {"message": ...}              -> the agent failed (AgentError, OpenAI error...)
    The stream always ends with exactly one "done" or "error".
    """
    variant = _get_variant(variant_id)  # 404 before the stream starts
    events: queue.Queue = queue.Queue()
    cancel = threading.Event()  # set by stream() when the client goes away

    def worker() -> None:
        """Runs in the background thread: the agent, then one closing event."""
        try:
            # events.put is passed itself (not called): run_agent calls it per event.
            run_agent(variant, on_event=events.put, cancel=cancel)
            events.put({"type": "done", "ts": time.time()})
        except AgentCancelled as e:
            log.info("%s", e)  # nobody is listening any more: log only
        except Exception as e:  # anything else is reported to the browser
            log.exception("%s: agent failed", variant.id)
            events.put({"type": "error", "message": str(e), "ts": time.time()})
        finally:
            # Always, whatever happened: unblocks stream() so it can finish.
            events.put(_DONE)

    # daemon=True: a still-running thread does not keep the server alive on shutdown.
    threading.Thread(target=worker, name=f"agent-{variant.id}", daemon=True).start()

    async def stream() -> AsyncIterator[str]:
        """Yield each queued event in SSE format until the worker is done.

        Async on purpose: on client disconnect, Starlette cancels this generator,
        which reliably runs the `finally` block. (A sync generator runs in a thread
        pool and is not guaranteed to be closed on disconnect.)
        """
        try:
            # events.get() blocks until an event arrives. Calling it directly in async
            # code would freeze the whole server; asyncio.to_thread runs it in a helper
            # thread and lets the server serve other requests meanwhile.
            # The walrus operator := assigns and tests in one expression.
            while (event := await asyncio.to_thread(events.get)) is not _DONE:
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # Runs on normal end (harmless: the agent is already done) and on disconnect
            # (stops the agent before its next LLM call).
            cancel.set()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",  # never store or replay the stream
            "X-Accel-Buffering": "no",  # ask reverse proxies not to buffer it
        },
    )
