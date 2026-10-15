'use strict';
// Registro materie estendibile: ogni file .json in questa cartella è una materia.
// Per aggiungere una materia basta creare un nuovo file JSON con la stessa struttura. Nessuna modifica al codice.
// "keywords" (facoltative, su materia e argomenti) servono al riconoscimento automatico: "radice*" = prefisso, "^2" = peso.
const fs = require('node:fs');
const path = require('node:path');

// Materia "virtuale" usata quando dal messaggio non si capisce ancora di cosa si parla.
// Non è selezionabile per materiali, obiettivi o progetti: vale solo per le sessioni di chat.
const GENERALE = Object.freeze({
  id: 'generale', name: 'Generale', description: 'Materia non ancora individuata.', safetyCritical: false, topics: [], keywords: [], virtual: true,
  tutorNotes: 'La materia non è ancora chiara dal messaggio. Se la richiesta è tecnica, chiedi con UNA domanda breve di quale materia o esercizio si tratta (Meccanica, Meccatronica, Disegno 3D) solo se serve davvero; altrimenti rispondi. Restano valide tutte le regole didattiche e di sicurezza.',
  typicalUnits: [],
});

function loadSubjects(dir = __dirname) {
  const subjects = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!s.id || !s.name || !Array.isArray(s.topics)) throw new Error(`Materia non valida: ${f}`);
    if (s.id === GENERALE.id) throw new Error(`L'identificativo "${GENERALE.id}" è riservato.`);
    s.safetyCritical = !!s.safetyCritical;
    s.keywords = Array.isArray(s.keywords) ? s.keywords : [];
    for (const t of s.topics) t.keywords = Array.isArray(t.keywords) ? t.keywords : [];
    subjects.set(s.id, s);
  }
  const pubTopic = ({ id, name }) => ({ id, name });
  return {
    list: () => [...subjects.values()].map(({ id, name, description, topics, safetyCritical }) => ({ id, name, description, topics: topics.map(pubTopic), safetyCritical })),
    get: (id) => subjects.get(id) || null,                                   // solo materie reali
    resolve: (id) => (id === GENERALE.id ? GENERALE : subjects.get(id) || null), // anche la materia "generale" delle chat
    hasTopic: (sid, tid) => !tid || !!subjects.get(sid)?.topics.some((t) => t.id === tid),
    forDetection: () => [...subjects.values()],
    GENERALE,
  };
}
module.exports = { loadSubjects, GENERALE };
