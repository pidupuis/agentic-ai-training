"""Data contracts shared by the agent, the API and (mirrored in types.ts) the frontend."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Classification = Literal[
    "oncogenic", "likely_oncogenic", "vus", "likely_benign", "benign", "insufficient_evidence"
]
Direction = Literal["supports_pathogenic", "supports_benign", "neutral"]


class Evidence(BaseModel):
    """One sourced claim. The url must come from a tool result (checked in the agent loop)."""

    source: Literal["Ensembl VEP", "PubMed"]
    claim: str = Field(description="One factual sentence taken from the tool result")
    url: str = Field(description="The exact url returned by the tool for this fact")
    direction: Direction


class Annotation(BaseModel):
    """The agent's proposal, submitted through the submit_annotation tool."""

    classification: Classification
    confidence: Literal["low", "medium", "high"]
    summary: str = Field(description="2-3 sentences for a biologist")
    evidence: list[Evidence] = Field(min_length=1)
    conflicts: list[str] = Field(description="Disagreements between sources; empty if none")
    needs_expert_review: bool = Field(description="True if VUS, conflict or low confidence")

    @model_validator(mode="after")
    def _enforce_review_rule(self) -> "Annotation":
        """Force needs_expert_review when the rule applies, whatever the model said.

        This is pure logic, so it is enforced in code rather than trusted to the LLM.
        The model may still ask for a review in other cases (True stays True).
        Runs after field validation, on every Annotation built anywhere (agent, API, tests).
        """
        if (
            self.classification in ("vus", "insufficient_evidence")
            or self.conflicts
            or self.confidence == "low"
        ):
            self.needs_expert_review = True
        return self


# --- Expert review (step 5) -------------------------------------------------------

Decision = Literal["accepted", "modified", "rejected"]


class ReviewRequest(BaseModel):
    """What the browser sends: the expert's decision only (POST /api/variants/{id}/review).

    The AI's proposal is NOT part of the request: the server takes it from the saved run,
    so a client can never rewrite what the AI had proposed.

    Example:
        {"decision": "modified", "final_classification": "likely_oncogenic",
         "comment": "Single cancer type in the cited studies", "reviewer": "PD"}
    """

    decision: Decision
    final_classification: Classification | None = Field(
        default=None, description="Required when modified: the expert's own classification"
    )
    comment: str = ""
    reviewer: str = Field(min_length=1, description="Free text, e.g. a name or initials")

    @model_validator(mode="after")
    def _check_consistency(self) -> "ReviewRequest":
        """An expert must justify a disagreement, and a correction must say what it corrects to."""
        if self.decision in ("modified", "rejected") and not self.comment.strip():
            raise ValueError(f"A comment is required when the decision is {self.decision}")
        if self.decision == "modified" and self.final_classification is None:
            raise ValueError("final_classification is required when the decision is modified")
        return self


class Review(ReviewRequest):
    """One line of the audit trail: the expert's decision plus what the AI had proposed.

    Inherits the fields AND the checks of ReviewRequest (comment rule included); the
    extra fields are filled by the server from the saved run, never sent by the browser.

    final_classification after the server fills it:
        accepted -> the AI's classification
        modified -> the expert's classification
        rejected -> None (the expert adopts no classification)
    """

    # default_factory: computed at each creation. A plain default=uuid.uuid4().hex would
    # be computed once at import time, giving every review the same id.
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    variant_id: str
    ai_classification: Classification
    model: str  # the LLM that produced the annotation (from the saved run)
    # Which run was reviewed (its saved_at). A later re-analysis is a new, unreviewed
    # proposal: the UI compares this with the current run to know if it was validated.
    run_saved_at: float
    # Always UTC: a date without a time zone is ambiguous. The frontend shows local time.
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    annotation: Annotation  # full copy: each line of the trail is readable on its own
