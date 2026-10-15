'use strict';
// CONTRIBUTI CONDIVISI: l'unico canale con cui il contenuto di una chat personale diventa visibile al gruppo.
// Il collegamento dei dispositivi NON autorizza la lettura delle chat: si condivide solo ciò che l'autore sceglie (o autorizza esplicitamente in automatico).
const { E } = require('../lib/errors');
const { now, uuid, scrubPII } = require('../lib/util');
const { norm } = require('../blackbox/rules');

const RETRACTED = '[contributo ritirato dall\'autore]';
const MAX_LEN = 2000;

function createContributions(ctx) {
  const { db, access, events, log } = ctx;

  const pub = (c, viewerId) => ({
    id: c.id, projectId: c.project_id, kind: c.kind, content: c.content, workstream: c.workstream, version: c.version, status: c.status, auto: !!c.auto,
    author: { id: c.author_id, displayName: c.author_label || 'ex partecipante' }, createdAt: c.created_at, retractedAt: c.retracted_at, mine: c.author_id === viewerId,
  });

  function share(user, projectId, { sessionId, messageId, kind = 'messaggio', content }) {
    const m = access.requireMember(user, projectId);
    if (!['messaggio', 'sintesi'].includes(kind)) throw E.bad('Tipo di contributo non valido.');
    const sess = db.get('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?', sessionId, user.id);
    if (!sess) throw E.notFound('Sessione non trovata.');
    let text; let msg = null;
    if (kind === 'messaggio') {
      msg = db.get('SELECT * FROM messages WHERE id = ? AND session_id = ?', messageId, sessionId);
      if (!msg) throw E.notFound('Messaggio non trovato.');
      if (msg.share_excluded) throw E.bad('Hai escluso questo messaggio dalla condivisione.', 'escluso_dalla_condivisione');
      const dup = db.get("SELECT * FROM shared_contributions WHERE source_message_id = ? AND project_id = ? AND status = 'attivo'", messageId, projectId);
      if (dup) return pub(dup, user.id);
      text = msg.content;
    } else {
      text = String(content || '').trim();
      if (text.length < 10) throw E.bad('La sintesi è troppo breve: scrivila con parole tue (almeno 10 caratteri).');
    }
    text = scrubPII(text).slice(0, MAX_LEN);
    const id = uuid(); const t = now();
    db.run(`INSERT INTO shared_contributions (id, project_id, author_id, author_label, source_session_id, source_message_id, kind, content, workstream, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`, id, projectId, user.id, user.displayName, sessionId, msg?.id || null, kind, text, m.workstream, t);
    events.publish(projectId, { type: 'contribution.shared', entityType: 'contribution', entityId: id, actorId: user.id });
    access.audit(user.id, projectId, 'contributo.condividi', { id, kind });
    const c = db.get('SELECT * FROM shared_contributions WHERE id = ?', id);
    ctx.journal?.onContribution(c);
    return pub(c, user.id);
  }

  function list(user, projectId, { mine = false, includeRetracted = false } = {}) {
    access.requireMember(user, projectId);
    const rows = db.all(`SELECT * FROM shared_contributions WHERE project_id = ? ${mine ? 'AND author_id = ?' : ''} ${includeRetracted ? '' : "AND status = 'attivo'"} ORDER BY created_at DESC LIMIT 200`, ...(mine ? [projectId, user.id] : [projectId]));
    return rows.map((c) => pub(c, user.id));
  }

  function update(user, projectId, id, { content, expectedVersion }) {
    access.requireMember(user, projectId);
    const c = db.get("SELECT * FROM shared_contributions WHERE id = ? AND project_id = ? AND status = 'attivo'", id, projectId);
    if (!c || c.author_id !== user.id) throw E.notFound('Contributo non trovato.');
    if (expectedVersion !== undefined && Number(expectedVersion) !== c.version) throw E.conflict('Il contributo è stato modificato nel frattempo.', { currentVersion: c.version });
    const text = scrubPII(String(content || '').trim()).slice(0, MAX_LEN);
    if (text.length < 10) throw E.bad('Testo troppo breve.');
    db.run('UPDATE shared_contributions SET content = ?, version = version + 1 WHERE id = ?', text, id);
    events.publish(projectId, { type: 'contribution.updated', entityType: 'contribution', entityId: id, actorId: user.id });
    return pub(db.get('SELECT * FROM shared_contributions WHERE id = ?', id), user.id);
  }

  function retractRow(c) {
    db.run("UPDATE shared_contributions SET status = 'ritirato', content = ?, retracted_at = ? WHERE id = ?", RETRACTED, now(), c.id);
    ctx.journal?.onContributionRetracted(c.id);
    events.publish(c.project_id, { type: 'contribution.retracted', entityType: 'contribution', entityId: c.id, actorId: c.author_id });
  }
  function retract(user, projectId, id) {
    access.requireMember(user, projectId);
    const c = db.get("SELECT * FROM shared_contributions WHERE id = ? AND project_id = ? AND author_id = ? AND status = 'attivo'", id, projectId, user.id);
    if (!c) throw E.notFound('Contributo non trovato.');
    retractRow(c);
  }
  function retractAllBy(user, projectId) {
    for (const c of db.all("SELECT * FROM shared_contributions WHERE project_id = ? AND author_id = ? AND status = 'attivo'", projectId, user.id)) retractRow(c);
  }

  // Condivisione automatica: consenso ESPLICITO (consent === true) e revocabile in ogni momento
  function setAutoShare(user, projectId, { enabled, consent }) {
    access.requireMember(user, projectId);
    if (enabled && consent !== true) throw E.bad('Per attivare la condivisione automatica serve il tuo consenso esplicito.', 'consenso_mancante');
    db.run('UPDATE memberships SET auto_share = ?, auto_share_consent_at = ? WHERE project_id = ? AND user_id = ?', enabled ? 1 : 0, enabled ? now() : null, projectId, user.id);
    access.audit(user.id, projectId, enabled ? 'autoshare.attiva' : 'autoshare.revoca');
    return { autoShare: !!enabled, note: enabled ? 'Verranno condivisi automaticamente SOLO i tuoi messaggi che contengono dati o componenti del progetto (senza email e numeri di telefono). Puoi escludere un messaggio o ritirare un contributo quando vuoi.' : 'Condivisione automatica disattivata: i contributi già condivisi restano visibili finché non li ritiri.' };
  }

  const DATA_RX = /\d+([.,]\d+)?\s*(mm|cm|kn|n·m|n\*m|nm|n|kw|w|v|a|bar|mpa|rpm|kg|°)(?![a-zà-ù])/i;
  function isProjectRelevant(projectId, text) {
    if (DATA_RX.test(text)) return true;
    const t = ` ${norm(text)} `;
    const names = db.all("SELECT DISTINCT component FROM project_parameters WHERE project_id = ? AND status = 'attivo'", projectId).map((r) => norm(r.component));
    if (names.some((n) => n.length >= 4 && t.includes(` ${n}`))) return true;
    const proj = db.get('SELECT name FROM projects WHERE id = ?', projectId);
    return norm(proj?.name).split(' ').some((w) => w.length >= 5 && t.includes(` ${w}`));
  }
  function onTurnCompleted({ user, session, projectId, userMessageId, userText, signals }) {
    const m = access.membership(user.id, projectId);
    if (!m?.auto_share || session.sandbox) return null;
    const msg = db.get('SELECT * FROM messages WHERE id = ?', userMessageId);
    if (!msg || msg.share_excluded) return null;
    if (signals?.injection || !isProjectRelevant(projectId, userText)) return null;
    const text = scrubPII(userText).slice(0, MAX_LEN);
    const id = uuid();
    db.run(`INSERT INTO shared_contributions (id, project_id, author_id, author_label, source_session_id, source_message_id, kind, content, workstream, auto, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, projectId, user.id, user.displayName, session.id, userMessageId, 'messaggio', text, m.workstream, 1, now());
    events.publish(projectId, { type: 'contribution.shared', entityType: 'contribution', entityId: id, actorId: user.id, data: { auto: true } });
    const c = db.get('SELECT * FROM shared_contributions WHERE id = ?', id);
    ctx.journal?.onContribution(c);
    return pub(c, user.id);
  }

  // Richieste di condivisione ("chiedi al compagno di condividere")
  function requestShare(user, projectId, { targetUserId, note = '' }) {
    access.requireMember(user, projectId);
    if (targetUserId === user.id) throw E.bad('Non puoi chiedere a te stesso.');
    if (!access.membership(targetUserId, projectId)) throw E.notFound('Partecipante non trovato nel progetto.');
    const open = db.get("SELECT id FROM share_requests WHERE project_id = ? AND requester_id = ? AND target_user_id = ? AND status = 'pending'", projectId, user.id, targetUserId);
    if (open) return { id: open.id, status: 'pending', duplicate: true };
    const id = uuid();
    db.run('INSERT INTO share_requests (id, project_id, requester_id, target_user_id, note, created_at) VALUES (?,?,?,?,?,?)', id, projectId, user.id, targetUserId, String(note).slice(0, 300), now());
    events.publish(projectId, { type: 'share.requested', entityType: 'user', entityId: targetUserId, actorId: user.id });
    return { id, status: 'pending' };
  }
  function listRequests(user, projectId) {
    access.requireMember(user, projectId);
    return db.all(`SELECT r.*, u.display_name requester_name FROM share_requests r JOIN users u ON u.id = r.requester_id
                   WHERE r.project_id = ? AND r.target_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`, projectId, user.id)
      .map((r) => ({ id: r.id, from: { id: r.requester_id, displayName: r.requester_name }, note: r.note, createdAt: r.created_at }));
  }
  function respondRequest(user, projectId, id, accept) {
    access.requireMember(user, projectId);
    const r = db.run("UPDATE share_requests SET status = ?, responded_at = ? WHERE id = ? AND project_id = ? AND target_user_id = ? AND status = 'pending'", accept ? 'accepted' : 'declined', now(), id, projectId, user.id);
    if (!r.changes) throw E.notFound('Richiesta non trovata.');
    return { status: accept ? 'accepted' : 'declined', note: accept ? 'Ora puoi condividere un messaggio o una sintesi dalla tua chat: nulla viene condiviso in automatico.' : 'Richiesta rifiutata.' };
  }

  return { share, list, update, retract, retractAllBy, setAutoShare, onTurnCompleted, requestShare, listRequests, respondRequest, pub, isProjectRelevant };
}
module.exports = { createContributions, RETRACTED };
