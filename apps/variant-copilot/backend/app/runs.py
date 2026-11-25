"""Saved agent runs: the last complete analysis of each variant, one JSON file per variant.

Why save the whole run (every event) rather than just the annotation:
- the page can show a variant's trace AND annotation at load time, with no LLM call;
- the run can be replayed with its original timing (see /analyze?replay=true), to work
  on the UI or give a demo without OpenAI, network or cost;
- the files are versioned in Git: anyone who clones the repo gets the full demo.

Files: backend/data/runs/<variant_id>.json, overwritten by each successful analysis.
Only successful runs are saved: a failed or cancelled run never replaces a good one.
"""

import json
import os
import time
from pathlib import Path

# parents[1]: app/runs.py -> app/ -> backend/
RUNS_DIR = Path(__file__).resolve().parents[1] / "data" / "runs"


def save_run(variant_id: str, model: str, events: list[dict]) -> None:
    """Save a finished run, replacing the previous one for this variant.

    Args:
        variant_id: e.g. "braf-v600e".
        model: the LLM that produced it (LLM_MODEL), kept for traceability.
        events: every event of the run, in order, ending with the annotation event.

    Example file content (events trimmed):
        {"variant_id": "braf-v600e", "model": "gpt-5.4-mini", "saved_at": 1764000000.0,
         "events": [{"type": "tool_call", "tool": "get_vep_annotation", "args": {...}, "ts": ...},
                    {"type": "tool_result", ...},
                    {"type": "annotation", "annotation": {...}, "ts": ...}]}
    """
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUNS_DIR / f"{variant_id}.json"
    content = {"variant_id": variant_id, "model": model, "saved_at": time.time(), "events": events}
    # Write to a temporary file, then rename: os.replace is atomic, so a reader never
    # sees a half-written file, even if the server stops in the middle of the write.
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(content, ensure_ascii=False, indent=1))
    os.replace(tmp, path)


def load_run(variant_id: str) -> dict | None:
    """The saved run of this variant (see save_run for the shape), or None if there is none."""
    path = RUNS_DIR / f"{variant_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())
