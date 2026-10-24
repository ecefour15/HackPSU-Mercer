"""Seed synthetic, anonymized peer data so benchmarks work in development.

Run:  python -m app.seed
The numbers are made up but shaped to look realistic. Replace with real
opted-in data in production.
"""
import random

from app.database import Base, SessionLocal, engine
from app.models import DecisionType, LifeStage, PeerDataPoint
from app.services.finance import INCOME_BANDS

# (amount/income mean, sd, apr mean, typical terms, chance of choosing an alternative)
PROFILES = {
    DecisionType.credit_card: (0.08, 0.04, 23.0, [None], 0.25),
    DecisionType.car_purchase: (0.45, 0.15, 7.5, [36, 48, 60, 72], 0.30),
    DecisionType.personal_loan: (0.15, 0.08, 13.0, [24, 36, 60], 0.35),
    DecisionType.home_purchase: (3.5, 0.8, 6.5, [180, 360], 0.20),
    DecisionType.investment: (0.10, 0.06, None, [None], 0.15),
}


def seed(n_per_combo: int = 25, rng_seed: int = 42) -> int:
    rng = random.Random(rng_seed)
    Base.metadata.create_all(engine)
    rows = []
    for dtype, (mean, sd, apr, terms, alt_p) in PROFILES.items():
        for _, _, band in INCOME_BANDS:
            for stage in LifeStage:
                for _ in range(n_per_combo):
                    ratio = max(0.01, rng.gauss(mean, sd))
                    term = rng.choice(terms)
                    a = round(max(0, rng.gauss(apr, apr * 0.2)), 1) if apr else None
                    if term and a is not None:
                        r = a / 100 / 12
                        pay_ratio = ratio * 12 * r / (1 - (1 + r) ** -term) if r else ratio * 12 / term
                    else:
                        pay_ratio = None
                    rows.append(PeerDataPoint(
                        decision_type=dtype, income_band=band, life_stage=stage,
                        amount_to_income=round(ratio, 3),
                        payment_to_income=round(pay_ratio, 3) if pay_ratio else None,
                        term_months=term, apr=a,
                        chose_alternative=rng.random() < alt_p,
                        satisfaction=rng.choices([1, 2, 3, 4, 5], weights=[1, 2, 4, 6, 4])[0],
                    ))
    with SessionLocal() as db:
        db.add_all(rows)
        db.commit()
    return len(rows)


if __name__ == "__main__":
    print(f"Seeded {seed()} anonymized peer data points.")
