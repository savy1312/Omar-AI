'use strict';
// Filtro dell'output del modello MENTRE arriva (streaming). Fa vedere allo studente solo ciò che vedrebbe a risposta finita:
//  - non mostra mai il blocco tecnico <stato_didattico>…</stato_didattico> (trattiene anche un suo inizio parziale, es. "<sta");
//  - trattiene un riferimento [M1] [W2]… finché non è completo, poi lo toglie se non è tra le fonti realmente fornite;
//  - applica i controlli della guardia anche a risposta incompleta: se scatta, lo streaming si ferma e il testo viene sostituito.
const guard = require('./guard');
const TRAILER = '<stato_didattico>';

// quanti caratteri finali non sono ancora sicuri da mostrare
function holdback(visible) {
  const low = visible.toLowerCase();
  for (let k = Math.min(TRAILER.length - 1, visible.length); k > 0; k--) if (TRAILER.startsWith(low.slice(-k))) return k;
  const m = /\[[MCDPW]?\d*$/.exec(visible);
  return m ? m[0].length : 0;
}

function createStreamFilter({ mode, valid = new Set(), maxExampleLines = 12 } = {}) {
  let raw = ''; let emitted = ''; let cut = false;
  // Restituisce { delta } (nuovo testo da aggiungere), { replace } (se il testo già mostrato deve cambiare) oppure { violation }.
  function push(chunk) {
    raw += chunk;
    const idx = raw.search(/<stato_didattico/i);
    const visible = idx >= 0 ? raw.slice(0, idx) : raw; cut = idx >= 0;
    const issues = guard.check(visible, { mode, maxExampleLines, partial: true });
    if (issues.length) return { violation: issues[0] };
    // gli spazi finali restano in attesa del carattere successivo: così togliere un riferimento inventato non accorcia mai il testo già mostrato
    const settled = (cut ? visible : visible.slice(0, visible.length - holdback(visible))).replace(/\s+$/, '');
    const out = guard.sanitizeCitations(settled, valid).text.replace(/^\s+/, '');
    if (out.startsWith(emitted)) { const delta = out.slice(emitted.length); emitted = out; return { delta }; }
    emitted = out; return { replace: out };
  }
  return { push, get emitted() { return emitted; }, get raw() { return raw; } };
}
module.exports = { createStreamFilter, holdback };
