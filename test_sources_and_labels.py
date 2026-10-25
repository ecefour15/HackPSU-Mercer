"""
test_sources_and_labels.py: tests for source_library.py and claim_labels.py.
Run everything with:  python run_checks.py
"""
 
import unittest
from datetime import date
 
from claim_labels import (
    Claim,
    Label,
    LabeledClaim,
    displayable,
    label_claim,
    label_claims,
    summarize,
)
from source_library import (
    all_topics,
    get_sources_for_topic,
    is_stale,
    load_sources,
    validate_library,
)
 
 
class TestLibrary(unittest.TestCase):
    def test_library_is_well_formed(self):
        self.assertEqual(validate_library(), [])
 
    def test_known_topic_returns_cfpb(self):
        found = get_sources_for_topic("apr_includes_fees")
        self.assertEqual([s["id"] for s in found], ["cfpb-apr-vs-rate"])
 
    def test_lease_topic_returns_state_ag(self):
        found = get_sources_for_topic("money_factor_to_apr")
        self.assertEqual(found[0]["publisher"], "Florida Attorney General's Office")
 
    def test_unknown_topic_returns_empty(self):
        self.assertEqual(get_sources_for_topic("made_up_topic"), [])
 
    def test_every_source_has_https_url_and_topics(self):
        for s in load_sources():
            self.assertTrue(s["url"].startswith("https://"))
            self.assertTrue(s["topics"])
 
    def test_all_topics_are_nonempty_strings(self):
        self.assertTrue(all(isinstance(t, str) and t for t in all_topics()))
 
    def test_validation_catches_bad_entries(self):
        bad = [{"id": "x", "publisher": "p", "title": "t", "url": "http://insecure",
                "topics": ["a"], "summary": "s", "date_checked": "10/24/2026",
                "verification": "guess"}]
        problems = validate_library(bad)
        self.assertTrue(any("https" in p for p in problems))
        self.assertTrue(any("date_checked" in p for p in problems))
        self.assertTrue(any("verification" in p for p in problems))
 
    def test_validation_catches_duplicate_ids(self):
        s = load_sources()[0]
        self.assertTrue(any("duplicate" in p for p in validate_library([s, s])))
 
    def test_staleness(self):
        entry = {"date_checked": "2026-10-24"}
        self.assertFalse(is_stale(entry, today=date(2026, 10, 25)))
        self.assertTrue(is_stale(entry, today=date(2027, 3, 1)))
 
 
class TestLabelRules(unittest.TestCase):
    def test_calculated_claim_is_verified(self):
        c = Claim("Your payment is $386.66/month.", "calculated",
                  calculated_by="calculators.loan_summary")
        r = label_claim(c)
        self.assertEqual(r.label, Label.VERIFIED)
        self.assertIn("not by the AI", r.reason)
 
    def test_model_made_number_is_never_verified(self):
        c = Claim("You'll pay about $3,200 in interest.", "calculated")  # no calculated_by
        self.assertEqual(label_claim(c).label, Label.CANT_VERIFY)
 
    def test_sourced_fact_is_verified_with_link(self):
        c = Claim("APR includes lender fees.", "factual", topic="apr_includes_fees")
        r = label_claim(c)
        self.assertEqual(r.label, Label.VERIFIED)
        self.assertTrue(r.sources[0]["url"].startswith("https://"))
 
    def test_unsourced_fact_cant_verify(self):
        c = Claim("This dealer is the cheapest in town.", "factual", topic="nope")
        self.assertEqual(label_claim(c).label, Label.CANT_VERIFY)
 
    def test_factual_without_topic_cant_verify(self):
        self.assertEqual(label_claim(Claim("Trust me.", "factual")).label, Label.CANT_VERIFY)
 
    def test_personal_claim_depends_on_you(self):
        c = Claim("You can afford this payment.", "personal")
        self.assertEqual(label_claim(c).label, Label.DEPENDS_ON_YOU)
 
    def test_missing_input_depends_on_you_and_names_it(self):
        c = Claim("You'd likely qualify for a lower rate.", "factual",
                  topic="shop_around_lenders", requires=("credit_score",))
        r = label_claim(c, user_inputs={})
        self.assertEqual(r.label, Label.DEPENDS_ON_YOU)
        self.assertIn("credit_score", r.reason)
 
    def test_provided_input_falls_through_to_source_check(self):
        c = Claim("Shopping around can lower your cost.", "factual",
                  topic="shop_around_lenders", requires=("credit_score",))
        r = label_claim(c, user_inputs={"credit_score": 720})
        self.assertEqual(r.label, Label.VERIFIED)
 
    def test_blank_input_counts_as_missing(self):
        c = Claim("x", "calculated", calculated_by="f", requires=("income",))
        self.assertEqual(label_claim(c, {"income": ""}).label, Label.DEPENDS_ON_YOU)
 
    def test_unknown_kind_cant_verify(self):
        self.assertEqual(label_claim(Claim("x", "vibes")).label, Label.CANT_VERIFY)
 
    def test_rule_order_personal_beats_calculated(self):
        c = Claim("x", "personal", calculated_by="f")
        self.assertEqual(label_claim(c).label, Label.DEPENDS_ON_YOU)
 
    def test_stale_sources_flagged_but_still_verified(self):
        c = Claim("APR includes lender fees.", "factual", topic="apr_includes_fees")
        r = label_claim(c, today=date(2027, 6, 1))
        self.assertEqual(r.label, Label.VERIFIED)
        self.assertTrue(r.stale_sources)
 
    def test_fresh_sources_not_flagged(self):
        c = Claim("APR includes lender fees.", "factual", topic="apr_includes_fees")
        self.assertFalse(label_claim(c, today=date(2026, 10, 25)).stale_sources)
 
 
class TestUiGateAndSummary(unittest.TestCase):
    def test_unlabeled_claim_not_displayable(self):
        self.assertFalse(displayable(Claim("raw", "factual")))
 
    def test_labeled_claim_displayable(self):
        self.assertTrue(displayable(label_claim(Claim("x", "personal"))))
 
    def test_non_claim_objects_not_displayable(self):
        self.assertFalse(displayable("just a string"))
        self.assertFalse(displayable(None))
 
    def test_summary_counts(self):
        labeled = label_claims([
            Claim("a", "calculated", calculated_by="f"),
            Claim("b", "factual", topic="apr_includes_fees"),
            Claim("c", "personal"),
            Claim("d", "factual", topic="nope"),
        ])
        self.assertEqual(
            summarize(labeled),
            {"Verified": 2, "Depends on you": 1, "Can't verify": 1},
        )
 
    def test_to_dict_is_json_friendly(self):
        d = label_claim(Claim("APR includes fees.", "factual", topic="apr_includes_fees")).to_dict()
        self.assertEqual(d["label"], "Verified")
        self.assertIn("url", d["sources"][0])
 
 
if __name__ == "__main__":
    unittest.main(verbosity=2)