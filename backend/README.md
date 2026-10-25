# Financial Confidence API — Phase 2: Understanding → Confidence

Part of LoanGuard AI (HackPSU). Separate FastAPI service; the Streamlit app in the repo root does not call it yet.

Backend for the validation & reassurance phase: helping users get past analysis
paralysis and fear of making the wrong move.

| Feature | What it does |
|---|---|
| **Devil's Advocate** | Stress-tests a decision before it's locked: blind spots, worst-case scenarios, alternatives, and what already looks solid. |
| **Peer Benchmarks** | Shows how people with a similar income band and life stage handled the same kind of decision, with privacy guarantees. |
| **Decision Journal** | Logs *why* and *how you feel*, scores emotion-led vs strategy-led, and can recommend a cooling-off period. |

## Run it

This lives in `backend/`, separate from the Streamlit app. Run everything from inside that folder:

```bash
cd backend
pip install -r requirements.txt
python -m app.seed                 # fills the DB with synthetic anonymized peer data
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs for interactive API docs. Run tests with `pytest`.

Optional settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./confidence.db` | Any SQLAlchemy URL (e.g. Postgres) |
| `OPENAI_API_KEY` | unset | Adds an LLM-written narrative to Devil's Advocate reports (same key as the Streamlit app) |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model for the narrative; set to whichever model your team uses |
| `ANTHROPIC_API_KEY` | unset | Alternative to OpenAI; used only if no OpenAI key is set |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Anthropic model for the narrative |
| `MIN_COHORT_SIZE` | `10` | k-anonymity threshold for benchmarks |
| `COOLING_OFF_HOURS` | `24` | Length of a recommended cooling-off period |

## Mercer chat (database + memory)

```
POST   /chat                 save a message + memory; returns a grounded reply (AI-polished if a key is set)
GET    /chat/{session_id}    full chat history and memory for a session
DELETE /chat/{session_id}    "forget everything"
```

The browser (`frontend/brain.js`) computes each answer from the account data and sends it as `local_reply`.
The backend stores the conversation in the `chat_messages` and `chat_memory` tables. With `OPENAI_API_KEY`
(or `ANTHROPIC_API_KEY`) set, it rewrites the reply conversationally using the same data facts
(`app/services/chat.py`); the prompt only allows numbers that appear in the data. Reads `../frontend/data.js`
(override with `MERCER_DATA_PATH`).

## The flow

```
POST /users                              create a profile (income, expenses, savings, life stage)
POST /decisions                          describe the decision (car, card, loan, home, investment)
POST /decisions/{id}/journal             emotional check-in  → impulse score, cooling-off advice
POST /decisions/{id}/challenge           Devil's Advocate report
GET  /decisions/{id}/benchmarks          peer comparison + reassurance
POST /decisions/{id}/lock                commit (needs a report; respects cooling-off unless overridden)
POST /decisions/{id}/abandon             walk away (treated as a healthy outcome, not a failure)
PATCH /journal/{entry_id}/outcome        later: rate how it turned out (1-5)
GET  /users/{id}/journal/insights        patterns: which feelings led to good or bad outcomes
```

## How each feature works

### Devil's Advocate (`app/services/devils_advocate.py`)
A **rules engine computes every number** (debt-to-income before/after, emergency-fund
months, total interest, monthly leftover) and raises findings with a severity of
`info`, `caution`, `warning` or `critical`. Checks are type-specific, e.g. long car
loans, promo APRs that expire, PMI under 20% down, concentrated investments.

It also produces worst cases (job loss runway, 20% income drop, minimum payments,
resale value, market drop, rate rise) and alternatives. It deliberately includes
**"what looks solid"** so the report is balanced, not just scary.

If `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) is set, `app/services/llm.py` asks the model to turn the
findings into a short summary. The model only rephrases computed findings and is
told not to invent figures. If the call fails, the report is returned without it.

### Peer Benchmarks (`app/services/benchmarks.py`)
Privacy rules, enforced in code:
- Only users with `share_anonymous_data: true` contribute, and only when they lock or abandon a decision.
- Stored rows hold **bands and ratios only**: income band, life stage, amount-to-income, payment-to-income, term, APR. No ids, names or exact incomes.
- Groups smaller than `MIN_COHORT_SIZE` are never shown. If the exact cohort is too small, it widens (drop life stage, then income band) and says which match was used.
- Responses contain only rounded percentiles and a cohort size *range*.

### Decision Journal (`app/services/journal.py`)
Produces an `impulse_score` (0-100) from emotions and intensity, outside pressure,
short deadlines, and wording in the reason (urgency or "I deserve it" language
raises it, mentions of budgets, plans and real numbers lower it). It returns
`emotion_led`, `mixed` or `strategy_led`, the signals behind the score, and
reflection prompts. Emotion-led check-ins set `cooling_off_until`, and `/lock`
refuses until then unless `override_cooling_off` is sent.

## Example Devil's Advocate output
$60k income, buying a $38k SUV with $2k down at 7.9% over 72 months:

```
risk_level: high
key_numbers: new_monthly_cost 629.44, debt_to_income_after 0.186,
             emergency_fund_months_after 2.2, total_interest_over_term 9319.70
blind_spots:
  warning  Thin emergency fund
  warning  Car price is high relative to income
  warning  Long loan term
  caution  Small down payment
  info     Running costs not included
benchmark: "about 88% of similar people spent less relative to income ...
            20% of people in this group chose a different or cheaper option."
```

## Before production
- **Auth**: endpoints take ids directly. Add authentication and check each user can only reach their own data.
- **Migrations**: tables are created on startup. Use Alembic for real schema changes.
- **Stronger privacy**: consider adding differential-privacy noise to percentiles and limiting how often a user can query benchmarks.
- **Real peer data**: `app/seed.py` is synthetic. Replace it with opted-in data.
- **Compliance**: the reports are educational, not advice. Have the thresholds and wording reviewed before launch.

## Layout
```
app/
  main.py            FastAPI app
  routes.py          all endpoints
  models.py          SQLAlchemy tables
  schemas.py         request/response shapes
  config.py          env settings
  seed.py            synthetic peer data
  services/
    finance.py         amortization, DTI, income bands
    devils_advocate.py rules engine
    llm.py             optional narrative
    benchmarks.py      cohorts + k-anonymity
    journal.py         emotional check-in analysis + insights
    chat.py            Mercer chat: data facts + AI rewrite
tests/test_api.py    end-to-end tests (10)
```
