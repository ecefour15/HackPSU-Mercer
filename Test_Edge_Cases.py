"""
test_edge_cases.py: edge cases, consistency checks, and rounding rules.
 
Complements test_calculators.py. Run everything with:  python -m unittest -v
Expected values were computed independently of calculators.py.
"""
 
import unittest
from decimal import Decimal
 
from calculators import (
    CalcError,
    D,
    amortization_schedule,
    bnpl_cost,
    card_payoff,
    effective_apr,
    lease_cost,
    loan_payment,
    loan_summary,
    money,
)
 
 
class TestRounding(unittest.TestCase):
    def test_decimal_avoids_float_drift(self):
        self.assertEqual(D(0.1) + D(0.2), D("0.3"))
 
    def test_round_half_up(self):
        self.assertEqual(money(Decimal("0.005")), Decimal("0.01"))
        self.assertEqual(money(Decimal("2.675")), Decimal("2.68"))
 
    def test_all_outputs_are_cent_precision(self):
        r = loan_summary(22000, 2000, 6, 60)
        for key, value in r.outputs.items():
            self.assertEqual(value, money(value), f"{key} not rounded to cents")
 
 
class TestLoanEdges(unittest.TestCase):
    def test_large_principal_long_term(self):
        # $1,000,000 at 7% for 360 months -> $6,653.02
        self.assertEqual(money(loan_payment(1_000_000, 7, 360)), Decimal("6653.02"))
 
    def test_down_payment_just_below_price(self):
        r = loan_summary(10000, "9999.99", 5, 12)
        self.assertEqual(r.outputs["amount_financed"], Decimal("0.01"))
 
    def test_payment_rises_with_apr(self):
        p3, p6, p9 = (loan_payment(20000, a, 60) for a in (3, 6, 9))
        self.assertLess(p3, p6)
        self.assertLess(p6, p9)
        self.assertEqual(money(p3), Decimal("359.37"))
        self.assertEqual(money(p9), Decimal("415.17"))
 
    def test_longer_term_lower_payment_higher_interest(self):
        short = loan_summary(20000, 0, 6, 36)
        long_ = loan_summary(20000, 0, 6, 72)
        self.assertEqual(short.outputs["monthly_payment"], Decimal("608.44"))
        self.assertEqual(long_.outputs["monthly_payment"], Decimal("331.46"))
        self.assertLess(long_.outputs["monthly_payment"], short.outputs["monthly_payment"])
        self.assertGreater(long_.outputs["total_interest"], short.outputs["total_interest"])
 
    def test_total_cost_minus_price_matches_reported_extra(self):
        r = loan_summary(25000, 3000, 6.5, 60, upfront_fees=800, fees_financed=True)
        self.assertEqual(
            r.outputs["total_cost"] - Decimal("25000.00"),
            r.outputs["cost_above_sticker_price"],
        )
 
    def test_financed_fees_increase_amount_financed(self):
        financed = loan_summary(20000, 2000, 6, 60, upfront_fees=500, fees_financed=True)
        paid_now = loan_summary(20000, 2000, 6, 60, upfront_fees=500, fees_financed=False)
        self.assertEqual(financed.outputs["amount_financed"], Decimal("18500.00"))
        self.assertEqual(paid_now.outputs["amount_financed"], Decimal("18000.00"))
 
    def test_effective_apr_zero_when_no_cost_of_credit(self):
        self.assertEqual(effective_apr(1000, 100, 10), Decimal("0"))
        self.assertEqual(effective_apr(1000, 10, 12), Decimal("0"))
 
 
class TestScheduleConsistency(unittest.TestCase):
    def test_first_row_known_values(self):
        row = amortization_schedule(20000, 6, 60)[0]
        self.assertEqual(row["interest"], Decimal("100.00"))
        self.assertEqual(row["principal"], Decimal("286.66"))
        self.assertEqual(row["balance"], Decimal("19713.34"))
 
    def test_schedule_interest_close_to_summary(self):
        # Schedule uses a cent-rounded payment; summary uses the unrounded one.
        # They should agree within a dollar over 60 months.
        rows = amortization_schedule(20000, 6, 60)
        sched_interest = sum(r["interest"] for r in rows)
        summary = loan_summary(20000, 0, 6, 60).outputs["total_interest"]
        self.assertLess(abs(sched_interest - summary), Decimal("1.00"))
 
    def test_balance_never_negative(self):
        for r in amortization_schedule(5000, 9.9, 37):
            self.assertGreaterEqual(r["balance"], Decimal("0.00"))
 
    def test_zero_apr_schedule(self):
        rows = amortization_schedule(1200, 0, 12)
        self.assertEqual(rows[0]["interest"], Decimal("0.00"))
        self.assertEqual(rows[-1]["balance"], Decimal("0.00"))
 
 
class TestLeaseEdges(unittest.TestCase):
    def test_monthly_fees_included(self):
        r = lease_cost(30000, 18000, 36, "0.00125", monthly_fees=10)
        self.assertEqual(r.outputs["monthly_payment_pre_tax"], Decimal("403.33"))
        self.assertEqual(r.outputs["total_of_payments"], Decimal("14520.00"))
 
    def test_zero_money_factor_means_no_rent_charge(self):
        r = lease_cost(30000, 18000, 36, 0)
        self.assertEqual(r.outputs["monthly_rent_charge"], Decimal("0.00"))
        self.assertEqual(r.outputs["approx_apr_percent"], Decimal("0.00"))
 
    def test_large_signing_amount_warns(self):
        r = lease_cost(30000, 18000, 36, "0.00125", due_at_signing=3000)
        self.assertTrue(r.warnings)
 
    def test_negative_fee_rejected(self):
        with self.assertRaises(CalcError):
            lease_cost(30000, 18000, 36, "0.00125", monthly_fees=-5)
 
 
class TestBnplEdges(unittest.TestCase):
    def test_single_installment_is_pay_in_full(self):
        r = bnpl_cost(100, 1, first_payment_percent=100)
        self.assertEqual(r.outputs["total_cost"], Decimal("100.00"))
        self.assertEqual(r.outputs["later_payment_each"], Decimal("0.00"))
 
    def test_interest_bearing_plan(self):
        # $1,000, 25% down ($250), $750 over 3 payments at 12% APR
        r = bnpl_cost(1000, 4, first_payment_percent=25, interest_apr=12)
        self.assertEqual(r.outputs["later_payment_each"], Decimal("255.02"))
        self.assertEqual(r.outputs["interest_total"], Decimal("15.05"))
 
    def test_upfront_fee_only(self):
        r = bnpl_cost(200, 4, upfront_fee=9)
        self.assertEqual(r.outputs["extra_cost_vs_cash"], Decimal("9.00"))
        self.assertEqual(r.outputs["extra_cost_percent_of_price"], Decimal("4.50"))
 
    def test_bad_first_payment_percent(self):
        with self.assertRaises(CalcError):
            bnpl_cost(400, 4, first_payment_percent=150)
 
 
class TestCardEdges(unittest.TestCase):
    def test_pays_off_in_one_month(self):
        r = card_payoff(100, 12, 200)
        self.assertEqual(r.outputs["months_to_payoff"], Decimal(1))
        self.assertEqual(r.outputs["total_interest"], Decimal("1.00"))
 
    def test_zero_apr_card(self):
        r = card_payoff(1000, 0, 100)
        self.assertEqual(r.outputs["months_to_payoff"], Decimal(10))
        self.assertEqual(r.outputs["total_interest"], Decimal("0.00"))
 
    def test_higher_payment_means_less_interest(self):
        slow = card_payoff(3000, 24, 100).outputs["total_interest"]
        fast = card_payoff(3000, 24, 200).outputs["total_interest"]
        self.assertLess(fast, slow)
 
 
class TestTypeValidation(unittest.TestCase):
    def test_float_term_rejected(self):
        with self.assertRaises(CalcError):
            loan_payment(1000, 5, 60.0)
 
    def test_bool_term_rejected(self):
        with self.assertRaises(CalcError):
            loan_payment(1000, 5, True)
 
    def test_term_upper_bound(self):
        with self.assertRaises(CalcError):
            loan_payment(1000, 5, 601)
 
    def test_error_messages_are_user_readable(self):
        with self.assertRaises(CalcError) as ctx:
            loan_payment(-100, 5, 12)
        self.assertIn("Principal", str(ctx.exception))
 
 
if __name__ == "__main__":
    unittest.main(verbosity=2)