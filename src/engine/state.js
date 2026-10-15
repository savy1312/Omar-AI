'use strict';
// Stato didattico della sessione: obiettivo, tentativi, difficoltà, livello degli indizi, indicatori osservati.
// Le regole di avanzamento stanno NELL'APPLICAZIONE, non nel modello: il modello può solo segnalare l'esito.
const { clamp } = require('../lib/util');

const HINT_LEVELS = [
  'Nessun indizio: lascia che lo studente provi da solo e fai solo domande di orientamento.',
  'Livello 1 – Indizio concettuale: richiama il concetto in gioco senza formule né numeri.',
  'Livello 2 – Principio/relazione: indica il principio o la relazione utile (nome e forma generale), senza applicarla ai dati.',
  'Livello 3 – Passaggio parziale: mostra UN SOLO passaggio parziale; poi lascia fare il successivo allo studente.',
  'Livello 4 – Esempio analogo: usa un esempio analogo con DATI DIVERSI, poi torna al problema originale e lascia allo studente il passaggio successivo.',
];

const initialState = () => ({
  goal: null, exercise: null, attempts: 0, hintLevel: 0, difficulties: [], phase: 'diagnosi',
  autonomy: 0, turns: 0, observed: {}, lastOutcome: null, awaitingFinalExplanation: false, unitsToCheck: false,
});

function applyUserTurn(state, { action, signals }) {
  const s = { ...state, difficulties: [...state.difficulties], observed: { ...state.observed } };
  s.turns++;
  if (action === 'hint') s.hintLevel = clamp(s.hintLevel + 1, 0, 4);
  else if (signals?.stuck) s.hintLevel = clamp(s.hintLevel + 1, 0, 4);
  if (signals?.hasAttempt || signals?.claimsDone) s.attempts++;
  return s;
}

function applyModelReport(state, report) {
  const s = { ...state, difficulties: [...state.difficulties], observed: { ...state.observed } };
  if (!report) return s;
  if (typeof report.obiettivo === 'string' && report.obiettivo.trim()) s.goal = report.obiettivo.trim().slice(0, 300);
  if (typeof report.esercizio === 'string' && report.esercizio.trim() && !s.exercise) s.exercise = report.esercizio.trim().slice(0, 400);
  if (['diagnosi', 'guida', 'verifica', 'sintesi', 'spiegazione'].includes(report.fase)) s.phase = report.fase;
  for (const d of Array.isArray(report.difficolta) ? report.difficolta.slice(0, 3) : []) {
    const x = String(d).slice(0, 120); if (x && !s.difficulties.includes(x)) s.difficulties.push(x);
  }
  s.difficulties = s.difficulties.slice(-8);
  s.unitsToCheck = !!report.unita_da_verificare;
  const out = ['corretto', 'parziale', 'errato', 'nessuno'].includes(report.esito) ? report.esito : null;
  s.lastOutcome = out;
  // Riduzione graduale dell'aiuto quando lo studente procede in autonomia
  if (out === 'corretto') { s.autonomy = clamp(s.autonomy + 1, 0, 5); s.hintLevel = clamp(s.hintLevel - 1, 0, 4); }
  else if (out === 'errato') s.autonomy = clamp(s.autonomy - 1, 0, 5);
  s.awaitingFinalExplanation = report.fase === 'sintesi';
  for (const c of Array.isArray(report.competenze) ? report.competenze.slice(0, 3) : []) {
    const k = String(c).slice(0, 80); if (k) s.observed[k] = (s.observed[k] || 0) + (out === 'corretto' ? 1 : 0);
  }
  return s;
}

// Indicatori di osservazione: mai voti, sempre con limiti espliciti.
function progressSummary(state) {
  return {
    avviso: 'Indicatori di osservazione generati automaticamente dal tutor su questa sessione. NON sono voti né valutazioni ufficiali e non sostituiscono il giudizio del docente.',
    competenzeOsservate: Object.entries(state.observed).map(([competenza, riscontriPositivi]) => ({ competenza, riscontriPositivi })),
    autonomia: ['in costruzione', 'iniziale', 'in crescita', 'buona', 'buona', 'consolidata'][state.autonomy] || 'in costruzione',
    tentativi: state.attempts, difficoltaEmerse: state.difficulties, livelloIndizio: state.hintLevel,
    limiti: 'Basati su pochi scambi testuali; possono essere imprecisi.',
  };
}
module.exports = { HINT_LEVELS, initialState, applyUserTurn, applyModelReport, progressSummary };
