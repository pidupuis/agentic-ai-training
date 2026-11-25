"""The agent: tool schemas, system prompt and the hand-written tool-calling loop.

How a run works:
    1. We send the conversation (system prompt + variant description) and the TOOLS schemas.
    2. The model answers with one or more tool calls: which function, with which JSON arguments.
    3. We execute them in Python and append each result to the conversation.
    4. Repeat until the model calls submit_annotation with a valid annotation.

Cost safety: a run makes at most MAX_TURNS LLM calls, and stops before the next one
if the caller sets the optional `cancel` flag (used by the API on disconnect).

The LLM never runs code or reaches the network itself: it only *asks* for tool calls,
and this module decides what actually runs. See docs/agent-vs-code.md for which parts
are left to the model and which are deterministic code.
"""

import json
import logging
import re
import threading
import time
from collections.abc import Callable

from app.llm import get_client, get_model
from app.models import Annotation
from app.tools.ensembl import get_vep_annotation
from app.tools.pubmed import search_pubmed
from app.variants import Variant

# Tool schemas in the OpenAI "function calling" format. The model sees only these
# names, descriptions and JSON Schemas, never the Python code: the descriptions are
# effectively part of the prompt, read at the moment the model writes the arguments.
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
                    "max_results": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                        "description": "1 to 10, default 5",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_annotation",
            # This "tool" executes nothing. Making the model *call a function* to give its
            # answer forces the answer into JSON matching the schema, instead of free text.
            "description": "Submit your final annotation. Always finish by calling this tool.",
            # Generated from the Pydantic model: one source of truth for the output format.
            "parameters": Annotation.model_json_schema(),
        },
    },
]

# Tool name -> Python function, used by the loop to execute the model's tool calls.
# submit_annotation is absent on purpose: the loop validates it instead of running it.
TOOL_FUNCTIONS: dict[str, Callable[..., dict]] = {
    "get_vep_annotation": get_vep_annotation,
    "search_pubmed": search_pubmed,
}

# The "\" at the end of a line joins it with the next one (no newline in the string):
# sentences stay on one line for the model while the source stays readable.
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
- When VEP returns SIFT or PolyPhen predictions, always report them as one evidence \
item, with their label and score, e.g. "SIFT deleterious_low_confidence (0.02), \
PolyPhen possibly_damaging (0.742)". The expert must see them, even if they do not \
decide the class.
- VEP facts (consequence type, database ids, predictions, rarity) are context: mark them \
neutral. Only a frequent gnomAD allele (above 1%) counts as supports_benign.
- Zero relevant articles is a valid result: answer vus or insufficient_evidence.
- If sources disagree, list each disagreement in conflicts.
- Never guess. When unsure, choose the more cautious class and set needs_expert_review \
to true.

Classification criteria (apply the first that matches):
- oncogenic: several articles report the variant as an established driver, with \
functional evidence of activation or approved targeted therapies for it.
- likely_oncogenic: some articles support a driver role, but evidence is limited \
(few studies, indirect, or one cancer type only).
- vus: no or inconclusive variant-specific literature, whatever the predictions say.
- likely_benign / benign: frequent in gnomAD (above 1%) or articles show no effect.
- insufficient_evidence: tool errors prevented a proper search.

Confidence is how strong the evidence is, not how sure you are of the class:
- high: several independent articles agree on the variant itself.
- medium: limited or indirect literature.
- low: no variant-specific literature, or only predictions. A vus with no \
article therefore has low confidence.

needs_expert_review must be true if the classification is vus or insufficient_evidence, \
if conflicts is not empty, or if confidence is low.
"""

# Safety net against endless loops (and bills). A normal run takes 3 to 5 turns.
MAX_TURNS = 8

EventHandler = Callable[[dict], None]

# Which url each evidence source may cite. A PubMed search page (?term=...) is accepted
# only for a neutral fact such as "0 articles found"; a claim for or against
# pathogenicity must point to one article.
URL_PREFIX_BY_SOURCE = {
    "PubMed": "https://pubmed.ncbi.nlm.nih.gov/",
    "Ensembl VEP": "https://www.ensembl.org/",
}
PUBMED_ARTICLE_URL = re.compile(r"https://pubmed\.ncbi\.nlm\.nih\.gov/\d+/")


class AgentError(Exception):
    """The agent could not produce a valid annotation within MAX_TURNS."""


class AgentCancelled(Exception):
    """The run was stopped on purpose because the caller set the cancel flag.

    Not an error: in the API it means the browser went away, so nobody is
    waiting for the result and further LLM calls would be paid for nothing.
    """


# One logger per module, named "app.agent". INFO messages appear in the uvicorn
# terminal (logging is configured in app/main.py); the CLI does not show them.
log = logging.getLogger(__name__)


def run_agent(
    variant: Variant,
    on_event: EventHandler,
    cancel: threading.Event | None = None,
) -> Annotation:
    """Run the tool-calling loop until the model submits a valid annotation.

    Args:
        variant: one of app.variants.VARIANTS.
        on_event: called once per step with an event dict. The CLI prints events,
            the API (step 3) streams them to the browser; the loop does not care which.
            Every event carries "type" and "ts" (Unix timestamp, for durations in the UI):
              {"type": "tool_call",   "tool": "search_pubmed", "args": {"query": "..."}, "ts": ...}
              {"type": "tool_result", "tool": "search_pubmed", "result": {<tool contract>}, "ts": ...}
              {"type": "annotation",  "annotation": {<Annotation as dict>}, "ts": ...}
            A tool_result always follows its tool_call, so the UI can pair them in order.
        cancel: optional stop flag, shared with another thread. threading.Event is a
            thread-safe boolean: the API calls cancel.set() when the browser disconnects,
            and the loop checks cancel.is_set() before every LLM call. The CLI passes
            nothing (Ctrl+C already stops everything).

    Returns:
        The validated Annotation.

    Raises:
        AgentError: no valid annotation after MAX_TURNS model calls.
        AgentCancelled: the cancel flag was set. An LLM call already in flight cannot
            be interrupted, so at most one call is paid after the flag is set.
    """
    client, model = get_client(), get_model()

    # The conversation history IS the agent's memory: the API is stateless, so every
    # call resends everything (prompt, request, each tool call and each result).
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _user_message(variant)},
    ]
    # Every url any tool returned so far: the only urls the annotation may cite.
    seen_urls: set[str] = set()
    pubmed_called = False

    def emit(event: dict) -> None:
        # {**event, "ts": ...} copies the dict and adds a key (JS: {...event, ts}).
        on_event({**event, "ts": time.time()})

    for turn in range(1, MAX_TURNS + 1):  # 1, 2, ..., MAX_TURNS
        # The only place where money is spent, so the only place we need to check.
        if cancel is not None and cancel.is_set():
            raise AgentCancelled(f"{variant.id}: cancelled before turn {turn}")
        log.info("%s: turn %d/%d", variant.id, turn, MAX_TURNS)

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            # The model must call a tool on every turn: no free-text answers.
            tool_choice="required",
            # Most likely token each time: same input, (nearly) same output. Not fully
            # deterministic: OpenAI's parallel computation can still vary slightly.
            temperature=0,
        )
        msg = response.choices[0].message
        # Keep the assistant message, tool_calls included, as a plain dict:
        # the API rejects a "tool" message whose tool_call_id is not in the history.
        messages.append(msg.model_dump(exclude_none=True))

        if not msg.tool_calls:  # should not happen with tool_choice="required"
            messages.append(
                {"role": "user", "content": "Call a tool. Finish with submit_annotation."}
            )
            continue

        # The model may request several tools in one turn (e.g. two PubMed queries).
        for call in msg.tool_calls:
            name = call.function.name
            # try/except/else: the else block runs only if no exception was raised.
            try:
                # Arguments arrive as a JSON *string* written by the model.
                args = json.loads(call.function.arguments)
            except json.JSONDecodeError as e:
                emit({"type": "tool_call", "tool": name, "args": call.function.arguments})
                result = {"error": f"Arguments are not valid JSON: {e}"}
            else:
                emit({"type": "tool_call", "tool": name, "args": args})
                if name == "submit_annotation":
                    try:
                        annotation = _check_annotation(args, seen_urls, pubmed_called)
                    except ValueError as e:  # pydantic's ValidationError is a ValueError
                        # Self-correction: the rejection becomes the tool result,
                        # the model reads it and fixes its answer on the next turn.
                        result = {"error": f"Annotation rejected: {e}"}
                    else:
                        emit({"type": "annotation", "annotation": annotation.model_dump()})
                        return annotation
                elif name in TOOL_FUNCTIONS:
                    try:
                        # **args unpacks the dict into keyword arguments:
                        # {"query": "x"} -> search_pubmed(query="x")
                        result = TOOL_FUNCTIONS[name](**args)
                    except TypeError as e:  # wrong or missing argument names
                        result = {"error": f"Bad arguments for {name}: {e}"}
                    except Exception as e:  # safety net: a tool bug must not kill the run
                        result = {"error": f"{name} failed: {e}"}
                    # A failed search does not count: the model has seen no literature yet.
                    pubmed_called = pubmed_called or (
                        name == "search_pubmed" and "error" not in result
                    )
                    _collect_urls(result, seen_urls)
                else:
                    result = {"error": f"Unknown tool: {name}"}

            emit({"type": "tool_result", "tool": name, "result": result})
            # Every tool_call needs a matching "tool" message, even a failed or rejected
            # one; otherwise the next API call fails with a 400 error.
            messages.append(
                {"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)}
            )

    raise AgentError(f"No valid annotation after {MAX_TURNS} turns")


def _user_message(variant: Variant) -> str:
    """The task given to the model.

    Example output:
        Annotate this somatic variant.
        Gene: BRAF
        Protein change: p.Val600Glu (V600E)
        Genomic HGVS (GRCh38): 7:g.140753336A>T
    """
    return (
        f"Annotate this somatic variant.\n"
        f"Gene: {variant.gene}\n"
        f"Protein change: {variant.protein} ({variant.protein_short})\n"
        f"Genomic HGVS (GRCh38): {variant.hgvs_g}"
    )


def _collect_urls(obj: object, found: set[str]) -> set[str]:
    """Add every value of a "url" key, at any depth, to `found` (and return it).

    Recursive, because PubMed nests the article urls, which are the most important
    evidence, inside data.articles[]. Checking only result["url"] would reject them.

    Example:
        {"source": "PubMed", "url": "https://pubmed.ncbi.nlm.nih.gov/?term=...",
         "data": {"articles": [{"pmid": "22281684",
                                "url": "https://pubmed.ncbi.nlm.nih.gov/22281684/"}]}}
        -> {"https://pubmed.ncbi.nlm.nih.gov/?term=...",
            "https://pubmed.ncbi.nlm.nih.gov/22281684/"}
    """
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
    """Validate a submit_annotation call: deterministic guardrails around the model.

    Four checks, cheapest first:
        1. PubMed was searched at least once (no conclusion from VEP alone).
        2. The arguments match the Annotation schema (Pydantic), which also
           enforces the needs_expert_review rule (see Annotation).
        3. Anti-hallucination: every cited url was returned by a tool in this run.
           A url no tool returned can only have been invented.
        4. Each url fits its evidence: it belongs to the declared source, and a
           non-neutral PubMed claim cites an article, not a search page.

    Returns:
        The validated Annotation.

    Raises:
        ValueError (or pydantic.ValidationError, a subclass) with a message written
        for the model: it is sent back as the tool result so the model can fix it.
    """
    if not pubmed_called:
        raise ValueError("You must search PubMed at least once before submitting.")
    annotation = Annotation.model_validate(args)
    invented = [e.url for e in annotation.evidence if e.url not in seen_urls]
    if invented:
        raise ValueError(
            f"These urls were never returned by a tool: {invented}. "
            "Cite only urls that appear in tool results."
        )
    for e in annotation.evidence:
        if not e.url.startswith(URL_PREFIX_BY_SOURCE[e.source]):
            raise ValueError(f"The url {e.url} does not belong to the source {e.source}.")
        if (
            e.source == "PubMed"
            and e.direction != "neutral"
            and not PUBMED_ARTICLE_URL.fullmatch(e.url)
        ):
            raise ValueError(
                f"The {e.direction} claim {e.claim!r} cites {e.url}, which is not an "
                "article. Cite the article url (https://pubmed.ncbi.nlm.nih.gov/<pmid>/), "
                "or mark the claim neutral if it only reports a search result."
            )
    return annotation
