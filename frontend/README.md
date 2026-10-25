# Mercer — FNB money assistant

A popup AI money guide on top of a First National Bank page, in two versions:

| File | What it is |
|---|---|
| `index.html` | Website: accounts page + "Ask Mercer" popup |
| `phone.html` | Mobile app: floating Mercer button that opens/collapses the chat |
| `mercer.js` / `mercer.css` | The assistant UI, shared by both pages (tabs, chat, light/dark mode) |
| `brain.js` | Mercer's brain: understands questions, answers from the data, remembers |
| `data.js` | Mercer's database, generated from the team's synthetic dataset |
| `build_data.py` | Regenerates `data.js` (run from repo root: `python3 frontend/build_data.py`, needs pandas + openpyxl) |
| `vendor/` | Preact 10.24.3 + htm 3.1.1, bundled so it works offline |

## Run it

No install or build step. From the repo root:

```bash
open frontend/phone.html
open frontend/index.html
```

Works offline. Shareable link: turn on GitHub Pages (Settings → Pages → main, / root), then
`https://ecefour15.github.io/HackPSU-Team-LARP-/frontend/phone.html`.

## Tabs

Everything fits on one line, no scrolling:

**Chat · Money · Decide · More ▾ · Help**

- **Money:** Safe to spend (with upcoming bills) | Budget (green/red + pixel face)
- **Decide:**
  - **Afford it?** live check against safe-to-spend.
  - **Loan check** calculator: same formulas as the team's `Calculators.py` (payment, interest, true APR with fees).
  - **Ready to sign?** Go / Wait / Rethink verdict from the customer's own numbers, every reason tagged
    *From your data*, *Estimate* or *From the loan terms*, plus suggested changes that were each tested to
    improve the verdict.
  - **What if** sliders with a 5-year savings chart.
- **More ▾:** Credit score, Next steps, Translate (30+ term glossary, offline), Legit check (same scoring as `trust_engine.py`)
- **Help:** talk to a person (Mercer passes along a summary so you don't repeat yourself), FNB's published
  Customer Contact Center numbers, branch finder. Saying "I lost my card" or "a charge I didn't make" in chat
  sends you here immediately; Mercer won't pretend it can lock cards or file disputes.

## Everything is editable

Every number with a ✎ can be tapped and changed: checking balance, monthly savings, cushion, monthly limit,
each category limit, credit score, and every loan field. Changes update the bank page, the chat and every tool,
and are remembered on the device. **Help → Reset the demo** puts everything back.

The chat can change numbers too: "set my cushion to $300", "I want to save $800 a month", "my credit score is 680",
"can I handle a $25,000 car loan at 6.5% for 60 months?" (opens the full check).

## How the chat works

**Grounded, no guessing.** Every number comes from `data.js`: 268 transactions (Apr–Sep 2026), balances,
14 recurring bills and 3 savings goals for the fictional customer Jordan Morgan. Safe-to-spend uses the same
`calculate_forecast()` as `safe_to_spend.py`, so it matches the Streamlit app ($2,101.18). If the data can't
answer something (credit score, investing advice), Mercer says so instead of making it up. Ask "why?" after
any answer to see where the number came from.

**Listens.** It picks out the category, store, month, amount and item in a question, and follows the conversation:

> How much did I spend on dining out in August? → What about groceries? → And July? → Why? → Show me

It tolerates typos ("groceris") and asks a follow-up when something's missing ("Can I afford a jacket?" → "How much is it?").

**Remembers.** Your name, goals, budgets, facts you ask it to remember, and the whole chat are saved on the device
and survive reloads. It greets you with where you left off.

- "Call me Adi" · "I'm saving for a car" · "Remember that rent goes up in January"
- "Set my groceries budget to $450" · "Set my monthly budget to $3,600" (the Budget tab updates too)
- "What do you remember about me?" · "Forget everything"

**Try asking:** Where does my money go? · Am I on budget? · What bills are coming up? · When is Netflix due? ·
What are my subscriptions? · How much can I safely spend? · Can I afford a $4,000 laptop? · How are my savings goals? ·
When do I get paid? · Biggest purchase in July? · Compare August and September · How much have I spent at Taco Bell?

## Optional: database + AI mode (backend)

Run the backend and add `?api=` to the page URL:

```bash
cd backend && uvicorn app.main:app --reload
open "frontend/phone.html?api=http://localhost:8000"     # or paste the URL in your browser
```

- Every message and the memory are stored in the backend's SQLite database (`GET /chat/{session_id}` shows them).
- With `OPENAI_API_KEY` set, replies are rewritten more conversationally by the AI, which is only allowed to use
  numbers from the data. Without a key, or if the backend is down, Mercer answers locally.

## Good to know

- **All data is fictional demo data.** The credit score (710) and the SUV loan are labelled samples.
- Not the real FNB site or logo; labelled "Concept · HackPSU".
- Respects "reduce motion" settings and works with keyboard and screen readers.
