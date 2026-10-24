"""API endpoints for Phase 2: Understanding & Confidence."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas
from app.database import get_db
from app.models import ChallengeReport, Decision, DecisionStatus, JournalEntry, User
from app.services import benchmarks, devils_advocate, journal, llm

router = APIRouter()


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


def _get_decision(db: Session, decision_id: int) -> Decision:
    d = db.get(Decision, decision_id)
    if not d:
        raise HTTPException(404, "Decision not found")
    return d


def _editable(d: Decision):
    if d.status in (DecisionStatus.locked, DecisionStatus.abandoned):
        raise HTTPException(409, f"Decision is already {d.status.value}")


# ---------------- Users ----------------
@router.post("/users", response_model=schemas.UserOut, status_code=201, tags=["users"])
def create_user(body: schemas.UserCreate, db: Session = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    db.commit()
    return user


@router.get("/users/{user_id}", response_model=schemas.UserOut, tags=["users"])
def get_user(user_id: int, db: Session = Depends(get_db)):
    return _get_user(db, user_id)


# ---------------- Decisions ----------------
@router.post("/decisions", response_model=schemas.DecisionOut, status_code=201, tags=["decisions"])
def create_decision(body: schemas.DecisionCreate, db: Session = Depends(get_db)):
    _get_user(db, body.user_id)
    if body.down_payment > body.amount:
        raise HTTPException(422, "Down payment can't be more than the amount")
    d = Decision(**body.model_dump())
    db.add(d)
    db.commit()
    return d


@router.get("/decisions/{decision_id}", response_model=schemas.DecisionOut, tags=["decisions"])
def get_decision(decision_id: int, db: Session = Depends(get_db)):
    return _get_decision(db, decision_id)


@router.get("/users/{user_id}/decisions", response_model=list[schemas.DecisionOut], tags=["decisions"])
def list_decisions(user_id: int, db: Session = Depends(get_db)):
    _get_user(db, user_id)
    return list(db.scalars(select(Decision).where(Decision.user_id == user_id).order_by(Decision.created_at.desc())))


@router.post("/decisions/{decision_id}/lock", response_model=schemas.LockResponse, tags=["decisions"])
def lock_decision(decision_id: int, body: schemas.LockRequest, db: Session = Depends(get_db)):
    """Commit to a decision. Requires a Devil's Advocate report and respects any cooling-off period."""
    d = _get_decision(db, decision_id)
    _editable(d)
    if not d.reports:
        raise HTTPException(409, "Run the Devil's Advocate check (POST /decisions/{id}/challenge) before locking in.")
    if not body.acknowledge_report:
        raise HTTPException(409, "Please confirm you've read the Devil's Advocate report.")

    message = "Decision locked in. Remember to come back and rate how it turned out."
    latest = max(d.journal_entries, key=lambda e: e.created_at, default=None)
    if latest and latest.analysis.get("cooling_off_until"):
        until = datetime.fromisoformat(latest.analysis["cooling_off_until"])
        if datetime.now(timezone.utc) < until:
            if not body.override_cooling_off:
                raise HTTPException(409, {
                    "error": "cooling_off_active",
                    "cooling_off_until": until.isoformat(),
                    "message": "Your check-in suggested waiting before committing. You can override this, "
                               "but a short pause often helps.",
                })
            message = "Decision locked in before the suggested cooling-off period ended."

    d.status = DecisionStatus.locked
    d.locked_at = datetime.now(timezone.utc)
    benchmarks.contribute(db, d.user, d, chose_alternative=False)
    db.commit()
    return {"decision": d, "message": message}


@router.post("/decisions/{decision_id}/abandon", response_model=schemas.DecisionOut, tags=["decisions"])
def abandon_decision(decision_id: int, db: Session = Depends(get_db)):
    """User walked away or chose an alternative. Counts as a valid, healthy outcome."""
    d = _get_decision(db, decision_id)
    _editable(d)
    d.status = DecisionStatus.abandoned
    benchmarks.contribute(db, d.user, d, chose_alternative=True)
    db.commit()
    return d


# ---------------- Devil's Advocate ----------------
@router.post("/decisions/{decision_id}/challenge", response_model=schemas.ChallengeReportOut,
             status_code=201, tags=["devils-advocate"])
def challenge(decision_id: int, db: Session = Depends(get_db)):
    """Generate a balanced stress-test: blind spots, worst cases and alternatives."""
    d = _get_decision(db, decision_id)
    _editable(d)
    report = devils_advocate.build_report(d.user, d)
    report["narrative"] = llm.write_narrative(
        {"type": d.decision_type.value, "title": d.title, "amount": d.amount, "apr": d.apr,
         "term_months": d.term_months, "down_payment": d.down_payment, "annual_fee": d.annual_fee},
        report,
    )
    saved = ChallengeReport(decision_id=d.id, risk_level=report["risk_level"], payload=report)
    db.add(saved)
    d.status = DecisionStatus.challenged
    db.commit()
    return {"report_id": saved.id, "decision_id": d.id, "created_at": saved.created_at, **report}


@router.get("/decisions/{decision_id}/challenge", response_model=list[schemas.ChallengeReportOut],
            tags=["devils-advocate"])
def list_reports(decision_id: int, db: Session = Depends(get_db)):
    d = _get_decision(db, decision_id)
    return [{"report_id": r.id, "decision_id": d.id, "created_at": r.created_at, **r.payload}
            for r in sorted(d.reports, key=lambda r: r.created_at, reverse=True)]


# ---------------- Peer benchmarks ----------------
@router.get("/decisions/{decision_id}/benchmarks", response_model=schemas.BenchmarkOut, tags=["benchmarks"])
def get_benchmarks(decision_id: int, db: Session = Depends(get_db)):
    """How people with a similar income and life stage approach the same kind of decision."""
    d = _get_decision(db, decision_id)
    return benchmarks.benchmark(db, d.user, d)


# ---------------- Journal & check-in ----------------
@router.post("/decisions/{decision_id}/journal", response_model=schemas.JournalOut, status_code=201,
             tags=["journal"])
def check_in(decision_id: int, body: schemas.JournalCreate, db: Session = Depends(get_db)):
    """Log why you're making this choice and how you feel. Returns an emotional-vs-rational read."""
    d = _get_decision(db, decision_id)
    _editable(d)
    analysis = journal.analyze(body.reason, body.emotions, body.intensity, body.pressure_source, body.deadline_hours)
    entry = JournalEntry(
        decision_id=d.id,
        reason=body.reason,
        emotions=[e.value for e in body.emotions],
        intensity=body.intensity,
        pressure_source=body.pressure_source,
        deadline_hours=body.deadline_hours,
        analysis=analysis,
    )
    db.add(entry)
    db.commit()
    return entry


@router.get("/decisions/{decision_id}/journal", response_model=list[schemas.JournalOut], tags=["journal"])
def list_journal(decision_id: int, db: Session = Depends(get_db)):
    d = _get_decision(db, decision_id)
    return sorted(d.journal_entries, key=lambda e: e.created_at, reverse=True)


@router.patch("/journal/{entry_id}/outcome", response_model=schemas.JournalOut, tags=["journal"])
def record_outcome(entry_id: int, body: schemas.OutcomeUpdate, db: Session = Depends(get_db)):
    """Come back later and rate how the decision turned out. Feeds personal insights."""
    entry = db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Journal entry not found")
    entry.outcome_rating = body.outcome_rating
    entry.outcome_note = body.outcome_note
    db.commit()
    return entry


@router.get("/users/{user_id}/journal/insights", tags=["journal"])
def journal_insights(user_id: int, db: Session = Depends(get_db)):
    _get_user(db, user_id)
    entries = list(db.scalars(
        select(JournalEntry).join(Decision).where(Decision.user_id == user_id)
    ))
    return journal.insights(entries)
