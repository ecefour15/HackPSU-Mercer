# guardrails_engine.py
from datetime import datetime, timedelta
from typing import Dict, Any

class GuardrailsEngine:
    def __init__(self, spending_threshold: float = 100.0):
        self.default_threshold = spending_threshold

    def evaluate_purchase(
        self, 
        item_name: str, 
        amount: float, 
        top_goal_name: str, 
        goal_item_cost: float
    ) -> Dict[str, Any]:
        """
        Evaluates a discretionary purchase against a spending threshold, 
        triggers a cooling-off period, and calculates trade-offs.
        """
        requires_cooling_period = amount >= self.default_threshold
        
        # Calculate what percentage of a top goal this purchase represents
        goal_impact_percentage = round((amount / goal_item_cost) * 100, 1) if goal_item_cost > 0 else 0.0
        
        cooling_expiration = None
        if requires_cooling_period:
            # Set a mandatory 24-hour cooling off timer
            cooling_expiration = (datetime.now() + timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")

        trade_off_narrative = (
            f"Spending ${amount:.2f} on '{item_name}' uses up {goal_impact_percentage}% "
            f"of your progress toward your goal of '{top_goal_name}'."
        )

        return {
            "item_name": item_name,
            "amount": amount,
            "requires_cooling_period": requires_cooling_period,
            "cooling_off_expires_at": cooling_expiration,
            "trade_off_insight": trade_off_narrative,
            "recommendation": "Pause for 24 hours. Let your rational brain weigh this purchase against your long-term freedom."
        }