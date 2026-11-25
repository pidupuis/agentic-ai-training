"""Promise 2: an expert cannot disagree with the AI without saying why.

No network, no OpenAI key, and a temporary audit trail: data/reviews.jsonl is never touched.
Run from backend/:  uv run pytest
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main, store
from app.models import ReviewRequest

SAVED_RUN = {
    "variant_id": "braf-v600e",
    "model": "fake-model",
    "saved_at": 1764000000.0,
    "events": [
        {
            "type": "annotation",
            "ts": 1764000000.0,
            "annotation": {
                "classification": "oncogenic",
                "confidence": "high",
                "summary": "BRAF V600E is an established oncogenic driver.",
                "evidence": [
                    {
                        "source": "PubMed",
                        "claim": "Reported as oncogenic.",
                        "url": "https://pubmed.ncbi.nlm.nih.gov/22281684/",
                        "direction": "supports_pathogenic",
                    }
                ],
                "conflicts": [],
                "needs_expert_review": False,
            },
        }
    ],
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """An API client with a temporary audit trail and a fake saved run."""
    # tmp_path: a fresh empty folder per test, deleted by pytest afterwards.
    monkeypatch.setattr(store, "REVIEWS_FILE", tmp_path / "reviews.jsonl")
    monkeypatch.setattr(main, "load_run", lambda variant_id: SAVED_RUN)
    return TestClient(main.app)


# --- Model level ------------------------------------------------------------------


@pytest.mark.parametrize("decision", ["rejected", "modified"])
def test_disagreement_without_comment_is_refused(decision):
    with pytest.raises(ValidationError, match="A comment is required"):
        ReviewRequest(decision=decision, final_classification="vus", reviewer="PD", comment="  ")


def test_acceptance_needs_no_comment():
    assert ReviewRequest(decision="accepted", reviewer="PD").comment == ""


# --- API level --------------------------------------------------------------------


def test_api_refuses_rejection_without_comment_and_writes_nothing(client):
    response = client.post(
        "/api/variants/braf-v600e/review",
        json={"decision": "rejected", "reviewer": "PD"},
    )
    assert response.status_code == 422
    assert "A comment is required" in response.text
    assert store.list_reviews() == []  # nothing reached the audit trail


def test_api_records_justified_rejection_with_the_ai_proposal(client):
    response = client.post(
        "/api/variants/braf-v600e/review",
        json={"decision": "rejected", "comment": "Evidence misread", "reviewer": "PD"},
    )
    assert response.status_code == 200
    [review] = store.list_reviews()  # exactly one line in the trail
    # The AI proposal comes from the saved run on the server, not from the request.
    assert review.ai_classification == "oncogenic"
    assert review.final_classification is None
    assert review.model == "fake-model"


def test_a_revision_is_a_new_line_and_history_is_kept(client):
    url = "/api/variants/braf-v600e/review"
    client.post(url, json={"decision": "accepted", "reviewer": "PD"})
    client.post(
        url,
        json={
            "decision": "modified",
            "final_classification": "likely_oncogenic",
            "comment": "Single cancer type",
            "reviewer": "PD",
        },
    )
    decisions = [r.decision for r in store.list_reviews()]
    assert decisions == ["accepted", "modified"]
    assert client.get("/api/audit").json()["agreement"] == {
        "agreed": 1,
        "total": 2,
        "rate": 0.5,
    }
