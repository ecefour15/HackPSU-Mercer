"""Mercer chat: grounded answers, history and memory in the database.

The browser's local brain (frontend/brain.js) computes the answer from the account data.
This service stores the conversation and memory, and if an AI key is set, rewrites the
answer more conversationally. The AI is given the same data facts and told it may only use
numbers that appear in them, so it can't invent balances, fees or dates.
"""
import json
import os
from functools import lru_cache
from pathlib import Path

from app.services import llm

DEFAULT_DATA = Path(__file__).resolve().parents[3] / "frontend" / "data.js"


@lru_cache(maxsize=1)
def load_data() -> dict | None:
    path = Path(os.getenv("MERCER_DATA_PATH", DEFAULT_DATA))
    try:
        raw = path.read_text()
        return json.loads(raw[raw.index("=") + 1:].strip().rstrip(";"))
    except Exception:
        return None


def facts_summary(d: dict) -> str:
    """Compact, factual snapshot of the account for the AI prompt."""
    tx = d["transactions"]
    exp = [t for t in tx if t["type"] == "Expense" and t["amount"] < 0]
    months = sorted({t["date"][:7] for t in tx})
    by_month = {m: {} for m in months}
    for t in exp:
        cat = by_month[t["date"][:7]]
        cat[t["category"]] = round(cat.get(t["category"], 0) - t["amount"], 2)
    lines = [
        f"Customer: {d['person']['name']} (fictional demo). Data through {d['asOf']}.",
        f"Checking ${d['accounts']['checking']:,.2f}; savings ${d['accounts']['savings']:,.2f}.",
        "Safe to spend next 30 days: ${amount:,.2f} = checking minus bills ${bills:,.2f}, everyday reserve ${variable:,.2f}, "
        "savings ${savings:,.2f}, cushion ${buffer:,.2f}. No future paychecks assumed.".format(**d["safeToSpend"]),
        "Upcoming bills: " + "; ".join(f"{b['date']} {b['name']} ${b['amount']:,.2f}" for b in d["safeToSpend"]["upcoming"]),
        "Savings goals: " + "; ".join(f"{g['name']} ${g['saved']:,.0f} of ${g['target']:,.0f}, ${g['monthly']:,.0f}/mo, deadline {g['deadline']}" for g in d["goals"]),
        f"Paid semi-monthly by {d['person']['employer']} ({d['person']['payDays']}).",
    ]
    for m in months:
        total = sum(by_month[m].values())
        top = sorted(by_month[m].items(), key=lambda kv: -kv[1])
        lines.append(f"{m} spending ${total:,.2f}: " + ", ".join(f"{c} ${v:,.2f}" for c, v in top))
    return "\n".join(lines)


SYSTEM = """You are Mercer, First National Bank's money guide inside the bank's app.
Style: warm, plain English, short (under 90 words), no jargon, no filler, no "As an AI".
Grounding rules (strict):
- A DRAFT answer was computed directly from the customer's account data. Its facts and numbers are correct.
- Use ONLY numbers that appear in the DRAFT or in ACCOUNT FACTS. Never invent or estimate new figures.
- If the DRAFT says the data doesn't cover something, keep that. Do not guess.
- Keep any bullet lists from the DRAFT. You may add one short, practical suggestion.
- Use what you know about the customer (MEMORY) naturally, e.g. their name or goal, when relevant.
- No investment, legal or tax advice. This is educational."""


def ai_reply(message: str, draft: str, memory: dict, history: list[dict]) -> str | None:
    d = load_data()
    if not d:
        return None
    system = SYSTEM + "\n\nACCOUNT FACTS:\n" + facts_summary(d) + "\n\nMEMORY: " + json.dumps(memory or {})
    msgs = [{"role": "assistant" if h["role"] == "bot" else "user", "content": h["content"]} for h in history[-10:]]
    msgs.append({"role": "user", "content": f"{message}\n\n[DRAFT answer from the data: {draft}]"})
    return llm.chat_complete(system, msgs)
