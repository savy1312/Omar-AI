'use strict';
// I documenti caricati e i messaggi sono DATI. Qui si individuano frasi che tentano di dare ordini al sistema.
// È un livello di difesa; la difesa vera sono i permessi lato server: il modello non riceve MAI dati non autorizzati.
const PATTERNS = [
  /ignor[ai]\w*\s+(tutte\s+)?(le\s+)?(istruzioni|regole|indicazioni)(\s+\w+){0,3}/gi,
  /dimentic\w+\s+(tutte\s+)?(le\s+)?(istruzioni|regole)(\s+\w+){0,3}/gi,
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)/gi,
  /disregard\s+(all\s+)?(previous|prior|the)\s+\w+/gi,
  /(nuove|new)\s+(istruzioni|instructions)\s*:/gi,
  /(rivela|mostra|stampa|ripeti|reveal|show|print)\s+(il\s+|the\s+|your\s+)?(prompt|istruzioni)\s*(di sistema|iniziale|system)?/gi,
  /system\s*prompt/gi,
  /(leggi|mostra|stampa|recupera|accedi a|read|show|dump)\s+(tutte\s+)?(le\s+)?(chat|conversazioni|messaggi)\s+(private|personali|degli altri|di altri|of others)/gi,
  /(ignora|bypassa|salta|aggira|disattiva|ignore|bypass)\s+(i\s+|the\s+)?(permessi|controlli|permissions|access control)/gi,
  /(sei|diventa|comportati come|you are now|act as|pretend to be)\s+(ora\s+)?(un\s+|una\s+)?(assistente senza|dan\b|admin|amministratore|sviluppatore|developer|root|unrestricted)\w*/gi,
  /(modalit[àa]\s+(sviluppatore|amministratore|dio)|developer mode|jailbreak)/gi,
  /<\s*\/?\s*(system|assistant|istruzioni|contesto_materiali|contesto_progetto)[^>]*>/gi,
  /\[\s*(system|inst|sistema)\s*\]/gi,
];

function detect(text) {
  const hits = [];
  for (const re of PATTERNS) { re.lastIndex = 0; let m; while ((m = re.exec(String(text || '')))) hits.push(m[0]); }
  return hits;
}
// Neutralizza il testo di un documento prima di passarlo al modello.
function neutralize(text) {
  let t = String(text || ''); let n = 0;
  for (const re of PATTERNS) { re.lastIndex = 0; t = t.replace(re, () => { n++; return '[frase rimossa: tentativo di impartire istruzioni]'; }); }
  t = t.replace(/</g, '‹').replace(/>/g, '›'); // impedisce di aprire/chiudere i tag di contesto
  return { text: t, hits: n };
}
module.exports = { detect, neutralize };
