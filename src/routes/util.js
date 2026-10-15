'use strict';
// Piccoli helper per le route: gestione di handler sincroni/asincroni e validazione leggera.
const { E } = require('../lib/errors');

// Un handler restituisce il valore da serializzare in JSON (o risponde da solo).
const route = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') out.then((v) => { if (!res.headersSent && v !== undefined) res.json(v); }).catch(next);
    else if (!res.headersSent && out !== undefined) res.json(out);
  } catch (e) { next(e); }
};
const str = (v, name, { min = 0, max = 4000 } = {}) => {
  if (typeof v !== 'string') throw E.bad(`Campo "${name}" mancante o non valido.`);
  const s = v.trim(); if (s.length < min || s.length > max) throw E.bad(`Campo "${name}" non valido (lunghezza ${min}-${max}).`);
  return s;
};
const fixName = (n) => Buffer.from(String(n || ''), 'latin1').toString('utf8'); // multer decodifica i nomi file come latin1
module.exports = { route, str, fixName };
