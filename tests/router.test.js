'use strict';
// Riconoscimento automatico di materia / argomento / modalità / livello (niente menu per lo studente).
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('../src/engine/router');
const { loadSubjects } = require('../src/subjects/registry');
const { analyze } = require('../src/engine/policy');
const { boot } = require('./helpers');

const subjects = loadSubjects();
const R = (text, session = {}, extra = {}) => resolve({ text, subjects, session: { subjectId: 'generale', mode: 'esercizio', level: 'base', pins: {}, ...session }, state: { turns: extra.turns || 0 }, history: extra.history || [], action: extra.action || null, signals: analyze(text) });

test('router: materia e argomento dalle parole chiave', () => {
  let r = R('Come faccio a scrivere il ladder per un PLC con autoritenuta?');
  assert.equal(r.subjectId, 'meccatronica'); assert.equal(r.topicId, 'plc');
  r = R('Devo calcolare le reazioni vincolari di una trave appoggiata con un carico di 2 kN');
  assert.equal(r.subjectId, 'meccanica'); assert.equal(r.topicId, 'statica'); assert.equal(r.mode, 'esercizio');
  r = R('In SolidWorks il mio schizzo non è completamente vincolato, perché?');
  assert.equal(r.subjectId, 'disegno_3d');
  r = R('Sequenza A+ B+ A- B- con due cilindri a doppio effetto e elettrovalvole 5/2');
  assert.equal(r.subjectId, 'meccatronica'); assert.equal(r.topicId, 'elettropneumatica');
});

test('router: modalità prudente (nel dubbio guida all\'esercizio)', () => {
  assert.equal(R('Che cos\'è il momento di una forza?').mode, 'spiega');
  assert.equal(R('Ciao, cos\'è un encoder?').mode, 'spiega');
  // teoria + esercizio insieme: prevale l'esercizio (mai soluzioni pronte)
  assert.equal(R('Spiegami come risolvere questo esercizio: trave lunga 3 m con 500 N').mode, 'esercizio');
  assert.equal(R('Dammi solo il risultato').mode, 'esercizio');
  assert.equal(R('ciao').mode, 'esercizio');
  assert.equal(R('Fammi qualche domanda sui sensori induttivi').mode, 'verifica');
  assert.equal(R('Interrogami sulla flessione').mode, 'verifica');
  assert.equal(R('Domani ho la verifica, ripassiamo le tolleranze').mode, 'ripasso');
  assert.equal(R('', {}, { action: 'check' }).mode, 'verifica');
});

test('router: continuità della conversazione e cambio materia solo con indizi forti', () => {
  // una risposta breve a una domanda in corso non cambia materia né modalità
  let r = R('sì, credo 12 N', { subjectId: 'meccanica', topicId: 'statica', mode: 'verifica' }, { turns: 3 });
  assert.equal(r.subjectId, 'meccanica'); assert.equal(r.mode, 'esercizio'); // un valore numerico è un tentativo → esercizio (prudente)
  r = R('non ho capito', { subjectId: 'meccanica', topicId: 'statica', mode: 'spiega' }, { turns: 2 });
  assert.equal(r.subjectId, 'meccanica'); assert.equal(r.mode, 'spiega');
  r = R('Adesso passiamo al PLC: come si programma un temporizzatore TON in ladder?', { subjectId: 'meccanica', topicId: 'statica', mode: 'spiega' }, { turns: 4 });
  assert.equal(r.subjectId, 'meccatronica'); assert.equal(r.topicId, 'plc'); assert.equal(r.changed.subject, true);
});

test('router: livello stimato dal modo di scrivere; i valori fissati non cambiano', () => {
  assert.equal(R('Spiegami la torsione, parto da zero').level, 'base');
  assert.equal(R('Spiegami la torsione in modo rigoroso con la dimostrazione').level, 'avanzato');
  const r = R('Come funziona un PLC?', { subjectId: 'meccanica', mode: 'esercizio', level: 'intermedio', pins: { subject: true, mode: true, level: true } });
  assert.equal(r.subjectId, 'meccanica'); assert.equal(r.mode, 'esercizio'); assert.equal(r.level, 'intermedio'); assert.equal(r.confidence, 'fissata');
});

test('router: senza indizi resta "generale" e lo dice', () => {
  const r = R('Mi aiuti?');
  assert.equal(r.subjectId, 'generale'); assert.equal(r.confidence, 'bassa'); assert.ok(r.why.length >= 1);
});

test('sessione automatica: nessun parametro, evento detect, sessione aggiornata e prompt coerente', async () => {
  const t = await boot(); const u = await t.user('Ada');
  const c = await u.api('POST', '/api/sessions', {});
  assert.equal(c.status, 201); assert.equal(c.body.session.subjectId, 'generale'); assert.equal(c.body.session.auto, true);
  const sid = c.body.session.id;
  const r = await u.api('POST', `/api/sessions/${sid}/messages`, { text: 'Che cos\'è un temporizzatore TON nel PLC?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.detect.subjectId, 'meccatronica'); assert.equal(r.body.detect.mode, 'spiega');
  assert.equal(r.body.session.subjectId, 'meccatronica'); assert.equal(r.body.session.topicId, 'plc');
  const sys = t.provider.tutorCalls().at(-1).system;
  assert.match(sys, /MATERIA: Meccatronica/); assert.match(sys, /RICONOSCIMENTO AUTOMATICO/); assert.match(sys, /Spiegami un concetto/);
  // poi un esercizio: la modalità passa a guida all'esercizio
  const r2 = await u.api('POST', `/api/sessions/${sid}/messages`, { text: 'Ora risolvimi questo esercizio: nastro con fotocellula e motore, scrivimi il programma PLC completo' });
  assert.equal(r2.body.detect.mode, 'esercizio');
  assert.match(t.provider.tutorCalls().at(-1).system, /programma PLC completo\. NON scriverlo/);
  // l'elenco mostra materia, anteprima e numero di messaggi
  const l = await u.api('GET', '/api/sessions');
  assert.equal(l.body.sessions[0].messageCount, 4); assert.equal(l.body.sessions[0].subjectName, 'Meccatronica');
  await t.close();
});

test('sessione: fissare a mano e tornare all\'automatico; "generale" non vale per materiali e progetti', async () => {
  const t = await boot(); const u = await t.user('Bea');
  const sid = (await u.api('POST', '/api/sessions', {})).body.session.id;
  let p = await u.api('PATCH', `/api/sessions/${sid}`, { subjectId: 'disegno_3d', mode: 'verifica' });
  assert.equal(p.status, 200); assert.equal(p.body.session.pins.subject, true); assert.equal(p.body.session.auto, false);
  const r = await u.api('POST', `/api/sessions/${sid}/messages`, { text: 'Come si programma un PLC?' });
  assert.equal(r.body.detect.subjectId, 'disegno_3d'); assert.equal(r.body.detect.mode, 'verifica');
  p = await u.api('PATCH', `/api/sessions/${sid}`, { auto: true });
  assert.equal(p.body.session.auto, true);
  p = await u.api('PATCH', `/api/sessions/${sid}`, { title: 'Ripasso CAD' });
  assert.equal(p.body.session.title, 'Ripasso CAD');
  assert.equal((await u.api('POST', '/api/sessions', { subjectId: 'generale' })).status, 400);
  assert.equal((await u.api('POST', '/api/projects', { name: 'X', subjectId: 'generale' })).status, 400);
  await t.close();
});
