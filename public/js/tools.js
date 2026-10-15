// QUICK TOOLS — menu a tendina raggiungibile da ovunque (Dynamic Island → chiave inglese, oppure Alt+T):
// convertitore di unità, calcolatrice tecnica (con formule rapide), basi numeriche BIN/HEX/DEC/OCT,
// Live Code Runner (JavaScript nel browser; Python e C++ sul server solo se l'amministratore li ha accesi),
// formattatore di codice e JSON. Tutto gira nel browser tranne Python/C++.
import { h, add, clear, toast } from './dom.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

// ───────── unità ─────────
const PI = Math.PI;
const UNITS = {
  lunghezza: { label: 'Lunghezza', u: { 'µm': 1e-6, mm: 1e-3, cm: 1e-2, dm: 0.1, m: 1, km: 1e3, in: 0.0254, ft: 0.3048 }, def: ['mm', 'in'] },
  massa: { label: 'Massa', u: { g: 1e-3, kg: 1, t: 1e3, lb: 0.45359237 }, def: ['kg', 'lb'] },
  forza: { label: 'Forza', u: { N: 1, daN: 10, kN: 1e3, kgf: 9.80665, lbf: 4.4482216 }, def: ['kN', 'kgf'] },
  pressione: { label: 'Pressione / tensione', u: { Pa: 1, kPa: 1e3, MPa: 1e6, 'N/mm²': 1e6, bar: 1e5, atm: 101325, psi: 6894.757 }, def: ['bar', 'MPa'] },
  coppia: { label: 'Coppia / momento', u: { 'N·mm': 1e-3, 'N·m': 1, 'kN·m': 1e3, 'kgf·m': 9.80665, 'lbf·ft': 1.3558179 }, def: ['N·m', 'N·mm'] },
  potenza: { label: 'Potenza', u: { W: 1, kW: 1e3, CV: 735.49875, HP: 745.69987 }, def: ['kW', 'CV'] },
  energia: { label: 'Energia / lavoro', u: { J: 1, kJ: 1e3, Wh: 3600, kWh: 3.6e6, cal: 4.184, kcal: 4184 }, def: ['kWh', 'kJ'] },
  velocita: { label: 'Velocità', u: { 'mm/s': 1e-3, 'm/s': 1, 'm/min': 1 / 60, 'km/h': 1 / 3.6 }, def: ['m/s', 'km/h'] },
  angolare: { label: 'Velocità angolare', u: { 'rad/s': 1, 'giri/min': (2 * PI) / 60, 'giri/s': 2 * PI, '°/s': PI / 180 }, def: ['giri/min', 'rad/s'] },
  angolo: { label: 'Angolo', u: { '°': PI / 180, rad: 1, giro: 2 * PI }, def: ['°', 'rad'] },
  area: { label: 'Area', u: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1 }, def: ['mm²', 'cm²'] },
  volume: { label: 'Volume', u: { 'mm³': 1e-9, 'cm³': 1e-6, mL: 1e-6, L: 1e-3, 'm³': 1 }, def: ['L', 'cm³'] },
  portata: { label: 'Portata', u: { 'L/min': 1e-3 / 60, 'L/s': 1e-3, 'm³/h': 1 / 3600, 'm³/s': 1 }, def: ['L/min', 'm³/h'] },
  temperatura: { label: 'Temperatura', u: { '°C': 'c', K: 'k', '°F': 'f' }, def: ['°C', 'K'] },
};
const toK = (v, u) => (u === '°C' ? v + 273.15 : u === '°F' ? (v - 32) * 5 / 9 + 273.15 : v);
const fromK = (v, u) => (u === '°C' ? v - 273.15 : u === '°F' ? (v - 273.15) * 9 / 5 + 32 : v);
export function convert(cat, value, from, to) {
  const c = UNITS[cat]; if (!c) return NaN;
  if (cat === 'temperatura') return fromK(toK(value, from), to);
  return (value * c.u[from]) / c.u[to];
}
export const fmtNum = (x) => {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'non definito';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return x.toExponential(6).replace(/\.?0+e/, 'e').replace('.', ',');
  return Number(x.toPrecision(10)).toLocaleString('it-IT', { maximumFractionDigits: 8 });
};

// ───────── calcolatrice: parser sicuro (niente eval) ─────────
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log10, log2: Math.log2, abs: Math.abs, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil };
const TRIG = new Set(['sin', 'cos', 'tan']); const ATRIG = new Set(['asin', 'acos', 'atan']);
export function evaluate(src, { deg = true, ans = 0 } = {}) {
  const s = String(src).replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i]; const eat = (c) => { if (s[i] === c) { i++; return true; } return false; };
  const fail = (m) => { throw new Error(m); };
  function number() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) fail('Numero atteso'); i += m[0].length; return parseFloat(m[0]);
  }
  function primary() {
    if (eat('(')) { const v = expr(); if (!eat(')')) fail('Manca una parentesi chiusa'); return v; }
    if (/[\d.]/.test(peek() || '')) return number();
    const m = /^[a-z][a-z0-9]*/i.exec(s.slice(i));
    if (m) {
      const w = m[0].toLowerCase(); i += m[0].length;
      if (w === 'pi') return PI; if (w === 'e') return Math.E; if (w === 'g') return 9.80665; if (w === 'ans') return ans;
      if (Object.hasOwn(FN, w)) { if (!eat('(')) fail(`Dopo ${w} servono le parentesi`); let v = expr(); if (!eat(')')) fail('Manca una parentesi chiusa'); if (TRIG.has(w) && deg) v = v * PI / 180; let r = FN[w](v); if (ATRIG.has(w) && deg) r = r * 180 / PI; return r; }
      fail(`Non conosco “${w}”`);
    }
    fail(i >= s.length ? 'Espressione incompleta' : `Simbolo inatteso “${peek()}”`);
  }
  function postfix() { let v = primary(); while (eat('!')) { if (v < 0 || v > 170 || !Number.isInteger(v)) fail('Fattoriale solo di interi tra 0 e 170'); let f = 1; for (let k = 2; k <= v; k++) f *= k; v = f; } while (eat('%')) v /= 100; return v; }
  function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return power(); }
  function power() { const b = postfix(); if (eat('^')) return b ** unary(); return b; }
  function term() { let v = unary(); for (;;) { if (eat('*')) v *= unary(); else if (eat('/')) v /= unary(); else if (/[a-z(]/i.test(peek() || '') && !/^e[+-]?\d/i.test(s.slice(i))) v *= unary(); else return v; } } // 2pi, 3(4+1)
  function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
  if (!s) fail('Scrivi un’espressione');
  const v = expr(); if (i < s.length) fail(`Simbolo inatteso “${s[i]}”`);
  return v;
}

// ───────── basi numeriche ─────────
export function parseBase(str, base) {
  const t = String(str).trim().replace(/[\s_]/g, '').replace(/^0[xb]/i, '').toLowerCase(); if (!t) return null;
  const neg = t.startsWith('-'); const d = neg ? t.slice(1) : t;
  const ok = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/ }[base]; if (!ok.test(d)) return NaN;
  let v = 0n; for (const ch of d) v = v * BigInt(base) + BigInt(parseInt(ch, 16));
  return neg ? -v : v;
}
export function toBases(v, bits = 16, signed = false) {
  const mod = 1n << BigInt(bits); const max = signed ? (mod >> 1n) - 1n : mod - 1n; const min = signed ? -(mod >> 1n) : 0n;
  const overflow = v > max || v < min;
  const u = ((v % mod) + mod) % mod; // complemento a due sul numero di bit scelto
  const asSigned = signed && u >= (mod >> 1n) ? u - mod : u;
  const group = (s, n) => s.replace(new RegExp(`\\B(?=(.{${n}})+$)`, 'g'), ' '); // spazio ogni n cifre, da destra
  return { dec: (signed ? asSigned : u).toString(10), hex: group(u.toString(16).toUpperCase().padStart(bits / 4, '0'), 4), bin: group(u.toString(2).padStart(bits, '0'), 4), oct: u.toString(8), overflow, bitsArr: u.toString(2).padStart(bits, '0').split('') };
}

// ───────── formattatori ─────────
export function formatJson(src, { minify = false } = {}) {
  try { return { ok: true, text: JSON.stringify(JSON.parse(src), null, minify ? 0 : 2) }; }
  catch (e) {
    const pos = /position (\d+)/.exec(e.message)?.[1]; let where = '';
    if (pos != null) { const before = src.slice(0, +pos); where = ` (riga ${before.split('\n').length}, colonna ${+pos - before.lastIndexOf('\n')})`; }
    return { ok: false, error: `JSON non valido${where}: ${e.message.replace(/^JSON\.parse: /, '')}` };
  }
}
// riordino BASE dell'indentazione: per linguaggi con graffe (C, C++, JS, Java, Arduino, ST con BEGIN/END non supportato) e per Python (tab → 4 spazi)
export function formatCode(src, lang = 'cpp', width = 2) {
  const lines = String(src).replace(/\r\n/g, '\n').replace(/\t/g, ' '.repeat(lang === 'python' ? 4 : width)).split('\n').map((l) => l.replace(/\s+$/, ''));
  if (lang === 'python') return lines.join('\n').replace(/\n{3,}/g, '\n\n\n').trim() + '\n';
  let depth = 0; const out = [];
  for (const raw of lines) {
    const l = raw.trim(); if (!l) { out.push(''); continue; }
    const code = l.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\/\/.*$|\/\*.*?\*\//g, '');
    const opens = (code.match(/[{([]/g) || []).length; const closes = (code.match(/[})\]]/g) || []).length;
    const lead = /^[})\]]/.test(l) ? 1 : 0;
    const caseLine = /^(case\b.*:|default:)/.test(l) ? 1 : 0;
    out.push(' '.repeat(Math.max(0, depth - lead - caseLine) * width) + l);
    depth = Math.max(0, depth + opens - closes);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ───────── interfaccia ─────────
const TABS = [['conv', 'Unità', 'swap'], ['calc', 'Calcolatrice', 'calc'], ['base', 'BIN/HEX', 'hash'], ['code', 'Code Runner', 'code'], ['fmt', 'Formatta', 'list']];
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } };

export function createTools({ S }) {
  let tab = lsGet('omar.tools.tab', 'conv'); let runnerInfo = null;
  const body = h('div', { class: 'qt-body' });
  const tabs = h('div', { class: 'qt-tabs', role: 'tablist', 'aria-label': 'Strumenti' });
  const panel = h('div', { class: 'qt', role: 'dialog', 'aria-label': 'Quick Tools', hidden: true, tabindex: '-1' }, [
    h('div', { class: 'qt-head' }, [icon('tool', 18), h('strong', { text: 'Quick Tools' }), h('span', { class: 'qt-kb', text: 'Alt+T' }), h('span', { class: 'sp' }), h('button', { class: 'isl-ico', type: 'button', 'aria-label': 'Chiudi i Quick Tools', onclick: () => close() }, icon('x', 16))]),
    tabs, body]);
  document.body.append(panel);
  let state = { code: lsGet('omar.tools.code', { language: 'javascript', code: '// Scrivi qui il tuo codice JavaScript\nconst coppia = 12;   // N·m\nconst giri = 1450;   // giri/min\nconsole.log("Potenza:", (coppia * giri / 9549).toFixed(2), "kW");' }) };

  function drawTabs() {
    clear(tabs);
    for (const [k, l, ic] of TABS) tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), class: 'qt-tab', onclick: () => { tab = k; lsSet('omar.tools.tab', k); draw(); } }, icon(ic, 15), l));
  }
  function draw() { drawTabs(); clear(body); ({ conv, calc, base, code, fmt })[tab](); }

  // convertitore
  function conv() {
    let cat = lsGet('omar.tools.cat', 'pressione'); if (!UNITS[cat]) cat = 'pressione';
    const catSel = h('select', { 'aria-label': 'Grandezza' }, Object.entries(UNITS).map(([k, c]) => h('option', { value: k, text: c.label, selected: k === cat })));
    const val = h('input', { type: 'text', inputmode: 'decimal', value: '1', 'aria-label': 'Valore' });
    const from = h('select', { 'aria-label': 'Da' }); const to = h('select', { 'aria-label': 'A' });
    const out = h('div', { class: 'qt-result', 'aria-live': 'polite' }); const all = h('div', { class: 'qt-all' });
    const fill = () => { clear(from); clear(to); const c = UNITS[cat]; for (const u of Object.keys(c.u)) { from.append(h('option', { value: u, text: u, selected: u === c.def[0] })); to.append(h('option', { value: u, text: u, selected: u === c.def[1] })); } };
    const calcNow = () => {
      let v; try { v = evaluate(val.value || '0'); } catch { out.textContent = 'Valore non valido'; clear(all); return; }
      out.textContent = `${fmtNum(v)} ${from.value} = ${fmtNum(convert(cat, v, from.value, to.value))} ${to.value}`;
      clear(all); for (const u of Object.keys(UNITS[cat].u)) if (u !== from.value) all.append(h('button', { type: 'button', class: 'qt-chip', title: 'Copia', onclick: async () => { try { await navigator.clipboard.writeText(String(convert(cat, v, from.value, u))); toast('Copiato.'); } catch { /* ignora */ } } }, h('strong', { text: fmtNum(convert(cat, v, from.value, u)) }), ` ${u}`));
    };
    catSel.addEventListener('change', () => { cat = catSel.value; lsSet('omar.tools.cat', cat); fill(); calcNow(); });
    for (const el of [val, from, to]) el.addEventListener(el === val ? 'input' : 'change', calcNow);
    const swap = h('button', { class: 'qt-swap', type: 'button', 'aria-label': 'Inverti le unità', title: 'Inverti', onclick: () => { const a = from.value; from.value = to.value; to.value = a; calcNow(); } }, icon('swap', 15));
    fill(); calcNow();
    add(body, [catSel, h('div', { class: 'qt-conv' }, [val, from, swap, to]), out, h('p', { class: 'qt-lbl', text: 'Lo stesso valore in tutte le unità (clic per copiare)' }), all]);
    requestAnimationFrame(() => val.select());
  }
  // calcolatrice tecnica
  function calc() {
    const hist = lsGet('omar.tools.hist', []); let deg = lsGet('omar.tools.deg', true); let ans = hist[0]?.v ?? 0;
    const inp = h('input', { type: 'text', class: 'qt-expr mono', placeholder: 'es. 2*pi*1450/60  ·  sqrt(3^2+4^2)  ·  sin(30)', 'aria-label': 'Espressione', spellcheck: false });
    const out = h('div', { class: 'qt-result', 'aria-live': 'polite' }); const histEl = h('ol', { class: 'qt-hist' });
    const degBtn = h('button', { type: 'button', class: 'qt-chip', 'aria-pressed': String(deg), onclick: () => { deg = !deg; lsSet('omar.tools.deg', deg); degBtn.setAttribute('aria-pressed', String(deg)); degBtn.textContent = deg ? 'Gradi (°)' : 'Radianti'; live(); } }, deg ? 'Gradi (°)' : 'Radianti');
    const live = () => { if (!inp.value.trim()) { out.textContent = ''; return; } try { out.textContent = `= ${fmtNum(evaluate(inp.value, { deg, ans }))}`; out.classList.remove('bad'); } catch (e) { out.textContent = e.message; out.classList.add('bad'); } };
    const drawHist = () => { clear(histEl); for (const x of hist.slice(0, 8)) histEl.append(h('li', null, h('button', { type: 'button', onclick: () => { inp.value = x.e; live(); inp.focus(); } }, h('span', { class: 'mono', text: x.e }), h('strong', { text: ` = ${fmtNum(x.v)}` })))); };
    const commit = () => { try { const v = evaluate(inp.value, { deg, ans }); ans = v; hist.unshift({ e: inp.value, v }); hist.splice(12); lsSet('omar.tools.hist', hist); drawHist(); inp.select(); } catch (e) { out.textContent = e.message; out.classList.add('bad'); } };
    inp.addEventListener('input', live); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    const keys = ['(', ')', 'pi', '^', 'sqrt(', 'sin(', 'cos(', 'tan(', 'ln(', 'log(', 'ans', 'g'].map((k) => h('button', { type: 'button', class: 'qt-key', text: k, onclick: () => { inp.setRangeText(k, inp.selectionStart, inp.selectionEnd, 'end'); inp.focus(); live(); } }));
    // formule rapide (meccanica e meccatronica)
    const FORM = [
      { t: 'Potenza da coppia e giri', f: [['C', 'Coppia [N·m]', 12], ['n', 'Giri [giri/min]', 1450]], r: (v) => `P = C·n/9549 = ${fmtNum(v.C * v.n / 9549)} kW` },
      { t: 'Legge di Ohm', f: [['R', 'Resistenza [Ω]', 220], ['I', 'Corrente [A]', 0.02]], r: (v) => `V = R·I = ${fmtNum(v.R * v.I)} V · P = ${fmtNum(v.R * v.I * v.I)} W` },
      { t: 'Forza di un cilindro pneumatico', f: [['p', 'Pressione [bar]', 6], ['D', 'Alesaggio [mm]', 40]], r: (v) => `F = p·A = ${fmtNum(v.p * 0.1 * PI * v.D * v.D / 4)} N (teorica, in spinta)` },
      { t: 'Tensione normale', f: [['F', 'Forza [N]', 10000], ['A', 'Area [mm²]', 78.5]], r: (v) => `σ = F/A = ${fmtNum(v.F / v.A)} MPa` },
      { t: 'Velocità periferica', f: [['d', 'Diametro [mm]', 100], ['n', 'Giri [giri/min]', 1450]], r: (v) => `v = π·d·n/60000 = ${fmtNum(PI * v.d * v.n / 60000)} m/s` },
    ];
    const fsel = h('select', { 'aria-label': 'Formula rapida' }, FORM.map((f, i) => h('option', { value: i, text: f.t }))); const fbox = h('div', { class: 'qt-form' }); const fout = h('div', { class: 'qt-result small' });
    const drawF = () => { clear(fbox); const F = FORM[+fsel.value]; const vals = {}; const upd = () => { try { fout.textContent = F.r(vals); } catch { fout.textContent = ''; } };
      for (const [k, l, d] of F.f) { vals[k] = d; fbox.append(h('label', null, h('span', { text: l }), h('input', { type: 'text', inputmode: 'decimal', value: String(d).replace('.', ','), oninput: (e) => { try { vals[k] = evaluate(e.target.value || '0'); } catch { vals[k] = NaN; } upd(); } }))); }
      upd(); };
    fsel.addEventListener('change', drawF); drawF(); drawHist();
    add(body, [h('div', { class: 'qt-row' }, [inp, degBtn]), out, h('div', { class: 'qt-keys' }, keys), h('details', { class: 'qt-det' }, h('summary', { text: 'Formule rapide' }), fsel, fbox, fout, h('p', { class: 'qt-note', text: 'Utile per controllare un risultato: il ragionamento resta tuo.' })), hist.length ? [h('p', { class: 'qt-lbl', text: 'Ultimi calcoli (Invio per salvare)' }), histEl] : h('p', { class: 'qt-note', text: 'Invio salva il calcolo; «ans» è l’ultimo risultato. Funzioni: sin cos tan asin acos atan sqrt cbrt ln log log2 abs exp round; costanti pi, e, g.' })]);
    requestAnimationFrame(() => inp.focus());
  }
  // basi numeriche
  function base() {
    let bits = lsGet('omar.tools.bits', 16); let signed = lsGet('omar.tools.signed', false); let value = 0n;
    const fields = { dec: [10, 'DEC'], hex: [16, 'HEX'], bin: [2, 'BIN'], oct: [8, 'OCT'] };
    const ins = {}; const warn = h('p', { class: 'qt-note', 'aria-live': 'polite' }); const grid = h('div', { class: 'qt-bits', role: 'group', 'aria-label': 'Bit (clic per cambiare)' });
    const paint = (except) => {
      const r = toBases(value, bits, signed);
      for (const [k, el] of Object.entries(ins)) if (k !== except) el.value = r[k];
      warn.textContent = r.overflow ? `Attenzione: il valore non sta in ${bits} bit ${signed ? 'con segno' : 'senza segno'}; mostro i ${bits} bit meno significativi.` : '';
      clear(grid); r.bitsArr.forEach((b, i) => grid.append(h('button', { type: 'button', class: `qt-bit${b === '1' ? ' on' : ''}${i % 4 === 0 && i ? ' gap' : ''}`, title: `bit ${bits - 1 - i}`, 'aria-label': `bit ${bits - 1 - i}: ${b}`, onclick: () => { const u = BigInt.asUintN(bits, value) ^ (1n << BigInt(bits - 1 - i)); value = signed ? BigInt.asIntN(bits, u) : u; paint(); } }, b)));
    };
    for (const [k, [b, l]] of Object.entries(fields)) {
      ins[k] = h('input', { type: 'text', class: 'mono', spellcheck: false, 'aria-label': l, oninput: (e) => { const v = parseBase(e.target.value, b); if (v === null) { value = 0n; paint(k); return; } if (Number.isNaN(v)) { e.target.classList.add('bad'); return; } e.target.classList.remove('bad'); value = v; paint(k); } });
    }
    const bitsSel = h('select', { 'aria-label': 'Numero di bit' }, [8, 16, 32].map((n) => h('option', { value: n, text: `${n} bit`, selected: n === bits })));
    bitsSel.addEventListener('change', () => { bits = +bitsSel.value; lsSet('omar.tools.bits', bits); paint(); });
    const sg = h('label', { class: 'qt-inline' }, h('input', { type: 'checkbox', checked: signed, onchange: (e) => { signed = e.target.checked; lsSet('omar.tools.signed', signed); paint(); } }), 'con segno (complemento a due)');
    add(body, [h('div', { class: 'qt-row' }, [bitsSel, sg]), h('div', { class: 'qt-bases' }, Object.entries(fields).map(([k, [, l]]) => h('label', null, h('span', { text: l }), ins[k]))), grid, warn,
      h('p', { class: 'qt-note', text: 'Utile per indirizzi e word del PLC, registri dei microcontrollori, maschere di bit.' })]);
    paint(); requestAnimationFrame(() => ins.dec.focus());
  }
  // live code runner
  function code() {
    const st = state.code;
    const lang = h('select', { 'aria-label': 'Linguaggio' }, [['javascript', 'JavaScript (nel browser)'], ['python', 'Python'], ['cpp', 'C++']].map(([v, l]) => h('option', { value: v, text: l, selected: v === st.language })));
    const ed = h('textarea', { class: 'qt-editor mono', spellcheck: false, rows: 10, 'aria-label': 'Codice' }); ed.value = st.code;
    const stdin = h('textarea', { class: 'qt-stdin mono', rows: 2, placeholder: 'Input del programma (una riga per ogni input()/cin)', 'aria-label': 'Input del programma' });
    const out = h('pre', { class: 'qt-out', 'aria-live': 'polite' }); const note = h('p', { class: 'qt-note' });
    const runBtn = h('button', { class: 'btn primary sm', type: 'button' }, icon('play', 14), 'Esegui');
    const save = () => { state.code = { language: lang.value, code: ed.value }; lsSet('omar.tools.code', state.code); };
    ed.addEventListener('input', save); ed.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ed.setRangeText('  ', ed.selectionStart, ed.selectionEnd, 'end'); save(); } if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run(); });
    const setNote = () => { const l = lang.value; const i = runnerInfo?.languages?.[l]; note.textContent = l === 'javascript' ? 'Gira nel tuo browser, isolato e senza accesso a internet. Tempo massimo 3 secondi. Ctrl+Invio per eseguire.' : i?.available ? 'Viene eseguito sul server della scuola con limiti di tempo e di output.' : (runnerInfo?.note || 'Verifico se il server può eseguire questo linguaggio…'); runBtn.disabled = l !== 'javascript' && !i?.available; };
    lang.addEventListener('change', () => { save(); setNote(); });
    const line = (t, kind = 'log') => out.append(h('span', { class: `qt-l ${kind}`, text: `${t}\n` }));
    async function run() {
      save(); clear(out); runBtn.disabled = true;
      try {
        if (lang.value === 'javascript') {
          await new Promise((resolve) => {
            let w; try { w = new Worker('/js/runner-worker.js'); } catch { line('Il browser non permette di avviare il programma.', 'error'); resolve(); return; }
            const t = setTimeout(() => { w.terminate(); line('⏱ Interrotto: ha superato i 3 secondi (forse un ciclo infinito?).', 'error'); resolve(); }, 3000);
            w.onmessage = (e) => { const m = e.data; if (m.type === 'out') line(m.text, m.kind); if (m.type === 'done') { clearTimeout(t); w.terminate(); line(`— terminato in ${m.ms} ms`, 'meta'); resolve(); } };
            w.onerror = (e) => { clearTimeout(t); w.terminate(); line(e.message || 'Errore', 'error'); resolve(); };
            w.postMessage({ code: ed.value, stdin: stdin.value });
          });
        } else {
          line('Esecuzione sul server…', 'meta');
          const r = await post('/tools/run', { language: lang.value, code: ed.value, stdin: stdin.value }); clear(out);
          if (r.phase === 'compile') { line('Errore di compilazione:', 'error'); line(r.stderr || r.stdout || '(nessun messaggio)', 'error'); }
          else { if (r.stdout) line(r.stdout.replace(/\n$/, '')); if (r.stderr) line(r.stderr.replace(/\n$/, ''), 'error'); if (r.timedOut) line('⏱ Interrotto: tempo massimo superato.', 'error'); line(`— uscita ${r.code ?? '?'} in ${r.ms} ms`, 'meta'); }
        }
      } catch (e) { line(e.message, 'error'); } finally { setNote(); if (lang.value === 'javascript') runBtn.disabled = false; }
    }
    runBtn.addEventListener('click', run);
    add(body, [h('div', { class: 'qt-row' }, [lang, h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ed.value = formatCode(ed.value, lang.value === 'python' ? 'python' : 'cpp'); save(); } }, icon('list', 14), 'Riordina'), runBtn]), ed, stdin, out, note]);
    setNote();
    if (!runnerInfo) get('/tools/runner').then((r) => { runnerInfo = r; setNote(); }).catch(() => { runnerInfo = { note: 'Non riesco a sapere se il server esegue Python e C++.', languages: {} }; setNote(); });
  }
  // formattatore
  function fmt() {
    let mode = 'json';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Cosa formattare' }, [['json', 'JSON'], ['cpp', 'C / C++ / JS / Arduino'], ['python', 'Python']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === mode), onclick: (e) => { mode = v; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, l)));
    const ta = h('textarea', { class: 'qt-editor mono', rows: 10, spellcheck: false, placeholder: 'Incolla qui JSON o codice', 'aria-label': 'Testo da formattare' });
    const msg = h('p', { class: 'qt-note', 'aria-live': 'polite' });
    const doIt = (minify) => {
      if (mode === 'json') { const r = formatJson(ta.value, { minify }); if (r.ok) { ta.value = r.text; msg.textContent = minify ? 'JSON compattato.' : 'JSON valido e formattato.'; msg.classList.remove('bad'); } else { msg.textContent = r.error; msg.classList.add('bad'); } }
      else { ta.value = formatCode(ta.value, mode); msg.textContent = 'Indentazione riordinata (riordino di base: controlla sempre il risultato).'; msg.classList.remove('bad'); }
    };
    add(body, [seg, ta, h('div', { class: 'qt-row' }, [h('button', { class: 'btn sm primary', type: 'button', onclick: () => doIt(false) }, icon('wand', 14), 'Formatta'), h('button', { class: 'btn sm', type: 'button', onclick: () => doIt(true) }, 'Compatta JSON'), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copiato.'); } catch { toast('Impossibile copiare.', 'bad'); } } }, icon('copy', 14), 'Copia')]), msg]);
  }

  let opener = null;
  function open(which, opts = {}) {
    if (which) { tab = which; lsSet('omar.tools.tab', which); }
    if (which === 'code' && opts.code) state.code = { language: ['javascript', 'python', 'cpp'].includes(opts.language) ? opts.language : opts.language === 'arduino' || opts.language === 'c' ? 'cpp' : 'javascript', code: opts.code };
    opener = document.activeElement; panel.hidden = false; draw(); document.body.classList.add('qt-open');
  }
  function close() { panel.hidden = true; document.body.classList.remove('qt-open'); opener?.focus?.(); }
  const toggle = () => (panel.hidden ? open() : close());
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && (e.key === 't' || e.key === 'T') && S.user) { e.preventDefault(); toggle(); }
    if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) { e.stopPropagation(); close(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest?.('#island, dialog')) close(); });
  return { open, close, toggle, get isOpen() { return !panel.hidden; } };
}
