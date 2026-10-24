"""Small, pure finance helpers shared by the services."""
from app.models import Decision, DecisionType, User

INCOME_BANDS = [
    (0, 25_000, "under_25k"),
    (25_000, 50_000, "25k_50k"),
    (50_000, 75_000, "50k_75k"),
    (75_000, 100_000, "75k_100k"),
    (100_000, 150_000, "100k_150k"),
    (150_000, float("inf"), "150k_plus"),
]


def income_band(annual_income: float) -> str:
    for low, high, label in INCOME_BANDS:
        if low <= annual_income < high:
            return label
    return "150k_plus"


def monthly_payment(principal: float, apr_percent: float | None, term_months: int | None) -> float:
    """Standard amortized payment. Zero APR is a straight split."""
    if principal <= 0 or not term_months:
        return 0.0
    if not apr_percent:
        return principal / term_months
    r = apr_percent / 100 / 12
    return principal * r / (1 - (1 + r) ** -term_months)


def total_interest(principal: float, apr_percent: float | None, term_months: int | None) -> float:
    if not term_months:
        return 0.0
    return monthly_payment(principal, apr_percent, term_months) * term_months - principal


def financed_amount(d: Decision) -> float:
    return max(d.amount - (d.down_payment or 0), 0)


def new_monthly_cost(d: Decision) -> float:
    """Monthly cash this decision adds, as best we can estimate it."""
    if d.decision_type == DecisionType.credit_card:
        # A card has no fixed payment. Use the user's expected monthly balance carried, if given.
        carried = float((d.extra or {}).get("expected_carried_balance", 0))
        interest = carried * (d.apr or 0) / 100 / 12
        return interest + (d.annual_fee or 0) / 12
    if d.decision_type == DecisionType.investment:
        return float((d.extra or {}).get("monthly_contribution", 0))
    payment = monthly_payment(financed_amount(d), d.apr, d.term_months)
    running = float((d.extra or {}).get("monthly_running_costs", 0))  # insurance, fuel, HOA...
    return payment + running


def debt_to_income(user: User, extra_monthly: float = 0) -> float:
    if user.monthly_income <= 0:
        return float("inf")
    return (user.monthly_debt_payments + extra_monthly) / user.monthly_income


def emergency_months(savings: float, monthly_expenses: float) -> float:
    if monthly_expenses <= 0:
        return float("inf")
    return savings / monthly_expenses
