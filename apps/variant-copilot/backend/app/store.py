"""The audit trail: every expert decision, append-only, in data/reviews.jsonl.

JSON Lines (one JSON object per line) rather than one big JSON array: recording a
decision is writing one line at the end of the file. Existing lines are never
rewritten or deleted, which is exactly the audit-trail rule: a correction is a new line.

Example file (one line per decision, shortened):
    {"decision": "accepted", "final_classification": "oncogenic", "comment": "", "reviewer": "PD", "id": "3f2a...", "variant_id": "braf-v600e", "ai_classification": "oncogenic", "model": "gpt-5.4-mini", "created_at": "2026-11-25T14:40:00Z", "annotation": {...}}
    {"decision": "modified", "final_classification": "likely_oncogenic", "comment": "...", ...}
"""

from pathlib import Path

from app.models import Review

# parents[1]: app/store.py -> app/ -> backend/
REVIEWS_FILE = Path(__file__).resolve().parents[1] / "data" / "reviews.jsonl"


def append_review(review: Review) -> None:
    """Add one decision at the end of the trail.

    "a" mode = append: writes at the end of the file and never truncates it.
    """
    REVIEWS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with REVIEWS_FILE.open("a", encoding="utf-8") as f:
        f.write(review.model_dump_json() + "\n")


def list_reviews() -> list[Review]:
    """Every decision, oldest first. Each line is validated back into a Review."""
    if not REVIEWS_FILE.exists():
        return []
    lines = REVIEWS_FILE.read_text(encoding="utf-8").splitlines()
    return [Review.model_validate_json(line) for line in lines if line.strip()]


def latest_review(variant_id: str) -> Review | None:
    """The most recent decision for this variant: the one that counts today.

    Older decisions stay in the trail; they are history, not deleted.
    """
    for review in reversed(list_reviews()):
        if review.variant_id == variant_id:
            return review
    return None
