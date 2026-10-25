# universal_sandbox.py
from typing import Dict, Any, List, Callable

class UniversalSandboxSimulator:
    @staticmethod
    def run_simulation(
        initial_capital: float,
        monthly_income: float,
        monthly_expenses: float,
        scenario_adjustments: List[Dict[str, Any]],
        months: int = 60
    ) -> Dict[str, Any]:
        """
        A single generalized engine that can simulate ANY financial scenario 
        (e.g., buying a car, changing jobs, investing extra cash) based on dynamic inputs.
        """
        timeline_data = []
        current_net_worth = initial_capital
        
        # Parse dynamic adjustments (e.g., "increase monthly investment by $50 starting month 1")
        adjustment_map = {adj["month"]: adj for adj in scenario_adjustments}

        for m in range(1, months + 1):
            # Apply any custom rule scheduled for this specific month
            active_adjustment = adjustment_map.get(m, {})
            income_delta = active_adjustment.get("income_delta", 0.0)
            expense_delta = active_adjustment.get("expense_delta", 0.0)
            investment_delta = active_adjustment.get("investment_delta", 0.0)

            net_monthly_cashflow = (monthly_income + income_delta) - (monthly_expenses + expense_delta + investment_delta)
            
            # Accumulate net worth with a standard compound growth rate (e.g., 7% annual)
            monthly_growth_rate = 0.07 / 12
            current_net_worth = (current_net_worth + net_monthly_cashflow + investment_delta) * (1 + monthly_growth_rate)

            timeline_data.append({
                "month": m,
                "net_worth": round(current_net_worth, 2)
            })

        return {
            "scenario_summary": f"Simulated over {months} months with dynamic adjustments.",
            "final_projected_net_worth": timeline_data[-1]["net_worth"],
            "trajectory": timeline_data
        }