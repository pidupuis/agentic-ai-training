"""Promise 1: the agent cannot cite a source that no tool returned.

No network, no OpenAI key: the LLM and the two tools are replaced by fakes.
Run from backend/:  uv run pytest
"""

import json
from types import SimpleNamespace

import pytest
from openai.types.chat import ChatCompletionMessage

from app import agent
from app.agent import _check_annotation, run_agent
from app.variants import VARIANTS_BY_ID

VEP_URL = "https://www.ensembl.org/Homo_sapiens/Location/View?r=7:140753336-140753336"
REAL_PMID_URL = "https://pubmed.ncbi.nlm.nih.gov/22281684/"
INVENTED_PMID_URL = (
    "https://pubmed.ncbi.nlm.nih.gov/99999999/"  # no tool ever returned it
)


def annotation_args(*urls: str) -> dict:
    """submit_annotation arguments citing the given urls, otherwise valid."""
    return {
        "classification": "oncogenic",
        "confidence": "high",
        "summary": "BRAF V600E is an established oncogenic driver.",
        "evidence": [
            {
                "source": "PubMed",
                "claim": "Reported as oncogenic.",
                "url": u,
                "direction": "supports_pathogenic",
            }
            for u in urls
        ],
        "conflicts": [],
        "needs_expert_review": False,
    }


# --- Unit level: the check itself -------------------------------------------------


def test_invented_url_is_rejected():
    with pytest.raises(ValueError, match="never returned by a tool"):
        _check_annotation(
            annotation_args(INVENTED_PMID_URL),
            seen_urls={VEP_URL, REAL_PMID_URL},
            pubmed_called=True,
        )


def test_url_returned_by_a_tool_is_accepted():
    annotation = _check_annotation(
        annotation_args(REAL_PMID_URL),
        seen_urls={VEP_URL, REAL_PMID_URL},
        pubmed_called=True,
    )
    assert annotation.evidence[0].url == REAL_PMID_URL


def test_conclusion_without_pubmed_search_is_rejected():
    with pytest.raises(ValueError, match="search PubMed"):
        _check_annotation(
            annotation_args(VEP_URL), seen_urls={VEP_URL}, pubmed_called=False
        )


# --- Loop level: the agent gets the rejection and corrects itself ----------------


class FakeLLM:
    """Stands in for the OpenAI client: replays a fixed script of tool calls.

    Records the messages of every call, to check what the model was told.
    """

    def __init__(self, script: list[tuple[str, dict]]):
        self.script = script
        self.sent: list[list[dict]] = []
        # Same attribute path as the real client: client.chat.completions.create(...)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, *, messages, **_ignored):
        self.sent.append(list(messages))
        name, args = self.script[len(self.sent) - 1]
        message = ChatCompletionMessage.model_validate(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": f"call_{len(self.sent)}",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                ],
            }
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def fake_vep(hgvs_g: str) -> dict:
    return {"source": "Ensembl VEP", "url": VEP_URL, "data": {"gene_symbol": "BRAF"}}


def fake_pubmed(query: str, max_results: int = 5) -> dict:
    return {
        "source": "PubMed",
        "url": "https://pubmed.ncbi.nlm.nih.gov/?term=BRAF",
        "data": {
            "total_count": 1,
            "articles": [{"pmid": "22281684", "url": REAL_PMID_URL}],
        },
    }


def test_agent_rejects_invented_url_then_accepts_the_correction(monkeypatch):
    llm = FakeLLM(
        [
            ("get_vep_annotation", {"hgvs_g": "7:g.140753336A>T"}),
            ("search_pubmed", {"query": '"BRAF"[tiab] AND "V600E"[tiab]'}),
            (
                "submit_annotation",
                annotation_args(REAL_PMID_URL, INVENTED_PMID_URL),
            ),  # hallucinated
            ("submit_annotation", annotation_args(REAL_PMID_URL)),  # corrected
        ]
    )
    # monkeypatch replaces these for this test only, and restores them afterwards.
    monkeypatch.setattr(agent, "get_client", lambda: llm)
    monkeypatch.setattr(agent, "get_model", lambda: "fake-model")
    monkeypatch.setitem(agent.TOOL_FUNCTIONS, "get_vep_annotation", fake_vep)
    monkeypatch.setitem(agent.TOOL_FUNCTIONS, "search_pubmed", fake_pubmed)

    events: list[dict] = []
    annotation = run_agent(VARIANTS_BY_ID["braf-v600e"], events.append)

    # The final annotation only cites what a tool returned.
    assert [e.url for e in annotation.evidence] == [REAL_PMID_URL]
    # The first submission was refused, and the refusal was visible in the trace...
    rejections = [
        e
        for e in events
        if e["type"] == "tool_result" and e["tool"] == "submit_annotation"
    ]
    assert len(rejections) == 1
    assert INVENTED_PMID_URL in rejections[0]["result"]["error"]
    # ...and sent back to the model, which is how it could correct itself.
    last_tool_message = llm.sent[3][-1]
    assert last_tool_message["role"] == "tool"
    assert INVENTED_PMID_URL in last_tool_message["content"]
    assert len(llm.sent) == 4
