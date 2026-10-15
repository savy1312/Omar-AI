'use strict';
// Dati tecnici del progetto (parametri) e decisioni di gruppo.
// Principi: nessuna sovrascrittura silenziosa (ogni modifica a un dato confermato crea una NUOVA versione che sostituisce la precedente),
// controllo di concorrenza ottimistico (expectedVersion), l'IA non può mai confermare nulla.
const { E } = require('../lib/errors');
const { now, uuid, jparse } = require('../lib/util');
const { QUANTITIES, normalizeUnit } = require('../blackbox/units');

function createData(ctx) {
  const { db, access, events } = ctx;
  const analyze = (pid) => ctx.blackbox?.analyze(pid);

  // ───────── PARAMETRI ─────────
  const pubParam = (p) => ({ id: p.id, component: p.component, name: p.name, quantity: p.quantity, value: p.value, unit: p.unit, linkedTo: p.linked_to, author: { id: p.author_id, displayName: p.author_label }, version: p.version, status: p.status, supersedesId: p.supersedes_id, origin: p.origin, createdAt: p.created_at, updatedAt: p.updated_at });

  function addParameter(user, projectId, { component, name, quantity, value, unit, linkedTo = null, supersedes = null }) {
    access.requireMember(user, projectId);
    component = String(component || '').trim(); name = String(name || '').trim(); unit = String(unit || '').trim();
    if (!component || component.length > 60) throw E.bad('Indica il componente (max 60 caratteri).');
    if (!name || name.length > 60) throw E.bad('Indica il nome del parametro (max 60 caratteri).');
    if (!QUANTITIES[quantity]) throw E.bad(`Grandezza non valida. Valori ammessi: ${Object.keys(QUANTITIES).join(', ')}.`, 'grandezza_non_valida');
    const num = Number(value);
    if (!Number.isFinite(num)) throw E.bad('Il valore deve essere un numero.');
    if (!unit || unit.length > 12) throw E.bad('Indica l\'unità di misura.');
    // L'unità viene salvata come scritta dall'autore (se riconosciuta, normalizzata): eventuali incompatibilità le segnala la Scatola Nera.
    const u = normalizeUnit(unit) || unit;
    const id = uuid(); const t = now();
    let version = 1; let oldId = null;
    db.tx(() => {
      if (supersedes) {
        const old = db.get('SELECT * FROM project_parameters WHERE id = ? AND project_id = ?', supersedes, projectId);
        if (!old) throw E.notFound('Parametro da sostituire non trovato.');
        if (old.status !== 'attivo') throw E.conflict('Il parametro è già stato sostituito da un\'altra modifica.', { code: 'gia_sostituito' });
        db.run("UPDATE project_parameters SET status = 'superato', updated_at = ? WHERE id = ?", t, old.id);
        version = old.version + 1; oldId = old.id;
      }
      db.run(`INSERT INTO project_parameters (id, project_id, component, name, quantity, kind, value, unit, linked_to, author_id, author_label, origin, version, supersedes_id, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, projectId, component, name, quantity, QUANTITIES[quantity], num, u, linkedTo ? String(linkedTo).slice(0, 60) : null, user.id, user.displayName, 'manuale', version, oldId, t, t);
    });
    events.publish(projectId, { type: 'parameter.added', entityType: 'parameter', entityId: id, actorId: user.id, data: { supersedes: oldId } });
    access.audit(user.id, projectId, 'parametro.aggiungi', { id });
    if (oldId) {
      const o = db.get('SELECT value, unit FROM project_parameters WHERE id = ?', oldId);
      ctx.journal?.logChange(projectId, user, `Parametro aggiornato: ${component} › ${name}: ${o.value} ${o.unit} → ${num} ${u}`, 'Il valore precedente è marcato come superato e resta consultabile.', id);
    }
    const res = analyze(projectId);
    return { parameter: pubParam(db.get('SELECT * FROM project_parameters WHERE id = ?', id)), alerts: res || null };
  }
  function retireParameter(user, projectId, paramId) {
    access.requireMember(user, projectId);
    const r = db.run("UPDATE project_parameters SET status = 'superato', updated_at = ? WHERE id = ? AND project_id = ? AND status = 'attivo'", now(), paramId, projectId);
    if (!r.changes) throw E.notFound('Parametro attivo non trovato.');
    events.publish(projectId, { type: 'parameter.retired', entityType: 'parameter', entityId: paramId, actorId: user.id });
    analyze(projectId);
  }
  function listParameters(user, projectId, { includeSuperseded = false } = {}) {
    access.requireMember(user, projectId);
    return db.all(`SELECT * FROM project_parameters WHERE project_id = ? ${includeSuperseded ? '' : "AND status = 'attivo'"} ORDER BY component, name, version`, projectId).map(pubParam);
  }

  // ───────── DECISIONI ─────────
  const pubDecision = (d) => ({
    id: d.id, title: d.title, body: d.body, status: d.status, version: d.version,
    proposedBy: { id: d.proposed_by, displayName: d.proposed_label }, confirmedBy: d.confirmed_by ? { id: d.confirmed_by, displayName: access.userLabel(d.confirmed_by) } : null,
    confirmedAt: d.confirmed_at, supersedesId: d.supersedes_id, supersededById: db.get('SELECT id FROM decisions WHERE supersedes_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', d.id, 'superata')?.id || null,
    paramIds: jparse(d.param_refs, []), sourceRef: d.source_ref, createdAt: d.created_at, updatedAt: d.updated_at,
  });
  const getDecision = (projectId, id) => { const d = db.get('SELECT * FROM decisions WHERE id = ? AND project_id = ?', id, projectId); if (!d) throw E.notFound('Decisione non trovata.'); return d; };
  const checkParams = (projectId, ids) => (Array.isArray(ids) ? ids : []).filter((x) => db.get('SELECT 1 x FROM project_parameters WHERE id = ? AND project_id = ?', x, projectId)).slice(0, 20);

  function proposeDecision(user, projectId, { title, body = '', paramIds = [], sourceRef = null, supersedes = null }) {
    access.requireMember(user, projectId);
    title = String(title || '').trim();
    if (title.length < 3 || title.length > 140) throw E.bad('Il titolo della decisione deve avere 3-140 caratteri.');
    if (supersedes) getDecision(projectId, supersedes);
    const id = uuid(); const t = now();
    db.run(`INSERT INTO decisions (id, project_id, title, body, status, version, proposed_by, proposed_label, supersedes_id, source_ref, param_refs, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, projectId, title, String(body).slice(0, 2000), 'proposta', 1, user.id, user.displayName, supersedes, sourceRef, JSON.stringify(checkParams(projectId, paramIds)), t, t);
    events.publish(projectId, { type: 'decision.proposed', entityType: 'decision', entityId: id, actorId: user.id });
    return pubDecision(getDecision(projectId, id));
  }

  function reviseDecision(user, projectId, decisionId, { title, body, paramIds, expectedVersion }) {
    access.requireMember(user, projectId);
    const d = getDecision(projectId, decisionId);
    if (expectedVersion !== undefined && Number(expectedVersion) !== d.version) throw E.conflict('La decisione è stata modificata nel frattempo da qualcun altro.', { currentVersion: d.version });
    if (d.status === 'superata') throw E.conflict('Questa decisione è già stata superata: lavora sulla versione più recente.');
    const newTitle = String(title ?? d.title).trim(); const newBody = String(body ?? d.body ?? '').slice(0, 2000);
    const newParams = paramIds === undefined ? jparse(d.param_refs, []) : checkParams(projectId, paramIds);
    if (newTitle.length < 3 || newTitle.length > 140) throw E.bad('Il titolo della decisione deve avere 3-140 caratteri.');
    if (d.status === 'proposta') { // una proposta si può correggere sul posto
      const r = db.run('UPDATE decisions SET title = ?, body = ?, param_refs = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', newTitle, newBody, JSON.stringify(newParams), now(), d.id, d.version);
      if (!r.changes) throw E.conflict('La decisione è stata modificata nel frattempo.');
      events.publish(projectId, { type: 'decision.updated', entityType: 'decision', entityId: d.id, actorId: user.id });
      return pubDecision(getDecision(projectId, d.id));
    }
    // una decisione CONFERMATA non viene mai modificata sul posto: nasce una proposta che la sostituirà solo se confermata
    const n = proposeDecision(user, projectId, { title: newTitle, body: newBody, paramIds: newParams, supersedes: d.id });
    return { ...n, note: 'La decisione confermata resta valida finché questa proposta non viene confermata.' };
  }

  function confirmDecision(user, projectId, decisionId, { expectedVersion } = {}) {
    access.requireMember(user, projectId);
    const d = getDecision(projectId, decisionId);
    if (expectedVersion !== undefined && Number(expectedVersion) !== d.version) throw E.conflict('La decisione è cambiata: ricontrolla prima di confermare.', { currentVersion: d.version });
    if (d.status !== 'proposta') throw E.conflict(d.status === 'confermata' ? 'Decisione già confermata.' : 'Decisione superata: non si può confermare.');
    db.tx(() => {
      if (d.supersedes_id) {
        const old = db.get('SELECT * FROM decisions WHERE id = ?', d.supersedes_id);
        if (old && old.status !== 'confermata' && old.status !== 'proposta') throw E.conflict('La decisione che questa avrebbe sostituito è già stata sostituita da un\'altra modifica. Confronta le versioni prima di procedere.', { code: 'gia_sostituita' });
        if (old) db.run("UPDATE decisions SET status = 'superata', updated_at = ? WHERE id = ?", now(), old.id);
      }
      const r = db.run("UPDATE decisions SET status = 'confermata', confirmed_by = ?, confirmed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'proposta'", user.id, now(), now(), d.id, d.version);
      if (!r.changes) throw E.conflict('La decisione è stata modificata nel frattempo.');
    });
    events.publish(projectId, { type: 'decision.confirmed', entityType: 'decision', entityId: d.id, actorId: user.id, data: { supersedes: d.supersedes_id } });
    access.audit(user.id, projectId, 'decisione.conferma', { id: d.id });
    if (d.supersedes_id) {
      const old = db.get('SELECT title, version FROM decisions WHERE id = ?', d.supersedes_id);
      ctx.journal?.logChange(projectId, user, `Decisione aggiornata: "${old?.title}" → "${d.title}"`, `La decisione precedente (v${old?.version}) è stata sostituita; resta consultabile nella cronologia.`, d.id);
    }
    analyze(projectId);
    return pubDecision(getDecision(projectId, d.id));
  }
  function withdrawDecision(user, projectId, decisionId) {
    const m = access.requireMember(user, projectId);
    const d = getDecision(projectId, decisionId);
    if (d.status !== 'proposta') throw E.conflict('Si può ritirare solo una proposta non ancora confermata.');
    if (d.proposed_by !== user.id && !['owner', 'teacher'].includes(m.role)) throw E.forbidden('Solo chi l\'ha proposta può ritirarla.');
    db.run("UPDATE decisions SET status = 'superata', updated_at = ? WHERE id = ?", now(), d.id);
    events.publish(projectId, { type: 'decision.withdrawn', entityType: 'decision', entityId: d.id, actorId: user.id });
  }
  function listDecisions(user, projectId, { status } = {}) {
    access.requireMember(user, projectId);
    return db.all(`SELECT * FROM decisions WHERE project_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC`, ...(status ? [projectId, status] : [projectId])).map(pubDecision);
  }
  function decisionHistory(user, projectId, decisionId) {
    access.requireMember(user, projectId);
    let cur = getDecision(projectId, decisionId); const chain = [cur];
    while (cur.supersedes_id) { cur = db.get('SELECT * FROM decisions WHERE id = ?', cur.supersedes_id); if (!cur) break; chain.unshift(cur); }
    let next = db.get('SELECT * FROM decisions WHERE supersedes_id = ? ORDER BY created_at LIMIT 1', decisionId);
    while (next) { chain.push(next); next = db.get('SELECT * FROM decisions WHERE supersedes_id = ? ORDER BY created_at LIMIT 1', next.id); }
    return chain.map(pubDecision);
  }
  // Per le regole (R6/R7): decisioni con gli id dei parametri
  const rulesDecisions = (projectId) => db.all('SELECT * FROM decisions WHERE project_id = ?', projectId).map((d) => ({ ...d, param_ids: jparse(d.param_refs, []), version: d.version }));

  return { addParameter, retireParameter, listParameters, proposeDecision, reviseDecision, confirmDecision, withdrawDecision, listDecisions, decisionHistory, pubDecision, pubParam, rulesDecisions };
}
module.exports = { createData };
