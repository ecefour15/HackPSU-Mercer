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
    const blank = () => ({ name: null, facts: [], goals: [], budgets: {}, monthlyLimit: null, history: [], topic: null, visits: 0, lastVisit: null });
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
    function norm(s) { return ' ' + s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$&.,'\- ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }

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
      if (RX.setBudget.test(t) && ent.amount != null) return 'setBudget';
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
      const c = D.accounts.checking, s = D.accounts.savings;
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
      const s = D.safeToSpend;
      setCtx('safe', {});
      return R(`You can safely spend ${money(s.amount)} over the next 30 days.\nThat's your ${money(D.accounts.checking)} checking minus ${money(s.bills)} in upcoming bills, ${money(s.variable)} for everyday spending like groceries and gas, ${money(s.savings, false)} for savings and a ${money(s.buffer, false)} cushion. I don't count future paychecks, to stay safe.`,
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
      const s = D.safeToSpend.amount, after = s - amount;
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

    H.credit = () => { setCtx('credit', {}); return R(`Your credit score isn't in the account data I can see, so I won't guess it. The 710 in the Credit score tool is a demo number for showing how scores work.\nWhat I can tell from your data: all ${plural(D.bills.filter((b) => b.priority === 'Essential').length, 'essential bill')} were paid on time every month, which is the biggest factor in a score.`, { actions: [{ label: 'Open Credit score', view: 'credit' }] }); };
    H.loan = () => { setCtx('loan', {}); return R(`The SUV loan in Loan check is a sample contract for the demo, not one of your accounts. On it: $629/month for 72 months, about $9,320 in interest, plus an early payoff fee.\nYou already pay Toyota Financial ${money(318.75)} a month for a car loan, so a second payment would be a big jump.`, { actions: [{ label: 'Open Loan check', view: 'loan' }, { label: 'Am I ready to sign?', view: 'ready' }] }); };

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
      respond, suggestions, greeting, budgetStatus,
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
