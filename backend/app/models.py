"""Database tables."""
import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LifeStage(str, enum.Enum):
    student = "student"
    early_career = "early_career"
    family = "family"
    mid_career = "mid_career"
    pre_retirement = "pre_retirement"
    retired = "retired"


class DecisionType(str, enum.Enum):
    credit_card = "credit_card"
    car_purchase = "car_purchase"
    personal_loan = "personal_loan"
    home_purchase = "home_purchase"
    investment = "investment"
    other = "other"


class DecisionStatus(str, enum.Enum):
    draft = "draft"            # user is still thinking
    challenged = "challenged"  # Devil's Advocate report generated
    locked = "locked"          # user committed
    abandoned = "abandoned"    # user walked away


class Emotion(str, enum.Enum):
    excited = "excited"
    confident = "confident"
    calm = "calm"
    anxious = "anxious"
    pressured = "pressured"
    fomo = "fomo"
    guilty = "guilty"
    overwhelmed = "overwhelmed"
    impulsive = "impulsive"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80))
    annual_income: Mapped[float] = mapped_column(Float)
    monthly_expenses: Mapped[float] = mapped_column(Float)
    liquid_savings: Mapped[float] = mapped_column(Float, default=0)
    monthly_debt_payments: Mapped[float] = mapped_column(Float, default=0)
    credit_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    life_stage: Mapped[LifeStage] = mapped_column(Enum(LifeStage))
    # Opt-in: only users who agree contribute (anonymously) to peer benchmarks.
    share_anonymous_data: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    decisions: Mapped[list["Decision"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def monthly_income(self) -> float:
        return self.annual_income / 12


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision_type: Mapped[DecisionType] = mapped_column(Enum(DecisionType))
    title: Mapped[str] = mapped_column(String(160))
    amount: Mapped[float] = mapped_column(Float)  # price / credit limit / principal
    down_payment: Mapped[float] = mapped_column(Float, default=0)
    apr: Mapped[float | None] = mapped_column(Float, nullable=True)  # percent, e.g. 24.99
    term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    annual_fee: Mapped[float] = mapped_column(Float, default=0)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)  # type-specific details
    status: Mapped[DecisionStatus] = mapped_column(Enum(DecisionStatus), default=DecisionStatus.draft)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="decisions")
    reports: Mapped[list["ChallengeReport"]] = relationship(back_populates="decision", cascade="all, delete-orphan")
    journal_entries: Mapped[list["JournalEntry"]] = relationship(back_populates="decision", cascade="all, delete-orphan")


class ChallengeReport(Base):
    """A saved Devil's Advocate report, so users can look back at what they were warned about."""
    __tablename__ = "challenge_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id"))
    risk_level: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    decision: Mapped[Decision] = relationship(back_populates="reports")


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id"))
    reason: Mapped[str] = mapped_column(Text)
    emotions: Mapped[list] = mapped_column(JSON)          # list of Emotion values
    intensity: Mapped[int] = mapped_column(Integer)       # 1-5
    pressure_source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    deadline_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    analysis: Mapped[dict] = mapped_column(JSON)
    outcome_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # filled in later, 1-5
    outcome_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    decision: Mapped[Decision] = relationship(back_populates="journal_entries")


class PeerDataPoint(Base):
    """Anonymized record used for benchmarks. Holds bands, never identity or exact income."""
    __tablename__ = "peer_data_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    decision_type: Mapped[DecisionType] = mapped_column(Enum(DecisionType), index=True)
    income_band: Mapped[str] = mapped_column(String(24), index=True)
    life_stage: Mapped[LifeStage] = mapped_column(Enum(LifeStage), index=True)
    amount_to_income: Mapped[float] = mapped_column(Float)        # amount / annual income
    payment_to_income: Mapped[float | None] = mapped_column(Float, nullable=True)  # monthly payment / monthly income
    term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    apr: Mapped[float | None] = mapped_column(Float, nullable=True)
    chose_alternative: Mapped[bool] = mapped_column(default=False)  # walked away / picked something cheaper
    satisfaction: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5, from journal follow-up
