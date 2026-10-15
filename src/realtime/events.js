'use strict';
// Registro persistente degli eventi di sincronizzazione.
// - Ogni evento ha un event_id univoco (deduplica) e un numero di sequenza crescente per progetto (recupero dei mancanti).
// - Gli eventi sono NOTIFICHE leggere (tipo + id entità): i contenuti si rileggono via REST, dove si verificano i permessi.
//   Così un partecipante revocato non può ricostruire contenuti dai soli eventi.
const { uuid, now, jparse } = require('../lib/util');

function createEvents({ db }) {
  const listeners = new Set();
  function publish(projectId, { type, entityType = null, entityId = null, actorId = null, data = null }) {
    const eventId = uuid();
    const r = db.run('INSERT INTO sync_events (project_id, event_id, type, entity_type, entity_id, actor_id, data_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
      projectId, eventId, type, entityType, entityId, actorId, data ? JSON.stringify(data) : null, now());
    const ev = shape({ seq: Number(r.lastInsertRowid), project_id: projectId, event_id: eventId, type, entity_type: entityType, entity_id: entityId, actor_id: actorId, data_json: data ? JSON.stringify(data) : null, created_at: now() });
    for (const l of listeners) { try { l(ev); } catch { /* un listener difettoso non blocca gli altri */ } }
    return ev;
  }
  const shape = (r) => ({ seq: r.seq, eventId: r.event_id, projectId: r.project_id, type: r.type, entityType: r.entity_type, entityId: r.entity_id, actorId: r.actor_id, data: jparse(r.data_json, null), at: r.created_at });
  function since(projectId, afterSeq = 0, limit = 500) {
    return db.all('SELECT * FROM sync_events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?', projectId, afterSeq, limit).map(shape);
  }
  const lastSeq = (projectId) => db.get('SELECT COALESCE(MAX(seq),0) s FROM sync_events WHERE project_id = ?', projectId).s;
  return { publish, since, lastSeq, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
}
module.exports = { createEvents };
