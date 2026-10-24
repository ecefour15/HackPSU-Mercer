"""Contextual peer benchmarks, privacy-first.

Privacy rules this module enforces:
- Peer rows store only bands and ratios (never names, ids or exact incomes).
- Only users who opted in (share_anonymous_data) ever contribute a row.
- Stats are only shown for cohorts of at least MIN_COHORT_SIZE people (k-anonymity).
  If the exact cohort is too small, we widen it step by step and say so.
- The API returns aggregates only, rounded, never individual rows.
"""
import statistics

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Decision, DecisionType, PeerDataPoint, User
from app.services import finance


def _pct(values: list[float], q: float) -> float:
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = q * (len(s) - 1)
    lo, hi = int(idx), min(int(idx) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)


def _percentile_rank(values: list[float], x: float) -> int:
    below = sum(v < x for v in values)
    equal = sum(v == x for v in values)
    return round(100 * (below + 0.5 * equal) / len(values))


def _summary(values: list[float]) -> dict | None:
    if not values:
        return None
    return {
        "p25": round(_pct(values, 0.25), 3),
        "median": round(statistics.median(values), 3),
        "p75": round(_pct(values, 0.75), 3),
    }


def _cohort_rows(db: Session, d: Decision, band: str, stage, level: int) -> list[PeerDataPoint]:
    q = select(PeerDataPoint).where(PeerDataPoint.decision_type == d.decision_type)
    if level <= 1:
        q = q.where(PeerDataPoint.income_band == band)
    if level == 0:
        q = q.where(PeerDataPoint.life_stage == stage)
    return list(db.scalars(q))


def benchmark(db: Session, user: User, d: Decision) -> dict:
    band = finance.income_band(user.annual_income)
    levels = [
        ("same income band and life stage", {"income_band": band, "life_stage": user.life_stage.value}),
        ("same income band, any life stage", {"income_band": band}),
        ("everyone making this kind of decision", {}),
    ]
    rows, used = [], None
    for level, (label, filters) in enumerate(levels):
        rows = _cohort_rows(db, d, band, user.life_stage, level)
        if len(rows) >= settings.min_cohort_size:
            used = (label, filters)
            break

    cohort = {"decision_type": d.decision_type.value, "income_band": band, "life_stage": user.life_stage.value}
    if used is None:
        return {
            "decision_id": d.id,
            "cohort": cohort,
            "available": False,
            "message": "Not enough anonymous data yet for a private comparison. We never show groups smaller "
                       f"than {settings.min_cohort_size} people.",
        }

    label, filters = used
    amount_ratio = d.amount / user.annual_income if user.annual_income else None
    monthly = finance.new_monthly_cost(d)
    payment_ratio = monthly / user.monthly_income if user.monthly_income and monthly else None

    a_vals = [r.amount_to_income for r in rows]
    p_vals = [r.payment_to_income for r in rows if r.payment_to_income is not None]
    t_vals = [r.term_months for r in rows if r.term_months]
    apr_vals = [r.apr for r in rows if r.apr is not None]
    sat_vals = [r.satisfaction for r in rows if r.satisfaction is not None]

    peer_stats = {
        "cohort_size_band": "10-49" if len(rows) < 50 else ("50-199" if len(rows) < 200 else "200+"),
        "amount_to_income": _summary(a_vals),
        "payment_to_income": _summary(p_vals),
        "term_months": _summary(t_vals),
        "apr": _summary(apr_vals),
        "share_who_chose_alternative": round(sum(r.chose_alternative for r in rows) / len(rows), 2),
        "avg_satisfaction_out_of_5": round(statistics.mean(sat_vals), 1) if len(sat_vals) >= settings.min_cohort_size else None,
    }

    position = {}
    if amount_ratio is not None:
        position["amount_to_income"] = round(amount_ratio, 3)
        position["amount_percentile"] = _percentile_rank(a_vals, amount_ratio)
    if payment_ratio is not None and p_vals:
        position["payment_to_income"] = round(payment_ratio, 3)
        position["payment_percentile"] = _percentile_rank(p_vals, payment_ratio)
    if d.term_months and t_vals:
        position["term_percentile"] = _percentile_rank(t_vals, d.term_months)
    if d.apr is not None and apr_vals:
        position["apr_percentile"] = _percentile_rank(apr_vals, d.apr)

    return {
        "decision_id": d.id,
        "cohort": {**cohort, "matched_on": label, "filters": filters},
        "available": True,
        "message": f"Compared with people in a similar situation ({label}).",
        "your_position": position,
        "peer_stats": peer_stats,
        "reassurance": _reassurance(position, peer_stats),
    }


def _reassurance(pos: dict, stats: dict) -> str:
    parts = []
    ap = pos.get("amount_percentile")
    if ap is not None:
        if ap <= 75:
            parts.append(f"Your plan is in a normal range: about {ap}% of similar people spent less relative "
                         "to income, and plenty spent more.")
        elif ap <= 90:
            parts.append(f"You're on the higher side: about {ap}% of similar people spent less relative to income. "
                         "That's not wrong, but it's worth being sure it fits your goals.")
        else:
            parts.append(f"This is well above what most similar people choose (higher than about {ap}%). "
                         "Double-check the numbers before committing.")
    alt = stats.get("share_who_chose_alternative")
    if alt:
        parts.append(f"You're not alone in hesitating: {alt:.0%} of people in this group ended up choosing a "
                     "different or cheaper option.")
    return " ".join(parts) or "People in similar situations make this kind of decision in many different ways."


def contribute(db: Session, user: User, d: Decision, chose_alternative: bool = False) -> None:
    """Add an anonymized row when an opted-in user locks or abandons a decision."""
    if not user.share_anonymous_data or not user.annual_income:
        return
    monthly = finance.new_monthly_cost(d)
    db.add(PeerDataPoint(
        decision_type=d.decision_type,
        income_band=finance.income_band(user.annual_income),
        life_stage=user.life_stage,
        amount_to_income=round(d.amount / user.annual_income, 3),
        payment_to_income=round(monthly / user.monthly_income, 3) if monthly and user.monthly_income else None,
        term_months=d.term_months,
        apr=round(d.apr, 1) if d.apr is not None else None,
        chose_alternative=chose_alternative,
    ))
