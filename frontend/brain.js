/*
 * Mercer's brain — understands questions, answers ONLY from the data in data.js, and remembers.
 *
 *  - Grounded: every number comes from window.MERCER_DATA (built from the team's synthetic dataset).
 *    If the data can't answer something, Mercer says so instead of guessing.
 *  - Listens: finds intent + entities (category, merchant, month, amount, item) and handles
 *    follow-ups ("what about groceries?", "and in August?", "why?", "break it down").
 *  - Remembers: chat history, your name, goals, facts you tell it and budgets you set are saved
 *    on this device (localStorage) and, if the backend is running, in its database.
 *
 * Works in the browser (window.MercerBrain) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const money = (n, cents = true) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US',
    { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthName = (ym) => { const m = +ym.slice(5, 7); return MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1); };
  const prettyDate = (d) => { const [y, m, day] = d.split('-'); return MONTHS[+m - 1].slice(0, 1).toUpperCase() + MONTHS[+m - 1].slice(1, 3) + ' ' + (+day); };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const round = (n, step = 10) => Math.ceil(n / step) * step;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const list = (arr) => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function lev(a, b) { // small Levenshtein for typo tolerance
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Category vocabulary: what people say -> category name in the data
  const CATEGORY_WORDS = {
    'Groceries': ['groceries', 'grocery', 'supermarket', 'food shopping'],
    'Dining out': ['dining', 'eating out', 'eat out', 'restaurants', 'restaurant', 'takeout', 'take out', 'fast food', 'food delivery', 'dining out', 'food'],
    'Gas & fuel': ['gas', 'fuel', 'petrol', 'gas station'],
    'Subscriptions': ['subscriptions', 'subscription', 'streaming', 'subs'],
    'Shopping': ['shopping', 'clothes', 'amazon orders'],
    'Entertainment': ['entertainment', 'movies', 'concerts', 'games', 'fun'],
    'Utilities': ['utilities', 'utility', 'electric', 'electricity', 'water', 'power bill'],
    'Insurance': ['insurance'],
    'Transportation': ['transportation', 'transit', 'bus', 'train', 'uber', 'lyft', 'rides'],
    'Housing': ['rent', 'housing', 'apartment'],
    'Internet': ['internet', 'wifi', 'wi-fi', 'broadband'],
    'Phone': ['phone bill', 'phone', 'cell', 'mobile plan'],
    'Fitness': ['fitness', 'gym'],
    'Auto loan': ['car payment', 'car loan', 'auto loan'],
    'Health & pharmacy': ['pharmacy', 'health', 'meds', 'medicine'],
    'Student loans': ['student loan', 'student loans'],
    'Auto maintenance': ['car repair', 'car repairs', 'auto maintenance', 'oil change', 'maintenance'],
    'Travel': ['travel', 'trip', 'flights', 'hotel'],
    'Medical': ['medical', 'doctor'],
    'Cash withdrawal': ['cash', 'atm'],
    'Gifts': ['gifts', 'gift'],
    'Fees': ['fees', 'bank fees', 'fee'],
    'Personal care': ['personal care', 'haircut', 'dry cleaning', 'cleaners'],
    'Peer payments': ['venmo', 'zelle', 'peer payments']
  };
  const VARIABLE_CATS = ['Groceries', 'Dining out', 'Gas & fuel', 'Shopping', 'Entertainment', 'Transportation', 'Auto maintenance', 'Health & pharmacy', 'Travel', 'Medical', 'Gifts', 'Personal care', 'Cash withdrawal', 'Peer payments', 'Fees'];

  // ---------------------------------------------------------------- the brain
  function create(opts) {
    const D = opts.data;
    const store = opts.storage || null;
    const KEY = opts.storageKey || 'mercer.memory.v1';
    const txns = D.transactions;
    const expenses = txns.filter((t) => t.type === 'Expense' && t.amount < 0);
    const months = Array.from(new Set(txns.map((t) => t.date.slice(0, 7)))).sort();
    const latest = months[months.length - 1];
    const first = D.person.name.split(' ')[0];
    const merchants = Array.from(new Set(txns.map((t) => t.merchant).concat(D.bills.map((b) => b.payee))))
      .filter((m) => !/internal savings/i.test(m));

    // ---------- memory (persisted)
    const blank = () => ({ name: null, facts: [], goals: [], budgets: {}, monthlyLimit: null, settings: {}, history: [], topic: null, visits: 0, lastVisit: null });
    let mem = blank();
    try { const raw = store && store.getItem(KEY); if (raw) mem = Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* fresh */ }
    const save = () => { try { store && store.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* private mode */ } };
    mem.visits += 1;
    const returning = mem.history.length > 0;
    let turns = 0;
    save();

    // short-term context for follow-ups (also restored from memory)
    let ctx = { intent: null, ent: {}, basis: null, pending: null, lastAnswerMonth: null };
    if (mem.topic) ctx = Object.assign(ctx, mem.topic);

    // ---------- data queries
    const inMonth = (ym) => (t) => ym === 'all' || !ym || t.date.startsWith(ym);
    function spendOf({ month, category, merchant }) {
      const rows = expenses.filter(inMonth(month))
        .filter((t) => !category || t.category === category)
        .filter((t) => !merchant || t.merchant === merchant);
      return { total: -sum(rows.map((t) => t.amount)), rows };
    }
    function monthlyAverage(category, merchant, exclude) {
      const ms = months.filter((m) => m !== exclude);
      return sum(ms.map((m) => spendOf({ month: m, category, merchant }).total)) / ms.length;
    }
    function byCategory(month) {
      const map = {};
      expenses.filter(inMonth(month)).forEach((t) => { map[t.category] = (map[t.category] || 0) - t.amount; });
      return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }
    function incomeOf(month) {
      const rows = txns.filter((t) => t.type === 'Income').filter(inMonth(month));
      return { total: sum(rows.map((t) => t.amount)), rows };
    }
    // ---------- editable numbers (saved in memory) + calculators
    const avgIncome = sum(months.map((m) => incomeOf(m).total)) / months.length;
    const avgSpend = sum(months.map((m) => spendOf({ month: m }).total)) / months.length;
    const debtBills = D.bills.filter((b) => /loan/i.test(b.category));
    const debtMonthly = sum(debtBills.map((b) => b.amount));
    const setting = (k, dflt) => (mem.settings && mem.settings[k] != null ? mem.settings[k] : dflt);
    function sts() {
      const s0 = D.safeToSpend;
      const checking = setting('checking', D.accounts.checking);
      const savings = setting('monthlySavings', D.rules.monthlySavings);
      const buffer = setting('buffer', D.rules.buffer);
      const amount = Math.max(0, checking - s0.bills - s0.variable - savings - buffer);
      return { amount, checking, bills: s0.bills, variable: s0.variable, savings, buffer, edited: ['checking', 'monthlySavings', 'buffer'].some((k) => mem.settings[k] != null) };
    }
    // Port of Calculators.loan_summary / effective_apr (team's Python), so numbers match its tests.
    function loanPayment(p, apr, n) { if (apr === 0) return p / n; const r = apr / 1200; return p * r / (1 - Math.pow(1 + r, -n)); }
    function effectiveApr(proceeds, pay, n) {
      if (pay * n <= proceeds) return 0;
      const pv = (r) => r === 0 ? pay * n : pay * (1 - Math.pow(1 + r, -n)) / r;
      let lo = 0, hi = 1; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pv(mid) > proceeds) lo = mid; else hi = mid; }
      return (lo + hi) / 2 * 1200;
    }
    function loanSummary(L) {
      const price = +L.price, down = +L.down || 0, apr = +L.apr, n = Math.round(+L.term), fees = +L.fees || 0, financed = !!L.financed;
      if (!(price > 0)) return { error: 'Enter a price above $0.' };
      if (!(n >= 1 && n <= 480)) return { error: 'Term must be 1 to 480 months.' };
      if (!(apr >= 0 && apr <= 100)) return { error: 'APR must be between 0% and 100%.' };
      if (down < 0 || fees < 0) return { error: "Down payment and fees can't be negative." };
      if (down >= price) return { error: 'Down payment must be less than the price.' };
      const base = price - down, principal = financed ? base + fees : base;
      const payment = loanPayment(principal, apr, n), totalPaid = payment * n, interest = totalPaid - principal;
      const proceeds = financed ? base : base - fees, cash = down + (financed ? 0 : fees);
      const trueApr = effectiveApr(proceeds, payment, n);
      const warnings = [];
      if (trueApr - apr >= 0.5) warnings.push(`Fees raise the real borrowing rate from ${apr}% to about ${trueApr.toFixed(2)}%.`);
      if (n > 60) warnings.push(`A ${n}-month loan keeps payments low but costs more interest, and you can owe more than the car is worth for years.`);
      return { principal, payment, interest, totalPaid, cash, totalCost: cash + totalPaid, trueApr, warnings, n, apr };
    }
    // Go / Wait / Rethink for a loan, from the customer's own numbers.
    function decision(L, noFixes) {
      const ls = loanSummary(L); if (ls.error) return ls;
      const dtiBefore = debtMonthly / avgIncome, dtiAfter = (debtMonthly + ls.payment) / avgIncome;
      const savingsAfter = D.accounts.savings - (+L.down || 0) - (L.financed ? 0 : (+L.fees || 0));
      const runway = Math.max(0, savingsAfter) / avgSpend;
      const slack = avgIncome - avgSpend - setting('monthlySavings', D.rules.monthlySavings);
      const reasons = [];
      reasons.push({ ok: dtiAfter <= 0.36, warn: dtiAfter > 0.43, tag: 'From your data', text: `Debt payments would go from ${Math.round(dtiBefore * 100)}% to ${Math.round(dtiAfter * 100)}% of your take-home pay (${money(debtMonthly + ls.payment)}/mo of ${money(avgIncome)}). Lenders get cautious above 36%.` });
      reasons.push({ ok: ls.payment <= slack, warn: ls.payment > slack + setting('monthlySavings', D.rules.monthlySavings), tag: 'From your data', text: ls.payment <= slack ? `The ${money(ls.payment)} payment fits in the ${money(slack)} you usually have left each month after spending and savings.` : `The ${money(ls.payment)} payment is ${money(ls.payment - slack)} more than you usually have left each month, so you'd have to cut savings or spending.` });
      const fromSavings = D.accounts.savings - savingsAfter;
      reasons.push(fromSavings <= 0
        ? { ok: true, warn: false, tag: 'From your data', text: `It doesn't touch your ${money(D.accounts.savings, false)} savings (about ${runway.toFixed(1)} months of spending${runway < 3 ? '; building toward 3 months would make you safer' : ''}).` }
        : { ok: runway >= 3, warn: runway < 1, tag: 'Estimate', text: `Paying ${money(fromSavings, false)} upfront leaves ${money(Math.max(0, savingsAfter), false)} in savings, about ${runway.toFixed(1)} months of your usual spending. The usual target is 3 to 6.` });
      reasons.push({ ok: ls.trueApr - ls.apr < 0.5 && ls.n <= 60, warn: false, tag: 'From the loan terms', text: `You'd pay ${money(ls.interest)} in interest${ls.trueApr - ls.apr >= 0.5 ? `, and fees push the real rate to ${ls.trueApr.toFixed(2)}%` : ''}${ls.n > 60 ? ` over a long ${ls.n}-month term` : ''}.` });
      const warns = reasons.filter((r) => r.warn).length, oks = reasons.filter((r) => r.ok).length;
      const verdict = warns ? 'rethink' : oks === reasons.length ? 'go' : 'wait';
      const head = { go: 'Go: this fits your finances.', wait: 'Wait: doable, with real trade-offs.', rethink: 'Rethink: this would strain your budget.' }[verdict];
      // Suggest only changes that actually improve the verdict (each one is checked first).
      const fixes = [];
      if (!noFixes && verdict !== 'go') {
        const score = (dd) => dd.reasons.filter((r) => r.ok).length - 2 * dd.reasons.filter((r) => r.warn).length;
        const cur = oks - 2 * warns, price = +L.price, step = Math.max(500, Math.round(price * 0.1 / 500) * 500);
        const cands = [];
        [36, 48, 60].filter((m) => m < ls.n).forEach((m) => cands.push({ label: `${m} months`, patch: { term: m } }));
        if (ls.n < 72) cands.push({ label: `${ls.n + 12} months`, patch: { term: ls.n + 12 } });
        cands.push({ label: `${money(step, false)} more down`, patch: { down: (+L.down || 0) + step } });
        if ((+L.down || 0) >= step) cands.push({ label: `${money(step, false)} less down`, patch: { down: (+L.down || 0) - step } });
        if (+L.fees > 0) cands.push({ label: `Ask them to waive the ${money(+L.fees, false)} fee`, patch: { fees: 0 } });
        if (+L.down > 0) cands.push({ label: 'Keep your savings: $0 down', patch: { down: 0 } });
        [0.85, 0.7].forEach((f) => cands.push({ label: `A ${money(Math.round(price * f / 500) * 500, false)} price`, patch: { price: Math.round(price * f / 500) * 500 } }));
        cands.forEach((c) => { const dd = decision(Object.assign({}, L, c.patch), true); if (!dd.error) { const sc = score(dd); if (sc > cur) fixes.push(Object.assign(c, { sc, verdict: dd.verdict, label: `${c.label} → ${money(dd.loan.payment, false)}/mo` })); } });
        fixes.sort((a, b) => b.sc - a.sc || (a.verdict === 'go' ? -1 : 1));
        fixes.splice(3);
      }
      return { verdict, head, reasons, loan: ls, fixes };
    }
    function whatIf({ extra = 0, oneTime = 0 }) {
      const base = setting('monthlySavings', D.rules.monthlySavings), start = D.accounts.savings;
      const series = (m, o) => Array.from({ length: 61 }, (_, i) => Math.max(0, start - o + m * i));
      const ef = D.goals.find((g) => /emergency/i.test(g.name)) || D.goals[0];
      const share = ef.monthly / D.rules.monthlySavings;
      const efMonths = (m, o) => { const per = Math.max(0, m) * share; const need = ef.target - ef.saved + o * share; return per > 0 ? Math.max(0, Math.ceil(need / per)) : Infinity; };
      const monthly = Math.max(0, base + extra);
      return { base: series(base, 0), scen: series(monthly, oneTime), monthly, efName: ef.name, efTarget: ef.target, efBase: efMonths(base, 0), efScen: efMonths(monthly, oneTime) };
    }
    const GLOSSARY = {
      'apr': ['APR', 'The yearly cost of borrowing, including some fees. Lower is better.'],
      'apy': ['APY', 'What a savings account really earns in a year, with interest on interest included.'],
      'principal': ['Principal', 'The amount you borrowed, not counting interest.'],
      'interest': ['Interest', 'What the lender charges you for borrowing, on top of what you borrowed.'],
      'precomputed': ['Precomputed interest', 'Interest is worked out up front for the whole loan, so paying early saves less than you\'d expect.'],
      'prepayment penalty': ['Prepayment penalty', 'A fee for paying the loan off early.'],
      'origination fee': ['Origination fee', 'A fee for setting up the loan. It\'s often taken out of the money you receive.'],
      'amortiz': ['Amortization', 'Paying a loan off in equal monthly payments. Early payments are mostly interest.'],
      'balloon': ['Balloon payment', 'A large lump sum due at the end of the loan. Make sure you can pay it.'],
      'variable rate': ['Variable rate', 'Your rate can go up or down over time, so your payment can change.'],
      'fixed rate': ['Fixed rate', 'Your rate stays the same for the whole loan.'],
      'escrow': ['Escrow', 'Money the lender holds to pay your property tax and insurance for you.'],
      'collateral': ['Collateral', 'Something you own that the lender can take if you stop paying, like the car.'],
      'lien': ['Lien', 'The lender\'s legal claim on your property until the loan is paid off.'],
      'grace period': ['Grace period', 'Extra time after a due date before you\'re charged a late fee or interest.'],
      'minimum payment': ['Minimum payment', 'The smallest amount you can pay without a late fee. Paying only this keeps you in debt longer.'],
      'compound': ['Compound interest', 'Interest charged on interest. It makes debt grow faster and savings grow faster.'],
      'hard inquiry': ['Hard inquiry', 'A credit check when you apply for credit. It can lower your score a little for a while.'],
      'utilization': ['Credit utilization', 'How much of your credit limit you\'re using. Under 30% is good, under 10% is great.'],
      'overdraft': ['Overdraft', 'Spending more than you have. The bank may cover it and charge a fee.'],
      'available balance': ['Available balance', 'What you can spend right now, after pending charges.'],
      'pending': ['Pending', 'A charge that\'s approved but not final yet.'],
      'ach': ['ACH', 'An electronic bank-to-bank transfer, like direct deposit or autopay.'],
      'gap insurance': ['GAP insurance', 'Covers the difference if your car is totaled and you owe more than it\'s worth. Often optional.'],
      'late fee': ['Late fee', 'A charge for paying after the due date.'],
      'default': ['Default', 'Failing to repay as agreed. It can hurt your credit and lead to collections.'],
      'co-signer': ['Co-signer', 'Someone who promises to pay if you don\'t. They\'re fully responsible too.'],
      'refinanc': ['Refinancing', 'Replacing your loan with a new one, usually to get a lower rate or payment.'],
      'debt-to-income': ['Debt-to-income (DTI)', 'Your monthly debt payments divided by your income. Lenders like it under 36%.'],
      'term': ['Term', 'How long you have to pay the loan back.'],
      'arbitration': ['Arbitration', 'Disputes go to a private arbitrator instead of court. You may give up the right to sue.']
    };
    function translate(text) {
      const t = ' ' + String(text || '').toLowerCase().replace(/[’']/g, "'") + ' ';
      const out = [];
      for (const [k, v] of Object.entries(GLOSSARY)) {
        const re = new RegExp('(^|[^a-z])' + k.replace(/[-]/g, '[- ]?'));
        if (re.test(t)) out.push({ term: v[0], plain: v[1] });
      }
      return out;
    }
    // Port of trust_engine.py (team's TrustEngine) so scores match.
    const SPONSOR = ['sponsored by', 'partnered with', 'use my link', 'affiliate link', 'exclusive discount', 'promo code', 'paid promotion'];
    const HYPE = ['guaranteed return', 'risk-free', 'get rich quick', 'cant lose', 'to the moon', 'secret trick', 'loophole', 'generational wealth fast'];
    function trust(text) {
      const t = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/risk free/g, 'risk-free').replace(/guaranteed returns/g, 'guaranteed return');
      const sponsors = SPONSOR.filter((k) => t.includes(k)), hype = HYPE.filter((k) => t.includes(k));
      let score = 100; if (sponsors.length) score -= 30; score -= hype.length * 20; score = Math.max(10, Math.min(100, score));
      const level = score >= 80 ? 'Low bias' : score >= 50 ? 'Some promotion' : 'High risk';
      const advice = score < 50 ? 'Be very careful. This has high-risk hype and/or a hidden reason to sell to you.'
        : sponsors.length ? 'The author may get paid if you sign up. Check an independent source first.'
          : 'Nothing obviously promotional or hyped. Still check where the claim comes from.';
      return { score, level, sponsors, hype, advice };
    }

    const defaultLimit = (cat) => round(monthlyAverage(cat), 10);
    const limitFor = (cat) => mem.budgets[cat] != null ? mem.budgets[cat] : defaultLimit(cat);
    const monthlyLimit = () => mem.monthlyLimit != null ? mem.monthlyLimit : round(sum(months.map((m) => spendOf({ month: m }).total)) / months.length, 100);

    function budgetStatus(month = latest) {
      const spent = spendOf({ month }).total;
      const limit = monthlyLimit();
      const cats = byCategory(month).filter(([c]) => VARIABLE_CATS.includes(c)).slice(0, 6).map(([c, s]) => {
        const lim = limitFor(c);
        return { name: c, spent: s, limit: lim, over: s > lim + 0.004, custom: mem.budgets[c] != null };
      });
      return { month, monthLabel: monthName(month), spent, limit, left: limit - spent, over: spent > limit, cats };
    }

    // ---------- understanding
    function norm(s) { return ' ' + s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$&.,%'\- ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }

    function findCategory(t) {
      let best = null, bestLen = 0;
      for (const [cat, words] of Object.entries(CATEGORY_WORDS)) {
        for (const w of words) {
          if (t.includes(' ' + w + ' ') || t.includes(' ' + w + '?') || t.includes(' ' + w + '.') || t.includes(' ' + w + ',')) {
            if (w.length > bestLen) { best = cat; bestLen = w.length; }
          }
        }
      }
      if (best) return best;
      // typo tolerance on single words of length >= 5
      const words = t.trim().split(' ');
      for (const word of words) {
        if (word.length < 5) continue;
        for (const [cat, ws] of Object.entries(CATEGORY_WORDS)) {
          if (ws.some((w) => !w.includes(' ') && w.length >= 5 && lev(word, w) <= 1)) return cat;
        }
      }
      return null;
    }
    function findMerchant(t) {
      let best = null, bestLen = 0;
      for (const m of merchants) {
        const full = m.toLowerCase();
        const key = full.replace(/ (supercenter|apartments|energy|financial|systems|food)$/, '');
        for (const k of [full, key]) {
          if (k.length >= 3 && t.includes(' ' + k) && k.length > bestLen) { best = m; bestLen = k.length; }
        }
      }
      return best;
    }
    function findMonths(t) {
      const found = [];
      MONTHS.forEach((name, i) => {
        const ym = '2026-' + String(i + 1).padStart(2, '0');
        const re = new RegExp('\\b(' + name + '|' + name.slice(0, 3) + (name === 'september' ? '|sept' : '') + ')\\b');
        if (re.test(t)) found.push(ym);
      });
      if (/\b(last|this|current|latest|recent) month\b|\blately\b|\brecently\b/.test(t)) found.push(latest);
      if (/\b(month before|previous month|month prior)\b/.test(t) && ctx.ent.month && ctx.ent.month !== 'all') {
        const i = months.indexOf(ctx.ent.month); if (i > 0) found.push(months[i - 1]);
      }
      if (/\b(in total|total of|overall|all time|altogether|so far|six months|6 months|half a year|since april)\b/.test(t)) found.push('all');
      return found;
    }
    function findAmount(t) {
      const m = t.match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b/) || t.match(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(k|dollars|bucks|usd)\b/) ||
        t.match(/(?:for|costs?|is|at|of|to|spend|spending|buy)\s+\$?(\d[\d,]*(?:\.\d{1,2})?)\b/) || t.match(/^\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
      if (!m) return null;
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2] === 'k') n *= 1000;
      return isFinite(n) ? n : null;
    }
    function findItem(t) {
      t = t.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/g, ' ').replace(/\s+/g, ' ');
      const m = t.match(/\b(?:afford|buy|get|purchase)\s+(?:a |an |the |some |new |this )*([a-z][a-z \-]{1,30}?)(?:\s+(?:for|that|which|at|costing|worth|\$|\d)|[?.!]|\s*$)/);
      if (!m) return null;
      const item = m[1].trim();
      return /^(it|that|this|one|them|something|stuff|anything)$/.test(item) ? null : item;
    }

    const RX = {
      greet: /^\s*(hi|hey|hello|yo|sup|good (morning|afternoon|evening)|hiya|howdy)\b/,
      thanks: /\b(thanks|thank you|thx|ty|appreciate it|cheers)\b/,
      bye: /\b(bye|goodbye|see you|cya|that's all|thats all)\b/,
      who: /\b(who are you|what are you|your name|what can you do|help me|^ ?help ?$|what do you do|how do you work)\b/,
      memRecall: /\b(what do you (remember|know) about me|what have i told you|do you remember( me)?|what('s| is) my name|who am i)\b/,
      urgent: /\b(lost (my )?(debit |credit )?card|stolen|card (is )?missing|fraud|unauthori[sz]ed|didn'?t (make|authori[sz]e|recogni[sz]e)|don'?t recogni[sz]e|not my (charge|purchase)|wrong charge|charged twice|double charged|scam(med)?|someone (used|took|stole)|hacked|identity theft)\b/,
      human: /\b(human|real person|actual person|agent|representative|customer (service|care|support)|talk to (someone|a person|somebody)|speak (to|with) (someone|a person)|call (the )?bank|contact (fnb|the bank|you guys)|support team|complain|complaint)\b/,
      memForget: /\b(forget (everything|it all|all|me|that|about)|clear (my )?(memory|history|chat)|reset( everything)?|delete my data)\b/,
      memName: /\b(?:my name is|call me|i'm called|you can call me)\s+([a-z][a-z\-]{1,20})\b/,
      memGoal: /\b(?:i'm|i am|im)\s+(?:saving|trying to save|putting money aside)\s+(?:up\s+)?for\s+(?:a |an |the |my )?([a-z][a-z \-]{1,30})/,
      memGoal2: /\bmy (?:goal|plan) is (?:to )?(?:buy |save for |get )?(?:a |an |the )?([a-z][a-z \-]{1,30})/,
      memRemember: /\b(?:remember|note|keep in mind|don't forget) (?:that )?(.{3,120})$/,
      setCushion: /\b(cushion|buffer|safety net)\b/,
      setSavings: /\b(save|saving|savings|put away)\b.*\b(a|per|each|every) month\b|\bmonthly savings\b/,
      setScore: /\bmy (credit )?score is\b|\bset my (credit )?score\b/,
      setChecking: /\b(my )?checking (balance )?(is|to)\b|\bset (my )?checking\b/,
      loanAsk: /\b(loan|finance|financing|borrow)\b.*(\d|%)|\b\d[\d,.]*k?\s*(car|auto)? ?loan\b/,
      setBudget: /\b(?:set|make|change|put|update)\b.*\bbudget\b|\bbudget (?:for|of|on) .* (?:to|at|is|=) \$?\d|\blimit (?:for|on|of) .* (?:to|at) \$?\d|\bset (?:my )?(?:monthly )?(?:limit|budget)\b/,
      budget: /\b(budget|on track|over (my )?(limit|budget)|under (my )?(limit|budget)|overspen|over ?spend|limit)\b/,
      safe: /\b(safe to spend|safely spend|spendable|how much (money )?can i (safely )?spend|can i spend|left to spend|how much (do i have )?left|available to spend|free money|wiggle room)\b/,
      afford: /\b(afford|can i (buy|get|purchase)|should i (buy|get)|is it ok(ay)? to (buy|spend)|worth buying)\b/,
      balance: /\b(balance|how much (money )?(do i have|is in|in my)|account|checking|savings account|net worth|cash on hand)\b/,
      bills: /\b(bills?|due|upcoming|payments? coming|autopay|recurring|next payment|when (is|does) .* (due|charge|hit))\b/,
      subs: /\b(subscriptions?|streaming|cancel|what am i subscribed)\b/,
      income: /\b(income|paycheck|pay ?check|salary|paid|payday|earn|make a month|take home|take-home|deposit)\b/,
      savings: /\b(sav(e|ing|ings)|goals?|emergency fund|travel fund|car repairs fund|rainy day)\b/,
      top: /\b(where (does|did|do) (all )?my money go|biggest (spending )?categor|top (spending )?categor|break ?(it )?down|breakdown|most money on|spend the most|categories)\b/,
      biggest: /\b(biggest|largest|most expensive|highest) (purchase|expense|charge|transaction|payment)\b/,
      transactions: /\b(transactions?|purchases|charges|history|statement|recent activity|last \d+|show (me )?(my )?(recent|last))\b/,
      compare: /\b(compare|vs\.?|versus|more than|less than|difference|went up|go up|increase|decrease|trend|than usual|normal|average|usually|typical)\b/,
      spend: /\b(spen[dt]|spending|cost me|paid for|pay for|expenses?|outflow|how much (on|for|did|was))\b/,
      credit: /\b(credit score|credit|fico|credit report)\b/,
      loan: /\b(loan|contract|suv|car deal|financing|apr|interest rate|sign)\b/,
      why: /^\s*(why|how (do|did) you (know|get|calculate|figure)|how come|explain|where('s| is| does) that (number )?(come|from)|show (me )?the math|source)\b/,
      more: /^\s*(more|tell me more|details|go on|break it down|which ones|what were they|list them|show me)\s*\??\s*$/,
      yes: /^\s*(yes|yeah|yep|sure|ok|okay|please|do it|go ahead)\s*[.!]?\s*$/,
      no: /^\s*(no|nope|nah|not now|never mind|nevermind)\s*[.!]?\s*$/,
      followup: /^\s*(what about|how about|and|what of|same for|and for|ok what about|now|also)\b/
    };

    function classify(t, ent) {
      if (RX.urgent.test(t)) return 'urgent';
      if (RX.human.test(t)) return 'human';
      if (RX.memForget.test(t)) return 'forget';
      if (RX.memRecall.test(t)) return 'recall';
      if (RX.memName.test(t) && !/my name is (jordan|mercer)\b/.test(t) || /^\s*(i'm|im|i am) [a-z]+\s*$/.test(t) && !/\b(broke|fine|good|ok|okay|tired|stressed|confused|back|here|new|sad|happy|worried|scared|anxious)\b/.test(t)) return 'name';
      if (RX.memGoal.test(t) || RX.memGoal2.test(t)) return 'goalSet';
      if (RX.memRemember.test(t)) return 'remember';
      if (RX.setCushion.test(t) && ent.amount != null && /\b(set|make|change|is|to|keep|want)\b/.test(t)) return 'setCushion';
      if (RX.setScore.test(t) && ent.amount != null) return 'setScore';
      if (RX.setChecking.test(t) && ent.amount != null) return 'setChecking';
      if (RX.setSavings.test(t) && ent.amount != null && /\b(set|make|change|want|going to|will|start|can)\b/.test(t)) return 'setSavings';
      if (RX.setBudget.test(t) && ent.amount != null) return 'setBudget';
      if (RX.loanAsk.test(t) && ent.amount != null && ent.amount >= 1000) return 'loanCheck';
      if (RX.why.test(t)) return 'why';
      if (RX.more.test(t)) return 'more';
      if (ctx.pending && (ent.amount != null || RX.yes.test(t) || RX.no.test(t))) return 'pending';
      if (RX.afford.test(t)) return 'afford';
      if (RX.safe.test(t)) return 'safe';
      if (RX.credit.test(t)) return 'credit';
      if (RX.loan.test(t) && !RX.spend.test(t)) return 'loan';
      if (RX.biggest.test(t)) return 'biggest';
      if (RX.subs.test(t)) return 'subs';
      if (RX.budget.test(t)) return 'budget';
      if (RX.top.test(t)) return 'top';
      if (RX.transactions.test(t) && !RX.spend.test(t)) return 'transactions';
      if (RX.bills.test(t)) return 'bills';
      if (RX.income.test(t) && !RX.spend.test(t)) return 'income';
      if (RX.spend.test(t) || ((ent.category || ent.merchant) && ent.months.length)) return 'spend';
      if (RX.savings.test(t)) return 'savings';
      if (RX.balance.test(t)) return 'balance';
      if (RX.compare.test(t) && (ent.category || ent.merchant || ent.months.length)) return 'spend';
      if (RX.thanks.test(t)) return 'thanks';
      if (RX.bye.test(t)) return 'bye';
      if (RX.greet.test(t)) return 'greet';
      if (RX.who.test(t)) return 'who';
      // follow-up: "what about groceries?", "and August?", or just "Taco Bell"
      if (ctx.intent && (RX.followup.test(t) || t.trim().split(' ').length <= 4) && (ent.category || ent.merchant || ent.months.length || ent.amount != null)) return 'follow';
      if (ent.category || ent.merchant) return 'spend';
      return 'unknown';
    }

    // ---------- answering
    const R = (text, extra) => Object.assign({ text, actions: [], basis: null }, extra || {});
    const periodLabel = (m) => m === 'all' ? 'from April to September' : 'in ' + monthName(m);
    const goalNote = () => mem.goals.length ? mem.goals[mem.goals.length - 1] + (/\b(fund|savings)\b/.test(mem.goals[mem.goals.length - 1]) ? '' : ' fund') : null;

    const H = {};

    H.greet = () => {
      const who = mem.name || first;
      if (returning && turns === 0 && ctx.intent) return R(`Hey ${who}, welcome back. Last time we were looking at ${topicLabel()}. Want to pick that up, or something new?`);
      return R(`Hey ${who}. Ask me about your spending, bills, budget, savings or anything you're thinking of buying.`);
    };
    H.who = () => R(`I'm Mercer, your FNB money guide. I answer from your actual account data (${plural(txns.length, 'transaction')} from April to September), and I remember what you tell me. Try:\n• "How much did I spend on dining out in August?"\n• "What bills are coming up?"\n• "Can I afford a $300 jacket?"\n• "Set my groceries budget to $450"`);
    H.thanks = () => R(['Anytime.', 'Happy to help.', 'Of course. Anything else?'][mem.history.length % 3]);
    H.bye = () => R(`See you${mem.name ? ', ' + mem.name : ''}. I'll remember where we left off.`);

    H.balance = (e, t) => {
      const c = sts().checking, s = D.accounts.savings;
      if (/\bsaving/.test(t) && !/\bcheck/.test(t)) return R(`Your savings ${D.accounts.savingsMask} has ${money(s)}.`, { basis: `Savings balance as of ${prettyDate(D.asOf)}, including monthly interest.`, actions: [{ label: 'See goals', ask: 'How are my savings goals doing?' }] });
      if (/\bcheck/.test(t) && !/\bsaving/.test(t)) return R(`Your checking ${D.accounts.checkingMask} has ${money(c)}.`, { basis: `Running balance after the last posted transaction on ${prettyDate(D.asOf)}.` });
      return R(`You have ${money(c + s)} in total: ${money(c)} in checking and ${money(s)} in savings.`, { basis: `Balances as of ${prettyDate(D.asOf)}, the last day of posted activity.`, actions: [{ label: 'What can I spend?', ask: 'How much can I safely spend?' }] });
    };

    H.spend = (e, t) => {
      const noMonth = !e.months.length;
      const month = !noMonth ? e.months[e.months.length - 1] : (e.isFollow && ctx.ent.month) ? ctx.ent.month : (e.merchant ? 'all' : latest);
      const second = e.months.length >= 2 ? e.months[e.months.length - 2] : null;
      const { category, merchant } = e;
      const what = merchant || category;
      const label = merchant ? 'at ' + merchant : category ? 'on ' + category.toLowerCase() : '';
      setCtx('spend', { month, category, merchant });

      if (second && second !== 'all' && month !== 'all') { // explicit two-month comparison
        const a = spendOf({ month: second, category, merchant }).total, b = spendOf({ month, category, merchant }).total;
        const diff = b - a;
        return R(`You spent ${money(b)} ${label} in ${monthName(month)} vs ${money(a)} in ${monthName(second)}. That's ${money(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'}${a ? ` (${Math.round(Math.abs(diff) / a * 100)}%)` : ''}.`.replace('  ', ' '),
          { basis: `Sum of expense transactions${what ? ' ' + label : ''} in each month.` });
      }
      const { total, rows } = spendOf({ month, category, merchant });
      if (!rows.length) {
        if (merchant && !txns.some((x) => x.merchant === merchant)) {
          const bill = D.bills.find((b) => b.payee === merchant);
          return R(bill ? `${merchant} hasn't been charged to checking in this data, but it's listed as a ${money(bill.amount)} bill on the ${ordinal(bill.day)} of each month.` : `I don't see any charges at ${merchant}.`);
        }
        return R(`I don't see any ${what ? (merchant ? 'charges at ' + merchant : category.toLowerCase() + ' spending') : 'spending'} ${periodLabel(month)}.`);
      }
      if (month === 'all' && e.merchant) {
        const last = rows[rows.length - 1];
        setCtx('spend', { month: noMonth ? null : month, category, merchant });
        return R(`You've spent ${money(total)} at ${merchant} from April to September (${plural(rows.length, 'visit')}), about ${money(total / months.length)} a month. Most recent: ${money(-last.amount)} on ${prettyDate(last.date)}.`,
          { basis: `${plural(rows.length, 'expense transaction')} at ${merchant}.`, actions: rows.length > 1 ? [{ label: 'Show them', ask: 'show me' }] : [] });
      }
      if (month === 'all') {
        const avg = total / months.length;
        return R(`You've spent ${money(total)}${label ? ' ' + label : ''} from April to September, about ${money(avg)} a month across ${plural(rows.length, 'purchase')}.`,
          { basis: `${plural(rows.length, 'expense transaction')} over ${months.length} months.`, actions: what ? [] : [{ label: 'Where does it go?', ask: 'Where does my money go?' }] });
      }
      const avg = monthlyAverage(category, merchant, month);
      const vs = avg > 0 ? (Math.abs(total - avg) / avg < 0.05 ? ' That\'s about your usual.' : ` That's ${money(Math.abs(total - avg))} ${total > avg ? 'more' : 'less'} than your average of ${money(avg)}.`) : '';
      let text = `You spent ${money(total)}${label ? ' ' + label : ''} in ${monthName(month)} across ${plural(rows.length, 'purchase')}.${vs}`;
      if (!what) {
        const top = byCategory(month).slice(0, 3).map(([c, s]) => `${c} ${money(s, false)}`);
        text += `\nBiggest: ${top.join(', ')}. (Rent alone is ${money(spendOf({ month, category: 'Housing' }).total, false)}.)`;
      } else if (category && rows.length > 1) {
        const byM = {}; rows.forEach((r) => { byM[r.merchant] = (byM[r.merchant] || 0) - r.amount; });
        const topM = Object.entries(byM).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, s]) => `${m} ${money(s)}`);
        text += `\nMostly: ${topM.join(', ')}.`;
      }
      const g = goalNote();
      if (category && VARIABLE_CATS.includes(category) && total > avg * 1.15 && g) text += `\nTrimming this back would help with your ${g}.`;
      return R(text, { basis: `Sum of ${plural(rows.length, 'expense transaction')}${what ? ' ' + label : ''} in ${monthName(month)}; the average uses the other ${months.length - 1} months.`, actions: what && rows.length > 1 ? [{ label: 'Show them', ask: 'show me' }] : [] });
    };

    H.top = (e) => {
      const month = e.months[0] || ctx.ent.month || latest;
      setCtx('top', { month });
      const cats = byCategory(month);
      const total = sum(cats.map((c) => c[1]));
      const lines = cats.slice(0, 5).map(([c, s]) => `• ${c}: ${money(s)} (${Math.round(s / total * 100)}%)`);
      return R(`Here's where your money went ${periodLabel(month)} (${money(total)} total):\n${lines.join('\n')}`,
        { basis: 'Expense transactions grouped by category. Savings transfers are not counted as spending.', actions: [{ label: 'Open Budget', view: 'budget' }] });
    };

    H.biggest = (e) => {
      const month = e.months[0] || ctx.ent.month || 'all';
      const pool = expenses.filter(inMonth(month)).filter((t) => !e.category || t.category === e.category);
      const nonRent = pool.filter((t) => !t.recurring).sort((a, b) => a.amount - b.amount);
      if (!nonRent.length) return R(`I don't see any purchases ${periodLabel(month)}.`);
      const top = nonRent.slice(0, 3);
      setCtx('biggest', { month, category: e.category });
      return R(`Your biggest ${e.category ? e.category.toLowerCase() + ' ' : ''}purchases ${periodLabel(month)} (not counting regular bills):\n` + top.map((t) => `• ${money(-t.amount)} at ${t.merchant} on ${prettyDate(t.date)} (${t.category})`).join('\n'));
    };

    H.transactions = (e, t) => {
      const n = Math.min(parseInt((t.match(/\b(\d{1,2})\b/) || [])[1] || '5', 10), 15);
      const month = e.months[0] || null;
      let rows = txns.filter((x) => !/internal savings/i.test(x.merchant)).filter(inMonth(month))
        .filter((x) => !e.category || x.category === e.category).filter((x) => !e.merchant || x.merchant === e.merchant);
      rows = rows.slice(-n).reverse();
      if (!rows.length) return R("I don't see any matching transactions.");
      setCtx('transactions', { month, category: e.category, merchant: e.merchant });
      const head = e.merchant ? `at ${e.merchant}` : e.category ? `for ${e.category.toLowerCase()}` : '';
      return R(`Your last ${plural(rows.length, 'transaction')} ${head}${month ? ' ' + periodLabel(month) : ''}:\n` +
        rows.map((x) => `• ${prettyDate(x.date)}  ${x.merchant}  ${x.amount > 0 ? '+' : ''}${money(x.amount)}`).join('\n'));
    };

    H.bills = (e) => {
      const up = D.safeToSpend.upcoming;
      const target = e.merchant || e.category;
      if (target) {
        const hit = up.find((b) => b.name === e.merchant || b.category === e.category) || D.bills.find((b) => b.payee === e.merchant || b.category === e.category);
        setCtx('bills', { merchant: e.merchant, category: e.category });
        if (!hit) return R(`I don't see a recurring bill for ${target}.`);
        const date = hit.date ? prettyDate(hit.date) : 'the ' + ordinal(hit.day);
        return R(`${hit.name || hit.bill} is next due ${date}: about ${money(hit.amount)}.`, { basis: 'Due dates and amounts are estimated from past payments (median of the last 3), same as the Safe to spend tool.' });
      }
      setCtx('bills', {});
      const total = sum(up.map((b) => b.amount));
      const next = up.slice(0, 5).map((b) => `• ${prettyDate(b.date)}: ${b.name} ${money(b.amount)}`);
      return R(`You have ${plural(up.length, 'bill')} in the next 30 days, about ${money(total)} total. Coming up first:\n${next.join('\n')}`,
        { basis: `Estimated from recurring payments in your history, starting ${prettyDate(D.asOf)}.`, actions: [{ label: 'Open Safe to spend', view: 'safe' }] });
    };

    H.subs = () => {
      const subs = D.bills.filter((b) => b.category === 'Subscriptions' || b.priority === 'Optional');
      const total = sum(subs.map((b) => b.amount));
      setCtx('subs', {});
      return R(`You pay ${money(total)} a month (${money(total * 12, false)} a year) for optional subscriptions:\n` +
        subs.map((b) => `• ${b.payee}: ${money(b.amount)} on the ${ordinal(b.day)}`).join('\n') + `\nThose are the easiest to cut if you need room.`,
        { basis: 'Bills marked Optional in your recurring bills list.' });
    };

    H.income = () => {
      const m = incomeOf(latest), avg = sum(months.map((x) => incomeOf(x).total)) / months.length;
      setCtx('income', {});
      return R(`You take home about ${money(avg)} a month from ${D.person.employer}, paid twice a month (${D.person.payDays}). In September that was ${money(m.total)}. Your next payday is Oct 15.`,
        { basis: `Payroll deposits ${periodLabel('all')}.` });
    };

    H.savings = (e, t) => {
      setCtx('savings', {});
      const lines = D.goals.map((g) => {
        const left = g.target - g.saved, mo = Math.ceil(left / g.monthly);
        const doneBy = addMonths(D.asOf, mo);
        const onTrack = doneBy <= g.deadline;
        return `• ${g.name}: ${money(g.saved, false)} of ${money(g.target, false)} (${Math.round(g.saved / g.target * 100)}%). At ${money(g.monthly, false)}/month you'll hit it around ${monthYear(doneBy)}, ${onTrack ? 'ahead of' : 'after'} your ${monthYear(g.deadline)} deadline.`;
      });
      let text = `You have ${money(D.accounts.savings)} in savings and you move ${money(D.rules.monthlySavings, false)} into it every month.\n${lines.join('\n')}`;
      const g = goalNote(); if (g && !D.goals.some((x) => x.name.toLowerCase().includes(g))) text += `\nYou also told me you're saving for ${aOrAn(g)}. Want me to factor that in when you ask about purchases? I already will.`;
      return R(text, { basis: 'Savings goals and monthly allocations from your profile.' });
    };

    H.safe = () => {
      const s = sts();
      setCtx('safe', {});
      return R(`You can safely spend ${money(s.amount)} over the next 30 days.\nThat's your ${money(s.checking)} checking minus ${money(s.bills)} in upcoming bills, ${money(s.variable)} for everyday spending like groceries and gas, ${money(s.savings, false)} for savings and a ${money(s.buffer, false)} cushion. I don't count future paychecks, to stay safe.`,
        { basis: 'Same calculation as the Safe-to-Spend Forecast in the team app.', actions: [{ label: 'Open Safe to spend', view: 'safe' }] });
    };

    H.afford = (e, t) => {
      const amount = e.amount;
      const item = e.item || (ctx.pending === 'afford' ? ctx.ent.item : null) || null;
      if (amount == null) {
        ctx.pending = 'afford'; ctx.ent.item = item; persistCtx();
        return R(`Sure${item ? `, let's check the ${item}` : ''}. How much does it cost?`);
      }
      ctx.pending = null;
      const s = sts().amount, after = s - amount;
      setCtx('afford', { amount, item });
      const thing = item ? `the ${item}` : `${money(amount)}`;
      const g = goalNote();
      if (amount <= s * 0.5) return R(`Yes, ${thing}${item ? ` (${money(amount)})` : ''} fits. You'd still have ${money(after)} safe to spend this month.${g ? ` It won't slow down your ${g}.` : ''}`, { basis: `Compared with your safe-to-spend of ${money(s)}.` });
      if (amount <= s) return R(`You can, but it's a big chunk: ${thing} would use ${Math.round(amount / s * 100)}% of your ${money(s)} safe-to-spend, leaving ${money(after)}.${g ? ` It could push back your ${g}.` : ''} If it can wait until after your Oct 15 paycheck, that's safer.`, { basis: `Compared with your safe-to-spend of ${money(s)}.` });
      const fromSavings = amount - s;
      return R(`Not comfortably. ${cap(thing)} is ${money(amount - s)} more than you can safely spend right now (${money(s)}). You'd have to dip into savings${g ? ` and your ${g}` : ''}, or wait a paycheck or two.`, { basis: `Compared with your safe-to-spend of ${money(s)}. Savings: ${money(D.accounts.savings)}.`, actions: [{ label: 'Am I ready to sign?', view: 'ready' }].slice(0, amount > 5000 ? 1 : 0) });
    };

    H.budget = (e) => {
      const b = budgetStatus(e.months[0] && e.months[0] !== 'all' ? e.months[0] : latest);
      setCtx('budget', { month: b.month, category: e.category });
      if (e.category) {
        const sp = spendOf({ month: b.month, category: e.category }).total, lim = limitFor(e.category);
        return R(`${e.category} in ${b.monthLabel}: ${money(sp)} of your ${money(lim, false)} limit. ${sp > lim ? `Over by ${money(sp - lim)}.` : `${money(lim - sp)} to spare.`}${mem.budgets[e.category] == null ? ' (That limit is your 6-month average. Tell me a number to change it.)' : ''}`,
          { actions: [{ label: 'Open Budget', view: 'budget' }] });
      }
      const overs = b.cats.filter((c) => c.over).map((c) => `${c.name} (+${money(c.spent - c.limit)})`);
      const head = b.over ? `You went ${money(-b.left)} over your ${money(b.limit, false)} limit in ${b.monthLabel} (${money(b.spent)} spent).` : `You stayed ${money(b.left)} under your ${money(b.limit, false)} limit in ${b.monthLabel} (${money(b.spent)} spent).`;
      return R(head + (overs.length ? `\nOver in: ${list(overs)}.` : '\nEvery category was within its limit.'),
        { basis: 'Limits are your 6-month averages unless you set your own.', actions: [{ label: 'Open Budget', view: 'budget' }] });
    };

    H.setBudget = (e, t) => {
      const amount = e.amount;
      if (e.category) { mem.budgets[e.category] = amount; save(); setCtx('budget', { category: e.category });
        const sp = spendOf({ month: latest, category: e.category }).total;
        return R(`Done. Your ${e.category.toLowerCase()} budget is now ${money(amount, false)} a month. In September you spent ${money(sp)}, so you'd have been ${sp > amount ? money(sp - amount) + ' over' : money(amount - sp) + ' under'}. I'll remember this.`, { actions: [{ label: 'Open Budget', view: 'budget' }] }); }
      mem.monthlyLimit = amount; save(); setCtx('budget', {});
      const sp = spendOf({ month: latest }).total;
      return R(`Done. Your monthly spending limit is now ${money(amount, false)}. September was ${money(sp)}, so that's ${sp > amount ? money(sp - amount) + ' over' : money(amount - sp) + ' under'}. I'll remember this.`, { actions: [{ label: 'Open Budget', view: 'budget' }] });
    };

    const setNum = (k, v) => { mem.settings = Object.assign({}, mem.settings, { [k]: v }); save(); };
    H.setCushion = (e) => { setNum('buffer', e.amount); setCtx('safe', {}); return R(`Done. I'll keep a ${money(e.amount, false)} cushion in checking. That makes your safe-to-spend ${money(sts().amount)}.`, { actions: [{ label: 'Open Money', view: 'safe' }] }); };
    H.setSavings = (e) => { setNum('monthlySavings', e.amount); setCtx('safe', {}); return R(`Done. I'll set aside ${money(e.amount, false)} a month for savings. Your safe-to-spend is now ${money(sts().amount)}.`, { actions: [{ label: 'Open Money', view: 'safe' }] }); };
    H.setChecking = (e) => { setNum('checking', e.amount); setCtx('balance', {}); return R(`Updated your checking to ${money(e.amount)} for the demo. Safe-to-spend is now ${money(sts().amount)}.`, { actions: [{ label: 'Open Money', view: 'safe' }] }); };
    H.setScore = (e) => { if (e.amount < 300 || e.amount > 850) return R('Credit scores run from 300 to 850. What is yours?'); setNum('creditScore', e.amount); setCtx('credit', {}); return R(`Got it, your score is ${e.amount}. I'll use that in the Credit score tool.`, { actions: [{ label: 'Open Credit score', view: 'credit' }] }); };
    H.loanCheck = (e, t) => {
      const apr = parseFloat((t.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1]);
      const yrs = t.match(/(\d{1,2})\s*(?:years?|yrs?)\b/), mos = t.match(/(\d{2,3})\s*(?:months?|mos?)\b/);
      const downM = t.match(/(\d[\d,]*)\s*(?:k\b)?\s*down\b|down(?: payment)? (?:of )?\$?(\d[\d,]*)/);
      const L = { price: e.amount, apr: isFinite(apr) ? apr : 7, term: mos ? +mos[1] : yrs ? +yrs[1] * 12 : 60, down: downM ? parseFloat((downM[1] || downM[2]).replace(/,/g, '')) : 0, fees: 0, financed: false };
      const d = decision(L); if (d.error) return R(d.error);
      setCtx('loan', {});
      const assumed = [isFinite(apr) ? null : '7% APR', mos || yrs ? null : '60 months'].filter(Boolean);
      const worst = d.reasons.slice().sort((x, y) => (y.warn - x.warn) || (x.ok - y.ok));
      return R(`${d.head}\nA ${money(L.price, false)} ${L.down ? `purchase with ${money(L.down, false)} down` : 'loan'} at ${L.apr}% for ${L.term} months is ${money(d.loan.payment)}/month and ${money(d.loan.interest, false)} in interest.\n` + worst.slice(0, 2).map((r) => '• ' + r.text).join('\n') + (assumed.length ? `\n(I assumed ${list(assumed)}. Change them in Decide.)` : ''),
        { basis: 'Payment uses the same formula as the team calculator; debt and income are averages from your last 6 months.', loan: L, actions: [{ label: 'See full check', view: 'ready', loan: L }] });
    };

    H.credit = () => { setCtx('credit', {}); return R(`${mem.settings.creditScore ? `You told me your score is ${mem.settings.creditScore}.` : "Your credit score isn't in the account data I can see, so I won't guess it. The 710 in the Credit score tool is a demo number until you enter yours."}\nWhat I can tell from your data: all ${plural(D.bills.filter((b) => b.priority === 'Essential').length, 'essential bill')} were paid on time every month, which is the biggest factor in a score.`, { actions: [{ label: 'Open Credit score', view: 'credit' }] }); };
    H.loan = () => { setCtx('loan', {}); return R(`Tell me the loan and I'll check it against your numbers, for example: "Can I handle a $25,000 car loan at 6.5% for 60 months?"\nYou already pay ${money(debtMonthly)} a month in loans (${list(debtBills.map((b) => b.payee))}), so I'll factor that in.`, { actions: [{ label: 'Open Loan check', view: 'loan' }] }); };

    H.urgent = () => { setCtx('help', {}); return R("That needs a person right away. Call FNB's Customer Contact Center at 800-555-5455 to lock your card or dispute a charge. I can't do that myself, and I won't pretend to.\nI'll pass along what we've talked about if you connect from Help.", { actions: [{ label: 'Open Help', view: 'help' }] }); };
    H.human = () => { setCtx('help', {}); return R(`Sure. I'll hand you to an FNB specialist with a summary of our chat, so you don't have to repeat yourself. You can also call 800-555-5455.`, { actions: [{ label: 'Talk to a person', view: 'help' }] }); };

    // ---------- memory intents
    H.name = (e, t) => {
      const m = t.match(RX.memName) || t.match(/^\s*(?:i'm|im|i am) ([a-z]+)\s*$/);
      const nm = titleCase(m[1]); mem.name = nm; save();
      return R(`Nice to meet you, ${nm}. I'll remember that.`);
    };
    H.goalSet = (e, t) => {
      const m = t.match(RX.memGoal) || t.match(RX.memGoal2);
      const g = m[1].replace(/\b(and|but|so|because)\b.*$/, '').trim();
      if (!mem.goals.includes(g)) mem.goals.push(g); save();
      setCtx('savings', {});
      return R(`Got it, you're saving for ${aOrAn(g)}. I'll keep that in mind when you ask about spending or purchases.${e.amount ? ` A ${money(e.amount, false)} target at ${money(D.rules.monthlySavings, false)}/month would take about ${Math.ceil(e.amount / D.rules.monthlySavings)} months.` : ''}`);
    };
    H.remember = (e, t) => {
      const fact = t.match(RX.memRemember)[1].trim().replace(/[.!]+$/, '');
      mem.facts.push(fact); save();
      return R(`Noted: "${fact}". I'll remember it.`);
    };
    H.recall = () => {
      const bits = [];
      bits.push(`I know your name is ${mem.name || first}${mem.name ? '' : ' (from your account)'}.`);
      if (mem.goals.length) bits.push(`You're saving for ${list(mem.goals.map(aOrAn))}.`);
      const b = Object.entries(mem.budgets).map(([c, v]) => `${c} ${money(v, false)}`);
      if (b.length) bits.push(`Your budgets: ${b.join(', ')}.`);
      if (mem.monthlyLimit != null) bits.push(`Monthly limit: ${money(mem.monthlyLimit, false)}.`);
      if (mem.facts.length) bits.push(`You asked me to remember: ${mem.facts.map((f) => '"' + f + '"').join(', ')}.`);
      if (ctx.intent) bits.push(`We were last talking about ${topicLabel()}.`);
      bits.push(`You've sent me ${plural(mem.history.filter((h) => h.from === 'me').length, 'message')} on this device. Say "forget everything" to wipe it.`);
      return R(bits.join('\n'));
    };
    H.forget = () => { mem = blank(); ctx = { intent: null, ent: {}, basis: null, pending: null }; save(); return R('Done. I\'ve forgotten our chats, your goals, budgets and anything you told me. Your account data is unchanged.', { cleared: true }); };

    // ---------- conversational glue
    H.why = () => ctx.basis ? R(`Here's where that came from: ${ctx.basis}`) : R("I haven't given you a number yet. Ask me something and I'll show my work.");
    H.more = () => {
      const e = ctx.ent || {};
      if (ctx.intent === 'spend' || ctx.intent === 'budget') return H.transactions({ months: e.month && e.month !== 'all' ? [e.month] : [], category: e.category, merchant: e.merchant }, ' 10 ');
      if (ctx.intent === 'bills') return R(D.safeToSpend.upcoming.map((b) => `• ${prettyDate(b.date)}: ${b.name} ${money(b.amount)}`).join('\n'));
      if (ctx.intent === 'top') return H.top({ months: ['all'] });
      return R('Tell me what you want more detail on, like a category, a store or a month.');
    };
    H.pending = (e, t) => {
      if (ctx.pending === 'afford') { if (RX.no.test(t)) { ctx.pending = null; persistCtx(); return R('No problem.'); } if (e.amount != null) return H.afford(Object.assign({}, e, { item: ctx.ent.item }), t); }
      ctx.pending = null; persistCtx(); return R('Okay. What would you like to know?');
    };
    H.follow = (e, t) => {
      const prev = ctx.ent || {};
      const merged = { months: e.months.length ? e.months : (prev.month ? [prev.month] : []), category: e.category || (e.merchant ? null : prev.category), merchant: e.merchant || (e.category ? null : prev.merchant), amount: e.amount != null ? e.amount : prev.amount, item: e.item || prev.item };
      const map = { spend: 'spend', budget: 'budget', bills: 'bills', transactions: 'transactions', top: 'top', biggest: 'biggest', afford: 'afford' };
      const intent = map[ctx.intent] || 'spend';
      return H[intent](merged, t);
    };
    H.unknown = (e, t) => {
      if (/\b(stock|invest|crypto|bitcoin|tax|taxes|mortgage rate|interest rates?|inflation|weather|news)\b/.test(t))
        return R("That's outside your account data, so I'd only be guessing, and I won't do that. I can help with your spending, bills, budget, savings goals and what you can afford.");
      return R(`I didn't catch that. I can answer from your account data, for example:\n• "How much did I spend on groceries in July?"\n• "What's coming up this week?"\n• "Can I afford a $250 concert ticket?"`);
    };

    // ---------- small utils needing data
    function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
    function addMonths(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
    function monthYear(iso) { return monthName(iso.slice(0, 7)) + ' ' + iso.slice(0, 4); }
    function aOrAn(w) { return (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w; }
    function setCtx(intent, ent) { ctx.intent = intent; ctx.ent = Object.assign({}, ent); persistCtx(); }
    function persistCtx() { mem.topic = { intent: ctx.intent, ent: ctx.ent, basis: ctx.basis, pending: ctx.pending }; save(); }
    function topicLabel() {
      const e = ctx.ent || {};
      const what = e.merchant || (e.category && e.category.toLowerCase());
      const when = e.month && e.month !== 'all' ? ' in ' + monthName(e.month) : '';
      return ({ spend: (what ? 'your ' + what + ' spending' : 'your spending') + when, budget: 'your budget', bills: 'your upcoming bills', savings: 'your savings goals', safe: 'what you can safely spend', afford: e.item ? 'whether you can afford the ' + e.item : 'a purchase you were considering', income: 'your income', subs: 'your subscriptions', top: 'where your money goes', credit: 'your credit score', loan: 'the SUV loan', help: 'getting help from a person', transactions: 'your recent transactions', biggest: 'your biggest purchases' })[ctx.intent] || 'your finances';
    }

    // ---------- public API
    function respond(text) {
      const raw = String(text || '').slice(0, 500);
      const t = norm(raw);
      const ent = { category: findCategory(t), merchant: findMerchant(t), months: findMonths(t), amount: findAmount(t), item: findItem(t) };
      if (ent.merchant && ent.category && !CATEGORY_WORDS[ent.category].some((w) => t.includes(' ' + w + ' ') && !ent.merchant.toLowerCase().includes(w))) ent.category = null;
      const intent = classify(t, ent);
      ent.isFollow = intent === 'follow';
      let out;
      try { out = H[intent](ent, t); } catch (err) { out = R("Sorry, I tripped over that one. Could you ask it another way?"); }
      if (out.basis) ctx.basis = out.basis;
      turns += 1;
      if (out.cleared) return Object.assign(out, { intent });
      mem.history.push({ from: 'me', text: raw, at: Date.now() }, { from: 'bot', text: out.text, at: Date.now(), actions: out.actions });
      if (mem.history.length > 80) mem.history = mem.history.slice(-80);
      mem.lastVisit = Date.now();
      persistCtx();
      return Object.assign(out, { intent });
    }

    function suggestions() {
      const s = [];
      if (ctx.intent === 'spend' && ctx.ent.category) s.push((() => { const m = ctx.ent.month && ctx.ent.month !== 'all' ? ctx.ent.month : latest; const i = months.indexOf(m); return i > 0 ? `What about ${monthName(months[i - 1])}?` : 'What about all six months?'; })(), `Set my ${ctx.ent.category.toLowerCase()} budget to $${round(limitFor(ctx.ent.category) * 0.9)}`);
      else if (ctx.intent === 'budget') s.push('Where does my money go?');
      else if (ctx.intent === 'bills') s.push('What are my subscriptions?');
      else if (ctx.intent === 'afford') s.push('Why?');
      s.push('Am I on budget?', 'How much did I spend on dining out?', 'What bills are coming up?', 'Can I afford a $300 jacket?', 'What do you remember about me?');
      return Array.from(new Set(s)).slice(0, 4);
    }

    function greeting() {
      const who = mem.name || first;
      if (returning) return `Welcome back, ${who}.${ctx.intent ? ` Last time we talked about ${topicLabel()}.` : ''} What's on your mind?`;
      return `Hi ${who}, I'm Mercer. I answer from your real account activity and I remember what you tell me. Ask me anything about your money.`;
    }

    return {
      respond, suggestions, greeting, budgetStatus, sts, loanSummary, decision, whatIf, translate, trust,
      setting: (k, d) => setting(k, d), setSetting: (k, v) => { setNum(k, v); }, resetSettings: () => { mem.settings = {}; mem.budgets = {}; mem.monthlyLimit = null; save(); },
      setBudget: (cat, v) => { mem.budgets[cat] = v; save(); },
      facts: () => ({ avgIncome, avgSpend, debtMonthly }),
      summary: () => ({ topic: ctx.intent ? topicLabel() : 'none yet', goals: mem.goals.slice(), recent: mem.history.filter((h) => h.from === 'me').slice(-3).map((h) => h.text) }),
      setMonthlyLimit(v) { mem.monthlyLimit = v; save(); },
      memory: () => JSON.parse(JSON.stringify({ name: mem.name, facts: mem.facts, goals: mem.goals, budgets: mem.budgets, monthlyLimit: mem.monthlyLimit })),
      history: () => mem.history.slice(),
      forget: () => H.forget(),
      importHistory(h) { if (Array.isArray(h) && !mem.history.length) { mem.history = h.slice(-80); save(); } },
      data: D, latest, monthName, money
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MercerBrain = api;
})(typeof window !== 'undefined' ? window : this);
