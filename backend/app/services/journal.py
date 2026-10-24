"""Decision Journal & Emotional Check-in.

Scores how much a decision looks emotion-led vs strategy-led, based on the
emotions logged, outside pressure, deadlines and the reason the user wrote.
Recommends a cooling-off period when the signals point to an impulse.
"""
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.models import Emotion

IMPULSE_EMOTIONS = {Emotion.excited, Emotion.fomo, Emotion.impulsive}
DISTRESS_EMOTIONS = {Emotion.anxious, Emotion.overwhelmed, Emotion.guilty}
GROUNDED_EMOTIONS = {Emotion.calm, Emotion.confident}

URGENCY_WORDS = r"\b(limited|today only|ends|deal|sale|last chance|before it'?s gone|everyone|hurry|now or never)\b"
JUSTIFY_WORDS = r"\b(deserve|treat myself|why not|yolo|just want)\b"
PLAN_WORDS = r"\b(budget|saved|saving|plan|goal|compared|need|replace|replacing|research|afford|emergency fund)\b"


def analyze(reason: str, emotions: list[Emotion], intensity: int,
            pressure_source: str | None, deadline_hours: int | None) -> dict:
    text = reason.lower()
    emo = set(emotions)
    signals: list[str] = []
    score = 0  # 0 = calm strategy, 100 = pure impulse

    impulse = emo & IMPULSE_EMOTIONS
    if impulse:
        pts = 10 * len(impulse) + 5 * intensity
        score += pts
        signals.append(f"You feel {', '.join(e.value for e in impulse)}, which can speed decisions up.")
    if Emotion.pressured in emo or pressure_source:
        score += 20
        src = f" from {pressure_source}" if pressure_source else ""
        signals.append(f"There's outside pressure{src}. Pressure is often a sales tactic, not a real deadline.")
    distress = emo & DISTRESS_EMOTIONS
    if distress:
        score += 5 * intensity
        signals.append(f"You're feeling {', '.join(e.value for e in distress)}. Big decisions made to "
                       "relieve stress can be hard to undo.")
    if deadline_hours is not None and deadline_hours < 48:
        score += 15
        signals.append(f"You feel you must decide within {deadline_hours} hours.")
    if re.search(URGENCY_WORDS, text):
        score += 10
        signals.append("Your reason mentions urgency (a sale, a deadline, 'everyone').")
    if re.search(JUSTIFY_WORDS, text):
        score += 10
        signals.append("Your reason leans on wanting or deserving it more than on a plan.")

    grounded_points = []
    if re.search(PLAN_WORDS, text):
        score -= 15
        grounded_points.append("Your reason mentions a plan, budget or real need.")
    if re.search(r"\$?\d", text):
        score -= 10
        grounded_points.append("You've thought about actual numbers.")
    if emo & GROUNDED_EMOTIONS and not impulse:
        score -= 10
        grounded_points.append("You describe feeling calm or confident about it.")
    if len(reason.split()) >= 40:
        score -= 5
        grounded_points.append("You wrote a detailed reason, a sign of thinking it through.")

    score = max(0, min(100, score))
    mode = "emotion_led" if score >= 50 else ("mixed" if score >= 25 else "strategy_led")
    cooling = score >= 50 or (Emotion.pressured in emo and intensity >= 4)
    until = (datetime.now(timezone.utc) + timedelta(hours=settings.cooling_off_hours)) if cooling else None

    prompts = {
        "emotion_led": [
            "Picture yourself 6 months from now. Are you glad you did this?",
            "What would you tell a friend in exactly this situation?",
            "If the deal really ends, what's the actual cost of missing it?",
        ],
        "mixed": [
            "Which part of your reason would still be true next month?",
            "What's the one number you're least sure about?",
        ],
        "strategy_led": [
            "What would make you change your mind?",
            "Have you checked the Devil's Advocate report for anything you missed?",
        ],
    }[mode]

    return {
        "impulse_score": score,
        "decision_mode": mode,
        "summary": {
            "emotion_led": "This looks more emotion-led than planned. That's human, and worth slowing down for.",
            "mixed": "There's a real reason here plus some emotional pull. Good to separate the two.",
            "strategy_led": "This reads like a considered decision.",
        }[mode],
        "emotional_signals": signals,
        "grounding_signals": grounded_points,
        "cooling_off_recommended": cooling,
        "cooling_off_until": until.isoformat() if until else None,
        "reflection_prompts": prompts,
    }


def insights(entries) -> dict:
    """Patterns across a user's past entries: which feelings led to decisions they were happy with."""
    by_emotion = defaultdict(list)
    by_mode = defaultdict(list)
    for e in entries:
        if e.outcome_rating is None:
            continue
        for em in e.emotions:
            by_emotion[em].append(e.outcome_rating)
        by_mode[e.analysis.get("decision_mode", "unknown")].append(e.outcome_rating)

    avg = lambda xs: round(sum(xs) / len(xs), 2)
    emo_stats = {k: {"avg_outcome": avg(v), "count": len(v)} for k, v in by_emotion.items()}
    mode_stats = {k: {"avg_outcome": avg(v), "count": len(v)} for k, v in by_mode.items()}

    observations = []
    rated = [e for e in entries if e.outcome_rating is not None]
    if len(rated) >= 3:
        best = max(emo_stats.items(), key=lambda kv: kv[1]["avg_outcome"])
        worst = min(emo_stats.items(), key=lambda kv: kv[1]["avg_outcome"])
        if best[0] != worst[0]:
            observations.append(f"Decisions you made while feeling {best[0]} turned out best on average "
                                 f"({best[1]['avg_outcome']}/5); ones made while {worst[0]} turned out worst "
                                 f"({worst[1]['avg_outcome']}/5).")
    else:
        observations.append("Rate the outcome of a few past decisions to start seeing your patterns.")

    return {
        "entries": len(entries),
        "rated_entries": len(rated),
        "by_emotion": emo_stats,
        "by_decision_mode": mode_stats,
        "observations": observations,
    }
