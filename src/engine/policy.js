'use strict';
// Analisi deterministica della richiesta: decide le direttive didattiche PRIMA di interpellare il modello.
const { detect } = require('./injection');

const RX = {
  finalAnswer: /(dammi|dimmi|scrivimi|voglio|mi serve|mi servirebbe|dai)\s+(solo\s+)?(il\s+|la\s+)?(risultato|soluzione|risposta)|solo (il )?risultato|risolvi(mi)?\s+(questo|quest'|l'|il|per me)|svolgi(mi)?\s+(questo|quest'|l'|il)|fammi (tu )?(l'|il )|qual è il risultato|quanto (fa|vale|viene)\b/i,
  fullProgram: /(scrivi|dammi|fammi|genera|crea|realizza|programma)(mi)?\b[^.?!]{0,50}\b(programma|codice|ladder|grafcet|fbd|structured text|\bst\b)[^.?!]{0,40}\bplc\b|programma plc completo|\bplc\b[^.?!]{0,30}\b(completo|chiavi in mano)/i,
  fullCad: /(fammi|crea|genera|dammi|realizza|modella)(mi)?\b[^.?!]{0,50}\b(modello|file|disegno|assieme|parte)[^.?!]{0,40}\b(cad|3d|solidworks|fusion|inventor|step|stl)\b/i,
  bypassHow: /(disattiv|esclud|bypass|ponticell|aggir|toglier|tolgo|rimuov|disabilit|elimin)\w*[^.?!]{0,50}(interblocc|protezion|sicurezz|emergenza|fungo|fotocellul|barriera|riparo|salvamotore|termico|differenziale)/i,
  educationalSafety: /^\s*(perch[eé]|per quale motivo|cosa succede se|a cosa serve|che funzione)/i,
  safetyTopic: /interblocc|protezion|sicurezz|emergenza|fungo|fotocellul|barriera|riparo|salvamotore|differenziale|dispositiv\w+ di sicurezza/i,
  stuck: /non (ci )?riesco|non so (come|cosa|da dove|che)|sono bloccat|non capisco|aiut(o|ami)\b|non ho idea|mi perdo|non mi viene/i,
  claimsDone: /\b(ho|abbiamo)\s+(già\s+)?(svolto|fatto|risolto|calcolato|finito)|(il )?mio (risultato|procedimento|svolgimento)|ecco (il )?(mio |il mio )?(svolgimento|procedimento)|controlla(mi)? (il )?(mio|se)/i,
  definition: /^\s*(che cos'?è|cos'?è|cosa (è|sono|significa)|spiegami|come funziona|qual è la differenza|definisci|che differenza|a cosa serve)/i,
  attempt: /\d+([.,]\d+)?\s*(n\b|kn|nm|n·m|n\*m|mm|cm|m\b|v\b|a\b|w\b|kw|bar|pa|mpa|rpm|hz|s\b|ms|kg|°)|[=≈]\s*\d|\bho (provato|pensato|calcolato|usato)/i,
  briefing: /a che punto siamo|riassum\w*.*(progetto|lavoro)|briefing|stato del progetto|riepilogo del progetto|cosa è cambiato/i,
  groupDecisions: /decisioni (del gruppo|confermate|prese)|cosa abbiamo deciso|quali decisioni/i,
  crossChat: /\b(cosa|che cosa|quale|quali|come)\s+(ha|hanno|aveva|avevano)\s+(proposto|condiviso|detto|scritto|scelto|deciso|ipotizzato)\b|(chat|conversazione|idea|idee|proposta|proposte|lavoro|contributi?|supporti|struttura|motore)\s+(del|della|di|dal|dalla|proposti? da|proposte da)\s+(mio|mia|miei)?\s*(compagn|collega|amic)|\bmi[oa]\s+(compagn[oa]|collega|amic[oa])|\bmiei\s+(compagni|colleghi|amici)|prendi .{0,40}(dalla chat|dal gruppo)|proposti? da \p{Lu}\p{L}+|dalla chat di \p{Lu}\p{L}+|(confronta|usa|prendi).{0,60}\b(proposta|proposte|idea|idee|supporti|struttura)\b.{0,30}\b(da|di)\s+\p{Lu}\p{L}+/iu,
};

function analyze(text, { mode = 'esercizio' } = {}) {
  const t = String(text || '');
  const injection = detect(t);
  const bypass = RX.bypassHow.test(t);
  return {
    injection: injection.length > 0,
    requestsFinalAnswer: RX.finalAnswer.test(t),
    requestsFullProgram: RX.fullProgram.test(t),
    requestsFullCad: RX.fullCad.test(t),
    // 'howto' = come aggirare (rifiuto deterministico); 'educational' = domanda su protezioni/sicurezza (direttiva: spiega la funzione)
    safetyBypass: bypass ? (RX.educationalSafety.test(t) ? 'educational' : 'howto') : (RX.safetyTopic.test(t) ? 'educational' : null),
    stuck: RX.stuck.test(t),
    claimsDone: RX.claimsDone.test(t),
    definitional: RX.definition.test(t) || mode === 'spiega',
    hasAttempt: RX.attempt.test(t),
    briefing: RX.briefing.test(t),
    groupDecisions: RX.groupDecisions.test(t),
    crossChat: RX.crossChat.test(t),
  };
}

// Risposta deterministica (senza modello) per richieste di aggirare le protezioni.
const SAFETY_REFUSAL = `Su questo non posso aiutarti: non guido a disattivare, escludere o aggirare protezioni, interblocchi, arresti di emergenza o dispositivi di sicurezza, nemmeno "solo per provare".

Posso invece aiutarti a capire **a cosa serve** quella protezione e **come funziona**, oppure a progettare la sequenza *in simulazione* mantenendo tutte le sicurezze attive. Se hai un problema pratico su una macchina reale, fermati e parlane con il docente o con l'assistente di laboratorio: le attività pratiche rischiose richiedono supervisione.

Da dove vuoi partire: dalla funzione della protezione o dalla sequenza che stai progettando?`;

module.exports = { analyze, SAFETY_REFUSAL };
