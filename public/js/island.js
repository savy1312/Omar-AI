// Barra laterale stile Claude: navigazione, conversazioni recenti, stato IA e account.
// Sostituisce la Dynamic Island mantenendo la stessa API pubblica usata da app.js
// (el, explain, refreshGroup, close, setUser, setRoute, refreshHistory, setBadge, openPanel, poke)
// e le stesse funzioni (cronologia, gruppo, «Spiegami questo», trascinamento testo, salute IA).
import { h, add, clear, confirmDialog, renderMarkdown, fmtDate } from './dom.js';
import { get, post, api, auth } from './api.js';
import { icon } from './icons.js';
import { mountHistory } from './history.js';

export const IDLE_MS = 60_000;          // dopo questo tempo senza scrivere la spia diventa arancione
const HEALTH_EVERY_MS = 20_000;         // controllo periodico di server e modello IA
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
  // la spia è anche un pulsante: quando è rossa, un clic riprova subito la connessione
  const dot = h('button', { type: 'button', class: 'side-dot', 'aria-label': 'Stato: IA attiva', dataset: { tip: 'IA attiva' }, onclick: (e) => { e.stopPropagation(); if (root.dataset.health === 'bad') { dot.dataset.tip = 'Riprovo…'; pollHealth(); } } });
  const label = h('span', { class: 'side-status', 'aria-hidden': true });
  const waveBars = Array.from({ length: 7 }, () => h('i'));
  const wave = h('span', { class: 'side-wave', 'aria-hidden': true }, waveBars);
  const proj = h('span', { class: 'side-proj', hidden: true }); // gruppo/progetto attivo
  const brand = h('div', { class: 'side-brand' }, [h('img', { class: 'side-logo', src: '/img/favicon.png', alt: '', width: 30, height: 30, 'aria-hidden': true, draggable: 'false' }), h('span', { class: 'side-name', text: 'Omar AI' }), proj]);
  const newChat = h('button', { type: 'button', class: 'side-new', onclick: () => { close(); ctx.navigate('#/home'); } }, icon('edit', 17), h('span', { text: 'Nuova chat' }));
  const nav = h('nav', { class: 'side-nav', 'aria-label': 'Navigazione principale' });
  const hxBox = h('div', { class: 'side-hx' });
  const recents = h('section', { class: 'side-recents', 'aria-label': 'Conversazioni recenti' }, [
    h('div', { class: 'side-sec-head' }, [h('strong', { text: 'Recenti' }), h('a', { class: 'side-mini', href: '#/cronologia', text: 'Vedi tutto' })]), hxBox]);
  const expBody = h('div', { class: 'side-exp-body' });
  const expand = h('section', { class: 'side-expand', hidden: true }, expBody);
  const aux = h('div', { class: 'side-aux', 'aria-live': 'polite' }); // lavori in corso in parallelo
  const status = h('div', { class: 'side-statusrow' }, [dot, label, wave]);
  const quick = h('div', { class: 'side-quick', role: 'group', 'aria-label': 'Azioni rapide' });
  const userLink = h('a', { class: 'side-user', href: '#/account' }, [icon('user', 18), h('span', { class: 'side-username', text: 'Account' })]);
  const foot = h('footer', { class: 'side-foot' }, [status, aux, quick, userLink]);
  const inner = h('div', { class: 'side-inner' }, [brand, newChat, nav, recents, expand, h('div', { class: 'side-fill' }), foot]);
  const toggle = h('button', { type: 'button', class: 'side-toggle', 'aria-label': 'Apri o chiudi il menu', onclick: () => { root.dataset.openM = root.dataset.openM === '1' ? '0' : '1'; } }, icon('list', 22));
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', id: 'isl-live' });
  const root = h('aside', { id: 'island', class: 'side', dataset: { state: 'idle', health: 'ok', auth: '0' } }, [toggle, inner, live]);
  document.body.dataset.auth = '0'; // prima del login: niente sidebar, contenuto a tutta larghezza
  const closeMobile = () => { root.dataset.openM = '0'; };

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
    label.textContent = txt; dot.setAttribute('aria-label', hl === 'bad' ? `Stato: ${txt}. Premi per riprovare` : `Stato: ${txt}`);
    dot.dataset.tip = hl === 'bad' ? `${txt} · clic per riprovare` : txt;
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

  // ── sezione espandibile (gruppo / spiegami questo): sostituisce il pannello dell'isola ──
  function setExpanded(on) {
    state = on ? 'open' : 'idle'; root.dataset.state = state;
    expand.hidden = !on;
    if (on) expand.scrollIntoView({ block: 'nearest' });
  }
  function open(name, btn) {
    hideChip(); view = name; lastBtn = btn || lastBtn; clear(expBody);
    ({ group: viewGroup, explain: viewExplain })[name]();
    setExpanded(true); markActive();
    requestAnimationFrame(() => (expBody.querySelector('textarea, select, input') || expBody).focus?.({ preventScroll: true }));
  }
  function close({ restoreFocus = false } = {}) {
    if (state !== 'open') return;
    ex.token++; view = null; setExpanded(false); markActive(); // un'eventuale richiesta di spiegazione in corso viene ignorata
    if (restoreFocus) lastBtn?.focus?.();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state === 'open' && !document.querySelector('dialog[open]')) close({ restoreFocus: true }); });

  // ── navigazione ──
  const ITEMS = [
    { id: 'home', label: 'Nuova chat', ic: 'home', href: '#/home' },
    { id: 'history', label: 'Cronologia', ic: 'clock', href: '#/cronologia' },
    { id: 'materiali', label: 'Materiali', ic: 'file', href: '#/materiali' },
    { id: 'projects', label: 'Hub di progetto', ic: 'board', href: '#/projects' },
    { id: 'planner', label: 'Planner', ic: 'calendar', href: '#/planner' },
    { id: 'prova', label: 'Mettimi alla prova', tip: 'Mettimi alla prova · interrogazione simulata', ic: 'check', href: '#/prova' },
    { id: 'bulletin-board', label: 'Bacheca', ic: 'notice', href: '#/bulletin-board' },
    { id: 'gruppo', label: 'Gruppo e dispositivi', ic: 'users', panel: 'group' },
    { id: 'docente', label: 'Area docente', ic: 'cap', href: '#/docente', teacher: true },
    { id: 'explain', label: 'Spiega o traduci un testo', ic: 'sparkle', panel: 'explain' },
  ];
  const QUICK = [
    { id: 'tools', label: 'Quick Tools (Alt+T)', ic: 'tool', action: () => ctx.tools?.toggle() },
    { id: 'search', label: 'Cerca ovunque (Ctrl+K)', ic: 'search', action: () => ctx.search?.open() },
    { id: 'lim', label: 'Modalità LIM / proiettore', ic: 'eye', action: () => { ctx.lim?.set(!ctx.lim.on()); } },
  ];
  function navButton(it) {
    const attrs = { type: 'button', class: 'side-link', dataset: { id: it.id, tip: it.tip || it.label }, 'aria-label': it.label };
    if (it.href) return h('a', { ...attrs, class: 'side-link', href: it.href, onclick: () => { close(); closeMobile(); } }, icon(it.ic, 19), h('span', { text: it.label }));
    const b = h('button', attrs, icon(it.ic, 19), h('span', { text: it.label }));
    b.addEventListener('click', () => { if (state === 'open' && view === it.panel) close({ restoreFocus: true }); else open(it.panel, b); });
    return b;
  }
  function buildNav() {
    clear(nav); clear(quick);
    if (!user) return;
    for (const it of ITEMS) {
      if (it.teacher && !S.isTeacher()) continue;
      nav.append(navButton(it));
    }
    for (const q of QUICK) {
      const b = h('button', { type: 'button', class: 'side-icon', dataset: { id: q.id, tip: q.label }, 'aria-label': q.label, title: q.label, onclick: () => { close(); q.action(); } }, icon(q.ic, 18));
      quick.append(b);
    }
    const dark = ctx.theme?.get() === 'dark';
    quick.append(h('button', { type: 'button', class: 'side-icon', 'aria-label': dark ? 'Passa al tema chiaro' : 'Passa al tema scuro', title: dark ? 'Tema chiaro' : 'Tema scuro', onclick: () => { ctx.theme?.set(dark ? 'light' : 'dark'); buildNav(); } }, icon(dark ? 'sun' : 'moon', 18)));
    userLink.querySelector('.side-username').textContent = user.displayName || user.email || 'Account';
    loadRecents(); markActive(); refreshGroup();
  }
  let route = 'home';
  function markActive() {
    for (const b of root.querySelectorAll('.side-link')) {
      const id = b.dataset.id; const it = ITEMS.find((x) => x.id === id);
      const r = route === 'chat' ? 'home' : route === 'privacy' ? 'account' : route;
      const active = (state === 'open' && it.panel === view) || (!(state === 'open') && (id === r || it.route === r) && !it.action);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  // ── conversazioni recenti, sempre visibili ──
  let hx = null;
  function loadRecents() {
    clear(hxBox); hx = null;
    if (!user) return;
    const cur = /^#\/chat\/([^/]+)/.exec(location.hash)?.[1] || null;
    hx = mountHistory(hxBox, { S, compact: true, currentId: cur, onOpen: () => { close(); closeMobile(); } });
  }

  // ── sezione: gruppo / collega un dispositivo ──
  const head = (title, extra) => h('div', { class: 'isl-head' }, h('strong', { text: title }), extra, h('button', { class: 'isl-ico', type: 'button', 'aria-label': 'Chiudi la sezione', onclick: () => close({ restoreFocus: true }) }, icon('x', 16)));
  function viewGroup() { const box = h('div', { class: 'groupbar isl-group' }); add(expBody, [head('Lavora con i compagni'), box]); ctx.renderGroup(box); }
  function setBadge(id, on) { root.querySelector(`[data-id="${id}"]`)?.classList.toggle('has-dot', !!on); }
  function refreshGroup() {
    setBadge('gruppo', !!S.active);
    proj.hidden = !S.active; proj.textContent = S.active ? S.active.name : '';
    if (S.active) root.dataset.proj = '1'; else delete root.dataset.proj;
    if (state === 'open' && view === 'group') { const box = expBody.querySelector('.isl-group'); if (box) { clear(box); ctx.renderGroup(box); } }
  }

  // ── «Spiegami questo»: spiega o traduce un testo (anche trascinato sulla barra) ──
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
    const keepFocus = document.activeElement?.tagName === 'TEXTAREA'; const prev = expBody.querySelector('textarea')?.value; if (prev != null && ex.editing) ex.text = prev;
    clear(expBody);
    const ta = h('textarea', { rows: 3, maxLength: 1200, placeholder: 'Incolla o scrivi qui la parola, la frase o la domanda che non hai capito… oppure trascinala sulla barra.', 'aria-label': 'Testo da spiegare o tradurre' }); ta.value = ex.text;
    const go = () => { ex.text = ta.value.trim(); ex.editing = false; run(); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    const seg = h('div', { class: 'isl-seg', role: 'group', 'aria-label': 'Cosa fare' }, [['explain', 'Spiega', 'sparkle'], ['translate', 'Traduci', 'languages']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(ex.action === v), onclick: () => { if (ex.action !== v) { ex.action = v; if (ex.text) run(); else drawExplain(); } } }, icon(ic, 16), l)));
    const langSel = ex.action === 'translate' ? h('select', { 'aria-label': 'Lingua di destinazione', onchange: (e) => { ex.lang = e.target.value; lsSet(LANG_KEY, ex.lang); if (ex.text) run(); } }, LANGS.map(([v, l]) => h('option', { value: v, text: l, selected: v === ex.lang }))) : null;
    add(expBody, [head('Spiegami questo', ex.result?.simulated && h('span', { class: 'isl-badge', text: 'simulazione' })),
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
    if (keepFocus || ex.editing) requestAnimationFrame(() => expBody.querySelector('textarea')?.focus({ preventScroll: true }));
  }
  function explain(text, { action = 'explain' } = {}) { // apertura da fuori (trascinamento o pulsante sulla selezione)
    ex.text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200); ex.action = action; ex.editing = false; ex.result = null; ex.error = null;
    open('explain', root.querySelector('[data-id=explain]')); run();
  }

  // ── trascinamento di testo selezionato sulla barra ──
  const setHot = (on) => root.classList.toggle('hot', on);
  function endDrag() { if (!dragging) return; dragging = false; dragText = ''; setHot(false); delete root.dataset.drop; }
  document.addEventListener('dragstart', () => {
    const sel = String(window.getSelection?.() || '').trim();
    if (!user || !sel || state === 'open') return;
    hideChip(); dragging = true; dragText = sel; root.dataset.drop = '1';
  }, true);
  document.addEventListener('dragend', endDrag, true);
  document.addEventListener('drop', () => setTimeout(endDrag, 0), true);
  const accepts = (e) => dragging || [...(e.dataTransfer?.types || [])].includes('text/plain');
  root.addEventListener('dragenter', (e) => { if (user && accepts(e)) { e.preventDefault(); setHot(true); } });
  root.addEventListener('dragover', (e) => { if (user && accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHot(true); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) setHot(false); });
  root.addEventListener('drop', (e) => {
    if (!user) return; e.preventDefault(); e.stopPropagation();
    const text = e.dataTransfer.getData('text/plain') || dragText; dragging = false; dragText = ''; setHot(false); delete root.dataset.drop;
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
  // Omar Voice: mentre detti, la barra mostra l'onda sonora del microfono
  window.addEventListener('omar:listen', (e) => { root.dataset.listening = e.detail.on ? '1' : '0'; live.textContent = e.detail.on ? 'Ti ascolto' : ''; if (!e.detail.on) waveBars.forEach((b) => { b.style.height = '4px'; }); });
  window.addEventListener('omar:wave', (e) => { e.detail.levels.forEach((v, i) => { waveBars[i].style.height = `${4 + Math.round(v * 16)}px`; }); });

  // ── pillole ausiliarie: PDF in preparazione, dettatura, calcoli lunghi… ──
  const jobs = new Map();
  function drawAux() {
    clear(aux); const list = [...jobs.values()];
    const shown = list.slice(0, 2);
    for (const j of shown) aux.append(h('div', { class: `isl-pill-aux ${j.kind || ''}`, role: 'status', title: j.label }, [icon(j.icon || 'clock', 15), h('span', { class: 'ipa-t', text: j.label }), j.kind !== 'voice' && h('span', { class: 'ipa-spin', 'aria-hidden': true })]));
    if (list.length > 2) aux.append(h('div', { class: 'isl-pill-aux more', text: `+${list.length - 2}` }));
    root.dataset.aux = String(list.length);
  }
  window.addEventListener('omar:job', (e) => { const d = e.detail || {}; if (!d.id) return; if (d.on) jobs.set(d.id, d); else jobs.delete(d.id); drawAux(); });
  window.addEventListener('omar:listen', (e) => window.dispatchEvent(new CustomEvent('omar:job', { detail: { id: 'voice', on: e.detail.on, label: 'Ti ascolto', icon: 'mic', kind: 'voice' } })));

  // ── suggerimenti: nome del pulsante ──
  const tip = h('div', { class: 'isl-tip', role: 'tooltip', 'aria-hidden': true });
  const showTip = (el) => {
    const t = el?.dataset?.tip; if (!t || state === 'open') { tip.classList.remove('on'); return; }
    const [name, kb] = t.split(' · '); clear(tip); tip.append(name); if (kb) tip.append(h('kbd', { text: kb }));
    const r = el.getBoundingClientRect(); tip.style.left = `${Math.round(r.right + 12)}px`; tip.style.top = `${Math.round(r.top + r.height / 2)}px`; tip.classList.add('on');
  };
  const hideTip = () => tip.classList.remove('on');
  root.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); });
  root.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('[data-tip]')) hideTip(); });
  root.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el?.matches(':focus-visible')) showTip(el); });
  root.addEventListener('focusout', hideTip);
  document.body.append(tip);

  // ── API pubblica ──
  document.body.append(root, chip);
  return {
    el: root, explain, refreshGroup, close,
    setUser(u) { user = u; root.dataset.auth = u ? '1' : '0'; document.body.dataset.auth = u ? '1' : '0'; close(); buildNav(); },
    setRoute(name) { route = name; markActive(); if (route === 'chat' || route === 'home') loadRecents(); },
    refreshHistory() { loadRecents(); },
    setBadge, openPanel: (name) => open(name, root.querySelector(`[data-id="${name === 'group' ? 'gruppo' : name}"]`)),
    poke: pollHealth,
  };
}
