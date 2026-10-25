"""Optional LLM narrative for the Devil's Advocate report.

The LLM only rewrites findings the rules engine already computed into a short,
balanced summary. Works with either an OpenAI key (OPENAI_API_KEY, same key as
the Streamlit app) or an Anthropic key (ANTHROPIC_API_KEY). If neither is set,
or the call fails, the report is returned without a narrative instead of erroring.
"""
import json
import logging

from app.config import settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a calm, balanced "devil's advocate" inside a personal-finance app.
You receive a decision and a list of findings that were already computed.
Write 3-5 sentences in plain language that:
- acknowledge what the user got right,
- name the one or two most important risks,
- suggest one concrete thing to check before committing.
Rules: use ONLY numbers that appear in the input. Do not invent rates, fees or figures.
Do not tell the user what to decide. Do not be alarmist or preachy. No bullet points."""


def _openai(payload: str) -> str | None:
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=settings.openai_model,
        max_tokens=400,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": payload}],
    )
    return (resp.choices[0].message.content or "").strip() or None


def _anthropic(payload: str) -> str | None:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": payload}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip() or None


def write_narrative(decision_summary: dict, report: dict) -> str | None:
    if not (settings.openai_api_key or settings.anthropic_api_key):
        return None
    payload = json.dumps({
        "decision": decision_summary,
        "risk_level": report["risk_level"],
        "what_looks_solid": report["what_looks_solid"],
        "blind_spots": report["blind_spots"],
        "worst_case_scenarios": report["worst_case_scenarios"],
        "key_numbers": report["key_numbers"],
    })
    try:
        return _openai(payload) if settings.openai_api_key else _anthropic(payload)
    except Exception as exc:  # network, auth, rate limit, missing package...
        log.warning("LLM narrative failed, returning report without it: %s", exc)
        return None


def chat_complete(system: str, messages: list[dict], max_tokens: int = 350) -> str | None:
    """Generic chat call used by Mercer's /chat. Returns None if no key or on any error."""
    if not (settings.openai_api_key or settings.anthropic_api_key):
        return None
    try:
        if settings.openai_api_key:
            from openai import OpenAI

            client = OpenAI(api_key=settings.openai_api_key)
            resp = client.chat.completions.create(
                model=settings.openai_model, max_tokens=max_tokens, temperature=0.3,
                messages=[{"role": "system", "content": system}, *messages],
            )
            return (resp.choices[0].message.content or "").strip() or None
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(model=settings.anthropic_model, max_tokens=max_tokens, system=system, messages=messages)
        return "".join(b.text for b in msg.content if b.type == "text").strip() or None
    except Exception as exc:
        log.warning("chat_complete failed, using grounded local reply: %s", exc)
        return None
