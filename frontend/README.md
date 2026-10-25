# Mercer — FNB money assistant (frontend concept)

A popup AI assistant on top of a First National Bank page, in two versions:

| File | What it is |
|---|---|
| `index.html` | Website: bank accounts page + "Ask Mercer" button bottom-right that opens a popup |
| `phone.html` | Mobile app: FNB app screen + floating Mercer button that toggles the popup |
| `mercer.js` | The assistant itself, shared by both pages (all tools, chat, light/dark mode) |
| `mercer.css` | Shared styles, colors (FNB navy `#003876`, crimson `#A80532`), and animations |

## Run it

No install or build step. Just open a file in your browser:

```bash
open frontend/index.html     # website (Mac)
open frontend/phone.html     # phone app
```

It needs internet once to load Preact, htm and the fonts from a CDN.
To try the phone version on your actual phone, serve the folder (`cd frontend && python3 -m http.server 8080`)
and open `http://<your-laptop-ip>:8080/phone.html` on the same Wi-Fi.

## Mercer's tools

Chat · Safe to spend · Budget (green/red + pixel face) · Credit score (animated gauge + what-if) ·
Loan check · Ready to sign? · Can I afford it? · What if… · Translate · Legit check · Next step

## Good to know

- **All numbers are demo data.** Rent ($1,475.00) and PECO ($105.41) match `synthetic_bank_transactions.csv`;
  the rest are samples. `[AMOUNT]` / `[BALANCE]` are placeholders.
- **Chat replies are scripted** in `reply()` inside `mercer.js`. To make it real, replace that function with a
  `fetch()` to the FastAPI service in `backend/` or to an LLM.
- **Change the name:** `botName` in the `Mercer.mount(...)` call at the bottom of each HTML file.
- **Not the real FNB site or logo.** It's labelled "Concept · HackPSU". Use FNB's official logo file only with permission.
- Respects "reduce motion" settings and works with keyboard and screen readers (real buttons, labels, ARIA).
