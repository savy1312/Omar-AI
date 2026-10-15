'use strict';
// RICONOSCIMENTO AUTOMATICO di materia, argomento, modalità e livello (niente menu a tendina per lo studente).
// È deterministico (parole chiave + segnali della policy) e PRUDENTE: nel dubbio tra "spiegare" e "guidare
// un esercizio" sceglie sempre "esercizio", così non si rischia mai di consegnare una soluzione pronta.
// Ciò che lo studente o il docente ha fissato esplicitamente ("pins") non viene mai cambiato dal riconoscimento.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, ' ').replace(/[^a-z0-9+/&*.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cache = new WeakMap();
function compile(list) {
  if (cache.has(list)) return cache.get(list);
  const out = (list || []).map((k) => {
    let [word, w] = String(k).split('^'); w = Number(w) || 1;
    word = norm(word); const prefix = word.endsWith('*'); if (prefix) word = word.slice(0, -1);
    const rx = new RegExp(`(^|[^a-z0-9])${esc(word)}${prefix ? '' : '(?=$|[^a-z0-9+])'}`, 'g');
    return { word, w, rx };
  }).filter((k) => k.word);
  cache.set(list, out); return out;
}
function score(text, list) {
  let total = 0; const hits = [];
  for (const k of compile(list)) {
    k.rx.lastIndex = 0; const n = (text.match(k.rx) || []).length;
    if (n) { total += k.w * Math.min(n, 2); hits.push(k.word); }
  }
  return { total, hits };
}

// Segnali di modalità (sul testo normalizzato)
const RX = {
  verifica: /\b(interrogami|mettimi alla prova|fammi (qualche|una|delle|un paio di|\d+) domand[ae]|domand[ae] di verifica|verifica (se ho capito|la mia (comprensione|preparazione))|testami|quiz|fammi un test)\b/,
  ripasso: /\b(ripass\w*|riepilog\w*|ricapitol\w*|ho (la|una) (verifica|interrogazione|prova) (domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|la prossima settimana)|punti chiave)\b/,
  esercizio: /\b(esercizi\w*|problema|problemi|calcol\w*|determina\w*|dimensiona\w*|verifica(re)? la (trave|sezione|resistenza)|traccia|consegna|compito|svolgi\w*|risolv\w*|trova(re)? (il|la|l|i|le)|quanto (vale|fa|viene)|dati:)\b/,
  spiega: /^(che cos\s?e|cos\s?e|cosa (e|sono|significa|vuol dire)|spiegami|mi spieghi|come funziona|come funzionano|qual e la differenza|che differenza|differenza tra|a cosa serve|a cosa servono|perche si usa|definisci|definizione di|parlami)/,
};
const LEVEL_RX = {
  base: /\b(parto da zero|non ne so niente|non so niente|sono alle prime armi|in modo semplice|piu semplice|semplicemente|terra terra|per principianti|sono in (prima|seconda))\b/,
  avanzato: /\b(in modo (rigoroso|approfondito|avanzato)|approfondi\w*|dimostrazione|dimostra(mi)?|livello avanzato|sono in (quinta)|nel dettaglio matematico)\b/,
  intermedio: /\b(livello intermedio|so gia le basi|conosco gia le basi|sono in (terza|quarta))\b/,
};
const MODE_LABEL = { spiega: 'Spiegazione', esercizio: 'Guida all\'esercizio', verifica: 'Verifica', ripasso: 'Ripasso' };
const LEVEL_LABEL = { base: 'Base', intermedio: 'Intermedio', avanzato: 'Avanzato' };

/**
 * @param {object} p
 * @param {string} p.text testo dello studente (può essere vuoto con un'azione)
 * @param {string|null} p.action hint|simpler|check
 * @param {{subjectId,topicId,mode,level,pins}} p.session valori attuali della sessione
 * @param {{turns:number}} p.state stato didattico
 * @param {{role,content}[]} p.history ultimi messaggi
 * @param {object} p.subjects registro materie
 * @param {object} p.signals risultato di policy.analyze
 */
function resolve({ text = '', action = null, session = {}, state = {}, history = [], subjects, signals = {} }) {
  const t = norm(text);
  const lead = t.replace(/^((ciao|salve|buongiorno|buonasera|hey|ehi|scusa|scusami|senti|allora|prof|omar)\b[ ,.!]*)+/, '');
  const pins = session.pins || {};
  const turns = state.turns || 0;
  const why = [];
  const list = subjects.forDetection();

  // ── materia ──
  const prevUser = history.filter((m) => m.role === 'user').slice(-3).map((m) => norm(m.content)).join(' ');
  const scored = list.map((s) => {
    const own = score(t, s.keywords); let topicBest = 0; const topicHits = [];
    for (const tp of s.topics) { const r = score(t, tp.keywords); if (r.total > topicBest) topicBest = r.total; topicHits.push(...r.hits); }
    const now = own.total + topicBest;
    const past = prevUser ? (score(prevUser, s.keywords).total + Math.max(0, ...s.topics.map((tp) => score(prevUser, tp.keywords).total))) * 0.35 : 0;
    return { s, now, past, total: now + past, hits: [...own.hits, ...topicHits] };
  }).sort((a, b) => b.total - a.total);

  let subjectId = session.subjectId || 'generale'; let confidence = 'bassa'; let subjectChanged = false;
  if (pins.subject && session.subjectId) { confidence = 'fissata'; why.push('Materia scelta da te.'); }
  else {
    const best = scored[0]; const second = scored[1];
    const current = scored.find((x) => x.s.id === session.subjectId);
    if (best && best.now >= 2 && (!second || best.total >= second.total * 1.4 || best.total - second.total >= 2)) {
      // indizi forti nel messaggio attuale
      if (current && current.s.id !== best.s.id && turns > 0 && current.now >= best.now * 0.7) {
        confidence = 'media'; why.push(`Resto su ${current.s.name}: il messaggio è compatibile con l'argomento in corso.`);
      } else {
        subjectChanged = subjectId !== best.s.id; subjectId = best.s.id; confidence = best.now >= 4 ? 'alta' : 'media';
        why.push(`Ho riconosciuto ${best.s.name} da: ${best.hits.slice(0, 4).join(', ')}.`);
      }
    } else if (current && session.subjectId !== 'generale') {
      confidence = current.total > 0 ? 'media' : 'bassa'; why.push(`Continuo con ${current.s.name}, la materia di questa chat.`);
    } else if (best && best.total >= 1.5 && (!second || best.total > second.total)) {
      subjectChanged = subjectId !== best.s.id; subjectId = best.s.id; confidence = 'bassa';
      why.push(`Probabilmente ${best.s.name} (${best.hits.slice(0, 3).join(', ')}).`);
    } else { subjectId = session.subjectId || 'generale'; if (subjectId === 'generale') why.push('Non ho ancora capito la materia: rispondo in modo generale.'); }
  }

  // ── argomento ──
  const subject = subjects.resolve(subjectId);
  let topicId = subjectChanged ? null : session.topicId || null;
  if (pins.topic && session.topicId && !subjectChanged) { /* fissato */ }
  else if (subject && subject.topics?.length) {
    const ts = subject.topics.map((tp) => ({ tp, r: score(t, tp.keywords) })).sort((a, b) => b.r.total - a.r.total);
    if (ts[0] && ts[0].r.total >= 2 && (!ts[1] || ts[0].r.total > ts[1].r.total)) {
      if (ts[0].tp.id !== topicId) { topicId = ts[0].tp.id; why.push(`Argomento: ${ts[0].tp.name}.`); }
    }
  }

  // ── modalità (prudente) ──
  const prevMode = session.mode || 'esercizio';
  let mode = prevMode; let modeWhy = null;
  if (pins.mode && session.mode) { modeWhy = null; }
  else {
    const exerciseCue = RX.esercizio.test(t) || signals.requestsFinalAnswer || signals.claimsDone || signals.hasAttempt
      || signals.requestsFullProgram || signals.requestsFullCad || /\d+([.,]\d+)?\s*(n|kn|nm|mm|cm|m|v|a|w|kw|bar|mpa|rpm|kg|s|ms)\b/.test(t);
    const defCue = RX.spiega.test(lead) || signals.definitional;
    if (action === 'check' || RX.verifica.test(t)) { mode = 'verifica'; modeWhy = 'Mi hai chiesto di metterti alla prova: faccio domande di verifica.'; }
    else if (RX.ripasso.test(t)) { mode = 'ripasso'; modeWhy = 'Vuoi ripassare: ripercorriamo i punti chiave.'; }
    else if (exerciseCue) { mode = 'esercizio'; modeWhy = defCue ? 'C\'è un esercizio di mezzo: ti guido passo per passo (nel dubbio non do la soluzione).' : 'Sembra un esercizio: ti guido passo per passo senza darti la soluzione.'; }
    else if (defCue) { mode = 'spiega'; modeWhy = 'È una domanda di teoria: te la spiego e poi ti faccio una domanda.'; }
    else if (turns === 0) { mode = 'esercizio'; modeWhy = 'Non è chiaro se è teoria o un esercizio: parto guidandoti, senza soluzioni pronte.'; }
    else if (['verifica', 'ripasso'].includes(prevMode) || prevMode === 'spiega') { mode = prevMode; } // risposta alla domanda in corso: resto dove sono
    if (mode !== prevMode && modeWhy) why.push(modeWhy); else if (turns === 0 && modeWhy) why.push(modeWhy);
  }

  // ── livello ──
  let level = session.level || 'base';
  if (!(pins.level && session.level)) {
    if (LEVEL_RX.base.test(t) || action === 'simpler') level = 'base';
    else if (LEVEL_RX.avanzato.test(t)) level = 'avanzato';
    else if (LEVEL_RX.intermedio.test(t)) level = 'intermedio';
    if (level !== (session.level || 'base')) why.push(`Livello: ${LEVEL_LABEL[level]}.`);
  }

  const changed = {
    subject: subjectId !== session.subjectId, topic: (topicId || null) !== (session.topicId || null),
    mode: mode !== session.mode, level: level !== session.level,
  };
  return { subjectId, topicId, mode, level, confidence, why: why.slice(0, 4), changed, modeLabel: MODE_LABEL[mode], levelLabel: LEVEL_LABEL[level] };
}

module.exports = { resolve, norm, score, MODE_LABEL, LEVEL_LABEL };
