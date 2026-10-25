"""
make_benchmark_cases.py: builds benchmark_cases.json.
 
IMPORTANT: this file deliberately does NOT import calculators.py. Expected
answers are computed with a different method (simulation and bisection instead
of the closed-form payment formula), so agreement between the two is real
evidence, not the code checking itself.
 
Run:  python make_benchmark_cases.py
"""
 
import json
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
 
 
def cents(x: float) -> str:
    return str(Decimal(str(round(x, 8))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
 
 
# ---- independent math -----------------------------------------------------
def payment_by_simulation(principal: float, apr: float, n: int) -> float:
    """Find the level payment that leaves a zero balance after n months (bisection)."""
    r = apr / 1200
    lo, hi = 0.0, principal * 2 + 1
    for _ in range(300):
        pay = (lo + hi) / 2
        bal = principal
        for _ in range(n):
            bal = bal * (1 + r) - pay
        if bal > 0:
            lo = pay
        else:
            hi = pay
    return (lo + hi) / 2
 
 
def apr_by_discounting(proceeds: float, pay: float, n: int) -> float:
    """Annual % rate where discounted payments equal proceeds (bisection, direct sum)."""
    lo, hi = 0.0, 1.0
    for _ in range(200):
        r = (lo + hi) / 2
        pv = sum(pay / (1 + r) ** k for k in range(1, n + 1))
        if pv > proceeds:
            lo = r
        else:
            hi = r
    return ((lo + hi) / 2) * 12 * 100
 
 
def loan_expected(price, down, apr, n, fees=0.0, financed=False):
    base = price - down
    principal = base + fees if financed else base
    pay = payment_by_simulation(principal, apr, n)
    total_paid = pay * n
    cash_signing = down + (0 if financed else fees)
    proceeds = base if financed else base - fees
    return {
        "amount_financed": cents(principal),
        "monthly_payment": cents(pay),
        "total_interest": cents(total_paid - principal),
        "total_cost": cents(cash_signing + total_paid),
        "cash_due_at_signing": cents(cash_signing),
        "true_apr_percent": cents(apr_by_discounting(proceeds, pay, n)),
    }
 
 
def lease_expected(cap, res, n, mf, signing=0.0, mfees=0.0, dispo=0.0):
    monthly = (cap - res) / n + (cap + res) * mf + mfees
    total = monthly * n + signing + dispo
    return {
        "monthly_payment_pre_tax": cents(monthly),
        "total_lease_cost": cents(total),
        "approx_apr_percent": cents(mf * 2400),
        "effective_cost_per_month": cents(total / n),
    }
 
 
def bnpl_expected(price, n, first_pct, apr=0.0, upfront=0.0, per=0.0, late_n=0, late_fee=0.0):
    first = price * first_pct / 100
    remaining = price - first
    later_n = n - 1
    later = payment_by_simulation(remaining, apr, later_n) if later_n > 0 else 0.0
    interest = later * later_n - remaining if later_n > 0 else 0.0
    fees = upfront + per * n + late_fee * late_n
    total = price + interest + fees
    return {
        "first_payment": cents(first),
        "later_payment_each": cents(later),
        "fees_total": cents(fees),
        "total_cost": cents(total),
        "extra_cost_vs_cash": cents(total - price),
    }
 
 
def card_expected(balance, apr, pay):
    r = apr / 1200
    bal, months, interest, paid = balance, 0, 0.0, 0.0
    while bal > 1e-9:
        i = bal * r
        interest += i
        bal += i
        p = min(pay, bal)
        bal -= p
        paid += p
        months += 1
    return {"months_to_payoff": str(months), "total_interest": cents(interest), "total_paid": cents(paid)}
 
 
# ---- cases ----------------------------------------------------------------
def build():
    cases = []
 
    # Auto loans -------------------------------------------------------------
    a1 = dict(price=24000, down_payment=4000, apr=6.0, term_months=60)
    cases.append({
        "id": "A1", "scenario": "auto_loan", "control": True,
        "title": "Straightforward used-car loan (no fees)",
        "offer_text": "Used sedan listed at $24,000. You put $4,000 down and finance the rest at 6.0% APR for 60 months. No dealer fees.",
        "inputs": a1,
        "expected": loan_expected(24000, 4000, 6.0, 60),
        "hidden_item": "None. This is a fair deal; the tool should NOT raise alarms.",
        "calculator_should_warn": False,
    })
 
    a2 = dict(price=27500, down_payment=2500, apr=5.9, term_months=72, upfront_fees=995, fees_financed=True)
    cases.append({
        "id": "A2", "scenario": "auto_loan", "control": False,
        "title": "Financed documentation fee raises the real rate",
        "offer_text": "New compact SUV at $27,500. $2,500 down, 5.9% APR for 72 months. A $995 documentation and admin fee is added to the amount financed.",
        "inputs": a2,
        "expected": loan_expected(27500, 2500, 5.9, 72, 995, True),
        "hidden_item": "The $995 fee is rolled into the loan, so the true APR is higher than the quoted 5.9%.",
        "calculator_should_warn": True,
    })
 
    pay_a3 = payment_by_simulation(32000, 7.5, 84)
    a3 = dict(price=32000, down_payment=0, apr=7.5, term_months=84)
    cases.append({
        "id": "A3", "scenario": "auto_loan", "control": False,
        "title": "Low monthly payment hides a very long term",
        "offer_text": f"Pickup truck at $32,000, nothing down. 'Just ${pay_a3:,.0f} a month!' Financed at 7.5% APR for 84 months.",
        "inputs": a3,
        "expected": loan_expected(32000, 0, 7.5, 84),
        "hidden_item": "An 84-month term means thousands in extra interest; the brief should show total interest, not just the monthly payment.",
        "calculator_should_warn": False,
    })
 
    cases.append({
        "id": "A4", "scenario": "auto_loan_compare", "control": False,
        "title": "0% APR or $2,000 rebate? Compare total cost",
        "offer_text": "Sedan priced at $30,000. Option A: 0% APR for 60 months, no rebate. Option B: take a $2,000 rebate (price becomes $28,000) and finance with a bank at 4.5% APR for 60 months. Nothing down either way.",
        "inputs": {
            "a": dict(price=30000, down_payment=0, apr=0.0, term_months=60),
            "b": dict(price=28000, down_payment=0, apr=4.5, term_months=60),
        },
        "expected": None,  # filled below
        "hidden_item": "Decision case: compare TOTAL cost of each option, not the APR or the payment alone.",
        "calculator_should_warn": False,
    })
    ea = loan_expected(30000, 0, 0.0, 60)
    eb = loan_expected(28000, 0, 4.5, 60)
    ta, tb = float(ea["total_cost"]), float(eb["total_cost"])
    cases[-1]["expected"] = {
        "a_total_cost": ea["total_cost"],
        "b_total_cost": eb["total_cost"],
        "cheaper": "A" if ta < tb else "B",
        "difference": cents(abs(ta - tb)),
    }
 
    a5 = dict(price=18000, down_payment=1000, apr=7.9, term_months=48, upfront_fees=600, fees_financed=False)
    cases.append({
        "id": "A5", "scenario": "auto_loan", "control": False,
        "title": "Dealer fee due at signing",
        "offer_text": "Used hatchback at $18,000. $1,000 down plus a $600 dealer fee due at signing. 7.9% APR for 48 months on the rest.",
        "inputs": a5,
        "expected": loan_expected(18000, 1000, 7.9, 48, 600, False),
        "hidden_item": "Cash needed at signing is $1,600, not $1,000, and the fee pushes the true APR above 7.9%.",
        "calculator_should_warn": True,
    })
 
    # Leases -----------------------------------------------------------------
    l1 = dict(cap_cost=36000, residual_value=21600, term_months=36, money_factor="0.00150",
              due_at_signing=2999, disposition_fee=395)
    cases.append({
        "id": "L1", "scenario": "lease", "control": False,
        "title": "Standard lease with a large due-at-signing amount",
        "offer_text": "36-month lease. Capitalized cost $36,000, residual value $21,600, money factor 0.00150. $2,999 due at signing and a $395 disposition fee at lease end.",
        "inputs": l1,
        "expected": lease_expected(36000, 21600, 36, 0.0015, 2999, 0.0, 395),
        "hidden_item": "$2,999 due at signing is much more than three monthly payments, so the 'low monthly' headline understates the cost.",
        "calculator_should_warn": True,
    })
 
    l2 = dict(l1, money_factor="0.00290")
    cases.append({
        "id": "L2", "scenario": "lease", "control": False,
        "title": "Marked-up money factor (about 7% APR)",
        "offer_text": "Same 36-month lease as above, but the paperwork shows a money factor of 0.00290 (the manufacturer's base rate was 0.00150). $2,999 due at signing, $395 disposition fee.",
        "inputs": l2,
        "expected": lease_expected(36000, 21600, 36, 0.0029, 2999, 0.0, 395),
        "hidden_item": "A money factor of 0.00290 is roughly a 6.96% APR, nearly double the base rate; the money factor is negotiable.",
        "calculator_should_warn": True,
    })
 
    l3 = dict(cap_cost=28000, residual_value=16800, term_months=24, money_factor="0.00110",
              due_at_signing=0, monthly_fees=12, disposition_fee=0)
    cases.append({
        "id": "L3", "scenario": "lease", "control": False,
        "title": "Small monthly fee that adds up",
        "offer_text": "24-month lease. Capitalized cost $28,000, residual value $16,800, money factor 0.00110. $0 due at signing. A $12 monthly 'service fee' is added to each payment.",
        "inputs": l3,
        "expected": lease_expected(28000, 16800, 24, 0.0011, 0.0, 12.0, 0.0),
        "hidden_item": "The $12 monthly fee adds $288 over the lease; the brief should include it in the real monthly cost.",
        "calculator_should_warn": False,
    })
 
    # BNPL -------------------------------------------------------------------
    b1 = dict(price=400, installments=4, first_payment_percent=25)
    cases.append({
        "id": "B1", "scenario": "bnpl", "control": True,
        "title": "Plain pay-in-4, no fees (control)",
        "offer_text": "Pay in 4 for a $400 jacket: $100 today and three payments of $100 every two weeks. No interest, no fees.",
        "inputs": b1,
        "expected": bnpl_expected(400, 4, 25),
        "hidden_item": "None. Costs exactly the cash price; the tool should NOT raise alarms.",
        "calculator_should_warn": False,
    })
 
    b2 = dict(price=1000, installments=6, first_payment_percent=20, interest_apr=29.99)
    cases.append({
        "id": "B2", "scenario": "bnpl", "control": False,
        "title": "Interest-bearing installment plan",
        "offer_text": "Laptop bag set for $1,000. Pay 20% today and the remaining 5 monthly payments at 29.99% APR.",
        "inputs": b2,
        "expected": bnpl_expected(1000, 6, 20, apr=29.99),
        "hidden_item": "Not 'free' financing: the plan carries a high APR and costs extra over the cash price.",
        "calculator_should_warn": True,
    })
 
    b3 = dict(price=600, installments=4, first_payment_percent=25, fee_per_installment=3,
              late_payments=2, late_fee=7)
    cases.append({
        "id": "B3", "scenario": "bnpl", "control": False,
        "title": "Per-payment fees plus two late payments",
        "offer_text": "Pay in 4 for a $600 purchase, $3 convenience fee on each installment. Assume two payments are late, each with a $7 late fee.",
        "inputs": b3,
        "expected": bnpl_expected(600, 4, 25, per=3, late_n=2, late_fee=7),
        "hidden_item": "Fees total $26 on a 'no-interest' plan: $12 in installment fees plus $14 in late fees.",
        "calculator_should_warn": True,
    })
 
    # Card -------------------------------------------------------------------
    c1 = dict(balance=3000, apr=24, monthly_payment=100)
    cases.append({
        "id": "C1", "scenario": "card", "control": False,
        "title": "Paying a flat $100/month on a high-APR card",
        "offer_text": "Credit card balance of $3,000 at 24% APR. You plan to pay $100 a month and make no new purchases.",
        "inputs": c1,
        "expected": card_expected(3000, 24, 100),
        "hidden_item": "Nearly four years to pay off and over $1,600 in interest; show how a larger payment shortens this.",
        "calculator_should_warn": False,
    })
 
    return cases
 
 
if __name__ == "__main__":
    cases = build()
    out = Path(__file__).with_name("benchmark_cases.json")
    out.write_text(json.dumps({"cases": cases}, indent=2), encoding="utf-8")
    print(f"Wrote {len(cases)} cases to {out.name}")
    for c in cases:
        print(c["id"], c["expected"])