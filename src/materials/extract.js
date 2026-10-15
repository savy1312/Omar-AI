'use strict';
// LETTURA DEI FILE: classificazione dei formati ed estrazione del contenuto che il tutor usa (e cita) per rispondere.
// Omar legge: PDF (anche scansionati, se c'è il modello "vista"), Word/Excel/PowerPoint e OpenDocument, testi e codice,
// pagine HTML, RTF, fogli CSV, G-code CNC, immagini e foto (descritte e trascritte dal modello "vista"), disegni e modelli
// CAD in formato aperto (DXF, STEP, IGES, STL, OBJ, 3MF, FreeCAD: quote, testi, dimensioni, ingombri, volumi) e archivi ZIP.
// Qualsiasi altro file viene accettato: se è testo si legge, altrimenti si archivia e si dice con onestà che non è interpretabile.
// Tutto ciò che si estrae è un DATO (mai istruzioni): prima del modello passa da neutralize() in materials/service.js.
const path = require('node:path');
const { openZip, isZip } = require('../lib/zip');
const { htmlToText, decodeEntities } = require('../web/html');

// capability: ia_testo = l'IA ne legge il contenuto; visualizzabile = si apre/mostra ma l'IA non lo interpreta; solo_archivio = si conserva e scarica.
const T = (kind, mime, extra = {}) => ({ kind, mime, capability: 'ia_testo', ...extra });
const MAGIC = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  gif: (b) => b.subarray(0, 3).toString('latin1') === 'GIF',
  webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  bmp: (b) => b.subarray(0, 2).toString('latin1') === 'BM',
  zip: isZip,
  ole: (b) => b.length > 8 && b.readUInt32LE(0) === 0xe011cfd0 && b.readUInt32LE(4) === 0xe11ab1a1,
};
const FORMATS = {
  '.pdf': T('pdf', 'application/pdf', { magic: MAGIC.pdf, x: 'pdf' }),
  // documenti d'ufficio
  '.docx': T('documento', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { magic: MAGIC.zip, x: 'docx' }),
  '.docm': T('documento', 'application/vnd.ms-word.document.macroEnabled.12', { magic: MAGIC.zip, x: 'docx' }),
  '.dotx': T('documento', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', { magic: MAGIC.zip, x: 'docx' }),
  '.xlsx': T('foglio', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { magic: MAGIC.zip, x: 'xlsx' }),
  '.xlsm': T('foglio', 'application/vnd.ms-excel.sheet.macroEnabled.12', { magic: MAGIC.zip, x: 'xlsx' }),
  '.pptx': T('presentazione', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', { magic: MAGIC.zip, x: 'pptx' }),
  '.ppsx': T('presentazione', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow', { magic: MAGIC.zip, x: 'pptx' }),
  '.odt': T('documento', 'application/vnd.oasis.opendocument.text', { magic: MAGIC.zip, x: 'odf' }),
  '.ods': T('foglio', 'application/vnd.oasis.opendocument.spreadsheet', { magic: MAGIC.zip, x: 'odf' }),
  '.odp': T('presentazione', 'application/vnd.oasis.opendocument.presentation', { magic: MAGIC.zip, x: 'odf' }),
  '.doc': T('documento', 'application/msword', { magic: MAGIC.ole, x: 'ole' }),
  '.xls': T('foglio', 'application/vnd.ms-excel', { magic: MAGIC.ole, x: 'ole' }),
  '.ppt': T('presentazione', 'application/vnd.ms-powerpoint', { magic: MAGIC.ole, x: 'ole' }),
  '.rtf': T('documento', 'application/rtf', { x: 'rtf', text: true }),
  '.html': T('pagina', 'text/html', { x: 'html', text: true }), '.htm': T('pagina', 'text/html', { x: 'html', text: true }),
  '.epub': T('documento', 'application/epub+zip', { magic: MAGIC.zip, x: 'epub' }),
  // immagini (lette dal modello "vista")
  '.png': T('immagine', 'image/png', { magic: MAGIC.png, x: 'image' }),
  '.jpg': T('immagine', 'image/jpeg', { magic: MAGIC.jpg, x: 'image' }), '.jpeg': T('immagine', 'image/jpeg', { magic: MAGIC.jpg, x: 'image' }),
  '.gif': T('immagine', 'image/gif', { magic: MAGIC.gif, x: 'image' }),
  '.webp': T('immagine', 'image/webp', { magic: MAGIC.webp, x: 'image' }),
  '.bmp': T('immagine', 'image/bmp', { magic: MAGIC.bmp, x: 'image' }),
  '.svg': T('vettoriale', 'image/svg+xml', { x: 'svg', text: true }),
  // CAD e modelli 3D in formato aperto
  '.dxf': T('cad', 'image/vnd.dxf', { x: 'dxf' }),
  '.step': T('cad', 'model/step', { x: 'step', text: true }), '.stp': T('cad', 'model/step', { x: 'step', text: true }),
  '.iges': T('cad', 'model/iges', { x: 'iges', text: true }), '.igs': T('cad', 'model/iges', { x: 'iges', text: true }),
  '.stl': T('cad', 'model/stl', { x: 'stl' }),
  '.obj': T('cad', 'model/obj', { x: 'obj', text: true }),
  '.3mf': T('cad', 'model/3mf', { magic: MAGIC.zip, x: '3mf' }),
  '.fcstd': T('cad', 'application/x-extension-fcstd', { magic: MAGIC.zip, x: 'fcstd' }),
  // G-code per macchine CNC e stampanti 3D
  '.gcode': T('codice', 'text/x-gcode', { x: 'gcode', text: true }), '.nc': T('codice', 'text/x-gcode', { x: 'gcode', text: true }),
  '.ngc': T('codice', 'text/x-gcode', { x: 'gcode', text: true }), '.tap': T('codice', 'text/x-gcode', { x: 'gcode', text: true }), '.cnc': T('codice', 'text/x-gcode', { x: 'gcode', text: true }),
  // archivi
  '.zip': T('archivio', 'application/zip', { magic: MAGIC.zip, x: 'zip' }),
};
// testi semplici e codice sorgente (letti come testo, MAI eseguiti)
const TEXT_EXT = { testo: ['.txt', '.md', '.markdown', '.log', '.ini', '.cfg', '.conf', '.tex'], dati: ['.csv', '.tsv', '.json', '.xml', '.yaml', '.yml', '.toml'],
  codice: ['.py', '.js', '.mjs', '.ts', '.c', '.h', '.cpp', '.cc', '.hpp', '.ino', '.java', '.cs', '.st', '.scl', '.awl', '.stl_plc', '.sql', '.m', '.lua', '.sh', '.bat', '.ps1', '.css', '.vb', '.vba', '.bas', '.pas', '.r', '.kt', '.go', '.rs', '.php', '.rb', '.asm', '.s', '.vhd', '.vhdl', '.v', '.l5x', '.xef', '.awl', '.mpy'] };
for (const [kind, list] of Object.entries(TEXT_EXT)) for (const ext of list) if (!FORMATS[ext]) FORMATS[ext] = T(kind, ext === '.json' ? 'application/json' : ext === '.csv' ? 'text/csv' : ext === '.xml' ? 'application/xml' : 'text/plain', { text: true, x: kind === 'dati' && ['.csv', '.tsv'].includes(ext) ? 'csv' : 'text' });
// formati proprietari o multimediali: si conservano e si scaricano, ma il loro contenuto non è leggibile senza il programma originale
const ARCHIVE_ONLY = { '.dwg': 'cad', '.sldprt': 'cad', '.sldasm': 'cad', '.slddrw': 'cad', '.ipt': 'cad', '.iam': 'cad', '.idw': 'cad', '.f3d': 'cad', '.f3z': 'cad', '.catpart': 'cad', '.catproduct': 'cad', '.prt': 'cad', '.x_t': 'cad', '.skp': 'cad',
  '.ap17': 'progetto_plc', '.ap18': 'progetto_plc', '.ap19': 'progetto_plc', '.zap17': 'progetto_plc', '.s7p': 'progetto_plc', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.webm': 'video',
  '.heic': 'immagine', '.heif': 'immagine', '.tif': 'immagine', '.tiff': 'immagine', '.rar': 'archivio', '.7z': 'archivio' };
const ARCHIVE_HINT = { cad: 'Formato CAD proprietario: esportalo in STEP, STL, DXF o PDF e Omar potrà leggerne quote e geometria.', progetto_plc: 'Progetto TIA Portal/STEP 7: esporta i blocchi in sorgente (.scl, .awl) o in PDF per farli leggere.', audio: 'File audio: Omar non ascolta l’audio.', video: 'File video: Omar non guarda i video.', immagine: 'Formato immagine non leggibile dal server: salvala in JPG o PNG.', archivio: 'Archivio RAR/7Z: usa un file .zip.' };

const BLOCKED = new Set(['.exe', '.dll', '.msi', '.com', '.scr', '.cpl', '.sys', '.apk', '.app', '.dmg', '.iso', '.lnk', '.pif']);
const extOf = (n) => path.extname(String(n || '')).toLowerCase();
const looksText = (buf) => { const s = buf.subarray(0, 8192); if (s.includes(0)) return false; const t = s.toString('utf8'); return (t.match(/�/g) || []).length < 8; };

function classify(filename, buf, { vision = false } = {}) {
  const ext = extOf(filename);
  if (BLOCKED.has(ext) || (buf.length > 2 && buf.subarray(0, 2).toString('latin1') === 'MZ')) return { ok: false, reason: 'I programmi eseguibili non si possono caricare (per sicurezza).' };
  const f = FORMATS[ext];
  if (f) {
    if (f.magic && !f.magic(buf)) return { ok: false, reason: 'Il contenuto del file non corrisponde alla sua estensione (forse è stato rinominato).' };
    if (f.text && buf.subarray(0, 8192).includes(0) && f.x !== 'step') return { ok: false, reason: 'Il file di testo contiene dati binari.' };
    // le immagini si leggono solo se c'è un modello "vista"; altrimenti si mostrano soltanto
    if (f.x === 'image' && !vision) return { ok: true, ext, ...f, capability: 'visualizzabile' };
    return { ok: true, ext, ...f };
  }
  if (ARCHIVE_ONLY[ext]) return { ok: true, ext, kind: ARCHIVE_ONLY[ext], mime: 'application/octet-stream', capability: 'solo_archivio', hint: ARCHIVE_HINT[ARCHIVE_ONLY[ext]] };
  // estensione sconosciuta: se è testo lo si legge, altrimenti si archivia
  if (buf.length && looksText(buf)) return { ok: true, ext: ext || '.txt', kind: 'testo', mime: 'text/plain', capability: 'ia_testo', text: true, x: 'text' };
  return { ok: true, ext: ext || '.bin', kind: 'altro', mime: 'application/octet-stream', capability: 'solo_archivio', hint: 'Formato non riconosciuto: il file è conservato e scaricabile, ma Omar non sa leggerne il contenuto.' };
}

const CAPABILITY_LABEL = {
  ia_testo: 'Letto dall’IA: contenuto consultabile e citabile',
  visualizzabile: 'Visualizzabile; il contenuto NON viene interpretato dall\'IA',
  solo_archivio: 'Solo archiviazione e download; non interpretabile dall\'IA',
};
const capabilityLabel = (kind, capability) => (capability === 'ia_testo' ? ({ immagine: 'Immagine descritta e trascritta dall’IA', cad: 'Disegno/modello letto: quote, testi e dimensioni', foglio: 'Foglio di calcolo letto dall’IA', presentazione: 'Presentazione letta dall’IA', codice: 'Codice letto dall’IA (mai eseguito)', archivio: 'Archivio: letti i file supportati al suo interno' }[kind] || CAPABILITY_LABEL.ia_testo) : CAPABILITY_LABEL[capability]);

// ───────── estrattori ─────────
const xmlText = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ');
const MAX_CHARS = 400_000;
const clip = (pages) => { let n = 0; const out = []; for (const p of pages) { if (n >= MAX_CHARS) break; const t = String(p).slice(0, MAX_CHARS - n); n += t.length; out.push(t); } return out; };

function docxText(xml) {
  return decodeEntities(xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (m) => m.replace(/<\/w:p>(?![\s\S]*<\/w:p>)/, '').replace(/<\/w:p>/g, ' '))
    .replace(/<w:pStyle w:val="(?:Heading|Titolo|heading)\s?(\d)"\/>/g, (_, n) => `\u0001${'#'.repeat(Math.min(+n, 4))} `)
    .replace(/<w:tab\/>/g, '\t').replace(/<w:(?:br|cr)\/>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')).replace(/\u0001/g, '').replace(/ \| \n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function extractDocx(buf) {
  const z = openZip(buf); const parts = [];
  const main = z.text('word/document.xml'); if (!main) throw new Error('documento Word senza contenuto');
  parts.push(docxText(main));
  for (const e of z.entries.filter((x) => /^word\/(footnotes|endnotes|comments)\.xml$/.test(x.name))) { const t = docxText(z.text(e) || ''); if (t) parts.push(`[${e.name.includes('comments') ? 'Commenti' : 'Note'}]\n${t}`); }
  const images = z.entries.filter((e) => /^word\/media\//.test(e.name)).length;
  return { pages: [parts.join('\n\n')], note: images ? `Il documento contiene ${images} immagini: Omar legge il testo; per far leggere un'immagine caricala a parte.` : null };
}
function colIndex(ref) { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function extractXlsx(buf) {
  const z = openZip(buf);
  const shared = []; const ss = z.text('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const wb = z.text('xl/workbook.xml') || ''; const rels = z.text('xl/_rels/workbook.xml.rels') || '';
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]));
  let sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: decodeEntities(m[1]), file: relMap[m[2]] }));
  if (!sheets.length) sheets = z.entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).map((e, i) => ({ name: `Foglio ${i + 1}`, file: e.name }));
  const pages = [];
  for (const s of sheets.slice(0, 30)) {
    const xml = s.file && z.text(s.file); if (!xml) continue;
    const rows = []; let formulas = 0;
    for (const rr of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = [rr[0], /\br="(\d+)"/.exec(rr[1])?.[1], rr[2]];
      if (rows.length >= 3000) break;
      const cells = [];
      for (const c of r[2].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const inner = c[2] || ''; const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const t = /t="(\w+)"/.exec(attrs)?.[1]; const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (/<f[ >]/.test(inner)) formulas++;
        let val = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] || '') : v != null ? decodeEntities(v) : '';
        const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]; if (f && val !== '') val = `${val} (=${decodeEntities(f)})`;
        if (ref) cells[colIndex(ref)] = val; else cells.push(val);
      }
      if (cells.some((x) => x !== undefined && x !== '')) rows.push(`${r[1] ? `${r[1]}: ` : ''}${Array.from(cells, (x) => x ?? '').join(' | ')}`);
    }
    pages.push(`Foglio «${s.name}»${formulas ? ` (${formulas} formule; accanto al valore c'è la formula)` : ''}\n${rows.join('\n') || '(vuoto)'}`);
  }
  if (!pages.length) throw new Error('foglio di calcolo senza contenuto leggibile');
  return { pages };
}
function extractPptx(buf) {
  const z = openZip(buf);
  const slides = z.entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => +a.name.match(/(\d+)\.xml/)[1] - +b.name.match(/(\d+)\.xml/)[1]);
  const pages = slides.map((e, i) => {
    const xml = z.text(e) || ''; const text = decodeEntities(xml.replace(/<\/a:p>/g, '\n').replace(/<a:br\/>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    const notes = z.text(`ppt/notesSlides/notesSlide${e.name.match(/(\d+)\.xml/)[1]}.xml`);
    const nt = notes ? decodeEntities(notes.replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n\s*\d+\s*$/, '').trim() : '';
    return `Diapositiva ${i + 1}\n${text || '(senza testo)'}${nt ? `\nNote del relatore: ${nt}` : ''}`;
  });
  if (!pages.length) throw new Error('presentazione senza diapositive');
  return { pages };
}
function extractOdf(buf) {
  const z = openZip(buf); const xml = z.text('content.xml'); if (!xml) throw new Error('documento OpenDocument senza contenuto');
  const body = xml.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => ' '.repeat(+n || 1))
    .replace(/<\/table:table-cell>/g, ' | ').replace(/<\/table:table-row>/g, '\n').replace(/<table:table [^>]*table:name="([^"]+)"[^>]*>/g, '\n\nFoglio «$1»\n')
    .replace(/<draw:page [^>]*draw:name="([^"]+)"[^>]*>/g, '\n\nDiapositiva $1\n').replace(/<\/text:(p|h)>/g, '\n');
  return { pages: [decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/(\s*\|\s*)+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()] };
}
function extractEpub(buf) {
  const z = openZip(buf);
  const pages = z.entries.filter((e) => /\.(x?html?)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).slice(0, 200).map((e) => htmlToText(z.text(e) || '').text).filter((t) => t.trim());
  if (!pages.length) throw new Error('libro senza testo');
  return { pages };
}
// vecchi .doc/.xls/.ppt (formato binario OLE): si recuperano le sequenze di testo (UTF-16 e ASCII). Estrazione parziale, dichiarata.
function extractOle(buf) {
  const runs = [];
  const u16 = buf.toString('utf16le'); for (const m of u16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}°²³±×€]{6,}/gu)) runs.push(m[0]);
  if (runs.join('').length < 200) for (const m of buf.toString('latin1').matchAll(/[\x20-\x7e\xc0-\xff]{8,}/g)) runs.push(m[0]);
  const text = [...new Set(runs.map((r) => r.trim()).filter((r) => r.length >= 6 && /[a-zà-ù]{3}/i.test(r)))].join('\n');
  if (text.length < 40) throw new Error('nessun testo recuperabile');
  return { pages: [text.slice(0, 200_000)], note: 'Formato Office vecchio (.doc/.xls/.ppt): testo recuperato in modo parziale. Per una lettura completa salvalo come .docx/.xlsx/.pptx o PDF.', partial: true };
}
function extractRtf(s) {
  let t = String(s).replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}/g, '');
  t = t.replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString('latin1')).replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t').replace(/\\cell\b ?/g, ' | ').replace(/\\row\b ?/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
  return { pages: [t.replace(/\n{3,}/g, '\n\n').trim()] };
}
function extractCsv(s) {
  const lines = String(s).replace(/\r\n/g, '\n').split('\n'); const head = lines[0] || '';
  const sep = [';', '\t', ',', '|'].map((c) => [c, head.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = lines.slice(0, 5000).filter((l) => l.trim()).map((l, i) => `${i ? `${i + 1}: ` : 'Intestazione: '}${l.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')).join(' | ')}`);
  return { pages: [`Tabella (${lines.filter((l) => l.trim()).length} righe, separatore «${sep === '\t' ? 'tab' : sep}»)\n${rows.join('\n')}`] };
}
function extractSvg(s) {
  const texts = [...String(s).matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => xmlText(m[1]).trim()).filter(Boolean);
  const title = xmlText(/<title>([\s\S]*?)<\/title>/.exec(s)?.[1] || '').trim(); const desc = xmlText(/<desc>([\s\S]*?)<\/desc>/.exec(s)?.[1] || '').trim();
  const shapes = ['path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse'].map((t) => [t, (String(s).match(new RegExp(`<${t}[\\s/>]`, 'g')) || []).length]).filter(([, n]) => n);
  return { pages: [`Disegno vettoriale SVG${title ? ` «${title}»` : ''}.${desc ? `\nDescrizione: ${desc}` : ''}\nElementi grafici: ${shapes.map(([t, n]) => `${n} ${t}`).join(', ') || 'nessuno'}.\nTesti presenti nel disegno:\n${texts.join('\n') || '(nessun testo)'}`] };
}
// ── CAD ──
const fmtN = (x) => (Math.abs(x) >= 1000 ? x.toFixed(1) : Math.abs(x) >= 10 ? x.toFixed(2) : x.toFixed(3)).replace('.', ',');
function bboxText(b, unit = 'unità del file (di solito mm)') {
  if (!b || !Number.isFinite(b.minX)) return 'Ingombro non calcolabile.';
  const dx = b.maxX - b.minX; const dy = b.maxY - b.minY; const dz = b.maxZ - b.minZ;
  return `Ingombro (bounding box): ${fmtN(dx)} × ${fmtN(dy)}${Number.isFinite(dz) && dz ? ` × ${fmtN(dz)}` : ''} ${unit} (X da ${fmtN(b.minX)} a ${fmtN(b.maxX)}, Y da ${fmtN(b.minY)} a ${fmtN(b.maxY)}${Number.isFinite(dz) ? `, Z da ${fmtN(b.minZ)} a ${fmtN(b.maxZ)}` : ''}).`;
}
const newBox = () => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
const grow = (b, x, y, z = 0) => { if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y; if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z; };
function meshSummary(tris, name) {
  const b = newBox(); let area = 0; let vol = 0;
  for (const [a, c, d] of tris) {
    grow(b, ...a); grow(b, ...c); grow(b, ...d);
    const ux = c[0] - a[0]; const uy = c[1] - a[1]; const uz = c[2] - a[2]; const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
    const cx = uy * vz - uz * vy; const cy = uz * vx - ux * vz; const cz = ux * vy - uy * vx;
    area += Math.hypot(cx, cy, cz) / 2;
    vol += (a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0])) / 6;
  }
  return `${name}: mesh di ${tris.length} triangoli.\n${bboxText(b)}\nSuperficie: ${fmtN(area)} unità² · Volume racchiuso: ${fmtN(Math.abs(vol))} unità³ (valido se la mesh è chiusa).\nNota: il formato non indica l'unità di misura; nella stampa 3D e nel CAD di solito sono millimetri.`;
}
function extractStl(buf) {
  const tris = [];
  const binary = buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length;
  if (binary) { const n = Math.min(buf.readUInt32LE(80), 2_000_000); for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; tris.push([[buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)], [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)], [buf.readFloatLE(o + 24), buf.readFloatLE(o + 28), buf.readFloatLE(o + 32)]]); } }
  else { const v = [...buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]); for (let i = 0; i + 2 < v.length; i += 3) tris.push([v[i], v[i + 1], v[i + 2]]); }
  if (!tris.length) throw new Error('STL senza triangoli');
  const name = binary ? buf.subarray(0, 80).toString('latin1').replace(/\0.*$/s, '').trim() : /^solid\s+(.*)$/m.exec(buf.toString('latin1', 0, 300))?.[1]?.trim();
  return { pages: [meshSummary(tris, `Modello 3D STL${name ? ` «${name}»` : ''}`)] };
}
function extractObj(s) {
  const v = []; const tris = []; const groups = new Set();
  for (const line of String(s).split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('f ')) { const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10)).map((i) => (i < 0 ? v.length + i : i - 1)); for (let k = 1; k + 1 < idx.length; k++) if (v[idx[0]] && v[idx[k]] && v[idx[k + 1]]) tris.push([v[idx[0]], v[idx[k]], v[idx[k + 1]]]); }
    else if (/^[og] /.test(line)) groups.add(line.slice(2).trim());
  }
  if (!v.length) throw new Error('OBJ senza vertici');
  return { pages: [`${meshSummary(tris, 'Modello 3D OBJ')}\nOggetti/gruppi: ${[...groups].slice(0, 30).join(', ') || 'nessuno'} · Vertici: ${v.length}.`] };
}
function extract3mf(buf) {
  const z = openZip(buf); const model = z.entries.find((e) => /\.model$/i.test(e.name)); const xml = model && z.text(model); if (!xml) throw new Error('3MF senza modello');
  const unit = /unit="(\w+)"/.exec(xml)?.[1] || 'millimeter'; const b = newBox(); let n = 0;
  for (const m of xml.matchAll(/<vertex x="([-\d.eE]+)" y="([-\d.eE]+)" z="([-\d.eE]+)"/g)) { grow(b, +m[1], +m[2], +m[3]); n++; }
  const names = [...xml.matchAll(/<object [^>]*name="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
  return { pages: [`Modello 3D 3MF (unità: ${unit}). Oggetti: ${names.join(', ') || 'senza nome'} · Vertici: ${n}.\n${bboxText(b, unit === 'millimeter' ? 'mm' : unit)}`] };
}
function extractFcstd(buf) {
  const z = openZip(buf); const xml = z.text('Document.xml'); if (!xml) throw new Error('file FreeCAD senza documento');
  const objs = [...xml.matchAll(/<Object type="([^"]+)" name="([^"]+)"/g)].map((m) => `${m[2]} (${m[1].replace(/^\w+::/, '')})`);
  const labels = [...xml.matchAll(/<Property name="Label"[^>]*>\s*<String value="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const dims = [...xml.matchAll(/<Property name="(Length|Width|Height|Radius|Angle|Depth|Diameter)"[^>]*>\s*<(?:Float|Quantity|PropertyLength)[^>]*value="([-\d.eE]+)"/g)].slice(0, 80).map((m) => `${m[1]} = ${fmtN(+m[2])}`);
  return { pages: [`Progetto FreeCAD con ${objs.length} oggetti.\nOggetti (albero delle operazioni): ${objs.slice(0, 120).join(', ')}\nEtichette: ${[...new Set(labels)].slice(0, 120).join(', ')}\n${dims.length ? `Dimensioni parametriche trovate: ${dims.join('; ')}` : ''}`] };
}
const DXF_UNITS = { 0: 'senza unità', 1: 'pollici', 2: 'piedi', 4: 'mm', 5: 'cm', 6: 'm' };
function extractDxf(buf) {
  if (buf.subarray(0, 22).toString('latin1').startsWith('AutoCAD Binary DXF')) throw new Error('DXF binario non supportato: salvalo come DXF ASCII');
  const u8 = buf.toString('utf8'); const lines = (u8.includes('\ufffd') ? buf.toString('latin1') : u8).replace(/\r\n/g, '\n').split('\n');
  const pairs = []; for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([+lines[i].trim(), lines[i + 1].replace(/\s+$/, '')]);
  const hdr = {}; const counts = {}; const texts = []; const dims = []; const layers = new Set(); const blocks = new Set();
  let section = null; let ent = null;
  const flush = () => {
    if (!ent || section !== 'ENTITIES') { ent = null; return; }
    counts[ent.type] = (counts[ent.type] || 0) + 1; if (ent.layer) layers.add(ent.layer);
    if (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(ent.type) && ent.text) texts.push(ent.text.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim());
    if (ent.type === 'DIMENSION') dims.push(ent.text && ent.text !== '<>' ? ent.text.replace('<>', ent.value != null ? fmtN(ent.value) : '') : ent.value != null ? fmtN(ent.value) : '?');
    if (ent.type === 'CIRCLE' && ent.r) dims.push(`Ø${fmtN(2 * ent.r)} (cerchio)`);
    ent = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { flush(); if (v === 'SECTION') { section = pairs[i + 1]?.[1]; continue; } if (v === 'ENDSEC') { section = null; continue; } if (section === 'ENTITIES') ent = { type: v }; if (section === 'TABLES' && v === 'LAYER') ent = { type: 'LAYER' }; if (section === 'BLOCKS' && v === 'BLOCK') ent = { type: 'BLOCK' }; continue; }
    if (section === 'HEADER' && c === 9) { const k = v; const vals = []; while (pairs[i + 1] && pairs[i + 1][0] !== 9 && pairs[i + 1][0] !== 0) vals.push(pairs[++i][1].trim()); hdr[k] = vals; continue; }
    if (!ent) continue;
    if (ent.type === 'LAYER' && c === 2) { layers.add(v.trim()); continue; }
    if (ent.type === 'BLOCK' && c === 2 && !v.startsWith('*')) { blocks.add(v.trim()); continue; }
    if (c === 8) ent.layer = v.trim(); else if (c === 1) ent.text = (ent.text || '') + v; else if (c === 3 && ent.type === 'MTEXT') ent.text = (ent.text || '') + v;
    else if (c === 42 && ent.type === 'DIMENSION') ent.value = +v; else if (c === 40 && ent.type === 'CIRCLE') ent.r = +v;
  }
  flush();
  const unit = DXF_UNITS[+(hdr.$INSUNITS?.[0] ?? 0)] || 'unità non indicate';
  const ext = hdr.$EXTMIN && hdr.$EXTMAX ? (() => { const b = newBox(); grow(b, +hdr.$EXTMIN[0], +hdr.$EXTMIN[1], +(hdr.$EXTMIN[2] || 0)); grow(b, +hdr.$EXTMAX[0], +hdr.$EXTMAX[1], +(hdr.$EXTMAX[2] || 0)); return bboxText(b, unit); })() : '';
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total && !texts.length) throw new Error('DXF senza entità leggibili');
  return { pages: [`Disegno DXF (${hdr.$ACADVER?.[0] || 'versione sconosciuta'}), unità: ${unit}. ${ext}\nEntità: ${total} — ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}.\nLayer: ${[...layers].slice(0, 60).join(', ') || 'nessuno'}${blocks.size ? `\nBlocchi: ${[...blocks].slice(0, 60).join(', ')}` : ''}\nQuote (valori misurati o scritti): ${dims.slice(0, 300).join('; ') || 'nessuna'}\nTesti e annotazioni del disegno:\n${[...new Set(texts)].slice(0, 600).join('\n') || '(nessun testo)'}`] };
}
const STEP_STR = (s) => String(s).replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, h) => h.match(/.{4}/g).map((c) => String.fromCharCode(parseInt(c, 16))).join('')).replace(/\\X\\([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
function extractStep(buf) {
  const s = buf.toString('latin1'); if (!/ISO-10303-21/.test(s.slice(0, 200))) throw new Error('non è un file STEP');
  const head = /HEADER;([\s\S]*?)ENDSEC;/.exec(s)?.[1] || '';
  const strs = (k) => [...(new RegExp(`${k}\\s*\\(([\\s\\S]*?)\\);`).exec(head)?.[1] || '').matchAll(/'((?:[^']|'')*)'/g)].map((m) => STEP_STR(m[1].replace(/''/g, "'"))).filter(Boolean);
  const products = [...s.matchAll(/PRODUCT\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)].map((m) => STEP_STR(m[1]) + (m[2] && m[2] !== m[1] ? ` — ${STEP_STR(m[2])}` : ''));
  const counts = {}; for (const m of s.matchAll(/=\s*([A-Z_][A-Z0-9_]*)\s*\(/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const milli = /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\./.test(s); const inch = /CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(s);
  const b = newBox(); let np = 0; for (const m of s.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.E+]+)\s*,\s*([-\d.E+]+)\s*(?:,\s*([-\d.E+]+))?/g)) { if (np++ > 300000) break; grow(b, +m[1], +m[2], +(m[3] || 0)); }
  const top = Object.entries(counts).sort((a, c) => c[1] - a[1]).slice(0, 18).map(([k, n]) => `${n} ${k}`).join(', ');
  const geo = ['ADVANCED_BREP_SHAPE_REPRESENTATION', 'MANIFOLD_SOLID_BREP', 'CYLINDRICAL_SURFACE', 'PLANE', 'CIRCLE', 'B_SPLINE_SURFACE_WITH_KNOTS', 'CONICAL_SURFACE', 'TOROIDAL_SURFACE'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(', ');
  const fn = strs('FILE_NAME');
  return { pages: [`Modello STEP (ISO 10303). ${strs('FILE_DESCRIPTION').join(' · ')}\nFile: ${fn[0] || '—'}${fn[1] ? ` · data ${fn[1]}` : ''}${fn[2] ? ` · autore ${fn[2]}` : ''}${fn[4] ? ` · creato con ${fn[4]}` : ''} · schema ${strs('FILE_SCHEMA').join(', ')}\nUnità di lunghezza: ${milli ? 'millimetri' : inch ? 'pollici' : 'metri o non indicata'}.\nParti/prodotti: ${[...new Set(products)].slice(0, 80).join('; ') || 'nessuno indicato'}\n${bboxText(b, milli ? 'mm' : inch ? 'pollici' : 'unità del file')} (calcolato dai punti della geometria: è indicativo)\nGeometria: ${geo || 'n.d.'}\nEntità più frequenti: ${top}.`] };
}
function extractIges(buf) {
  const lines = buf.toString('latin1').replace(/\r\n/g, '\n').split('\n').filter((l) => l.length >= 73);
  const sec = (c) => lines.filter((l) => l[72] === c).map((l) => l.slice(0, 72)).join('');
  const S = sec('S').trim(); const G = sec('G'); const D = lines.filter((l) => l[72] === 'D');
  if (!D.length && !S) throw new Error('non è un file IGES');
  const counts = {}; for (let i = 0; i < D.length; i += 2) { const t = +D[i].slice(0, 8); counts[t] = (counts[t] || 0) + 1; }
  const NAMES = { 100: 'arco', 102: 'curva composta', 110: 'linea', 116: 'punto', 124: 'matrice di trasformazione', 126: 'B-spline', 128: 'superficie B-spline', 144: 'superficie rifilata', 186: 'solido B-rep', 314: 'colore', 402: 'associazione', 406: 'proprietà', 502: 'vertici', 504: 'spigoli', 508: 'loop', 510: 'facce', 514: 'guscio' };
  const gp = G.split(',').map((x) => x.replace(/^\d+H/, '').trim());
  const UNITS = { 1: 'pollici', 2: 'mm', 4: 'piedi', 6: 'm', 10: 'cm' };
  return { pages: [`Modello IGES.${S ? `\nDescrizione: ${S}` : ''}\nFile: ${gp[3] || '—'} · sistema: ${gp[4] || '—'} · unità: ${UNITS[+gp[14]] || 'n.d.'} · autore: ${gp[20] || '—'} · organizzazione: ${gp[21] || '—'}\nEntità: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${NAMES[k] || `tipo ${k}`}`).join(', ')}.`] };
}
function extractGcode(s) {
  const lines = String(s).replace(/\r\n/g, '\n').split('\n'); const b = newBox(); const tools = new Set(); const feeds = new Set(); const speeds = new Set(); const counts = { G0: 0, G1: 0, G2: 0, G3: 0 };
  let x = 0; let y = 0; let z = 0; let abs = true; const comments = [];
  for (const raw of lines.slice(0, 400000)) {
    const c = /\(([^)]*)\)|;(.*)$/.exec(raw); if (c && comments.length < 80) { const t = (c[1] || c[2] || '').trim(); if (t) comments.push(t); }
    const l = raw.replace(/\(.*?\)|;.*$/g, '').toUpperCase(); if (!l.trim()) continue;
    if (/G90\b/.test(l)) abs = true; if (/G91\b/.test(l)) abs = false;
    const g = /G0?([0-3])(?!\d)/.exec(l); if (g) counts[`G${g[1]}`]++;
    for (const m of l.matchAll(/([XYZTFS])\s*(-?\d*\.?\d+)/g)) {
      const v = +m[2];
      if (m[1] === 'X') x = abs ? v : x + v; else if (m[1] === 'Y') y = abs ? v : y + v; else if (m[1] === 'Z') z = abs ? v : z + v;
      else if (m[1] === 'T') tools.add(v); else if (m[1] === 'F') feeds.add(v); else if (m[1] === 'S') speeds.add(v);
    }
    if (/[XYZ]/.test(l)) grow(b, x, y, z);
  }
  const range = (set) => (set.size ? `${Math.min(...set)}–${Math.max(...set)}` : 'n.d.');
  const summary = `Programma G-code (${lines.length} righe). Movimenti: ${counts.G0} rapidi (G0), ${counts.G1} lineari (G1), ${counts.G2 + counts.G3} circolari (G2/G3).\nUtensili: ${[...tools].map((t) => `T${t}`).join(', ') || 'n.d.'} · Avanzamenti F: ${range(feeds)} · Velocità mandrino S: ${range(speeds)}.\n${bboxText(b, 'mm (se il programma è in G21)')}\n${comments.length ? `Commenti nel programma: ${comments.join(' · ')}` : ''}`;
  return { pages: [summary, lines.slice(0, 3000).join('\n')] };
}
function extractZip(buf, ctx) {
  const z = openZip(buf); const pages = []; const listed = []; const skipped = [];
  const files = z.entries.filter((e) => !/(^|\/)(__MACOSX|\.[^/]+|thumbs\.db|desktop\.ini)(\/|$)/i.test(e.name));
  for (const e of files.slice(0, 300)) listed.push(`${e.name} (${Math.max(1, Math.round(e.usize / 1024))} KB)`);
  let read = 0;
  for (const e of files) {
    if (read >= 40) { skipped.push(e.name); continue; }
    const f = FORMATS[extOf(e.name)];
    if (!f || f.x === 'zip' || f.x === 'image' || e.usize > 15 * 1048576) { skipped.push(e.name); continue; }
    try { const b = z.read(e); if (!b) continue; const r = EXTRACT[f.x](b, ctx); if (r && !r.then) { pages.push(...r.pages.map((p) => `File «${e.name}»\n${p}`)); read++; } } catch { skipped.push(e.name); }
  }
  pages.unshift(`Archivio ZIP con ${files.length} file. Contenuto:\n${listed.join('\n')}${files.length > 300 ? '\n…' : ''}`);
  return { pages, note: skipped.length ? `${read} file letti; ${skipped.length} non letti (immagini, formati non supportati o troppi file): caricali a parte se servono.` : null };
}
const EXTRACT = {
  text: (b) => ({ pages: [b.toString('utf8').replace(/\r\n/g, '\n').replace(/^﻿/, '')] }), csv: (b) => extractCsv(b.toString('utf8')), html: (b) => { const r = htmlToText(b.toString('utf8')); return { pages: [`${r.title ? `${r.title}\n\n` : ''}${r.text}`] }; },
  rtf: (b) => extractRtf(b.toString('latin1')), svg: (b) => extractSvg(b.toString('utf8')), docx: extractDocx, xlsx: extractXlsx, pptx: extractPptx, odf: extractOdf, epub: extractEpub, ole: extractOle,
  stl: extractStl, obj: (b) => extractObj(b.toString('latin1')), '3mf': extract3mf, fcstd: extractFcstd, dxf: extractDxf, step: extractStep, iges: extractIges, gcode: (b) => extractGcode(b.toString('latin1')), zip: extractZip,
};

// ── PDF: testo; se è scansionato (senza testo) e c'è il modello "vista", si leggono le immagini JPEG delle pagine ──
async function extractPdf(buf, { vision, log } = {}) {
  const pdfParse = require('pdf-parse');
  const pages = [];
  // pdf.js 1.10 fallisce con "bad XRef entry" sui PDF molto piccoli (< ~4 KB): si aggiungono a-capo finali, ammessi dopo %%EOF.
  const safe = buf.length < 8192 ? Buffer.concat([buf, Buffer.alloc(8192 - buf.length, 10)]) : buf;
  await pdfParse(safe, {
    pagerender: async (page) => {
      const tc = await page.getTextContent(); let last; let out = '';
      for (const it of tc.items) { if (last !== undefined && last !== it.transform[5]) out += '\n'; else if (out) out += ' '; out += it.str; last = it.transform[5]; }
      pages.push(out); return out;
    },
  });
  const textChars = pages.join('').replace(/\s/g, '').length;
  if (textChars >= 40 * Math.max(1, pages.length) / 4 || !vision) {
    return textChars || !pages.length ? { pages } : { pages, note: 'PDF senza testo (forse scansionato): per leggerlo serve il modello IA «vista» (vedi AI_VISION_MODEL).' };
  }
  // PDF scansionato: le pagine sono quasi sempre immagini JPEG (filtro DCTDecode) incorporate così come sono
  const jpgs = [];
  const s = buf.toString('latin1'); const rx = /\/Filter\s*\/DCTDecode[\s\S]{0,400}?stream\r?\n/g; let m;
  while ((m = rx.exec(s)) && jpgs.length < 12) {
    const start = m.index + m[0].length; const end = s.indexOf('endstream', start); if (end < 0) break;
    const img = buf.subarray(start, end); if (img[0] === 0xff && img[1] === 0xd8 && img.length > 20_000) jpgs.push(img);
  }
  if (!jpgs.length) return { pages, note: 'PDF scansionato con immagini in un formato che il server non sa estrarre: salva le pagine come JPG o PNG e caricale come immagini.' };
  const out = [];
  for (const [i, img] of jpgs.entries()) {
    try { out.push(await vision(img, 'image/jpeg', { page: i + 1 })); } catch (e) { log?.warn('vista su PDF', { err: e }); out.push('(pagina non leggibile)'); }
  }
  return { pages: out, note: `PDF scansionato: ${out.length} pagine trascritte dal modello «vista»${jpgs.length >= 12 ? ' (solo le prime 12)' : ''}. Controlla sempre il testo originale.`, ocr: true };
}

// ── immagini: il modello "vista" descrive e trascrive (OCR) ──
async function extractImage(buf, fmt, { vision }) {
  if (!vision) return { pages: [] };
  const text = await vision(buf, fmt.mime, {});
  return { pages: [text], ocr: true };
}

async function extractText(fmt, buf, opts = {}) {
  if (fmt.capability !== 'ia_testo') return { pages: [] };
  let r;
  if (fmt.kind === 'pdf' || fmt.x === 'pdf') r = await extractPdf(buf, opts);
  else if (fmt.x === 'image') r = await extractImage(buf, fmt, opts);
  else if (EXTRACT[fmt.x]) r = EXTRACT[fmt.x](buf, opts);
  else if (fmt.text) r = EXTRACT.text(buf);
  else r = { pages: [] };
  return { ...r, pages: clip(r.pages) };
}

// Spezza il testo in passaggi di ~900 caratteri mantenendo la pagina d'origine.
function chunkPages(pages, target = 900, max = 1400) {
  const chunks = [];
  pages.forEach((txt, i) => {
    const paras = String(txt).split(/\n{2,}|(?<=[.!?:])\n|\n(?=(?:Foglio|Diapositiva|File) )|\n(?=\d+: )/).map((p) => p.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()).filter(Boolean);
    let cur = '';
    const flush = () => { if (cur.trim()) chunks.push({ page: i + 1, text: cur.trim() }); cur = ''; };
    for (const p of paras) {
      if (p.length > max) { flush(); for (let k = 0; k < p.length; k += target) chunks.push({ page: i + 1, text: p.slice(k, k + target) }); continue; }
      if ((cur + ' ' + p).length > target) flush();
      cur += (cur ? '\n' : '') + p;
    }
    flush();
  });
  return chunks;
}
// elenco per l'interfaccia (cosa si può caricare e cosa ne fa l'IA)
function formatList({ vision = false } = {}) {
  const out = Object.entries(FORMATS).map(([ext, f]) => ({ ext, kind: f.kind, capability: f.x === 'image' && !vision ? 'visualizzabile' : f.capability }));
  for (const [ext, kind] of Object.entries(ARCHIVE_ONLY)) out.push({ ext, kind, capability: 'solo_archivio' });
  return out.map((f) => ({ ...f, label: capabilityLabel(f.kind, f.capability) }));
}
module.exports = { classify, extractText, chunkPages, formatList, capabilityLabel, FORMATS, CAPABILITY_LABEL, ARCHIVE_HINT };
