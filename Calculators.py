"""
calculators.py: deterministic finance calculators (no AI, no network).
 
Design rules (these are the "trust" story for the demo):
  1. The LLM never does the math. Everything numeric comes from this file.
  2. Decimal arithmetic, not floats. Rounding to cents happens ONLY at output.
  3. Every function returns a CalcResult with the formula name and assumptions,
     so the UI can show its work.
  4. Bad input raises CalcError instead of returning a wrong number.
 
Rates are passed as PERCENT values (6.0 means 6%), money as numbers or strings.
"""
 
from __future__ import annotations
 
from dataclasses import dataclass, field
from decimal import Decimal, getcontext, ROUND_HALF_UP
from typing import Union
 
getcontext().prec = 28
 
Number = Union[int, float, str, Decimal]
 
CENT = Decimal("0.01")
ZERO = Decimal("0")
TWELVE = Decimal("12")
HUNDRED = Decimal("100")
 
 
class CalcError(ValueError):
    """Raised when inputs are invalid. Show this message to the user."""
 
 
# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def D(x: Number) -> Decimal:
    """Convert to Decimal safely (via str so 0.1 stays 0.1)."""
    if isinstance(x, Decimal):
        return x
    try:
        return Decimal(str(x))
    except Exception as exc:  # noqa: BLE001
        raise CalcError(f"Not a valid number: {x!r}") from exc
 
 
def money(x: Decimal) -> Decimal:
    """Round to cents (display rounding only)."""
    return x.quantize(CENT, rounding=ROUND_HALF_UP)
 
 
def _need_positive(name: str, v: Decimal) -> None:
    if v <= 0:
        raise CalcError(f"{name} must be greater than 0.")
 
 
def _need_nonnegative(name: str, v: Decimal) -> None:
    if v < 0:
        raise CalcError(f"{name} cannot be negative.")
 
 
def _need_months(term_months: int) -> int:
    if not isinstance(term_months, int) or isinstance(term_months, bool):
        raise CalcError("Term must be a whole number of months.")
    if term_months < 1 or term_months > 600:
        raise CalcError("Term must be between 1 and 600 months.")
    return term_months
 
 
def _need_apr(apr: Decimal) -> None:
    if apr < 0 or apr > 200:
        raise CalcError("APR must be between 0% and 200%.")
 
 
@dataclass
class CalcResult:
    formula_name: str
    outputs: dict[str, Decimal]
    assumptions: dict[str, str]
    warnings: list[str] = field(default_factory=list)
 
    def to_dict(self) -> dict:
        """JSON-friendly version (Decimals become strings). Hand this to the API/UI."""
        return {
            "formula_name": self.formula_name,
            "outputs": {k: str(v) for k, v in self.outputs.items()},
            "assumptions": self.assumptions,
            "warnings": self.warnings,
        }
 
 
# --------------------------------------------------------------------------
# 1. Loan payment and summary
# --------------------------------------------------------------------------
def loan_payment(principal: Number, apr: Number, term_months: int) -> Decimal:
    """
    Monthly payment (unrounded) for a fixed-rate amortizing loan.
        M = P * r / (1 - (1 + r) ** -n)      r = APR / 12
    0% APR is handled separately: M = P / n.
    """
    p, a = D(principal), D(apr)
    n = _need_months(term_months)
    _need_positive("Principal", p)
    _need_apr(a)
    if a == 0:
        return p / n
    r = a / HUNDRED / TWELVE
    return p * r / (1 - (1 + r) ** (-n))
 
 
def loan_summary(
    price: Number,
    down_payment: Number,
    apr: Number,
    term_months: int,
    upfront_fees: Number = 0,
    fees_financed: bool = False,
) -> CalcResult:
    """
    Full loan picture, including the "true APR" once fees are counted.
 
    upfront_fees: documentation/origination/dealer fees, etc.
    fees_financed: True = fees are rolled into the loan; False = paid at signing.
    """
    price_d, down, a, fees = D(price), D(down_payment), D(apr), D(upfront_fees)
    n = _need_months(term_months)
    _need_positive("Price", price_d)
    _need_nonnegative("Down payment", down)
    _need_nonnegative("Fees", fees)
    _need_apr(a)
    if down >= price_d:
        raise CalcError("Down payment must be less than the price.")
 
    base = price_d - down
    principal = base + fees if fees_financed else base
    payment = loan_payment(principal, a, n)
    total_paid = payment * n
    interest = total_paid - principal
 
    # Value actually received vs. what you pay: this is how fees raise the real rate.
    proceeds = base if fees_financed else base - fees
    cash_at_signing = down + (ZERO if fees_financed else fees)
    true_apr = effective_apr(proceeds, payment, n)
 
    # Total cost of ownership = everything paid out of pocket for the item.
    total_cost = cash_at_signing + total_paid
    cost_over_price = total_cost - price_d
 
    warnings = []
    if true_apr - a >= Decimal("0.5"):
        warnings.append(
            f"Fees raise the real borrowing rate from {a}% to about {money(true_apr)}%."
        )
 
    return CalcResult(
        formula_name="Fixed-rate amortizing loan",
        outputs={
            "amount_financed": money(principal),
            "monthly_payment": money(payment),
            "total_interest": money(interest),
            "total_of_payments": money(total_paid),
            "cash_due_at_signing": money(cash_at_signing),
            "total_cost": money(total_cost),
            "cost_above_sticker_price": money(cost_over_price),
            "true_apr_percent": money(true_apr),
        },
        assumptions={
            "payment_formula": "M = P*r / (1 - (1+r)^-n), r = APR/12",
            "payments": "Equal monthly payments, paid at end of each month",
            "fees": "Rolled into loan" if fees_financed else "Paid at signing",
            "rounding": "Cents, applied to displayed outputs only",
            "taxes_and_insurance": "Not included",
        },
        warnings=warnings,
    )
 
 
def effective_apr(proceeds: Number, payment: Number, term_months: int) -> Decimal:
    """
    The annual rate that makes `payment` x `term_months` repay `proceeds`.
    Solved by bisection (the only float use in this file; converted back to
    Decimal). Returns percent, e.g. Decimal('7.31').
    """
    pr, pay = D(proceeds), D(payment)
    n = _need_months(term_months)
    _need_positive("Proceeds", pr)
    _need_positive("Payment", pay)
    if pay * n <= pr:
        return ZERO
 
    target = float(pr)
    pay_f = float(pay)
 
    def present_value(rate: float) -> float:
        if rate == 0:
            return pay_f * n
        return pay_f * (1 - (1 + rate) ** (-n)) / rate
 
    lo, hi = 0.0, 1.0  # monthly rate between 0% and 100%
    for _ in range(200):
        mid = (lo + hi) / 2
        if present_value(mid) > target:
            lo = mid
        else:
            hi = mid
    return D(f"{((lo + hi) / 2) * 12 * 100:.6f}")
 
 
def amortization_schedule(principal: Number, apr: Number, term_months: int) -> list[dict]:
    """
    Month-by-month schedule for the 'what if' panel. The last payment absorbs
    rounding so the balance ends at exactly 0.00.
    """
    p, a = D(principal), D(apr)
    n = _need_months(term_months)
    _need_positive("Principal", p)
    _need_apr(a)
 
    pay = money(loan_payment(p, a, n))
    r = a / HUNDRED / TWELVE
    balance = p
    rows = []
    for m in range(1, n + 1):
        interest = money(balance * r)
        pay_m = pay if m < n else money(balance + interest)
        principal_part = pay_m - interest
        balance = balance - principal_part
        rows.append(
            {
                "month": m,
                "payment": pay_m,
                "interest": interest,
                "principal": principal_part,
                "balance": money(balance),
            }
        )
    return rows
 
 
# --------------------------------------------------------------------------
# 2. Lease
# --------------------------------------------------------------------------
def lease_cost(
    cap_cost: Number,
    residual_value: Number,
    term_months: int,
    money_factor: Number,
    due_at_signing: Number = 0,
    monthly_fees: Number = 0,
    disposition_fee: Number = 0,
) -> CalcResult:
    """
    Pre-tax lease payment and total cost.
        depreciation  = (cap_cost - residual) / term
        rent_charge   = (cap_cost + residual) * money_factor
        monthly       = depreciation + rent_charge (+ monthly fees)
    Money factor x 2400 approximates the APR.
    """
    cap, res = D(cap_cost), D(residual_value)
    mf = D(money_factor)
    signing, mfees, dispo = D(due_at_signing), D(monthly_fees), D(disposition_fee)
    n = _need_months(term_months)
    _need_positive("Capitalized cost", cap)
    _need_positive("Residual value", res)
    _need_nonnegative("Money factor", mf)
    for label, v in (("Due at signing", signing), ("Monthly fees", mfees), ("Disposition fee", dispo)):
        _need_nonnegative(label, v)
    if res >= cap:
        raise CalcError("Residual value must be less than the capitalized cost.")
    if mf > Decimal("0.01"):
        raise CalcError(
            "Money factor looks too high (typical values are like 0.0012). "
            "Did you enter an APR by mistake?"
        )
 
    depreciation = (cap - res) / n
    rent_charge = (cap + res) * mf
    base_monthly = depreciation + rent_charge
    monthly = base_monthly + mfees
    total_payments = monthly * n
    total_cost = total_payments + signing + dispo
    approx_apr = mf * Decimal("2400")
 
    warnings = []
    if signing > monthly * 3:
        warnings.append("Due-at-signing is large relative to the monthly payment.")
 
    return CalcResult(
        formula_name="Closed-end vehicle lease",
        outputs={
            "monthly_depreciation": money(depreciation),
            "monthly_rent_charge": money(rent_charge),
            "monthly_payment_pre_tax": money(monthly),
            "total_of_payments": money(total_payments),
            "total_lease_cost": money(total_cost),
            "approx_apr_percent": money(approx_apr),
            "effective_cost_per_month": money(total_cost / n),
        },
        assumptions={
            "depreciation": "(cap cost - residual) / term",
            "rent_charge": "(cap cost + residual) x money factor",
            "apr_estimate": "money factor x 2400",
            "taxes": "Not included",
            "mileage_and_wear_charges": "Not included",
        },
        warnings=warnings,
    )
 
 
# --------------------------------------------------------------------------
# 3. Buy now, pay later
# --------------------------------------------------------------------------
def bnpl_cost(
    price: Number,
    installments: int,
    first_payment_percent: Number = 25,
    upfront_fee: Number = 0,
    fee_per_installment: Number = 0,
    interest_apr: Number = 0,
    late_payments: int = 0,
    late_fee: Number = 0,
) -> CalcResult:
    """
    Real cost of a pay-in-N plan. Most plans are 0% interest, so the cost shows
    up in fees. late_payments x late_fee models the "what if I'm late" case.
    """
    pr = D(price)
    fp = D(first_payment_percent)
    up, per, apr = D(upfront_fee), D(fee_per_installment), D(interest_apr)
    lf = D(late_fee)
    if not isinstance(installments, int) or isinstance(installments, bool) or not (1 <= installments <= 60):
        raise CalcError("Installments must be a whole number from 1 to 60.")
    _need_positive("Price", pr)
    for label, v in (("Upfront fee", up), ("Per-installment fee", per), ("Late fee", lf)):
        _need_nonnegative(label, v)
    if fp < 0 or fp > 100:
        raise CalcError("First payment percent must be between 0 and 100.")
    _need_apr(apr)
    if late_payments < 0 or late_payments > installments:
        raise CalcError("Late payments must be between 0 and the number of installments.")
 
    first = pr * fp / HUNDRED
    remaining = pr - first
    later_count = installments - 1
 
    if later_count > 0 and remaining > 0:
        monthly_rate = apr / HUNDRED / TWELVE
        if monthly_rate > 0:
            later_payment = remaining * monthly_rate / (1 - (1 + monthly_rate) ** (-later_count))
        else:
            later_payment = remaining / later_count
    else:
        later_payment = ZERO
 
    interest = (later_payment * later_count - remaining) if later_count > 0 else ZERO
    fees = up + per * installments + lf * late_payments
    total_cost = pr + interest + fees
    extra = total_cost - pr
 
    warnings = []
    if extra > 0:
        warnings.append(f"This plan costs {money(extra)} more than the cash price.")
 
    return CalcResult(
        formula_name="Buy-now-pay-later plan",
        outputs={
            "first_payment": money(first),
            "later_payment_each": money(later_payment),
            "interest_total": money(interest),
            "fees_total": money(fees),
            "total_cost": money(total_cost),
            "extra_cost_vs_cash": money(extra),
            "extra_cost_percent_of_price": money(extra / pr * HUNDRED),
        },
        assumptions={
            "first_payment": f"{fp}% of price due at purchase",
            "remaining_payments": "Equal installments after the first payment",
            "interest": f"{apr}% APR on the remaining balance",
            "late_payments_modeled": str(late_payments),
        },
        warnings=warnings,
    )
 
 
# --------------------------------------------------------------------------
# 4. Credit card payoff
# --------------------------------------------------------------------------
def card_payoff(balance: Number, apr: Number, monthly_payment: Number) -> CalcResult:
    """Months to pay off a card balance and total interest (month-by-month)."""
    bal, a, pay = D(balance), D(apr), D(monthly_payment)
    _need_positive("Balance", bal)
    _need_positive("Monthly payment", pay)
    _need_apr(a)
    r = a / HUNDRED / TWELVE
 
    if pay <= bal * r:
        raise CalcError(
            "This payment doesn't cover the monthly interest, so the balance never "
            f"goes down. Minimum needed: more than {money(bal * r)}."
        )
 
    months = 0
    total_interest = ZERO
    total_paid = ZERO
    current = bal
    while current > 0 and months < 1200:
        interest = current * r
        total_interest += interest
        current += interest
        payment = pay if pay < current else current
        current -= payment
        total_paid += payment
        months += 1
 
    return CalcResult(
        formula_name="Credit card payoff",
        outputs={
            "months_to_payoff": Decimal(months),
            "years_to_payoff": (Decimal(months) / TWELVE).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP),
            "total_interest": money(total_interest),
            "total_paid": money(total_paid),
        },
        assumptions={
            "interest": "Charged monthly at APR/12 on the running balance",
            "new_purchases": "None",
            "payment": "Fixed monthly amount; final payment is smaller",
        },
    )
 
 
if __name__ == "__main__":
    # Quick manual check: run `python calculators.py` in the VS Code terminal.
    import json
 
    demo = loan_summary(
        price=25000, down_payment=3000, apr=6.5, term_months=60,
        upfront_fees=800, fees_financed=True,
    )
    print(json.dumps(demo.to_dict(), indent=2))