# micro_step_engine.py
from typing import Dict, List, Any

class MicroStepEngine:
    def __init__(self):
        # Master repository of goal breakdowns
        self.goal_blueprints = {
            "build an emergency fund": [
                {"step": 1, "task": "Link your primary checking account via secure plaid API", "time_mins": 2},
                {"step": 2, "task": "Open a high-yield savings account (HYSA)", "time_mins": 5},
                {"step": 3, "task": "Set up a recurring automatic transfer of $25 every payday", "time_mins": 3}
            ],
            "start investing": [
                {"step": 1, "task": "Choose a tax-advantaged account (e.g., Roth IRA or brokerage)", "time_mins": 5},
                {"step": 2, "task": "Deposit your initial opening contribution ($10 min)", "time_mins": 2},
                {"step": 3, "task": "Select a broad-market low-cost index fund (e.g., S&P 500 ETF)", "time_mins": 5}
            ],
            "pay down debt": [
                {"step": 1, "task": "List all active debts, balances, and APRs in one place", "time_mins": 5},
                {"step": 2, "task": "Choose your payoff strategy (Avalanche vs. Snowball)", "time_mins": 3},
                {"step": 3, "task": "Automate minimum payments across all accounts to avoid fees", "time_mins": 4}
            ]
        }

    def generate_roadmap(self, user_goal: str) -> Dict[str, Any]:
        """
        Takes a high-level goal and returns a structured 5-minute micro-step roadmap.
        """
        clean_goal = user_goal.lower().strip()
        
        # Match goal or provide a smart default breakdown
        steps = self.goal_blueprints.get(clean_goal, [
            {"step": 1, "task": f"Define your exact target amount and timeline for '{user_goal}'", "time_mins": 3},
            {"step": 2, "task": "Open a dedicated sub-account or savings vault", "time_mins": 5},
            {"step": 3, "task": "Automate your first micro-contribution", "time_mins": 2}
        ])

        return {
            "goal": user_goal,
            "total_estimated_time_mins": sum(s["time_mins"] for s in steps),
            "micro_steps": steps,
            "encouragement": "Big goals are just a series of tiny 5-minute actions. Let's knock out Step 1!"
        }