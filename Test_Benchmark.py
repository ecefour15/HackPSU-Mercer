"""
test_benchmark.py: checks the benchmark cases and the scorer.
Run everything with:  python run_checks.py
"""
 
import copy
import unittest
 
from run_benchmark import load_cases, score_case
 
REQUIRED = ("id", "scenario", "title", "offer_text", "inputs", "expected",
            "hidden_item", "control")
SCENARIOS = {"auto_loan", "auto_loan_compare", "lease", "bnpl", "card"}
 
 
class TestCasesFile(unittest.TestCase):
    def setUp(self):
        self.cases = load_cases()
 
    def test_twelve_cases(self):
        self.assertEqual(len(self.cases), 12)
 
    def test_unique_ids(self):
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(ids), len(set(ids)))
 
    def test_required_fields_present(self):
        for c in self.cases:
            for f in REQUIRED:
                self.assertIn(f, c, f"{c.get('id')} missing {f}")
                self.assertNotEqual(c[f], "", f"{c['id']} empty {f}")
 
    def test_scenarios_valid_and_covered(self):
        self.assertTrue({c["scenario"] for c in self.cases} <= SCENARIOS)
        self.assertEqual({c["scenario"] for c in self.cases}, SCENARIOS)
 
    def test_has_control_cases(self):
        controls = [c for c in self.cases if c["control"]]
        self.assertGreaterEqual(len(controls), 2)
 
    def test_offer_text_is_plain_language(self):
        for c in self.cases:
            self.assertGreater(len(c["offer_text"]), 40)
 
 
class TestScorer(unittest.TestCase):
    def test_all_cases_match_independent_answers(self):
        # Expected answers were computed WITHOUT calculators.py (see make_benchmark_cases.py).
        for c in load_cases():
            s = score_case(c)
            self.assertTrue(s["numeric_correct"], f"{c['id']}: {s['problems']}")
            self.assertTrue(s["warning_ok"], f"{c['id']}: {s['problems']}")
 
    def test_scorer_catches_a_wrong_number(self):
        case = copy.deepcopy(load_cases()[0])
        case["expected"]["monthly_payment"] = "999.99"
        s = score_case(case)
        self.assertFalse(s["numeric_correct"])
        self.assertTrue(any("monthly_payment" in p for p in s["problems"]))
 
    def test_scorer_allows_one_cent_tolerance(self):
        case = copy.deepcopy(load_cases()[0])
        case["expected"]["monthly_payment"] = "386.67"  # actual 386.66
        self.assertTrue(score_case(case)["numeric_correct"])
 
    def test_scorer_rejects_two_cent_error(self):
        case = copy.deepcopy(load_cases()[0])
        case["expected"]["monthly_payment"] = "386.69"
        self.assertFalse(score_case(case)["numeric_correct"])
 
    def test_scorer_catches_wrong_warning_expectation(self):
        case = copy.deepcopy(load_cases()[0])  # control case: no warning
        case["calculator_should_warn"] = True
        self.assertFalse(score_case(case)["warning_ok"])
 
    def test_bad_inputs_reported_not_crashed(self):
        case = copy.deepcopy(load_cases()[0])
        case["inputs"]["term_months"] = 0
        s = score_case(case)
        self.assertFalse(s["numeric_correct"])
        self.assertTrue(s["problems"][0].startswith("error"))
 
    def test_compare_case_picks_cheaper_option(self):
        a4 = next(c for c in load_cases() if c["id"] == "A4")
        self.assertEqual(a4["expected"]["cheaper"], "A")
        self.assertTrue(score_case(a4)["numeric_correct"])
 
    def test_extractor_hook_is_used(self):
        case = copy.deepcopy(load_cases()[0])
        wrong = lambda text: dict(case["inputs"], apr=9.0)  # noqa: E731
        self.assertFalse(score_case(case, extractor=wrong)["numeric_correct"])
 
 
if __name__ == "__main__":
    unittest.main(verbosity=2)