'use strict';
// Unità di misura e dimensioni fisiche. Serve a NON confrontare mai direttamente grandezze di natura diversa.
const UNITS = {
  m: ['length', 1], mm: ['length', 1e-3], cm: ['length', 1e-2], km: ['length', 1e3],
  N: ['force', 1], kN: ['force', 1e3], daN: ['force', 10], kgf: ['force', 9.80665],
  'N·m': ['torque', 1], 'N·mm': ['torque', 1e-3], 'kN·m': ['torque', 1e3],
  W: ['power', 1], kW: ['power', 1e3], MW: ['power', 1e6], CV: ['power', 735.49875], hp: ['power', 745.69987],
  V: ['voltage', 1], mV: ['voltage', 1e-3], kV: ['voltage', 1e3],
  A: ['current', 1], mA: ['current', 1e-3],
  Pa: ['pressure', 1], kPa: ['pressure', 1e3], MPa: ['pressure', 1e6], bar: ['pressure', 1e5],
  rpm: ['angular_speed', Math.PI / 30], 'rad/s': ['angular_speed', 1],
  kg: ['mass', 1], g: ['mass', 1e-3], t: ['mass', 1e3],
  '°': ['angle', Math.PI / 180], rad: ['angle', 1],
  s: ['time', 1], ms: ['time', 1e-3], min: ['time', 60],
  Hz: ['frequency', 1],
};
const ALIASES = {
  nm: 'N·m', 'n.m': 'N·m', 'n*m': 'N·m', 'n m': 'N·m', 'n·m': 'N·m', nmm: 'N·mm', 'n·mm': 'N·mm', 'n*mm': 'N·mm', 'knm': 'kN·m', 'kn·m': 'kN·m',
  'giri/min': 'rpm', 'rev/min': 'rpm', 'rad/sec': 'rad/s', gradi: '°', deg: '°', grad: '°', 'n/mm2': 'MPa', 'n/mm²': 'MPa', cv: 'CV', kw: 'kW', mw: 'MW', hp: 'hp',
  volt: 'V', ampere: 'A', watt: 'W', newton: 'N', millimetri: 'mm', metri: 'm', secondi: 's', mpa: 'MPa', kpa: 'kPa', pa: 'Pa', khz: 'Hz', hz: 'Hz',
};
const LOWER = new Map(Object.keys(UNITS).map((k) => [k.toLowerCase(), k]));

function normalizeUnit(u) {
  const s = String(u || '').trim().replace(/\s+/g, ' ');
  if (UNITS[s]) return s;
  const l = s.toLowerCase();
  if (ALIASES[l]) return ALIASES[l];
  // Maiuscole/minuscole significative (mm vs Mm, N vs n): ammesso solo se non ambiguo
  if (LOWER.has(l) && !['mm', 'm', 'pa', 'mpa'].includes(l)) return LOWER.get(l);
  return null;
}
const dimOf = (u) => { const n = normalizeUnit(u); return n ? UNITS[n][0] : null; };
function toSI(value, unit) {
  const n = normalizeUnit(unit);
  if (!n) return null;
  return { dim: UNITS[n][0], si: Number(value) * UNITS[n][1], unit: n };
}
// Dimensione attesa per la grandezza dichiarata dall'autore (campo "quantity").
const QUANTITIES = {
  lunghezza: 'length', forza: 'force', coppia: 'torque', potenza: 'power', tensione_elettrica: 'voltage', corrente: 'current',
  pressione: 'pressure', tensione_meccanica: 'pressure', velocita_angolare: 'angular_speed', massa: 'mass', angolo: 'angle', tempo: 'time', frequenza: 'frequency',
};
const DIM_LABEL = { length: 'lunghezza', force: 'forza', torque: 'momento/coppia', power: 'potenza', voltage: 'tensione elettrica', current: 'corrente', pressure: 'pressione/tensione meccanica', angular_speed: 'velocità angolare', mass: 'massa', angle: 'angolo', time: 'tempo', frequency: 'frequenza' };

// Legge "25 N·m", "1,5 kN", "300mm", "20 Nm" -> {value, unit, dim}
function parseQuantity(text) {
  // Se lo studente scrive un passaggio ("F = 12 / 0,12 = 100 N") conta il risultato: la parte dopo l'ultimo "=" / "≈".
  let src = String(text || '').trim();
  const cut = Math.max(src.lastIndexOf('='), src.lastIndexOf('≈'));
  if (cut >= 0 && /\d/.test(src.slice(cut + 1))) src = src.slice(cut + 1).trim();
  const rx = /(-?\d+(?:[.,]\d+)?)\s*([A-Za-z°·*\/²0-9 .]{1,10})?/g;
  const found = [];
  for (let m = rx.exec(src); m; m = rx.exec(src)) {
    const value = Number(m[1].replace(',', '.'));
    const rawUnit = (m[2] || '').trim().replace(/[.,;:!?)]+$/, '');
    const unit = rawUnit ? normalizeUnit(rawUnit) || normalizeUnit(rawUnit.split(' ')[0]) : null;
    found.push({ value, unit, dim: unit ? UNITS[unit][0] : null });
    if (m[0].length === 0) rx.lastIndex++;
  }
  if (!found.length) return null;
  return found.find((f) => f.unit) || found[0];
}
module.exports = { UNITS, normalizeUnit, dimOf, toSI, QUANTITIES, DIM_LABEL, parseQuantity };
