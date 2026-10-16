// Dynamic Island: la barra di navigazione di Omar AI. Segue il mouse solo quando il puntatore è sopra la pillola,
// si espande con movimenti elastici, mostra lo stato dell'IA con una spia (verde / arancione / rossa)
// e accetta testo trascinato per spiegarlo o tradurlo.
import { h, add, clear, confirmDialog, renderMarkdown, fmtDate } from './dom.js';
import { get, post, api, auth } from './api.js';
import { icon } from './icons.js';
import { mountHistory } from './history.js';

export const IDLE_MS = 60_000;          // dopo questo tempo senza scrivere la spia diventa arancione
const HEALTH_EVERY_MS = 20_000;         // controllo periodico di server e modello IA
const TOP = 18;                         // distanza dal bordo alto (coincide con il CSS)
const BASE_H = 48;                      // altezza della pillola chiusa
const LANGS = [['en', 'Inglese'], ['es', 'Spagnolo'], ['fr', 'Francese'], ['de', 'Tedesco'], ['ro', 'Rumeno'], ['sq', 'Albanese'], ['ar', 'Arabo'], ['zh', 'Cinese'], ['uk', 'Ucraino'], ['ru', 'Russo'], ['pt', 'Portoghese'], ['it', 'Italiano']];
const LANG_KEY = 'omar.lang';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createIsland(ctx) {
  const { S } = ctx;
  let user = null; let state = 'idle'; let view = null; let lastBtn = null; let dragging = false; let dragText = '';
  const H = { netUp: navigator.onLine !== false, srvDown: false, aiOk: true, aiMsg: '', busy: false, lastInput: Date.now() };

  // ── struttura ──
  const dot = h('span', { class: 'isl-dot', role: 'img', 'aria-label': 'Stato: IA attiva' });
  const label = h('span', { class: 'isl-label', 'aria-hidden': true });
  const bar = h('nav', { class: 'isl-bar', 'aria-label': 'Navigazione principale' });
  const logo = h('img', { class: 'isl-logo', src: '/img/logo.png', alt: '', width: 28, height: 28, 'aria-hidden': true, draggable: 'false' });
  const dropHint = h('div', { class: 'isl-drop', 'aria-hidden': true }, icon('sparkle', 26), h('div', null, h('strong', { text: 'Rilascia qui' }), h('span', { text: 'per spiegare o tradurre il testo' })));
  const inner = h('div', { class: 'isl-inner' });
  const panel = h('div', { class: 'isl-panel', tabindex: '-1', 'aria-live': 'polite' }, inner);
  const shape = h('div', { class: 'isl-shape' }, [h('div', { class: 'isl-main' }, [logo, bar, label, dot]), dropHint, panel]);
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', id: 'isl-live' });
  const root = h('div', { id: 'island', class: 'island', dataset: { state: 'idle', health: 'ok', auth: '0' } }, [shape, live]);

  // ── spia di stato ──
  let lastHealth = 'ok';
  function health() {
    const bad = !H.netUp || H.srvDown || !H.aiOk;
    const idle = !bad && Date.now() - H.lastInput > IDLE_MS;
    return bad ? 'bad' : idle ? 'idle' : 'ok';
  }
  function statusText(hl) {
    if (!H.netUp) return 'Nessuna connessione di rete';
    if (H.srvDown) return 'Server non raggiungibile';
    if (!H.aiOk) return H.aiMsg || 'IA non raggiungibile';
    if (hl === 'idle') return 'In pausa — scrivi per riattivare';
    if (H.busy) return 'Sto ragionando…';
    return S.info?.ai?.simulated ? 'Simulazione attiva' : 'IA attiva';
  }
  function paint() {
    const hl = health(); const txt = statusText(hl);
    root.dataset.health = hl; root.dataset.busy = H.busy && hl !== 'bad' ? '1' : '0';
    label.textContent = txt; dot.setAttribute('aria-label', `Stato: ${txt}`);
    if (hl !== lastHealth) { if (hl === 'bad' || lastHealth === 'bad') live.textContent = txt; lastHealth = hl; }
  }
  const touch = () => { const was = health(); H.lastInput = Date.now(); if (was === 'idle') paint(); };
  for (const ev of ['keydown', 'input', 'pointerdown', 'touchstart']) document.addEventListener(ev, touch, { passive: true, capture: true });
  window.addEventListener('online', () => { H.netUp = true; pollHealth(); });
  window.addEventListener('offline', () => { H.netUp = false; paint(); });
  window.addEventListener('omar:net', (e) => { H.netUp = navigator.onLine !== false && (e.detail.up || H.netUp); if (e.detail.up) { H.srvDown = false; H.netUp = navigator.onLine !== false; } else H.srvDown = true; paint(); });
  window.addEventListener('omar:ai', (e) => { H.aiOk = !!e.detail.ok; if (!H.aiOk) H.aiMsg = 'Il modello IA non risponde'; paint(); });
  window.addEventListener('omar:busy', (e) => { H.busy = !!e.detail.busy; if (H.busy) H.lastInput = Date.now(); paint(); });
  async function pollHealth() {
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(4500), cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      const j = await r.json(); H.srvDown = false; H.netUp = navigator.onLine !== false; H.aiOk = !!j.ai?.ok; H.aiMsg = j.ai?.message || '';
    } catch { H.srvDown = true; }
    paint();
  }
  setInterval(pollHealth, HEALTH_EVERY_MS); setInterval(paint, 5000); pollHealth(); paint();

  // ── movimento fluido: la pillola segue il mouse SOLO mentre il puntatore è sopra di essa ──
  const pos = { x: 0, y: 0, s: 1, rx: 0, ry: 0 }; const tgt = { x: 0, y: 0, s: 1, rx: 0, ry: 0 }; let raf = 0; let over = false;
  function frame() {
    const k = 0.14; let moving = false;
    for (const key of ['x', 'y', 's', 'rx', 'ry']) { const d = tgt[key] - pos[key]; pos[key] += d * k; if (Math.abs(d) > (key === 's' ? 0.0005 : 0.02)) moving = true; else pos[key] = tgt[key]; }
    shape.style.transform = `perspective(700px) translate3d(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px, 0) rotateX(${pos.rx.toFixed(2)}deg) rotateY(${pos.ry.toFixed(2)}deg) scale(${pos.s.toFixed(4)})`;
    raf = moving || over ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  shape.addEventListener('pointerenter', (e) => { root.dataset.hover = '1'; if (e.pointerType === 'mouse' || e.pointerType === 'pen') { over = true; kick(); } });
  shape.addEventListener('pointermove', (e) => {
    if (!over || reduceMotion()) return;
    const w = shape.offsetWidth; const hh = shape.offsetHeight;
    const cx = window.innerWidth / 2; const cy = TOP + hh / 2;                // centro NON spostato (il contenitore è fisso)
    const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (w / 2))); const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (hh / 2)));
    const open = state === 'open'; const amp = open ? 0.35 : 1;
    tgt.x = nx * 14 * amp; tgt.y = ny * 7 * amp; tgt.s = open ? 1.003 : 1.025; tgt.ry = nx * 3.5 * amp; tgt.rx = -ny * 2.8 * amp; kick();
  });
  shape.addEventListener('pointerleave', () => { delete root.dataset.hover; over = false; Object.assign(tgt, { x: 0, y: 0, s: 1, rx: 0, ry: 0 }); kick(); });
  root.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) root.dataset.kb = '1'; });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) delete root.dataset.kb; });

  // ── stati e pannelli ──
  function setState(s) {
    state = s; root.dataset.state = s;
    if (s === 'open') requestAnimationFrame(fit); else { shape.style.height = ''; panel.style.maxHeight = ''; }
  }
  function fit() {
    if (state !== 'open') return;
    const maxH = Math.min(window.innerHeight * 0.8, 680); const want = Math.min(BASE_H + inner.offsetHeight + 16, maxH);
    shape.style.height = `${want}px`; panel.style.maxHeight = `${want - BASE_H}px`;
  }
  new ResizeObserver(fit).observe(inner); window.addEventListener('resize', fit);
  function open(name, btn) {
    hideChip(); view = name; lastBtn = btn || lastBtn; clear(inner); inner.dataset.view = name;
    ({ history: viewHistory, group: viewGroup, explain: viewExplain })[name]();
    setState('open'); markActive(); panel.scrollTop = 0;
    requestAnimationFrame(() => (inner.querySelector('textarea, select, input') || panel).focus({ preventScroll: true }));
  }
  function close({ restoreFocus = false } = {}) {
    if (state !== 'open') return;
    ex.token++; view = null; setState('idle'); markActive(); // un'eventuale richiesta di spiegazione in corso viene ignorata
    if (restoreFocus) lastBtn?.focus?.();
  }
  document.addEventListener('pointerdown', (e) => { if (state === 'open' && !root.contains(e.target) && !e.target.closest?.('dialog')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state === 'open' && !document.querySelector('dialog[open]')) close({ restoreFocus: true }); });

  // ── barra di navigazione ──
  const ITEMS = [
    { id: 'home', label: 'Nuova chat', ic: 'edit', href: '#/home' },
    { id: 'history', label: 'Cronologia', ic: 'clock', panel: 'history', route: 'cronologia' },
    { id: 'materiali', label: 'Materiali', ic: 'file', href: '#/materiali' },
    { id: 'projects', label: 'Hub di progetto', ic: 'board', href: '#/projects' },
    { id: 'planner', label: 'Planner', ic: 'calendar', href: '#/planner' },
    { id: 'bulletin-board', label: 'Bacheca', ic: 'notice', href: '#/bulletin-board' },
    { id: 'gruppo', label: 'Gruppo e dispositivi', ic: 'users', panel: 'group' },
    { id: 'docente', label: 'Area docente', ic: 'cap', href: '#/docente', teacher: true },
    { id: 'explain', label: 'Spiega o traduci un testo', ic: 'sparkle', panel: 'explain' },
    { id: 'tools', label: 'Quick Tools (Alt+T)', ic: 'tool', action: () => ctx.tools?.toggle() },
    { id: 'account', label: 'Account', ic: 'user', href: '#/account' },
  ];
  function buildBar() {
    clear(bar);
    if (!user) return;
    for (const it of ITEMS) {
      if (it.teacher && !S.isTeacher()) continue;
      const b = h('button', { type: 'button', class: 'isl-btn', dataset: { id: it.id }, 'aria-label': it.label, title: it.label }, icon(it.ic, 19));
      b.addEventListener('click', () => {
        if (it.action) { close(); it.action(); return; }
        if (it.href) { close(); ctx.navigate(it.href); return; }
        if (state === 'open' && view === it.panel) close({ restoreFocus: true }); else open(it.panel, b);
      });
      bar.append(b);
    }
    markActive(); refreshGroup();
  }
  let route = 'home';
  function markActive() {
    for (const b of bar.querySelectorAll('.isl-btn')) {
      const id = b.dataset.id; const it = ITEMS.find((x) => x.id === id);
      const r = route === 'chat' ? 'home' : route === 'privacy' ? 'account' : route;
      const active = (state === 'open' && it.panel === view) || (!(state === 'open') && (id === r || it.route === r) && !it.action);
      if (active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
  }

  // ── pannello: cronologia ──
  function viewHistory() {
    const box = h('div', { class: 'isl-hx' });
    add(inner, [head('Cronologia', h('a', { class: 'isl-link', href: '#/cronologia', onclick: () => close(), text: 'Vedi tutto' })),
      h('button', { class: 'isl-pill primary', type: 'button', onclick: () => { close(); ctx.navigate('#/home'); } }, icon('edit', 16), 'Nuova chat'), box]);
    const cur = /^#\/chat\/([^/]+)/.exec(location.hash)?.[1] || null;
    hx = mountHistory(box, { S, compact: true, currentId: cur, onOpen: () => close() });
  }
  let hx = null;
  // ── pannello: gruppo / collega un dispositivo ──
  function viewGroup() { const box = h('div', { class: 'groupbar isl-group' }); add(inner, [head('Lavora con i compagni'), box]); ctx.renderGroup(box); }
  function setBadge(id, on) { bar.querySelector(`[data-id="${id}"]`)?.classList.toggle('has-dot', !!on); }
  function refreshGroup() {
    setBadge('gruppo', !!S.active);
    if (state === 'open' && view === 'group') { const box = inner.querySelector('.isl-group'); if (box) { clear(box); ctx.renderGroup(box); } }
  }
  const head = (title, extra) => h('div', { class: 'isl-head' }, h('strong', { text: title }), extra, h('button', { class: 'isl-ico', type: 'button', 'aria-label': 'Chiudi il pannello', onclick: () => close({ restoreFocus: true }) }, icon('x', 16)));

  // ── «Spiegami questo»: spiega o traduce un testo (anche trascinato sulla pillola) ──
  const ex = { text: '', action: 'explain', lang: lsGet(LANG_KEY) || 'en', result: null, loading: false, error: null, retryable: true, token: 0, editing: false };
  async function run({ simpler = false } = {}) {
    if (!ex.text.trim()) return;
    const tk = ++ex.token; ex.loading = true; ex.error = null; ex.result = null; drawExplain();
    try { const r = await post('/explain', { text: ex.text, action: ex.action, targetLang: ex.lang, simpler, subjectId: ctx.subjectId() }); if (tk !== ex.token) return; ex.result = r; }
    catch (e) { if (tk !== ex.token) return; ex.error = e.message || 'Errore imprevisto.'; ex.retryable = e.details?.retryable !== false; }
    finally { if (tk === ex.token) { ex.loading = false; drawExplain(); } }
  }
  function viewExplain() { if (!ex.text && recentSelection()) { ex.text = recentSelection(); ex.result = null; ex.error = null; } ex.editing = !ex.text; drawExplain(); }
  function drawExplain() {
    if (view !== 'explain') return;
    const keepFocus = document.activeElement?.tagName === 'TEXTAREA'; const prev = inner.querySelector('textarea')?.value; if (prev != null && ex.editing) ex.text = prev;
    clear(inner);
    const ta = h('textarea', { rows: 3, maxLength: 1200, placeholder: 'Incolla o scrivi qui la parola, la frase o la domanda che non hai capito… oppure trascinala sulla pillola.', 'aria-label': 'Testo da spiegare o tradurre' }); ta.value = ex.text;
    const go = () => { ex.text = ta.value.trim(); ex.editing = false; run(); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    const seg = h('div', { class: 'isl-seg', role: 'group', 'aria-label': 'Cosa fare' }, [['explain', 'Spiega', 'sparkle'], ['translate', 'Traduci', 'languages']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(ex.action === v), onclick: () => { if (ex.action !== v) { ex.action = v; if (ex.text) run(); else drawExplain(); } } }, icon(ic, 16), l)));
    const langSel = ex.action === 'translate' ? h('select', { 'aria-label': 'Lingua di destinazione', onchange: (e) => { ex.lang = e.target.value; lsSet(LANG_KEY, ex.lang); if (ex.text) run(); } }, LANGS.map(([v, l]) => h('option', { value: v, text: l, selected: v === ex.lang }))) : null;
    add(inner, [head('Spiegami questo', ex.result?.simulated && h('span', { class: 'isl-badge', text: 'simulazione' })),
      ex.editing ? [ta, h('div', { class: 'isl-actions' }, h('button', { class: 'isl-pill primary', type: 'button', onclick: go }, icon('sparkle', 16), ex.action === 'translate' ? 'Traduci' : 'Spiega'))]
        : h('blockquote', { class: 'isl-quote' }, h('span', { text: ex.text }), h('button', { class: 'isl-link', type: 'button', text: 'modifica', onclick: () => { ex.editing = true; drawExplain(); } })),
      h('div', { class: 'isl-controls' }, [seg, langSel]),
      ex.loading && h('div', { class: 'isl-skel', role: 'status', 'aria-label': 'Sto elaborando' }, h('i'), h('i'), h('i')),
      ex.error && h('div', { class: 'isl-err', role: 'alert' }, ex.error, ex.retryable && h('button', { class: 'isl-link', type: 'button', text: 'Riprova', onclick: () => run() })),
      ex.result && h('div', { class: 'isl-result' }, renderMarkdown(ex.result.text)),
      ex.result && h('div', { class: 'isl-actions' }, [
        ex.action === 'explain' && h('button', { class: 'isl-pill', type: 'button', onclick: () => run({ simpler: true }) }, 'Spiegalo più semplice'),
        h('button', { class: 'isl-pill', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(ex.result.text); ctx.toast('Copiato.'); } catch { ctx.toast('Impossibile copiare.', 'bad'); } } }, icon('copy', 16), 'Copia')]),
      h('p', { class: 'isl-note', text: 'Non viene salvato nella cronologia. Può sbagliare: confronta con il tuo libro.' })]);
    if (keepFocus || ex.editing) requestAnimationFrame(() => inner.querySelector('textarea')?.focus({ preventScroll: true }));
  }
  function explain(text, { action = 'explain' } = {}) { // apertura da fuori (trascinamento o pulsante sulla selezione)
    ex.text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200); ex.action = action; ex.editing = false; ex.result = null; ex.error = null;
    open('explain', bar.querySelector('[data-id=explain]')); run();
  }

  // ── trascinamento di testo selezionato sulla pillola ──
  const setHot = (on) => shape.classList.toggle('hot', on);
  function endDrag() { if (!dragging) return; dragging = false; dragText = ''; setHot(false); if (state === 'drop') setState('idle'); }
  document.addEventListener('dragstart', () => {
    const sel = String(window.getSelection?.() || '').trim();
    if (!user || !sel || state === 'open') return;
    hideChip(); dragging = true; dragText = sel; setState('drop');
  }, true);
  document.addEventListener('dragend', endDrag, true);
  document.addEventListener('drop', () => setTimeout(endDrag, 0), true);
  const accepts = (e) => dragging || [...(e.dataTransfer?.types || [])].includes('text/plain');
  shape.addEventListener('dragenter', (e) => { if (user && accepts(e)) { e.preventDefault(); setHot(true); } });
  shape.addEventListener('dragover', (e) => { if (user && accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHot(true); } });
  shape.addEventListener('dragleave', (e) => { if (!shape.contains(e.relatedTarget)) setHot(false); });
  shape.addEventListener('drop', (e) => {
    if (!user) return; e.preventDefault(); e.stopPropagation();
    const text = e.dataTransfer.getData('text/plain') || dragText; dragging = false; dragText = ''; setHot(false); setState('idle');
    if (text.trim()) explain(text);
  });

  // ── alternativa senza trascinamento (touch, tastiera): pulsante accanto alla selezione ──
  let selText = ''; let selAt = 0;
  const chip = h('div', { class: 'sel-chip', hidden: true }, [
    h('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { const t = selText; hideChip(); explain(t, { action: 'explain' }); } }, icon('sparkle', 15), 'Spiega'),
    h('button', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { const t = selText; hideChip(); explain(t, { action: 'translate' }); } }, icon('languages', 15), 'Traduci')]);
  const hideChip = () => { chip.hidden = true; };
  const recentSelection = () => (Date.now() - selAt < 30_000 ? selText : '');
  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection(); const t = String(sel || '').replace(/\s+/g, ' ').trim();
      const anchor = sel?.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel?.anchorNode;
      if (!user || !t || t.length > 1200 || sel.rangeCount === 0 || !anchor?.closest?.('#main') || anchor.closest('textarea, input, select')) { hideChip(); return; }
      selText = t; selAt = Date.now();
      const r = sel.getRangeAt(0).getBoundingClientRect(); if (!r.width && !r.height) { hideChip(); return; }
      chip.hidden = false; const cw = chip.offsetWidth || 170;
      chip.style.left = `${Math.max(8, Math.min(window.innerWidth - cw - 8, r.left + r.width / 2 - cw / 2))}px`; chip.style.top = `${Math.max(78, r.top - 46)}px`;
    }, 180);
  });
  document.addEventListener('scroll', hideChip, true);

  // ── API pubblica ──
  document.body.append(root, chip);
  return {
    el: root, explain, refreshGroup, close,
    setUser(u) { user = u; root.dataset.auth = u ? '1' : '0'; close(); buildBar(); },
    setRoute(name) { route = name; markActive(); },
    refreshHistory() { if (state === 'open' && view === 'history') hx?.reload(); },
    setBadge, openPanel: (name) => open(name, bar.querySelector(`[data-id="${name === 'group' ? 'gruppo' : name}"]`)),
    poke: pollHealth,
  };
}
