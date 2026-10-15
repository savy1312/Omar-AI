'use strict';
// BACHECA (Sede di Oleggio): circolari, avvisi, concorsi ed eventi pubblicati da docenti e amministratori.
// Gli studenti leggono e segnano come letto. Nessun contenuto viene inventato: le voci sono scritte dalla scuola
// o importate da una pagina pubblica indicata da un docente (con link alla fonte). L'unica voce creata dal sistema
// è il concorso di design dell'app, segnata come "da completare" finché un docente non la aggiorna.
const { E } = require('../lib/errors');
const { now, uuid } = require('../lib/util');
const { htmlToText } = require('../web/html');
const { hostOf } = require('../web/links');

const KINDS = { circolare: 'Circolare', avviso: 'Avviso', concorso: 'Concorso', evento: 'Evento' };
const CONTEST = {
  kind: 'concorso', title: 'Concorso di design UI/UX per l’app della scuola',
  body: 'Concorso dedicato alla progettazione dell’interfaccia (UI) e dell’esperienza d’uso (UX) dell’app della scuola: proposte di schermate, flussi e idee per rendere Omar AI più chiara e utile per tutti.\n\nRegolamento, modalità di partecipazione, scadenze e premi saranno pubblicati qui dai docenti: questa voce è un segnaposto da completare a cura della scuola.',
};

function createBulletin(ctx) {
  const { db, access, log } = ctx;
  const notify = () => { try { ctx.hub?.notify('*', { type: 'bulletin.updated' }); } catch { /* nessuno collegato */ } };

  // voce del concorso creata una sola volta (segnaposto da completare)
  if (!db.get('SELECT 1 x FROM bulletins LIMIT 1')) {
    const t = now();
    db.run('INSERT INTO bulletins (id, kind, campus, title, body, pinned, example, author_label, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      uuid(), CONTEST.kind, 'Oleggio', CONTEST.title, CONTEST.body, 1, 1, 'Omar AI', t, t, t);
  }

  const pub = (b, user) => {
    const read = db.get('SELECT read_at FROM bulletin_reads WHERE bulletin_id = ? AND user_id = ?', b.id, user.id);
    return { id: b.id, kind: b.kind, kindLabel: KINDS[b.kind], campus: b.campus, number: b.number, title: b.title, body: b.body, link: b.link, linkHost: b.link ? hostOf(b.link) : null,
      pinned: !!b.pinned, example: !!b.example, author: b.author_label || 'Scuola', publishedAt: b.published_at, expiresAt: b.expires_at, deadlineAt: b.deadline_at,
      read: !!read, readAt: read?.read_at || null, canEdit: user.role !== 'student', updatedAt: b.updated_at };
  };
  const live = () => `deleted_at IS NULL AND (expires_at IS NULL OR expires_at > '${now()}')`;
  function list(user, { kind = null, q = '', includeExpired = false } = {}) {
    const where = [includeExpired && user.role !== 'student' ? 'deleted_at IS NULL' : live()]; const params = [];
    if (kind && KINDS[kind]) { where.push('kind = ?'); params.push(kind); }
    if (q) { where.push('(title LIKE ? OR body LIKE ? OR number LIKE ?)'); const like = `%${String(q).slice(0, 60).replace(/[%_]/g, '')}%`; params.push(like, like, like); }
    const rows = db.all(`SELECT * FROM bulletins WHERE ${where.join(' AND ')} ORDER BY pinned DESC, published_at DESC LIMIT 200`, ...params);
    const items = rows.map((b) => pub(b, user));
    return { items, unread: unreadCount(user), kinds: KINDS, campus: 'Sede di Oleggio' };
  }
  const unreadCount = (user) => db.get(`SELECT COUNT(*) n FROM bulletins b WHERE ${live()} AND NOT EXISTS (SELECT 1 FROM bulletin_reads r WHERE r.bulletin_id = b.id AND r.user_id = ?)`, user.id).n;
  const get = (id) => { const b = db.get('SELECT * FROM bulletins WHERE id = ? AND deleted_at IS NULL', id); if (!b) throw E.notFound('Avviso non trovato.'); return b; };
  const teacherOnly = (user) => { if (user.role === 'student') throw E.forbidden('Solo docenti e amministratori possono pubblicare in bacheca.'); };
  function validate(b, ex = {}) {
    const kind = b.kind ?? ex.kind ?? 'avviso'; if (!KINDS[kind]) throw E.bad('Tipo non valido.');
    const title = String(b.title ?? ex.title ?? '').replace(/\s+/g, ' ').trim(); if (title.length < 4 || title.length > 160) throw E.bad('Il titolo deve avere da 4 a 160 caratteri.');
    const body = String(b.body ?? ex.body ?? '').replace(/\r\n/g, '\n').trim(); if (body.length < 4 || body.length > 8000) throw E.bad('Il testo deve avere da 4 a 8000 caratteri.');
    const link = (b.link ?? ex.link ?? '') || null; if (link && !/^https?:\/\/\S+$/i.test(link)) throw E.bad('Il link deve iniziare con http:// o https://');
    const date = (v, label) => { if (v == null || v === '') return null; const d = new Date(v); if (Number.isNaN(+d)) throw E.bad(`${label} non valida.`); return d.toISOString(); };
    return { kind, title, body, link, number: String(b.number ?? ex.number ?? '').trim().slice(0, 30) || null, pinned: !!(b.pinned ?? ex.pinned),
      expires: date(b.expiresAt !== undefined ? b.expiresAt : ex.expires_at, 'Data di scadenza'), deadline: date(b.deadlineAt !== undefined ? b.deadlineAt : ex.deadline_at, 'Data limite') };
  }
  function create(user, b = {}) {
    teacherOnly(user); const v = validate(b); const id = uuid(); const t = now();
    db.run('INSERT INTO bulletins (id, kind, campus, number, title, body, link, pinned, example, author_id, author_label, published_at, expires_at, deadline_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, v.kind, 'Oleggio', v.number, v.title, v.body, v.link, v.pinned ? 1 : 0, 0, user.id, user.displayName, t, v.expires, v.deadline, t, t);
    access.audit(user.id, null, 'bacheca.pubblica', { id }); notify();
    return pub(get(id), user);
  }
  function update(user, id, b = {}) {
    teacherOnly(user); const ex = get(id); const v = validate(b, ex);
    db.run('UPDATE bulletins SET kind = ?, number = ?, title = ?, body = ?, link = ?, pinned = ?, example = 0, expires_at = ?, deadline_at = ?, author_id = ?, author_label = ?, updated_at = ? WHERE id = ?',
      v.kind, v.number, v.title, v.body, v.link, v.pinned ? 1 : 0, v.expires, v.deadline, user.id, user.displayName, now(), id);
    db.run('DELETE FROM bulletin_reads WHERE bulletin_id = ?', id); // contenuto cambiato: torna "da leggere"
    notify(); return pub(get(id), user);
  }
  function remove(user, id) { teacherOnly(user); get(id); db.run('UPDATE bulletins SET deleted_at = ? WHERE id = ?', now(), id); notify(); return { ok: true }; }
  function markRead(user, id, read = true) {
    get(id);
    if (read) db.run('INSERT OR IGNORE INTO bulletin_reads (bulletin_id, user_id, read_at) VALUES (?,?,?)', id, user.id, now());
    else db.run('DELETE FROM bulletin_reads WHERE bulletin_id = ? AND user_id = ?', id, user.id);
    return { ok: true, unread: unreadCount(user) };
  }
  function markAllRead(user) {
    db.run(`INSERT OR IGNORE INTO bulletin_reads (bulletin_id, user_id, read_at) SELECT id, ?, ? FROM bulletins WHERE ${live()}`, user.id, now());
    return { ok: true, unread: 0 };
  }
  // Importa una circolare da una pagina PUBBLICA (es. il sito della scuola): titolo e testo vengono letti dal server
  // con le stesse protezioni dei link degli studenti; il docente rivede la bozza prima di pubblicarla.
  async function draftFromUrl(user, url) {
    teacherOnly(user);
    let target; try { target = ctx.web.check(url); } catch (e) { throw E.bad(e.message || 'Indirizzo non valido.'); }
    let page; try { page = await ctx.web.fetchPublic(target.href, { maxBytes: 2_000_000 }); } catch (e) { throw E.bad(e.message || 'Non sono riuscito a leggere la pagina.', 'link_non_leggibile'); }
    if (!/html|text\/plain/.test(page.type || '')) return { kind: 'circolare', title: decodeURIComponent(new URL(page.url).pathname.split('/').pop() || 'Circolare').replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').slice(0, 160), body: `Documento pubblicato sul sito della scuola: apri il link per leggerlo.`, link: page.url };
    const raw = ctx.web.decode(page.buffer, page.charset);
    const x = /html/.test(page.type) ? htmlToText(raw, { max: 20000 }) : { title: '', text: raw };
    const number = /circolare\s*(?:n\.?|nr\.?|numero)\s*([\w/.-]{1,12})/i.exec(`${x.title} ${x.text.slice(0, 600)}`)?.[1] || null;
    log.info('bozza bacheca da link', { host: hostOf(page.url) });
    return { kind: /circolare/i.test(x.title + x.text.slice(0, 300)) ? 'circolare' : 'avviso', number, title: (x.title || hostOf(page.url) || 'Circolare').slice(0, 160), body: x.text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000), link: page.url };
  }
  return { list, create, update, remove, markRead, markAllRead, unreadCount, draftFromUrl, KINDS };
}
module.exports = { createBulletin };
