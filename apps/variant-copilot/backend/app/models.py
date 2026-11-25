"""Data contracts shared by the agent, the API and (mirrored in types.ts) the frontend."""

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