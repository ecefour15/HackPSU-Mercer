# Mercer — FNB HackPSU

## Run

```bash
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Enter an OpenAI API key in the sidebar, or configure `.streamlit/secrets.toml` with `OPENAI_API_KEY = "..."`.

## Features
- Single or side-by-side loan contract review
- Upload text-based PDFs, paste text, or use sample demo contracts
- JSON-formatted AI extraction with basic quote verification
- Transparent risk heuristic (0-100)
- Amortization-based loan cost estimate, with explicit assumptions
- Budget affordability check (local-only input)
- Warning signs including APR, prepayment penalties, marketing claims, and fees
- Highlight extracted clause quotes on original PDF where exact text matches
- Download an audit report PDF
- Ask follow-up questions about the current contract

## Limitations
- No OCR for image-only PDFs.
- Not a legal compliance tool; heuristic scores are not validated risk ratings.
- APR is not necessarily a nominal interest rate. Amortization estimates can differ from actual contract obligations, particularly with fees, irregular payments, variable rates, or balloon payments.
- Contract text is sent to OpenAI for analysis; redact sensitive data before upload.
- Supports contracts up to 12 MB, 80 pages, and 65,000 extracted characters.

## Added: rate-shopping assistant
- Separate loan finder below the existing contract auditor; auditor functionality is unchanged.
- Choose the bundled **synthetic** transaction history, upload a CSV, or enter monthly income and spending manually.
- CSV format: `posted_date,transaction_type,amount_usd`; Income and Expense are aggregated; Transfers are excluded.
- Set loan amount, term, purpose, credit band, savings target and cash cushion.
- Compare editable *example* APRs/fees, or replace them with personalized written lender quotes.
- Chatbot recommends where to compare products and explains affordability from summarized values.
- No lender application, rate API, real-time interest-rate ranking, eligibility decision or credit check is performed.
- User-uploaded transaction rows stay in app memory; the chatbot sends only aggregated financial context and conversation to OpenAI.

For the default synthetic demo mode, keep `synthetic_bank_transactions.csv` alongside `app.py` and `loan_finder.py`.

## Safe-to-Spend Forecast (new)

Below the original auditor and loan finder, an additional panel estimates discretionary
cash after recurring upcoming bills, ordinary variable spending, a savings allocation,
and a minimum checking cushion. It uses the bundled synthetic CSV by default or an
uploaded CSV with `posted_date, amount_usd, transaction_type, merchant, recurring,
running_balance_usd` (optional `category`). Choose 7–60 days, edit the checking
balance, savings contribution, safety cushion and variable reserve, and simulate
an extra purchase. It charts the projected balance and lists estimated due dates.

**Snapshot caveat:** Sample transactions end September 30, 2026; the first scenario
runs from that date. The app does not claim to know today's balance. Future income
is deliberately excluded, and a bill's due date is inferred from previous postings.
Variable expenses include non-recurring negative Expense rows and exclude transfers.
Predictions are conservative estimates, not verified upcoming transactions or a
real-time account connection. Calculations run locally, without requiring an API key.
