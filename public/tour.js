// guided tour, runs once after first setup, replay from the sidebar
(function () {
  const DONE_KEY = 'penny_tour_done';

  const STEPS = [
    {
      title: 'Welcome to Penny',
      body: 'A quick look around, about thirty seconds. Penny turns your college, tuition and allowance into a budget you can actually follow.',
      next: 'Start tour'
    },
    {
      target: () => document.querySelector('.profile-capsule'),
      prefer: 'right',
      title: 'Your student profile',
      body: 'Your college, tuition and allowance live here. Choose Edit Student Details whenever something changes and your budget updates to match.'
    },
    {
      target: () => document.querySelector('.rail-nav'),
      prefer: 'right',
      title: 'One place for each job',
      body: 'Overview for the big picture, the Ledger for every expense, Milestones for savings goals, Peer Benchmarks to compare, and Model Diagnostics to see how the AI works.'
    },
    {
      target: () => document.querySelector('#view-overview .header-actions'),
      prefer: 'bottom',
      title: 'Log an expense in seconds',
      body: 'Type what you bought. Penny picks the category for you, and you can change it or add your own before saving.'
    },
    {
      target: () => document.querySelector('#view-overview .kpi-row'),
      prefer: 'bottom',
      title: 'Your month at a glance',
      body: 'Your budget target, monthly tuition, what you have spent and what is left, all in your own currency.'
    },
    {
      target: () => document.getElementById('insights-section'),
      prefer: 'top',
      title: 'A forecast, not just a total',
      body: 'Penny projects where the month will end, points out unusual spending and spots bills that repeat.'
    },
    {
      target: () => document.querySelector('.canvas-top-bar > div:last-child'),
      prefer: 'bottom',
      title: 'Currency and theme',
      body: 'Switch between light and dark with the moon button. Change country and currency from the region box in the sidebar.',
      next: 'Finish'
    }
  ];

  const PAD = 8;
  const GAP = 16;
  const MARGIN = 16;

  let root, spot, card, els, index, active, busy, token, followTimer;

  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function build() {
    root = document.createElement('div');
    root.className = 'tour-root';
    root.innerHTML = `
      <div class="tour-shield"></div>
      <div class="tour-spot centered"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-inner">
          <div class="tour-step" id="tour-step"></div>
          <h3 class="tour-title" id="tour-title"></h3>
          <p class="tour-body" id="tour-body"></p>
        </div>
        <div class="tour-foot">
          <div class="tour-dots" id="tour-dots"></div>
          <div class="tour-actions">
            <button type="button" class="tour-skip" id="tour-skip">Skip</button>
            <button type="button" class="btn-secondary tour-back" id="tour-back">Back</button>
            <button type="button" class="btn-primary tour-next" id="tour-next">Next</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    spot = root.querySelector('.tour-spot');
    card = root.querySelector('.tour-card');
    els = {
      inner: root.querySelector('.tour-inner'),
      step: root.querySelector('#tour-step'),
      title: root.querySelector('#tour-title'),
      body: root.querySelector('#tour-body'),
      dots: root.querySelector('#tour-dots'),
      back: root.querySelector('#tour-back'),
      next: root.querySelector('#tour-next'),
      skip: root.querySelector('#tour-skip')
    };
    els.dots.innerHTML = STEPS.map(() => '<i></i>').join('');
    els.next.onclick = () => go(index + 1);
    els.back.onclick = () => go(index - 1);
    els.skip.onclick = () => finish();
    root.querySelector('.tour-shield').onclick = () => {};
  }

  function targetRect(step) {
    const el = step.target && step.target();
    if (!el || !visible(el)) return null;
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top - PAD, MARGIN / 2);
    const left = Math.max(r.left - PAD, MARGIN / 2);
    const right = Math.min(r.right + PAD, window.innerWidth - MARGIN / 2);
    const bottom = Math.min(r.bottom + PAD, window.innerHeight - MARGIN / 2);
    return { top, left, width: right - left, height: bottom - top };
  }

  function placeSpot(rect) {
    if (!rect) {
      spot.classList.add('centered');
      spot.style.top = window.innerHeight / 2 + 'px';
      spot.style.left = window.innerWidth / 2 + 'px';
      spot.style.width = '0px';
      spot.style.height = '0px';
      return;
    }
    spot.classList.remove('centered');
    spot.style.top = rect.top + 'px';
    spot.style.left = rect.left + 'px';
    spot.style.width = rect.width + 'px';
    spot.style.height = rect.height + 'px';
  }

  function placeCard(rect, prefer) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let top, left;
    if (!rect) {
      top = (vh - h) / 2;
      left = (vw - w) / 2;
    } else {
      const fits = {
        right: rect.left + rect.width + GAP + w <= vw - MARGIN,
        left: rect.left - GAP - w >= MARGIN,
        bottom: rect.top + rect.height + GAP + h <= vh - MARGIN,
        top: rect.top - GAP - h >= MARGIN
      };
      const order = [prefer, 'bottom', 'right', 'top', 'left'].filter(Boolean);
      const side = order.find(s => fits[s]);
      const cx = rect.left + rect.width / 2 - w / 2;
      const cy = rect.top + rect.height / 2 - h / 2;
      if (side === 'right') { left = rect.left + rect.width + GAP; top = cy; }
      else if (side === 'left') { left = rect.left - GAP - w; top = cy; }
      else if (side === 'bottom') { top = rect.top + rect.height + GAP; left = cx; }
      else if (side === 'top') { top = rect.top - GAP - h; left = cx; }
      else { top = vh - h - 24; left = (vw - w) / 2; } // too big, dock at bottom
    }
    left = Math.min(Math.max(left, MARGIN), vw - w - MARGIN);
    top = Math.min(Math.max(top, MARGIN), vh - h - MARGIN);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function fillContent(i) {
    const s = STEPS[i];
    els.step.textContent = i === 0 ? 'Quick tour' : `Step ${i + 1} of ${STEPS.length}`;
    els.title.textContent = s.title;
    els.body.textContent = s.body;
    els.next.textContent = s.next || 'Next';
    els.back.style.display = i === 0 ? 'none' : '';
    [...els.dots.children].forEach((d, n) => {
      d.className = n === i ? 'on' : n < i ? 'seen' : '';
    });
  }

  // wait for scroll to stop so the spotlight lands right
  async function settleScroll(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tall = r.height > window.innerHeight * 0.7;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: tall ? 'start' : 'center' });
    let last = null;
    let still = 0;
    const t0 = performance.now();
    while (still < 4 && performance.now() - t0 < 1100) {
      await new Promise(r2 => requestAnimationFrame(r2));
      const y = window.scrollY;
      still = y === last ? still + 1 : 0;
      last = y;
    }
  }

  async function go(next) {
    if (busy) return;
    if (next >= STEPS.length) return finish();
    if (next < 0) return;
    const dir = next >= index ? 1 : -1;
    busy = true;
    const my = ++token;

    // skip steps that aren't visible (hidden sidebar on small screens)
    while (next >= 0 && next < STEPS.length && STEPS[next].target && !visible(STEPS[next].target())) next += dir;
    if (next < 0 || next >= STEPS.length) { busy = false; return next >= STEPS.length ? finish() : undefined; }

    card.classList.add('swap');
    await wait(index === undefined || index === null ? 0 : 170);
    if (my !== token || !active) return;

    index = next;
    const step = STEPS[index];
    const el = step.target && step.target();
    await settleScroll(el);
    if (my !== token || !active) return;

    fillContent(index);
    const rect = el ? targetRect(step) : null;
    placeSpot(rect);
    placeCard(rect, step.prefer);
    card.classList.remove('swap');
    busy = false;
    els.next.focus({ preventScroll: true });
  }

  function follow() {
    if (!active || busy) return;
    root.classList.add('follow');
    const step = STEPS[index];
    const rect = step && step.target ? targetRect(step) : null;
    placeSpot(rect);
    placeCard(rect, step && step.prefer);
    clearTimeout(followTimer);
    followTimer = setTimeout(() => root && root.classList.remove('follow'), 140);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  }

  function finish() {
    if (!active) return;
    active = false;
    token++;
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* storage unavailable */ }
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', follow);
    window.removeEventListener('scroll', follow, true);
    const node = root;
    node.classList.add('leaving');
    setTimeout(() => { node.remove(); }, 420);
    root = null;
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  async function start() {
    if (active) return;
    if (typeof switchView === 'function') switchView('overview');
    const layout = document.querySelector('.app-layout');
    if (layout && layout.classList.contains('sidebar-collapsed') && typeof toggleSidebar === 'function') {
      toggleSidebar(true);
      await wait(450);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    active = true;
    busy = false;
    index = null;
    token = 0;
    build();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    placeSpot(null);
    fillContent(0);
    placeCard(null);
    requestAnimationFrame(() => {
      root.classList.add('in');
      index = 0;
      els.next.focus({ preventScroll: true });
    });
  }

  window.startTour = start;
  window.maybeStartTour = function () {
    let done = false;
    try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (e) { /* ignore */ }
    if (!done) start();
  };
})();
