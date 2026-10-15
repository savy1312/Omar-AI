// Risposta del tutor «in diretta»: il testo compare mentre il modello lo scrive (come Gemini), con le fasi di attesa
// (leggo i link, cerco sul web, consulto i materiali), le fonti web già visibili prima della risposta e un cursore che lampeggia.
// Il testo arriva dal server già filtrato dai controlli (blocco tecnico e citazioni inventate non passano mai di qui).
import { h, clear, renderMarkdown } from './dom.js';
import { createThinking } from './thinking.js';
import { icon } from './icons.js';

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

// Divide il testo in parte «chiusa» (finita da una riga vuota, fuori da codice e formule: non cambierà più) e coda ancora in scrittura.
export function splitStable(text) {
  let off = 0; let stable = 0; let fence = false; let math = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]; const last = i === lines.length - 1; const end = off + ln.length + (last ? 0 : 1);
    if (/^```/.test(ln)) fence = !fence;
    else if (!fence) {
      if (!math) { const opens = /^\s*(\$\$|\\\[)/.test(ln); const closesHere = /(\$\$|\\\])\s*$/.test(ln) && ln.trim().length > 4; if (opens && !closesHere) math = true; }
      else if (/(\$\$|\\\])\s*$/.test(ln)) math = false;
    }
    if (!last && !fence && !math && !ln.trim()) stable = end;
    off = end;
  }
  return [text.slice(0, stable), text.slice(stable)];
}

// Nella coda in scrittura: chiude «a vista» ** e ` rimasti aperti e nasconde una formula $…$ non ancora chiusa (compare intera quando è completa).
export function tidyTail(tail) {
  let out = tail; const fenced = (out.match(/```/g) || []).length % 2 === 1;
  if (fenced) return out; // dentro un blocco di codice si mostra il testo così com'è
  const single = out.replace(/\$\$/g, '');
  if ((single.match(/\$/g) || []).length % 2 === 1) { const at = out.lastIndexOf('$'); if (at >= 0 && out.length - at < 90 && !out.slice(at).includes('\n')) out = out.slice(0, at); }
  if ((out.match(/`/g) || []).length % 2 === 1) out += '`';
  if ((out.match(/\*\*/g) || []).length % 2 === 1) out += '**';
  return out;
}

// Fino a dove mostrare: mai a metà di una coppia surrogata o di un riferimento [M1]
export function snap(t, n) {
  if (n >= t.length) return t.length;
  const c = t.charCodeAt(n - 1); if (c >= 0xd800 && c <= 0xdbff) n++;
  if (/\[[MCDPW]?\d*$/.test(t.slice(Math.max(0, n - 6), n))) { const close = t.indexOf(']', n); if (close >= 0 && close - n < 4) n = close + 1; }
  return Math.min(n, t.length);
}

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function createLiveReply({ avatar, web = false, onCite, onPaint, slowMs = 8000 }) {
  const label = h('span', { class: 'tlabel', text: web ? 'Cerco sul web e ragiono…' : 'Sto ragionando…' });
  const status = h('div', { class: 'live-status', role: 'status' }, createThinking(), label);
  const srcBox = h('div', { class: 'websrc live-src', hidden: true });
  const settledEl = h('div', { class: 'md live-settled' }); const tailEl = h('div', { class: 'md live-tail' });
  const caret = h('span', { class: 'caret', 'aria-hidden': true });
  const body = h('div', { class: 'body', 'aria-live': 'off' }, status, srcBox, settledEl, tailEl);
  const el = h('article', { class: 'msg assistant live', 'aria-label': 'Tutor', 'aria-busy': 'true' }, avatar, body);

  let target = ''; let shown = 0; let raf = 0; let done = false; let frozen = false; let settledText = ''; let tailText = null; let waiters = [];
  let started = false;
  // Ollama e simili, a freddo, caricano il modello prima di scrivere: dopo qualche secondo senza testo lo si dice, così non sembra bloccato
  let slow = slowMs > 0 ? setTimeout(() => setLabel('Il modello si sta avviando: la prima risposta può richiedere fino a un minuto…'), slowMs) : 0; // slowMs = 0: nessun avviso (anteprima del tutorial)
  const stopSlow = () => { clearTimeout(slow); slow = 0; };

  const setLabel = (t) => { if (!started) label.textContent = t; };
  const showSources = (w) => {
    if (!w?.sources?.length) return;
    clear(srcBox); srcBox.hidden = false;
    srcBox.append(h('span', { class: 'small muted', text: `Cercato${w.provider ? ` su ${w.provider}` : ' sul web'}${w.query ? `: “${String(w.query).slice(0, 80)}”` : ''}` }));
    for (const s of w.sources) if (safeUrl(s.url)) srcBox.append(h('a', { class: 'src web fresh', href: s.url, target: '_blank', rel: 'noopener noreferrer', title: `${s.title} — ${s.url}` }, icon('globe', 13), s.host));
  };

  function paint() {
    const visible = target.slice(0, shown);
    const [stable, tail] = splitStable(visible);
    if (stable !== settledText) {
      if (stable.startsWith(settledText) && settledText) { // arrivano solo blocchi nuovi: quelli vecchi non si toccano
        const add = renderMarkdown(stable.slice(settledText.length), { onCite });
        for (const k of [...add.children]) { k.classList.add('fresh'); settledEl.append(k); }
      } else { clear(settledEl); for (const k of [...renderMarkdown(stable, { onCite }).children]) settledEl.append(k); }
      settledText = stable;
    }
    const view = tidyTail(tail);
    if (view !== tailText) { tailText = view; clear(tailEl); for (const k of [...renderMarkdown(view, { onCite }).children]) tailEl.append(k); }
    placeCaret();
    onPaint?.();
  }
  // il cursore sta in fondo all'ultimo paragrafo/elemento di lista, non sotto
  function placeCaret() {
    caret.remove(); if (frozen || (done && shown >= target.length)) return;
    let host = tailEl.lastElementChild || settledEl.lastElementChild;
    if (!host) { tailEl.append(caret); return; }
    while (host.lastElementChild && /^(P|UL|OL|LI|BLOCKQUOTE|H3|H4)$/.test(host.lastElementChild.tagName)) host = host.lastElementChild;
    if (!/^(P|LI|BLOCKQUOTE|H3|H4)$/.test(host.tagName)) host = host.parentElement; // codice e formule a blocco: il cursore va sotto, non dentro
    host.append(caret);
  }
  function step() {
    raf = 0; const backlog = target.length - shown;
    if (backlog > 0) { shown = reduced() ? target.length : snap(target, shown + Math.max(2, Math.ceil(backlog / (done ? 4 : 10)))); paint(); }
    if (target.length - shown > 0) raf = requestAnimationFrame(step);
    else if (done) { const w = waiters; waiters = []; for (const r of w) r(); }
  }
  const kick = () => { if (!raf && !frozen) raf = requestAnimationFrame(step); };

  function firstText() {
    if (started) return; started = true; stopSlow(); status.remove(); el.dataset.state = 'writing';
  }

  return {
    el,
    text: () => target,
    event(type, d) {
      if (type === 'phase') {
        if (d.phase === 'links') setLabel(d.count > 1 ? `Leggo le ${d.count} pagine che hai allegato…` : 'Leggo la pagina che hai allegato…');
        else if (d.phase === 'web') setLabel('Cerco sul web…');
        else if (d.phase === 'files') setLabel(d.count > 1 ? `Leggo i ${d.count} file che hai allegato (le immagini richiedono un po’ di più)…` : 'Leggo il file che hai allegato…');
        else if (d.phase === 'writing') setLabel('Sto scrivendo…');
      } else if (type === 'context') {
        showSources(d.web);
        if (d.web?.found) setLabel(`Ho trovato ${d.web.found} ${d.web.found === 1 ? 'pagina' : 'pagine'} sul web: preparo la risposta…`);
        else if (d.materials) setLabel(`Consulto ${d.materials} ${d.materials === 1 ? 'passaggio' : 'passaggi'} dei tuoi materiali…`);
      } else if (type === 'delta') { if (!d.text) return; firstText(); target += d.text; kick(); }
      else if (type === 'replace') { // il testo già mostrato cambia (controllo applicativo): si riparte da dove le due versioni iniziano a differire
        firstText(); const next = d.text || ''; let k = 0; const max = Math.min(shown, target.length, next.length); while (k < max && target[k] === next[k]) k++;
        target = next; shown = Math.min(shown, k); settledText = ''; tailText = null; if (!frozen) { paint(); kick(); }
      }
    },
    // arriva la risposta definitiva: si finisce di scrivere in fretta, poi il chiamante sostituisce questo elemento con il messaggio salvato
    finish() {
      done = true; if (target.length <= shown) { placeCaret(); return Promise.resolve(); }
      // se la scheda è in background il browser sospende l'animazione: dopo un attimo si mostra comunque tutto
      return new Promise((r) => { waiters.push(r); kick(); setTimeout(() => { if (shown < target.length) { shown = target.length; if (!frozen) paint(); } const w = waiters; waiters = []; for (const x of w) x(); }, 1500); });
    },
    // Stop: si mostra subito tutto ciò che il server ha già inviato (è ciò che viene salvato) e il cursore sparisce
    freeze() { stopSlow(); frozen = true; if (raf) cancelAnimationFrame(raf); raf = 0; shown = target.length; if (started) paint(); caret.remove(); el.setAttribute('aria-busy', 'false'); el.classList.add('stopped'); const w = waiters; waiters = []; for (const r of w) r(); },
    destroy() { stopSlow(); frozen = true; if (raf) cancelAnimationFrame(raf); raf = 0; el.remove(); },
  };
}
