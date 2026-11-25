# Agent vs code: what the LLM does, and why

Most of Variant Copilot is ordinary deterministic code. The LLM is used only where a rule cannot do the job, and deterministic guardrails surround it.

*Version française : [agent-vs-code.fr.md](agent-vs-code.fr.md).*

## The principle

> Deterministic code wherever a rule exists; the LLM only where judgment over unstructured text is needed, with deterministic guardrails around it.

An LLM brings three abilities no conventional program has: reading free text, adapting its next action to what it just found, and writing an argued conclusion. It also brings three costs: it is non-deterministic, every call costs money and time, and it can hallucinate. Each task below goes to whichever side handles it better.

## Who does what

| Task | Done by | Why |
| --- | --- | --- |
| Call VEP, pick the canonical protein-coding transcript, extract fields | code | Fixed, known rules: an `if` does it identically every time, for free. |
| Disk cache, NCBI rate limit, network error handling | code | Infrastructure. |
| Validate the output format | code (Pydantic) | A strict rule needs no judgment. |
| Check that every cited URL was returned by a tool | code (`seen_urls`) | A check must be more reliable than what it checks. |
| Refuse a conclusion before any PubMed search | code | A procedural rule. |
| Set `needs_expert_review` for VUS, conflicts or low confidence | code (`Annotation` validator) | Pure logic. It was first in the prompt only; moved to code so it cannot be skipped. |
| Order of steps (VEP, then PubMed) | prompt | Could be fixed in code; left to the prompt because the model follows it reliably and it keeps the loop generic. |
| **Write PubMed queries and decide whether to run more** | **LLM** | Needs knowledge of synonyms (`V600E`, `Val600Glu`, `BRAF(V600E)`) and reactions to results: zero hits, too many, off-topic. |
| **Read abstracts and turn them into sourced claims** | **LLM** | Free text: no rule understands that "constitutive activity of the MAPK pathway" means gain of function. |
| **Weigh mixed signals and conclude** | **LLM** | "SIFT says deleterious, no paper exists" calls for judgment, and the summary for a biologist is writing. |
| Final decision | human expert | The tool proposes; a person signs off. |

## The conventional alternative

A fixed pipeline would look like this:

```
VEP → fixed query "{gene}"[tiab] AND "{protein_short}"[tiab] → article count → rule
      if count > 100: oncogenic   elif count == 0: vus   else: likely_oncogenic
```

It would get the three demo variants right, for the wrong reasons:

- **Article count is not oncogenicity.** A common benign variant can be heavily cited precisely because it was shown to be benign. The rule never reads what the papers say.
- **No cited evidence.** It outputs a label, not the claims that justify it, while traceability is the point of the tool.
- **Rigid.** A paper that writes `p.V600E`, or discusses codon 600 only, is missed by the one fixed query.

## Agent or workflow?

Two terms are often mixed up:

- A **workflow** chains LLM calls along steps fixed in code.
- An **agent** lets the model choose its next action in a loop, based on the results so far.

Variant Copilot sits in between. The overall order is nearly fixed by the prompt, and real autonomy lives in the literature search: which queries, how many, and when to stop. For a clinical tool this is a deliberate choice: **bounded autonomy, where it adds value**.

## The guardrails, layer by layer

1. **Tool results are the only source of facts.** The prompt forbids outside knowledge, and tools return small, clean, sourced data.
2. **Structured output.** The answer must be a `submit_annotation` call matching the Pydantic schema; free text is impossible (`tool_choice="required"`).
3. **Self-correction.** An invalid answer is not a crash: the error becomes the tool result, and the model fixes it on the next turn.
4. **URL check.** Any cited URL that no tool returned is rejected as invented.
5. **Logic rules in code.** `needs_expert_review` is enforced by the model validator.
6. **Human sign-off.** Nothing is final until an expert accepts, corrects or rejects it, and every decision is logged.

## Known gaps

- `direction` (supports pathogenic, benign or neutral) is still the model's judgment. The prompt asks for VEP facts to be neutral, but nothing enforces it.
- Claims are checked for their URL, not for their content: a claim could misquote a real article. Checking that a claim matches its abstract would need a second, verifying model call, or a human.
- Runs are not fully reproducible: the model may write different queries from one run to the next. Storing each annotation (step 5) makes the demo replayable.
