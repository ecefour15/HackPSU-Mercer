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
  const TOOLS = [
    ['home', 'Chat', ''],
    ['safe', 'Safe to spend', 'What you can spend this month'],
    ['budget', 'Budget', 'Monthly limits: green or red'],
    ['credit', 'Credit score', 'Your score and how to raise it'],
    ['loan', 'Loan check', 'Fees, penalties, real cost'],
    ['ready', 'Ready to sign?', 'Second opinion + gut check'],
    ['afford', 'Can I afford it?', 'Check a purchase first'],
    ['whatif', 'What if…', 'See 5 years ahead'],
    ['translate', 'Translate', 'Bank-speak to plain English'],
    ['legit', 'Legit check', 'Spot hype and paid promos'],
    ['next', 'Next step', 'One small task at a time']
  ];
  const BUDGET_CATS = [
    ['Rent', 1475.00, 1475], ['Groceries', 412.30, 450], ['Dining out', 238.75, 200],
    ['Getting around', 164.20, 180], ['Electric', 105.41, 120], ['Fun', 96.00, 150]
  ];
  const BUDGET_SPENT = BUDGET_CATS.reduce((a, c) => a + c[1], 0);
  const FEELINGS = [['excited', 'Excited'], ['calm', 'Calm'], ['pressured', 'Pressured'], ['anxious', 'Anxious'], ['confident', 'Confident'], ['fomo', 'Afraid to miss out']];
  const SCENARIOS = {
    car: { label: 'Buy the SUV', value: '[AMOUNT]', note: 'Slower growth: $629 a month goes to the car instead.' },
    raise: { label: '10% raise', value: '[AMOUNT]', note: 'Save half the raise and your fund grows much faster.' },
    save: { label: 'Save $200 more', value: '[AMOUNT]', note: 'Small and steady. Automate it on payday.' }
  };
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

  // ---------- the assistant ----------
  class Mercer extends Component {
    constructor(props) {
      super(props);
      this.state = {
        open: props.startOpen !== false,
        dark: document.documentElement.dataset.theme === 'dark',
        view: 'home', draft: '', typing: false, msgs: [],
        picked: { excited: true, pressured: true }, scen: 'car', done: { 1: true },
        budget: 2600, credit: {}
      };
      this.timer = null;
    }
    componentDidMount() { this.applyTheme(); }
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
    componentWillUnmount() { clearTimeout(this.timer); }
    applyTheme() { document.documentElement.dataset.theme = this.state.dark ? 'dark' : 'light'; }

    // Scripted replies. Replace with a fetch() to your backend or an LLM.
    reply(text) {
      const t = text.toLowerCase();
      if (/budget|limit|over|under/.test(t)) return this.state.budget >= BUDGET_SPENT
        ? `You're under budget this month: ${fmt(BUDGET_SPENT)} spent of your ${fmt(this.state.budget)} limit.\nDining out is the one category over its limit.`
        : `Heads up: you're over your ${fmt(this.state.budget)} monthly limit. Open Budget to see where.`;
      if (/credit|score|fico/.test(t)) return 'Your score is 710, in the Good range (670 to 739).\nThe fastest boost: get card balances under 10% of your limits. Open Credit score to try it.';
      if (/spend|afford|left/.test(t)) return 'You can safely spend $681.77 over the next 30 days.\nThat already covers rent, your PECO bill, your $650 savings goal and a $500 cushion.';
      if (/loan|car|suv|contract|sign/.test(t)) return 'That SUV loan costs $629 a month and $9,320 in interest over 6 years.\nIt also has an early payoff fee. Want me to open the full check?';
      if (/bill|rent|due/.test(t)) return 'Next up: rent ($1,475.00) on Nov 1, then PECO ($105.41) around Nov 2.';
      if (/save|emergency|goal/.test(t)) return "You're 1 of 3 steps into your emergency fund. Next: open a high-yield savings account. It takes about 5 minutes.";
      return 'I can help with that. Try a tool below, or ask me about a bill, a loan, or something you want to buy.';
    }
    ask(text) {
      const q = (text || '').trim();
      if (!q) return;
      this.setState({ msgs: this.state.msgs.concat([{ from: 'me', text: q }]), draft: '', typing: true, view: 'home' });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.setState((s) => ({ typing: false, msgs: s.msgs.concat([{ from: 'bot', text: this.reply(q) }]) }));
      }, 900);
    }
    go(view) { this.setState({ view }); }

    // ---------- views ----------
    viewHome(botName) {
      const s = this.state;
      const msgs = [{ from: 'bot', text: `Hi, I'm ${botName}. I can check a loan, tell you what's safe to spend, or help you think through a big decision.` }].concat(s.msgs);
      return html`<div class="stack">
        ${msgs.map((m, i) => html`<div key=${i} class=${'msg ' + m.from}><div class="bubble">${m.text}</div></div>`)}
        ${s.typing && html`<div class="msg bot" aria-label=${botName + ' is typing'}><div class="bubble muted"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>`}
        ${s.msgs.length === 0 && !s.typing && html`
          <p class="kicker">Tools</p>
          <div class="grid2">
            ${TOOLS.slice(1).map(([id, label, desc]) => html`<button key=${id} type="button" class="tile" onClick=${() => this.go(id)}><b>${label}</b><span>${desc}</span></button>`)}
          </div>`}
      </div>`;
    }

    viewSafe() {
      const rows = [['Checking', '$3,412.18'], ['Bills due', '−$1,580.41'], ['Savings goal', '−$650.00'], ['Cushion', '−$500.00']];
      return html`<div class="stack">
        <div class="box" style="padding:20px;border-radius:20px">
          <p class="muted" style="margin:0;font-size:13px">You can spend, next 30 days</p>
          <p class="mono" style="margin:4px 0 0;font-size:42px;letter-spacing:-.03em;line-height:1.1">$681.77</p>
          <p class="muted" style="margin:6px 0 0;font-size:13px">No paychecks assumed. That's the safe way to count.</p>
        </div>
        <div class="box" style="padding:0 16px">
          ${rows.map(([k, v], i) => html`<div key=${k} class="row" style=${i ? '' : 'border-top:0'}><span>${k}</span><span class="mono">${v}</span></div>`)}
        </div>
      </div>`;
    }

    viewBudget() {
      const s = this.state;
      const left = s.budget - BUDGET_SPENT;
      const over = left < 0;
      const overCats = BUDGET_CATS.filter((c) => c[1] > c[2]).map((c) => c[0]);
      const pct = Math.min(100, (BUDGET_SPENT / s.budget) * 100);
      return html`<div class="stack">
        <div class=${'note ' + (over ? 'bad' : 'good')} style="display:flex;align-items:center;gap:16px;border-radius:20px;padding:16px 18px">
          ${over ? html`<${PixelFace} key="sad" happy=${false} />` : html`<${PixelFace} key="happy" happy=${true} />`}
          <div style="min-width:0">
            <p style="font-weight:700;font-size:17px;line-height:1.3">You're ${fmt(left)} ${over ? 'over' : 'under'} budget</p>
            <p style="margin-top:2px;font-size:13px;opacity:.85">${over
              ? `Time to slow down. Biggest jump: ${overCats[0] || 'spending'}.`
              : overCats.length ? `Nice. Just keep an eye on ${overCats.join(', ')}.` : 'Nice. Every category is on track.'}</p>
          </div>
        </div>
        <div class="box stack" style="gap:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div><p class="muted" style="margin:0;font-size:12px">This month's limit</p><p class="mono" style="margin:0;font-size:22px">${fmt(s.budget)}</p></div>
            <div style="display:flex;gap:6px">
              <button type="button" class="m-icon" style="width:44px;height:44px;font-size:22px" aria-label="Lower monthly limit by $100" onClick=${() => this.setState({ budget: Math.max(500, s.budget - 100) })}>−</button>
              <button type="button" class="m-icon" style="width:44px;height:44px;font-size:22px" aria-label="Raise monthly limit by $100" onClick=${() => this.setState({ budget: s.budget + 100 })}>+</button>
            </div>
          </div>
          <div class="track" style="height:10px" role="img" aria-label=${`Spent ${Math.round((BUDGET_SPENT / s.budget) * 100)} percent of the monthly limit`}>
            <div class="bar" style=${{ width: pct.toFixed(1) + '%', background: over ? 'var(--badBar)' : 'var(--goodBar)' }}></div>
          </div>
          <p class="muted" style="margin:0;font-size:13px">Spent so far: <strong style="color:var(--ink)">${fmt(BUDGET_SPENT)}</strong></p>
        </div>
        <div class="box" style="padding:4px 16px">
          ${BUDGET_CATS.map(([name, sp, lim], i) => {
            const o = sp > lim + 0.001, d = lim - sp;
            return html`<div key=${name} style=${'padding:12px 0;display:flex;flex-direction:column;gap:6px;' + (i ? 'border-top:1px solid var(--line)' : '')}>
              <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px">
                <span style="font-weight:500">${name}</span>
                <span class=${'tag ' + (o ? 'bad' : 'good')}>${o ? 'Over ' + fmt(d) : Math.abs(d) < 0.01 ? 'On budget' : fmt(d) + ' left'}</span>
              </div>
              <div class="track" style="height:6px"><div class="bar" style=${{ width: Math.min(100, (sp / lim) * 100).toFixed(1) + '%', background: o ? 'var(--badBar)' : 'var(--goodBar)' }}></div></div>
              <span class="muted" style="font-size:12px">${fmt(sp)} of ${fmt(lim)}</span>
            </div>`;
          })}
        </div>
      </div>`;
    }

    viewCredit() {
      const cm = this.state.credit;
      const delta = CREDIT_MOVES.reduce((a, m) => a + (cm[m[0]] ? m[2] : 0), 0);
      const projected = Math.max(300, Math.min(850, CREDIT_BASE + delta));
      const shown = delta ? projected : CREDIT_BASE;
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
          <p class="muted" style="margin:6px 0 0;font-size:12px;text-align:center">${delta ? `Showing your estimated score with the changes below. Today: ${CREDIT_BASE}.` : 'Demo score · updates monthly · checking it never hurts your score'}</p>
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
      const stats = [['Monthly', '$629'], ['Interest', '$9,320'], ['Length', '72 mo'], ['APR', '7.9%']];
      return html`<div class="stack">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="tag warn" style="font-size:13px;padding:5px 12px">Think twice</span>
          <span class="muted" style="font-size:13px">Auto loan · New SUV</span>
        </div>
        <p style="margin:0;font-weight:600;font-size:16px;line-height:1.4">You can make the payment, but you'd pay $9,320 in interest.</p>
        <div class="grid2" style="gap:8px">
          ${stats.map(([l, v]) => html`<div key=${l} class="stat"><p class="l">${l}</p><p class="v mono" style=${l === 'Interest' ? 'color:var(--warnInk)' : ''}>${v}</p></div>`)}
        </div>
        <div class="box stack" style="gap:4px">
          <p style="margin:0;font-weight:600">Early payoff fee</p>
          <p class="muted" style="margin:0 0 6px;font-size:13.5px">Pay it off in the first 2 years and you owe 2% of what's left.</p>
          <p style="margin:0;font-weight:600">Add-ons rolled into the loan</p>
          <p class="muted" style="margin:0;font-size:13.5px">GAP insurance and a service plan. You pay interest on them too.</p>
        </div>
        <button type="button" class="btn" onClick=${() => this.go('ready')}>Am I ready to sign?</button>
      </div>`;
    }

    viewReady() {
      const p = this.state.picked;
      const rushed = !!(p.pressured || p.fomo || (p.excited && p.anxious));
      const steady = !rushed && !!(p.calm || p.confident);
      return html`<div class="stack">
        <div class="box stack" style="gap:8px">
          <p style="margin:0;font-weight:600">What you might be missing</p>
          <p style="margin:0;font-size:13.5px">• Savings drop to <strong>2.2 months</strong>. Aim for 3.</p>
          <p style="margin:0;font-size:13.5px">• The car is <strong>63%</strong> of your yearly pay.</p>
          <p style="margin:0;font-size:13.5px">• Lose your job? Savings last about <strong>2 months</strong>.</p>
        </div>
        <div class="box stack" style="gap:10px">
          <p style="margin:0;font-weight:600">People like you</p>
          <div class="track" style="position:relative;height:10px;overflow:visible" role="img" aria-label="Higher than 88 percent of similar people">
            <span style="position:absolute;left:25%;width:50%;top:0;bottom:0;border-radius:5px;background:var(--band)"></span>
            <span style="position:absolute;left:88%;top:-5px;width:4px;height:20px;margin-left:-2px;border-radius:2px;background:var(--ink)"></span>
          </div>
          <p style="margin:0;font-size:13.5px">You'd spend more than <strong>88%</strong> of them. 1 in 5 chose something cheaper.</p>
        </div>
        <div class="box stack" style="gap:10px">
          <p style="margin:0;font-weight:600">How do you feel?</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${FEELINGS.map(([id, label]) => html`<button key=${id} type="button" class="pill" aria-pressed=${p[id] ? 'true' : 'false'}
              onClick=${() => this.setState({ picked: Object.assign({}, p, { [id]: !p[id] }) })}>${label}</button>`)}
          </div>
          ${rushed && html`<p class="note warn msg" style="padding:10px 12px;border-radius:12px">Sounds rushed. Good deals come back. Sleep on it?</p>`}
          ${steady && html`<p class="note ok msg" style="padding:10px 12px;border-radius:12px">Sounds like a considered decision.</p>`}
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn" style="flex:1">Remind me tomorrow</button>
          <button type="button" class="btn ghost" style="flex:1">Cheaper options</button>
        </div>
      </div>`;
    }

    viewAfford() {
      return html`<div class="stack">
        <label class="field">What are you buying?<input type="text" value="Headphones" /></label>
        <label class="field">Price<input type="text" value="$249" /></label>
        <div class="note good msg" style="border-radius:18px;padding:16px">
          <p style="font-weight:600">Yes, you can afford it.</p>
          <p style="margin-top:4px;font-size:13.5px">It pushes your emergency fund back about 2 weeks. You'd have $432.77 left this month.</p>
        </div>
      </div>`;
    }

    viewWhatIf() {
      const sc = this.state.scen;
      return html`<div class="stack">
        <p class="muted" style="margin:0;font-size:13.5px">Pick a change. See your savings in 5 years.</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${Object.keys(SCENARIOS).map((id) => html`<button key=${id} type="button" class="pill" aria-pressed=${sc === id ? 'true' : 'false'} onClick=${() => this.setState({ scen: id })}>${SCENARIOS[id].label}</button>`)}
        </div>
        <div key=${sc} class="box msg" style="display:block;padding:18px">
          <p class="muted" style="margin:0;font-size:13px">Savings in 5 years</p>
          <p class="mono" style="margin:2px 0 0;font-size:34px;letter-spacing:-.02em">${SCENARIOS[sc].value}</p>
          <p style="margin:6px 0 0;font-size:13.5px">${SCENARIOS[sc].note}</p>
        </div>
      </div>`;
    }

    viewTranslate() {
      return html`<div class="stack">
        <label class="field">Paste the confusing part<textarea rows="3">Interest accrues on a precomputed basis. A prepayment penalty may apply.</textarea></label>
        <div class="box stack msg" style="gap:10px">
          <p style="margin:0"><strong>"Precomputed basis"</strong> means the interest is worked out up front. Paying early saves less than you'd think.</p>
          <p style="margin:0"><strong>"Prepayment penalty"</strong> is a fee for paying the loan off early.</p>
        </div>
      </div>`;
    }

    viewLegit() {
      return html`<div class="stack">
        <label class="field">Paste a post, video script or tip<textarea rows="3">This app gives guaranteed returns, totally risk-free. Use my link for a bonus!</textarea></label>
        <div class="note warn msg" style="border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:6px">
          <p style="font-weight:700">Be careful</p>
          <p style="font-size:13.5px">No investment is "guaranteed" or "risk-free". That's hype.</p>
          <p style="font-size:13.5px">"Use my link" means they get paid when you sign up.</p>
        </div>
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
      const current = TOOLS.find((t) => t[0] === s.view) || TOOLS[0];
      const atHome = s.view === 'home';
      const views = {
        home: () => this.viewHome(botName), safe: () => this.viewSafe(), budget: () => this.viewBudget(),
        credit: () => this.viewCredit(), loan: () => this.viewLoan(), ready: () => this.viewReady(),
        afford: () => this.viewAfford(), whatif: () => this.viewWhatIf(), translate: () => this.viewTranslate(),
        legit: () => this.viewLegit(), next: () => this.viewNext()
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
            ${TOOLS.map(([id, label]) => html`<button key=${id} type="button" class="pill" aria-pressed=${s.view === id ? 'true' : 'false'} onClick=${() => this.go(id)}>${label}</button>`)}
          </div>
          <div class="m-divider"></div>
          <div class="m-body" ref=${(el) => { this.body = el; }}><div key=${s.view} class="m-view">${views[s.view]()}</div></div>
          <div class="m-compose">
            ${atHome && html`<div class="m-chips">
              ${["Am I on budget?", "What's my credit score?", 'Is my car loan OK?'].map((c) => html`<button key=${c} type="button" class="pill" onClick=${() => this.ask(c)}>${c}</button>`)}
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

  window.Mercer = {
    mount(el, props) { render(html`<${Mercer} ...${props || {}} />`, el); }
  };
})();
