"""
run_benchmark.py: scores OUR tool against the benchmark cases.
 
    python run_benchmark.py
 
For each case it runs the structured inputs through calculators.py and compares
every expected number (tolerance: 1 cent). It also checks whether the calculator
raised a warning when the case says it should.
 
Extraction hook: right now the structured inputs come straight from the case
file. When the AI/Back-End Lead's extraction step is ready, pass it as
`extractor`: a function that takes the case's `offer_text` and returns the same
inputs dict. Then this script measures the WHOLE pipeline (reading + math).
"""
 
from __future__ import annotations
 
import csv
import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Callable, Optional
 
from calculators import bnpl_cost, card_payoff, lease_cost, loan_summary
 
CASES_PATH = Path(__file__).with_name("benchmark_cases.json")
RESULTS_PATH = Path(__file__).with_name("benchmark_results.csv")
TOLERANCE = Decimal("0.01")
 
 
def load_cases(path: Path = CASES_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]
 
 
def run_case(case: dict, extractor: Optional[Callable[[str], dict]] = None) -> dict:
    """Return {'outputs': {...}, 'warned': bool} for one case."""
    inputs = extractor(case["offer_text"]) if extractor else case["inputs"]
    scenario = case["scenario"]
 
    if scenario == "auto_loan":
        r = loan_summary(**inputs)
    elif scenario == "lease":
        r = lease_cost(**inputs)
    elif scenario == "bnpl":
        r = bnpl_cost(**inputs)
    elif scenario == "card":
        r = card_payoff(**inputs)
    elif scenario == "auto_loan_compare":
        a = loan_summary(**inputs["a"])
        b = loan_summary(**inputs["b"])
        ta, tb = a.outputs["total_cost"], b.outputs["total_cost"]
        return {
            "outputs": {
                "a_total_cost": ta,
                "b_total_cost": tb,
                "cheaper": "A" if ta < tb else "B",
                "difference": abs(ta - tb),
            },
            "warned": bool(a.warnings or b.warnings),
        }
    else:
        raise ValueError(f"Unknown scenario: {scenario}")
 
    return {"outputs": r.outputs, "warned": bool(r.warnings)}
 
 
def score_case(case: dict, extractor: Optional[Callable[[str], dict]] = None) -> dict:
    try:
        result = run_case(case, extractor)
    except Exception as exc:  # noqa: BLE001
        return {"id": case["id"], "numeric_correct": False, "checked": 0, "matched": 0,
                "warning_ok": False, "problems": [f"error: {exc}"]}
 
    problems = []
    matched = 0
    for key, want in case["expected"].items():
        got = result["outputs"].get(key)
        if key == "cheaper":
            ok = got == want
        else:
            ok = got is not None and abs(Decimal(str(got)) - Decimal(want)) <= TOLERANCE
        if ok:
            matched += 1
        else:
            problems.append(f"{key}: expected {want}, got {got}")
 
    should_warn = case.get("calculator_should_warn")
    warning_ok = True if should_warn is None else (result["warned"] == should_warn)
    if not warning_ok:
        problems.append(f"warning: expected {should_warn}, got {result['warned']}")
 
    checked = len(case["expected"])
    return {
        "id": case["id"],
        "numeric_correct": matched == checked,
        "checked": checked,
        "matched": matched,
        "warning_ok": warning_ok,
        "problems": problems,
    }
 
 
def main() -> int:
    cases = load_cases()
    scores = [score_case(c) for c in cases]
 
    print(f"{'Case':<5}{'Scenario':<19}{'Numbers':<10}{'Warning':<9}Notes")
    print("-" * 70)
    by_id = {c["id"]: c for c in cases}
    for s in scores:
        c = by_id[s["id"]]
        print(
            f"{s['id']:<5}{c['scenario']:<19}"
            f"{str(s['matched']) + '/' + str(s['checked']):<10}"
            f"{'ok' if s['warning_ok'] else 'MISS':<9}"
            f"{'; '.join(s['problems'])}"
        )
 
    n = len(scores)
    num_ok = sum(s["numeric_correct"] for s in scores)
    warn_ok = sum(s["warning_ok"] for s in scores)
    print("-" * 70)
    print(f"Numeric answers fully correct: {num_ok} of {n}")
    print(f"Warning behavior as expected:  {warn_ok} of {n}")
 
    with open(RESULTS_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["case_id", "scenario", "numbers_matched", "numbers_checked",
                    "numeric_correct", "warning_ok", "problems"])
        for s in scores:
            w.writerow([s["id"], by_id[s["id"]]["scenario"], s["matched"], s["checked"],
                        s["numeric_correct"], s["warning_ok"], " | ".join(s["problems"])])
    print(f"Saved {RESULTS_PATH.name}")
    return 0 if num_ok == n and warn_ok == n else 1
 
 
if __name__ == "__main__":
    sys.exit(main())