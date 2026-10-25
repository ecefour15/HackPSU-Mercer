
"""
claim_labels.py: rule-based trust labels for every claim shown to the user.
 
The model NEVER labels its own output. Claims go in; this engine decides.
 
Labels
  VERIFIED        computed by our calculators, or backed by a source in the library
  DEPENDS_ON_YOU  true only given the user's own inputs (or is about their situation)
  CANT_VERIFY     nothing we can show supports it
 
Rule order (first match wins):
  1. kind == "personal"                         -> DEPENDS_ON_YOU
  2. any `requires` input missing               -> DEPENDS_ON_YOU (lists what's missing)
  3. kind == "calculated" and calculated_by set -> VERIFIED (source: calculator name)
  4. kind == "factual" and topic has sources    -> VERIFIED (with source links)
  5. everything else                            -> CANT_VERIFY
 
A calculated claim with no `calculated_by` is a number the model produced
itself, so it is NEVER verified.
"""
 
from __future__ import annotations
 
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional
 
from source_library import get_sources_for_topic, is_stale, load_sources
 
 
class Label(str, Enum):
    VERIFIED = "Verified"
    DEPENDS_ON_YOU = "Depends on you"
    CANT_VERIFY = "Can't verify"
 
 
VALID_KINDS = {"calculated", "factual", "personal"}
 
 
@dataclass
class Claim:
    text: str
    kind: str                                   # "calculated" | "factual" | "personal"
    topic: Optional[str] = None                 # key into the source library
    calculated_by: Optional[str] = None         # e.g. "calculators.loan_summary"
    requires: tuple[str, ...] = ()              # user inputs the claim depends on
 
 
@dataclass
class LabeledClaim:
    claim: Claim
    label: Label
    reason: str
    sources: list[dict] = field(default_factory=list)
    stale_sources: bool = False
 
    def to_dict(self) -> dict:
        return {
            "text": self.claim.text,
            "label": self.label.value,
            "reason": self.reason,
            "sources": [
                {"title": s["title"], "publisher": s["publisher"],
                 "url": s["url"], "date_checked": s["date_checked"]}
                for s in self.sources
            ],
            "stale_sources": self.stale_sources,
        }
 
 
def label_claim(
    claim: Claim,
    user_inputs: Optional[dict] = None,
    sources: Optional[list[dict]] = None,
    today: Optional[date] = None,
) -> LabeledClaim:
    user_inputs = user_inputs or {}
    sources = sources if sources is not None else load_sources()
 
    if claim.kind not in VALID_KINDS:
        return LabeledClaim(claim, Label.CANT_VERIFY, f"Unknown claim type '{claim.kind}'.")
 
    # Rule 1: personal claims are never general facts.
    if claim.kind == "personal":
        return LabeledClaim(claim, Label.DEPENDS_ON_YOU, "Specific to your situation.")
 
    # Rule 2: missing inputs.
    missing = [r for r in claim.requires if user_inputs.get(r) in (None, "")]
    if missing:
        return LabeledClaim(
            claim, Label.DEPENDS_ON_YOU,
            "Needs more information from you: " + ", ".join(missing) + ".",
        )
 
    # Rule 3: calculated by our code.
    if claim.kind == "calculated" and claim.calculated_by:
        return LabeledClaim(
            claim, Label.VERIFIED, f"Computed by {claim.calculated_by} (not by the AI model).",
        )
 
    # Rule 4: backed by the source library.
    if claim.kind == "factual" and claim.topic:
        found = get_sources_for_topic(claim.topic, sources)
        if found:
            stale = any(is_stale(s, today) for s in found)
            return LabeledClaim(
                claim, Label.VERIFIED, "Supported by the cited source(s).",
                sources=found, stale_sources=stale,
            )
 
    # Rule 5: nothing supports it.
    return LabeledClaim(claim, Label.CANT_VERIFY, "No calculation or source supports this claim.")
 
 
def label_claims(
    claims: list[Claim],
    user_inputs: Optional[dict] = None,
    sources: Optional[list[dict]] = None,
    today: Optional[date] = None,
) -> list[LabeledClaim]:
    return [label_claim(c, user_inputs, sources, today) for c in claims]
 
 
def displayable(item: object) -> bool:
    """
    The UI gate: only labeled claims may be shown. Pass every item through this
    before rendering; a bare Claim (no label) returns False.
    """
    return isinstance(item, LabeledClaim) and isinstance(item.label, Label)
 
 
def summarize(labeled: list[LabeledClaim]) -> dict[str, int]:
    """Counts per label, handy for a 'trust summary' bar in the UI."""
    counts = {label.value: 0 for label in Label}
    for item in labeled:
        counts[item.label.value] += 1
    return counts