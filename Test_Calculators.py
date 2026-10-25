"""
test_calculators.py: known-answer tests for calculators.py.
 
Uses Python's built-in unittest, so there is nothing to install.
Run in the VS Code terminal:   python -m unittest -v
Expected values were computed independently (spreadsheet / separate script),
not by calling the functions under test.
"""
 
import unittest
from decimal import Decimal
 
from calculators import (
    CalcError,
    amortization_schedule,
    bnpl_cost,
    card_payoff,
    effective_apr,
    lease_cost,
    loan_payment,
    loan_summary,
    money,
)
 
 
class TestLoan(unittest.TestCase):
    def test_known_payment(self):
        # $20,000 at 6% for 60 months -> $386.66/month
        self.assertEqual(money(loan_payment(20000, 6, 60)), Decimal("386.66"))
 
    def test_zero_apr(self):
        self.assertEqual(money(loan_payment(12000, 0, 48)), Decimal("250.00"))
 
    def test_summary_known_answers(self):
        r = loan_summary(price=22000, down_payment=2000, apr=6, term_months=60)
        self.assertEqual(r.outputs["amount_financed"], Decimal("20000.00"))
        self.assertEqual(r.outputs["monthly_payment"], Decimal("386.66"))
        self.assertEqual(r.outputs["total_interest"], Decimal("3199.36"))
        self.assertEqual(r.outputs["cash_due_at_signing"], Decimal("2000.00"))
 
    def test_edge_one_month_term(self):
        r = loan_summary(price=1000, down_payment=0, apr=12, term_months=1)
        self.assertEqual(r.outputs["monthly_payment"], Decimal("1010.00"))
 
    def test_edge_long_term(self):
        r = loan_summary(price=30000, down_payment=0, apr=5, term_months=84)
        self.assertGreater(r.outputs["total_interest"], Decimal("0"))
 
    def test_fees_raise_true_apr(self):
        r = loan_summary(25000, 3000, 6.5, 60, upfront_fees=800, fees_financed=True)
        self.assertGreater(r.outputs["true_apr_percent"], Decimal("6.5"))
        self.assertTrue(r.warnings)
 
    def test_no_fees_true_apr_matches_stated(self):
        r = loan_summary(22000, 2000, 6, 60)
        self.assertEqual(r.outputs["true_apr_percent"], Decimal("6.00"))
        self.assertEqual(r.warnings, [])
 
    def test_fees_paid_at_signing(self):
        r = loan_summary(22000, 2000, 6, 60, upfront_fees=500, fees_financed=False)
        self.assertEqual(r.outputs["cash_due_at_signing"], Decimal("2500.00"))
 
    def test_assumptions_always_returned(self):
        r = loan_summary(22000, 2000, 6, 60)
        self.assertTrue(r.assumptions)
        self.assertIn("payment_formula", r.assumptions)
 
    def test_to_dict_is_json_friendly(self):
        d = loan_summary(22000, 2000, 6, 60).to_dict()
        self.assertEqual(d["outputs"]["monthly_payment"], "386.66")
 
    def test_effective_apr_roundtrip(self):
        pay = loan_payment(20000, 6, 60)
        self.assertEqual(money(effective_apr(20000, pay, 60)), Decimal("6.00"))
 
 
class TestAmortization(unittest.TestCase):
    def test_schedule_ends_at_zero(self):
        rows = amortization_schedule(20000, 6, 60)
        self.assertEqual(len(rows), 60)
        self.assertEqual(rows[-1]["balance"], Decimal("0.00"))
 
    def test_principal_parts_sum_to_loan(self):
        rows = amortization_schedule(20000, 6, 60)
        self.assertEqual(sum(r["principal"] for r in rows), Decimal("20000.00"))
 
 
class TestLease(unittest.TestCase):
    def test_known_answers(self):
        # Cap 30,000; residual 18,000; 36 months; MF 0.00125
        r = lease_cost(30000, 18000, 36, "0.00125")
        self.assertEqual(r.outputs["monthly_depreciation"], Decimal("333.33"))
        self.assertEqual(r.outputs["monthly_rent_charge"], Decimal("60.00"))
        self.assertEqual(r.outputs["monthly_payment_pre_tax"], Decimal("393.33"))
        self.assertEqual(r.outputs["approx_apr_percent"], Decimal("3.00"))
 
    def test_total_cost_includes_signing_and_disposition(self):
        r = lease_cost(30000, 18000, 36, "0.00125", due_at_signing=2000, disposition_fee=395)
        # 393.3333... x 36 = 14,160.00 ; + 2,000 + 395
        self.assertEqual(r.outputs["total_lease_cost"], Decimal("16555.00"))
 
    def test_apr_entered_as_money_factor_is_rejected(self):
        with self.assertRaises(CalcError):
            lease_cost(30000, 18000, 36, 3.0)
 
    def test_residual_above_cap_rejected(self):
        with self.assertRaises(CalcError):
            lease_cost(30000, 31000, 36, "0.00125")
 
 
class TestBNPL(unittest.TestCase):
    def test_zero_fee_plan_costs_price(self):
        r = bnpl_cost(400, 4)
        self.assertEqual(r.outputs["first_payment"], Decimal("100.00"))
        self.assertEqual(r.outputs["later_payment_each"], Decimal("100.00"))
        self.assertEqual(r.outputs["total_cost"], Decimal("400.00"))
        self.assertEqual(r.outputs["extra_cost_vs_cash"], Decimal("0.00"))
 
    def test_hidden_fees(self):
        r = bnpl_cost(400, 4, fee_per_installment=5)
        self.assertEqual(r.outputs["fees_total"], Decimal("20.00"))
        self.assertEqual(r.outputs["total_cost"], Decimal("420.00"))
        self.assertEqual(r.outputs["extra_cost_percent_of_price"], Decimal("5.00"))
        self.assertTrue(r.warnings)
 
    def test_late_fee_modeled(self):
        r = bnpl_cost(400, 4, fee_per_installment=5, late_payments=1, late_fee=7)
        self.assertEqual(r.outputs["fees_total"], Decimal("27.00"))
 
    def test_too_many_late_payments_rejected(self):
        with self.assertRaises(CalcError):
            bnpl_cost(400, 4, late_payments=5)
 
 
class TestCard(unittest.TestCase):
    def test_known_answer(self):
        # $3,000 at 24% APR, $100/month -> 47 months, $1,627.31 interest
        r = card_payoff(3000, 24, 100)
        self.assertEqual(r.outputs["months_to_payoff"], Decimal(47))
        self.assertEqual(r.outputs["total_interest"], Decimal("1627.31"))
 
    def test_payment_below_interest_rejected(self):
        with self.assertRaises(CalcError):
            card_payoff(3000, 24, 50)  # monthly interest is $60
 
 
class TestValidation(unittest.TestCase):
    def test_negative_principal(self):
        with self.assertRaises(CalcError):
            loan_payment(-1, 5, 60)
 
    def test_zero_term(self):
        with self.assertRaises(CalcError):
            loan_payment(1000, 5, 0)
 
    def test_absurd_apr(self):
        with self.assertRaises(CalcError):
            loan_payment(1000, 500, 12)
 
    def test_down_payment_not_below_price(self):
        with self.assertRaises(CalcError):
            loan_summary(10000, 10000, 5, 36)
 
    def test_non_numeric_input(self):
        with self.assertRaises(CalcError):
            loan_payment("abc", 5, 12)
 
 
if __name__ == "__main__":
    unittest.main(verbosity=2)