"""Terminal runner for the agent.

Usage, from backend/:
    uv run python -m app.cli braf-v600e

`python -m app.cli` runs this module as a script with backend/ as the working
directory, so `import app...` resolves without touching sys.path.

Output: one line per agent step while it runs, then the final annotation as JSON.
    → get_vep_annotation({"hgvs_g": "7:g.140753336A>T"})
      ← BRAF p.Val600Glu ['missense_variant']
    → search_pubmed({"query": "\\"BRAF\\"[tiab] AND \\"V600E\\"[tiab]", "max_results": 5})
      ← 9001 articles
    ✓ annotation submitted
    {"classification": "oncogenic", ...}
"""

import json
import sys

from app.agent import run_agent
from app.variants import VARIANTS_BY_ID


def print_event(event: dict) -> None:
    """The CLI's on_event handler: print one readable line per agent event.

    The API (step 3) passes a different handler that streams events to the browser;
    run_agent is the same in both cases.

    Args:
        event: an event dict emitted by run_agent (see its docstring for the shapes).
    """
    kind, tool = event["type"], event.get("tool", "")
    # submit_annotation's arguments are the annotation itself: printed at the end.
    if kind == "tool_call" and tool != "submit_annotation":
        print(f"→ {tool}({json.dumps(event['args'])})")
    elif kind == "tool_result":
        r = event["result"]
        if "error" in r:
            # Tool failures and rejected annotations: shows self-correction at work.
            print(f"  ✗ {r['error'][:200]}")
        elif tool == "search_pubmed":
            print(f"  ← {r['data']['total_count']} articles")
        elif tool == "get_vep_annotation":
            d = r["data"]
            print(f"  ← {d['gene_symbol']} {d['hgvsp']} {d['consequence_terms']}")
    elif kind == "annotation":
        print("✓ annotation submitted")


def main() -> None:
    """Parse the variant id, run the agent, print the annotation."""
    # sys.argv = ["app/cli.py", "braf-v600e"]: the script path, then the arguments.
    if len(sys.argv) != 2 or sys.argv[1] not in VARIANTS_BY_ID:
        # sys.exit("message") prints to stderr and exits with code 1.
        sys.exit(f"Usage: python -m app.cli <{'|'.join(VARIANTS_BY_ID)}>")
    annotation = run_agent(VARIANTS_BY_ID[sys.argv[1]], print_event)
    # ensure_ascii=False keeps non-ASCII characters (e.g. Greek letters in titles) readable.
    print(json.dumps(annotation.model_dump(), indent=2, ensure_ascii=False))


# Runs only when executed (python -m app.cli), not when imported (e.g. by tests).
if __name__ == "__main__":
    main()
