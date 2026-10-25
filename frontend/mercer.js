/*
 * Mercer — FNB money assistant (concept, HackPSU).
 * One component shared by the website (index.html) and the phone app (phone.html).
 *
 * Needs Preact + htm loaded first (see the <script> tags in the HTML files). No build step.
 * Usage:  Mercer.mount(document.getElementById('mercer'), { mode: 'web' | 'phone', botName: 'Mercer' })
 *
 * All numbers are DEMO data. Chat replies are scripted; swap reply() for a call to the
 * backend (backend/ in this repo) or an LLM when you wire it up.
 */
(function () {
  const { h, render, Component } = window.preact;
  const html = window.htm.bind(h);

  // ---------- helpers ----------
  const fmt = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Keystone = ({ size = 18 }) => html`
    <svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 4.5h16l-2.6 15H6.6z" stroke-width="1.9" />
      <path d="M8.6 15.4V8.8l3.4 3.9 3.4-3.9v6.6" stroke-width="2.1" />
    </svg>`;

  const Logo = ({ size = 'lg' }) => html`
    <span class=${'m-logo ' + size}>
      <span class="back"></span>
      <span class="front"><${Keystone} size=${size === 'lg' ? 22 : size === 'hd' ? 19 : 17} /></span>
    </span>`;

  const Icon = {
    back: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>`,
    close: (s = 16, w = 2.2) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${w} stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>`,
    moon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>`,
    sun: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>`,
    send: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>`
  };

  // ---------- demo data ----------
  // Tabs: 3 main ones that fit on one line, a "More" menu, then Help (customer care) last.
  const MAIN_TABS = [['home', 'Chat'], ['money', 'Money'], ['decide', 'Decide']];
  const MORE_TABS = [['credit', 'Credit score'], ['next', 'Next steps'], ['translate', 'Translate'], ['legit', 'Legit check']];
  const VIEW_INFO = {
    home: ['Chat', ''],
    money: ['Money', 'What you can spend, budget and bills'],
    decide: ['Decide', 'Check it before you commit'],
    credit: ['Credit score', 'Your score and how to raise it'],
    next: ['Next steps', 'One small task at a time'],
    translate: ['Translate', 'Bank-speak to plain English'],
    legit: ['Legit check', 'Spot hype and paid promos'],
    help: ['Help', 'Talk to a person · FNB phone numbers']
  };
  const SUBS = {
    money: [['safe', 'Safe to spend'], ['budget', 'Budget']],
    decide: [['afford', 'Afford it?'], ['loan', 'Loan check'], ['ready', 'Ready?'], ['whatif', 'What if']]
  };
  // Old view names (used by chat actions) -> [tab, sub-tab]
  const ALIAS = { safe: ['money', 'safe'], budget: ['money', 'budget'], afford: ['decide', 'afford'], loan: ['decide', 'loan'], ready: ['decide', 'ready'], whatif: ['decide', 'whatif'] };
  const HOME_TILES = [
    ['money', 'Money', 'What you can spend, budget, bills'],
    ['decide', 'Decide', 'Afford it? Ready to sign?'],
    ['credit', 'Credit score', 'How to raise it'],
    ['next', 'Next steps', 'One small task at a time'],
    ['translate', 'Translate', 'Bank-speak, plain English'],
    ['help', 'Talk to a person', 'FNB customer care']
  ];
  // F.N.B. Customer Contact Center numbers, as published on fnb-online.com/privacy
  const CARE = { main: '800-555-5455', mainTel: '+18005555455', vanity: '833-BANK-FNB', vanityTel: '+18332265362', branches: 'https://locations.fnb-online.com/' };
  const FEELINGS = [['excited', 'Excited'], ['calm', 'Calm'], ['pressured', 'Pressured'], ['anxious', 'Anxious'], ['confident', 'Confident'], ['fomo', 'Afraid to miss out']];
  const STEPS = [[1, 'Link your checking account', '2 min'], [2, 'Open a high-yield savings account', '5 min'], [3, 'Auto-transfer $25 every payday', '3 min']];
  const CREDIT_BASE = 710;
  const CREDIT_MOVES = [['util', 'Pay cards under 10%', 20], ['ontime', '6 more on-time months', 10], ['noapp', 'Skip new card applications', 5], ['miss', 'Miss one payment', -60]];
  const CREDIT_FACTORS = [
    ['Payment history', '100% on time · biggest factor', 'Great', 'good'],
    ['Card usage', '28% of your limits · aim under 10%', 'Could improve', 'mid'],
    ['Credit age', 'Average account: 3 years', 'Building', 'mid'],
    ['Hard inquiries', '1 in the last 2 years', 'Good', 'good'],
    ['Credit mix', '1 card · no loans yet', 'Fine', 'good']
  ];
  const bandOf = (n) => n >= 800 ? ['Exceptional', '#16A34A', 'good'] : n >= 740 ? ['Very good', '#22C55E', 'good'] : n >= 670 ? ['Good', '#EAB308', 'mid'] : n >= 580 ? ['Fair', '#F97316', 'bad'] : ['Poor', '#DC2626', 'bad'];

  const FACE_HAPPY = ['..YYYYYY..', '.YYYYYYYY.', 'YYKYYYYKYY', 'YYKYYYYKYY', 'YYYYYYYYYY', 'YKYYYYYYKY', 'YYKYYYYKYY', 'YYYKKKKYYY', '.YYYYYYYY.', '..YYYYYY..'];
  const FACE_SAD = ['..YYYYYY..', '.YYYYYYYY.', 'YKKYYYYKKY', 'YYKYYYYKYY', 'YBYYYYYYYY', 'YBYYYYYYYY', 'YYYKKKKYYY', 'YYKYYYYKYY', '.YYYYYYYY.', '..YYYYYY..'];
  const PixelFace = ({ happy }) => {
    const rows = happy ? FACE_HAPPY : FACE_SAD;
    const pal = happy ? { Y: '#22C55E', K: '#0B3D1E' } : { Y: '#EF4444', K: '#3F0808', B: '#60A5FA' };
    const cells = [];
    rows.forEach((row, r) => row.split('').forEach((ch, c) => {
      const delay = ((r * 7 + c * 13) % 17) * 28 + (r + c) * 12;
      cells.push(html`<span class="px" style=${{ background: pal[ch] || 'transparent', animationDelay: delay + 'ms' }}></span>`);
    }));
    return html`<div class=${'pixels ' + (happy ? 'bob' : 'shake')} role="img"
      aria-label=${happy ? 'Happy face: you are under budget' : 'Sad face: you are over budget'}>${cells}</div>`;
  };

  // Tap-to-edit number. Shows a formatted value; on focus becomes a plain number to type; commits on Enter/blur.
  class EditNum extends Component {
    constructor(p) { super(p); this.state = { draft: null }; }
    commit() {
      const d = this.state.draft; if (d == null) return;
      this.setState({ draft: null });
      const v = parseFloat(String(d).replace(/[^0-9.\-]/g, ''));
      if (!isFinite(v)) return;
      const p = this.props, lo = p.min != null ? p.min : -Infinity, hi = p.max != null ? p.max : Infinity;
      p.onCommit(Math.max(lo, Math.min(hi, v)));
    }
    render(p, s) {
      const shown = s.draft != null ? s.draft : (p.format ? p.format(p.value) : String(p.value));
      return html`<label class=${'editnum ' + (p.cls || '')}>
        ${p.label && html`<span class="editnum-l">${p.label}</span>`}
        <span class="editnum-box">${p.prefix && html`<span class="editnum-a">${p.prefix}</span>`}<input type="text" inputmode="decimal" value=${shown}
          aria-label=${p.aria || p.label}
          onFocus=${(e) => { this.setState({ draft: String(p.value) }); const el = e.target; setTimeout(() => { try { el.select(); } catch (x) {} }, 0); }}
          onInput=${(e) => this.setState({ draft: e.target.value })}
          onBlur=${() => this.commit()}
          onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { this.setState({ draft: null }, () => e.target.blur()); } }} />${p.suffix && html`<span class="editnum-a">${p.suffix}</span>`}<span class="editnum-pen" aria-hidden="true">✎</span></span>
      </label>`;
    }
  }
  const num = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const SparkChart = ({ base, scen }) => {
    const W = 300, H = 110, max = Math.max(...base, ...scen, 1);
    const pts = (a) => a.map((v, i) => `${(i / (a.length - 1) * W).toFixed(1)},${(H - v / max * (H - 8) - 4).toFixed(1)}`).join(' ');
    return html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%" height="110" role="img" aria-label="Savings over the next 5 years, current plan versus this scenario" style="display:block">
      ${[1, 2, 3, 4].map((y) => html`<line x1=${y * 12 / 60 * W} x2=${y * 12 / 60 * W} y1="0" y2=${H} stroke="var(--line)" />`)}
      <polyline points=${pts(base)} fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 4" />
      <polyline points=${pts(scen)} fill="none" stroke="var(--primary)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
  };

  // ---------- the assistant ----------
  class Mercer extends Component {
    constructor(props) {
      super(props);
      let storage = null;
      try { storage = window.localStorage; storage.getItem('mercer.test'); } catch (e) { storage = null; }
      this.storage = storage;
      this.brain = window.MercerBrain.create({ data: window.MERCER_DATA, storage });
      this.api = props.apiUrl || (new URLSearchParams(location.search)).get('api') || null;
      this.session = this.sessionId();
      this.state = {
        open: props.startOpen !== false,
        dark: document.documentElement.dataset.theme === 'dark',
        view: 'home', draft: '', typing: false,
        msgs: this.brain.history(), greeting: this.brain.greeting(), suggestions: this.brain.suggestions(),
        picked: { excited: true, pressured: true }, scen: 'car', done: { 1: true },
        credit: {}, aiMode: false, tick: 0, sub: { money: 'safe', decide: 'afford' }, menu: false, handoff: false, toast: null,
        loan: { price: 25000, down: 3000, apr: 6.5, term: 60, fees: 800, financed: true },
        wi: { extra: 0, oneTime: 0 },
        transText: 'Interest accrues on a precomputed basis. A prepayment penalty may apply. Origination fee: $300. APR 7.9%.',
        legitText: "This app gives guaranteed returns, totally risk-free. Use my link for a bonus! You can't lose."
      };
      this.timer = null;
    }
    componentDidMount() {
      this.applyTheme();
      fillBank(document, Object.assign({ name: this.brain.memory().name }, this.brain.sts()));
      this.onDoc = (e) => {
        if (!this.state.menu) return;
        if (e.type === 'keydown' ? e.key === 'Escape' : !(e.target.closest && e.target.closest('.m-more'))) this.setState({ menu: false });
      };
      document.addEventListener('click', this.onDoc, true);
      document.addEventListener('keydown', this.onDoc);
    }
    componentDidUpdate(prevProps, prevState) {
      this.applyTheme();
      if (prevState.view !== this.state.view || (!prevState.open && this.state.open)) {
        if (this.body) this.body.scrollTop = 0;
        const active = this.rail && this.rail.querySelector('[aria-pressed="true"]');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      if (prevState.msgs.length !== this.state.msgs.length || prevState.typing !== this.state.typing) {
        if (this.body && this.state.view === 'home') this.body.scrollTop = this.body.scrollHeight;
      }
    }
    componentWillUnmount() { clearTimeout(this.timer); document.removeEventListener('click', this.onDoc, true); document.removeEventListener('keydown', this.onDoc); }
    applyTheme() { document.documentElement.dataset.theme = this.state.dark ? 'dark' : 'light'; }

    sessionId() {
      try {
        let id = this.storage && this.storage.getItem('mercer.session');
        if (!id) { id = 's-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); this.storage && this.storage.setItem('mercer.session', id); }
        return id;
      } catch (e) { return 's-anon'; }
    }

    // Local brain always answers from the data. If a backend is configured (?api=http://localhost:8000),
    // it also saves the chat in its database and, when it has an AI key, rewrites the answer more naturally
    // using only the same grounded facts. Any backend problem falls back to the local answer.
    async think(q) {
      const local = this.brain.respond(q);
      if (local.cleared) {
        if (this.api) fetch(this.api.replace(/\/$/, '') + '/chat/' + encodeURIComponent(this.session), { method: 'DELETE' }).catch(() => {});
        return local;
      }
      if (!this.api) return local;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        const res = await fetch(this.api.replace(/\/$/, '') + '/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ session_id: this.session, message: q, local_reply: local.text, intent: local.intent, memory: this.brain.memory() })
        });
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const out = await res.json();
        this.setState({ aiMode: !!out.ai });
        return Object.assign({}, local, { text: out.reply || local.text });
      } catch (e) {
        return local;
      }
    }
    ask(text) {
      const q = (text || '').trim();
      if (!q || this.state.typing) return;
      this.setState({ msgs: this.state.msgs.concat([{ from: 'me', text: q }]), draft: '', typing: true, view: 'home' });
      const started = Date.now();
      this.think(q).then((r) => {
        const wait = Math.max(0, Math.min(900, 350 + r.text.length * 2) - (Date.now() - started));
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (r.cleared) {
            this.setState({ typing: false, msgs: [{ from: 'bot', text: r.text }], greeting: this.brain.greeting(), suggestions: this.brain.suggestions(), tick: this.state.tick + 1 });
            fillBank(document, Object.assign({ name: this.brain.memory().name }, this.brain.sts()));
            return;
          }
          this.setState((s) => ({ typing: false, msgs: s.msgs.concat([{ from: 'bot', text: r.text, actions: r.actions }]), suggestions: this.brain.suggestions(), tick: s.tick + 1 }));
          fillBank(document, Object.assign({ name: this.brain.memory().name }, this.brain.sts()));
        }, wait);
      });
    }
    act(a) { if (a.loan) this.setState({ loan: Object.assign({}, this.state.loan, a.loan, { fees: a.loan.fees || 0 }) }); if (a.view) this.go(a.view); else if (a.ask) this.ask(a.ask); }
    refresh() { this.setState({ tick: this.state.tick + 1, suggestions: this.brain.suggestions() }); fillBank(document, Object.assign({ name: this.brain.memory().name }, this.brain.sts())); }
    updateSetting(k, v) { this.brain.setSetting(k, v); this.refresh(); }
    toast(text) { clearTimeout(this.toastT); this.setState({ toast: text }); this.toastT = setTimeout(() => this.setState({ toast: null }), 3800); }
    setLoan(patch) { this.setState({ loan: Object.assign({}, this.state.loan, patch) }); }
    forget() { const r = this.brain.forget(); this.setState({ msgs: [], greeting: this.brain.greeting(), suggestions: this.brain.suggestions(), tick: this.state.tick + 1 }); return r; }
    go(view) {
      const a = ALIAS[view];
      if (a) this.setState({ view: a[0], sub: Object.assign({}, this.state.sub, { [a[0]]: a[1] }), menu: false });
      else this.setState({ view, menu: false });
    }
    setSub(tab, sub) { this.setState({ sub: Object.assign({}, this.state.sub, { [tab]: sub }) }); }
    segmented(tab) {
      const cur = this.state.sub[tab];
      return html`<div class="seg" role="tablist" aria-label=${VIEW_INFO[tab][0]}>
        ${SUBS[tab].map(([id, label]) => html`<button key=${id} type="button" role="tab" aria-selected=${cur === id ? 'true' : 'false'} class="seg-btn" onClick=${() => this.setSub(tab, id)}>${label}</button>`)}
      </div>`;
    }
    viewMoney() {
      const sub = this.state.sub.money;
      return html`<div class="stack">${this.segmented('money')}<div key=${sub} class="m-view">${sub === 'budget' ? this.viewBudget() : this.viewSafe()}</div></div>`;
    }
    viewDecide() {
      const sub = this.state.sub.decide;
      const body = { afford: () => this.viewAfford(), loan: () => this.viewLoan(), ready: () => this.viewReady(), whatif: () => this.viewWhatIf() }[sub]();
      return html`<div class="stack">${this.segmented('decide')}<div key=${sub} class="m-view">${body}</div></div>`;
    }
    viewHelp() {
      const s = this.state, m = this.brain.memory(), sum = this.brain.summary();
      return html`<div class="stack">
        <div class="box stack" style="gap:10px;padding:18px">
          <p style="margin:0;font-weight:700;font-size:16px">Talk to a person</p>
          <p class="muted" style="margin:0;font-size:13.5px">A specialist sees what you've already told ${'Mercer'}, so you never start over.</p>
          ${!s.handoff
            ? html`<button type="button" class="btn" onClick=${() => this.setState({ handoff: true })}>Connect me with a specialist</button>`
            : html`<div class="note ok rise" style="display:flex;flex-direction:column;gap:6px">
                <p style="font-weight:700">Request sent. Here's what the specialist will see:</p>
                <p>• Customer: ${m.name || window.MERCER_DATA.person.name.split(' ')[0]}</p>
                <p>• Last topic: ${sum.topic}</p>
                ${sum.goals.length > 0 && html`<p>• Saving for: ${sum.goals.join(', ')}</p>`}
                ${sum.recent.length > 0 && html`<p>• Recent questions: ${sum.recent.map((q) => '"' + q + '"').join(', ')}</p>`}
                <p style="font-size:12px;opacity:.8;margin-top:4px">Demo: this concept doesn't contact a real agent. Call the number below to reach FNB.</p>
              </div>`}
        </div>
        <div class="box" style="padding:4px 16px">
          <a class="care-row" href=${'tel:' + CARE.mainTel}><span><b>Call FNB Customer Contact Center</b><span class="muted">Accounts, cards, anything else</span></span><span class="mono">${CARE.main}</span></a>
          <a class="care-row" href=${'tel:' + CARE.vanityTel}><span><b>Call ${CARE.vanity}</b><span class="muted">Same team, easy to remember</span></span><span class="mono">1-833-226-5362</span></a>
          <a class="care-row" href=${CARE.branches} target="_blank" rel="noopener"><span><b>Find a branch or ATM</b><span class="muted">Opens FNB's locations page</span></span><span aria-hidden="true">↗</span></a>
        </div>
        <div class="note warn" style="font-size:13.5px"><strong>Lost card or a charge you didn't make?</strong> Call ${CARE.main} now. ${'Mercer'} can't lock cards or file disputes, and won't pretend to.</div>
        <p class="muted" style="margin:0;font-size:11.5px;text-align:center">Numbers from FNB's website (fnb-online.com). Check the back of your card too.</p>
        <div class="box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px">
          <span style="font-size:13px"><b style="display:block">Reset the demo</b><span class="muted" style="font-size:12px">Clears chat, memory and any numbers you changed</span></span>
          <button type="button" class="btn ghost" style="min-height:40px" onClick=${() => { this.brain.forget(); this.setState({ msgs: [], greeting: this.brain.greeting(), suggestions: this.brain.suggestions(), handoff: false, view: 'home', loan: { price: 25000, down: 3000, apr: 6.5, term: 60, fees: 800, financed: true }, wi: { extra: 0, oneTime: 0 }, picked: { excited: true, pressured: true }, credit: {}, done: { 1: true } }); fillBank(document, Object.assign({ name: this.brain.memory().name }, this.brain.sts())); this.toast('Demo reset.'); }}>Reset</button>
        </div>
      </div>`;
    }

    // ---------- views ----------
    viewHome(botName) {
      const s = this.state;
      const msgs = [{ from: 'bot', text: s.greeting }].concat(s.msgs);
      const remembers = s.msgs.length > 0;
      return html`<div class="stack">
        ${msgs.map((m, i) => html`<div key=${i} class=${'msg ' + m.from} style="flex-direction:column;align-items:${m.from === 'me' ? 'flex-end' : 'flex-start'}">
          <div class="bubble">${m.text}</div>
          ${m.actions && m.actions.length > 0 && html`<div class="m-acts">${m.actions.map((a) => html`<button type="button" class="pill" onClick=${() => this.act(a)}>${a.label} →</button>`)}</div>`}
        </div>`)}
        ${s.typing && html`<div class="msg bot" aria-label=${botName + ' is typing'}><div class="bubble muted"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>`}
        ${!remembers && !s.typing && html`
          <p class="kicker">Tools</p>
          <div class="grid2">
            ${HOME_TILES.map(([id, label, desc]) => html`<button key=${id} type="button" class="tile" onClick=${() => this.go(id)}><b>${label}</b><span>${desc}</span></button>`)}
          </div>`}
        <p class="m-memory muted">
          ${remembers ? 'Remembers your chats on this device' : 'Answers from your account data · remembers what you tell it'}${s.aiMode ? ' · AI on' : ''}
          ${remembers && html` · <button type="button" class="linkbtn" onClick=${() => this.ask('forget everything')}>Forget</button>`}
        </p>
      </div>`;
    }

    viewSafe() {
      const st = this.brain.sts(), up = window.MERCER_DATA.safeToSpend.upcoming;
      const money$ = (v) => num(v);
      return html`<div class="stack">
        <div class="box" style="padding:20px;border-radius:20px">
          <p class="muted" style="margin:0;font-size:13px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>You can spend, next 30 days</span><span class="src">As of Sep 30 · demo data</span></p>
          <p key=${st.amount} class="mono rise" style="margin:4px 0 0;font-size:42px;letter-spacing:-.03em;line-height:1.1">${fmt(st.amount)}</p>
          <p class="muted" style="margin:6px 0 0;font-size:13px">No paychecks assumed. Tap any ✎ number to change it.</p>
        </div>
        <div class="box" style="padding:4px 16px">
          <div class="row" style="border-top:0;align-items:center"><span>Checking</span><${EditNum} cls="sm" prefix="$" value=${st.checking} format=${money$} min=${0} aria="Checking balance" onCommit=${(v) => this.updateSetting('checking', v)} /></div>
          <div class="row"><span>Bills, next 30 days <span class="src">from history</span></span><span class="mono">−${fmt(st.bills)}</span></div>
          <div class="row"><span>Everyday spending <span class="src">6-mo avg</span></span><span class="mono">−${fmt(st.variable)}</span></div>
          <div class="row" style="align-items:center"><span>Savings this month</span><${EditNum} cls="sm" prefix="−$" value=${st.savings} format=${money$} min=${0} aria="Monthly savings" onCommit=${(v) => this.updateSetting('monthlySavings', v)} /></div>
          <div class="row" style="align-items:center"><span>Cushion to keep</span><${EditNum} cls="sm" prefix="−$" value=${st.buffer} format=${money$} min=${0} aria="Cushion to keep in checking" onCommit=${(v) => this.updateSetting('buffer', v)} /></div>
          ${st.edited && html`<p style="margin:0 0 12px"><button type="button" class="linkbtn" onClick=${() => { ['checking', 'monthlySavings', 'buffer'].forEach((k) => this.brain.setSetting(k, null)); this.refresh(); }}>Reset to account data</button></p>`}
        </div>
        <div class="box" style="padding:4px 16px">
          <p style="margin:12px 0 2px;font-weight:600">Next bills</p>
          ${up.slice(0, 6).map((b) => html`<div key=${b.name} class="row" style="font-size:14px"><span>${b.date.slice(5).replace('-', '/')} · ${b.name}</span><span class="mono">${fmt(b.amount)}</span></div>`)}
        </div>
      </div>`;
    }

    viewBudget() {
      const b = this.brain.budgetStatus();
      const over = b.over;
      const overCats = b.cats.filter((c) => c.over).map((c) => c.name);
      const pct = Math.min(100, (b.spent / b.limit) * 100);
      const setLimit = (v) => { this.brain.setMonthlyLimit(Math.max(100, Math.round(v))); this.refresh(); };
      return html`<div class="stack">
        <div class=${'note ' + (over ? 'bad' : 'good')} style="display:flex;align-items:center;gap:16px;border-radius:20px;padding:16px 18px">
          ${over ? html`<${PixelFace} key="sad" happy=${false} />` : html`<${PixelFace} key="happy" happy=${true} />`}
          <div style="min-width:0">
            <p style="font-weight:700;font-size:17px;line-height:1.3">You're ${fmt(Math.abs(b.left))} ${over ? 'over' : 'under'} budget</p>
            <p style="margin-top:2px;font-size:13px;opacity:.85">${b.monthLabel} · ${over
              ? `Time to slow down. Biggest jump: ${overCats[0] || 'spending'}.`
              : overCats.length ? `Nice. Just keep an eye on ${overCats.slice(0, 2).join(' and ')}.` : 'Nice. Every category is on track.'}</p>
          </div>
        </div>
        <div class="box stack" style="gap:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <${EditNum} cls="lg" label="Monthly limit" prefix="$" value=${b.limit} format=${(v) => num(v)} min=${100} onCommit=${(v) => setLimit(v)} />
            <div style="display:flex;gap:6px">
              <button type="button" class="m-icon" style="width:44px;height:44px;font-size:22px" aria-label="Lower monthly limit by $100" onClick=${() => setLimit(b.limit - 100)}>−</button>
              <button type="button" class="m-icon" style="width:44px;height:44px;font-size:22px" aria-label="Raise monthly limit by $100" onClick=${() => setLimit(b.limit + 100)}>+</button>
            </div>
          </div>
          <div class="track" style="height:10px" role="img" aria-label=${`Spent ${Math.round((b.spent / b.limit) * 100)} percent of the monthly limit`}>
            <div class="bar" style=${{ width: pct.toFixed(1) + '%', background: over ? 'var(--badBar)' : 'var(--goodBar)' }}></div>
          </div>
          <p class="muted" style="margin:0;font-size:13px">Spent in ${b.monthLabel}: <strong style="color:var(--ink)">${fmt(b.spent)}</strong> · includes rent and bills</p>
        </div>
        <div class="box" style="padding:4px 16px">
          <p style="margin:12px 0 0;font-weight:600">Everyday categories</p>
          ${b.cats.map((c, i) => {
            const d = c.limit - c.spent;
            return html`<div key=${c.name} style=${'padding:12px 0;display:flex;flex-direction:column;gap:6px;' + (i ? 'border-top:1px solid var(--line)' : '')}>
              <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px">
                <span style="font-weight:500">${c.name}</span>
                <span class=${'tag ' + (c.over ? 'bad' : 'good')}>${c.over ? 'Over ' + fmt(-d) : fmt(d) + ' left'}</span>
              </div>
              <div class="track" style="height:6px"><div class="bar" style=${{ width: Math.min(100, (c.spent / c.limit) * 100).toFixed(1) + '%', background: c.over ? 'var(--badBar)' : 'var(--goodBar)' }}></div></div>
              <span class="muted" style="font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${fmt(c.spent)} of <${EditNum} cls="xs" prefix="$" value=${c.limit} format=${(v) => num(v, 0)} min=${0} aria=${c.name + ' limit'} onCommit=${(v) => { this.brain.setBudget(c.name, v); this.refresh(); }} /> ${c.custom ? 'your limit' : '6-month average'}</span>
            </div>`;
          })}
          <p class="muted" style="margin:0 0 12px;font-size:12px">Tap any ✎ limit to change it, or tell ${'Mercer'} "set my groceries budget to $450".</p>
        </div>
      </div>`;
    }

    viewCredit() {
      const cm = this.state.credit;
      const delta = CREDIT_MOVES.reduce((a, m) => a + (cm[m[0]] ? m[2] : 0), 0);
      const base = this.brain.setting('creditScore', CREDIT_BASE), mine = this.brain.setting('creditScore', null) != null;
      const projected = Math.max(300, Math.min(850, base + delta));
      const shown = delta ? projected : base;
      const [band, color, tone] = bandOf(shown);
      const pct = ((shown - 300) / 550) * 100;
      const whatIf = delta === 0 ? 'Tap a habit to see how it could move your score.'
        : delta > 0 ? `Could reach about ${projected} (${bandOf(projected)[0]}), up ${delta} points.`
          : `Could drop to about ${projected} (${bandOf(projected)[0]}), down ${-delta} points. One missed payment hurts the most.`;
      return html`<div class="stack">
        <div class="box" style="border-radius:20px;padding:18px 18px 16px;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="position:relative;width:220px;height:128px">
            <svg width="220" height="128" viewBox="0 0 200 116" role="img" aria-label=${`Credit score ${shown} out of 850, ${band}`}>
              <path d="M 18 100 A 82 82 0 0 1 182 100" pathLength="100" fill="none" stroke="var(--chip)" stroke-width="14" stroke-linecap="round" />
              <path class="arc" d="M 18 100 A 82 82 0 0 1 182 100" pathLength="100" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="100"
                style=${{ stroke: color, strokeDashoffset: (100 - pct).toFixed(1) }} />
              <text x="18" y="114" text-anchor="middle" font-size="9" fill="var(--muted)">300</text>
              <text x="182" y="114" text-anchor="middle" font-size="9" fill="var(--muted)">850</text>
            </svg>
            <p class="mono pop" style="position:absolute;left:0;right:0;top:50px;margin:0;text-align:center;font-size:40px;letter-spacing:-.03em;line-height:1">${shown}</p>
          </div>
          <span class=${'tag ' + tone} style="font-size:13px;padding:3px 12px">${band}${delta ? ' · estimate' : ''}</span>
          <p class="muted" style="margin:6px 0 0;font-size:12px;text-align:center">${delta ? `Showing an estimate with the changes below. Today: ${base}.` : mine ? 'Your score · checking it never hurts your score' : 'Demo score. Enter yours below; checking it never hurts your score.'}</p>
          <${EditNum} cls="sm" label=${mine ? 'Your score' : 'Enter your score'} value=${base} format=${(v) => String(Math.round(v))} min=${300} max=${850} onCommit=${(v) => this.updateSetting('creditScore', Math.round(v))} />
        </div>
        <div class="box" style="padding:4px 16px">
          <p style="margin:12px 0 2px;font-weight:600">What's shaping your score</p>
          ${CREDIT_FACTORS.map(([name, detail, tag, t]) => html`<div key=${name} style="border-top:1px solid var(--line);padding:11px 0;display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div style="min-width:0"><p style="margin:0;font-size:14px;font-weight:500">${name}</p><p class="muted" style="margin:0;font-size:12px">${detail}</p></div>
            <span class=${'tag ' + t}>${tag}</span>
          </div>`)}
        </div>
        <div class="box stack" style="gap:10px">
          <p style="margin:0;font-weight:600">What if you…</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${CREDIT_MOVES.map(([id, label]) => html`<button key=${id} type="button" class="pill" aria-pressed=${cm[id] ? 'true' : 'false'}
              onClick=${() => this.setState({ credit: Object.assign({}, cm, { [id]: !cm[id] }) })}>${label}</button>`)}
          </div>
          <p style="margin:0;font-size:14px">${whatIf}</p>
          <p class="muted" style="margin:0;font-size:11.5px">Rough estimates. Real score changes vary by credit bureau and history.</p>
        </div>
        <div class="note ok"><strong>Heads up:</strong> applying for the SUV loan adds a hard inquiry, which can dip your score a few points for a while. Rate-shopping several auto lenders within about two weeks usually counts as one.</div>
      </div>`;
    }

    viewLoan() {
      const L = this.state.loan, r = this.brain.loanSummary(L);
      const f = (k, label, extra) => html`<${EditNum} label=${label} value=${L[k]} format=${(v) => num(v, k === 'apr' ? 2 : 0)} min=${0} onCommit=${(v) => this.setLoan({ [k]: v })} ...${extra || {}} />`;
      return html`<div class="stack">
        <div class="grid2" style="gap:10px">
          ${f('price', 'Price', { prefix: '$' })}
          ${f('down', 'Down payment', { prefix: '$' })}
          ${f('apr', 'APR', { suffix: '%', max: 100 })}
          <label class="editnum"><span class="editnum-l">Term</span><span class="editnum-box"><select aria-label="Term in months" value=${L.term} onChange=${(e) => this.setLoan({ term: +e.target.value })}>
            ${[24, 36, 48, 60, 72, 84].map((m) => html`<option value=${m} selected=${+L.term === m}>${m} months</option>`)}</select></span></label>
          ${f('fees', 'Fees', { prefix: '$' })}
          <label class="check"><input type="checkbox" checked=${!!L.financed} onChange=${(e) => this.setLoan({ financed: e.target.checked })} /> Fees rolled into the loan</label>
        </div>
        ${r.error ? html`<p class="note bad">${r.error}</p>` : html`
          <div class="box rise" key=${Math.round(r.payment)} style="padding:18px;border-radius:20px">
            <p class="muted" style="margin:0;font-size:13px">Monthly payment</p>
            <p class="mono" style="margin:2px 0 0;font-size:38px;letter-spacing:-.02em">${fmt(r.payment)}</p>
          </div>
          <div class="grid2" style="gap:8px">
            <div class="stat"><p class="l">Total interest</p><p class="v mono">${fmt(r.interest)}</p></div>
            <div class="stat"><p class="l">True APR</p><p class="v mono" style=${r.trueApr - L.apr >= 0.5 ? 'color:var(--warnInk)' : ''}>${r.trueApr.toFixed(2)}%</p></div>
            <div class="stat"><p class="l">Cash at signing</p><p class="v mono">${fmt(r.cash)}</p></div>
            <div class="stat"><p class="l">Total cost</p><p class="v mono">${fmt(r.totalCost)}</p></div>
          </div>
          ${r.warnings.map((w) => html`<p class="note warn" style="margin:0">${w}</p>`)}
          <details class="box"><summary>How this is calculated</summary>
            <p class="muted" style="font-size:12.5px;margin:8px 0 0">Fixed-rate loan, equal monthly payments: M = P·r / (1 − (1+r)^−n), r = APR/12. True APR counts fees. Taxes and insurance not included. Same formulas as the team's Calculators.py.</p></details>
          <button type="button" class="btn" onClick=${() => this.setSub('decide', 'ready')}>Am I ready to sign? →</button>`}
      </div>`;
    }

    viewReady() {
      const d = this.brain.decision(this.state.loan);
      const p = this.state.picked;
      const rushed = !!(p.pressured || p.fomo || (p.excited && p.anxious));
      const steady = !rushed && !!(p.calm || p.confident);
      if (d.error) return html`<div class="stack"><p class="note bad">${d.error}</p><button type="button" class="btn ghost" onClick=${() => this.setSub('decide', 'loan')}>Edit the loan</button></div>`;
      const tone = { go: 'good', wait: 'mid', rethink: 'bad' }[d.verdict];
      const L = this.state.loan;
      return html`<div class="stack">
        <div key=${d.verdict} class=${'verdict rise ' + tone}>
          <span class="light" aria-hidden="true"></span>
          <div style="min-width:0"><p style="margin:0;font-weight:700;font-size:16px;line-height:1.3">${d.head}</p>
          <p style="margin:2px 0 0;font-size:13px;opacity:.85">${fmt(L.price).replace('.00', '')}${L.down ? ` with ${fmt(L.down).replace('.00', '')} down` : ''} · ${L.apr}% · ${L.term} mo · ${fmt(d.loan.payment)}/mo · <button type="button" class="linkbtn" style="color:inherit" onClick=${() => this.setSub('decide', 'loan')}>Edit</button></p></div>
        </div>
        <div class="box" style="padding:4px 16px">
          ${d.reasons.map((r, i) => html`<div key=${i} class="reason" style=${i ? '' : 'border-top:0'}>
            <span class=${'ri ' + (r.warn ? 'bad' : r.ok ? 'good' : 'mid')} aria-hidden="true">${r.warn ? '!' : r.ok ? '✓' : '–'}</span>
            <span style="min-width:0"><span style="display:block;font-size:13.5px">${r.text}</span><span class="src">${r.tag}</span></span></div>`)}
        </div>
        ${d.fixes.length > 0 && html`<div class="box stack" style="gap:8px"><p style="margin:0;font-weight:600">Changes that would help</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${d.fixes.map((x) => html`<button type="button" class="pill" onClick=${() => { this.setLoan(x.patch); this.toast('Updated the loan. Here is the new check.'); }}><span class=${'dot-v ' + ({ go: 'good', wait: 'mid', rethink: 'bad' })[x.verdict]} aria-hidden="true"></span>${x.label}</button>`)}</div></div>`}
        <div class="box stack" style="gap:10px">
          <p style="margin:0;font-weight:600">How do you feel about it?</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${FEELINGS.map(([id, label]) => html`<button key=${id} type="button" class="pill" aria-pressed=${p[id] ? 'true' : 'false'}
              onClick=${() => this.setState({ picked: Object.assign({}, p, { [id]: !p[id] }) })}>${label}</button>`)}
          </div>
          ${rushed && html`<p class="note warn rise" style="padding:10px 12px;border-radius:12px;margin:0">Sounds rushed. Good deals come back. Sleep on it?</p>`}
          ${steady && html`<p class="note ok rise" style="padding:10px 12px;border-radius:12px;margin:0">Sounds like a considered decision.</p>`}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" style="flex:1 1 140px" onClick=${() => this.toast('Reminder set for tomorrow at 9 AM (demo).')}>Sleep on it: remind me tomorrow</button>
          <button type="button" class="btn ghost" style="flex:1 1 140px" onClick=${() => this.go('help')}>Ask a specialist</button>
        </div>
        <p class="muted" style="margin:0;font-size:11.5px;text-align:center">Uses your 6-month averages: take-home ${fmt(this.brain.facts().avgIncome)}/mo, spending ${fmt(this.brain.facts().avgSpend)}/mo, loan payments ${fmt(this.brain.facts().debtMonthly)}/mo. Educational, not financial advice.</p>
      </div>`;
    }

    viewAfford() {
      const D = window.MERCER_DATA, safe = D.safeToSpend.amount;
      const item = this.state.affordItem != null ? this.state.affordItem : 'Headphones';
      const raw = this.state.affordPrice != null ? this.state.affordPrice : '249';
      const price = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
      const ok = isFinite(price) && price > 0;
      const thing = (item.trim() || 'it').toLowerCase();
      const after = safe - (ok ? price : 0);
      const goal = (this.brain.memory().goals || []).slice(-1)[0];
      let tone = 'good', head = '', body = '';
      if (ok && price <= safe * 0.5) { head = `Yes, you can afford the ${thing}.`; body = `You'd still have ${fmt(after)} safe to spend in the next 30 days.${goal ? ` It won't slow down your ${goal} fund.` : ''}`; }
      else if (ok && price <= safe) { tone = 'mid'; head = 'You can, but it\'s a big chunk.'; body = `It uses ${Math.round(price / safe * 100)}% of your ${fmt(safe)} safe-to-spend, leaving ${fmt(after)}. Waiting until your Oct 15 paycheck is safer.`; }
      else if (ok) { tone = 'bad'; head = 'Not comfortably.'; body = `That's ${fmt(price - safe)} more than you can safely spend right now (${fmt(safe)}). You'd have to dip into savings or wait a paycheck or two.`; }
      return html`<div class="stack">
        <label class="field">What are you buying?<input type="text" value=${item} onInput=${(e) => this.setState({ affordItem: e.target.value })} /></label>
        <label class="field">Price<input type="text" inputmode="decimal" value=${raw} onInput=${(e) => this.setState({ affordPrice: e.target.value })} /></label>
        ${ok ? html`<div key=${tone} class=${'note rise ' + tone} style="border-radius:18px;padding:16px">
            <p style="font-weight:700">${head}</p>
            <p style="margin-top:4px;font-size:13.5px">${body}</p>
          </div>` : html`<p class="muted" style="margin:0;font-size:13.5px">Enter a price to check it.</p>`}
        <p class="muted" style="margin:0;font-size:12px">Checked against your safe-to-spend of ${fmt(safe)}: checking minus bills, everyday spending, savings and a cushion.</p>
      </div>`;
    }

    viewWhatIf() {
      const w = this.state.wi, r = this.brain.whatIf(w);
      const asOf = window.MERCER_DATA.asOf;
      const when = (m) => { if (!isFinite(m)) return 'never at this rate'; const d = new Date(asOf + 'T00:00:00'); d.setMonth(d.getMonth() + m); return d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); };
      const diff = r.scen[60] - r.base[60];
      const slider = (k, label, min, max, step, show) => html`<label class="slider"><span class="editnum-l" style="display:flex;justify-content:space-between"><span>${label}</span><b class="mono" style="color:var(--ink)">${show(w[k])}</b></span>
        <input type="range" min=${min} max=${max} step=${step} value=${w[k]} onInput=${(e) => this.setState({ wi: Object.assign({}, w, { [k]: +e.target.value }) })} /></label>`;
      return html`<div class="stack">
        ${slider('extra', 'Change monthly savings', -300, 600, 25, (v) => (v >= 0 ? '+' : '−') + fmt(v).replace('.00', '') + '/mo')}
        ${slider('oneTime', 'One-time purchase from savings', 0, 15000, 250, (v) => fmt(v).replace('.00', ''))}
        <div class="box" style="padding:14px 16px">
          <${SparkChart} base=${r.base} scen=${r.scen} />
          <p class="muted" style="margin:6px 0 0;font-size:11.5px;display:flex;gap:14px"><span>━ this plan</span><span>┅ current plan</span><span style="margin-left:auto">5 years →</span></p>
        </div>
        <div class="grid2" style="gap:8px">
          <div class="stat"><p class="l">Savings in 5 years</p><p class="v mono">${fmt(r.scen[60]).replace('.00', '')}</p><p class="l" style=${diff < 0 ? 'color:var(--badInk)' : 'color:var(--goodInk)'}>${diff === 0 ? 'same as now' : (diff > 0 ? '+' : '−') + fmt(diff).replace('.00', '') + ' vs now'}</p></div>
          <div class="stat"><p class="l">${r.efName} full</p><p class="v" style="font-size:16px">${when(r.efScen)}</p><p class="l">now: ${when(r.efBase)}</p></div>
        </div>
        <p class="muted" style="margin:0;font-size:11.5px">Simple projection from your ${fmt(window.MERCER_DATA.accounts.savings)} savings: no interest, raises or market changes.</p>
      </div>`;
    }

    viewTranslate() {
      const res = this.brain.translate(this.state.transText);
      return html`<div class="stack">
        <label class="field">Paste the confusing part<textarea rows="3" value=${this.state.transText} onInput=${(e) => this.setState({ transText: e.target.value })}></textarea></label>
        ${res.length ? html`<div class="box" style="padding:4px 16px">${res.map((x, i) => html`<div key=${x.term} class="reason" style=${i ? '' : 'border-top:0'}><span style="min-width:0"><b style="display:block;font-size:14px">${x.term}</b><span style="font-size:13.5px">${x.plain}</span></span></div>`)}</div>`
          : html`<p class="muted" style="margin:0;font-size:13.5px">No banking jargon found yet. Try pasting a line from a loan or card agreement.</p>`}
        <p class="muted" style="margin:0;font-size:11.5px">Built-in glossary of ${'30+'} common terms. Works offline.</p>
      </div>`;
    }

    viewLegit() {
      const r = this.brain.trust(this.state.legitText), tone = r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad';
      return html`<div class="stack">
        <label class="field">Paste a post, video script or tip<textarea rows="3" value=${this.state.legitText} onInput=${(e) => this.setState({ legitText: e.target.value })}></textarea></label>
        <div class=${'note ' + tone} style="border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><p style="font-weight:700">${r.level}</p><p class="mono" style="font-size:22px">${r.score}<span style="font-size:13px">/100</span></p></div>
          <div class="track" style="height:8px;background:rgba(0,0,0,.08)"><div class="bar" style=${{ width: r.score + '%', background: `var(--${tone === 'good' ? 'goodBar' : tone === 'mid' ? 'midInk' : 'badBar'})` }}></div></div>
          <p style="font-size:13.5px">${r.advice}</p>
          ${(r.sponsors.length + r.hype.length) > 0 && html`<div style="display:flex;flex-wrap:wrap;gap:6px">${r.sponsors.map((k) => html`<span class="tag mid">Paid: "${k}"</span>`)}${r.hype.map((k) => html`<span class="tag bad">Hype: "${k}"</span>`)}</div>`}
        </div>
        <p class="muted" style="margin:0;font-size:11.5px">Same rules as the team's trust engine: −30 for sponsor language, −20 per hype phrase.</p>
      </div>`;
    }

    viewNext() {
      const done = this.state.done;
      return html`<div class="stack" style="gap:10px">
        <p class="muted" style="margin:0;font-size:13.5px">Goal: build an emergency fund · 10 minutes total</p>
        ${STEPS.map(([n, task, time]) => {
          const d = !!done[n];
          return html`<button key=${n} type="button" class="tile" aria-pressed=${d ? 'true' : 'false'}
            style="flex-direction:row;align-items:center;gap:12px;min-height:60px;padding:12px 14px"
            onClick=${() => this.setState({ done: Object.assign({}, done, { [n]: !d }) })}>
            <span style=${{ flex: '0 0 auto', width: '26px', height: '26px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700, background: d ? 'var(--primary)' : 'var(--chip)', color: d ? 'var(--onPrimary)' : 'var(--ink)' }}>${d ? '✓' : n}</span>
            <span style="flex:1;min-width:0"><b style="display:block;font-weight:500">${task}</b><span style="display:block;font-size:12px">${time}</span></span>
          </button>`;
        })}
      </div>`;
    }

    // ---------- shell ----------
    render(props, s) {
      const botName = props.botName || 'Mercer';
      const phone = props.mode === 'phone';
      const current = [null].concat(VIEW_INFO[s.view] || VIEW_INFO.home);
      const inMore = MORE_TABS.some((t) => t[0] === s.view);
      const atHome = s.view === 'home';
      const views = {
        home: () => this.viewHome(botName), money: () => this.viewMoney(), decide: () => this.viewDecide(),
        credit: () => this.viewCredit(), next: () => this.viewNext(), translate: () => this.viewTranslate(),
        legit: () => this.viewLegit(), help: () => this.viewHelp()
      };
      const close = () => this.setState({ open: false });
      const open = () => this.setState({ open: true });

      // Website: pill launcher that hides while open. Phone: round button that toggles and turns into an X.
      const launcher = phone
        ? html`<button type="button" class="m-launch" onClick=${() => this.setState({ open: !s.open })}
            aria-expanded=${s.open ? 'true' : 'false'} aria-controls="mercer-panel"
            aria-label=${s.open ? 'Close ' + botName : 'Open ' + botName + ', your money assistant'}>
            ${s.open ? html`<span key="x" class="swap" style="color:#fff;display:grid">${Icon.close(22, 2.4)}</span>` : html`<span key="logo" class="swap"><${Logo} size="md" /></span>`}
          </button>`
        : !s.open && html`<button type="button" class="m-launch" onClick=${open} aria-label=${'Open ' + botName + ', your money assistant'}>
            <${Logo} size="lg" /> Ask ${botName}
          </button>`;

      return html`<div class=${phone ? 'm-phone' : 'm-web'}>
        ${s.open && html`<div class="m-scrim" onClick=${close} aria-hidden="true"></div>`}
        ${s.open && html`<section class="m-panel t" id="mercer-panel" role="dialog" aria-label=${botName + ', your money assistant'}>
          <div class="m-head">
            ${atHome ? html`<${Logo} size="hd" />` : html`<button type="button" class="m-icon" aria-label="Back" onClick=${() => this.go('home')}>${Icon.back}</button>`}
            <div class="m-title">
              <p style="font-weight:600;font-size:16px;line-height:1.2">${atHome ? botName : current[1]}</p>
              <p class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${atHome ? 'Your FNB money guide · since 1864' : current[2]}</p>
            </div>
            <button type="button" class="m-switch" aria-pressed=${s.dark ? 'true' : 'false'} aria-label=${s.dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick=${() => this.setState({ dark: !s.dark })}>
              <span class="m-knob">${s.dark ? Icon.moon : Icon.sun}</span>
            </button>
            <button type="button" class="m-icon" aria-label=${'Close ' + botName} onClick=${close}>${Icon.close()}</button>
          </div>
          <div class="m-rail" ref=${(el) => { this.rail = el; }}>
            ${MAIN_TABS.map(([id, label]) => html`<button key=${id} type="button" class="pill" aria-pressed=${s.view === id ? 'true' : 'false'} onClick=${() => this.go(id)}>${label}</button>`)}
            <div class="m-more">
              <button type="button" class="pill" aria-haspopup="menu" aria-expanded=${s.menu ? 'true' : 'false'} aria-pressed=${inMore ? 'true' : 'false'}
                onClick=${() => this.setState({ menu: !s.menu })}>${inMore ? VIEW_INFO[s.view][0] : 'More'} <span class="chev" aria-hidden="true">▾</span></button>
              ${s.menu && html`<div class="m-menu" role="menu">
                ${MORE_TABS.map(([id, label]) => html`<button key=${id} type="button" role="menuitem" class=${'m-menu-item' + (s.view === id ? ' on' : '')} onClick=${() => this.go(id)}>
                  <b>${label}</b><span class="muted">${VIEW_INFO[id][1]}</span></button>`)}
              </div>`}
            </div>
            <button type="button" class="pill help-pill" aria-pressed=${s.view === 'help' ? 'true' : 'false'} onClick=${() => this.go('help')}>Help</button>
          </div>
          <div class="m-divider"></div>
          <div class="m-body" ref=${(el) => { this.body = el; }}><div key=${s.view} class="m-view">${views[s.view]()}</div></div>
          ${s.toast && html`<div class="m-toast" role="status">${s.toast}</div>`}
          <div class="m-compose">
            ${atHome && html`<div class="m-chips">
              ${s.suggestions.map((c) => html`<button key=${c} type="button" class="pill" onClick=${() => this.ask(c)}>${c}</button>`)}
            </div>`}
            <div class="m-input">
              <label for="mercer-ask" class="sr-only">Message ${botName}</label>
              <input id="mercer-ask" type="text" value=${s.draft} placeholder=${'Ask ' + botName + ' anything'}
                onInput=${(e) => this.setState({ draft: e.target.value })}
                onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this.ask(this.state.draft); } }} />
              <button type="button" class="m-send" aria-label="Send" onClick=${() => this.ask(this.state.draft)}>${Icon.send}</button>
            </div>
            <p class="muted" style="margin:8px 0 0;text-align:center;font-size:11px">Educational help, not financial advice.</p>
          </div>
        </section>`}
        ${launcher}
      </div>`;
    }
  }

  // Fills any element with data-m="..." on the bank page from the same data Mercer uses.
  function fillBank(rootEl, o) {
    const D = window.MERCER_DATA; if (!D) return;
    o = o || {};
    const r = rootEl || document;
    const set = (k, v) => r.querySelectorAll('[data-m="' + k + '"]').forEach((el) => { el.textContent = v; });
    set('name', o.name || D.person.name.split(' ')[0]);
    const checking = o.checking != null ? o.checking : D.accounts.checking;
    set('checking', fmt(checking)); set('savings', fmt(D.accounts.savings));
    set('total', fmt(checking + D.accounts.savings));
    set('checkingMask', '••' + D.accounts.checkingMask.slice(-4)); set('savingsMask', '••' + D.accounts.savingsMask.slice(-4));
    set('safe', fmt(o.amount != null ? o.amount : D.safeToSpend.amount));
    const box = r.querySelector('[data-m="activity"]');
    if (box) {
      const rows = D.transactions.slice(-4).reverse();
      box.innerHTML = '';
      rows.forEach((t) => {
        const row = document.createElement('div'); row.className = 'row';
        const a = document.createElement('span'); a.textContent = t.merchant.replace('Internal savings transfer', 'Transfer to savings');
        const b = document.createElement('span'); b.className = 'mono'; b.textContent = (t.amount > 0 ? '+' : '−') + fmt(t.amount);
        row.append(a, b); box.append(row);
      });
    }
  }

  window.Mercer = {
    mount(el, props) { fillBank(document); render(html`<${Mercer} ...${props || {}} />`, el); },
    fillBank
  };
})();
