# trust_engine.py
import re
from typing import Dict, List, Any

class TrustEngine:
    def __init__(self):
        # Keywords indicating commercial bias or hidden sponsorships
        self.sponsor_keywords = [
            "sponsored by", "partnered with", "use my link", "affiliate link",
            "exclusive discount", "promo code", "paid promotion"
        ]
        
        # Red-flag hype terms indicating unverified or risky claims
        self.hype_keywords = [
            "guaranteed return", "risk-free", "get rich quick", "cant lose",
            "to the moon", "secret trick", "loophole", "generational wealth fast"
        ]

    def analyze_content(self, text: str) -> Dict[str, Any]:
        """
        Analyzes financial content to calculate a Trust & Bias Score (0-100),
        flagging potential sponsor incentives and emotional hype.
        """
        text_lower = text.lower()
        
        # 1. Check for sponsor incentives
        detected_sponsors = [kw for kw in self.sponsor_keywords if kw in text_lower]
        has_sponsor_incentive = len(detected_sponsors) > 0

        # 2. Check for hype/risk language
        detected_hype = [kw for kw in self.hype_keywords if kw in text_lower]
        
        # 3. Calculate Trust Score components
        base_score = 100
        if has_sponsor_incentive:
            base_score -= 30
        base_score -= (len(detected_hype) * 20)
        
        trust_score = max(10, min(100, base_score))

        # 4. Determine bias level category
        if trust_score >= 80:
            bias_level = "Low Bias / High Objectivity"
        elif trust_score >= 50:
            bias_level = "Moderate Bias / Promotional Elements Detected"
        else:
            bias_level = "High Bias / Unverified Claims Warning"

        return {
            "trust_score": trust_score,
            "bias_level": bias_level,
            "has_sponsor_incentive": has_sponsor_incentive,
            "detected_sponsors": detected_sponsors,
            "risk_flags": detected_hype,
            "recommendation": self._generate_recommendation(trust_score, has_sponsor_incentive)
        }

    def _generate_recommendation(self, score: int, sponsored: bool) -> str:
        if score < 50:
            return "Exercise extreme caution. This content contains high-risk hype language and/or undisclosed commercial incentives."
        elif sponsored:
            return "Take note: The author has a potential financial incentive in promoting this product/service. Cross-reference with independent sources."
        return "Content appears balanced and objective based on historical language heuristics."