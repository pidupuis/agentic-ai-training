"""The agent: tool schemas, system prompt and the hand-written loop."""

import json, time
from pydantic import ValidationError
from app.models import Annotation
from app.tools.ensembl import get_vep_annotation
from app.tools.pubmed import search_pubmed
from app.llm import get_client, get_model

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_vep_annotation",
            "description": (
                "Predicted effect of a variant from Ensembl VEP on the canonical transcript: "
                "gene, protein change, consequence, SIFT/PolyPhen predictions, known ids "
                "(rs = dbSNP, COSV = COSMIC) and gnomAD population frequency. Call it first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "hgvs_g": {
                        "type": "string",
                        "description": "Genomic HGVS on GRCh38, e.g. 7:g.140753336A>T",
                    }
                },
                "required": ["hgvs_g"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_pubmed",
            "description": (
                "Search PubMed; returns the total count and the top articles (PMID, title, "
                "journal, year, abstract excerpt, url). ALWAYS tag terms with [tiab], e.g. "
                '"BRAF"[tiab] AND "V600E"[tiab]: untagged words unknown to PubMed are silently '
                "dropped. Check translated_query. Run several queries if useful "
                "(variant alone, variant + a cancer type, variant + Hsp90)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "PubMed query with [tiab] tags"},
                    "max_results": {"type": "integer", "description": "1 to 10, default 5"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_annotation",
            "description": "Submit your final annotation. Always finish by calling this tool.",
            # Generated from the Pydantic model: one source of truth for the output format.
            "parameters": Annotation.model_json_schema(),
        },
    },
]

# Name -> Python function, used by the loop to execute the model's tool calls.
# submit_annotation is absent on purpose: the loop handles it itself.
TOOL_FUNCTIONS = {
    "get_vep_annotation": get_vep_annotation,
    "search_pubmed": search_pubmed,
}

SYSTEM_PROMPT = """\
You are a variant interpretation assistant for an oncology lab. You propose an \
oncogenicity classification for one somatic variant; a human expert always reviews \
your proposal before it is used.

Method:
1. Call get_vep_annotation first.
2. Then search PubMed with [tiab]-tagged queries, e.g. "BRAF"[tiab] AND "V600E"[tiab]. \
Run several queries if useful: the variant alone, the variant with a cancer type, \
the variant with Hsp90. Check translated_query to see what PubMed really searched.
3. Finish by calling submit_annotation. Never answer in plain text.

Evidence rules:
- State nothing that does not come from a tool result. Use no outside knowledge.
- Every evidence item must carry the exact url returned by the tool for that fact: \
an article url (https://pubmed.ncbi.nlm.nih.gov/<pmid>/) for a paper, the Ensembl url \
for VEP data. Never build or guess a url.
- SIFT/PolyPhen predictions, rarity in gnomAD and a COSMIC id are weak hints. \
On their own they never justify oncogenic or likely_oncogenic.
- Zero relevant articles is a valid result: answer vus or insufficient_evidence.
- If sources disagree, list each disagreement in conflicts.
- Never guess. When unsure, choose the more cautious class and set needs_expert_review \
to true.

needs_expert_review must be true if the classification is vus or insufficient_evidence, \
if conflicts is not empty, or if confidence is low.
"""

MAX_TURNS = 8


class AgentError(Exception):
    """The agent could not produce a valid annotation."""


def _user_message(variant) -> str:
    return (
        f"Annotate this somatic variant.\n"
        f"Gene: {variant.gene}\n"
        f"Protein change: {variant.protein} ({variant.protein_short})\n"
        f"Genomic HGVS (GRCh38): {variant.hgvs_g}"
    )


def _collect_urls(obj, found: set[str]) -> set[str]:
    """Every value of a "url" key, at any depth (VEP url, PubMed search and article urls)."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "url" and isinstance(value, str):
                found.add(value)
            else:
                _collect_urls(value, found)
    elif isinstance(obj, list):
        for item in obj:
            _collect_urls(item, found)
    return found


def _check_annotation(args: dict, seen_urls: set[str], pubmed_called: bool) -> Annotation:
    """Validate a submit_annotation call. Raises ValueError with a message for the model."""
    if not pubmed_called:
        raise ValueError("You must search PubMed at least once before submitting.")
    annotation = Annotation.model_validate(args)  # raises ValidationError if malformed
    invented = [e.url for e in annotation.evidence if e.url not in seen_urls]
    if invented:
        raise ValueError(
            f"These urls were never returned by a tool: {invented}. "
            "Cite only urls that appear in tool results."
        )
    return annotation


def run_agent(variant, on_event) -> Annotation:
    """Run the tool-calling loop until the model submits a valid annotation.

    Args:
        variant: a Variant from app.variants.
        on_event: called with each event dict (tool_call, tool_result, annotation).
            The CLI prints them; the API will stream them to the browser.

    Returns:
        The validated Annotation. Raises AgentError after MAX_TURNS without one.
    """
    client, model = get_client(), get_model()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _user_message(variant)},
    ]
    seen_urls: set[str] = set()
    pubmed_called = False

    def emit(event: dict) -> None:
        on_event({**event, "ts": time.time()})  # timestamp, for durations in the UI

    for _turn in range(MAX_TURNS):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            tool_choice="required",  # the model must call a tool on every turn
        )
        msg = response.choices[0].message
        # Keep the assistant message in the history, tool_calls included:
        # the API rejects a "tool" message whose tool_call_id it cannot find.
        messages.append(msg.model_dump(exclude_none=True))

        if not msg.tool_calls:  # should not happen with tool_choice="required"
            messages.append({"role": "user", "content": "Call a tool. Finish with submit_annotation."})
            continue

        for call in msg.tool_calls:  # the model may request several tools in one turn
            name = call.function.name
            try:
                args = json.loads(call.function.arguments)
            except json.JSONDecodeError as e:
                args, result = {}, {"error": f"Arguments are not valid JSON: {e}"}
            else:
                emit({"type": "tool_call", "tool": name, "args": args})
                if name == "submit_annotation":
                    try:
                        annotation = _check_annotation(args, seen_urls, pubmed_called)
                    except (ValidationError, ValueError) as e:
                        result = {"error": f"Annotation rejected: {e}"}  # self-correction
                    else:
                        emit({"type": "annotation", "annotation": annotation.model_dump()})
                        return annotation
                elif name in TOOL_FUNCTIONS:
                    try:
                        result = TOOL_FUNCTIONS[name](**args)
                    except TypeError as e:  # wrong or missing argument names
                        result = {"error": f"Bad arguments for {name}: {e}"}
                    pubmed_called = pubmed_called or name == "search_pubmed"
                    _collect_urls(result, seen_urls)
                else:
                    result = {"error": f"Unknown tool: {name}"}

            emit({"type": "tool_result", "tool": name, "result": result})
            # Every tool_call needs its answer, even a rejected one.
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})

    raise AgentError(f"No valid annotation after {MAX_TURNS} turns")