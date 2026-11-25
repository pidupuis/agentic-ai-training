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

Saved runs (app/runs.py): every successful analysis is saved with all its events.
    GET /api/variants/{id}/run                -> the saved run, as JSON (no LLM call)
    GET /api/variants/{id}/analyze?replay=true -> the saved run streamed again, with its
                                                  original timing (no LLM call, no network)

Expert review (app/store.py): the expert accepts, corrects or rejects the saved run.
    POST /api/variants/{id}/review  -> appends one decision to the audit trail
    GET  /api/audit                 -> every decision, newest first, plus the agreement rate
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
from app.llm import get_model
from app.models import Annotation, Review, ReviewRequest
from app.runs import load_run, save_run
from app.store import append_review, latest_review, list_reviews
from app.variants import VARIANTS, VARIANTS_BY_ID, Variant

# Show our own INFO logs (e.g. "braf-v600e: turn 2/8") in the uvicorn terminal.
# uvicorn configures only its own loggers; this sets up the root logger for app.*.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     [%(name)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Variant Copilot")

# Sentinel: a unique object that means "end of stream". It is compared with `is`
# (same object in memory), so no real event can ever be mistaken for it.
_DONE = object()

# Replay: longest pause between two events, in seconds. Real gaps include LLM thinking
# time (sometimes 5-10 s); capping them keeps a replay lively.
REPLAY_MAX_GAP = 2.0

SSE_HEADERS = {
    "Cache-Control": "no-cache",  # never store or replay the stream
    "X-Accel-Buffering": "no",  # ask reverse proxies not to buffer it
}


def _sse(event: dict) -> str:
    """One event in SSE format: a "data: <json>" line, then an empty line."""
    return f"data: {json.dumps(event)}\n\n"


def _variant_dict(v: Variant) -> dict:
    """A Variant as JSON-ready dict, plus its saved run status and its last expert decision.

    asdict() converts the dataclass fields; hgvs_g is a @property, not a field,
    so it is added by hand.

    Example output:
        {"id": "braf-v600e", "gene": "BRAF", "protein": "p.Val600Glu",
         "protein_short": "V600E", "chrom": "7", "pos": 140753336,
         "ref": "A", "alt": "T", "hgvs_g": "7:g.140753336A>T", "has_saved_run": true,
         "latest_review": {<Review as dict>} or null}
    """
    review = latest_review(v.id)
    return {
        **asdict(v),
        "hgvs_g": v.hgvs_g,
        "has_saved_run": load_run(v.id) is not None,
        # mode="json": datetimes become ISO strings, like in the HTTP response.
        "latest_review": review.model_dump(mode="json") if review else None,
    }


def _get_saved_run(variant_id: str) -> dict:
    """The saved run of this variant, or an HTTP 404 response."""
    run = load_run(variant_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No saved run for {variant_id}")
    return run


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
    """The demo variants, with their saved run status and last expert decision."""
    return [_variant_dict(v) for v in VARIANTS]


@app.get("/api/variants/{variant_id}/run")
def get_saved_run(variant_id: str) -> dict:
    """The last successful analysis of this variant, as saved by /analyze (see app/runs.py).

    Lets the page show a variant's trace and annotation right away, without an LLM call.
    404 if the variant is unknown or was never analyzed.
    """
    _get_variant(variant_id)
    return _get_saved_run(variant_id)


@app.get("/api/variants/{variant_id}/analyze")
def analyze(variant_id: str, replay: bool = False) -> StreamingResponse:
    """Run the agent on one variant and stream each event as it happens.

    `{variant_id}` in the path becomes the `variant_id` argument (FastAPI matches names);
    `replay` is a query parameter: /analyze?replay=true (FastAPI converts "true" to True).

    SSE format: each event is one line "data: <json>" followed by an empty line.
        data: {"type": "tool_call", "tool": "get_vep_annotation", "args": {...}, "ts": 1764...}

        data: {"type": "tool_result", "tool": "get_vep_annotation", "result": {...}, "ts": ...}

    Event types (same names in frontend/src/types.ts):
        tool_call, tool_result, annotation  -> emitted by run_agent (see its docstring)
        done                                -> the agent finished, always after "annotation"
        error {"message": ...}              -> the agent failed (AgentError, OpenAI error...)
    The stream always ends with exactly one "done" or "error".

    replay=true: no agent, no LLM call. The saved run is streamed again (see _replay).
    A live run that succeeds is saved, replacing the previous saved run of this variant.
    """
    variant = _get_variant(variant_id)  # 404 before the stream starts
    if replay:
        return StreamingResponse(
            _replay(_get_saved_run(variant_id)), headers=SSE_HEADERS, media_type="text/event-stream"
        )

    events: queue.Queue = queue.Queue()
    cancel = threading.Event()  # set by stream() when the client goes away

    def worker() -> None:
        """Runs in the background thread: the agent, then one closing event."""
        recorded: list[dict] = []  # every event of this run, to save it at the end

        def on_event(event: dict) -> None:
            recorded.append(event)
            events.put(event)  # to the browser, right away

        try:
            run_agent(variant, on_event=on_event, cancel=cancel)
            # Saved before "done" is sent: when the browser sees "done", the run is on disk.
            save_run(variant.id, get_model(), recorded)
            events.put({"type": "done", "ts": time.time()})
        except AgentCancelled as e:
            log.info("%s", e)  # nobody is listening any more: log only, save nothing
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
                yield _sse(event)
        finally:
            # Runs on normal end (harmless: the agent is already done) and on disconnect
            # (stops the agent before its next LLM call).
            cancel.set()

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


async def _replay(run: dict) -> AsyncIterator[str]:
    """Stream a saved run again, with its original pauses (capped at REPLAY_MAX_GAP).

    Timestamps are shifted to "now", keeping the original gaps: the durations shown
    in the trace stay those of the real run.

    Example: saved ts 100.0, 101.2, 108.0 (gaps 1.2 s and 6.8 s), replayed at t=500
        -> waits 0, 1.2, 2.0 s (capped) and sends ts 500.0, 501.2, 508.0
    """
    events = run["events"]
    offset = time.time() - events[0]["ts"]  # shift so the first event is "now"
    previous_ts = events[0]["ts"]
    for event in events:
        # asyncio.sleep, not time.sleep: it pauses this stream only, not the server.
        await asyncio.sleep(min(event["ts"] - previous_ts, REPLAY_MAX_GAP))
        previous_ts = event["ts"]
        yield _sse({**event, "ts": event["ts"] + offset})
    yield _sse({"type": "done", "ts": time.time()})


@app.post("/api/variants/{variant_id}/review")
def review_variant(variant_id: str, request: ReviewRequest) -> Review:
    """Record the expert's decision on the variant's saved run.

    FastAPI reads the JSON body into `request` and validates it with ReviewRequest:
    a rejection without comment is refused with HTTP 422 before this code even runs.

    The AI's proposal, the model name and the run date come from the saved run on the
    server, never from the browser: a client cannot rewrite what the AI had proposed.

    Body example:  {"decision": "accepted", "reviewer": "PD"}
    Returns the stored Review (with its id and created_at).
    """
    _get_variant(variant_id)
    run = load_run(variant_id)
    if run is None:  # 409 Conflict: the request is valid, but there is nothing to review yet
        raise HTTPException(status_code=409, detail=f"{variant_id} has no analysis to review")

    annotation = Annotation.model_validate(run["events"][-1]["annotation"])
    final = {
        "accepted": annotation.classification,  # the expert adopts the AI's proposal
        "modified": request.final_classification,  # the expert's own classification
        "rejected": None,  # the expert adopts no classification
    }[request.decision]

    review = Review(
        # model_dump(): the request fields; then the ones only the server knows.
        **{**request.model_dump(), "final_classification": final},
        variant_id=variant_id,
        ai_classification=annotation.classification,
        model=run["model"],
        run_saved_at=run["saved_at"],
        annotation=annotation,
    )
    append_review(review)
    log.info("%s: %s by %s", variant_id, review.decision, review.reviewer)
    return review


@app.get("/api/audit")
def audit() -> dict:
    """The audit trail, newest first, and how often the expert agreed with the AI.

    Agreement = decisions where the final classification equals the AI's, over all
    decisions. A rejection counts as a disagreement. Corrections stay in the history:
    every decision counts, not only the latest one per variant.

    Example:
        {"agreement": {"agreed": 2, "total": 3, "rate": 0.667},
         "reviews": [{<newest Review>}, ...]}
    """
    reviews = list_reviews()
    agreed = sum(r.final_classification == r.ai_classification for r in reviews)
    return {
        "agreement": {
            "agreed": agreed,
            "total": len(reviews),
            "rate": round(agreed / len(reviews), 3) if reviews else None,
        },
        "reviews": [r.model_dump(mode="json") for r in reversed(reviews)],
    }
