'use strict';
const crypto = require('node:crypto');
const { E } = require('../lib/errors');
const { now, uuid, hmac } = require('../lib/util');
const { RateLimiter } = require('../lib/ratelimit');

// Alfabeto senza caratteri ambigui (0/O, 1/I/L): 8 simboli su 31 ≈ 39,6 bit di entropia.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

function createProjects(ctx) {
  const { db, cfg, access, events } = ctx;
  const failsUser = new RateLimiter(cfg.limits.inviteFailsPerUser, 10 * 60_000);
  const failsIp = new RateLimiter(cfg.limits.inviteFailsPerIp, 10 * 60_000);
  const codeHash = (code) => hmac(cfg.secret, `invite:${normalizeCode(code)}`);
  // Il codice è salvato anche CIFRATO (AES-256-GCM con una chiave derivata dal segreto del server): così chi gestisce il
  // gruppo può rivedere e ricopiare i codici ancora attivi. Per riconoscere un codice si usa sempre l'hash.
  const encKey = crypto.createHash('sha256').update(`invite-enc:${cfg.secret}`).digest();
  const seal = (code) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', encKey, iv); const out = Buffer.concat([c.update(code, 'utf8'), c.final()]); return [iv, c.getAuthTag(), out].map((b) => b.toString('base64url')).join('.'); };
  const unseal = (s) => { try { const [iv, tag, out] = String(s).split('.').map((x) => Buffer.from(x, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv); d.setAuthTag(tag); return Buffer.concat([d.update(out), d.final()]).toString('utf8'); } catch { return null; } };
  const notifyUser = (userId, data) => { try { ctx.hub?.notify([userId], { type: 'membership.updated', ...data }); } catch { /* utente non collegato */ } };

  const pubProject = (p, m) => ({ id: p.id, name: p.name, subjectId: p.subject_id, requiresApproval: !!p.requires_approval, isDemo: !!p.is_demo, createdAt: p.created_at, ...(m ? { myRole: m.role, myWorkstream: m.workstream, autoShare: !!m.auto_share } : {}) });
  const pubMember = (m, online) => ({ userId: m.user_id, displayName: m.display_name, role: m.role, status: m.status, workstream: m.workstream, joinedAt: m.joined_at, online: !!online });

  function create(user, { name, subjectId = null, requiresApproval = true, workstream = null, isDemo = false }) {
    name = String(name || '').trim();
    if (name.length < 3 || name.length > 80) throw E.bad('Il nome del progetto deve avere 3-80 caratteri.');
    if (subjectId && !ctx.subjects.get(subjectId)) throw E.bad('Materia non valida.');
    const id = uuid(); const t = now();
    const role = user.role === 'student' ? 'owner' : 'owner'; // chi crea è sempre creatore (anche un docente)
    db.tx(() => {
      db.run('INSERT INTO projects (id, name, subject_id, owner_id, requires_approval, is_demo, created_at) VALUES (?,?,?,?,?,?,?)', id, name, subjectId, user.id, requiresApproval ? 1 : 0, isDemo ? 1 : 0, t);
      db.run('INSERT INTO memberships (id, project_id, user_id, role, status, workstream, joined_at, created_at) VALUES (?,?,?,?,?,?,?,?)', uuid(), id, user.id, role, 'active', workstream && String(workstream).slice(0, 60), t, t);
    });
    access.audit(user.id, id, 'progetto.crea');
    return pubProject(access.project(id), access.membership(user.id, id));
  }

  function updateSettings(user, projectId, { requiresApproval, name }) {
    access.requireManager(user, projectId);
    const p = access.project(projectId);
    db.run('UPDATE projects SET requires_approval = ?, name = ? WHERE id = ?', requiresApproval === undefined ? p.requires_approval : (requiresApproval ? 1 : 0), name ? String(name).slice(0, 80) : p.name, projectId);
    return pubProject(access.project(projectId), access.membership(user.id, projectId));
  }

  function createInvite(user, projectId, { ttlMin, maxUses } = {}) {
    access.requireManager(user, projectId);
    const ttl = Math.min(Math.max(parseInt(ttlMin, 10) || cfg.limits.inviteTtlMinDefault, 1), cfg.limits.inviteTtlMinMax);
    const uses = Math.min(Math.max(parseInt(maxUses, 10) || cfg.limits.inviteMaxUses, 1), 100);
    let code; let tries = 0;
    do { code = newCode(); } while (db.get('SELECT 1 x FROM invites WHERE code_hash = ?', codeHash(code)) && ++tries < 5);
    const id = uuid(); const expires = new Date(Date.now() + ttl * 60_000).toISOString();
    db.run('INSERT INTO invites (id, project_id, code_hash, code_enc, created_by, created_at, expires_at, max_uses) VALUES (?,?,?,?,?,?,?,?)', id, projectId, codeHash(code), seal(code), user.id, now(), expires, uses);
    access.audit(user.id, projectId, 'invito.crea', { inviteId: id });
    return { id, code, expiresAt: expires, maxUses: uses, note: 'Lo ritrovi tra i «Codici attivi» finché è valido. Funziona per chi usa Omar su questo stesso server.' };
  }
  const listInvites = (user, projectId) => {
    access.requireManager(user, projectId);
    return db.all('SELECT id, code_enc, created_at, expires_at, revoked_at, max_uses, uses FROM invites WHERE project_id = ? ORDER BY created_at DESC LIMIT 20', projectId)
      .map((i) => { const active = !i.revoked_at && new Date(i.expires_at) > new Date() && i.uses < i.max_uses; return { id: i.id, code: active && i.code_enc ? unseal(i.code_enc) : null, createdAt: i.created_at, expiresAt: i.expires_at, revoked: !!i.revoked_at, maxUses: i.max_uses, uses: i.uses, active }; });
  };
  function revokeInvite(user, projectId, inviteId) {
    access.requireManager(user, projectId);
    const r = db.run('UPDATE invites SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL', now(), inviteId, projectId);
    if (!r.changes) throw E.notFound('Invito non trovato.');
    access.audit(user.id, projectId, 'invito.revoca', { inviteId });
  }
  function regenerateInvite(user, projectId, opts) {
    access.requireManager(user, projectId);
    db.run('UPDATE invites SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL', now(), projectId);
    return createInvite(user, projectId, opts);
  }

  function redeem(user, code, { ip = 'ip', workstream = null } = {}) {
    const uKey = `u:${user.id}`; const iKey = `i:${ip}`;
    if (!failsUser.check(uKey) || !failsIp.check(iKey)) {
      throw E.rate('Troppi tentativi con codici errati. Riprova tra qualche minuto.', { retryAfterSec: Math.max(failsUser.retryAfterSec(uKey), failsIp.retryAfterSec(iKey)) });
    }
    const inv = db.get('SELECT * FROM invites WHERE code_hash = ?', codeHash(code));
    const proj = inv && access.project(inv.project_id);
    const valid = inv && proj && !proj.closed_at && !inv.revoked_at && new Date(inv.expires_at) > new Date() && inv.uses < inv.max_uses;
    if (!valid) { failsUser.hit(uKey); failsIp.hit(iKey); throw E.bad('Codice non valido, scaduto o revocato.', 'invito_non_valido'); }

    const existing = db.get('SELECT * FROM memberships WHERE project_id = ? AND user_id = ?', proj.id, user.id);
    if (existing?.status === 'active') throw E.conflict('Fai già parte di questo progetto.');
    if (existing?.status === 'pending') throw E.conflict('La tua richiesta è già in attesa di approvazione.');
    const isStaff = user.role !== 'student';
    const needsApproval = !isStaff && (!!proj.requires_approval || existing?.status === 'revoked'); // chi è stato revocato deve sempre essere riapprovato
    const status = needsApproval ? 'pending' : 'active'; const t = now();
    const ws = workstream ? String(workstream).slice(0, 60) : existing?.workstream || null;
    db.tx(() => {
      db.run('UPDATE invites SET uses = uses + 1 WHERE id = ?', inv.id);
      if (existing) db.run('UPDATE memberships SET status = ?, role = ?, workstream = ?, joined_at = ?, left_at = NULL, auto_share = 0, auto_share_consent_at = NULL WHERE id = ?', status, isStaff ? 'teacher' : 'member', ws, status === 'active' ? t : null, existing.id);
      else db.run('INSERT INTO memberships (id, project_id, user_id, role, status, workstream, joined_at, created_at) VALUES (?,?,?,?,?,?,?,?)', uuid(), proj.id, user.id, isStaff ? 'teacher' : 'member', status, ws, status === 'active' ? t : null, t);
    });
    events.publish(proj.id, { type: status === 'active' ? 'member.joined' : 'member.pending', entityType: 'user', entityId: user.id, actorId: user.id, data: { displayName: user.displayName } });
    access.audit(user.id, proj.id, 'invito.usa', { status });
    return { status, project: status === 'active' ? pubProject(proj, access.membership(user.id, proj.id)) : { id: proj.id, name: proj.name }, message: status === 'active' ? 'Sei entrato nel progetto.' : 'Richiesta inviata: attendi l\'approvazione del creatore o del docente.' };
  }

  function decide(user, projectId, targetUserId, approve) {
    access.requireManager(user, projectId);
    const m = db.get("SELECT * FROM memberships WHERE project_id = ? AND user_id = ? AND status = 'pending'", projectId, targetUserId);
    if (!m) throw E.notFound('Richiesta non trovata.');
    db.run('UPDATE memberships SET status = ?, joined_at = ? WHERE id = ?', approve ? 'active' : 'rejected', approve ? now() : null, m.id);
    events.publish(projectId, { type: approve ? 'member.joined' : 'member.rejected', entityType: 'user', entityId: targetUserId, actorId: user.id, data: { displayName: access.userLabel(targetUserId) } });
    // chi aspettava l'approvazione non è ancora iscritto agli eventi del gruppo: gli arriva un avviso personale
    notifyUser(targetUserId, { projectId, projectName: access.project(projectId)?.name, status: approve ? 'active' : 'rejected' });
    access.audit(user.id, projectId, approve ? 'membro.approva' : 'membro.rifiuta', { targetUserId });
  }

  function stopMembership(projectId, userId, status, actorId) {
    db.tx(() => {
      db.run('UPDATE memberships SET status = ?, left_at = ?, auto_share = 0, auto_share_consent_at = NULL WHERE project_id = ? AND user_id = ?', status, now(), projectId, userId);
      db.run("UPDATE share_requests SET status = 'declined', responded_at = ? WHERE project_id = ? AND (requester_id = ? OR target_user_id = ?) AND status = 'pending'", now(), projectId, userId, userId);
    });
    events.publish(projectId, { type: status === 'revoked' ? 'member.revoked' : 'member.left', entityType: 'user', entityId: userId, actorId, data: { displayName: access.userLabel(userId) } });
    ctx.onMembershipEnded?.(projectId, userId);
  }
  function revokeMember(user, projectId, targetUserId) {
    access.requireManager(user, projectId);
    const m = db.get("SELECT * FROM memberships WHERE project_id = ? AND user_id = ? AND status = 'active'", projectId, targetUserId);
    if (!m) throw E.notFound('Partecipante non trovato.');
    if (m.role === 'owner') throw E.forbidden('Il creatore del progetto non può essere revocato.');
    stopMembership(projectId, targetUserId, 'revoked', user.id);
    access.audit(user.id, projectId, 'membro.revoca', { targetUserId });
  }
  function leave(user, projectId, { retractContributions = false } = {}) {
    const m = access.requireMember(user, projectId);
    if (retractContributions) ctx.collab?.retractAllBy(user, projectId);
    if (m.role === 'owner') { // trasferisce la proprietà al partecipante attivo più anziano, altrimenti chiude il progetto
      const next = db.get("SELECT * FROM memberships WHERE project_id = ? AND user_id != ? AND status = 'active' ORDER BY (role = 'teacher') DESC, joined_at LIMIT 1", projectId, user.id);
      if (next) { db.run("UPDATE memberships SET role = 'owner' WHERE id = ?", next.id); db.run('UPDATE projects SET owner_id = ? WHERE id = ?', next.user_id, projectId); }
      else db.run('UPDATE projects SET closed_at = ? WHERE id = ?', now(), projectId);
    }
    stopMembership(projectId, user.id, 'left', user.id);
    access.audit(user.id, projectId, 'membro.esce', { retractContributions });
  }

  function setMyProfile(user, projectId, { workstream }) {
    access.requireMember(user, projectId);
    db.run('UPDATE memberships SET workstream = ? WHERE project_id = ? AND user_id = ?', workstream ? String(workstream).slice(0, 60) : null, projectId, user.id);
    events.publish(projectId, { type: 'member.updated', entityType: 'user', entityId: user.id, actorId: user.id });
  }

  const overview = (user, projectId, online = new Set()) => {
    const m = access.requireMember(user, projectId); const p = access.project(projectId);
    const members = access.activeMembers(projectId).map((x) => pubMember(x, online.has(x.user_id)));
    const pending = ['owner', 'teacher'].includes(m.role) ? db.all("SELECT m.*, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? AND m.status = 'pending'", projectId).map((x) => pubMember(x, false)) : [];
    return { project: pubProject(p, m), members, pending, participantCount: members.length, onlineCount: members.filter((x) => x.online).length, lastSeq: events.lastSeq(projectId) };
  };
  const mine = (user) => access.myProjects(user.id).map((p) => pubProject(p, { role: p.my_role }));
  // richieste di ingresso ancora in attesa di approvazione (mostrate nel pannello «Gruppo» di chi le ha fatte)
  const pendingMine = (user) => db.all(`SELECT p.id, p.name, m.created_at FROM memberships m JOIN projects p ON p.id = m.project_id
    WHERE m.user_id = ? AND m.status = 'pending' AND p.closed_at IS NULL ORDER BY m.created_at DESC`, user.id).map((r) => ({ id: r.id, name: r.name, requestedAt: r.created_at }));

  return { create, updateSettings, createInvite, listInvites, revokeInvite, regenerateInvite, redeem, decide, revokeMember, leave, setMyProfile, overview, mine, pendingMine, newCode, normalizeCode };
}
module.exports = { createProjects, newCode, normalizeCode };
