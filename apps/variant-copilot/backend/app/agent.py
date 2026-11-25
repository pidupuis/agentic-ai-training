"""The agent: tool schemas, system prompt and the hand-written loop."""

from app.models import Annotation
from app.tools.ensembl import get_vep_annotation
from app.tools.pubmed import search_pubmed

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