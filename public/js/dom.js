// Helper DOM sicuri (nessun innerHTML con dati dinamici), notifiche, finestre di dialogo e rendering Markdown + formule (KaTeX).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('aria-') && v != null) { el.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of [kids].flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(text, kind = '') {
  const t = h('div', { class: `toast ${kind}`, text });
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ── finestre di dialogo accessibili (<dialog>) ──
export function dialog(title, body, actions = []) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    add(dlg, [h('h2', { id: 'dlg-title', text: title }), body, h('div', { class: 'row', style: 'margin-top:1rem;justify-content:flex-end' },
      actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, type: 'button', text: a.label, onclick: async () => { if (a.onClick) { const r = await a.onClick(dlg); if (r === false) return; close(r ?? a.value); } else close(a.value); } })))]);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(undefined); }); // chiusura da codice: niente finestre fantasma né id duplicati
    document.body.append(dlg); dlg.showModal();
    const first = dlg.querySelector('input,select,textarea,button.primary'); first?.focus();
  });
}
export const confirmDialog = (title, text, { ok = 'Conferma', danger = false } = {}) =>
  dialog(title, h('p', { text }), [{ label: 'Annulla', value: false }, { label: ok, value: true, primary: !danger, danger }]);

// ── Markdown minimale e sicuro (tutto passa da textContent) con formule KaTeX e riferimenti [M1]/[C1]/[D1]/[P1]/[W1] ──
function mathNode(tex, display) {
  const el = h(display ? 'div' : 'span', { class: 'math' });
  if (window.katex) { try { window.katex.render(tex, el, { displayMode: display, throwOnError: false, output: 'html', trust: false }); return el; } catch { /* ricade sul testo */ } }
  el.textContent = display ? `$$${tex}$$` : `$${tex}$`; return el;
}
const INLINE = /(`[^`\n]+`)|(\$\$[^$]+\$\$)|(\\\([^\n]+?\\\))|(\$[^$\n]+?\$)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[MCDPW]\d+\])/g;
function inline(text, onCite) {
  const out = []; let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out.push(h('code', { text: s.slice(1, -1) }));
    else if (m[2]) out.push(mathNode(s.slice(2, -2), false));
    else if (m[3]) out.push(mathNode(s.slice(2, -2), false));
    else if (m[4]) out.push(mathNode(s.slice(1, -1), false));
    else if (m[5]) out.push(h('strong', null, inline(s.slice(2, -2), onCite)));
    else if (m[6]) out.push(h('em', null, inline(s.slice(1, -1), onCite)));
    else if (m[7]) { const ref = s.slice(1, -1); out.push(h('button', { class: 'cite', type: 'button', title: 'Mostra la fonte', 'aria-label': `Fonte ${ref}`, text: ref, onclick: () => onCite?.(ref) })); }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function renderMarkdown(src, { onCite } = {}) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let i = 0; let para = [];
  const flush = () => { if (para.length) { root.append(h('p', null, inline(para.join(' '), onCite))); para = []; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) { flush(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; root.append(h('pre', null, h('code', { text: buf.join('\n') }))); continue; }
    if (/^\s*\$\$/.test(ln) || /^\s*\\\[/.test(ln)) { // formula a blocco anche su più righe
      flush(); let buf = ln.trim(); const closeRx = /\$\$\s*$|\\\]\s*$/;
      if (!(closeRx.test(buf) && buf.length > 4)) { while (++i < lines.length) { buf += '\n' + lines[i]; if (closeRx.test(lines[i])) break; } }
      i++; root.append(mathNode(buf.replace(/^\s*(\$\$|\\\[)/, '').replace(/(\$\$|\\\])\s*$/, '').trim(), true)); continue;
    }
    const hd = /^(#{1,4})\s+(.*)/.exec(ln);
    if (hd) { flush(); root.append(h(hd[1].length <= 2 ? 'h3' : 'h4', null, inline(hd[2], onCite))); i++; continue; }
    if (/^\s*([-*•])\s+/.test(ln)) { flush(); const ul = h('ul'); while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) ul.append(h('li', null, inline(lines[i++].replace(/^\s*([-*•])\s+/, ''), onCite))); root.append(ul); continue; }
    if (/^\s*\d+[.)]\s+/.test(ln)) { flush(); const ol = h('ol'); while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) ol.append(h('li', null, inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''), onCite))); root.append(ol); continue; }
    if (/^>\s?/.test(ln)) { flush(); const bq = []; while (i < lines.length && /^>\s?/.test(lines[i])) bq.push(lines[i++].replace(/^>\s?/, '')); root.append(h('blockquote', null, inline(bq.join(' '), onCite))); continue; }
    if (!ln.trim()) { flush(); i++; continue; }
    para.push(ln.trim()); i++;
  }
  flush();
  return root;
}
