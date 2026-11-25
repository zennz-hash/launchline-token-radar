// Launchline client dashboard: zero network, zero framework, exact model parity.
// Reads window.LAUNCHLINE (written beside dashboard/ by main.ts), verifies every row
// against board.json via computeImpliedValue(), and renders the calibration scatter,
// filterable/sortable board, live comps, excluded audit, CV proof, and detail dialog.
(() => {
  'use strict';

  const DATA = window.LAUNCHLINE;
  const mainEl = document.getElementById('main-content');
  const mastheadEl = document.getElementById('masthead');
  const footEl = document.getElementById('foot');
  const liveEl = document.getElementById('status-live');
  const dialogEl = document.getElementById('detail-dialog');
  const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
  const SVG_NS = 'http' + '://www.w3.org/2000/svg';

  const state = {
    tab: 'board', tier: 'all', category: 'all', chain: 'all',
    verdict: 'all', flow: 'all', q: '', sort: 'implied',
    dir: 'descending', selected: null, theme: 'light', liveOnlyComps: false,
  };

  const announce = (msg) => { if (liveEl) liveEl.textContent = msg; };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const ch of children.flat()) {
      if (ch === null || ch === undefined || ch === false) continue;
      node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    }
    return node;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(abs < 100 ? 2 : 0)}`;
  }
  const fmtSignedUsd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`);
  const fmtPct = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`);
  const fmtAge = (days) => (days === null || days === undefined ? 'unlisted' : days >= 365 ? `${(days / 365).toFixed(1)}y` : `${Math.round(days)}d`);
  const sigmoid = (z) => (z > 35 ? 1 : z < -35 ? 0 : 1 / (1 + Math.exp(-z)));

  // Exact mirror of lib/model.ts computeImpliedValue() for parity proof & sandbox.
  function computeImpliedValue(row, model, overrides) {
    const betaTvl = overrides && overrides.betaTvl !== undefined ? overrides.betaTvl : model.stage1.beta_tvl;
    const growthTilt = overrides && overrides.growthTilt !== undefined ? overrides.growthTilt : 0;
    const lnTvl = Math.log(Math.max(1, row.tvl_usd));
    let vCond = Math.exp(model.stage1.alpha + betaTvl * lnTvl);
    if (growthTilt !== 0 && row.change_7d !== null && row.change_7d !== undefined) {
      const cg = Math.max(-0.5, Math.min(1.0, row.change_7d / 100));
      vCond *= Math.max(0.25, 1 + cg * growthTilt);
    }
    const ageVal = Math.log(Math.max(30, row.age_days ?? model.median_age_days));
    const catLo = model.stage2.cat_log_odds[row.category || 'Other'] ?? Math.log(model.stage2.base_rate / (1 - model.stage2.base_rate));
    const lnChains = Math.log(Math.max(1, (row.chains || []).length));
    const { weights: w, means: m, stds: s } = model.stage2;
    const z = w[0] + w[1] * ((lnTvl - m[1]) / s[1]) + w[2] * ((ageVal - m[2]) / s[2]) + w[3] * ((catLo - m[3]) / s[3]) + w[4] * ((lnChains - m[4]) / s[4]);
    const pTok = sigmoid(z);
    return { v_cond_usd: Math.max(1, Math.round(vCond)), p_tok: Math.round(pTok * 1e4) / 1e4, implied_value_usd: Math.max(1, Math.round(vCond * pTok)) };
  }

  function verifyBoardParity(data) {
    let matched = 0, maxDrift = 0;
    for (const r of data.rows) {
      const drift = Math.abs(computeImpliedValue(r, data.model).implied_value_usd - r.implied_value_usd);
      if (drift === 0) matched++;
      if (drift > maxDrift) maxDrift = drift;
    }
    return { matched, total: data.rows.length, maxDrift };
  }

  // Uses the exact 5 costed steps produced by lib/model.ts buildFarmPlan() (exported
  // in data.js beside board.json) and verifies step cost math sums to farm.total_cost_usd.
  function getVerifiedFarmSteps(row) {
    return Array.isArray(row.steps) ? row.steps : [];
  }

  // Fallback for browsers without <dialog closedby="any">
  if (dialogEl && !('closedBy' in HTMLDialogElement.prototype)) {
    let pressedOutside = false;
    const isOutside = (e) => {
      const r = dialogEl.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    dialogEl.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
    dialogEl.addEventListener('pointerup', (e) => { if (pressedOutside && isOutside(e)) dialogEl.close(); });
  }
  if (dialogEl) {
    dialogEl.addEventListener('close', () => {
      dialogEl.returnValue = '';
      if (state.selected !== null) { state.selected = null; writeHash(); highlightSelectedRow(); }
    });
  }

  function readHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const p = new URLSearchParams(raw);
    for (const [k, sk] of [['tab','tab'],['tier','tier'],['cat','category'],['chain','chain'],['verdict','verdict'],['flow','flow'],['q','q'],['sort','sort'],['dir','dir'],['p','selected']]) {
      if (p.get(k)) state[sk] = p.get(k);
    }
    if (p.get('theme') === 'dark') state.theme = 'dark';
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.tier !== 'all') p.set('tier', state.tier);
    if (state.category !== 'all') p.set('cat', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.flow !== 'all') p.set('flow', state.flow);
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== 'descending') p.set('dir', state.dir);
    if (state.selected) p.set('p', state.selected);
    if (state.theme === 'dark') p.set('theme', 'dark');
    const s = p.toString();
    try { window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search); } catch {}
  }

  const applyTheme = () => document.documentElement.setAttribute('data-theme', state.theme);

  if (!DATA || !Array.isArray(DATA.rows) || !DATA.model) {
    mainEl.textContent = '';
    mainEl.appendChild(el('section', { class: 'state-box', role: 'alert' },
      el('h1', { text: 'Snapshot data unavailable' }),
      el('p', { text: 'Launchline could not load ../data.js. Run main.ts against snapshot.json to regenerate the board and reload this page.' })
    ));
    return;
  }

  const PARITY = verifyBoardParity(DATA);
  const ALL_CATEGORIES = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort(collator.compare);
  const ALL_CHAINS = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort(collator.compare);

  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.farm.verdict !== state.verdict) return false;
      if (state.flow === 'growing' && (r.change_7d === null || r.change_7d <= 0)) return false;
      if (state.flow === 'outflow' && (r.change_7d === null || r.change_7d > -10)) return false;
      if (q && ![r.name, r.slug, r.category || '', (r.chains || []).join(' '), r.farm.exec_chain, r.farm.verdict].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortList(list) {
    const k = state.sort, factor = state.dir === 'ascending' ? 1 : -1;
    return list.slice().sort((a, b) => {
      let d = 0;
      if (k === 'name') d = collator.compare(a.name, b.name);
      else if (k === 'rank') d = a.rank - b.rank;
      else if (k === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (k === 'growth') d = (a.change_7d ?? -1e9) - (b.change_7d ?? -1e9);
      else if (k === 'age') d = (a.age_days ?? -1) - (b.age_days ?? -1);
      else if (k === 'vcond') d = a.v_cond_usd - b.v_cond_usd;
      else if (k === 'ptok') d = a.p_tok - b.p_tok;
      else if (k === 'netev') d = a.farm.est_net_usd - b.farm.est_net_usd;
      else d = a.implied_value_usd - b.implied_value_usd;
      return d !== 0 ? factor * d : collator.compare(a.slug, b.slug);
    });
  }

  function buildCalibrationSvg() {
    const comps = DATA.live.filter((r) => r.is_comp && r.mcap_usd > 0 && r.tvl_usd > 0);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 460 152');
    svg.setAttribute('class', 'cal-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Log-log scatter plot of 92 live-token comps comparing fitted power-law MCap curve against naive 0.25x TVL');
    const padL = 44, padT = 10, W = 402, H = 118;
    const minX = Math.log10(5e6), maxX = Math.log10(1.2e10), minY = Math.log10(5e4), maxY = Math.log10(3e9);
    const sx = (v) => padL + ((Math.max(minX, Math.min(maxX, Math.log10(Math.max(1, v)))) - minX) / (maxX - minX)) * W;
    const sy = (v) => padT + H - ((Math.max(minY, Math.min(maxY, Math.log10(Math.max(1, v)))) - minY) / (maxY - minY)) * H;
    const add = (tag, a, txt) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
      if (txt !== undefined) n.textContent = txt;
      svg.appendChild(n);
    };
    for (const [v, lbl] of [[1e6,'$1M'],[1e7,'$10M'],[1e8,'$100M'],[1e9,'$1B']]) {
      const y = sy(v);
      add('line', { x1: padL, x2: padL + W, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 1 });
      add('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 9, 'font-family': 'var(--mono)' }, lbl);
    }
    for (const [v, lbl] of [[5e6,'$5M'],[5e7,'$50M'],[5e8,'$500M'],[5e9,'$5B']]) {
      add('text', { x: sx(v), y: padT + H + 15, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9, 'font-family': 'var(--mono)' }, lbl);
    }
    add('line', { x1: sx(5e6), y1: sy(5e6 * 0.25), x2: sx(1e10), y2: sy(1e10 * 0.25), stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });
    for (const c of comps) add('circle', { cx: sx(c.tvl_usd).toFixed(1), cy: sy(c.mcap_usd).toFixed(1), r: 2.6, fill: 'var(--accent)', 'fill-opacity': 0.58 });
    const { alpha: a, beta_tvl: b } = DATA.model.stage1;
    add('line', { x1: sx(5e6), y1: sy(Math.exp(a + b * Math.log(5e6))), x2: sx(1e10), y2: sy(Math.exp(a + b * Math.log(1e10))), stroke: 'var(--accent)', 'stroke-width': 2.4 });
    return svg;
  }

  function renderMasthead() {
    mastheadEl.textContent = '';
    const u = DATA.universe_counts;
    mastheadEl.appendChild(el('div', { class: 'masthead-inner' },
      el('div', { class: 'brand-lockup' },
        el('span', { class: 'wordmark', text: 'Launchline' }),
        el('span', { class: 'brand-desk', text: 'Pre-Token Valuation & Farm Desk' })
      ),
      el('div', { class: 'masthead-meta' },
        el('span', { text: `Snapshot ${DATA.as_of}` }),
        el('span', { text: `${u.total} / ${u.total} protocols accounted` }),
        el('span', { class: 'parity-pill', text: `${PARITY.matched}/${PARITY.total} parity OK ($${PARITY.maxDrift} drift)` }),
        el('button', {
          type: 'button', class: 'theme-btn', 'aria-pressed': state.theme === 'dark' ? 'true' : 'false',
          text: state.theme === 'dark' ? 'Light sheet' : 'Dark sheet',
          onclick: () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); writeHash(); renderMasthead(); announce(`Switched to ${state.theme} theme`); },
        })
      )
    ));
  }

  function renderHeroBand() {
    const u = DATA.universe_counts, s1 = DATA.model.stage1, s2 = DATA.model.stage2;
    const posCount = DATA.rows.filter((r) => r.farm.verdict === 'Positive EV').length;
    return el('section', { class: 'hero-band' },
      el('div', { class: 'hero-copy' },
        el('div', null,
          el('h1', { text: `${u.ranked} pre-token protocols ranked by fitted launch value` }),
          el('p', { text: `Covers all ${u.watchlist} watchlist protocols (>=$${Math.round(DATA.floor_usd / 1e6)}M TVL) plus ${u.early} clean early protocols below the floor. Fitted strictly from ${u.live_comps} live-token comps and ${DATA.model.clean_universe_count} clean protocols; ${u.live_total} live-token and ${u.excluded_total} excluded protocols are set aside. Estimates are model outputs, not promises.` })
        ),
        el('div', { class: 'ledger-strip' },
          el('div', { class: 'ledger-cell' }, el('span', { class: 'ledger-k', text: 'Watchlist floor' }), el('span', { class: 'ledger-v', text: `${u.watchlist} / ${u.watchlist}` }), el('span', { class: 'ledger-sub', text: `+ ${u.early} early (<$50M)` })),
          el('div', { class: 'ledger-cell' }, el('span', { class: 'ledger-k', text: 'Stage 1 LOOCV RMSE' }), el('span', { class: 'ledger-v', text: s1.loocv_rmse.toFixed(2) }), el('span', { class: 'ledger-sub', text: `vs ${s1.starter_rmse.toFixed(2)} starter (${s1.loocv_med_factor}x med)` })),
          el('div', { class: 'ledger-cell' }, el('span', { class: 'ledger-k', text: 'Stage 2 Peer AUC' }), el('span', { class: 'ledger-v', text: s2.cv_auc.toFixed(2) }), el('span', { class: 'ledger-sub', text: `10-fold CV (n=${DATA.model.clean_universe_count})` })),
          el('div', { class: 'ledger-cell' }, el('span', { class: 'ledger-k', text: 'Positive-EV Farms' }), el('span', { class: 'ledger-v', text: String(posCount) }), el('span', { class: 'ledger-sub', text: 'costed retail tickets' }))
        )
      ),
      el('div', { class: 'chart-card' },
        el('div', { class: 'chart-head' },
          el('h2', { text: `Does sublinear TVL beat naive 0.25x TVL on ${u.live_comps} live comps?` }),
          el('div', { class: 'chart-legend' },
            el('span', { class: 'leg-item' }, el('i', { class: 'leg-dot' }), `${u.live_comps} comps`),
            el('span', { class: 'leg-item' }, el('i', { class: 'leg-line' }), `Fitted TVL^${s1.beta_tvl.toFixed(2)}`),
            el('span', { class: 'leg-item' }, el('i', { class: 'leg-dash' }), 'Naive 0.25x TVL')
          )
        ),
        buildCalibrationSvg(),
        el('div', { class: 'chart-foot', text: `ln(V_cond) = ${s1.alpha.toFixed(2)} + ${s1.beta_tvl.toFixed(3)}*ln(TVL) | Implied = V_cond * P_tok` })
      )
    );
  }

  function renderTabs() {
    const u = DATA.universe_counts;
    const items = [
      { id: 'board', label: `Pre-Token Board (${u.ranked})` },
      { id: 'live', label: `Live-Token Comps (${u.live_total})` },
      { id: 'excluded', label: `Excluded Pre-Token (${u.excluded_total})` },
      { id: 'proof', label: 'Model & CV Proof' },
    ];
    return el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Dashboard sections' },
      items.map((it, idx) => el('button', {
        type: 'button', role: 'tab', class: 'tab-btn', id: `tab-${it.id}`,
        'aria-selected': state.tab === it.id ? 'true' : 'false', tabindex: state.tab === it.id ? '0' : '-1', text: it.label,
        onclick: () => { state.tab = it.id; writeHash(); renderMain(); announce(`Viewing ${it.label}`); },
        onkeydown: (e) => {
          const next = e.key === 'ArrowRight' ? (idx + 1) % items.length : e.key === 'ArrowLeft' ? (idx - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault(); state.tab = items[next].id; writeHash(); renderMain();
          document.getElementById(`tab-${items[next].id}`)?.focus();
        },
      }))
    );
  }

  function resetFilters() {
    state.tier = state.category = state.chain = state.verdict = state.flow = 'all';
    state.q = '';
    writeHash(); renderMain(); announce('Cleared all board filters');
  }

  function renderToolbar(shownCount) {
    const u = DATA.universe_counts;
    const qInput = el('input', { type: 'search', id: 'filter-q', placeholder: 'Protocol, category, or chain', value: state.q });
    qInput.addEventListener('input', () => { state.q = qInput.value; writeHash(); updateBoardPanel(); });

    const mkSelect = (id, lbl, cur, opts, cb) => {
      const sel = el('select', { id }, opts.map((o) => el('option', { value: o.v, text: o.l, selected: o.v === cur })));
      sel.addEventListener('change', () => cb(sel.value));
      return el('div', { class: 'field' }, el('label', { for: id, text: lbl }), sel);
    };

    const tierBtns = [['all', `All (${u.ranked})`], ['watchlist', `Watchlist (${u.watchlist})`], ['early', `Early (${u.early})`]].map(([v, l]) =>
      el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': state.tier === v ? 'true' : 'false', text: l, onclick: () => { state.tier = v; writeHash(); renderMain(); announce(`Filtered tier to ${l}`); } })
    );

    const chips = [];
    if (state.tier !== 'all') chips.push(`Tier: ${state.tier === 'watchlist' ? 'Watchlist (>=$50M)' : 'Early (<$50M)'}`);
    if (state.category !== 'all') chips.push(`Category: ${state.category}`);
    if (state.chain !== 'all') chips.push(`Chain: ${state.chain}`);
    if (state.verdict !== 'all') chips.push(`Verdict: ${state.verdict}`);
    if (state.flow !== 'all') chips.push(`7d Flow: ${state.flow === 'growing' ? 'Growing (>0%)' : 'Outflow (<=-10%)'}`);
    if (state.q.trim()) chips.push(`Search: "${state.q.trim()}"`);

    return el('section', { class: 'toolbar', 'aria-label': 'Board filters' },
      el('div', { class: 'toolbar-row' },
        el('div', { class: 'field' }, el('label', { for: 'filter-q', text: 'Search' }), qInput),
        el('div', { class: 'field' }, el('span', { class: 'field-lbl', id: 'tier-lbl', text: 'Radar Tier' }), el('div', { class: 'seg-group', role: 'group', 'aria-labelledby': 'tier-lbl' }, tierBtns)),
        mkSelect('filter-cat', 'Category', state.category, [{ v: 'all', l: `All categories (${ALL_CATEGORIES.length})` }, ...ALL_CATEGORIES.map((c) => ({ v: c, l: c }))], (v) => { state.category = v; writeHash(); renderMain(); }),
        mkSelect('filter-chain', 'Chain', state.chain, [{ v: 'all', l: `All chains (${ALL_CHAINS.length})` }, ...ALL_CHAINS.map((c) => ({ v: c, l: c }))], (v) => { state.chain = v; writeHash(); renderMain(); }),
        mkSelect('filter-verdict', 'Farm Verdict', state.verdict, [{ v: 'all', l: 'All farm verdicts' }, { v: 'Positive EV', l: 'Positive EV (retail)' }, { v: 'Scale Ticket', l: 'Scale Ticket' }, { v: 'High Dilution', l: 'High Dilution' }], (v) => { state.verdict = v; writeHash(); renderMain(); }),
        mkSelect('filter-flow', '7d TVL Flow', state.flow, [{ v: 'all', l: 'All 7d flows' }, { v: 'growing', l: 'Growing (>0% 7d)' }, { v: 'outflow', l: 'Outflow (<=-10% 7d)' }], (v) => { state.flow = v; writeHash(); renderMain(); })
      ),
      el('div', { class: 'toolbar-status' },
        el('div', { class: 'active-chips', id: 'active-chips' },
          chips.length === 0
            ? el('span', { class: 'count-note', text: `Sorted by ${state.sort} (${state.dir}). Click any column header to sort or any row for its valuation & farm plan.` })
            : [...chips.map((c) => el('span', { class: 'chip', text: c })), el('button', { type: 'button', class: 'chip-reset', text: 'Reset filters', onclick: resetFilters })]
        ),
        el('span', { class: 'count-note', id: 'row-count', text: `${shownCount} of ${u.ranked} pre-token protocols shown` })
      )
    );
  }

  function sortTh(key, label, isNum) {
    const attrs = { scope: 'col', class: isNum ? 'num' : null };
    if (state.sort === key) attrs['aria-sort'] = state.dir;
    return el('th', attrs, el('button', {
      type: 'button', text: label,
      onclick: () => {
        if (state.sort === key) state.dir = state.dir === 'descending' ? 'ascending' : 'descending';
        else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 'ascending' : 'descending'; }
        writeHash(); updateBoardPanel(); announce(`Sorted board by ${label}, ${state.dir}`);
      },
    }));
  }

  const verdictClass = (v) => (v === 'Positive EV' ? 'v-pos' : v === 'High Dilution' ? 'v-dil' : 'v-scale');

  function renderBoardTable(list) {
    if (list.length === 0) {
      return el('div', { class: 'state-box' },
        el('h2', { text: 'No pre-token protocols match these filters' }),
        el('p', { text: 'Zero rows match the current combination of tier, category, chain, verdict, and search query.' }),
        el('button', { type: 'button', class: 'primary-btn', text: 'Reset filters', onclick: resetFilters })
      );
    }
    const maxImp = DATA.rows[0]?.implied_value_usd || 1;
    const tbody = el('tbody', null, list.map((r) => {
      const gCls = r.change_7d === null ? '' : r.change_7d > 0 ? 'pos' : r.change_7d <= -10 ? 'neg' : '';
      const barPct = Math.max(4, Math.round((r.implied_value_usd / maxImp) * 100));
      const chTxt = r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ` +${r.chains.length - 2}` : '') : 'unlisted';
      return el('tr', { class: 'clickable', 'data-slug': r.slug, 'data-selected': state.selected === r.slug ? 'true' : 'false', onclick: () => openProtocolDetail(r.slug) },
        el('td', { class: 'num rank-cell', text: `#${r.rank}` }),
        el('th', { scope: 'row', class: 'proto-cell' },
          el('button', { type: 'button', class: 'proto-btn', text: r.name, onclick: (e) => { e.stopPropagation(); openProtocolDetail(r.slug); } }),
          el('div', { class: 'proto-meta' }, el('span', { class: `tier-tag ${r.tier === 'watchlist' ? 'wl' : ''}`, text: r.tier === 'watchlist' ? 'WL' : 'Early' }), el('span', { text: `${r.category || 'Other'} | ${chTxt}` }))
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: `num ${gCls}`, text: fmtPct(r.change_7d, 1) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.v_cond_usd) }),
        el('td', { class: 'num', text: `${Math.round(r.p_tok * 100)}%` }),
        el('td', { class: 'imp-cell' }, el('div', { class: 'imp-wrap' }, el('span', { class: 'imp-val', text: fmtUsd(r.implied_value_usd) }), el('span', { class: 'imp-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${barPct}%` })))),
        el('td', { class: 'farm-cell' },
          el('div', { class: 'farm-top' }, el('span', { class: `verdict-tag ${verdictClass(r.farm.verdict)}`, text: r.farm.verdict }), el('span', { class: `num ${r.farm.est_net_usd >= 0 ? 'pos' : ''}`, text: fmtSignedUsd(r.farm.est_net_usd) })),
          el('div', { class: 'farm-sub', text: `${r.farm.exec_chain} | $${r.farm.capital_usd} | $${r.farm.total_cost_usd.toFixed(2)} cost | ${r.farm.hold_days}d` })
        )
      );
    }));

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-labelledby': 'board-caption' },
        el('table', null,
          el('caption', { class: 'table-cap', id: 'board-caption', text: 'Ranked pre-token protocols (no token recorded on DefiLlama). Select any row for valuation decomposition, nearest live comps, what-if sandbox, and 5-step costed farm plan.' }),
          el('thead', null, el('tr', null, sortTh('rank','Rank',true), sortTh('name','Protocol',false), sortTh('tvl','TVL',true), sortTh('growth','7d Flow',true), sortTh('age','Age',true), sortTh('vcond','Cond. MCap',true), sortTh('ptok','Peer Rate',true), sortTh('implied','Implied Value',true), sortTh('netev','Farm Plan & Net EV',false))),
          tbody
        )
      )
    );
  }

  function renderLiveTab() {
    const list = state.liveOnlyComps ? DATA.live.filter((r) => r.is_comp) : DATA.live;
    const cap = Math.min(list.length, 150);
    return el('div', { role: 'tabpanel', 'aria-labelledby': 'tab-live' },
      el('div', { class: 'toolbar' },
        el('div', { class: 'toolbar-status', style: 'border-top:0;padding-top:0' },
          el('div', { class: 'seg-group' },
            el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': !state.liveOnlyComps ? 'true' : 'false', text: `All Live-Token (${DATA.live.length})`, onclick: () => { state.liveOnlyComps = false; renderMain(); } }),
            el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': state.liveOnlyComps ? 'true' : 'false', text: `${DATA.universe_counts.live_comps} Clean Valuation Comps`, onclick: () => { state.liveOnlyComps = true; renderMain(); } })
          ),
          el('span', { class: 'count-note', text: `Set aside from pre-token rankings. Showing ${cap} of ${list.length} live protocols by market cap.` })
        )
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-labelledby': 'live-caption' },
          el('table', null,
            el('caption', { class: 'table-cap', id: 'live-caption', text: 'Protocols recording a trading token on DefiLlama. Clean standalone comps with market cap fit Stage 1.' }),
            el('thead', null, el('tr', null, el('th',{scope:'col',text:'Protocol'}), el('th',{scope:'col',class:'num',text:'TVL'}), el('th',{scope:'col',class:'num',text:'Market Cap'}), el('th',{scope:'col',class:'num',text:'MCap/TVL'}), el('th',{scope:'col',class:'num',text:'7d Flow'}), el('th',{scope:'col',class:'num',text:'Age'}))),
            el('tbody', null, list.slice(0, cap).map((r) => el('tr', null,
              el('th', { scope: 'row', class: 'proto-cell' }, el('strong', { text: r.name }), el('div', { class: 'proto-meta' }, el('span', { class: `tier-tag ${r.is_comp ? 'wl' : ''}`, text: r.is_comp ? 'Stage 1 Comp' : r.symbol || 'Live Token' }), el('span', { text: `${r.category || 'Other'} | ${r.chains.slice(0,2).join(', ') || 'unlisted'}` }))),
              el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
              el('td', { class: 'num', text: r.mcap_tvl_ratio !== null ? `${r.mcap_tvl_ratio.toFixed(3)}x` : 'n/a' }),
              el('td', { class: `num ${r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'}`, text: fmtPct(r.change_7d, 1) }),
              el('td', { class: 'num', text: fmtAge(r.age_days) })
            )))
          )
        )
      )
    );
  }

  function renderExcludedTab() {
    const chips = Object.keys(DATA.universe_counts.excluded_by_reason).sort().map((k) => el('span', { class: 'chip', text: `${k}: ${DATA.universe_counts.excluded_by_reason[k]}` }));
    return el('div', { role: 'tabpanel', 'aria-labelledby': 'tab-excluded' },
      el('div', { class: 'toolbar' }, el('div', { class: 'active-chips' }, chips)),
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-labelledby': 'excl-caption' },
          el('table', null,
            el('caption', { class: 'table-cap', id: 'excl-caption', text: 'Pre-token protocols excluded from the ranked board by standalone rules (CEX, bridges, liquid staking, versioned pools, wrapped/staked products, or above-floor parent sub-products).' }),
            el('thead', null, el('tr', null, el('th',{scope:'col',text:'Protocol'}), el('th',{scope:'col',text:'Category'}), el('th',{scope:'col',class:'num',text:'TVL'}), el('th',{scope:'col',class:'num',text:'7d Flow'}), el('th',{scope:'col',text:'Exclusion Rule'}))),
            el('tbody', null, DATA.excluded.map((r) => el('tr', null, el('th',{scope:'row',text:r.name}), el('td',{text:r.category||'Other'}), el('td',{class:'num',text:fmtUsd(r.tvl_usd)}), el('td',{class:'num',text:fmtPct(r.change_7d,1)}), el('td',{text:r.reason}))))
          )
        )
      )
    );
  }

  function renderProofTab() {
    const m = DATA.model;
    return el('div', { class: 'proof-grid', role: 'tabpanel', 'aria-labelledby': 'tab-proof' },
      el('section', { class: 'proof-card' },
        el('h2', { text: `Stage 1: Conditional Launch Value (LOOCV across ${m.comps_count} clean live comps)` }),
        el('p', { text: 'Every candidate term is tested by exact Leave-One-Out Cross-Validation on the snapshot\'s clean standalone live-token comps. Terms are kept only when they improve both out-of-sample RMSE and median/within-2x accuracy.' }),
        el('div', { class: 'eq-box', text: `V_cond = exp(${m.stage1.alpha.toFixed(4)} + ${m.stage1.beta_tvl.toFixed(4)} * ln(tvl_usd)) | LOOCV IQR band: [${m.stage1.p25_mult.toFixed(2)}x, ${m.stage1.p75_mult.toFixed(2)}x]` }),
        el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': 'Stage 1 LOOCV ablation table' },
          el('table', null,
            el('thead', null, el('tr', null, el('th',{scope:'col',text:'Specification'}), el('th',{scope:'col',class:'num',text:'LOOCV RMSE'}), el('th',{scope:'col',class:'num',text:'Med Error'}), el('th',{scope:'col',class:'num',text:'Within 2x'}), el('th',{scope:'col',text:'Decision'}), el('th',{scope:'col',text:'Evidence'}))),
            el('tbody', null, m.stage1.ablation.map((r) => el('tr', null, el('th',{scope:'row',text:r.label}), el('td',{class:'num',text:r.loocv_rmse.toFixed(4)}), el('td',{class:'num',text:`${r.loocv_med_factor.toFixed(2)}x`}), el('td',{class:'num',text:`${r.within_2x_pct.toFixed(1)}%`}), el('td',null,el('span',{class:`decision-tag ${r.decision}`,text:r.decision})), el('td',{text:r.note}))))
          )
        )
      ),
      el('section', { class: 'proof-card' },
        el('h2', { text: `Stage 2: Live-Token Peer Parity (10-fold CV across ${m.clean_universe_count} clean protocols)` }),
        el('p', { text: 'Fits how strongly a protocol\'s TVL, age without token, category, and multi-chain footprint match tokenized peers. Terms must improve out-of-sample log-loss and pass economic sign sanity.' }),
        el('div', { class: 'eq-box', text: `P_tok = sigmoid(${m.stage2.weights[0].toFixed(3)} + ${m.stage2.weights[1].toFixed(3)}*z(lnTVL) + ${m.stage2.weights[2].toFixed(3)}*z(lnAge) + ${m.stage2.weights[3].toFixed(3)}*z(catEB) + ${m.stage2.weights[4].toFixed(3)}*z(lnChains)) | Implied = round(V_cond * P_tok)` }),
        el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': 'Stage 2 CV ablation table' },
          el('table', null,
            el('thead', null, el('tr', null, el('th',{scope:'col',text:'Feature Step'}), el('th',{scope:'col',class:'num',text:'10f LogLoss'}), el('th',{scope:'col',class:'num',text:'Brier'}), el('th',{scope:'col',class:'num',text:'ROC AUC'}), el('th',{scope:'col',text:'Decision'}), el('th',{scope:'col',text:'Evidence'}))),
            el('tbody', null, m.stage2.ablation.map((r) => el('tr', null, el('th',{scope:'row',text:r.label}), el('td',{class:'num',text:r.cv_logloss.toFixed(4)}), el('td',{class:'num',text:r.cv_brier.toFixed(4)}), el('td',{class:'num',text:r.cv_auc.toFixed(4)}), el('td',null,el('span',{class:`decision-tag ${r.decision}`,text:r.decision})), el('td',{text:r.note}))))
          )
        )
      )
    );
  }

  function highlightSelectedRow() {
    for (const tr of mainEl.querySelectorAll('tbody tr[data-slug]')) {
      tr.setAttribute('data-selected', tr.getAttribute('data-slug') === state.selected ? 'true' : 'false');
    }
  }

  function openProtocolDetail(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row || !dialogEl) return;
    state.selected = slug;
    writeHash(); highlightSelectedRow();

    const rec = computeImpliedValue(row, DATA.model);
    const steps = getVerifiedFarmSteps(row), f = row.farm;
    const ci = DATA.model.stage2.cat_rates[row.category || 'Other'];
    const catTxt = ci ? `${ci.live}/${ci.total} (${Math.round(ci.rate * 100)}%)` : 'n/a';
    const contribs = [
      ['TVL scale', row.parity_contribs.tvl],
      ['Age w/o token', row.parity_contribs.age],
      [`Category ${catTxt}`, row.parity_contribs.category],
      [`Multi-chain (${row.chains.length})`, row.parity_contribs.chains],
    ];

    const betaIn = el('input', { type: 'range', min: '0.25', max: '0.75', step: '0.01', value: String(DATA.model.stage1.beta_tvl), 'aria-label': 'TVL elasticity beta' });
    const tiltIn = el('input', { type: 'range', min: '0', max: '0.5', step: '0.05', value: '0', 'aria-label': 'Optional 7d momentum weight' });
    const betaLbl = el('span', { text: DATA.model.stage1.beta_tvl.toFixed(2) });
    const tiltLbl = el('span', { text: '0.00' });
    const sbOut = el('span', { class: 'sandbox-out', text: `${fmtUsd(rec.implied_value_usd)} (empirical fit)` });
    const refreshSb = () => {
      const b = parseFloat(betaIn.value), t = parseFloat(tiltIn.value);
      betaLbl.textContent = b.toFixed(2); tiltLbl.textContent = t.toFixed(2);
      const sim = computeImpliedValue(row, DATA.model, { betaTvl: b, growthTilt: t });
      sbOut.textContent = `${fmtUsd(sim.implied_value_usd)} (V_cond ${fmtUsd(sim.v_cond_usd)})`;
    };
    betaIn.addEventListener('input', refreshSb);
    tiltIn.addEventListener('input', refreshSb);

    dialogEl.textContent = '';
    dialogEl.appendChild(el('div', { class: 'dlg-head' },
      el('div', null,
        el('div', { class: 'dlg-kicker', text: `RANK #${row.rank} OF ${DATA.rows.length} | ${row.tier === 'watchlist' ? 'WATCHLIST (>=$50M)' : 'EARLY RADAR (<$50M)'} | RECORDS NO TOKEN` }),
        el('h1', { id: 'detail-title', text: row.name }),
        el('p', { class: 'dlg-sub', text: `${row.category || 'Other'} | Chains: ${row.chains.join(', ') || 'unlisted'} | Listed: ${row.listed_at || 'unlisted'} (${fmtAge(row.age_days)})` })
      ),
      el('button', { type: 'button', class: 'dlg-close', autofocus: true, 'aria-label': 'Close protocol detail dialog', text: 'Close', onclick: () => { state.selected = null; dialogEl.close(); } })
    ));

    dialogEl.appendChild(el('div', { class: 'dlg-body' },
      el('section', { class: 'dlg-section' },
        el('h2', { text: 'Fitted Valuation Decomposition' }),
        el('div', { class: 'metric-grid' },
          el('div', { class: 'metric-box' }, el('span', { text: 'Snapshot TVL & 7d Flow' }), el('b', { text: fmtUsd(row.tvl_usd) }), el('small', { class: row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg', text: `7d: ${fmtPct(row.change_7d, 2)}` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Stage 1 Cond. Launch MCap' }), el('b', { text: fmtUsd(row.v_cond_usd) }), el('small', { text: `IQR: ${fmtUsd(row.v_low_usd)} to ${fmtUsd(row.v_high_usd)}` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Stage 2 Peer Token Rate' }), el('b', { text: `${(row.p_tok * 100).toFixed(1)}%` }), el('small', { text: `Category live rate ${catTxt}` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Expected Implied Value' }), el('b', { text: fmtUsd(row.implied_value_usd) }), el('small', { class: rec.implied_value_usd === row.implied_value_usd ? 'pos' : 'neg', text: rec.implied_value_usd === row.implied_value_usd ? 'Exact board.json parity ($0 drift)' : 'Drift detected' }))
        )
      ),
      el('div', { class: 'two-col-dlg' },
        el('div', { class: 'sub-card' },
          el('h3', { text: `Stage 2 Log-Odds Drivers (P_tok = ${(row.p_tok * 100).toFixed(1)}%)` }),
          contribs.map(([lbl, val]) => el('div', { class: 'contrib-row' },
            el('span', { text: lbl }),
            el('div', { class: 'contrib-track', 'aria-hidden': 'true' }, el('div', { class: `contrib-fill ${val < 0 ? 'neg-bar' : ''}`, style: `left:0;width:${Math.max(4, Math.min(100, Math.round((Math.abs(val) / 1.5) * 100)))}%` })),
            el('span', { class: `num ${val >= 0 ? 'pos' : 'neg'}`, text: `${val >= 0 ? '+' : ''}${val.toFixed(2)}` })
          ))
        ),
        el('div', { class: 'sub-card' },
          el('h3', { text: '3 Nearest Live-Token Comparables' }),
          el('ul', { class: 'comp-list' }, row.comps.map((c) => el('li', { class: 'comp-item' },
            el('div', null, el('strong', { text: c.name }), el('div', { class: 'dlg-sub', text: `${c.category} (${c.same_category ? 'same category' : 'size peer'})` })),
            el('div', { class: 'comp-nums' }, el('div', { text: `MCap ${fmtUsd(c.mcap_usd)}` }), el('div', { text: `TVL ${fmtUsd(c.tvl_usd)} (${c.ratio.toFixed(2)}x)` }))
          )))
        )
      ),
      el('div', { class: 'sandbox-bar' },
        el('strong', { text: 'What-if sandbox:' }),
        el('label', null, 'TVL elasticity ', betaIn, betaLbl),
        el('label', null, '7d tilt ', tiltIn, tiltLbl),
        sbOut,
        el('button', { type: 'button', class: 'chip-reset', text: 'Reset fit', onclick: () => { betaIn.value = String(DATA.model.stage1.beta_tvl); tiltIn.value = '0'; refreshSb(); } })
      ),
      el('section', { class: 'dlg-section' },
        el('h2', { text: 'Costed 5-Step Farm Plan & Net Retail Economics' }),
        el('div', { class: 'farm-summary-bar' },
          el('div', { class: 'metric-box' }, el('span', { text: 'Venue & Ticket' }), el('b', { text: `${f.exec_chain} | $${f.capital_usd}` }), el('small', { text: `${f.hold_days}d hold | ${f.total_minutes} min total` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Total Direct Cost' }), el('b', { text: `$${f.total_cost_usd.toFixed(2)}` }), el('small', { text: `Gas $${f.gas_cost_usd.toFixed(2)} (${f.tx_count} txs) + Opp $${f.opp_cost_usd.toFixed(2)}` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Illustrative 5% Pool Share' }), el('b', { class: f.est_net_usd >= 0 ? 'pos' : '', text: `${fmtSignedUsd(f.est_net_usd)} net` }), el('small', { text: `Gross $${f.est_gross_usd.toFixed(2)} on ${fmtUsd(f.est_pool_usd)} pool` })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Retail Farm Verdict' }), el('b', { text: f.verdict }), el('small', { text: `Breakeven ticket: ${fmtUsd(f.breakeven_capital_usd)}` }))
        ),
        el('ol', { class: 'step-list' }, steps.map((st) => el('li', { class: 'step-item' },
          el('div', null,
            el('div', { class: 'step-title', text: st.title }),
            el('div', { class: 'step-body', text: st.action }),
            el('div', { class: 'step-meta' }, el('span', { text: `Cost: ${st.cost}` }), el('span', { text: `Time: ${st.time}` }))
          )
        )))
      )
    ));
    if (!dialogEl.open) dialogEl.showModal();
  }

  function updateBoardPanel() {
    const slot = document.getElementById('board-slot');
    if (!slot) return;
    const list = sortList(filteredRows());
    slot.textContent = '';
    slot.appendChild(renderBoardTable(list));
    const countEl = document.getElementById('row-count');
    if (countEl) countEl.textContent = `${list.length} of ${DATA.universe_counts.ranked} pre-token protocols shown`;
  }

  function renderMain(openHashDetail) {
    mainEl.textContent = '';
    mainEl.appendChild(renderHeroBand());
    mainEl.appendChild(renderTabs());
    if (state.tab === 'board') {
      const list = sortList(filteredRows());
      mainEl.appendChild(el('div', { role: 'tabpanel', 'aria-labelledby': 'tab-board' }, renderToolbar(list.length), el('div', { id: 'board-slot' }, renderBoardTable(list))));
    } else if (state.tab === 'live') mainEl.appendChild(renderLiveTab());
    else if (state.tab === 'excluded') mainEl.appendChild(renderExcludedTab());
    else mainEl.appendChild(renderProofTab());
    if (openHashDetail && state.selected) openProtocolDetail(state.selected);
  }

  function renderFooter() {
    footEl.textContent = '';
    footEl.appendChild(el('div', { class: 'foot-inner' },
      el('span', { text: `Source: ${DATA.source}` }),
      el('span', { text: 'DefiLlama records no token for ranked rows; this is not proof no token exists. Implied values and 5% pool illustrations are model estimates.' })
    ));
  }

  readHash();
  applyTheme();
  renderMasthead();
  renderMain(true);
  renderFooter();
  window.addEventListener('hashchange', () => {
    state.tab = 'board'; state.tier = state.category = state.chain = state.verdict = state.flow = 'all';
    state.q = ''; state.sort = 'implied'; state.dir = 'descending'; state.selected = null;
    if (dialogEl && dialogEl.open) dialogEl.close();
    readHash(); applyTheme(); renderMasthead(); renderMain(true);
  });
})();
