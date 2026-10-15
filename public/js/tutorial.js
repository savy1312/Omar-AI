// VIDEO TUTORIAL di Omar AI: un unico video guidato, a tutto schermo, che spiega con calma e passo per passo tutte le funzioni.
// Non è un file video registrato: è una simulazione animata disegnata dall'app (stesse classi dell'interfaccia vera) con dati di esempio,
// divisa in capitoli che scorrono uno dopo l'altro senza interruzioni, con sottotitoli. Si apre da sola al primo accesso di ogni account
// (vedi tutorial-state.js) e si può rivedere dall'Account.
// Comandi come in un lettore video: play/pausa, capitolo precedente/successivo, barra del tempo con i capitoli (clic per saltare),
// velocità 0,75× · 1× · 1,25×, «Salta», «Ho capito, inizia ad usare l'IA». Tastiera: Spazio/K (pausa), frecce (capitoli), Esc (salta).
import { h } from './dom.js';
import { icon } from './icons.js';
import { markTutorialSeen } from './tutorial-state.js';
import { createStage, CANCEL, SIZES } from './tutorial-stage.js';
import { SCENES } from './tutorial-scenes.js';

let cssLoaded = null;
function ensureCss() {   // lo stile del tutorial si scarica solo quando serve
  if (!cssLoaded) cssLoaded = new Promise((resolve, reject) => {
    const l = h('link', { rel: 'stylesheet', href: '/css/tutorial.css' });
    l.onload = () => resolve(); l.onerror = () => { cssLoaded = null; l.remove(); reject(new Error('Stile del tutorial non disponibile.')); };
    document.head.append(l);
  });
  return cssLoaded;
}
const layoutFor = () => (window.innerWidth < 720 || window.innerHeight > window.innerWidth * 1.1 ? 'portrait' : 'landscape');
const SPEEDS = [0.75, 1, 1.25];
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Mostra il video e restituisce 'done' («Ho capito») o 'skipped' («Salta»/Esc). In entrambi i casi lo segna come visto.
export async function showTutorial({ user, replay = false } = {}) {
  await ensureCss();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const TOTAL = SCENES.reduce((n, s) => n + s.est, 0);
    const START = SCENES.map((_, i) => SCENES.slice(0, i).reduce((n, s) => n + s.est, 0));
    let layout = layoutFor(); let stage = null; let idx = 0; let token = 0; let userPaused = false; let ended = false; let closed = false; let raf = 0;
    let speed = 1; try { speed = SPEEDS.includes(+localStorage.getItem('omar.tutorial.speed')) ? +localStorage.getItem('omar.tutorial.speed') : 1; } catch { /* ignora */ }

    // ── struttura ──
    const chapter = h('div', { class: 'tut-scene', 'aria-hidden': 'true' });
    const cap = h('p', { class: 'tut-cap', id: 'tut-cap', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const chip = h('div', { class: 'tut-chip', 'aria-hidden': 'true' });
    const fit = h('div', { class: 'tut-fit', title: 'Clic per mettere in pausa o riprendere' }, chip);
    const view = h('div', { class: 'tut-viewport' }, fit);
    const btn = (cls, label, ic, onclick) => h('button', { class: cls, type: 'button', 'aria-label': label, title: label, onclick }, icon(ic, 18));
    const play = btn('tut-ic tut-play', 'Pausa', 'pause', () => togglePause());
    const prev = btn('tut-ic', 'Capitolo precedente', 'prev', () => go(idx - 1));
    const next = btn('tut-ic', 'Capitolo successivo', 'next', () => go(idx + 1));
    const time = h('span', { class: 'tut-time', 'aria-hidden': 'true' });
    const fill = h('i', { class: 'tut-fill' });
    const tipEl = h('span', { class: 'tut-bartip', hidden: true });
    const marks = SCENES.map((s, i) => h('button', { class: 'tut-mark', type: 'button', style: `left:${(START[i] / TOTAL) * 100}%;width:${(s.est / TOTAL) * 100}%`, 'aria-label': `Capitolo ${i + 1}: ${s.title}`, title: `${i + 1}. ${s.title}`, onclick: (e) => { e.stopPropagation(); go(i); } }));
    const bar = h('div', { class: 'tut-bar', role: 'group', 'aria-label': 'Capitoli del video' }, [h('div', { class: 'tut-track' }, fill), ...marks, tipEl]);
    bar.addEventListener('pointermove', (e) => { const r = bar.getBoundingClientRect(); const t = ((e.clientX - r.left) / r.width) * TOTAL; const i = Math.max(0, START.findLastIndex((s) => s <= t)); tipEl.hidden = false; tipEl.textContent = `${i + 1}. ${SCENES[i].title}`; tipEl.style.left = `${Math.min(Math.max(e.clientX - r.left, 60), r.width - 60)}px`; });
    bar.addEventListener('pointerleave', () => { tipEl.hidden = true; });
    const speedBtn = h('button', { class: 'tut-speed', type: 'button', onclick: () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]) });
    const skip = h('button', { class: 'tut-skip', type: 'button', text: replay ? 'Chiudi' : 'Salta il video', onclick: () => close('skipped') });
    const done = h('button', { class: 'tut-done', type: 'button', text: replay ? 'Ho capito' : 'Ho capito, inizia ad usare l’IA', onclick: () => close('done') });
    const root = h('div', { class: 'tut tut-video', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tut-title', 'aria-describedby': 'tut-cap', tabindex: '-1' }, [
      h('header', { class: 'tut-top' }, [
        h('img', { class: 'tut-logo', src: '/img/logo.png', alt: '', width: 30, height: 30 }),
        h('div', { class: 'tut-heading' }, h('h2', { id: 'tut-title', text: replay ? 'Video tutorial di Omar AI' : 'Benvenuto in Omar AI' }), h('span', { class: 'tut-badge', text: `Video guidato · ${mmss(TOTAL)} · dati di esempio` })),
        skip]),
      view,
      h('div', { class: 'tut-caption' }, [chapter, cap]),
      h('footer', { class: 'tut-ctl' }, [h('div', { class: 'tut-nav' }, [prev, play, next]), time, bar, speedBtn, done]),
    ]);

    // ── il resto dell'app resta fermo e fuori dalla portata di tastiera e lettori di schermo ──
    const inerted = [...document.body.children].filter((n) => n.tagName !== 'SCRIPT' && n.id !== 'toasts' && !n.hasAttribute('inert'));
    for (const n of inerted) n.inert = true;
    document.body.append(root);

    // ── lettore ──
    const say = (t) => { if (cap.textContent === t) return; cap.classList.remove('in'); void cap.offsetWidth; cap.textContent = t; cap.classList.add('in'); };
    function mount() {
      stage?.destroy(); stage = createStage({ layout, onSay: say }); fit.replaceChildren(stage.el, chip); resize();
      stage.setPaused(userPaused); stage.setSpeed(speed);
    }
    function resize() {
      if (!stage) return;
      const [W, H] = SIZES[stage.layout]; const r = view.getBoundingClientRect();
      const s = Math.max(0.15, Math.min((r.width - 8) / W, (r.height - 4) / H, 1.5));
      fit.style.width = `${Math.round(W * s)}px`; fit.style.height = `${Math.round(H * s)}px`; stage.el.style.transform = `scale(${s})`;
    }
    function setSpeed(x) { speed = x; stage?.setSpeed(x); try { localStorage.setItem('omar.tutorial.speed', String(x)); } catch { /* ignora */ } updateUi(); }
    function updateUi() {
      chapter.textContent = `Capitolo ${idx + 1} di ${SCENES.length} · ${SCENES[idx].title}`;
      marks.forEach((m, i) => { m.classList.toggle('done', i < idx || ended); m.classList.toggle('cur', i === idx && !ended); if (i === idx) m.setAttribute('aria-current', 'step'); else m.removeAttribute('aria-current'); });
      prev.disabled = idx === 0; next.disabled = idx === SCENES.length - 1;
      const label = ended ? 'Rivedi dall’inizio' : userPaused ? 'Riproduci' : 'Pausa';
      play.setAttribute('aria-label', label); play.title = label; play.replaceChildren(icon(ended ? 'replay' : userPaused ? 'play' : 'pause', 18));
      speedBtn.textContent = `${String(speed).replace('.', ',')}×`; speedBtn.setAttribute('aria-label', `Velocità ${String(speed).replace('.', ',')} volte: clic per cambiare`); speedBtn.title = 'Velocità del video';
      root.classList.toggle('is-ended', ended); root.classList.toggle('is-paused', userPaused && !ended);
    }
    function progress() {   // la barra del tempo avanza come in un video (stimata sulla durata attesa di ogni capitolo)
      raf = requestAnimationFrame(progress);
      if (!stage) return;
      const t = ended ? TOTAL : START[idx] + Math.min(SCENES[idx].est * 0.985, stage.sceneTime());
      fill.style.width = `${((t / TOTAL) * 100).toFixed(2)}%`; time.textContent = `${mmss(t)} / ${mmss(TOTAL)}`;
    }
    function showChip() { chip.textContent = `${idx + 1} · ${SCENES[idx].title}`; chip.classList.remove('show'); void chip.offsetWidth; chip.classList.add('show'); }
    async function playScene(n) {
      const my = ++token; idx = Math.max(0, Math.min(SCENES.length - 1, n)); ended = false;
      stage.cancel(); stage.reset(); say(''); updateUi(); showChip();
      try { stage.fade(false); await SCENES[idx].run(stage.scene()); }
      catch (e) { if (e === CANCEL) return; console.error('tutorial', e); }
      if (my !== token || closed) return;
      if (idx < SCENES.length - 1) {   // passaggio morbido al capitolo successivo: dissolvenza breve, poi si continua senza fermarsi
        try { stage.fade(true); await stage.beat(stage.reduced ? 0 : 450); } catch { return; }
        if (my === token && !closed) playScene(idx + 1);
      } else { ended = true; updateUi(); }
    }
    const go = (n) => { if (n < 0 || n > SCENES.length - 1) return; playScene(n); };
    function togglePause() {
      if (ended) { go(0); return; }
      userPaused = !userPaused; stage.setPaused(userPaused); updateUi();
    }
    function close(how, save = true) {
      if (closed) return; closed = true; token++; cancelAnimationFrame(raf);
      if (save) markTutorialSeen(user);   // completato o saltato = visto; se la sessione scade a metà (logout) non conta
      stage?.destroy(); ro.disconnect(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onWin); window.removeEventListener('omar:logout', onLogout);
      root.classList.add('closing');
      setTimeout(() => { root.remove(); for (const n of inerted) n.inert = false; try { if (prevFocus && prevFocus !== document.body && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch { /* ignora */ } resolve(how); }, 260);
    }
    function onKey(e) {
      if (closed) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('skipped'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
      else if ((e.key === ' ' || e.key === 'k') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); togglePause(); }
    }
    let winTimer = 0;
    function onWin() {   // se lo schermo passa da largo a stretto (o viceversa) il capitolo si ricostruisce nel formato giusto
      clearTimeout(winTimer);
      winTimer = setTimeout(() => { const l = layoutFor(); if (l !== layout) { layout = l; mount(); playScene(idx); } else resize(); }, 120);
    }
    const onLogout = () => close('closed', false);   // sessione scaduta mentre il video è aperto: si chiude senza segnarlo come visto
    const ro = new ResizeObserver(() => resize()); ro.observe(view);
    window.addEventListener('omar:logout', onLogout);
    document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onWin);
    fit.addEventListener('click', () => togglePause());

    mount(); updateUi(); root.focus({ preventScroll: true });
    raf = requestAnimationFrame(progress);
    playScene(0);
  });
}
