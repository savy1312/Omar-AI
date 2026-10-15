'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { E } = require('../lib/errors');
const { now, uuid, sha256, keywords } = require('../lib/util');
const { classify, extractText, chunkPages, capabilityLabel } = require('./extract');
const { neutralize } = require('../engine/injection');

const STATUS_LABEL = {
  ricevuto: 'Ricevuto dal server',
  disponibile: 'Disponibile agli altri dispositivi',
  in_elaborazione: 'In elaborazione',
  pronto: 'Contenuto pronto per l\'uso dell\'IA',
  fallito: 'Elaborazione fallita',
  non_supportato: 'Non interpretabile dall\'IA',
};

function createMaterials(ctx) {
  const { db, cfg, access, events, log } = ctx;
  const uploadsDir = path.join(cfg.dataDir, 'uploads');
  const pending = new Set();

  const toPublic = (v, viewer) => ({
    id: v.id, materialId: v.material_id, name: v.name, filename: v.filename, version: v.version,
    visibility: v.visibility, projectId: v.project_id, subjectId: v.subject_id, topicId: v.topic_id,
    uploadedBy: { id: v.uploaded_by, displayName: v.uploader_name || 'ex partecipante' },
    createdAt: v.created_at, status: v.status, statusLabel: STATUS_LABEL[v.status],
    capability: v.capability, capabilityLabel: capabilityLabel(v.kind, v.capability), kind: v.kind, size: v.size,
    pageCount: v.page_count, chunkCount: v.chunk_count, error: v.error, sourceUrl: v.source_url || null, folder: v.folder || null,
    ...(viewer && (viewer.role !== 'student') ? { injectionFlags: v.injection_flags } : {}),
  });
  const SELECT = `SELECT v.*, m.name, m.visibility, m.project_id, m.subject_id, m.topic_id, m.owner_id, m.deleted_at, m.current_version, m.folder,
                         u.display_name uploader_name
                  FROM material_versions v JOIN materials m ON m.id = v.material_id LEFT JOIN users u ON u.id = v.uploaded_by`;

  function setStatus(versionId, status, extra = {}) {
    const sets = ['status = ?']; const vals = [status];
    for (const [k, val] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(val); }
    db.run(`UPDATE material_versions SET ${sets.join(', ')} WHERE id = ?`, ...vals, versionId);
    const v = db.get(`${SELECT} WHERE v.id = ?`, versionId);
    if (v.visibility === 'gruppo') {
      events.publish(v.project_id, { type: `material.${status}`, entityType: 'material', entityId: v.material_id, actorId: v.uploaded_by, data: { version: v.version, status } });
    }
    return v;
  }

  // il modello "vista" (immagini, scansioni): un DATO come il testo dei documenti, con la fonte dichiarata
  async function visionFn(name) {
    return async (img, mime, { page } = {}) => {
      if (img.length > 15 * 1048576) throw new Error('immagine troppo grande per il modello vista');
      const r = await ctx.provider.vision({ image: img, mime });
      return `[Descrizione e trascrizione ${page ? `della pagina ${page} di` : 'dell\'immagine'} «${name}» fatta dal modello IA ${r.model}: può contenere errori di lettura]\n${r.text}`;
    };
  }
  async function process(versionId) {
    const v = db.get(`${SELECT} WHERE v.id = ?`, versionId);
    if (!v || v.deleted_at) return;
    const buf0 = v.capability === 'ia_testo' ? null : fs.readFileSync(path.join(uploadsDir, v.storage_name));
    if (v.capability !== 'ia_testo') {
      const hint = classify(v.filename, buf0, { vision: false }).hint;
      setStatus(versionId, 'non_supportato', { error: v.kind === 'immagine' && v.capability === 'visualizzabile'
        ? 'Immagine conservata e visualizzabile. Per farla leggere e descrivere a Omar serve un modello IA «vista» (vedi «npm run setup:ollama»); poi usa «Rileggi».'
        : hint || 'Formato solo archiviabile e scaricabile: Omar non sa leggerne il contenuto.' });
      return;
    }
    setStatus(versionId, 'in_elaborazione');
    try {
      const buf = fs.readFileSync(path.join(uploadsDir, v.storage_name));
      const fmt = classify(v.filename, buf, { vision: true });
      const needsVision = fmt.x === 'image' || fmt.kind === 'pdf';
      const vision = needsVision && (await ctx.vision?.model()) ? await visionFn(v.name) : null;
      if (fmt.x === 'image' && !vision) { setStatus(versionId, 'fallito', { error: 'Nessun modello IA «vista» disponibile in questo momento: l\'immagine è conservata ma non letta. Installa un modello vista (npm run setup:ollama) e usa «Rileggi».' }); return; }
      const out = await extractText(fmt, buf, { vision, log });
      const pages = out.pages.filter((p) => String(p).trim());
      const chunks = chunkPages(pages);
      if (!chunks.length) { setStatus(versionId, 'fallito', { error: out.note || 'Nel file non c\'è testo leggibile.' }); return; }
      let flags = 0;
      db.tx(() => {
        db.run('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE version_id = ?)', versionId);
        db.run('DELETE FROM chunks WHERE version_id = ?', versionId);
        for (const [i, c] of chunks.entries()) {
          const n = neutralize(c.text); flags += n.hits; // i documenti sono dati: le frasi-istruzione vengono rimosse
          const r = db.run('INSERT INTO chunks (material_id, version_id, ord, page, text) VALUES (?,?,?,?,?)', v.material_id, versionId, i, c.page, n.text);
          db.run('INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)', Number(r.lastInsertRowid), n.text);
        }
      });
      setStatus(versionId, 'pronto', { chunk_count: chunks.length, page_count: pages.length, injection_flags: flags, error: out.note || null });
    } catch (e) {
      log.warn('estrazione fallita', { versionId, err: e });
      const why = e?.code === 'timeout' ? 'Il modello IA ha impiegato troppo a leggere il file: riprova con «Rileggi».' : e?.code === 'unavailable' ? 'Il modello IA non risponde: riprova con «Rileggi» quando è attivo.'
        : `Impossibile leggere il file${e?.message && !e.code ? ` (${e.message})` : ''}.`;
      setStatus(versionId, 'fallito', { error: why });
    }
  }
  // «Rileggi»: ripete la lettura (per esempio dopo aver installato il modello vista o se il modello non rispondeva)
  async function reprocess(user, materialId) {
    const mat = db.get('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL', materialId);
    if (!mat || !access.canViewMaterial(user, mat)) throw E.notFound('Materiale non trovato.');
    if (mat.owner_id !== user.id && user.role === 'student' && !(mat.visibility === 'gruppo' && access.membership(user.id, mat.project_id))) throw E.forbidden('Non puoi rileggere questo materiale.');
    const v = db.get('SELECT * FROM material_versions WHERE material_id = ? AND version = ?', materialId, mat.current_version);
    const buf = fs.readFileSync(path.join(uploadsDir, v.storage_name));
    const fmt = classify(v.filename, buf, { vision: !!(await ctx.vision?.model()) });
    if (fmt.ok) db.run('UPDATE material_versions SET capability = ?, kind = ?, error = NULL WHERE id = ?', fmt.capability, fmt.kind, v.id);
    setStatus(v.id, 'disponibile');
    schedule(v.id);
    return toPublic(db.get(`${SELECT} WHERE v.id = ?`, v.id), user);
  }
  // attende (al massimo `ms`) che i materiali indicati finiscano di essere letti
  async function waitReady(materialIds, ms = 150_000, onWait = null) {
    const end = Date.now() + ms; let told = false;
    for (;;) {
      const busy = materialIds.length ? db.all(`SELECT v.material_id FROM material_versions v JOIN materials m ON m.id = v.material_id WHERE m.id IN (${materialIds.map(() => '?').join(',')}) AND v.version = m.current_version AND v.status IN ('ricevuto','disponibile','in_elaborazione')`, ...materialIds) : [];
      if (!busy.length || Date.now() > end) return busy.length === 0;
      if (!told) { told = true; onWait?.(busy.length); }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const pinnedIds = (sessionId) => db.all('SELECT material_id FROM session_materials WHERE session_id = ? ORDER BY created_at DESC LIMIT 8', sessionId).map((r) => r.material_id);
  function attachments(user, sessionId) {
    const ids = pinnedIds(sessionId); if (!ids.length) return [];
    return db.all(`${SELECT} WHERE m.id IN (${ids.map(() => '?').join(',')}) AND m.deleted_at IS NULL AND v.version = m.current_version`, ...ids)
      .filter((v) => access.canViewMaterial(user, { visibility: v.visibility, owner_id: v.owner_id, project_id: v.project_id, deleted_at: v.deleted_at })).map((v) => toPublic(v, user));
  }
  function schedule(versionId) {
    const p = new Promise((res) => setImmediate(res)).then(() => process(versionId)).catch((e) => log.error('processing', { err: e })).finally(() => pending.delete(p));
    pending.add(p);
  }
  const waitIdle = async () => { while (pending.size) await Promise.all([...pending]); };

  // ── cartelle: un'etichetta per materiale (max 40 caratteri, max 50 cartelle per ambito). "Ambito" = personale dell'utente oppure gruppo. ──
  const MAX_FOLDERS = 50;
  function normFolder(f) {
    if (f == null) return null;
    const x = String(f).replace(/[\u0000-\u001f\\/<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    return x || null;
  }
  function scopeWhere(mat) { return mat.visibility === 'gruppo' ? ["m.visibility = 'gruppo' AND m.project_id = ?", mat.project_id] : mat.visibility === 'corso' ? ["m.visibility = 'corso'", null] : ["m.visibility = 'personale' AND m.owner_id = ?", mat.owner_id]; }
  // riusa una cartella esistente con lo stesso nome (senza distinguere maiuscole) e limita il numero di cartelle
  function canonicalFolder(scope, folder) {
    const f = normFolder(folder); if (!f) return null;
    const [w, p] = scope; const params = p == null ? [] : [p];
    const existing = db.all(`SELECT DISTINCT m.folder f FROM materials m WHERE ${w} AND m.deleted_at IS NULL AND m.folder IS NOT NULL`, ...params).map((r) => r.f);
    const same = existing.find((x) => x.toLowerCase() === f.toLowerCase()); if (same) return same;
    if (existing.length >= MAX_FOLDERS) throw E.bad(`Hai raggiunto il massimo di ${MAX_FOLDERS} cartelle: riusane una esistente.`, 'troppe_cartelle');
    return f;
  }
  function mayOrganize(user, mat) {
    if (mat.visibility === 'personale') return mat.owner_id === user.id;
    if (mat.visibility === 'gruppo') return !!access.membership(user.id, mat.project_id);
    return user.role !== 'student';
  }
  function setFolder(user, materialId, folder) {
    const mat = db.get('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL', materialId);
    if (!mat || !access.canViewMaterial(user, mat)) throw E.notFound('Materiale non trovato.');
    if (!mayOrganize(user, mat)) throw E.forbidden('Non puoi spostare questo materiale.');
    const f = canonicalFolder(scopeWhere(mat), folder);
    db.run('UPDATE materials SET folder = ? WHERE id = ?', f, materialId);
    if (mat.visibility === 'gruppo') events.publish(mat.project_id, { type: 'material.moved', entityType: 'material', entityId: materialId, actorId: user.id });
    return { materialId, folder: f };
  }
  // rinomina (o, con to vuoto, scioglie) una cartella in un ambito
  function renameFolder(user, { scope = 'personale', projectId = null, from, to }) {
    const src = normFolder(from); if (!src) throw E.bad('Cartella non valida.');
    let where;
    if (scope === 'gruppo') { access.requireMember(user, projectId); where = ["m.visibility = 'gruppo' AND m.project_id = ?", projectId]; }
    else if (scope === 'personale') where = ["m.visibility = 'personale' AND m.owner_id = ?", user.id];
    else throw E.bad('Ambito non valido.');
    const dst = to ? canonicalFolder(where, to) : null;
    const r = db.run(`UPDATE materials SET folder = ? WHERE id IN (SELECT m.id FROM materials m WHERE ${where[0]} AND m.deleted_at IS NULL AND lower(m.folder) = lower(?))`, dst, where[1], src);
    if (scope === 'gruppo' && r.changes) events.publish(projectId, { type: 'material.moved', entityType: 'folder', entityId: null, actorId: user.id });
    return { moved: r.changes, folder: dst };
  }
  // copia la versione corrente di un materiale tra i materiali PERSONALI di un altro utente (usata dai trasferimenti accettati)
  function copyToPersonal(materialId, target, { folder = null } = {}) {
    const v = db.get(`${SELECT} WHERE m.id = ? AND m.deleted_at IS NULL AND v.version = m.current_version`, materialId);
    if (!v) throw E.notFound('Materiale non più disponibile.');
    const buf = fs.readFileSync(path.join(uploadsDir, v.storage_name));
    return upload({ user: target, file: { originalname: v.filename, buffer: buf }, visibility: 'personale', name: v.name, subjectId: v.subject_id, topicId: v.topic_id, folder, sourceUrl: v.source_url });
  }

  function upload({ user, file, visibility, projectId, subjectId, topicId, materialId, expectedVersion, name, sourceUrl = null, inline = false, folder = null }) {
    if (!materialId && !['personale', 'gruppo', 'corso'].includes(visibility)) throw E.bad('Scegli esplicitamente la visibilità: personale, gruppo o corso.', 'visibilita_mancante');
    if (!file?.buffer?.length) throw E.bad('File mancante o vuoto.');
    if (file.buffer.length > cfg.limits.maxUploadBytes) throw E.tooLarge(`Il file supera il limite di ${Math.round(cfg.limits.maxUploadBytes / 1048576)} MB.`);
    const fmt = classify(file.originalname, file.buffer, { vision: !!ctx.vision?.ready });
    if (!fmt.ok) throw E.bad(fmt.reason, 'formato_non_valido');

    let mat = null;
    if (materialId) {
      mat = db.get('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL', materialId);
      if (!mat || !access.canViewMaterial(user, mat)) throw E.notFound('Materiale non trovato.');
      const mayEdit = mat.owner_id === user.id || user.role !== 'student' || (mat.project_id && access.membership(user.id, mat.project_id)?.role !== 'member');
      if (!mayEdit) throw E.forbidden('Solo chi ha caricato il materiale può aggiornarlo.');
      if (expectedVersion !== undefined && Number(expectedVersion) !== mat.current_version) {
        throw E.conflict('Nel frattempo è stata caricata una versione più recente.', { currentVersion: mat.current_version });
      }
      visibility = mat.visibility; projectId = mat.project_id; subjectId = mat.subject_id; topicId = mat.topic_id;
    } else {
      if (visibility === 'corso') {
        if (user.role === 'student') throw E.forbidden('Solo i docenti possono caricare materiali del corso.');
        if (!subjectId || !ctx.subjects.get(subjectId)) throw E.bad('Materia non valida.');
        if (topicId && !ctx.subjects.hasTopic(subjectId, topicId)) throw E.bad('Argomento non valido.');
      } else if (visibility === 'gruppo') {
        access.requireMember(user, projectId);
        const used = db.get(`SELECT COALESCE(SUM(v.size),0) s FROM material_versions v JOIN materials m ON m.id = v.material_id WHERE m.project_id = ? AND m.deleted_at IS NULL`, projectId).s;
        if (used + file.buffer.length > cfg.limits.maxProjectBytes) throw E.tooLarge('Spazio del progetto esaurito.');
      } else { projectId = null; }
      if (visibility !== 'corso' && subjectId && !ctx.subjects.get(subjectId)) { subjectId = null; topicId = null; } // es. chat ancora "generale"
      if (topicId && !ctx.subjects.hasTopic(subjectId, topicId)) topicId = null;
    }
    const folderName = !mat && folder ? canonicalFolder(visibility === 'gruppo' ? ["m.visibility = 'gruppo' AND m.project_id = ?", projectId] : visibility === 'corso' ? ["m.visibility = 'corso'", null] : ["m.visibility = 'personale' AND m.owner_id = ?", user.id], folder) : null;

    const id = mat?.id || uuid();
    const version = (mat?.current_version || 0) + 1;
    const versionId = uuid();
    const storageName = `${uuid()}${fmt.ext}`;
    fs.writeFileSync(path.join(uploadsDir, storageName), file.buffer, { mode: 0o600 });
    try {
      db.tx(() => {
        if (!mat) {
          db.run('INSERT INTO materials (id, owner_id, project_id, subject_id, topic_id, visibility, name, current_version, created_at, folder) VALUES (?,?,?,?,?,?,?,?,?,?)',
            id, user.id, projectId, subjectId || null, topicId || null, visibility, String(name || file.originalname).slice(0, 120), version, now(), folderName);
        } else db.run('UPDATE materials SET current_version = ? WHERE id = ?', version, id);
        db.run(`INSERT INTO material_versions (id, material_id, version, filename, mime, kind, capability, size, sha256, storage_name, uploaded_by, created_at, status, source_url)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          versionId, id, version, String(file.originalname).slice(0, 160), fmt.mime, fmt.kind, fmt.capability, file.buffer.length, sha256(file.buffer), storageName, user.id, now(), 'ricevuto', sourceUrl ? String(sourceUrl).slice(0, 2000) : null);
      });
    } catch (e) { fs.rmSync(path.join(uploadsDir, storageName), { force: true }); throw e; }
    // 1) ricevuto dal server  2) disponibile agli altri dispositivi  3..5) elaborazione asincrona
    setStatus(versionId, 'ricevuto');
    setStatus(versionId, 'disponibile', { available_at: now() });
    access.audit(user.id, projectId, 'materiale.carica', { materialId: id, version, visibility });
    if (!inline) schedule(versionId); // con inline:true l'elaborazione la attende il chiamante (process), per usare subito il contenuto
    return toPublic(db.get(`${SELECT} WHERE v.id = ?`, versionId), user);
  }
  const publicVersion = (versionId, user) => { const v = db.get(`${SELECT} WHERE v.id = ?`, versionId); return v ? toPublic(v, user) : null; };

  // ── allegati «di sessione»: materiali che lo studente ha allegato a QUESTA chat (file, cartella, link). Servono a rispondere a «spiegami questo documento» anche quando la domanda non ripete le parole del testo. ──
  function pin(user, sessionId, materialId) {
    if (!db.get('SELECT 1 x FROM chat_sessions WHERE id = ? AND user_id = ?', sessionId, user.id)) throw E.notFound('Sessione non trovata.');
    const mat = db.get('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL', materialId);
    if (!mat || !access.canViewMaterial(user, mat)) throw E.notFound('Materiale non trovato.');
    db.run('INSERT OR IGNORE INTO session_materials (session_id, material_id, created_at) VALUES (?,?,?)', sessionId, materialId, now());
  }
  // Passaggi dei materiali allegati alla sessione: quelli più pertinenti alla domanda, più l'inizio del documento (titolo, introduzione).
  function focusPassages(user, sessionId, query, { projectId, subjectId, k = 6 } = {}) {
    const pinned = db.all('SELECT material_id FROM session_materials WHERE session_id = ? ORDER BY created_at DESC LIMIT 5', sessionId).map((r) => r.material_id);
    if (!pinned.length) return [];
    const vis = visibleClause(user, { projectId, subjectId });
    const rows = db.all(`SELECT c.id, c.page, c.text, c.ord, v.version, v.filename, v.source_url, m.id material_id, m.name, m.visibility, u.display_name uploader_name
                         FROM chunks c JOIN material_versions v ON v.id = c.version_id JOIN materials m ON m.id = c.material_id LEFT JOIN users u ON u.id = v.uploaded_by
                         WHERE m.id IN (${pinned.map(() => '?').join(',')}) AND m.deleted_at IS NULL AND v.version = m.current_version AND v.status = 'pronto' AND ${vis.sql}
                         ORDER BY m.created_at DESC, c.ord`, ...pinned, ...vis.params);
    const words = keywords(query, 10).map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w));
    const byMat = new Map(); for (const r of rows) { if (!byMat.has(r.material_id)) byMat.set(r.material_id, []); byMat.get(r.material_id).push(r); }
    const per = Math.max(2, Math.ceil(k / byMat.size)); const out = [];
    for (const list of byMat.values()) {
      const scored = list.map((r) => ({ r, sc: words.reduce((n, w) => n + (r.text.toLowerCase().includes(w) ? 1 : 0), 0) }));
      const pick = new Set([0]);                                                                   // l'inizio del documento c'è sempre
      for (const x of [...scored.keys()].sort((a, b) => scored[b].sc - scored[a].sc || a - b)) { if (pick.size >= per) break; if (scored[x].sc > 0 || pick.size < Math.min(per, 3)) pick.add(x); }
      for (const x of [...pick].sort((a, b) => a - b)) { const r = list[x]; if (r) out.push({ chunkId: r.id, materialId: r.material_id, name: r.name, filename: r.filename, version: r.version, page: r.page, visibility: r.visibility, uploadedBy: r.uploader_name, text: r.text, sourceUrl: r.source_url || null, score: 0, pinned: true }); }
    }
    return out.slice(0, k);
  }

  function visibleClause(user, { projectId, subjectId }) {
    // Restituisce un frammento SQL + parametri che applica la visibilità. Il progetto di sessione limita i materiali di gruppo.
    const parts = ["(m.visibility = 'personale' AND m.owner_id = ?)"]; const params = [user.id];
    parts.push(`(m.visibility = 'corso'${subjectId ? ' AND (m.subject_id = ? OR m.subject_id IS NULL)' : ''})`); if (subjectId) params.push(subjectId);
    if (projectId && access.membership(user.id, projectId)) { parts.push("(m.visibility = 'gruppo' AND m.project_id = ?)"); params.push(projectId); }
    return { sql: `(${parts.join(' OR ')})`, params };
  }

  function list(user, { scope, projectId, subjectId, topicId }) {
    if (scope === 'gruppo') {
      access.requireMember(user, projectId);
      return db.all(`${SELECT} WHERE m.visibility = 'gruppo' AND m.project_id = ? AND m.deleted_at IS NULL AND v.version = m.current_version ORDER BY v.created_at DESC`, projectId).map((v) => toPublic(v, user));
    }
    if (scope === 'personale') {
      return db.all(`${SELECT} WHERE m.visibility = 'personale' AND m.owner_id = ? AND m.deleted_at IS NULL AND v.version = m.current_version ORDER BY v.created_at DESC`, user.id).map((v) => toPublic(v, user));
    }
    const rows = db.all(`${SELECT} WHERE m.visibility = 'corso' AND m.deleted_at IS NULL AND v.version = m.current_version
                         AND (? IS NULL OR m.subject_id = ?) AND (? IS NULL OR m.topic_id = ?) ORDER BY v.created_at DESC`, subjectId || null, subjectId || null, topicId || null, topicId || null);
    return rows.map((v) => toPublic(v, user));
  }

  function get(user, materialId) {
    const v = db.get(`${SELECT} WHERE m.id = ? AND m.deleted_at IS NULL AND v.version = m.current_version`, materialId);
    if (!v || !access.canViewMaterial(user, { visibility: v.visibility, owner_id: v.owner_id, project_id: v.project_id, deleted_at: v.deleted_at })) throw E.notFound('Materiale non trovato.');
    return v;
  }
  function filePath(user, materialId) {
    const v = get(user, materialId);
    return { path: path.join(uploadsDir, v.storage_name), filename: v.filename, mime: v.mime, kind: v.kind };
  }

  function remove(user, materialId) {
    const mat = db.get('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL', materialId);
    if (!mat || !access.canViewMaterial(user, mat)) throw E.notFound('Materiale non trovato.');
    let ok = mat.owner_id === user.id;
    if (!ok && mat.visibility === 'corso') ok = user.role !== 'student';
    if (!ok && mat.visibility === 'gruppo') ok = ['owner', 'teacher'].includes(access.membership(user.id, mat.project_id)?.role);
    if (!ok) throw E.forbidden('Non puoi eliminare questo materiale.');
    const vers = db.all('SELECT * FROM material_versions WHERE material_id = ?', materialId);
    db.tx(() => {
      db.run('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE material_id = ?)', materialId);
      db.run('DELETE FROM chunks WHERE material_id = ?', materialId);
      db.run('UPDATE materials SET deleted_at = ? WHERE id = ?', now(), materialId);
      db.run('UPDATE material_versions SET source_url = NULL WHERE material_id = ?', materialId);
    });
    for (const v of vers) fs.rmSync(path.join(uploadsDir, v.storage_name), { force: true });
    if (mat.visibility === 'gruppo') events.publish(mat.project_id, { type: 'material.deleted', entityType: 'material', entityId: materialId, actorId: user.id });
    access.audit(user.id, mat.project_id, 'materiale.elimina', { materialId });
  }

  // Recupero dei passaggi pertinenti (FTS5 + bm25). Solo materiali VISIBILI all'utente, versione corrente, stato "pronto".
  function search(user, query, { subjectId, topicId, projectId, preferSubject = null, k = 5 } = {}) {
    const words = keywords(query, 10);
    if (!words.length) return [];
    const terms = words.map((w) => `"${w.length >= 6 ? w.slice(0, w.length - 2) : w}"*`).join(' OR ');
    const vis = visibleClause(user, { projectId, subjectId });
    let rows;
    try {
      rows = db.all(`SELECT c.id, c.page, c.text, c.ord, v.id version_id, v.version, v.filename, v.source_url, m.id material_id, m.name, m.visibility, m.topic_id, m.subject_id,
                            bm25(chunks_fts) rank, u.display_name uploader_name
                     FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
                     JOIN material_versions v ON v.id = c.version_id JOIN materials m ON m.id = c.material_id
                     LEFT JOIN users u ON u.id = v.uploaded_by
                     WHERE chunks_fts MATCH ? AND m.deleted_at IS NULL AND v.version = m.current_version AND v.status = 'pronto'
                       AND ${vis.sql} ORDER BY rank LIMIT ?`, terms, ...vis.params, k * 3);
    } catch (e) { log.warn('ricerca fts', { err: e }); return []; }
    // preferenza "morbida" (riconoscimento automatico): prima la materia probabile e l'argomento, poi la pertinenza
    if (topicId || preferSubject) rows.sort((a, b) => (topicId ? (b.topic_id === topicId) - (a.topic_id === topicId) : 0) || (preferSubject ? (b.subject_id === preferSubject) - (a.subject_id === preferSubject) : 0) || a.rank - b.rank);
    return rows.slice(0, k).map((r, i) => ({
      ref: `M${i + 1}`, chunkId: r.id, materialId: r.material_id, name: r.name, filename: r.filename, version: r.version,
      page: r.page, visibility: r.visibility, uploadedBy: r.uploader_name, text: r.text, sourceUrl: r.source_url || null, score: Number((-r.rank).toFixed(3)),
    }));
  }

  return { reprocess, waitReady, pinnedIds, attachments, upload, setFolder, renameFolder, copyToPersonal, normFolder, list, get, filePath, remove, search, process, waitIdle, toPublic, publicVersion, pin, focusPassages, STATUS_LABEL };
}
module.exports = { createMaterials };
