'use strict';
// Da HTML a testo leggibile, senza librerie. Scansione lineare (niente espressioni regolari che possono "esplodere" su pagine malevole).
// Il testo ottenuto è SEMPRE trattato come dato non fidato: prima del modello passa da neutralize() (vedi materials/service).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', deg: '°', plusmn: '±', times: '×', divide: '÷', middot: '·', bull: '•',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', micro: 'µ', sup2: '²', sup3: '³', frac12: '½' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (all, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' '; } catch { return ' '; } }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? all;
  });
}
const RAW = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'textarea', 'select', 'head']); // contenuto da saltare fino alla chiusura
const SKIP = new Set(['nav', 'footer', 'aside', 'form', 'button', 'dialog']);                                                               // blocchi di contorno (menu, piè di pagina...)
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'ul', 'ol', 'li', 'tr', 'table', 'blockquote', 'pre', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br', 'caption', 'details', 'summary']);

// Ritorna { title, text }. `max` = massimo di caratteri del testo.
function htmlToText(html, { max = 200_000 } = {}) {
  const src = String(html || '').slice(0, 3_000_000);
  const low = src.toLowerCase();
  // titolo
  let title = '';
  const ti = low.indexOf('<title'); if (ti >= 0) { const s = low.indexOf('>', ti); const e = low.indexOf('</title', s); if (s >= 0 && e > s) title = src.slice(s + 1, e); }
  if (!title) { const m = /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']{1,200})["']/i.exec(src.slice(0, 20000)); if (m) title = m[1]; }
  // zona principale: <main> o <article> se presenti, altrimenti tutta la pagina
  const zone = (a, b) => { const s = low.indexOf(a); const e = low.lastIndexOf(b); return s >= 0 && e > s ? [s, e + b.length] : null; };
  const z = zone('<main', '</main') || zone('<article', '</article');
  const full = walk(src, low, 0, src.length);
  let text = z ? walk(src, low, z[0], z[1]) : full;
  if (z && text.length < 300 && full.length > text.length) text = full; // la zona era troppo piccola: meglio tutta la pagina
  if (!title) { const h1 = /^# (.{3,160})$/m.exec(text); if (h1) title = h1[1]; }
  title = decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 140);
  return { title, text: text.slice(0, max) };
}

function walk(src, low, from, to) {
  const out = []; let i = from; let skip = 0; let pre = 0; let buf = '';
  const flush = () => { if (buf && !skip) out.push(pre ? buf : buf.replace(/\s+/g, ' ')); buf = ''; }; // con skip>0 il testo accumulato viene buttato
  while (i < to) {
    const lt = low.indexOf('<', i);
    if (lt < 0 || lt >= to) { buf += src.slice(i, to); break; }
    buf += src.slice(i, lt);
    if (low.startsWith('<!--', lt)) { const e = low.indexOf('-->', lt + 4); i = e < 0 ? to : e + 3; continue; }
    const gt = low.indexOf('>', lt + 1);
    if (gt < 0 || gt >= to) { break; }
    const raw = low.slice(lt + 1, gt); const closing = raw[0] === '/';
    const name = /^\/?([a-z][a-z0-9]*)/.exec(raw)?.[1];
    i = gt + 1;
    if (!name) { if (raw[0] !== '!' && raw[0] !== '?') buf += ' '; continue; }
    if (!closing && RAW.has(name)) { // salta tutto fino al tag di chiusura corrispondente
      const e = low.indexOf(`</${name}`, i); if (e < 0) { i = to; break; }
      const eg = low.indexOf('>', e); i = eg < 0 ? to : eg + 1; continue;
    }
    if (SKIP.has(name)) { if (closing) { buf = ''; skip = Math.max(0, skip - 1); } else if (!raw.endsWith('/')) { flush(); skip++; } continue; } // il testo letto dentro un blocco di contorno viene scartato
    if (name === 'pre') { flush(); pre = closing ? Math.max(0, pre - 1) : pre + 1; }
    if (BLOCK.has(name)) {
      flush();
      if (!skip) {
        if (/^h[1-6]$/.test(name)) out.push(closing ? '\n\n' : `\n\n${'#'.repeat(Math.min(3, Number(name[1])))} `);
        else if (name === 'li') out.push(closing ? '' : '\n- ');
        else if (name === 'tr') out.push(closing ? '' : '\n');
        else if (name === 'br') out.push('\n');
        else if (name === 'td' || name === 'th') out.push(' | ');
        else out.push('\n');
      }
    } else if (name === 'td' || name === 'th') { flush(); if (!skip) out.push(closing ? '' : ' | '); }
    else if (name === 'img' && !skip) { const alt = /\balt\s*=\s*"([^"]{3,120})"/i.exec(src.slice(lt, gt)); if (alt) buf += ` ${alt[1]} `; }
  }
  flush();
  let t = decodeEntities(out.join(''));
  t = t.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  // toglie righe di sola punteggiatura/ripetizioni di menu molto corte consecutive
  const lines = t.split('\n'); const res = []; let shortRun = 0;
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) { res.push(''); shortRun = 0; continue; }
    if (/^[\W_]+$/.test(s)) continue;
    if (s.length < 16 && !/^(#|-)/.test(s)) { if (++shortRun > 4) continue; } else shortRun = 0;
    res.push(s);
  }
  return res.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
module.exports = { htmlToText, decodeEntities };
