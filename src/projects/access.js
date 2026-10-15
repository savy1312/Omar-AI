'use strict';
// Controllo accessi centralizzato. OGNI route che tocca dati di progetto passa da qui (mai fidarsi di id nella richiesta).
const { E } = require('../lib/errors');

function createAccess({ db }) {
  const membership = (userId, projectId) =>
    db.get(`SELECT m.* FROM memberships m JOIN projects p ON p.id = m.project_id
            WHERE m.user_id = ? AND m.project_id = ? AND m.status = 'active' AND p.closed_at IS NULL`, userId, projectId);

  // I non membri ricevono 404 (non si rivela nemmeno l'esistenza del progetto).
  function requireMember(user, projectId) {
    const m = projectId ? membership(user.id, projectId) : null;
    if (!m) throw E.notFound('Progetto non trovato o accesso non consentito.');
    return m;
  }
  function requireManager(user, projectId) { // creatore o docente del progetto
    const m = requireMember(user, projectId);
    if (m.role === 'owner' || m.role === 'teacher') return m;
    throw E.forbidden('Solo il creatore o il docente del progetto possono farlo.');
  }
  const project = (projectId) => db.get('SELECT * FROM projects WHERE id = ?', projectId);
  const activeMembers = (projectId) => db.all(
    `SELECT m.*, u.display_name, u.username FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = ? AND m.status = 'active' ORDER BY m.joined_at`, projectId);
  const userLabel = (id) => db.get('SELECT display_name FROM users WHERE id = ?', id)?.display_name || 'ex partecipante';
  const myProjects = (userId) => db.all(
    `SELECT p.*, m.role my_role FROM memberships m JOIN projects p ON p.id = m.project_id
     WHERE m.user_id = ? AND m.status = 'active' AND p.closed_at IS NULL ORDER BY p.created_at DESC`, userId);

  // Può vedere il materiale? (visibilità esplicita: personale | gruppo | corso)
  function canViewMaterial(user, mat) {
    if (!mat || mat.deleted_at) return false;
    if (mat.visibility === 'personale') return mat.owner_id === user.id;
    if (mat.visibility === 'gruppo') return !!membership(user.id, mat.project_id);
    if (mat.visibility === 'corso') return true;
    return false;
  }
  const audit = (userId, projectId, action, meta) =>
    db.run('INSERT INTO audit_log (user_id, project_id, action, meta_json, created_at) VALUES (?,?,?,?,?)',
      userId, projectId, action, meta ? JSON.stringify(meta) : null, new Date().toISOString());
  return { membership, requireMember, requireManager, project, activeMembers, userLabel, myProjects, canViewMaterial, audit };
}
module.exports = { createAccess };
