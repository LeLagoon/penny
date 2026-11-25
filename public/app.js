
const STATE = {
  profile: null,
  predictedBudget: 0,
  monthlyTuition: 0,
  grossInflow: 0,
  netInflow: 0,
  affordabilityCap: 0,
  coliFactor: 1.0,
  transactions: [],
  goals: [],
  benchmarks: null,
  diagnostics: null,
  insights: null,
  meta: null,
  colleges: [],
  cities: [],
  regions: {},
  currentRegion: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    symbol: '$',
    flag: '🇺🇸',
    locale: 'en-US',
    quickDeposits: [25, 50, 100],
    stepAmt: 5,
    sampleTuition: 36000,
    sampleIncome: 2200,
    sampleAid: 800,
    baseSubsistence: 1350
  },
  currencySymbol: '$',
  currencyCode: 'USD',
  categories: { builtIn: [], custom: [] },
  tuitionPeriod: 'annual',
  activeView: 'overview',
  activeFilter: 'all',
  simCutPct: 20
};

const BASE_CAT_COLORS = {
  food: '#FF5A1F',
  entertainment: '#7C3AED',
  travel: '#0284C7',
  technology: '#2563EB',
  education: '#0D9488',
  shopping: '#DB2777',
  utilities: '#D97706',
  healthcare: '#DC2626',
  emi: '#4F46E5',
  investment: '#059669',
  miscellaneous: '#64748B'
};

const BASE_CAT_NAMES = {
  food: 'Food & Dining',
  entertainment: 'Entertainment',
  travel: 'Transit & Travel',
  technology: 'Technology & Gadgets',
  education: 'Education & Academics',
  shopping: 'Apparel & Shopping',
  utilities: 'Dorm & Utilities',
  healthcare: 'Healthcare & Wellness',
  emi: 'Loans & EMI',
  investment: 'Savings & Invest',
  miscellaneous: 'Miscellaneous'
};

let CAT_COLORS = { ...BASE_CAT_COLORS };
let CAT_NAMES = { ...BASE_CAT_NAMES };

// fetch wrapper: turns HTTP errors (e.g. a 400 validation message from the server) into exceptions.
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  return res;
}

// How sure the system is, shown honestly. Nothing here is invented: the number is the model's
// own probability, and "Not sure" appears when the model says a human should check.
function predictionBadge(p) {
  const pct = typeof p.confidence === 'number' ? Math.round(p.confidence * 100) : null;
  const engineName = p.engine === 'ml' || p.confidence_source === 'ml' ? 'AI model'
    : (p.source && p.source.startsWith('user_rule')) ? 'a rule you taught'
    : p.source === 'custom_category' ? 'your custom category keywords' : 'keyword rules';
  if (p.confidence_source === 'user' || p.source === 'user_rule_exact') {
    return { text: p.confidence_source === 'user' ? 'Your choice' : 'Your rule', cls: 'pill-emerald', title: 'Set by you' };
  }
  if (p.needs_review && pct === null) {
    return { text: 'Check', cls: 'pill-orange', title: `The ${engineName} would pick a different category. Click Teach to correct it.` };
  }
  if (p.needs_review) {
    return { text: `Not sure · ${pct}%`, cls: 'pill-orange', title: `Low confidence from the ${engineName}. Please check the category.` };
  }
  if (pct === null) return { text: '—', cls: 'pill-subtle', title: 'No confidence available' };
  return { text: `${pct}%`, cls: pct >= 85 ? 'pill-emerald' : 'pill-blue', title: `Confidence from the ${engineName}` };
}

function setPredictionPill(el, prediction) {
  if (!el) return;
  const b = predictionBadge(prediction);
  el.className = `pill ${b.cls}`;
  el.textContent = b.text;
  el.title = b.title;
}

// Escape user-controlled text before putting it into innerHTML (prevents script injection).
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every expense/goal remembers the currency it was entered in. Only entries in the active
// currency are shown and summed; the rest are kept on disk and reappear when you switch back.
// Ledger buttons carry only an expense id; the description and category are looked up here,
// so user-entered text never has to be embedded in an inline onclick string.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#ledger-tbody [data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'delete') {
    deleteExpense(id);
  } else if (btn.dataset.action === 'teach') {
    const t = STATE.transactions.find(x => x.id === id);
    if (t) openTeachModal(t.id);
  }
});

function matchesActiveCurrency(entry) {
  return !entry.currency || entry.currency === STATE.currencyCode;
}

function applyCurrencyFilter() {
  if (STATE.allTransactions) STATE.transactions = STATE.allTransactions.filter(matchesActiveCurrency);
  if (STATE.allGoals) STATE.goals = STATE.allGoals.filter(matchesActiveCurrency);
}

function formatCurrency(val, options = {}) {
  const num = parseFloat(val) || 0;
  const sym = (options.symbol !== undefined) ? options.symbol : (STATE.currencySymbol || '$');
  if (options.compact && Math.abs(num) >= 5000) {
    return `${sym}${Math.round(num / 1000)}k`;
  }
  const formatted = Math.round(num).toLocaleString();
  if (options.noSymbol) return formatted;
  return `${sym}${formatted}`;
}

function toggleSidebar(forceState) {
  const layout = document.querySelector('.app-layout');
  if (!layout) return;

  const willCollapse = forceState !== undefined ? !forceState : !layout.classList.contains('sidebar-collapsed');

  if (willCollapse) {
    layout.classList.add('sidebar-collapsed');
    localStorage.setItem('penny_sidebar_collapsed', 'true');
  } else {
    layout.classList.remove('sidebar-collapsed');
    localStorage.setItem('penny_sidebar_collapsed', 'false');
  }

  setTimeout(() => {
    if (STATE.activeView === 'overview') drawSpendingTrendChart();
    if (STATE.activeView === 'analytics') drawPeerBarChart();
  }, 380);
}

function initSidebar() {
  const saved = localStorage.getItem('penny_sidebar_collapsed');
  const layout = document.querySelector('.app-layout');
  if (saved === 'true' && layout) {
    layout.classList.add('sidebar-collapsed');
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
    }
  });
}


// ---- Theme (light / dark) ----
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('penny_theme', theme); } catch (e) { /* storage unavailable */ }
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) {
    document.startViewTransition(() => applyTheme(next));
  } else {
    applyTheme(next);
  }
}

// Follow the system setting until the user picks a theme themselves.
if (window.matchMedia) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    let saved = null;
    try { saved = localStorage.getItem('penny_theme'); } catch (err) { /* ignore */ }
    if (!saved) applyTheme(e.matches ? 'dark' : 'light');
  });
}

// ---- Smooth number changes on the headline figures ----
// Every figure always settles on the exact text the page rendered: the count-up only ever
// shows in-between values for a moment, and a timer forces the final text even if animation
// frames are paused (background tab) or another render arrives mid-way. Changing currency,
// or anything that is not the same kind of number, swaps instantly with no tween.
(function initNumberTween() {
  const NUM = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;
  const DURATION = 600;
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parse = txt => {
    const m = NUM.exec(txt || '');
    return m ? { pre: m[1], num: parseFloat(m[2].replace(/,/g, '')), dec: (m[2].split('.')[1] || '').length, post: m[3] } : null;
  };

  function watch(el) {
    if (el._tw) return;
    const st = (el._tw = { shown: el.textContent, final: el.textContent, raf: 0, timer: 0 });
    const obs = new MutationObserver(onMutate);

    function put(text) {
      st.shown = text;
      if (el.textContent !== text) el.textContent = text;
      obs.takeRecords(); // our own write must not look like a new render
    }
    function settle(text) {
      cancelAnimationFrame(st.raf);
      clearTimeout(st.timer);
      st.final = text;
      put(text);
    }
    function onMutate() {
      const next = el.textContent;
      if (next === st.shown) return;
      const from = parse(st.shown);
      const to = parse(next);
      cancelAnimationFrame(st.raf);
      clearTimeout(st.timer);
      st.final = next;
      if (reduce() || !from || !to || from.pre !== to.pre || from.post !== to.post || from.num === to.num || !el.offsetParent) {
        put(next);
        return;
      }
      const t0 = performance.now();
      const start = from.num;
      const frame = t => {
        const p = Math.min(1, (t - t0) / DURATION);
        const v = start + (to.num - start) * (1 - Math.pow(1 - p, 3));
        if (p < 1) {
          put(to.pre + v.toLocaleString(undefined, { minimumFractionDigits: to.dec, maximumFractionDigits: to.dec }) + to.post);
          st.raf = requestAnimationFrame(frame);
        } else {
          settle(next);
        }
      };
      put(to.pre + start.toLocaleString(undefined, { minimumFractionDigits: to.dec, maximumFractionDigits: to.dec }) + to.post);
      st.raf = requestAnimationFrame(frame);
      st.timer = setTimeout(() => settle(next), DURATION + 150); // always finish on the real value
    }
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    // Process a render that the observer has not reported yet (callbacks arrive asynchronously).
    st.sync = () => { if (obs.takeRecords().length) onMutate(); };
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[id^="kpi-"].kpi-num, #rail-budget, #rail-income, #rail-tuition, #rail-net-inflow, #donut-center-total').forEach(watch);
    applyTheme(currentTheme());
  });

  // Anything still mid-count is forced to its final text (used after a currency switch).
  window.settleNumbers = () => {
    document.querySelectorAll('[id^="kpi-"].kpi-num, #rail-budget, #rail-income, #rail-tuition, #rail-net-inflow, #donut-center-total').forEach(el => {
      if (el._tw) {
        el._tw.sync();
        cancelAnimationFrame(el._tw.raf);
        clearTimeout(el._tw.timer);
        if (el.textContent !== el._tw.final) el.textContent = el._tw.final;
        el._tw.shown = el.textContent;
      }
    });
  };
})();

// Cmd/Ctrl+Shift+R (hard reload) brings back the first-run setup with empty fields.
// Saved data is not deleted; it is replaced only if the setup is completed.
const PENNY_HARD_RESET = (() => {
  try {
    if (sessionStorage.getItem('penny_hard_reset')) {
      sessionStorage.removeItem('penny_hard_reset');
      return true;
    }
  } catch (e) { /* storage unavailable */ }
  return false;
})();
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
    try { sessionStorage.setItem('penny_hard_reset', '1'); } catch (err) { /* ignore */ }
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  initSidebar();

  const todayStr = new Date().toISOString().split('T')[0];
  const qmDate = document.getElementById('qm-date');
  const inDate = document.getElementById('inline-date');
  const gmDate = document.getElementById('gm-deadline');
  if (qmDate) qmDate.value = todayStr;
  if (inDate) inDate.value = todayStr;
  if (gmDate) {
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    gmDate.value = future.toISOString().split('T')[0];
  }

  await loadCategories();
  await loadMetadata();
  await loadProfile();
  await loadTransactions();
  await loadGoals();
  await loadPeerBenchmarks();
  await loadDiagnostics();

  renderAll();
  switchView('overview');

  window.addEventListener('resize', () => {
    if (STATE.activeView === 'overview') drawSpendingTrendChart();
    if (STATE.activeView === 'analytics') drawPeerBarChart();
  });
});

function setRegion(regionCode) {
  if (!regionCode) regionCode = 'US';
  const reg = (STATE.regions && STATE.regions[regionCode]) ? STATE.regions[regionCode] : STATE.currentRegion;
  STATE.currentRegion = reg;
  STATE.currencySymbol = reg.symbol || '$';
  STATE.currencyCode = reg.currency || 'USD';

  applyCurrencyFilter();
  updateCurrencyLabels();

  const railSelect = document.getElementById('rail-region-select');
  if (railSelect && railSelect.value !== reg.code) {
    railSelect.value = reg.code;
  }
  const railFlag = document.getElementById('rail-region-flag');
  if (railFlag) railFlag.textContent = reg.flag || '';
  const railName = document.getElementById('rail-region-name');
  if (railName) railName.textContent = `${reg.name} (${reg.currency})`;

  const obRegion = document.getElementById('ob-region');
  if (obRegion && obRegion.value !== reg.code) {
    obRegion.value = reg.code;
  }
}

function updateCurrencyLabels() {
  const code = STATE.currencyCode || 'USD';
  const sym = STATE.currencySymbol || '$';

  document.querySelectorAll('.currency-code').forEach(el => {
    el.textContent = code;
  });
  document.querySelectorAll('.currency-symbol').forEach(el => {
    el.textContent = sym;
  });

  const inlineAmt = document.getElementById('inline-amt');
  if (inlineAmt) {
    inlineAmt.placeholder = `${sym} Amount`;
    inlineAmt.step = 'any';
  }

  const qmAmt = document.getElementById('qm-amt');
  if (qmAmt) {
    qmAmt.step = 'any';
  }

  const canvasBadge = document.getElementById('canvas-active-currency-badge');
  if (canvasBadge) {
    canvasBadge.textContent = `${code} ${sym}`;
  }
}

async function handleRegionSwitch(regionCode) {
  if (!regionCode || !STATE.regions[regionCode]) return;
  const reg = STATE.regions[regionCode];
  setRegion(regionCode);

  try {
    // Switching region only changes the profile's country (and so the currency shown).
    // Nothing the user entered is replaced or converted.
    if (STATE.profile) {
      STATE.profile.country = regionCode;
      const res = await apiFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(STATE.profile)
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save region');
    }

    await loadProfile();
    await loadTransactions();
    await loadGoals();
    await loadPeerBenchmarks();
    await loadDiagnostics();

    renderAll();
    if (window.settleNumbers) window.settleNumbers();

    const hiddenTxns = (STATE.allTransactions || []).length - STATE.transactions.length;
    const hiddenGoals = (STATE.allGoals || []).length - STATE.goals.length;
    if (hiddenTxns > 0 || hiddenGoals > 0) {
      showToast(`${hiddenTxns} expense(s) and ${hiddenGoals} goal(s) in other currencies are kept and hidden until you switch back.`);
    }

    // Amounts are not converted automatically, so ask the user to enter them in the new currency.
    openRegionUpdatePrompt(reg);
  } catch (err) {
    console.error('Failed to switch region:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

// After a region switch, reuse the profile dialog to collect college and amounts in the new currency.
function openRegionUpdatePrompt(reg) {
  openProfileModal(false);

  const titleEl = document.getElementById('ob-modal-title');
  const subEl = document.getElementById('ob-modal-sub');
  const submitBtn = document.getElementById('ob-submit-btn');
  if (titleEl) titleEl.textContent = `Update your details for ${reg.name}`;
  if (subEl) {
    subEl.textContent = `You switched to ${reg.currency} (${reg.symbol}). Amounts are not converted automatically, so enter your tuition, allowance and aid in ${reg.symbol}. We pre-filled typical values for ${reg.name}; adjust them to your own. Cancel to keep what you had.`;
  }
  if (submitBtn) submitBtn.textContent = 'Save Details';

  // The old amounts are in the previous currency, so start from this region's typical values.
  const tuitionInp = document.getElementById('ob-tuition');
  const incomeInp = document.getElementById('ob-income');
  const aidInp = document.getElementById('ob-aid');
  if (tuitionInp) tuitionInp.value = reg.sampleTuition;
  if (incomeInp) incomeInp.value = reg.sampleIncome;
  if (aidInp) aidInp.value = reg.sampleAid;
  setTuitionPeriod('annual');

  // If the saved college is in another country, preselect the first one in this region.
  const current = STATE.colleges.find(c => c.name === (STATE.profile && STATE.profile.college));
  if (!current || current.country !== reg.code) {
    const first = STATE.colleges.find(c => c.country === reg.code);
    const collegeSel = document.getElementById('ob-college');
    if (first && collegeSel) {
      collegeSel.value = first.name;
      handleCollegeChange(first.name);
    }
  }
}

async function resetGoalsToRegion() {
  const code = STATE.currentRegion ? STATE.currentRegion.code : 'US';
  const regionName = (STATE.currentRegion && STATE.currentRegion.name) || code;
  if (!confirm(`Replace your ${regionName} savings goals with the sample defaults? Your current ${STATE.currencyCode} goals will be lost.`)) return;
  try {
    await apiFetch('/api/goals/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: code })
    });
    await loadGoals();
    renderGoals();
    showToast(`Reset savings milestones to ${STATE.currentRegion.name} defaults!`);
  } catch (err) {
    console.error('Failed to reset goals:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

async function loadCategories() {
  try {
    const res = await apiFetch('/api/categories');
    const data = await res.json();
    STATE.categories = data;

    CAT_COLORS = { ...BASE_CAT_COLORS };
    CAT_NAMES = { ...BASE_CAT_NAMES };

    if (data.custom && Array.isArray(data.custom)) {
      data.custom.forEach(c => {
        CAT_COLORS[c.id] = c.color || '#0284C7';
        CAT_NAMES[c.id] = c.name;
      });
    }
    refreshCategorySelects();
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

async function loadMetadata() {
  try {
    const res = await apiFetch('/api/meta');
    STATE.meta = await res.json();
    if (STATE.meta.colleges) STATE.colleges = STATE.meta.colleges;
    if (STATE.meta.cities) STATE.cities = STATE.meta.cities;
    if (STATE.meta.regions) STATE.regions = STATE.meta.regions;
    populateMetaDropdowns();
  } catch (err) {
    console.error('Failed to load metadata:', err);
  }
}

async function loadProfile() {
  try {
    const res = await apiFetch('/api/profile');
    const data = await res.json();
    if (data.exists && data.profile && data.profile.college) {
      STATE.profile = data.profile;
      STATE.predictedBudget = data.predicted_budget || 0;
      STATE.monthlyTuition = data.monthly_tuition_amortized || 0;
      STATE.grossInflow = data.gross_inflow || 0;
      STATE.netInflow = data.net_inflow || 0;
      STATE.affordabilityCap = data.affordability_cap || 0;
      STATE.coliFactor = data.coli_factor || 1.0;

      const regCode = (data.region && data.region.code) || (data.profile && data.profile.country) || 'US';
      setRegion(regCode);
      updateSidebarProfile();
      if (PENNY_HARD_RESET) openProfileModal(true, true);
    } else {
      setRegion('US');
      openProfileModal(true);
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

async function loadTransactions() {
  try {
    const res = await apiFetch('/api/transactions');
    STATE.allTransactions = await res.json();
    STATE.transactions = STATE.allTransactions.filter(matchesActiveCurrency);
    await loadInsights();
  } catch (err) {
    console.error('Failed to load transactions:', err);
  }
}

async function loadGoals() {
  try {
    const res = await apiFetch('/api/goals');
    STATE.allGoals = await res.json();
    STATE.goals = STATE.allGoals.filter(matchesActiveCurrency);
    await loadInsights();
  } catch (err) {
    console.error('Failed to load goals:', err);
  }
}

// Personalised budget, forecast, unusual spending and recurring bills (from the ML service).
async function loadInsights() {
  try {
    const res = await fetch('/api/insights');
    STATE.insights = await res.json();
  } catch (err) {
    STATE.insights = { available: false, reason: 'Could not reach the server.' };
  }
}

// The budget shown everywhere: learned from your own history when available, else the formula estimate.
function effectiveBudget() {
  const ins = STATE.insights;
  if (ins && ins.available && ins.budget && ins.budget.recommended > 0) return ins.budget.recommended;
  return STATE.predictedBudget;
}

async function loadPeerBenchmarks() {
  try {
    const res = await apiFetch('/api/peer-benchmarks');
    STATE.benchmarks = await res.json();
  } catch (err) {
    console.error('Failed to load peer benchmarks:', err);
  }
}

async function loadDiagnostics() {
  try {
    const res = await apiFetch('/api/diagnostics');
    STATE.diagnostics = await res.json();
  } catch (err) {
    console.error('Failed to load diagnostics:', err);
  }
}

function switchView(viewName, btn) {
  STATE.activeView = viewName;
  
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const matching = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (matching) matching.classList.add('active');
  }

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.style.display = 'none';
  });
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.style.display = 'block';
  }

  if (viewName === 'overview') renderOverview();
  else if (viewName === 'expenses') renderExpenses();
  else if (viewName === 'goals') renderGoals();
  else if (viewName === 'analytics') renderAnalytics();
  else if (viewName === 'studio') renderStudio();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  updateSidebarProfile();
  renderOverview();
  renderExpenses();
  renderGoals();
  renderAnalytics();
  renderStudio();
}

function updateSidebarProfile() {
  if (!STATE.profile) return;
  const p = STATE.profile;

  const initials = p.name ? p.name.split(' ').map(n => n[0].toUpperCase()).slice(0, 2).join('') : 'ST';
  const avatarEl = document.getElementById('rail-avatar');
  const nameEl = document.getElementById('rail-name');
  const majorEl = document.getElementById('rail-major');
  const collegeEl = document.getElementById('rail-college-name');
  const incomeEl = document.getElementById('rail-income');
  const tuitionEl = document.getElementById('rail-tuition');
  const netInflowEl = document.getElementById('rail-net-inflow');
  const cityEl = document.getElementById('rail-city');
  const budgetEl = document.getElementById('rail-budget');
  const budgetSubEl = document.getElementById('rail-budget-sub');
  const copilotEl = document.getElementById('rail-copilot-text');

  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = p.name || 'Student Scholar';
  if (majorEl) majorEl.textContent = `${p.year_in_school || 'Freshman'} · ${p.major || 'Undergrad'}`;
  if (collegeEl) collegeEl.textContent = p.college || 'Campus Unset';
  
  const grossInflow = parseFloat(p.monthly_income || 0) + parseFloat(p.financial_aid || 0);
  if (incomeEl) incomeEl.textContent = `${formatCurrency(grossInflow)}/mo`;
  
  const monthlyTuition = p.tuition_period === 'semester' 
    ? Math.round(parseFloat(p.tuition_amount || 0) / 6)
    : Math.round(parseFloat(p.tuition_amount || 0) / 12);
  if (tuitionEl) tuitionEl.textContent = `${formatCurrency(monthlyTuition)}/mo`;
  
  const netInflow = Math.max(grossInflow - monthlyTuition, 0);
  if (netInflowEl) netInflowEl.textContent = `${formatCurrency(netInflow)}/mo`;
  
  if (cityEl) cityEl.textContent = p.campus_city || 'Campus City';
  if (budgetEl) budgetEl.textContent = formatCurrency(parseFloat(effectiveBudget() || 0));
  
  if (budgetSubEl) {
    budgetSubEl.textContent = `Estimated for ${p.campus_city || 'City'} based on local costs.`;
  }

  if (copilotEl) {
    copilotEl.textContent = `Studying at ${p.college || 'College'} in ${p.campus_city || 'City'}. With ${formatCurrency(monthlyTuition)}/mo in tuition, your suggested monthly living budget leaves a 15% cushion for unexpected costs.`;
  }
}

function renderOverview() {
  const budget = effectiveBudget();
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let spentThisMonth = 0;
  let totalAllTime = 0;
  const categoryTotals = {};

  STATE.transactions.forEach(t => {
    const amt = parseFloat(t.amount || 0);
    totalAllTime += amt;
    if (t.date && t.date.startsWith(currentMonthKey)) {
      spentThisMonth += amt;
      const cat = t.category || 'miscellaneous';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
    }
  });

  const runway = budget - spentThisMonth;
  const pctUsed = Math.min((spentThisMonth / Math.max(budget, 1)) * 100, 100);

  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(lastDay - now.getDate(), 1);
  const velocity = Math.max(Math.round(runway / daysLeft), 0);

  const kpiBudget = document.getElementById('kpi-budget');
  const kpiTuition = document.getElementById('kpi-tuition');
  const kpiTuitionAnnual = document.getElementById('kpi-tuition-annual');
  const kpiSpent = document.getElementById('kpi-spent');
  const kpiCount = document.getElementById('kpi-count');
  const kpiTotalAll = document.getElementById('kpi-total-all');
  const kpiRunway = document.getElementById('kpi-runway');
  const kpiStatus = document.getElementById('kpi-status-pill');
  const kpiDays = document.getElementById('kpi-days-left');
  const kpiVelocity = document.getElementById('kpi-velocity');

  if (kpiBudget) kpiBudget.textContent = formatCurrency(budget);
  
  const annualTuition = STATE.profile
    ? (STATE.profile.tuition_period === 'semester' ? parseFloat(STATE.profile.tuition_amount || 0) * 2 : parseFloat(STATE.profile.tuition_amount || 0))
    : 0;
  const monthlyTuition = Math.round(annualTuition / 12);

  if (kpiTuition) kpiTuition.textContent = `${formatCurrency(monthlyTuition)}/mo`;
  if (kpiTuitionAnnual) kpiTuitionAnnual.textContent = `${formatCurrency(annualTuition)} Annual Commitment`;
  if (kpiSpent) kpiSpent.textContent = formatCurrency(spentThisMonth);
  if (kpiCount) kpiCount.textContent = `${STATE.transactions.length} items`;
  if (kpiTotalAll) kpiTotalAll.textContent = `${formatCurrency(totalAllTime)} Total Ledger`;
  if (kpiRunway) kpiRunway.textContent = formatCurrency(runway);
  if (kpiDays) kpiDays.textContent = `${daysLeft} days left`;
  if (kpiVelocity) kpiVelocity.textContent = `${formatCurrency(velocity)}/day allowable`;

  if (kpiStatus) {
    if (runway >= 0) {
      kpiStatus.className = 'pill pill-emerald';
      kpiStatus.textContent = 'On Track';
    } else {
      kpiStatus.className = 'pill pill-rose';
      kpiStatus.textContent = 'Over Budget';
    }
  }

  const gaugeBar = document.getElementById('runway-gauge-bar');
  const gaugePct = document.getElementById('gauge-pct');
  const gaugeBurnedLbl = document.getElementById('gauge-burned-lbl');
  const gaugeLimitLbl = document.getElementById('gauge-limit-lbl');
  if (gaugeBar) gaugeBar.style.width = `${pctUsed}%`;
  if (gaugePct) gaugePct.textContent = `${Math.round(pctUsed)}%`;
  if (gaugeBurnedLbl) gaugeBurnedLbl.textContent = `${formatCurrency(spentThisMonth)} Spent`;
  if (gaugeLimitLbl) gaugeLimitLbl.textContent = `Budget: ${formatCurrency(budget)}`;

  const contextBanner = document.getElementById('overview-context-banner');
  const contextSub = document.getElementById('overview-context-sub');
  if (contextBanner && STATE.profile) {
    const p = STATE.profile;
    contextBanner.textContent = `Set up for ${p.college || 'College'} in ${p.campus_city || 'City'}. Annual Tuition: ${formatCurrency(annualTuition)}.`;
  }
  if (contextSub && STATE.profile) {
    contextSub.textContent = `Monthly tuition comes to ${formatCurrency(monthlyTuition)}, leaving ${formatCurrency(STATE.netInflow)} for living expenses.`;
  }

  drawSpendingTrendChart();
  drawDonutChart(categoryTotals, spentThisMonth);
  renderBudgetNotes();
  renderInsights();
}

function renderBudgetNotes() {
  const sub = document.getElementById('kpi-budget-sub');
  const pill = document.getElementById('kpi-budget-pill');
  const ins = STATE.insights;
  if (!sub || !pill) return;
  if (ins && ins.available && ins.budget) {
    const n = ins.budget.history_months;
    if (n === 0) {
      pill.textContent = 'Estimate';
      sub.textContent = 'Cost-of-living estimate. It will adapt once you have a full month of expenses.';
    } else {
      pill.textContent = `Learned · ${n} mo`;
      sub.textContent = `Blended from the local estimate (${formatCurrency(ins.budget.prior)}) and ${n} month${n === 1 ? '' : 's'} of your own spending.`;
    }
  } else {
    pill.textContent = 'Estimate';
    sub.textContent = 'Cost-of-living estimate based on your allowance and local costs.';
  }
}

const RECURRING_STATUS = { paid: 'paid this month', upcoming: 'coming up', not_yet_seen: 'not seen yet this month' };

function renderInsights() {
  const fBody = document.getElementById('insights-forecast-body');
  const rel = document.getElementById('insights-reliability');
  const anomBox = document.getElementById('insights-anomalies');
  const recBox = document.getElementById('insights-recurring');
  if (!fBody) return;
  const ins = STATE.insights;
  if (!ins || !ins.available) {
    if (rel) { rel.className = 'pill pill-subtle'; rel.textContent = 'Unavailable'; }
    fBody.textContent = `Forecasts need the ML service. ${ins && ins.reason ? ins.reason : ''}`.trim();
    if (anomBox) anomBox.innerHTML = '';
    if (recBox) recBox.innerHTML = '';
    return;
  }
  const f = ins.forecast;
  const budget = effectiveBudget();
  const over = f.probability_over_budget;
  const overPct = over === null || over === undefined ? null : Math.round(over * 100);
  const relText = { low: 'Early estimate', medium: 'Moderate confidence', high: 'High confidence' }[f.reliability] || f.reliability;
  if (rel) { rel.className = `pill ${f.reliability === 'high' ? 'pill-emerald' : f.reliability === 'medium' ? 'pill-blue' : 'pill-orange'}`; rel.textContent = relText; }
  fBody.innerHTML = `
    <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
      <span class="kpi-num" style="font-size:28px; color:var(--text-main);">${formatCurrency(f.projected_total)}</span>
      <span style="font-size:12.5px;">expected by month end (likely ${formatCurrency(f.low_80)} – ${formatCurrency(f.high_80)})</span>
    </div>
    <div style="margin-top:8px; line-height:1.6;">
      Spent so far <b>${formatCurrency(f.spent_so_far)}</b> (day ${f.day} of ${f.days_in_month}) ·
      everyday pace <b>${formatCurrency(f.daily_rate_used)}/day</b>
      ${f.expected_recurring_remaining > 0 ? ` · recurring bills still due <b>${formatCurrency(f.expected_recurring_remaining)}</b>` : ''}
    </div>
    ${overPct !== null ? `<div style="margin-top:8px;">Chance of finishing over your ${formatCurrency(budget)} budget:
      <span class="pill ${overPct >= 60 ? 'pill-orange' : overPct >= 25 ? 'pill-blue' : 'pill-emerald'}">${overPct}%</span></div>` : ''}
    <div style="margin-top:8px; font-size:11.5px;">Pace is based on ${escapeHtml(f.rate_source)}. ${escapeHtml(ins.data.note)}</div>`;

  if (anomBox) {
    anomBox.innerHTML = ins.anomalies.length
      ? ins.anomalies.map(a => `<div style="padding:8px 10px; background:var(--warn-bg); border:1px solid var(--warn-border); border-radius:8px; margin-bottom:6px; font-size:12.5px;">
          <b>${escapeHtml(a.description)}</b> · ${formatCurrency(a.amount)} <span style="color:var(--warn-text);">(${escapeHtml(a.reason)})</span></div>`).join('')
      : '<div style="font-size:12.5px; color:var(--text-muted);">No unusually large expenses recently.</div>';
  }
  if (recBox) {
    recBox.innerHTML = ins.recurring.length
      ? '<div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">Recurring bills detected</div>' +
        ins.recurring.slice(0, 5).map(r => `<div style="display:flex; justify-content:space-between; gap:10px; font-size:12.5px; padding:4px 0;">
          <span>${escapeHtml(r.merchant)} <span style="color:var(--text-muted);">· around the ${r.typical_day}${ordinalSuffix(r.typical_day)}</span></span>
          <span><b>${formatCurrency(r.typical_amount)}</b> <span style="color:var(--text-muted);">${escapeHtml(RECURRING_STATUS[r.status] || r.status)}</span></span></div>`).join('')
      : '<div style="font-size:12.5px; color:var(--text-muted);">No recurring bills detected yet. They appear after the same bill shows up in 2+ months.</div>';
  }
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
}

function drawSpendingTrendChart() {
  const svg = document.getElementById('svg-trend-chart');
  if (!svg) return;
  svg.innerHTML = '';

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = now.getDate();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const dailySpend = new Array(daysInMonth + 1).fill(0);
  STATE.transactions.forEach(t => {
    if (t.date && t.date.startsWith(currentMonthKey)) {
      const day = parseInt(t.date.split('-')[2], 10);
      if (day >= 1 && day <= daysInMonth) {
        dailySpend[day] += parseFloat(t.amount || 0);
      }
    }
  });

  const cumulative = new Array(daysInMonth + 1).fill(0);
  for (let d = 1; d <= daysInMonth; d++) {
    cumulative[d] = cumulative[d - 1] + dailySpend[d];
  }

  const budget = Math.max(effectiveBudget(), 100);
  const maxVal = Math.max(budget * 1.15, cumulative[currentDay] * 1.2, 100);

  const width = svg.clientWidth || 540;
  const height = 210;
  const padLeft = 50;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const getX = day => padLeft + ((day - 1) / (daysInMonth - 1)) * chartW;
  const getY = val => padTop + chartH - (val / maxVal) * chartH;

  for (let i = 0; i <= 4; i++) {
    const val = (maxVal / 4) * i;
    const y = getY(val);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width - padRight);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'var(--bg-subtle)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 6);
    txt.setAttribute('y', y + 3);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('font-size', '9.5');
    txt.setAttribute('fill', 'var(--text-dim)');
    txt.textContent = formatCurrency(val, { compact: true });
    svg.appendChild(txt);
  }

  const budgetY = getY(budget);
  const bLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  bLine.setAttribute('x1', padLeft);
  bLine.setAttribute('y1', budgetY);
  bLine.setAttribute('x2', width - padRight);
  bLine.setAttribute('y2', budgetY);
  bLine.setAttribute('stroke', '#0284C7');
  bLine.setAttribute('stroke-width', '1.5');
  bLine.setAttribute('stroke-dasharray', '4 4');
  svg.appendChild(bLine);

  let areaD = `M ${getX(1)} ${getY(0)}`;
  for (let d = 1; d <= currentDay; d++) {
    areaD += ` L ${getX(d)} ${getY(cumulative[d])}`;
  }
  areaD += ` L ${getX(currentDay)} ${getY(0)} Z`;

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', areaD);
  area.setAttribute('fill', 'url(#trend-gradient)');
  area.setAttribute('class', 'chart-area');
  svg.appendChild(area);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0284C7" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#0284C7" stop-opacity="0.0"/>
    </linearGradient>
  `;
  svg.appendChild(defs);

  let lineD = `M ${getX(1)} ${getY(cumulative[1])}`;
  for (let d = 2; d <= currentDay; d++) {
    lineD += ` L ${getX(d)} ${getY(cumulative[d])}`;
  }
  const sLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  sLine.setAttribute('d', lineD);
  sLine.setAttribute('fill', 'none');
  sLine.setAttribute('stroke', '#0284C7');
  sLine.setAttribute('stroke-width', '2.5');
  sLine.setAttribute('stroke-linecap', 'round');
  sLine.setAttribute('pathLength', '1');
  sLine.setAttribute('class', 'chart-line');
  svg.appendChild(sLine);

  const curX = getX(currentDay);
  const curY = getY(cumulative[currentDay]);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', curX);
  dot.setAttribute('cy', curY);
  dot.setAttribute('r', '4.5');
  dot.setAttribute('fill', '#0284C7');
  dot.setAttribute('stroke', 'var(--bg-surface)');
  dot.setAttribute('class', 'chart-dot');
  dot.setAttribute('stroke-width', '2');
  svg.appendChild(dot);
}

function drawDonutChart(totals, totalSpent) {
  const svg = document.getElementById('svg-donut-chart');
  const centerTotal = document.getElementById('donut-center-total');
  const legendList = document.getElementById('donut-legend-list');
  if (!svg) return;
  svg.innerHTML = '';
  if (legendList) legendList.innerHTML = '';

  if (centerTotal) centerTotal.textContent = formatCurrency(totalSpent);

  const radius = 62;
  const cx = 80;
  const cy = 80;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;

  const entries = Object.entries(totals).filter(([_, val]) => val > 0);

  if (!entries.length || totalSpent <= 0) {
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', cx);
    bgCircle.setAttribute('cy', cy);
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'var(--border-subtle)');
    bgCircle.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(bgCircle);
    if (legendList) {
      legendList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">No outlays recorded this month</div>';
    }
    return;
  }

  let accumulatedPct = 0;

  entries.sort((a, b) => b[1] - a[1]);

  let donutIdx = 0;
  entries.forEach(([cat, amt]) => {
    const pct = amt / totalSpent;
    const dashLength = pct * circumference;
    const dashOffset = -(accumulatedPct * circumference);
    const color = CAT_COLORS[cat] || '#64748B';
    const name = CAT_NAMES[cat] || cat;

    const segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    segment.setAttribute('cx', cx);
    segment.setAttribute('cy', cy);
    segment.setAttribute('r', radius);
    segment.setAttribute('fill', 'none');
    segment.setAttribute('stroke', color);
    segment.setAttribute('stroke-width', strokeWidth);
    segment.setAttribute('stroke-dasharray', `${dashLength} ${circumference}`);
    segment.setAttribute('stroke-dashoffset', dashOffset);
    segment.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    segment.setAttribute('class', 'donut-seg');
    segment.style.animationDelay = `${0.08 * donutIdx++}s`;
    segment.innerHTML = `<title>${escapeHtml(name)}: ${formatCurrency(amt)} (${Math.round(pct * 100)}%)</title>`;
    svg.appendChild(segment);

    accumulatedPct += pct;

    if (legendList) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.fontSize = '12px';
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="cat-dot" style="background:${escapeHtml(color)};"></span>
          <span style="font-weight:600; color:var(--text-main);">${escapeHtml(name)}</span>
        </div>
        <span style="font-weight:700; color:var(--text-muted);">
          ${formatCurrency(amt)} (${Math.round(pct * 100)}%)
        </span>
      `;
      legendList.appendChild(row);
    }
  });
}

function renderExpenses() {
  const tbody = document.getElementById('ledger-tbody');
  const chipContainer = document.getElementById('ledger-filter-chips');
  if (!tbody) return;

  if (chipContainer && chipContainer.children.length <= 1) {
    const activeCats = [...new Set(STATE.transactions.map(t => t.category).filter(Boolean))];
    activeCats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = CAT_NAMES[cat] || cat;
      btn.onclick = () => filterLedger(cat, btn);
      chipContainer.appendChild(btn);
    });
  }

  tbody.innerHTML = '';

  const filter = STATE.activeFilter;
  const filtered = filter === 'all' 
    ? STATE.transactions 
    : STATE.transactions.filter(t => t.category === filter);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--text-muted);">No transactions found in this view.</td></tr>';
    return;
  }

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    const catName = CAT_NAMES[t.category] || t.category || 'Miscellaneous';
    const color = CAT_COLORS[t.category] || '#64748B';
    const badge = predictionBadge(t);

    tr.innerHTML = `
      <td style="padding-left:20px;">
        <div style="font-weight:600; color:var(--text-main);">${escapeHtml(t.description || 'Expense')}</div>
      </td>
      <td>
        <span class="cat-badge" style="background:${escapeHtml(color)}18; color:${escapeHtml(color)};">
          <span class="cat-dot" style="background:${escapeHtml(color)};"></span>
          <span>${escapeHtml(catName)}</span>
        </span>
      </td>
      <td style="color:var(--text-muted); font-size:12.5px;">${escapeHtml(t.date || '—')}</td>
      <td>
        <span class="pill ${badge.cls}" title="${escapeHtml(badge.title)}">${escapeHtml(badge.text)}</span>
      </td>
      <td class="amt" style="color:var(--text-main);">${formatCurrency(t.amount || 0)}</td>
      <td style="text-align:center; padding-right:20px;">
        <div style="display:flex; justify-content:center; gap:6px;">
          <button class="btn-secondary" style="padding:4px 8px; font-size:11px;" data-action="teach" data-id="${escapeHtml(t.id)}">Teach</button>
          <button class="btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--rose);" data-action="delete" data-id="${escapeHtml(t.id)}" aria-label="Delete expense">&times;</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterLedger(cat, btn) {
  STATE.activeFilter = cat;
  document.querySelectorAll('#ledger-filter-chips .chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderExpenses();
}


// --- Category pickers for the add-expense forms --------------------------------------------
// First option is always "Auto-detect" (the default). Then every category, then "Add new category".
const CATEGORY_SELECTS = { 'inline-cat-select': 'inline-cat-conf', 'qm-cat-select': 'qm-cat-conf' };
const autoDetected = {};

function populateCategorySelect(selId, keepValue) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const prev = keepValue === undefined ? sel.value : keepValue;
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  const guess = autoDetected[selId];
  auto.textContent = guess ? `Auto-detect: ${CAT_NAMES[guess] || guess}` : 'Auto-detect from description';
  sel.appendChild(auto);
  Object.keys(CAT_NAMES).forEach(id => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = CAT_NAMES[id];
    sel.appendChild(o);
  });
  const add = document.createElement('option');
  add.value = '__new__';
  add.textContent = '+ Add new category…';
  sel.appendChild(add);
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : '';
  syncCategoryPill(selId);
}

function refreshCategorySelects() {
  Object.keys(CATEGORY_SELECTS).forEach(id => populateCategorySelect(id));
}

function syncCategoryPill(selId) {
  const sel = document.getElementById(selId);
  const pill = document.getElementById(CATEGORY_SELECTS[selId]);
  if (!sel || !pill) return;
  if (sel.value) { pill.className = 'pill pill-blue'; pill.textContent = 'Your choice'; }
  else if (!autoDetected[selId]) { pill.className = 'pill pill-subtle'; pill.textContent = '—'; }
}

let categorySelectToRestore = null;
function onCategorySelectChange(sel) {
  if (sel.value === '__new__') {
    categorySelectToRestore = sel.id;
    sel.value = '';
    openCategoryModal();
    return;
  }
  syncCategoryPill(sel.id);
}

// Called by the predictors: remember the guess and show it as the "Auto-detect" option.
function noteAutoDetected(selId, data) {
  autoDetected[selId] = data.category;
  populateCategorySelect(selId);
  const sel = document.getElementById(selId);
  if (!sel.value) setPredictionPill(document.getElementById(CATEGORY_SELECTS[selId]), data);
}

async function handleInlineSubmit(e) {
  e.preventDefault();
  const desc = document.getElementById('inline-desc').value.trim();
  const amt = parseFloat(document.getElementById('inline-amt').value);
  const date = document.getElementById('inline-date').value;
  const chosen = document.getElementById('inline-cat-select').value;

  if (!desc || isNaN(amt) || amt <= 0) return;

  try {
    const res = await apiFetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, amount: amt, date, ...(chosen ? { category: chosen } : {}) })
    });
    await res.json();

    document.getElementById('inline-desc').value = '';
    document.getElementById('inline-amt').value = '';
    delete autoDetected['inline-cat-select'];
    populateCategorySelect('inline-cat-select', '');
    await loadTransactions();
    renderAll();
    showToast(`Recorded ${formatCurrency(amt)} for ${desc}`);
  } catch (err) {
    console.error('Failed to log transaction:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

let predictTimer = null;
function handleInlinePredict(text) {
  clearTimeout(predictTimer);
  predictTimer = setTimeout(async () => {
    if (!text.trim()) return;
    try {
      const res = await apiFetch('/api/nlp/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      noteAutoDetected('inline-cat-select', data);
    } catch {}
  }, 140);
}

async function deleteExpense(id) {
  try {
    await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
    await loadTransactions();
    renderAll();
    showToast('Expense deleted.');
  } catch (err) {
    console.error('Failed to delete expense:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

// --- Teach / correct a category (dialog) -----------------------------------------------------
let teachTargetId = null;

function openTeachModal(id) {
  const t = STATE.transactions.find(x => x.id === id);
  if (!t) return;
  teachTargetId = id;
  document.getElementById('teach-desc').textContent = t.description || '';
  document.getElementById('teach-current').textContent = CAT_NAMES[t.category] || t.category;
  setPredictionPill(document.getElementById('teach-conf'), t);

  const sel = document.getElementById('teach-cat');
  sel.innerHTML = '';
  Object.keys(CAT_NAMES).forEach(id2 => {
    const opt = document.createElement('option');
    opt.value = id2;
    opt.textContent = CAT_NAMES[id2];
    sel.appendChild(opt);
  });
  sel.value = t.category;
  document.getElementById('teach-remember').checked = true;

  const backdrop = document.getElementById('teach-modal-backdrop');
  const dialog = document.getElementById('teach-modal');
  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    backdrop.style.opacity = '1';
    dialog.style.opacity = '1';
    dialog.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
}

function closeTeachModal() {
  const backdrop = document.getElementById('teach-modal-backdrop');
  const dialog = document.getElementById('teach-modal');
  backdrop.style.opacity = '0';
  dialog.style.opacity = '0';
  dialog.style.transform = 'translate(-50%, -46%) scale(0.96)';
  document.body.style.overflow = '';
  setTimeout(() => { backdrop.style.display = 'none'; dialog.style.display = 'none'; }, 220);
}

async function handleTeachSubmit(e) {
  e.preventDefault();
  const t = STATE.transactions.find(x => x.id === teachTargetId);
  if (!t) return closeTeachModal();
  const category = document.getElementById('teach-cat').value;
  const remember = document.getElementById('teach-remember').checked;
  try {
    // 1. Fix this expense now.
    await apiFetch(`/api/transactions/${teachTargetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category })
    });
    // 2. Optionally teach the AI so similar descriptions are labelled correctly next time.
    let learned = null;
    if (remember) {
      const res = await apiFetch('/api/nlp/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t.description, category })
      });
      learned = await res.json();
    }
    closeTeachModal();
    await loadTransactions();
    await loadDiagnostics();
    renderAll();
    showToast(remember
      ? `Updated, and the ${learned && learned.ml_updated ? 'AI model has learned' : 'rule was saved'}: "${t.description}" → ${CAT_NAMES[category] || category}`
      : `Category changed to ${CAT_NAMES[category] || category}.`);
  } catch (err) {
    console.error('Failed to save correction:', err);
    showToast(err.message || 'Could not save the correction.');
  }
}

function renderGoals() {
  const grid = document.getElementById('goals-card-grid');
  if (!grid) return;
  grid.innerHTML = '';

  let totalTarget = 0;
  let totalSaved = 0;
  STATE.goals.forEach(g => {
    totalTarget += parseFloat(g.target_amount || 0);
    totalSaved += parseFloat(g.saved_amount || 0);
  });

  const totalPct = totalTarget > 0 ? Math.min(Math.round((totalSaved / totalTarget) * 100), 100) : 0;
  const totalRemaining = Math.max(totalTarget - totalSaved, 0);

  const totalSavedEl = document.getElementById('goals-total-saved');
  const totalTargetEl = document.getElementById('goals-total-target');
  const totalPctEl = document.getElementById('goals-total-pct');
  const totalRemEl = document.getElementById('goals-total-remaining');
  const countBadge = document.getElementById('goals-total-count-badge');
  const heroBar = document.getElementById('goals-portfolio-progress-bar');

  if (totalSavedEl) totalSavedEl.textContent = formatCurrency(totalSaved);
  if (totalTargetEl) totalTargetEl.textContent = formatCurrency(totalTarget);
  if (totalPctEl) totalPctEl.textContent = `(${totalPct}% Funded)`;
  if (totalRemEl) totalRemEl.textContent = `${formatCurrency(totalRemaining)} Needed`;
  if (countBadge) countBadge.textContent = `${STATE.goals.length} Active Targets`;
  if (heroBar) heroBar.style.width = `${totalPct}%`;

  if (!STATE.goals.length) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:32px; color:var(--text-muted);">No savings milestones registered. Click "New Target" or "Reset to Region Defaults".</div>';
    updateSimulation(STATE.simCutPct);
    return;
  }

  const reg = STATE.currentRegion || { quickDeposits: [25, 50, 100], stepAmt: 5, symbol: '$' };
  const quickAmts = reg.quickDeposits || [25, 50, 100];

  STATE.goals.forEach(g => {
    const target = parseFloat(g.target_amount || 1);
    const saved = parseFloat(g.saved_amount || 0);
    const remaining = Math.max(target - saved, 0);
    const pct = Math.min(Math.round((saved / target) * 100), 100);

    const deadlineDate = new Date(g.deadline);
    const today = new Date();
    const diffDays = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));

    let barGradient = 'linear-gradient(90deg, #F97316 0%, #FB923C 100%)';
    if (pct >= 100) {
      barGradient = 'linear-gradient(90deg, #10B981 0%, #059669 100%)';
    } else if (pct >= 50) {
      barGradient = 'linear-gradient(90deg, #0284C7 0%, #38BDF8 100%)';
    }

    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span class="pill pill-blue">${escapeHtml(g.priority || 'Medium')} Priority</span>
          <div style="font-size:16px; font-weight:800; color:var(--text-main); margin-top:4px;">${escapeHtml(g.name)}</div>
        </div>
        <button class="btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--rose);" onclick="deleteGoal(${g.id})">&times;</button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:2px;">
        <span style="font-size:22px; font-weight:800; color:var(--blue-deep);">${formatCurrency(saved)}</span>
        <span style="font-size:12px; color:var(--text-muted); font-weight:600;">Target: ${formatCurrency(target)}</span>
      </div>

      <!-- High-Visibility Enhanced Progress Bar -->
      <div class="goal-track-enhanced">
        <div class="goal-fill-enhanced" style="width:${pct}%; background:${barGradient};"></div>
      </div>

      <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700;">
        <span style="color:var(--blue-deep);">${pct}% Funded</span>
        <span style="color:var(--text-muted); font-weight:600;">${diffDays > 0 ? `${diffDays} days left · ${formatCurrency(remaining)} to go` : (remaining === 0 ? 'Fully Funded!' : `${formatCurrency(remaining)} to go`)}</span>
      </div>

      <div style="display:flex; gap:6px; margin-top:4px;">
        <button class="btn-secondary" style="flex:1; justify-content:center; font-size:11.5px; font-weight:600;" onclick="depositGoal(${g.id}, ${quickAmts[0]})">+${formatCurrency(quickAmts[0])}</button>
        <button class="btn-secondary" style="flex:1; justify-content:center; font-size:11.5px; font-weight:600;" onclick="depositGoal(${g.id}, ${quickAmts[1]})">+${formatCurrency(quickAmts[1])}</button>
        <button class="btn-primary" style="flex:1.2; justify-content:center; font-size:11.5px; font-weight:700;" onclick="depositGoal(${g.id}, ${quickAmts[2]})">+${formatCurrency(quickAmts[2])}</button>
      </div>

      <div style="display:flex; gap:6px; margin-top:8px; align-items:center; padding-top:8px; border-top:1px solid var(--bg-subtle);">
        <div style="position:relative; flex:1;">
          <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:11px; font-weight:700; color:var(--text-muted);">${STATE.currencySymbol}</span>
          <input type="number" id="custom-dep-${g.id}" class="form-input" style="padding:4px 8px 4px 20px; font-size:11.5px; height:28px;" placeholder="Custom amount" min="0.01" step="any" onkeydown="if(event.key==='Enter'){handleCustomDeposit(${g.id});}">
        </div>
        <button class="btn-secondary" style="padding:4px 10px; font-size:11px; height:28px; font-weight:700;" onclick="handleCustomDeposit(${g.id})">Deposit</button>
      </div>
    `;
    grid.appendChild(card);
  });

  updateSimulation(STATE.simCutPct);
}

async function handleCustomDeposit(id) {
  const input = document.getElementById(`custom-dep-${id}`);
  if (!input) return;
  const amt = parseFloat(input.value);
  if (!amt || amt <= 0 || isNaN(amt)) {
    showToast('Enter a valid custom deposit amount.');
    return;
  }
  await depositGoal(id, amt);
  input.value = '';
}

async function depositGoal(id, amount) {
  try {
    await apiFetch(`/api/goals/${id}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    await loadGoals();
    renderGoals();
    showToast(`Added ${formatCurrency(amount)} to milestone reserve!`);
  } catch (err) {
    console.error('Failed to deposit to goal:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

async function deleteGoal(id) {
  try {
    await apiFetch(`/api/goals/${id}`, { method: 'DELETE' });
    await loadGoals();
    renderGoals();
    showToast('Milestone target removed.');
  } catch (err) {
    console.error('Failed to delete goal:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

function updateSimulation(pctVal) {
  STATE.simCutPct = parseInt(pctVal, 10);
  const lbl = document.getElementById('sim-pct-lbl');
  if (lbl) lbl.textContent = `${STATE.simCutPct}% Spend Reduction`;

  // Monthly spend on discretionary categories: your average over complete months when we have them,
  // otherwise this month's pace. (Never all-time totals mistaken for a month.)
  const ins = STATE.insights && STATE.insights.available ? STATE.insights : null;
  let discSpend;
  let basis;
  if (ins) {
    discSpend = ins.discretionary.avg_monthly;
    basis = ins.discretionary.basis;
  } else {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const mtd = STATE.transactions
      .filter(t => t.date && t.date.startsWith(key) && ['food', 'entertainment', 'shopping'].includes(t.category))
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    discSpend = mtd / Math.max(now.getDate(), 1) * daysInMonth;
    basis = "this month's pace";
  }
  const monthlySavings = Math.round(discSpend * (STATE.simCutPct / 100));
  const annualSavings = monthlySavings * 12;

  // How long would those savings take to fully fund the most urgent unfinished goal?
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  const open = STATE.goals
    .filter(g => parseFloat(g.saved_amount) < parseFloat(g.target_amount))
    .sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) || String(a.deadline).localeCompare(String(b.deadline)));
  const goal = open[0];
  let goalText = '—';
  let goalLabel = 'Fund Top Goal In';
  if (goal && monthlySavings > 0) {
    const remaining = parseFloat(goal.target_amount) - parseFloat(goal.saved_amount);
    const months = remaining / monthlySavings;
    goalText = months < 1 ? 'under a month' : `${months.toFixed(1)} months`;
    goalLabel = `Fund "${goal.name}" In`;
  } else if (!goal) {
    goalText = 'No open goals';
  }

  const outSaved = document.getElementById('sim-monthly-saved');
  const outDays = document.getElementById('sim-days-faster');
  const outLabel = document.getElementById('sim-goal-label');
  const outAnnual = document.getElementById('sim-annual-reserve');
  const outBasis = document.getElementById('sim-basis');
  if (outSaved) outSaved.textContent = `${formatCurrency(monthlySavings)}/mo`;
  if (outDays) outDays.textContent = goalText;
  if (outLabel) outLabel.textContent = goalLabel;
  if (outAnnual) outAnnual.textContent = `+${formatCurrency(annualSavings)} / year`;
  if (outBasis) {
    outBasis.textContent = `Based on about ${formatCurrency(discSpend)}/month spent on food, entertainment and shopping (${basis}), if all savings went to that goal.`;
  }
}

function renderAnalytics() {
  if (!STATE.benchmarks) return;
  const b = STATE.benchmarks;

  const locPill = document.getElementById('peer-location-pill');
  const scopeEl = document.getElementById('peer-cohort-scope');
  const sampleEl = document.getElementById('peer-sample-size');
  const userTuitionEl = document.getElementById('peer-user-tuition');
  const avgTuitionEl = document.getElementById('peer-avg-tuition');
  const grid = document.getElementById('peer-benchmark-cards');
  const insightEl = document.getElementById('peer-location-insight');

  const peerNote = document.getElementById('peer-illustrative-note');
  if (peerNote && b.illustrative) {
    const q = STATE.insights && STATE.insights.available ? STATE.insights.peer_data_quality : null;
    peerNote.innerHTML = `<b>Illustrative only.</b> These averages come from a bundled sample dataset of ${b.cohort_size} students (converted by approximate purchasing-power parity), not from real students at your college.` +
      (q && q.verdict ? ` Data check: ${escapeHtml(q.verdict)}` : '');
  }
  if (locPill) locPill.textContent = `${b.campus_city} (${b.coli_factor}x Cost Index)`;
  if (scopeEl) scopeEl.textContent = `${b.scope} at ${b.college}`;
  if (sampleEl) sampleEl.textContent = `Compared with ${b.cohort_size} students in similar degree programs.`;
  if (userTuitionEl) userTuitionEl.textContent = formatCurrency(b.user_tuition_annual || 0);
  if (avgTuitionEl) avgTuitionEl.textContent = formatCurrency(b.peer_tuition_annual_avg || 0);

  if (insightEl) {
    const estimatedDining = Math.round((STATE.currentRegion.baseSubsistence || 1200) * 0.3 * b.coli_factor);
    insightEl.textContent = `Living near ${b.college} in ${b.campus_city} reflects local pricing (${b.coli_factor}x baseline). Students here spend about ${formatCurrency(estimatedDining)}/month on food, groceries, and dining out.`;
  }

  drawPeerBarChart();

  if (grid && b.benchmarks) {
    grid.innerHTML = '';
    b.benchmarks.forEach(item => {
      const card = document.createElement('div');
      card.className = 'lumi-box';
      const catName = CAT_NAMES[item.category] || item.category;
      const color = CAT_COLORS[item.category] || '#0284C7';

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="cat-dot" style="background:${escapeHtml(color)};"></span>
            <span style="font-weight:700; font-size:13.5px;">${escapeHtml(catName)}</span>
          </div>
          <span class="pill pill-blue">${item.location_multiplier}x Local Index</span>
        </div>
        <div class="kpi-num" style="font-size:22px; color:var(--text-main);">${formatCurrency(item.peer_avg)}/mo</div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
          National Average: ${formatCurrency(item.raw_avg)}/mo
        </div>
      `;
      grid.appendChild(card);
    });
  }
}

function drawPeerBarChart() {
  const svg = document.getElementById('svg-peer-barchart');
  if (!svg || !STATE.benchmarks || !STATE.benchmarks.benchmarks) return;
  svg.innerHTML = '';

  const benchmarks = STATE.benchmarks.benchmarks;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const userCatSpend = {};
  STATE.transactions.forEach(t => {
    const cat = t.category || 'miscellaneous';
    const amt = parseFloat(t.amount || 0);
    if (t.date && t.date.startsWith(currentMonthKey)) {
      userCatSpend[cat] = (userCatSpend[cat] || 0) + amt;
    }
  });

  const width = svg.clientWidth || 800;
  const height = 270;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 30;
  const padBottom = 45;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  let maxVal = 50;
  benchmarks.forEach(b => {
    const userVal = userCatSpend[b.category] || 0;
    maxVal = Math.max(maxVal, b.peer_avg, userVal);
  });
  maxVal = Math.ceil(maxVal * 1.25);

  const getY = val => padTop + chartH - (val / maxVal) * chartH;

  for (let i = 0; i <= 4; i++) {
    const val = (maxVal / 4) * i;
    const y = getY(val);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width - padRight);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'var(--bg-subtle)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 8);
    txt.setAttribute('y', y + 3.5);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', 'var(--text-dim)');
    txt.setAttribute('font-family', 'Outfit, sans-serif');
    txt.textContent = formatCurrency(val, { compact: true });
    svg.appendChild(txt);
  }

  const groupCount = benchmarks.length;
  const groupW = chartW / groupCount;
  const barW = Math.min(Math.max(groupW * 0.32, 14), 28);
  const barGap = 4;

  benchmarks.forEach((b, idx) => {
    const catName = CAT_NAMES[b.category] || b.category;
    const userVal = userCatSpend[b.category] || 0;
    const peerVal = b.peer_avg;

    const groupCenterX = padLeft + (idx + 0.5) * groupW;
    const userBarX = groupCenterX - barW - (barGap / 2);
    const peerBarX = groupCenterX + (barGap / 2);

    const userY = getY(userVal);
    const userH = Math.max(padTop + chartH - userY, 2);

    const peerY = getY(peerVal);
    const peerH = Math.max(padTop + chartH - peerY, 2);

    const hoverZone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hoverZone.setAttribute('x', groupCenterX - groupW / 2);
    hoverZone.setAttribute('y', padTop);
    hoverZone.setAttribute('width', groupW);
    hoverZone.setAttribute('height', chartH);
    hoverZone.setAttribute('fill', 'transparent');
    hoverZone.style.cursor = 'pointer';
    svg.appendChild(hoverZone);

    const userBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    userBar.setAttribute('x', userBarX);
    userBar.setAttribute('y', userY);
    userBar.setAttribute('width', barW);
    userBar.setAttribute('height', userH);
    userBar.setAttribute('rx', '4');
    userBar.setAttribute('fill', '#0284C7');
    userBar.setAttribute('class', 'chart-bar');
    userBar.style.animationDelay = `${0.05 * idx}s`;
    userBar.innerHTML = `<title>${escapeHtml(catName)}\nYour Spending: ${formatCurrency(userVal)}\nStudent Average: ${formatCurrency(peerVal)}</title>`;
    svg.appendChild(userBar);

    const peerBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    peerBar.setAttribute('x', peerBarX);
    peerBar.setAttribute('y', peerY);
    peerBar.setAttribute('width', barW);
    peerBar.setAttribute('height', peerH);
    peerBar.setAttribute('rx', '4');
    peerBar.setAttribute('fill', '#64748B');
    peerBar.setAttribute('class', 'chart-bar');
    peerBar.style.animationDelay = `${0.05 * idx + 0.04}s`;
    peerBar.innerHTML = `<title>${escapeHtml(catName)}\nYour Spending: ${formatCurrency(userVal)}\nStudent Average: ${formatCurrency(peerVal)}</title>`;
    svg.appendChild(peerBar);

    if (peerH > 22) {
      const pValTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      pValTxt.setAttribute('x', peerBarX + barW / 2);
      pValTxt.setAttribute('y', peerY - 5);
      pValTxt.setAttribute('text-anchor', 'middle');
      pValTxt.setAttribute('font-size', '9.5');
      pValTxt.setAttribute('font-weight', '600');
      pValTxt.setAttribute('fill', 'var(--text-muted)');
      pValTxt.textContent = formatCurrency(peerVal, { compact: true });
      svg.appendChild(pValTxt);
    }

    if (userVal > 0 && userH > 22) {
      const uValTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      uValTxt.setAttribute('x', userBarX + barW / 2);
      uValTxt.setAttribute('y', userY - 5);
      uValTxt.setAttribute('text-anchor', 'middle');
      uValTxt.setAttribute('font-size', '9.5');
      uValTxt.setAttribute('font-weight', '700');
      uValTxt.setAttribute('fill', '#0284C7');
      uValTxt.textContent = formatCurrency(userVal, { compact: true });
      svg.appendChild(uValTxt);
    }

    const labelTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    labelTxt.setAttribute('x', groupCenterX);
    labelTxt.setAttribute('y', height - 12);
    labelTxt.setAttribute('text-anchor', 'middle');
    labelTxt.setAttribute('font-size', '11');
    labelTxt.setAttribute('font-weight', '600');
    labelTxt.setAttribute('fill', 'var(--text-body)');
    labelTxt.setAttribute('font-family', 'Outfit, sans-serif');
    const shortLabel = catName.split('&')[0].trim();
    labelTxt.textContent = shortLabel;
    svg.appendChild(labelTxt);
  });
}

function pct(x, digits = 1) {
  return x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderStudio() {
  const d = STATE.diagnostics;
  const banner = document.getElementById('studio-banner');
  if (!d || !banner) return;
  const ml = d.ml || {};
  const m = ml.metrics;
  const retrainBtn = document.getElementById('studio-retrain-btn');
  if (retrainBtn) retrainBtn.disabled = ml.status !== 'ready';

  if (ml.status === 'ready' && m) {
    banner.style.cssText += ';background:var(--ok-bg);border:1px solid var(--ok-border);color:var(--ok-text);';
    banner.innerHTML = `<b>Machine-learning model is running.</b> Last trained ${escapeHtml(new Date(m.trained_at).toLocaleString())}. ` +
      `Everything below was measured on ${m.dataset.holdout_test_examples} held-out example phrases the model never saw while training.`;
  } else {
    banner.style.cssText += ';background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);';
    const why = ml.status === 'starting' ? 'The ML service is still starting up (the first start trains the model and takes a few seconds). Refresh shortly.'
      : ml.status === 'off' ? 'The ML service is switched off (PENNY_ML=off), so Penny is using its keyword rules.'
      : `The ML service is not running (${escapeHtml(ml.error || 'unknown reason')}). Penny is using its keyword rules instead. Install the Python packages with <code>pip install -r requirements.txt</code> and restart.`;
    banner.innerHTML = `<b>No machine-learning model active.</b> ${why}`;
  }

  const rules = d.rules || {};
  if (!m) {
    setText('ml-algo-line', `Keyword rules only: ${rules.lexicon_keywords || 0} built-in keywords, ${rules.taught_rules || 0} rules you taught.`);
    ['ml-acc', 'ml-rules-acc', 'ml-f1', 'ml-ece'].forEach(id => setText(id, '—'));
    setText('ml-acc-sub', '');
    setText('ml-vocab-note', '');
    const tb = document.getElementById('studio-matrix-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="6" style="padding:16px 20px; color:var(--text-muted);">Per-category results appear once the ML model is running.</td></tr>';
    ['studio-thresholds', 'studio-confusions'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    renderBudgetDiagnostics();
    renderHonesty(null);
    return;
  }

  setText('ml-algo-line', `${m.features}. Trained on ${m.dataset.base_training_examples} labelled phrases + ${m.dataset.lexicon_weak_examples} keyword examples + ${m.dataset.user_feedback_examples} of your corrections.`);
  setText('ml-acc', pct(m.holdout.accuracy));
  setText('ml-acc-sub', `${m.dataset.holdout_test_examples} unseen test phrases`);
  setText('ml-rules-acc', pct(m.holdout_rule_baseline.accuracy));
  setText('ml-f1', m.holdout.macro_f1.toFixed(3));
  setText('ml-ece', pct(m.calibration.expected_calibration_error));

  const v = m.holdout_by_vocabulary;
  const vocabEl = document.getElementById('ml-vocab-note');
  if (vocabEl && v) {
    vocabEl.innerHTML = `<b>Where it struggles:</b> accuracy is ${pct(v.some_words_seen.accuracy, 0)} when the description shares at least one word with its training data, but only ` +
      `${pct(v.all_words_unseen.accuracy, 0)} (${v.all_words_unseen.n} phrases) when every word is new to it. That is why Penny flags such expenses as <i>Not sure</i> instead of guessing, and learns from your corrections.`;
  }

  const tbody = document.getElementById('studio-matrix-tbody');
  if (tbody) {
    const rows = Object.entries(m.holdout.per_class).sort((a, b) => a[1].f1 - b[1].f1);
    tbody.innerHTML = rows.map(([cat, r]) => {
      const base = m.holdout_rule_baseline.per_class[cat];
      const gain = base ? r.f1 - base.f1 : 0;
      return `<tr>
        <td style="padding-left:20px; font-weight:600;">${escapeHtml(CAT_NAMES[cat] || cat)}</td>
        <td>${pct(r.precision, 0)}</td><td>${pct(r.recall, 0)}</td>
        <td style="font-weight:700; color:${r.f1 >= 0.85 ? 'var(--emerald)' : r.f1 >= 0.75 ? 'var(--text-main)' : 'var(--warn-text)'};">${r.f1.toFixed(2)}</td>
        <td style="color:var(--text-muted);">${base ? base.f1.toFixed(2) : '—'} ${gain > 0.02 ? '<span style="color:var(--emerald); font-size:11px;">(+' + gain.toFixed(2) + ')</span>' : ''}</td>
        <td style="padding-right:20px; text-align:right; color:var(--text-muted);">${r.support}</td></tr>`;
    }).join('');
  }

  const thr = document.getElementById('studio-thresholds');
  if (thr) {
    thr.innerHTML = `<table class="data-table" style="width:100%; font-size:12.5px;"><thead><tr><th>Confidence at least</th><th>Expenses auto-labelled</th><th>Of those, correct</th></tr></thead><tbody>` +
      m.confidence_thresholds.filter(t => [0, 0.5, 0.7, 0.9].includes(t.threshold)).map(t => {
        const mark = Math.abs(t.threshold - m.review_threshold) < 0.001 ? ' style="background:var(--tint-blue); font-weight:700;"' : '';
        return `<tr${mark}><td>${pct(t.threshold, 0)}</td><td>${pct(t.coverage, 0)}</td><td>${pct(t.accuracy_when_accepted, 1)}</td></tr>`;
      }).join('') + `</tbody></table>
      <div style="font-size:11.5px; color:var(--text-muted); margin-top:6px;">Highlighted: the ${pct(m.review_threshold, 0)} cut-off below which Penny asks you to double-check.</div>`;
  }

  const conf = document.getElementById('studio-confusions');
  if (conf) {
    const labels = m.confusion_matrix.labels;
    const pairs = [];
    m.confusion_matrix.matrix.forEach((row, i) => row.forEach((n, j) => { if (i !== j && n > 0) pairs.push({ n, t: labels[i], p: labels[j] }); }));
    pairs.sort((a, b) => b.n - a.n);
    const nm = k => escapeHtml(CAT_NAMES[k] || k);
    conf.innerHTML = (pairs.length ? '<div style="font-size:12.5px; margin-bottom:8px;"><b>Most common mix-ups</b></div>' +
        pairs.slice(0, 5).map(x => `<div style="font-size:12.5px; padding:2px 0;">${nm(x.t)} mistaken for ${nm(x.p)} <span style="color:var(--text-muted);">× ${x.n}</span></div>`).join('') : '') +
      (m.top_errors && m.top_errors.length ? '<div style="font-size:12.5px; margin:12px 0 6px;"><b>Confident mistakes</b></div>' +
        m.top_errors.slice(0, 4).map(e => `<div style="font-size:12.5px; padding:2px 0;">"${escapeHtml(e.text)}" is really ${nm(e.true)}, predicted ${nm(e.predicted)} (${pct(e.confidence, 0)})</div>`).join('') : '');
  }

  renderBudgetDiagnostics();
  renderHonesty(m);
  const scratch = document.getElementById('scratch-input');
  if (scratch && ml.status === 'ready') handleScratchPredict(scratch.value);
}

function renderBudgetDiagnostics() {
  const ins = STATE.insights;
  const line = document.getElementById('budget-method-line');
  const val = document.getElementById('bud-validation');
  if (!ins || !ins.available) {
    if (line) line.textContent = 'Budget learning needs the ML service. Showing the cost-of-living estimate only.';
    setText('bud-prior', formatCurrency(STATE.predictedBudget || 0));
    ['bud-hist', 'bud-weight'].forEach(id => setText(id, '—'));
    setText('bud-rec', formatCurrency(STATE.predictedBudget || 0));
    setText('bud-hist-sub', ''); setText('bud-range', '');
    if (val) val.textContent = '';
    return;
  }
  const b = ins.budget;
  if (line) line.textContent = b.method;
  setText('bud-prior', formatCurrency(b.prior));
  setText('bud-hist', b.history_centre === null || b.history_centre === undefined ? '—' : formatCurrency(b.history_centre));
  setText('bud-hist-sub', `${b.history_months} complete month${b.history_months === 1 ? '' : 's'} of data`);
  setText('bud-rec', formatCurrency(b.recommended));
  setText('bud-range', b.interval_80 ? `likely ${formatCurrency(b.interval_80[0])} – ${formatCurrency(b.interval_80[1])}` : '');
  setText('bud-weight', pct(b.weight_on_history, 0));
  if (val) {
    const t = b.validation;
    val.textContent = t && t.mae_model !== null && t.mae_model !== undefined
      ? `Backtest on your own history: average miss of ${formatCurrency(t.mae_model)} per month, versus ${formatCurrency(t.mae_prior_only)} for the estimate alone and ${formatCurrency(t.mae_last_month)} for "same as last month". ${t.beats_prior_only ? 'The learned budget is doing better.' : 'The learned budget is not clearly better yet.'}`
      : 'Not enough complete months to test the budget against your history yet (needs at least 4). Until then the estimate carries most of the weight, and we do not claim an accuracy figure.';
  }
}

function renderHonesty(m) {
  const el = document.getElementById('studio-honesty');
  if (!el) return;
  const q = STATE.insights && STATE.insights.available ? STATE.insights.peer_data_quality : null;
  const items = [
    'The categoriser was trained on phrases written by the developer, not on real students\' spending. Accuracy on your own expenses may differ, and gets better as you correct it.',
    m ? `Confidence numbers are calibrated: when the model says 90%, it was right ${pct(m.calibration.reliability.slice(-1)[0].accuracy, 0)} of the time on test data (average error ${pct(m.calibration.expected_calibration_error)}).` : null,
    'The budget starts from a cost-of-living estimate; it only trusts your history in proportion to how many complete months you have.',
    q ? `Peer comparison: ${escapeHtml(q.verdict)}` : 'Peer comparison uses an illustrative sample dataset, not real students at your college.'
  ].filter(Boolean);
  el.innerHTML = '<ul style="margin:0; padding-left:18px;">' + items.map(i => `<li style="margin-bottom:4px;">${i}</li>`).join('') + '</ul>';
}

async function retrainModels() {
  const btn = document.getElementById('studio-retrain-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Training…'; }
  try {
    const res = await apiFetch('/api/ml/retrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Retrain failed');
    await loadDiagnostics();
    await loadInsights();
    renderStudio();
    showToast('Model re-trained and re-evaluated.');
  } catch (err) {
    showToast(err.message || 'Retrain failed');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Re-train & re-evaluate'; }
  }
}

let scratchTimer = null;
function handleScratchPredict(val) {
  clearTimeout(scratchTimer);
  scratchTimer = setTimeout(async () => {
    if (!val.trim()) return;
    try {
      const res = await apiFetch('/api/nlp/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: val })
      });
      const data = await res.json();
      const catEl = document.getElementById('scratch-cat-lbl');
      const confEl = document.getElementById('scratch-conf-lbl');
      if (catEl) catEl.textContent = CAT_NAMES[data.category] || data.category;
      setPredictionPill(confEl, data);
    } catch (err) {
      console.error('Scratchpad error:', err);
    }
  }, 160);
}

function openProfileModal(isForced = false, blank = false) {
  const backdrop = document.getElementById('onboarding-modal-backdrop');
  const dialog = document.getElementById('onboarding-modal');
  const titleEl = document.getElementById('ob-modal-title');
  const subEl = document.getElementById('ob-modal-sub');
  const submitBtn = document.getElementById('ob-submit-btn');

  obSetup = !!isForced;
  dialog.classList.toggle('mode-setup', obSetup);
  dialog.classList.toggle('mode-edit', !obSetup);
  if (obSetup) {
    if (titleEl) titleEl.textContent = 'Welcome to Penny';
    if (subEl) subEl.textContent = 'Set up your college, tuition fees, and monthly allowance to get your personalized budget.';
    if (submitBtn) submitBtn.textContent = 'Save Profile & Get Started';
    backdrop.onclick = null;
  } else {
    if (titleEl) titleEl.textContent = 'Edit Student Details';
    if (subEl) subEl.textContent = 'Update your college, tuition, or monthly allowance.';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    backdrop.onclick = closeProfileModal;
  }
  obStep = 0;
  obMax = 0;

  if (STATE.profile && !blank) {
    const regCode = STATE.profile.country || (STATE.currentRegion && STATE.currentRegion.code) || 'US';
    const obRegion = document.getElementById('ob-region');
    if (obRegion) obRegion.value = regCode;

    filterCollegeDropdownByRegion(regCode);

    document.getElementById('ob-name').value = STATE.profile.name || '';
    document.getElementById('ob-college').value = STATE.profile.college || '';
    document.getElementById('ob-city').value = STATE.profile.campus_city || '';
    document.getElementById('ob-major').value = STATE.profile.major || '';
    document.getElementById('ob-year').value = STATE.profile.year_in_school || '';
    document.getElementById('ob-tuition').value = STATE.profile.tuition_amount || (STATE.currentRegion && STATE.currentRegion.sampleTuition) || 34000;
    document.getElementById('ob-income').value = STATE.profile.monthly_income || (STATE.currentRegion && STATE.currentRegion.sampleIncome) || 2400;
    document.getElementById('ob-aid').value = STATE.profile.financial_aid || (STATE.currentRegion && STATE.currentRegion.sampleAid) || 800;
    document.getElementById('ob-age').value = STATE.profile.age || 20;
    document.getElementById('ob-gender').value = STATE.profile.gender || 'Female';
    document.getElementById('ob-payment').value = STATE.profile.preferred_payment_method || 'Mobile Payment App';

    setTuitionPeriod(STATE.profile.tuition_period || 'annual');
    syncCityLock(document.getElementById('ob-college').value);
  } else {
    const regCode = STATE.currentRegion ? STATE.currentRegion.code : 'US';
    const obRegion = document.getElementById('ob-region');
    if (obRegion) obRegion.value = regCode;
    filterCollegeDropdownByRegion(regCode);

    ['ob-name', 'ob-custom-college', 'ob-tuition', 'ob-income', 'ob-aid'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('ob-age').value = 21;
    document.getElementById('custom-college-row').style.display = 'none';
    document.getElementById('ob-college').selectedIndex = 0;
    document.getElementById('ob-city').selectedIndex = 0;
    document.getElementById('ob-major').selectedIndex = 0;
    document.getElementById('ob-year').selectedIndex = 0;
    document.getElementById('ob-gender').selectedIndex = 0;
    document.getElementById('ob-payment').selectedIndex = 0;
    setTuitionPeriod('annual');
    syncCityLock('');
  }

  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  dialog.scrollTop = 0;
  const obShell = dialog.querySelector('.ob-shell');
  if (obShell) obShell.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  obRenderSteps(0);
  obRefreshSummary(false);
  setTimeout(() => {
    backdrop.style.opacity = '1';
    dialog.style.opacity = '1';
    dialog.style.transform = 'translate(-50%, -50%) scale(1)';
    dialog.classList.remove('is-open');
    void dialog.offsetWidth;
    dialog.classList.add('is-open');
    ['ob-sum-tuition', 'ob-sum-inflow', 'ob-sum-left'].forEach(id => { document.getElementById(id).dataset.v = 0; });
    obRefreshSummary(true);
  }, 10);
}

function closeProfileModal() {
  const backdrop = document.getElementById('onboarding-modal-backdrop');
  const dialog = document.getElementById('onboarding-modal');
  backdrop.style.opacity = '0';
  dialog.style.opacity = '0';
  dialog.style.transform = 'translate(-50%, -46%) scale(0.96)';
  document.body.style.overflow = '';
  setTimeout(() => {
    backdrop.style.display = 'none';
    dialog.style.display = 'none';
    dialog.classList.remove('is-open');
  }, 240);
}

// ---- Student details modal: first-run steps + edit side panel ----
let obStep = 0;
let obMax = 0;
let obSetup = false;

function obRenderSteps(dir) {
  const dlg = document.getElementById('onboarding-modal');
  const secs = [...dlg.querySelectorAll('.ob-sec')];
  const btns = [...dlg.querySelectorAll('#ob-steps button')];
  const cancel = document.getElementById('ob-cancel-btn');
  const next = document.getElementById('ob-next-btn');
  const submit = document.getElementById('ob-submit-btn');
  btns.forEach((b, i) => {
    b.classList.toggle('on', i === obStep);
    b.classList.toggle('done', i < obStep);
    b.classList.toggle('reach', obSetup && i <= obMax);
  });
  if (!obSetup) {
    secs.forEach(s => s.classList.add('on'));
    cancel.textContent = 'Cancel';
    cancel.classList.remove('ghost');
    next.hidden = true;
    submit.hidden = false;
    return;
  }
  secs.forEach((s, i) => {
    const on = i === obStep;
    s.classList.toggle('on', on);
    s.classList.remove('enter-fwd', 'enter-back', 'shake');
    if (on && dir) {
      void s.offsetWidth;
      s.classList.add(dir > 0 ? 'enter-fwd' : 'enter-back');
    }
  });
  cancel.textContent = 'Back';
  cancel.classList.toggle('ghost', obStep === 0);
  next.hidden = obStep === 3;
  submit.hidden = obStep !== 3;
}

function obValidateStep(i) {
  const sec = document.querySelector(`#onboarding-modal .ob-sec[data-step="${i}"]`);
  for (const el of sec.querySelectorAll('input, select')) {
    if (!el.checkValidity()) {
      sec.classList.remove('enter-fwd', 'enter-back', 'shake');
      void sec.offsetWidth;
      sec.classList.add('shake');
      el.reportValidity();
      return false;
    }
  }
  return true;
}

function obGoTo(i) {
  if (i === obStep) return;
  const dir = i > obStep ? 1 : -1;
  obStep = i;
  obMax = Math.max(obMax, obStep);
  obRenderSteps(dir);
  const first = document.querySelector(`#onboarding-modal .ob-sec[data-step="${i}"] input:not([disabled]), #onboarding-modal .ob-sec[data-step="${i}"] select:not([disabled])`);
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 120);
}

function obNext() {
  if (obStep < 3 && obValidateStep(obStep)) obGoTo(obStep + 1);
}

function obBackOrCancel() {
  if (!obSetup) return closeProfileModal();
  if (obStep > 0) obGoTo(obStep - 1);
}

function obHandleSubmit(e) {
  if (obSetup && obStep < 3) {
    e.preventDefault();
    obNext();
    return;
  }
  return handleProfileSubmit(e);
}

function obTween(el, to, animate) {
  const from = animate ? (parseFloat(el.dataset.v) || 0) : to;
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  clearTimeout(el._timer);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce || from === to) {
    el.textContent = formatCurrency(to);
    return;
  }
  const t0 = performance.now();
  clearTimeout(el._timer);
  const step = t => {
    const p = Math.min(1, (t - t0) / 450);
    el.textContent = formatCurrency(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  el._timer = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = formatCurrency(to); }, 600);
}

function obRefreshSummary(animate = true) {
  const g = id => document.getElementById(id);
  if (!g('ob-sum-name')) return;
  const name = g('ob-name').value.trim();
  const av = g('ob-avatar');
  const initial = (name[0] || 'S').toUpperCase();
  if (av.textContent !== initial) {
    av.textContent = initial;
    if (animate) {
      av.classList.remove('pop');
      void av.offsetWidth;
      av.classList.add('pop');
    }
  }
  g('ob-sum-name').textContent = name || 'Your name';
  g('ob-sum-sub').textContent = [g('ob-year').value, g('ob-major').value].filter(Boolean).join(' · ') || 'Major · Year';
  const col = g('ob-college').value;
  g('ob-sum-college').textContent = !col ? 'Choose a college'
    : (col.startsWith('Other') ? (g('ob-custom-college').value.trim() || col) : col);

  const tuition = parseFloat(g('ob-tuition').value) || 0;
  const monthly = STATE.tuitionPeriod === 'semester' ? Math.round(tuition / 6) : Math.round(tuition / 12);
  const inflow = (parseFloat(g('ob-income').value) || 0) + (parseFloat(g('ob-aid').value) || 0);
  const left = inflow - monthly;
  obTween(g('ob-sum-tuition'), monthly, animate);
  obTween(g('ob-sum-inflow'), inflow, animate);
  const leftEl = g('ob-sum-left');
  obTween(leftEl, left, animate);
  leftEl.classList.toggle('pos', left >= 0);
  leftEl.classList.toggle('neg', left < 0);
}

['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
  if (e.target.closest && e.target.closest('#ob-form')) obRefreshSummary(true);
}));
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#ob-steps button');
  if (b && obSetup) {
    const i = Number(b.dataset.step);
    if (i <= obMax) obGoTo(i);
  }
});

function setTuitionPeriod(period) {
  STATE.tuitionPeriod = period;
  const btnAnnual = document.getElementById('btn-period-annual');
  const btnSem = document.getElementById('btn-period-sem');
  if (btnAnnual && btnSem) {
    if (period === 'annual') {
      btnAnnual.classList.add('active');
      btnSem.classList.remove('active');
    } else {
      btnSem.classList.add('active');
      btnAnnual.classList.remove('active');
    }
  }
  const amt = parseFloat(document.getElementById('ob-tuition').value) || 0;
  updateTuitionAmortizationPreview(amt);
}

function updateTuitionAmortizationPreview(val) {
  const amt = parseFloat(val) || 0;
  const monthly = STATE.tuitionPeriod === 'semester' ? Math.round(amt / 6) : Math.round(amt / 12);
  const preview = document.getElementById('ob-tuition-amort-preview');
  if (preview) preview.textContent = `${formatCurrency(monthly)} / month amortized`;
  if (typeof obRefreshSummary === 'function') obRefreshSummary(true);
}

function filterCollegeDropdownByRegion(regionCode) {
  const obCollege = document.getElementById('ob-college');
  if (!obCollege || !STATE.colleges) return;

  const currentVal = obCollege.value;
  obCollege.innerHTML = '<option value="" disabled selected>Select your college...</option>';

  const filtered = STATE.colleges.filter(c => c.country === regionCode || c.name.startsWith('Other'));
  filtered.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.city})`;
    obCollege.appendChild(opt);
  });

  if (currentVal && filtered.some(c => c.name === currentVal)) {
    obCollege.value = currentVal;
  }
  syncCityLock(obCollege.value);
}

function handleModalRegionChange(regionCode) {
  setRegion(regionCode);
  filterCollegeDropdownByRegion(regionCode);

  const reg = STATE.regions[regionCode];
  if (reg) {
    const tuitionInp = document.getElementById('ob-tuition');
    const incomeInp = document.getElementById('ob-income');
    const aidInp = document.getElementById('ob-aid');

    if (tuitionInp && (!tuitionInp.value || tuitionInp.value === '150000' || tuitionInp.value === '34000')) {
      tuitionInp.value = reg.sampleTuition;
      updateTuitionAmortizationPreview(reg.sampleTuition);
    }
    if (incomeInp && (!incomeInp.value || incomeInp.value === '45000' || incomeInp.value === '2400')) {
      incomeInp.value = reg.sampleIncome;
    }
    if (aidInp && (!aidInp.value || aidInp.value === '15000' || aidInp.value === '800')) {
      aidInp.value = reg.sampleAid;
    }
  }
  obRefreshSummary(true);
}

// A known college fixes the campus location: show its city and lock the city dropdown.
// "Other / Independent Institution" (or no college yet) leaves the city free to choose.
function syncCityLock(collegeName) {
  const citySelect = document.getElementById('ob-city');
  if (!citySelect) return;
  const match = STATE.colleges.find(c => c.name === collegeName);
  const locked = !!match && !match.name.startsWith('Other');
  if (locked) citySelect.value = match.city;
  citySelect.disabled = locked;
  citySelect.title = locked ? 'Campus location is set by your college' : '';
  const hint = document.getElementById('ob-city-hint');
  if (hint) hint.style.display = locked ? 'block' : 'none';
}

function handleCollegeChange(val) {
  const customRow = document.getElementById('custom-college-row');
  if (val === 'Other / Independent Institution') {
    if (customRow) customRow.style.display = 'block';
    syncCityLock(val);
    return;
  }
  if (customRow) customRow.style.display = 'none';

  const match = STATE.colleges.find(c => c.name === val);
  syncCityLock(val);
  if (match) {
    if (match.country && STATE.regions[match.country]) {
      const obRegion = document.getElementById('ob-region');
      if (obRegion && obRegion.value !== match.country) {
        obRegion.value = match.country;
        setRegion(match.country);
      }
    }
  }
}

async function handleProfileSubmit(e) {
  e.preventDefault();
  const wasSetup = obSetup;
  let college = document.getElementById('ob-college').value;
  if (college === 'Other / Independent Institution') {
    const customCollege = document.getElementById('ob-custom-college').value.trim();
    if (customCollege) college = customCollege;
  }
  const city = document.getElementById('ob-city').value;
  const name = document.getElementById('ob-name').value.trim() || 'Student Scholar';
  const major = document.getElementById('ob-major').value;
  const year = document.getElementById('ob-year').value;
  const tuition = parseFloat(document.getElementById('ob-tuition').value) || 0;
  const income = parseFloat(document.getElementById('ob-income').value) || 0;
  const aid = parseFloat(document.getElementById('ob-aid').value) || 0;
  const age = parseInt(document.getElementById('ob-age').value, 10) || 20;
  const gender = document.getElementById('ob-gender').value;
  const payment = document.getElementById('ob-payment').value;
  const country = document.getElementById('ob-region').value || 'US';

  const payload = {
    name,
    college,
    campus_city: city,
    country,
    major,
    year_in_school: year,
    tuition_amount: tuition,
    tuition_period: STATE.tuitionPeriod,
    monthly_income: income,
    financial_aid: aid,
    age,
    gender,
    preferred_payment_method: payment
  };

  try {
    const res = await apiFetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    STATE.profile = data.profile;
    STATE.predictedBudget = data.predicted_budget;
    STATE.monthlyTuition = data.monthly_tuition_amortized;
    STATE.grossInflow = data.gross_inflow;
    STATE.netInflow = data.net_inflow;
    STATE.affordabilityCap = data.affordability_cap;
    STATE.coliFactor = data.coli_factor;

    setRegion(country);
    closeProfileModal();
    await loadPeerBenchmarks();
    await loadInsights();
    renderAll();
    switchView('overview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`Profile saved for ${college} (${city})!`);
    if (wasSetup && window.maybeStartTour) setTimeout(window.maybeStartTour, 900);
  } catch (err) {
    console.error('Failed to save profile:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

function openCategoryModal() {
  const backdrop = document.getElementById('cat-modal-backdrop');
  const dialog = document.getElementById('cat-modal');
  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  setTimeout(() => {
    backdrop.style.opacity = '1';
    dialog.style.opacity = '1';
    dialog.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
}

function closeCategoryModal() {
  const backdrop = document.getElementById('cat-modal-backdrop');
  const dialog = document.getElementById('cat-modal');
  backdrop.style.opacity = '0';
  dialog.style.opacity = '0';
  dialog.style.transform = 'translate(-50%, -46%) scale(0.96)';
  setTimeout(() => {
    backdrop.style.display = 'none';
    dialog.style.display = 'none';
  }, 220);
}

async function handleNewCategorySubmit(e) {
  e.preventDefault();
  const name = document.getElementById('cm-name').value.trim();
  const color = document.getElementById('cm-color').value;
  const keywords = document.getElementById('cm-keywords').value;

  if (!name) return;

  try {
    const res = await apiFetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, keywords })
    });
    const before = new Set(Object.keys(CAT_NAMES));
    await loadCategories();
    const created = Object.keys(CAT_NAMES).find(k => !before.has(k));
    if (categorySelectToRestore && created) populateCategorySelect(categorySelectToRestore, created);
    categorySelectToRestore = null;
    closeCategoryModal();
    renderAll();
    showToast(`New category "${name}" registered successfully!`);
  } catch (err) {
    console.error('Failed to create category:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

function openQuickModal() {
  const backdrop = document.getElementById('quick-modal-backdrop');
  const dialog = document.getElementById('quick-modal');
  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  dialog.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    backdrop.style.opacity = '1';
    dialog.style.opacity = '1';
    dialog.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
}

function closeQuickModal() {
  const backdrop = document.getElementById('quick-modal-backdrop');
  const dialog = document.getElementById('quick-modal');
  backdrop.style.opacity = '0';
  dialog.style.opacity = '0';
  dialog.style.transform = 'translate(-50%, -46%) scale(0.96)';
  document.body.style.overflow = '';
  setTimeout(() => {
    backdrop.style.display = 'none';
    dialog.style.display = 'none';
  }, 220);
}

let modalPredictTimer = null;
function handleModalPredict(val) {
  clearTimeout(modalPredictTimer);
  modalPredictTimer = setTimeout(async () => {
    if (!val.trim()) return;
    try {
      const res = await apiFetch('/api/nlp/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: val })
      });
      const data = await res.json();
      noteAutoDetected('qm-cat-select', data);
    } catch {}
  }, 140);
}

async function handleQuickModalSubmit(e) {
  e.preventDefault();
  const desc = document.getElementById('qm-desc').value.trim();
  const amt = parseFloat(document.getElementById('qm-amt').value);
  const date = document.getElementById('qm-date').value;
  const chosen = document.getElementById('qm-cat-select').value;

  if (!desc || isNaN(amt) || amt <= 0) return;

  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, amount: amt, date, ...(chosen ? { category: chosen } : {}) })
    });
    delete autoDetected['qm-cat-select'];
    populateCategorySelect('qm-cat-select', '');
    await loadTransactions();
    closeQuickModal();
    renderAll();
    showToast(`Logged ${formatCurrency(amt)} for ${desc}`);
  } catch (err) {
    console.error('Quick log failed:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

function openNewGoalModal() {
  const backdrop = document.getElementById('goal-modal-backdrop');
  const dialog = document.getElementById('goal-modal');
  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  dialog.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    backdrop.style.opacity = '1';
    dialog.style.opacity = '1';
    dialog.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 10);
}

function closeGoalModal() {
  const backdrop = document.getElementById('goal-modal-backdrop');
  const dialog = document.getElementById('goal-modal');
  backdrop.style.opacity = '0';
  dialog.style.opacity = '0';
  dialog.style.transform = 'translate(-50%, -46%) scale(0.96)';
  document.body.style.overflow = '';
  setTimeout(() => {
    backdrop.style.display = 'none';
    dialog.style.display = 'none';
  }, 220);
}

async function handleNewGoalSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('gm-name').value.trim();
  const target = parseFloat(document.getElementById('gm-target').value) || 1000;
  const saved = parseFloat(document.getElementById('gm-saved').value) || 0;
  const deadline = document.getElementById('gm-deadline').value;
  const priority = document.getElementById('gm-priority').value;

  if (!name) return;

  try {
    await apiFetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, target_amount: target, saved_amount: saved, deadline, priority })
    });
    await loadGoals();
    closeGoalModal();
    renderGoals();
    showToast(`Registered target "${name}"!`);
  } catch (err) {
    console.error('New goal failed:', err);
    showToast(err.message || 'Something went wrong.');
  }
}

function populateMetaDropdowns() {
  if (!STATE.meta) return;

  const obCity = document.getElementById('ob-city');
  const obMajor = document.getElementById('ob-major');
  const obYear = document.getElementById('ob-year');
  const obGender = document.getElementById('ob-gender');
  const obPayment = document.getElementById('ob-payment');

  const regCode = (STATE.currentRegion && STATE.currentRegion.code) || 'US';
  filterCollegeDropdownByRegion(regCode);

  if (obCity && obCity.children.length <= 1) {
    STATE.cities.forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      obCity.appendChild(opt);
    });
  }

  if (obMajor && obMajor.children.length <= 1) {
    STATE.meta.majors.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      obMajor.appendChild(opt);
    });
  }

  if (obYear && obYear.children.length <= 1) {
    STATE.meta.years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      obYear.appendChild(opt);
    });
  }

  if (obGender && obGender.children.length <= 1) {
    ['Female', 'Male', 'Non-binary'].forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      obGender.appendChild(opt);
    });
  }

  if (obPayment && obPayment.children.length <= 1) {
    STATE.meta.payments.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      obPayment.appendChild(opt);
    });
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0) scale(1)';
  }, 10);
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px) scale(0.95)';
    setTimeout(() => { t.style.display = 'none'; }, 280);
  }, Math.max(2600, String(msg).length * 45));
}
