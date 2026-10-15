// Tutorial di primo accesso — il «palcoscenico».
// Ricostruisce con le STESSE classi dell'interfaccia vera (isola, home, chat, finestre, avvisi) una scena che si muove da sola:
// cursore, scrittura, risposta in diretta. Non è un video registrato e non usa dati reali: è una simulazione di esempio.
// Tutto ciò che accade passa da un orologio che si può mettere in pausa e da un «numero di corsa» che permette di annullare
// una scena a metà (salto, indietro, chiusura) senza lasciare timer o elementi in giro.
import { h, add, clear, renderMarkdown } from './dom.js';
import { icon } from './icons.js';
import { createLiveReply } from './livereply.js';

export const CANCEL = Symbol('tutorial.cancel');
export const SIZES = { landscape: [1200, 740], portrait: [440, 800] };   // dimensioni «logiche» del palco (poi scalato per stare nello schermo)
const NS = 'http://www.w3.org/2000/svg';
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const noop = () => {};
const reducedNow = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const avatar = () => h('img', { class: 'avatar', src: '/img/logo.png', alt: '', width: 32, height: 32, draggable: 'false' });

function cursorSvg() {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 28'); s.setAttribute('width', '24'); s.setAttribute('height', '28');
  const p = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d: 'M3 2.5v19.2l5-4.6 3.4 7.9 3.3-1.4-3.4-7.7H19z', fill: '#fff', stroke: '#111', 'stroke-width': '1.6', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  s.append(p); return s;
}

// «campo di scrittura» finto (un <div>, non un vero textarea): mostra il segnaposto, il testo che si scrive e il cursore lampeggiante
function textbox(placeholder) {
  const txt = h('span', { class: 'tut-txt' });
  const el = h('div', { class: 'tut-ta', dataset: { empty: '1' } }, [h('span', { class: 'tut-ph', text: placeholder }), txt, h('span', { class: 'tut-caret' })]);
  return { el, set(s) { txt.textContent = s; if (s) delete el.dataset.empty; else el.dataset.empty = '1'; }, focus(on) { el.classList.toggle('on', on); } };
}

// campo bianco di scrittura, identico a quello vero (stesse classi): «+», «Cerca», gruppo, microfono (Omar Voice), invio — niente menu di materia
function composerCard({ placeholder, group = null }) {
  const ta = textbox(placeholder);
  const plusBtn = h('div', { class: 'cbtn cplus', 'aria-expanded': 'false' }, icon('plus', 20));
  const cerca = h('div', { class: 'cbtn ccerca', 'aria-pressed': 'false' }, icon('globe', 18), h('span', { text: 'Cerca' }));
  const groupBtn = group ? h('div', { class: 'cbtn cgroup', 'aria-pressed': 'true' }, icon('users', 17), h('span', { class: 'cg-t', text: `Gruppo: ${group}` })) : null;
  const mic = h('div', { class: 'cbtn cmic', 'aria-pressed': 'false' }, icon('mic', 18));
  const send = h('div', { class: 'csend' }, icon('up', 18));
  const items = [['image', 'Immagine', 'Omar la guarda, ne legge il testo e te la spiega. Puoi anche incollarla.'], ['file', 'File', 'PDF, Word, Excel, PowerPoint, CAD (DXF/STEP/STL), codice, ZIP…'], ['folder', 'Aggiungi una cartella', 'Omar legge i file della cartella (fino a 25). Puoi anche trascinarla qui.'], ['link', 'Importa un link', 'L’IA legge la pagina e te la spiega.']]
    .map(([ic, t, d]) => h('div', { class: 'cmenu' }, h('span', { class: 'cm-ico' }, icon(ic, 19)), h('span', { class: 'cm-txt' }, h('strong', { text: t }), h('small', { text: d }))));
  const pop = h('div', { class: 'cpop plus', hidden: true }, items);
  const el = h('div', { class: 'composer-card' }, [ta.el, h('div', { class: 'cbar' }, [plusBtn, cerca, groupBtn, mic, h('span', { class: 'sp' }), send]), pop]);
  return {
    el, ta, plusBtn, cerca, send, items, pop, mic, groupBtn,
    listen(on) { mic.classList.toggle('on', on); },
    focus(on) { el.classList.toggle('tut-focus', on); ta.focus(on); },
    menu(open) { pop.hidden = !open; plusBtn.setAttribute('aria-expanded', String(open)); },
    pressCerca(on) { cerca.setAttribute('aria-pressed', String(on)); },
  };
}

// ── la «pillola» (Dynamic Island) di esempio: stessa struttura e stesse classi di quella vera ──
function mockIsland(H) {
  const dot = h('span', { class: 'isl-dot' });
  const label = h('span', { class: 'isl-label', text: 'IA attiva' });
  const ITEMS = [['home', 'edit'], ['history', 'clock'], ['materiali', 'file'], ['projects', 'board'], ['planner', 'calendar'], ['bacheca', 'notice'], ['gruppo', 'users'], ['explain', 'sparkle'], ['tools', 'tool'], ['account', 'user']];
  const btns = {}; const bar = h('div', { class: 'isl-bar' });
  for (const [id, ic] of ITEMS) { btns[id] = h('div', { class: 'isl-btn', dataset: { id } }, icon(ic, 19)); bar.append(btns[id]); }
  const logo = h('img', { class: 'isl-logo', src: '/img/logo.png', alt: '', width: 28, height: 28, draggable: 'false' });
  const drop = h('div', { class: 'isl-drop' }, icon('sparkle', 26), h('div', null, h('strong', { text: 'Rilascia qui' }), h('span', { text: 'per spiegare o tradurre il testo' })));
  const inner = h('div', { class: 'isl-inner' }); const panel = h('div', { class: 'isl-panel' }, inner);
  const shape = h('div', { class: 'isl-shape' }, [h('div', { class: 'isl-main' }, [logo, bar, label, dot]), drop, panel]);
  const el = h('div', { class: 'island', dataset: { auth: '1', state: 'idle', health: 'ok', busy: '0' } }, shape);
  const mark = (id) => { for (const [k, b] of Object.entries(btns)) { if (k === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); } };
  const fit = () => {
    if (el.dataset.state !== 'open') { shape.style.height = ''; panel.style.maxHeight = ''; return; }
    const want = Math.min(48 + inner.offsetHeight + 16, Math.min(H * 0.82, 680)); shape.style.height = `${want}px`; panel.style.maxHeight = `${want - 48}px`;
  };
  const ro = new ResizeObserver(fit); ro.observe(inner);
  mark('home');
  const api = {
    el, shape, btns, dot, inner,
    status(hl = 'ok', busy = false) {
      el.dataset.health = hl; el.dataset.busy = busy && hl !== 'bad' ? '1' : '0';
      label.textContent = hl === 'bad' ? 'Server non raggiungibile' : hl === 'idle' ? 'In pausa — scrivi per riattivare' : busy ? 'Sto ragionando…' : 'IA attiva';
    },
    hover(on) { if (on) el.dataset.hover = '1'; else delete el.dataset.hover; },
    state(s) { el.dataset.state = s; if (s === 'open') requestAnimationFrame(fit); else fit(); },
    hot(on) { shape.classList.toggle('hot', on); },
    groupDot(on) { btns.gruppo.classList.toggle('has-dot', on); },
    hide(on) { el.style.visibility = on ? 'hidden' : ''; },
    showPanel(name, nodes, activeBtn) { clear(inner); inner.dataset.view = name; add(inner, nodes); mark(activeBtn); api.state('open'); },
    closePanel() { mark('home'); api.state('idle'); },
    mark,
    badge(id, on) { btns[id]?.classList.toggle('has-dot', on); },
    reset() { el.dataset.state = 'idle'; delete el.dataset.hover; api.status('ok'); api.hot(false); api.groupDot(false); api.hide(false); for (const b of Object.values(btns)) b.classList.remove('tut-hot', 'has-dot'); clear(inner); mark('home'); fit(); },
    destroy() { ro.disconnect(); },
  };
  return api;
}

// contenuto dei pannelli dell'isola (stessi testi e classi dei pannelli veri)
const panelHead = (title) => h('div', { class: 'isl-head' }, h('strong', { text: title }), h('div', { class: 'isl-ico' }, icon('x', 16)));
export const panels = {
  group(connected) {
    const bar = connected
      ? h('div', { class: 'groupbar isl-group' }, [h('div', { class: 'row' }, h('span', { class: 'dot on' }), h('span', { text: 'Connesso' })), h('strong', { text: 'Gruppo: Mulino a vento' }), h('span', { text: '3 partecipanti · 2 online' }),
        h('div', { class: 'row' }, [h('div', { class: 'btn sm', text: 'Partecipanti' }), h('div', { class: 'btn sm', text: 'Apri' })]), h('div', { class: 'btn sm danger', text: 'Esci dal gruppo' })])
      : h('div', { class: 'groupbar isl-group' }, [h('span', { class: 'muted', text: 'Collega i dispositivi tuoi e dei compagni per lavorare a un progetto. Le chat restano personali: condividi solo ciò che scegli.' }), h('div', { class: 'btn primary sm', text: 'Collega un dispositivo' })]);
    return [panelHead('Lavora con i compagni'), bar];
  },
  explain({ text, loading = false, result = null }) {
    const seg = h('div', { class: 'isl-seg' }, [['Spiega', 'sparkle', true], ['Traduci', 'languages', false]].map(([l, ic, on]) => h('div', { class: 'tut-segbtn', 'aria-pressed': String(on) }, icon(ic, 16), l)));
    return [panelHead('Spiegami questo'), h('blockquote', { class: 'isl-quote' }, h('span', { text }), h('span', { class: 'isl-link', text: 'modifica' })), h('div', { class: 'isl-controls' }, seg),
      loading && h('div', { class: 'isl-skel' }, h('i'), h('i'), h('i')),
      result && h('div', { class: 'isl-result' }, renderMarkdown(result)),
      result && h('div', { class: 'isl-actions' }, [h('div', { class: 'isl-pill' }, 'Spiegalo più semplice'), h('div', { class: 'isl-pill' }, icon('copy', 16), 'Copia')]),
      h('p', { class: 'isl-note', text: 'Non viene salvato nella cronologia. Può sbagliare: confronta con il tuo libro.' })];
  },
};

export function createStage({ layout = 'landscape', onSay = noop } = {}) {
  const [W, H] = SIZES[layout]; const reduced = reducedNow();
  let run = 0; let paused = false; let sceneMs = 0; let alive = true; const held = []; let speed = 1;

  const isl = mockIsland(H);
  const screen = h('div', { class: 'tut-screen' });
  const layer = h('div', { class: 'tut-layer' });
  const toasts = h('div', { class: 'tut-toasts' });
  const cardBox = h('div', { class: 'tut-cardbox' });
  const cursor = h('div', { class: 'tut-cursor', hidden: true }, cursorSvg());
  const el = h('div', { class: 'tut-stage', dataset: { layout }, style: `width:${W}px;height:${H}px`, 'aria-hidden': 'true' }, [h('div', { class: 'tut-wm', text: 'Omar' }), screen, isl.el, layer, toasts, cardBox, cursor]);
  el.inert = true;   // il palco è solo da guardare: niente focus, niente clic, niente lettori di schermo (le didascalie raccontano la scena)

  // ── orologio: avanza solo se non è in pausa; ogni attesa viene annullata quando cambia il «numero di corsa» ──
  const tween = (ms, fn) => new Promise((res, rej) => {
    const my = run; let acc = 0; let last = performance.now();
    const frame = (now) => {
      if (my !== run) { rej(CANCEL); return; }
      const dt = Math.min(now - last, 100); last = now; if (!paused) acc += dt * speed;
      const t = ms > 0 ? Math.min(1, acc / ms) : 1;
      try { fn(t); } catch (e) { rej(e); return; }
      if (t >= 1) res(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  let tl = performance.now();
  const ticker = (now) => { if (!alive) return; const dt = Math.min(now - tl, 100); tl = now; if (!paused) sceneMs += dt * speed; requestAnimationFrame(ticker); };
  requestAnimationFrame(ticker);

  const wait = (ms) => tween(reduced ? Math.min(ms, 30) : ms, noop);   // piccole pause di regia (azzerate con «riduci animazioni»)
  const hold = (ms) => tween(ms, noop);                                  // pause per dare il tempo di leggere (sempre rispettate)
  // tempo di lettura di una didascalia: con calma (circa 14 caratteri al secondo, minimo 3,2 s)
  const readMs = (t) => Math.max(3200, Math.round(String(t).length * 72));
  const narrate = async (t, extra = 0) => { onSay(t); await hold(readMs(t) + extra); };

  // ── cursore ──
  let cp = { x: W * 0.84, y: H * 0.88 };
  const place = (p) => { cp = { x: p.x, y: p.y }; cursor.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; };
  place(cp);
  const at = (node, ax = 0.5, ay = 0.5) => {
    const r = node.getBoundingClientRect(); const s = el.getBoundingClientRect(); const f = s.width / W || 1;
    return { x: (r.left - s.left + r.width * ax) / f, y: (r.top - s.top + r.height * ay) / f };
  };
  async function move(target, { dur = 1100, ax = 0.5, ay = 0.5 } = {}) {
    dur *= 1.25; // il cursore si muove con calma, per poterlo seguire
    cursor.hidden = false;
    const to = target instanceof Element ? at(target, ax, ay) : target; const from = { ...cp };
    if (reduced || dur <= 0) { place(to); return; }
    const dx = to.x - from.x; const dy = to.y - from.y; const dist = Math.hypot(dx, dy) || 1;
    const bend = Math.min(60, dist * 0.14) * (dx > 0 ? -1 : 1);
    const cx = (from.x + to.x) / 2 + (-dy / dist) * bend; const cy = (from.y + to.y) / 2 + (dx / dist) * bend;
    await tween(Math.max(260, dur * (0.55 + 0.45 * Math.min(1, dist / 600))), (t) => {
      const e = ease(t); const u = 1 - e;
      place({ x: u * u * from.x + 2 * u * e * cx + e * e * to.x, y: u * u * from.y + 2 * u * e * cy + e * e * to.y });
    });
  }
  async function click() {
    const r = h('span', { class: 'tut-ripple' }); cursor.append(r); cursor.classList.add('down');
    await wait(140); cursor.classList.remove('down'); setTimeout(() => r.remove(), 800);
  }
  const press = (on) => cursor.classList.toggle('down', on);
  async function type(set, text, { cps = 13 } = {}) {
    if (reduced) { set(text); return; }
    let s = '';
    for (const ch of [...text]) { s += ch; set(s); await tween(rnd(0.6, 1.5) * (1000 / cps) + (/[,.?;:]/.test(ch) ? 110 : 0), noop); }
  }

  // ── elementi di scena ──
  const mount = (node) => { clear(screen); screen.className = 'tut-screen'; el.dataset.view = node.classList.contains('tut-view') ? 'home' : 'other'; screen.append(node); return node; };   // il logo «Omar» dello sfondo si vede solo nella home, come nell'app
  const toast = (text, host = toasts) => { const t = h('div', { class: 'toast fresh', text }); host.append(t); return { el: t, remove: () => t.remove() }; };
  function dialog(title, body, actions, host = layer) {
    const dlg = h('dialog', null, [h('h2', { text: title }), body, h('div', { class: 'row', style: 'margin-top:1rem;justify-content:flex-end' }, actions.map((a) => h('div', { class: `btn ${a.primary ? 'primary' : ''}`, text: a.label })))]);
    const wrap = h('div', { class: 'tut-dlgwrap' }, dlg); host.append(wrap); dlg.show();
    return { wrap, dlg, btn: (label) => [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === label), close: () => wrap.remove() };
  }
  let tipWrap = null;
  function tip(node, text) {
    tipWrap?.remove(); tipWrap = null; if (!node) return;
    const p = at(node); tipWrap = h('div', { class: 'tut-tipwrap' }, h('div', { class: 'tut-tip fresh', text })); tipWrap.style.left = `${p.x}px`; tipWrap.style.top = `${p.y + 30}px`; layer.append(tipWrap);
  }
  let cardEl = null;
  function card(spec) {
    cardEl?.remove(); cardEl = null; screen.classList.toggle('dim', !!spec); if (!spec) return;
    cardEl = h('div', { class: 'tut-card fresh' }, [spec.logo && h('img', { class: 'tut-card-logo', src: '/img/logo.png', alt: '', width: 60, height: 60 }), h('h3', { text: spec.title }), spec.text && h('p', { text: spec.text }), spec.items && h('ul', null, spec.items.map((t) => h('li', { text: t })))]);
    cardBox.append(cardEl);
  }
  async function fly(fromEl, toEl, { dur = 1100 } = {}) {
    const a = at(fromEl); const b = at(toEl); const t = h('div', { class: 'tut-token' }, icon('file', 18)); layer.append(t);
    const sag = layout === 'portrait' ? 40 : 80;
    await tween(reduced ? 30 : dur, (u) => { const e = ease(u); const s = Math.sin(Math.PI * e); t.style.transform = `translate(${a.x + (b.x - a.x) * e}px,${a.y + (b.y - a.y) * e - s * sag}px) translate(-50%,-50%) scale(${1 + s * 0.3})`; });
    t.remove();
  }
  function selChip(node) {
    const p = at(node, 0.5, 0);
    const c = h('div', { class: 'sel-chip tut-selchip' }, [h('div', { class: 'tut-chipbtn' }, icon('sparkle', 15), 'Spiega'), h('div', { class: 'tut-chipbtn' }, icon('languages', 15), 'Traduci')]);
    c.style.left = `${Math.max(8, Math.min(W - 190, p.x - 85))}px`; c.style.top = `${Math.max(70, p.y - 50)}px`; layer.append(c);
    return { remove: () => c.remove() };
  }
  const ghost = (text) => { const g = h('div', { class: 'tut-ghost', text }); cursor.append(g); return { remove: () => g.remove() }; };

  // ── vista «home»: saluto e campo di scrittura ──
  function home({ group = null } = {}) {
    const c = composerCard({ placeholder: 'Scrivi l’esercizio, la domanda o cosa non ti torna…', group });
    const hero = h('div', { class: 'hero' }, [h('h1', { text: 'Come posso aiutarti oggi?' }), c.el, h('p', { class: 'hint-line', text: 'Scrivi pure come ti viene: capisco da solo la materia e se ti serve una spiegazione, una guida all’esercizio o un ripasso.' })]);
    mount(h('div', { class: 'tut-view tut-enter' }, hero));
    return c;
  }

  // ── vista «chat»: conversazione con risposta in diretta ──
  const SUBJ_COL = { Meccanica: '#ffb454', Meccatronica: '#8ab4ff', 'Disegno industriale tridimensionale': '#7be0a8', 'Omar AI': '#9aa0ad' };
  function chat({ title = 'Meccanica', topic = null, mode = 'Guida all’esercizio', project = false, host = null, intro = false } = {}) {
    const msgs = h('div', { class: 'msgs' });
    const c = composerCard({ placeholder: 'Scrivi il tuo ragionamento, i dati o la domanda…' });
    const det = h('div', { class: 'cdet' });
    const drawDet = (d, flash) => { clear(det); add(det, [h('span', { class: 'cd-dot', style: `background:${SUBJ_COL[d.title] || '#9aa0ad'}` }), h('strong', { class: 'cd-s', text: d.title }), d.topic && h('span', { class: 'cd-t', text: d.topic }), d.mode && h('span', { class: 'badge auto', text: d.mode }), h('span', { class: 'cd-i', text: '?' })]);
      if (flash) { det.classList.remove('flash'); void det.offsetWidth; det.classList.add('flash'); } };
    drawDet({ title, topic, mode });
    const head = h('div', { class: 'chathead' }, [det, h('span', { style: 'flex:1' }), h('div', { class: 'btn sm', text: 'I miei progressi' }), project && h('div', { class: 'btn sm', text: 'Condividi una sintesi' })]);
    const quick = h('div', { class: 'quick' }, ['Dammi un indizio', 'Spiegalo più semplicemente', 'Fammi una domanda di verifica'].map((t) => h('div', { class: 'btn sm', text: t })));
    const foot = h('div', { class: 'foot', text: 'Omar AI può sbagliare: controlla sempre unità, risultati e fonti. Non capisci una parola? Selezionala e trascinala sulla pillola.' });
    const root = h('div', { class: 'chat tut-chat tut-enter' }, [head, msgs, h('div', { class: 'composer' }, [quick, c.el, foot])]);
    if (host) host.append(root); else mount(root);
    if (intro) msgs.append(h('div', { class: 'empty-chat intro' }, h('h2', { text: 'Di cosa hai bisogno?' }), h('p', { text: 'Scrivi l’esercizio o la domanda come ti viene: capisco da solo la materia e il tipo di aiuto.' })));
    const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
    return {
      el: root, msgs, composer: c, head, det, quick, scroll, detect: (d) => drawDet(d, true),
      addUser(text, { share = false } = {}) {
        const m = h('article', { class: 'msg user fresh' }, h('div', { text, style: 'white-space:pre-wrap' }));
        if (share) m.append(h('div', { class: 'meta' }, [h('div', { class: 'btn sm ghost', text: 'Condividi con il gruppo' }), h('div', { class: 'btn sm ghost', text: 'Escludi' })]));
        msgs.querySelector('.empty-chat')?.remove(); msgs.append(m); scroll(); return m;
      },
      assistant(text, { chips = [], notice = null } = {}) {   // messaggio definitivo (come quello salvato)
        const body = h('div', { class: 'body' }, renderMarkdown(text, { onCite: noop }));
        body.append(h('div', { class: 'meta' }, [h('div', { class: 'btn sm ghost speak' }, icon('volume', 15)), ...chips.map((t) => h('span', { class: 'src', text: t }))]));
        if (notice) body.append(h('div', { class: 'notice', role: 'note', text: notice }));
        const m = h('article', { class: 'msg assistant' }, [avatar(), body]); msgs.querySelector('.empty-chat')?.remove(); msgs.append(m); scroll(); return m;
      },
      live() { const lr = createLiveReply({ avatar: avatar(), onPaint: scroll, slowMs: 0 }); msgs.querySelector('.empty-chat')?.remove(); msgs.append(lr.el); scroll(); return lr; },
      settle(lr, text, opts) { const m = this.assistant(text, opts); lr.el.replaceWith(m); lr.destroy(); scroll(); return m; },
    };
  }

  // ── pagina "a scheda" (come le pagine vere: Materiali, Hub, Planner, Bacheca, Account) ──
  function sheet(node, { wide = false } = {}) { return mount(h('div', { class: `sheet tut-sheet tut-enter${wide ? ' wide' : ''}` }, node)); }

  // ── due dispositivi affiancati (Cross-Chat Sync): su schermi stretti se ne vede uno alla volta ──
  function devices() {
    screen.classList.add('split'); el.dataset.view = 'other';
    const mk = (who, name, sub) => {
      const body = h('div', { class: 'tut-devbody' }); const toastHost = h('div', { class: 'tut-toasts in-dev' });
      const tag = h('div', { class: 'tut-devtag' }, [h('span', { class: 'tut-ini', text: name[0] }), h('strong', { text: name }), h('span', { class: 'tut-devsub', text: sub })]);
      return { who, body, toastHost, tag, el: h('section', { class: 'tut-dev', dataset: { who } }, [tag, body, toastHost]) };
    };
    const marco = mk('marco', 'Marco', 'dispositivo di Marco'); const elia = mk('elia', 'Elia', 'il tuo dispositivo');
    const hub = h('div', { class: 'tut-hub' }, [h('span', { class: 'dot on' }), h('strong', { text: 'Gruppo: Mulino a vento' }), h('span', { class: 'tut-hub-n', text: '3 partecipanti · 2 online' })]);
    clear(screen); screen.append(hub, h('div', { class: 'tut-devs tut-enter' }, [marco.el, elia.el]));
    const map = { marco, elia };
    const focus = (who) => { for (const d of Object.values(map)) { if (d.who === who) d.el.dataset.active = '1'; else delete d.el.dataset.active; } };
    focus('marco');
    return { marco, elia, hub, focus };
  }

  // ── controllo del player ──
  function setPaused(p) {
    if (p === paused) return; paused = p; el.classList.toggle('is-paused', p);
    const anims = el.getAnimations ? el.getAnimations({ subtree: true }) : [];
    if (p) { for (const a of anims) if (a.playState === 'running') { a.pause(); held.push(a); } }
    else { for (const a of held.splice(0)) if (a.playState === 'paused') a.play(); }   // riprende solo ciò che ha fermato lui
  }
  function reset() {
    clear(screen); screen.className = 'tut-screen'; el.dataset.view = 'home'; clear(layer); clear(toasts); clear(cardBox); tipWrap = null; cardEl = null;
    isl.reset(); cursor.hidden = true; cursor.classList.remove('down'); for (const n of [...cursor.querySelectorAll('.tut-ripple,.tut-ghost')]) n.remove();
    place({ x: W * 0.84, y: H * 0.88 }); sceneMs = 0; el.classList.remove('tut-fade');
  }
  const cancel = () => { run++; };

  // API vista dalle scene: ogni funzione verifica che la scena sia ancora quella in corso (altrimenti si ferma subito)
  const kit = {
    layout, W, H, isPortrait: layout === 'portrait', reduced,
    say: (t) => onSay(t), narrate, readMs, elapsed: () => sceneMs, wait, hold, move, click, press, type, at, mount, sheet, home, chat, devices, dialog, toast, tip, card, fly, selChip, ghost,
    island: { status: isl.status, hover: isl.hover, state: isl.state, hot: isl.hot, groupDot: isl.groupDot, hide: isl.hide, showPanel: isl.showPanel, closePanel: isl.closePanel, mark: isl.mark, badge: isl.badge },
    shape: isl.shape, btns: isl.btns, dot: isl.dot, panels,
    screen, layer, toasts,
  };
  const guard = (src, id) => {
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'function') out[k] = (...a) => { if (id !== run) throw CANCEL; return v(...a); };
      else if (v && typeof v === 'object' && !(v instanceof Node) && k === 'island') out[k] = guard(v, id);
      else out[k] = v;
    }
    return out;
  };
  return {
    el, layout, W, H, reduced,
    scene: () => guard(kit, run),
    cancel, reset, setPaused, beat: (ms) => tween(ms, noop), setSpeed(x) { speed = x; }, get speed() { return speed; },
    fade(on) { el.classList.toggle('tut-fade', on); },
    sceneTime: () => sceneMs, get paused() { return paused; },
    destroy() { alive = false; run++; isl.destroy(); el.remove(); },
  };
}
