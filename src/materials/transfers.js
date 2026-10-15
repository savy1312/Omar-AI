'use strict';
// TRASFERIMENTI TRA DISPOSITIVI COLLEGATI: uno studente invia file personali (o un'intera cartella) a un compagno
// con cui è collegato in un gruppo. È un'OFFERTA: il destinatario vede nome e dimensione e decide; solo se accetta
// riceve una COPIA tra i suoi materiali personali. Il mittente non perde nulla e non vede i file del destinatario.
// Regole: solo i propri materiali personali, solo verso un partecipante ATTIVO dello stesso gruppo (ricontrollato
// anche all'accettazione), scadenza 7 giorni, limiti su numero di elementi e offerte in sospeso.
const { E } = require('../lib/errors');
const { now, uuid, jparse } = require('../lib/util');

const TTL_MS = 7 * 24 * 3600e3;
const MAX_ITEMS = 25;
const MAX_PENDING_PAIR = 5;
const MAX_PENDING_USER = 20;
const STATUS_LABEL = { pending: 'In attesa', accepted: 'Accettato', declined: 'Rifiutato', cancelled: 'Annullato', expired: 'Scaduto' };

function createTransfers(ctx) {
  const { db, access, materials, log } = ctx;
  const notify = (ids, data) => { try { ctx.hub?.notify(ids, { type: 'transfer.updated', ...data }); } catch { /* nessun client collegato */ } };

  const pub = (r, viewer) => {
    const items = jparse(r.items_json, []);
    return {
      id: r.id, projectId: r.project_id, projectName: access.project(r.project_id)?.name || null,
      from: { id: r.from_id, displayName: access.userLabel(r.from_id) }, to: { id: r.to_id, displayName: access.userLabel(r.to_id) },
      direction: r.from_id === viewer.id ? 'out' : 'in', items, count: items.length, totalSize: items.reduce((n, i) => n + (i.size || 0), 0),
      folder: r.folder, note: r.note, status: r.status, statusLabel: STATUS_LABEL[r.status], createdAt: r.created_at, expiresAt: r.expires_at, respondedAt: r.responded_at,
      result: jparse(r.result_json, null),
    };
  };
  // scadenze: le offerte vecchie diventano "scadute" (senza toccare i file)
  const expire = () => db.run("UPDATE transfers SET status = 'expired', responded_at = ? WHERE status = 'pending' AND expires_at < ?", now(), now());

  function create(user, projectId, { toUserId, materialIds = [], folder = null, note = '' } = {}) {
    access.requireMember(user, projectId);
    if (!toUserId || toUserId === user.id) throw E.bad('Scegli un compagno a cui inviare.', 'destinatario_non_valido');
    if (!access.membership(toUserId, projectId)) throw E.bad('Il destinatario non è (più) collegato a questo gruppo.', 'destinatario_non_collegato');
    note = String(note || '').replace(/\s+/g, ' ').trim();
    if (note.length > 200) throw E.bad('La nota può avere al massimo 200 caratteri.');
    let rows;
    const f = materials.normFolder(folder);
    if (f) {
      rows = db.all("SELECT m.*, v.size, v.filename FROM materials m JOIN material_versions v ON v.material_id = m.id AND v.version = m.current_version WHERE m.owner_id = ? AND m.visibility = 'personale' AND m.deleted_at IS NULL AND lower(m.folder) = lower(?) ORDER BY m.name", user.id, f);
      if (!rows.length) throw E.bad('La cartella è vuota o non esiste.', 'cartella_vuota');
    } else {
      const ids = [...new Set((Array.isArray(materialIds) ? materialIds : []).map(String))];
      if (!ids.length) throw E.bad('Scegli almeno un file da inviare.', 'nessun_file');
      if (ids.length > MAX_ITEMS) throw E.bad(`Puoi inviare al massimo ${MAX_ITEMS} file alla volta.`, 'troppi_file');
      rows = ids.map((id) => db.get("SELECT m.*, v.size, v.filename FROM materials m JOIN material_versions v ON v.material_id = m.id AND v.version = m.current_version WHERE m.id = ? AND m.deleted_at IS NULL", id));
      // solo i PROPRI materiali personali: per gli altri si risponde "non trovato" (non si rivela nulla)
      if (rows.some((m) => !m || m.owner_id !== user.id || m.visibility !== 'personale')) throw E.notFound('Uno dei file non è tra i tuoi materiali personali.');
    }
    if (rows.length > MAX_ITEMS) throw E.bad(`La cartella contiene più di ${MAX_ITEMS} file: inviane una parte.`, 'troppi_file');
    expire();
    const pair = db.get("SELECT COUNT(*) n FROM transfers WHERE from_id = ? AND to_id = ? AND status = 'pending'", user.id, toUserId).n;
    if (pair >= MAX_PENDING_PAIR) throw E.rate(`Hai già ${MAX_PENDING_PAIR} invii in attesa per questo compagno: aspetta che risponda.`);
    const mine = db.get("SELECT COUNT(*) n FROM transfers WHERE from_id = ? AND status = 'pending'", user.id).n;
    if (mine >= MAX_PENDING_USER) throw E.rate('Hai troppi invii in attesa di risposta.');
    const items = rows.map((m) => ({ materialId: m.id, name: m.name, filename: m.filename, size: m.size, folder: m.folder || null }));
    const id = uuid(); const t = Date.now();
    db.run('INSERT INTO transfers (id, project_id, from_id, to_id, items_json, folder, note, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, projectId, user.id, toUserId, JSON.stringify(items), f ? rows[0].folder : null, note || null, 'pending', new Date(t).toISOString(), new Date(t + TTL_MS).toISOString());
    access.audit(user.id, projectId, 'trasferimento.offerta', { id, n: items.length }); // nessun nome di file nel registro
    notify([user.id, toUserId], { id, status: 'pending' });
    return pub(db.get('SELECT * FROM transfers WHERE id = ?', id), user);
  }

  function list(user) {
    expire();
    const rows = db.all('SELECT * FROM transfers WHERE (from_id = ? OR to_id = ?) ORDER BY created_at DESC LIMIT 100', user.id, user.id);
    // le offerte in arrivo valgono solo finché il mittente è ancora collegato con me nel gruppo
    return rows.map((r) => pub(r, user)).map((x) => (x.status === 'pending' && x.direction === 'in' && !(access.membership(user.id, x.projectId) && access.membership(x.from.id, x.projectId)) ? { ...x, blocked: true } : x));
  }
  const own = (user, id) => { const r = db.get('SELECT * FROM transfers WHERE id = ? AND (from_id = ? OR to_id = ?)', id, user.id, user.id); if (!r) throw E.notFound('Invio non trovato.'); return r; };

  function accept(user, id) {
    expire();
    const r = own(user, id);
    if (r.to_id !== user.id) throw E.forbidden('Solo il destinatario può accettare.');
    if (r.status !== 'pending') throw E.conflict(`Questo invio è già ${STATUS_LABEL[r.status].toLowerCase()}.`, { status: r.status });
    if (!access.membership(user.id, r.project_id) || !access.membership(r.from_id, r.project_id)) throw E.forbidden('Non siete più collegati nello stesso gruppo: l’invio non può essere accettato.', 'non_piu_collegati');
    const target = ctx.auth.pub(db.get('SELECT * FROM users WHERE id = ?', user.id));
    const copied = []; const missing = [];
    const dest = r.folder || null;
    for (const it of jparse(r.items_json, [])) {
      const src = db.get("SELECT * FROM materials WHERE id = ? AND owner_id = ? AND visibility = 'personale' AND deleted_at IS NULL", it.materialId, r.from_id);
      if (!src) { missing.push(it.name); continue; } // il mittente lo ha eliminato nel frattempo
      try { const m = materials.copyToPersonal(src.id, target, { folder: dest || it.folder || `Da ${access.userLabel(r.from_id)}`.slice(0, 40) }); copied.push({ materialId: m.materialId, name: m.name }); }
      catch (e) { log.warn('copia trasferimento', { err: e }); missing.push(it.name); }
    }
    db.run("UPDATE transfers SET status = 'accepted', responded_at = ?, result_json = ? WHERE id = ?", now(), JSON.stringify({ copied: copied.length, missing }), id);
    access.audit(user.id, r.project_id, 'trasferimento.accettato', { id, n: copied.length });
    notify([r.from_id, r.to_id], { id, status: 'accepted' });
    return { transfer: pub(db.get('SELECT * FROM transfers WHERE id = ?', id), user), copied, missing };
  }
  function respond(user, id, status) {
    expire();
    const r = own(user, id);
    if (status === 'declined' && r.to_id !== user.id) throw E.forbidden('Solo il destinatario può rifiutare.');
    if (status === 'cancelled' && r.from_id !== user.id) throw E.forbidden('Solo chi ha inviato può annullare.');
    if (r.status !== 'pending') throw E.conflict(`Questo invio è già ${STATUS_LABEL[r.status].toLowerCase()}.`, { status: r.status });
    db.run('UPDATE transfers SET status = ?, responded_at = ? WHERE id = ?', status, now(), id);
    notify([r.from_id, r.to_id], { id, status });
    return pub(db.get('SELECT * FROM transfers WHERE id = ?', id), user);
  }
  // chi esce da un gruppo: le offerte in sospeso di quel gruppo che lo riguardano si annullano
  function dropFor(userId, projectId) {
    const rows = db.all("SELECT * FROM transfers WHERE project_id = ? AND status = 'pending' AND (from_id = ? OR to_id = ?)", projectId, userId, userId);
    db.run("UPDATE transfers SET status = 'cancelled', responded_at = ? WHERE project_id = ? AND status = 'pending' AND (from_id = ? OR to_id = ?)", now(), projectId, userId, userId);
    for (const r of rows) notify([r.from_id, r.to_id], { id: r.id, status: 'cancelled' });
  }
  const pendingCount = (user) => { expire(); return db.get("SELECT COUNT(*) n FROM transfers WHERE to_id = ? AND status = 'pending'", user.id).n; };
  const exportFor = (user) => db.all('SELECT * FROM transfers WHERE from_id = ? OR to_id = ?', user.id, user.id).map((r) => pub(r, user));
  const purgeOld = (days = 90) => db.run("DELETE FROM transfers WHERE status != 'pending' AND created_at < ?", new Date(Date.now() - days * 864e5).toISOString());
  return { create, list, accept, decline: (u, id) => respond(u, id, 'declined'), cancel: (u, id) => respond(u, id, 'cancelled'), dropFor, pendingCount, exportFor, purgeOld, STATUS_LABEL };
}
module.exports = { createTransfers };
