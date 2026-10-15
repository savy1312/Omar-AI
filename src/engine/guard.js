'use strict';
// Controlli applicativi sull'output del modello (il solo prompt non è una garanzia sufficiente).
const TRAILER_RE = /<stato_didattico>([\s\S]*?)(<\/stato_didattico>|$)/i;

function splitTrailer(raw) {
  const m = TRAILER_RE.exec(raw);
  let report = null;
  if (m) { try { report = JSON.parse(m[1].trim()); } catch { report = null; } }
  return { text: raw.replace(TRAILER_RE, '').trim(), report };
}
function codeBlocks(text) {
  const out = []; const re = /```[\w-]*\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}
const PLC_MARKERS = /\b(END_PROGRAM|PROGRAM\s+\w+|VAR_INPUT|VAR_OUTPUT|FUNCTION_BLOCK|END_VAR|NETWORK\s+\d+|ORGANIZATION_BLOCK)\b/i;
const BYPASS_ADVICE = /(?<!non\s)(?<!mai\s)(?<!evita(?:re)?\s)(ponticell\w+|bypass\w*|escludi|escludere|disattiva|disattivare|aggira|aggirare)\b[^.\n]{0,50}(interblocc\w*|protezion\w*|fotocellul\w*|emergenza|fungo|riparo|salvamotore)/i;

// partial=true: il testo è ancora in arrivo (streaming). Un blocco di codice non ancora chiuso si controlla come se fosse chiuso adesso:
// così un programma troppo lungo viene fermato appena supera il limite, senza aspettare la fine della risposta.
function check(text, { mode, maxExampleLines = 12, partial = false } = {}) {
  if (partial && ((text.match(/```/g) || []).length % 2 === 1)) text += '\n```';
  const issues = [];
  const strict = mode === 'esercizio' || mode === 'verifica';
  for (const b of codeBlocks(text)) {
    const lines = b.split('\n').filter((l) => l.trim()).length;
    if (strict && (lines > maxExampleLines || PLC_MARKERS.test(b))) issues.push('codice_completo');
    else if (!strict && lines > 40) issues.push('codice_troppo_lungo');
  }
  if (BYPASS_ADVICE.test(text)) issues.push('aggiramento_sicurezza');
  return issues;
}

// Rimuove riferimenti [M#]/[C#]/[D#]/[P#]/[W#] non presenti nel contesto realmente fornito (anti-citazioni inventate).
function sanitizeCitations(text, valid) {
  const removed = [];
  // togliendo un riferimento inventato si toglie anche lo spazio che lo precedeva ("lentamente [M7]." → "lentamente."), ma mai gli a capo
  const out = text.replace(/[ \t]*\[([MCDPW]\d+)\]/g, (all, id) => (valid.has(id) ? all : (removed.push(id), '')));
  return { text: out.replace(/ {2,}/g, ' '), removed };
}
const FALLBACKS = {
  codice_completo: "Preferisco non scrivere il programma o il codice completo al posto tuo: è proprio l'analisi che ti serve per impararlo.\n\nPartiamo dalla base: **quali sono gli ingressi e quali le uscite** del sistema? Elencali pure in modo semplice, anche incompleto.",
  aggiramento_sicurezza: 'Non posso guidarti a escludere o aggirare protezioni o dispositivi di sicurezza. Posso però spiegarti a cosa servono e come progettare la sequenza in simulazione mantenendole attive. Vuoi partire da lì?',
};
module.exports = { splitTrailer, check, sanitizeCitations, FALLBACKS, codeBlocks };
