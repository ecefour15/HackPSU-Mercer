
"""
source_library.py: lookup over the cached trusted-source library (sources.json).
 
Works fully offline. The AI/Back-End Lead calls get_sources_for_topic(topic);
the claim-label engine calls it too. A topic with no entry returns [].
"""
 
from __future__ import annotations
 
import json
from datetime import date
from pathlib import Path
from typing import Optional
 
LIBRARY_PATH = Path(__file__).with_name("sources.json")
 
REQUIRED_FIELDS = (
    "id", "publisher", "title", "url", "topics",
    "summary", "date_checked", "verification",
)
VALID_VERIFICATION = {"full_page_read", "search_excerpt_only"}
 
 
def load_sources(path: Optional[Path] = None) -> list[dict]:
    with open(path or LIBRARY_PATH, encoding="utf-8") as f:
        return json.load(f)["sources"]
 
 
def all_topics(sources: Optional[list[dict]] = None) -> set[str]:
    sources = sources if sources is not None else load_sources()
    return {t for s in sources for t in s["topics"]}
 
 
def get_sources_for_topic(topic: str, sources: Optional[list[dict]] = None) -> list[dict]:
    """Return every source entry that covers `topic`, or [] if none."""
    sources = sources if sources is not None else load_sources()
    return [s for s in sources if topic in s["topics"]]
 
 
def is_stale(entry: dict, today: Optional[date] = None, max_age_days: int = 90) -> bool:
    """True if the entry was last checked more than max_age_days ago."""
    today = today or date.today()
    checked = date.fromisoformat(entry["date_checked"])
    return (today - checked).days > max_age_days
 
 
def validate_library(sources: Optional[list[dict]] = None) -> list[str]:
    """Return a list of problems (empty list = library is well-formed)."""
    sources = sources if sources is not None else load_sources()
    problems: list[str] = []
    seen_ids: set[str] = set()
 
    for s in sources:
        sid = s.get("id", "<missing id>")
        for field in REQUIRED_FIELDS:
            if field not in s or s[field] in ("", None, []):
                problems.append(f"{sid}: missing '{field}'")
        if sid in seen_ids:
            problems.append(f"{sid}: duplicate id")
        seen_ids.add(sid)
 
        url = s.get("url", "")
        if not url.startswith("https://"):
            problems.append(f"{sid}: url must start with https://")
        if s.get("verification") not in VALID_VERIFICATION:
            problems.append(f"{sid}: bad verification value")
        try:
            date.fromisoformat(s.get("date_checked", ""))
        except ValueError:
            problems.append(f"{sid}: date_checked must be YYYY-MM-DD")
    return problems
 
 
if __name__ == "__main__":
    issues = validate_library()
    print("Library OK" if not issues else "\n".join(issues))
    for t in sorted(all_topics()):
        print(f"{t:40s} -> {[s['id'] for s in get_sources_for_topic(t)]}")