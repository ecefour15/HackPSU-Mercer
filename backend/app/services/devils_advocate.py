"""The AI "Devil's Advocate".

Two layers:
1. A deterministic rules engine that computes the numbers and findings. This is
   the source of truth, is fully testable, and works with no API key.
2. An optional LLM pass (see llm.py) that turns those findings into a short,
   friendly narrative. The LLM is never asked to invent numbers.
"""
from app.models import Decision, DecisionType, User
from app.services import finance

SEVERITY_ORDER = {"info": 0, "caution": 1, "warning": 2, "critical": 3}
DISCLAIMER = (
    "This is an educational stress-test, not financial advice. It is based only on the numbers "
    "you entered; consider talking to a qualified advisor for big decisions."
)


def _money(x: float) -> str:
    return f"${x:,.0f}"


def build_report(user: User, d: Decision) -> dict:
    monthly_cost = finance.new_monthly_cost(d)
    dti_before = finance.debt_to_income(user)
    dti_after = finance.debt_to_income(user, monthly_cost)
    savings_after = user.liquid_savings - (d.down_payment or 0)
    if d.decision_type == DecisionType.investment:
        savings_after -= d.amount
    runway_before = finance.emergency_months(user.liquid_savings, user.monthly_expenses)
    runway_after = finance.emergency_months(max(savings_after, 0), user.monthly_expenses + monthly_cost)
    interest = finance.total_interest(finance.financed_amount(d), d.apr, d.term_months)
    leftover = user.monthly_income - user.monthly_expenses - user.monthly_debt_payments - monthly_cost

    key_numbers = {
        "new_monthly_cost": round(monthly_cost, 2),
        "debt_to_income_before": round(dti_before, 3),
        "debt_to_income_after": round(dti_after, 3),
        "emergency_fund_months_before": round(runway_before, 1),
        "emergency_fund_months_after": round(runway_after, 1),
        "total_interest_over_term": round(interest, 2),
        "monthly_leftover_after": round(leftover, 2),
        "amount_to_annual_income": round(d.amount / user.annual_income, 3) if user.annual_income else None,
    }

    blind_spots: list[dict] = []
    solid: list[str] = []

    def flag(title, detail, severity):
        blind_spots.append({"title": title, "detail": detail, "severity": severity})

    # ---- Checks that apply to every decision ----
    if dti_after > 0.43:
        flag("Debt load would be very high",
             f"Debt payments would take {dti_after:.0%} of your monthly income. Most lenders treat "
             "anything above 43% as a stretch, and it leaves little room for surprises.", "critical")
    elif dti_after > 0.36:
        flag("Debt load is getting heavy",
             f"Debt payments would rise to {dti_after:.0%} of income (from {dti_before:.0%}). "
             "Above roughly 36% is where budgets usually start to feel tight.", "warning")
    elif monthly_cost > 0:
        solid.append(f"Your debt-to-income stays manageable at {dti_after:.0%}.")

    if runway_after < 1:
        flag("Almost no safety net",
             f"After this you'd have under one month of expenses saved ({_money(max(savings_after, 0))}). "
             "One car repair or missed paycheck could push this onto a credit card.", "critical")
    elif runway_after < 3:
        flag("Thin emergency fund",
             f"You'd have about {runway_after:.1f} months of expenses saved. The usual target is 3 to 6.",
             "warning")
    else:
        solid.append(f"You'd still have about {runway_after:.1f} months of expenses in savings.")

    if leftover < 0:
        flag("Monthly budget goes negative",
             f"Income minus expenses, debt and this new cost leaves {_money(leftover)} a month. "
             "The gap would have to come from savings or more borrowing.", "critical")
    elif user.monthly_income and leftover < 0.05 * user.monthly_income:
        flag("Very little breathing room",
             f"Only about {_money(leftover)} a month would be left over after everything.", "caution")

    # ---- Type-specific checks ----
    extra = d.extra or {}
    t = d.decision_type

    if t == DecisionType.credit_card:
        carried = float(extra.get("expected_carried_balance", 0))
        apr = d.apr or 0
        if carried > 0 and apr >= 20:
            yearly = carried * apr / 100
            flag("Carrying a balance is expensive here",
                 f"At {apr:.2f}% APR, carrying {_money(carried)} costs about {_money(yearly)} a year in interest, "
                 "which usually wipes out any rewards.", "warning")
        if extra.get("is_promo_apr"):
            months = extra.get("promo_months", "?")
            flag("The promo rate ends",
                 f"The intro rate lasts {months} months. Any balance left after that jumps to the regular APR, "
                 "and some cards charge interest back to the purchase date (deferred interest).", "caution")
        if d.annual_fee and d.annual_fee > 0:
            rewards = float(extra.get("expected_annual_rewards", 0))
            if rewards < d.annual_fee:
                flag("Annual fee may outweigh rewards",
                     f"You expect {_money(rewards)} in rewards against a {_money(d.annual_fee)} fee.", "caution")
            else:
                solid.append("Your expected rewards cover the annual fee.")
        if user.credit_score is not None and user.credit_score < 670:
            flag("Approval and rate risk",
                 "With a fair or lower credit score, a hard inquiry may lower your score a little and the APR "
                 "offered could be higher than advertised.", "info")

    elif t == DecisionType.car_purchase:
        if user.annual_income and d.amount > 0.35 * user.annual_income:
            flag("Car price is high relative to income",
                 f"{_money(d.amount)} is {d.amount / user.annual_income:.0%} of your yearly income. A common rule "
                 "of thumb keeps a car under about 35%.", "warning")
        if d.term_months and d.term_months > 60:
            flag("Long loan term",
                 f"A {d.term_months}-month loan means lower payments but more interest, and cars lose value fast, "
                 "so you could owe more than the car is worth for years.", "warning")
        if d.down_payment < 0.10 * d.amount:
            flag("Small down payment",
                 "Putting less than 10% down raises the chance of being 'underwater' on the loan early on.",
                 "caution")
        if not extra.get("monthly_running_costs"):
            flag("Running costs not included",
                 "Insurance, fuel, maintenance and registration are often $300-600+ a month on top of the payment. "
                 "Add them as monthly_running_costs for a fuller picture.", "info")

    elif t in (DecisionType.personal_loan, DecisionType.home_purchase):
        if d.apr and d.apr >= 15 and t == DecisionType.personal_loan:
            flag("High interest rate",
                 f"At {d.apr:.2f}% you'd pay {_money(interest)} in interest over the loan.", "warning")
        if t == DecisionType.home_purchase:
            if d.down_payment < 0.20 * d.amount:
                flag("Under 20% down",
                     "This usually means private mortgage insurance (PMI) on top of the payment.", "caution")
            if user.annual_income and d.amount > 4 * user.annual_income:
                flag("Price is a big multiple of income",
                     f"The home costs {d.amount / user.annual_income:.1f}x your yearly income.", "warning")
            flag("Hidden costs of owning",
                 "Closing costs (often 2-5%), property tax, insurance and maintenance (~1% of value a year) "
                 "aren't in the loan payment.", "info")

    elif t == DecisionType.investment:
        if runway_before < 3:
            flag("Investing before the safety net is built",
                 "If you need cash in an emergency, you might have to sell at a loss.", "warning")
        if user.liquid_savings and d.amount > 0.5 * user.liquid_savings:
            flag("Large share of your savings",
                 f"This puts {d.amount / user.liquid_savings:.0%} of your liquid savings into one move.", "warning")
        asset = str(extra.get("asset_class", "")).lower()
        if asset in {"single_stock", "crypto", "options"}:
            flag("Concentrated or volatile asset",
                 f"{asset.replace('_', ' ').title()} can drop 50% or more. Ask whether you could hold through that.",
                 "warning")

    # ---- Worst-case scenarios ----
    scenarios = []
    job_loss_burn = user.monthly_expenses + user.monthly_debt_payments + monthly_cost
    job_loss_months = max(savings_after, 0) / job_loss_burn if job_loss_burn else float("inf")
    scenarios.append({
        "name": "You lose your income",
        "description": "No paycheck while you look for a new job.",
        "impact": f"Your savings would cover everything for about {job_loss_months:.1f} months.",
    })
    cut = user.monthly_income * 0.8 - user.monthly_expenses - user.monthly_debt_payments - monthly_cost
    scenarios.append({
        "name": "Income drops 20%",
        "description": "Fewer hours, a pay cut, or a lower-paying job.",
        "impact": (f"You'd be short {_money(-cut)} every month." if cut < 0
                   else f"You'd still have about {_money(cut)} a month left over."),
    })
    if t == DecisionType.credit_card and d.apr:
        bal = float(extra.get("expected_carried_balance", 0)) or d.amount * 0.5
        min_pay = max(bal * 0.02, 25)
        scenarios.append({
            "name": "You only make minimum payments",
            "description": f"Carrying {_money(bal)} and paying about {_money(min_pay)} a month.",
            "impact": f"About {_money(bal * d.apr / 100 / 12)} of that first payment would be interest alone.",
        })
    if t == DecisionType.car_purchase:
        resale = d.amount * 0.6
        scenarios.append({
            "name": "You need to sell in 2-3 years",
            "description": "Cars often lose about 40% of their value in the first few years.",
            "impact": f"It might sell for roughly {_money(resale)}, possibly less than the loan balance.",
        })
    if t == DecisionType.investment:
        scenarios.append({
            "name": "The market falls 30%",
            "description": "A normal bear market.",
            "impact": f"{_money(d.amount)} would be worth about {_money(d.amount * 0.7)} on paper.",
        })
    if d.apr and d.decision_type not in (DecisionType.credit_card, DecisionType.investment) and extra.get("variable_rate"):
        stressed = finance.monthly_payment(finance.financed_amount(d), d.apr + 3, d.term_months)
        scenarios.append({
            "name": "Rates rise 3 points",
            "description": "Your variable rate resets higher.",
            "impact": f"The payment would rise to about {_money(stressed)} a month.",
        })

    # ---- Alternatives ----
    alternatives = {
        DecisionType.credit_card: [
            ("A no-annual-fee card", "Keeps the credit-building benefit without a yearly cost."),
            ("Wait and pay down existing balances first", "A lower utilization ratio can get you better offers later."),
            ("A secured card or credit-builder loan", "Safer if your goal is mainly building credit."),
        ],
        DecisionType.car_purchase: [
            ("A certified pre-owned car", "Someone else absorbs the steepest depreciation."),
            ("A shorter loan or bigger down payment", "Less interest and less risk of owing more than it's worth."),
            ("Get pre-approved at a credit union first", "Gives you a rate to compare against dealer financing."),
        ],
        DecisionType.personal_loan: [
            ("A 0% balance-transfer card (if consolidating)", "Can be cheaper if you can repay within the promo window."),
            ("Credit union loan", "Often lower rates than online lenders."),
            ("Save for it over a few months", "Avoids interest entirely if it isn't urgent."),
        ],
        DecisionType.home_purchase: [
            ("Rent a bit longer and grow the down payment", "Reaching 20% avoids PMI."),
            ("A less expensive home or different area", "Keeps housing costs nearer 28% of income."),
            ("Compare at least three lenders", "Small rate differences add up to thousands."),
        ],
        DecisionType.investment: [
            ("A broad, low-cost index fund", "Spreads risk across many companies."),
            ("Invest gradually (dollar-cost averaging)", "Reduces the risk of buying at a peak."),
            ("Finish the emergency fund first", "So you're never forced to sell in a downturn."),
        ],
        DecisionType.other: [
            ("Wait 30 days", "If you still want it after a month, it's less likely to be an impulse."),
            ("A cheaper version", "Often gets you most of the benefit for less."),
        ],
    }[t]

    questions = [
        "If this exact offer disappeared tomorrow, how would you honestly feel?",
        "What would you have to give up each month to afford this?",
        "Who benefits most if you decide today rather than next week?",
        "Would you still do this if your income dropped next year?",
    ]

    worst = max((SEVERITY_ORDER[b["severity"]] for b in blind_spots), default=0)
    criticals = sum(b["severity"] == "critical" for b in blind_spots)
    warnings = sum(b["severity"] == "warning" for b in blind_spots)
    if criticals:
        risk = "critical"
    elif warnings >= 2 or worst == 2:
        risk = "high" if warnings >= 2 else "moderate"
    elif worst == 1:
        risk = "moderate"
    else:
        risk = "low"

    headlines = {
        "low": "This looks well thought through. Here are a few things to double-check.",
        "moderate": "Mostly reasonable, with a couple of things worth a second look.",
        "high": "There are real risks here. Worth pausing to compare alternatives.",
        "critical": "This could seriously strain your finances. Please review before committing.",
    }

    blind_spots.sort(key=lambda b: -SEVERITY_ORDER[b["severity"]])
    return {
        "risk_level": risk,
        "headline": headlines[risk],
        "what_looks_solid": solid,
        "blind_spots": blind_spots,
        "worst_case_scenarios": scenarios,
        "alternatives": [{"option": o, "why_consider": w} for o, w in alternatives],
        "questions_to_ask_yourself": questions,
        "key_numbers": key_numbers,
        "disclaimer": DISCLAIMER,
    }
