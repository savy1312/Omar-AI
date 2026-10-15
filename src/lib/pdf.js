'use strict';
// Generatore PDF minimale (solo testo), senza dipendenze: font standard Helvetica con codifica WinAnsi,
// titoli, paragrafi a capo automatico, elenchi, righe "chiave: valore", separatori, numeri di pagina.
// Basta per una relazione tecnica leggibile e stampabile; non incorpora immagini.

const A4 = { w: 595.28, h: 841.89 };
const M = { l: 56, r: 56, t: 64, b: 64 };
// larghezze (unità/1000) dei caratteri Helvetica per WinAnsi 32..255 (approssimate per i non ASCII)
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HWB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const SUBST = { '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', '→': '->', '←': '<-', '×': 'x', '÷': '/', 'Ω': 'Ohm', 'π': 'pi', 'σ': 'sigma', 'τ': 'tau', 'ω': 'omega', 'Δ': 'Delta', 'α': 'alfa', 'β': 'beta', 'μ': 'u', '√': 'sqrt', '✓': 'v', '✔': 'v', '✗': 'x', '·': '·' };

function toBytes(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 0x09) { out.push(32, 32); continue; }
    if (c >= 32 && c < 127) out.push(c);
    else if (CP1252[ch]) out.push(CP1252[ch]);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (SUBST[ch]) for (const b of toBytes(SUBST[ch])) out.push(b);
    else if (c >= 32) out.push(63); // ?
  }
  return out;
}
const charW = (b, bold) => { const t = bold ? HWB : HW; return b >= 32 && b < 127 ? t[b - 32] : b === 0x95 ? 350 : b === 0x97 ? 1000 : b === 0x96 ? 556 : 556; };
const textW = (bytes, size, bold) => bytes.reduce((n, b) => n + charW(b, bold), 0) * size / 1000;
const esc = (bytes) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');

function wrap(text, size, width, bold) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/ +/); let cur = [];
    const flush = () => { lines.push(cur.join(' ')); cur = []; };
    for (const w of words) {
      const test = [...cur, w].join(' ');
      if (textW(toBytes(test), size, bold) <= width || !cur.length) {
        if (!cur.length && textW(toBytes(w), size, bold) > width) { // parola lunghissima: si spezza
          let part = ''; for (const ch of w) { if (textW(toBytes(part + ch), size, bold) > width) { lines.push(part); part = ''; } part += ch; } cur = [part];
        } else cur.push(w);
      } else { flush(); cur.push(w); }
    }
    flush();
  }
  return lines;
}

function createPdf({ title = 'Documento', author = '', footer = '' } = {}) {
  const pages = []; let ops = null; let y = 0;
  const W = A4.w - M.l - M.r;
  const newPage = () => { ops = []; pages.push(ops); y = A4.h - M.t; };
  const ensure = (h) => { if (!ops || y - h < M.b) newPage(); };
  const put = (txt, x, size, bold, color = '0 0 0') => { ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(toBytes(txt))}) Tj ET`); };
  const api = {
    heading(txt, level = 1) {
      const size = level === 1 ? 20 : level === 2 ? 14 : 12; const gap = level === 1 ? 10 : 8;
      ensure(size * 2 + gap); y -= gap;
      for (const l of wrap(txt, size, W, true)) { ensure(size * 1.3); y -= size * 1.15; put(l, M.l, size, true, level === 1 ? '0.07 0.09 0.15' : '0.1 0.2 0.45'); }
      y -= level === 1 ? 6 : 4;
      if (level <= 2) { ensure(4); ops.push(`0.8 0.83 0.9 RG 0.7 w ${M.l} ${y.toFixed(2)} m ${(A4.w - M.r).toFixed(2)} ${y.toFixed(2)} l S`); y -= 8; }
      return api;
    },
    paragraph(txt, { size = 10.5, bold = false, color, indent = 0, gapAfter = 5 } = {}) {
      for (const l of wrap(txt, size, W - indent, bold)) { ensure(size * 1.45); y -= size * 1.38; put(l, M.l + indent, size, bold, color); }
      y -= gapAfter; return api;
    },
    small(txt) { return api.paragraph(txt, { size: 8.5, color: '0.35 0.37 0.42' }); },
    bullet(txt, { size = 10.5, indent = 14 } = {}) {
      const lines = wrap(txt, size, W - indent - 10, false);
      lines.forEach((l, i) => { ensure(size * 1.45); y -= size * 1.38; if (i === 0) put('•', M.l + indent - 10, size, true, '0.1 0.2 0.45'); put(l, M.l + indent, size, false); });
      y -= 2; return api;
    },
    kv(k, v, { size = 10.5 } = {}) {
      const kw = Math.min(170, textW(toBytes(`${k}: `), size, true) + 4);
      const lines = wrap(String(v ?? '—'), size, W - kw, false);
      lines.forEach((l, i) => { ensure(size * 1.45); y -= size * 1.38; if (i === 0) put(`${k}:`, M.l, size, true, '0.25 0.27 0.33'); put(l, M.l + kw, size, false); });
      y -= 2; return api;
    },
    spacer(h = 8) { ensure(h); y -= h; return api; },
    box(txt, { size = 9.5 } = {}) { // riquadro di avvertenza
      const lines = wrap(txt, size, W - 20, false); const hgt = lines.length * size * 1.38 + 12;
      ensure(hgt + 6); const top = y; ops.push(`0.96 0.95 0.9 rg ${M.l} ${(top - hgt).toFixed(2)} ${W.toFixed(2)} ${hgt.toFixed(2)} re f`);
      y -= 6; for (const l of lines) { y -= size * 1.38; put(l, M.l + 10, size, false, '0.35 0.3 0.1'); } y = top - hgt - 8; return api;
    },
    pageBreak() { newPage(); return api; },
    toBuffer() {
      if (!pages.length) newPage();
      const objs = []; const add = (s) => { objs.push(s); return objs.length; };
      add('<< /Type /Catalog /Pages 2 0 R >>'); add('PLACEHOLDER');
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const kids = [];
      pages.forEach((p, i) => {
        const foot = [`BT /F1 8 Tf 0.45 0.47 0.52 rg ${M.l} 34 Td (${esc(toBytes(footer || title))}) Tj ET`, `BT /F1 8 Tf 0.45 0.47 0.52 rg ${(A4.w - M.r - 60).toFixed(2)} 34 Td (${esc(toBytes(`Pagina ${i + 1} di ${pages.length}`))}) Tj ET`];
        const stream = [...p, ...foot].join('\n');
        const c = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
      });
      objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
      const info = add(`<< /Title (${esc(toBytes(title))}) /Author (${esc(toBytes(author))}) /Producer (Omar AI) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
      let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
      objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = Buffer.byteLength(out, 'latin1');
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Buffer.from(out, 'latin1');
    },
    get pageCount() { return pages.length; },
  };
  return api;
}
module.exports = { createPdf, toBytes, wrap };
