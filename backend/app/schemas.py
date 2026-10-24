"""Request / response shapes for the API."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import DecisionStatus, DecisionType, Emotion, LifeStage


# ---------- Users ----------
class UserCreate(BaseModel):
    display_name: str = Field(max_length=80)
    annual_income: float = Field(ge=0)
    monthly_expenses: float = Field(ge=0)
    liquid_savings: float = Field(ge=0, default=0)
    monthly_debt_payments: float = Field(ge=0, default=0)
    credit_score: int | None = Field(default=None, ge=300, le=850)
    life_stage: LifeStage
    share_anonymous_data: bool = False


class UserOut(UserCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


# ---------- Decisions ----------
class DecisionCreate(BaseModel):
    user_id: int
    decision_type: DecisionType
    title: str = Field(max_length=160)
    amount: float = Field(gt=0)
    down_payment: float = Field(ge=0, default=0)
    apr: float | None = Field(default=None, ge=0, le=100)
    term_months: int | None = Field(default=None, gt=0, le=480)
    annual_fee: float = Field(ge=0, default=0)
    extra: dict = Field(
        default_factory=dict,
        description="Type-specific details, e.g. expected_carried_balance, monthly_running_costs, "
                    "monthly_contribution, is_promo_apr, promo_months, asset_class.",
    )


class DecisionOut(DecisionCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: DecisionStatus
    created_at: datetime
    locked_at: datetime | None


class LockRequest(BaseModel):
    acknowledge_report: bool = Field(description="User confirms they read the latest Devil's Advocate report.")
    override_cooling_off: bool = False


class LockResponse(BaseModel):
    decision: DecisionOut
    message: str


# ---------- Devil's Advocate ----------
class Finding(BaseModel):
    title: str
    detail: str
    severity: str  # info | caution | warning | critical


class Scenario(BaseModel):
    name: str
    description: str
    impact: str


class Alternative(BaseModel):
    option: str
    why_consider: str


class ChallengeReportOut(BaseModel):
    report_id: int
    decision_id: int
    risk_level: str          # low | moderate | high | critical
    headline: str
    what_looks_solid: list[str]
    blind_spots: list[Finding]
    worst_case_scenarios: list[Scenario]
    alternatives: list[Alternative]
    questions_to_ask_yourself: list[str]
    key_numbers: dict
    narrative: str | None    # LLM-written summary when an API key is configured
    disclaimer: str
    created_at: datetime


# ---------- Benchmarks ----------
class BenchmarkOut(BaseModel):
    decision_id: int
    cohort: dict
    available: bool
    message: str
    your_position: dict | None = None
    peer_stats: dict | None = None
    reassurance: str | None = None


# ---------- Journal ----------
class JournalCreate(BaseModel):
    reason: str = Field(min_length=10, max_length=4000)
    emotions: list[Emotion] = Field(min_length=1)
    intensity: int = Field(ge=1, le=5, description="How strongly they feel it, 1 = mild, 5 = overwhelming")
    pressure_source: str | None = Field(default=None, max_length=80,
                                        description="e.g. salesperson, partner, limited-time offer, friends")
    deadline_hours: int | None = Field(default=None, ge=0, description="Hours until the user feels they must decide")

    @field_validator("emotions")
    @classmethod
    def dedupe(cls, v):
        return list(dict.fromkeys(v))


class JournalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    decision_id: int
    reason: str
    emotions: list[Emotion]
    intensity: int
    pressure_source: str | None
    deadline_hours: int | None
    analysis: dict
    outcome_rating: int | None
    outcome_note: str | None
    created_at: datetime


class OutcomeUpdate(BaseModel):
    outcome_rating: int = Field(ge=1, le=5)
    outcome_note: str | None = Field(default=None, max_length=2000)
