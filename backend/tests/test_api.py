import os
import tempfile

# Use a throwaway database and no LLM for tests. Must be set before importing the app.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed import seed


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        seed(n_per_combo=15)
        yield c


def make_user(client, **overrides):
    body = {
        "display_name": "Test", "annual_income": 60000, "monthly_expenses": 2500,
        "liquid_savings": 9000, "monthly_debt_payments": 300, "credit_score": 710,
        "life_stage": "early_career", "share_anonymous_data": True,
    }
    body.update(overrides)
    r = client.post("/users", json=body)
    assert r.status_code == 201
    return r.json()["id"]


def make_decision(client, user_id, **overrides):
    body = {
        "user_id": user_id, "decision_type": "car_purchase", "title": "New SUV",
        "amount": 38000, "down_payment": 2000, "apr": 7.9, "term_months": 72,
    }
    body.update(overrides)
    r = client.post("/decisions", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_devils_advocate_flags_risky_car(client):
    uid = make_user(client)
    did = make_decision(client, uid)
    r = client.post(f"/decisions/{did}/challenge")
    assert r.status_code == 201
    rep = r.json()
    titles = {b["title"] for b in rep["blind_spots"]}
    assert "Long loan term" in titles
    assert "Car price is high relative to income" in titles
    assert rep["risk_level"] in {"high", "critical"}
    assert rep["alternatives"] and rep["worst_case_scenarios"]
    assert rep["key_numbers"]["new_monthly_cost"] > 600
    assert rep["narrative"] is None  # no API key in tests


def test_devils_advocate_low_risk_is_balanced(client):
    uid = make_user(client, annual_income=120000, liquid_savings=50000, monthly_debt_payments=0)
    did = make_decision(client, uid, decision_type="credit_card", title="No-fee cashback card",
                        amount=5000, apr=19.9, term_months=None)
    rep = client.post(f"/decisions/{did}/challenge").json()
    assert rep["risk_level"] == "low"
    assert rep["what_looks_solid"]


def test_benchmarks_and_k_anonymity(client):
    uid = make_user(client)
    did = make_decision(client, uid)
    b = client.get(f"/decisions/{did}/benchmarks").json()
    assert b["available"] is True
    assert 0 <= b["your_position"]["amount_percentile"] <= 100
    assert "median" in b["peer_stats"]["amount_to_income"]
    assert b["reassurance"]

    # A decision type with no peer data must not reveal anything.
    did2 = make_decision(client, uid, decision_type="other", title="Boat", apr=None, term_months=None)
    b2 = client.get(f"/decisions/{did2}/benchmarks").json()
    assert b2["available"] is False
    assert b2.get("peer_stats") is None


def test_journal_detects_impulse_and_blocks_lock(client):
    uid = make_user(client)
    did = make_decision(client, uid)
    j = client.post(f"/decisions/{did}/journal", json={
        "reason": "The dealer said this deal ends today and I deserve a nice car",
        "emotions": ["excited", "pressured"], "intensity": 5,
        "pressure_source": "salesperson", "deadline_hours": 6,
    }).json()
    assert j["analysis"]["decision_mode"] == "emotion_led"
    assert j["analysis"]["cooling_off_recommended"] is True

    # Locking needs a report first
    assert client.post(f"/decisions/{did}/lock", json={"acknowledge_report": True}).status_code == 409
    client.post(f"/decisions/{did}/challenge")
    r = client.post(f"/decisions/{did}/lock", json={"acknowledge_report": True})
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "cooling_off_active"
    # User can still override
    r = client.post(f"/decisions/{did}/lock", json={"acknowledge_report": True, "override_cooling_off": True})
    assert r.status_code == 200
    assert r.json()["decision"]["status"] == "locked"


def test_journal_strategy_led(client):
    uid = make_user(client)
    did = make_decision(client, uid, title="Replace 2009 car", amount=18000, term_months=48, down_payment=4000)
    j = client.post(f"/decisions/{did}/journal", json={
        "reason": "My current car needs a $3,000 repair. I compared three used cars, kept the budget "
                  "under $350 a month and still keep my emergency fund intact.",
        "emotions": ["calm"], "intensity": 2,
    }).json()
    assert j["analysis"]["decision_mode"] == "strategy_led"
    assert j["analysis"]["cooling_off_recommended"] is False


def test_outcomes_feed_insights(client):
    uid = make_user(client)
    for emo, rating in [("calm", 5), ("calm", 4), ("fomo", 2), ("fomo", 1)]:
        did = make_decision(client, uid)
        e = client.post(f"/decisions/{did}/journal", json={
            "reason": "Logging this decision for testing purposes", "emotions": [emo], "intensity": 3,
        }).json()
        client.patch(f"/journal/{e['id']}/outcome", json={"outcome_rating": rating})
    ins = client.get(f"/users/{uid}/journal/insights").json()
    assert ins["rated_entries"] == 4
    assert ins["by_emotion"]["calm"]["avg_outcome"] == 4.5
    assert "calm" in ins["observations"][0]


def test_abandon_is_final(client):
    uid = make_user(client)
    did = make_decision(client, uid)
    assert client.post(f"/decisions/{did}/abandon").json()["status"] == "abandoned"
    assert client.post(f"/decisions/{did}/challenge").status_code == 409
