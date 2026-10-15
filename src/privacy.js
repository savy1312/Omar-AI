'use strict';
// PRIVACY: cancellazione dei propri dati, esportazione, conservazione limitata. Misure tecniche: NON equivalgono a una dichiarazione di conformità al GDPR.
const fs = require('node:fs');
const path = require('node:path');
const { E } = require('./lib/errors');
const { now, uuid, jparse } = require('./lib/util');

const REMOVED = '[contributo rimosso su richiesta dell\'autore]';

function createPrivacy(ctx) {
  const { db, cfg, access, events, log } = ctx;
  const uploadsDir = path.join(cfg.dataDir, 'uploads');

  function dropMaterialRows(rows) {
    for (const m of rows) {
      const vers = db.all('SELECT storage_name FROM material_versions WHERE material_id = ?', m.id);
      db.tx(() => {
        db.run('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE material_id = ?)', m.id);
        db.run('DELETE FROM chunks WHERE material_id = ?', m.id);
        db.run('UPDATE materials SET deleted_at = ? WHERE id = ?', now(), m.id);
        db.run('UPDATE material_versions SET source_url = NULL WHERE material_id = ?', m.id);
      });
      for (const v of vers) fs.rmSync(path.join(uploadsDir, v.storage_name), { force: true });
      if (m.visibility === 'gruppo') events.publish(m.project_id, { type: 'material.deleted', entityType: 'material', entityId: m.id });
    }
  }

  // Cosa succede: chat e materiali personali -> eliminati; contributi condivisi -> svuotati e anonimizzati; voci confermate di gruppo -> restano ma senza nome;
  // materiali condivisi caricati dall'utente -> eliminati; account -> disattivato e anonimizzato.
  function deleteMyData(user, { confirm }) {
    if (confirm !== 'ELIMINA') throw E.bad('Per confermare scrivi ELIMINA.', 'conferma_mancante');
    const summary = {};
    for (const m of db.all("SELECT project_id FROM memberships WHERE user_id = ? AND status IN ('active','pending')", user.id)) {
      try { ctx.projects.leave(user, m.project_id, { retractContributions: true }); } catch { db.run("UPDATE memberships SET status = 'left', left_at = ? WHERE project_id = ? AND user_id = ?", now(), m.project_id, user.id); }
    }
    summary.chat = db.run('DELETE FROM chat_sessions WHERE user_id = ?', user.id).changes;
    const own = db.all("SELECT * FROM materials WHERE owner_id = ? AND deleted_at IS NULL AND visibility != 'corso'", user.id);
    dropMaterialRows(own); summary.materiali = own.length;
    db.tx(() => {
      summary.contributi = db.run("UPDATE shared_contributions SET content = ?, status = 'ritirato', retracted_at = COALESCE(retracted_at, ?), author_id = NULL, author_label = NULL WHERE author_id = ?", REMOVED, now(), user.id).changes;
      db.run("UPDATE journal_items SET title = '[voce rimossa su richiesta dell''autore]', body = NULL, redacted = 1, status = 'superata' WHERE author_id = ? AND status != 'confermata'", user.id);
      db.run("UPDATE journal_items SET author_id = NULL, author_label = NULL WHERE author_id = ?", user.id);
      db.run("UPDATE decisions SET proposed_by = NULL, proposed_label = 'ex partecipante' WHERE proposed_by = ?", user.id);
      db.run('UPDATE decisions SET confirmed_by = NULL WHERE confirmed_by = ?', user.id);
      db.run("UPDATE project_parameters SET author_id = NULL, author_label = 'ex partecipante' WHERE author_id = ?", user.id);
      db.run('DELETE FROM share_requests WHERE requester_id = ? OR target_user_id = ?', user.id, user.id);
      db.run('DELETE FROM transfers WHERE from_id = ? OR to_id = ?', user.id, user.id);
      summary.scadenze = db.run('DELETE FROM deadlines WHERE owner_id = ? AND scope != \'corso\'', user.id).changes;
      db.run('DELETE FROM deadline_progress WHERE user_id = ?', user.id);
      db.run('DELETE FROM user_prefs WHERE user_id = ?', user.id);
      db.run('DELETE FROM bulletin_reads WHERE user_id = ?', user.id);
      db.run("UPDATE project_tasks SET created_by = NULL, created_label = 'ex partecipante' WHERE created_by = ?", user.id);
      db.run('UPDATE project_tasks SET assignee_id = NULL WHERE assignee_id = ?', user.id);
      db.run("UPDATE project_snippets SET content = '', deleted_at = COALESCE(deleted_at, ?) WHERE author_id = ?", now(), user.id);
      db.run('DELETE FROM guided_checks WHERE user_id = ?', user.id);
      db.run('DELETE FROM ai_usage WHERE user_id = ?', user.id);
      db.run('UPDATE audit_log SET user_id = NULL WHERE user_id = ?', user.id);
      db.run('DELETE FROM auth_sessions WHERE user_id = ?', user.id);
      db.run("UPDATE users SET deleted_at = ?, username = ?, display_name = 'ex partecipante', password_hash = ? WHERE id = ?", now(), `eliminato-${user.id.slice(0, 8)}`, 'x$' + uuid(), user.id);
    });
    return { deleted: true, summary, note: 'Chat e materiali personali eliminati; i tuoi contributi condivisi sono stati svuotati; le voci confermate dal gruppo restano ma senza il tuo nome. Copie già scaricate da altri partecipanti non possono essere recuperate.' };
  }
  function deleteMyChats(user) { return { deleted: db.run('DELETE FROM chat_sessions WHERE user_id = ?', user.id).changes }; }

  function exportMyData(user) {
    const sessions = db.all('SELECT * FROM chat_sessions WHERE user_id = ?', user.id).map((s) => ({ id: s.id, subjectId: s.subject_id, mode: s.mode, createdAt: s.created_at, messages: db.all('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at', s.id) }));
    return {
      exportedAt: now(), user: { username: user.username, displayName: user.displayName, role: user.role }, sessions,
      materialiPersonali: ctx.materials.list(user, { scope: 'personale' }).map((m) => ({ name: m.name, version: m.version, status: m.status, cartella: m.folder || null, ...(m.sourceUrl ? { sourceUrl: m.sourceUrl } : {}) })),
      contributiCondivisi: db.all("SELECT project_id, kind, content, created_at, status FROM shared_contributions WHERE author_id = ?", user.id),
      trasferimenti: ctx.transfers.exportFor(user).map(({ direction, from, to, items, status, createdAt }) => ({ direction, da: from.displayName, a: to.displayName, file: items.map((i) => i.name), status, createdAt })),
      planner: ctx.planner.exportFor(user),
      assetCondivisi: db.all('SELECT project_id, kind, title, content, created_at FROM project_snippets WHERE author_id = ? AND deleted_at IS NULL', user.id),
      note: 'Esportazione dei dati personali presenti nel sistema. I testi dei materiali caricati non sono inclusi: scaricali dalla sezione Materiali.',
    };
  }

  // Conservazione limitata: eseguita all'avvio e periodicamente
  function purgeExpired() {
    const cutoff = (days) => new Date(Date.now() - days * 86400e3).toISOString();
    const r = {};
    r.chat = db.run('DELETE FROM chat_sessions WHERE updated_at < ?', cutoff(cfg.retention.chatDays)).changes;
    r.authSessions = db.run('DELETE FROM auth_sessions WHERE expires_at < ? OR last_seen < ?', now(), cutoff(cfg.retention.authSessionDays)).changes;
    r.audit = db.run('DELETE FROM audit_log WHERE created_at < ?', cutoff(cfg.retention.auditDays)).changes;
    r.events = db.run('DELETE FROM sync_events WHERE created_at < ?', cutoff(cfg.retention.eventsDays)).changes;
    r.transfers = ctx.transfers?.purgeOld(90).changes || 0;
    r.aiUsage = db.run('DELETE FROM ai_usage WHERE day < ?', cutoff(7).slice(0, 10)).changes;
    ctx.limiters?.forEach((l) => l.sweep());
    log.info('retention', r);
    return r;
  }
  return { deleteMyData, deleteMyChats, exportMyData, purgeExpired };
}
module.exports = { createPrivacy };
