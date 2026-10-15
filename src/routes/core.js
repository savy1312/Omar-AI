'use strict';
// Route "core": informazioni, autenticazione, materie, sessioni di chat, materiali, area docente, privacy.
const express = require('express');
const multer = require('multer');
const { E, HttpError } = require('../lib/errors');
const { now, uuid } = require('../lib/util');
const { RateLimiter } = require('../lib/ratelimit');
const { route, str, fixName } = require('./util');
const { formatList } = require('../materials/extract');

module.exports = function core(app, ctx) {
  const { cfg, auth, tutor, materials, subjects, db } = ctx;
  const api = express.Router();
  const need = auth.requireAuth;
  const teacher = auth.requireRole('teacher', 'admin');
  const loginLimiter = new RateLimiter(10, 5 * 60_000); ctx.limiters.push(loginLimiter);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.limits.maxUploadBytes, files: 1, fields: 12 } });

  // ───── informazioni pubbliche (trasparenza su provider e dati) ─────
  api.get('/info', route(async () => (await ctx.vision.model(), {
    name: 'Omar AI',
    ai: { provider: ctx.provider.name, model: ctx.provider.simulated ? null : ctx.provider.model, simulated: !!ctx.provider.simulated, dataLeavesNetwork: cfg.ai.dataLeavesNetwork,
      notice: ctx.provider.simulated ? 'MODALITÀ SIMULAZIONE: le risposte non sono generate da un modello IA.' : cfg.ai.dataLeavesNetwork ? 'Le domande vengono elaborate da un provider IA esterno alla rete scolastica.' : 'Il modello IA è raggiungibile solo dalla rete locale.' },
    sync: 'La sincronizzazione tra dispositivi avviene tramite il server della scuola nella rete locale; l\'elaborazione IA dipende dal provider indicato sopra.',
    registrationOpen: cfg.auth.openRegistration || !!cfg.auth.studentCode, studentEmailDomain: cfg.auth.studentEmailDomain || null,
    capabilities: { formats: formatList({ vision: ctx.vision.ready }), anyFile: true, imageAnalysis: ctx.vision.ready, visionModel: ctx.vision.ready ? ctx.vision.name : null, cadAnalysis: true, ocr: ctx.vision.ready },
    web: { // cosa può fare il tutor con internet: dichiarato apertamente (e cosa NON può)
      links: { enabled: !!ctx.links.enabled },
      search: { enabled: ctx.web.search.enabled, provider: ctx.web.search.enabled ? ctx.web.search.provider : null, label: ctx.web.search.label,
        notice: ctx.web.search.enabled ? `Con «Cerca» attivo, la tua domanda (senza link né dati personali evidenti) viene inviata a ${ctx.web.search.label}, un servizio esterno alla scuola.` : 'La ricerca sul web non è attiva su questo server.' },
    },
    auth: { minPasswordLength: cfg.auth.minPasswordLength },
    limits: { maxUploadMb: Math.round(cfg.limits.maxUploadBytes / 1048576), maxMessageChars: cfg.limits.maxMessageChars, retentionChatDays: cfg.retention.chatDays },
  })));

  // ───── stato di salute (spia della Dynamic Island): nessun dettaglio tecnico verso il client ─────
  api.get('/health', route(async () => {
    const h = ctx.aiHealth; const t = Date.now(); let ok = true; let why = null;
    if (ctx.provider.simulated) return { ok: true, ai: { state: 'simulazione', ok: true } };
    if (typeof ctx.provider.probe === 'function') {
      if (t - h.probe.at > 8000) { h.probe = { at: t, ok: await ctx.provider.probe() }; }
      if (!h.probe.ok) { ok = false; why = 'Il modello IA non risponde (controlla che sia avviato).'; }
    }
    if (ok && h.lastErrorAt > h.lastOkAt && t - h.lastErrorAt < 120_000) { ok = false; why = 'L\'ultima richiesta al modello IA non è riuscita.'; }
    return { ok, ai: { state: ok ? 'ok' : 'errore', ok, message: why } };
  }));

  // ───── autenticazione ─────
  api.post('/auth/register', route((req) => {
    const k = `reg:${req.ip}`; if (!loginLimiter.allow(k)) throw E.rate('Troppi tentativi. Riprova tra qualche minuto.', { retryAfterSec: loginLimiter.retryAfterSec(k) });
    const u = auth.register(req.body || {});
    return auth.login(u.username, req.body.password, { userAgent: req.headers['user-agent'] }); // { token, user }
  }));
  api.post('/auth/login', route((req) => {
    const k = `login:${req.ip}:${String(req.body?.username || '').toLowerCase()}`;
    if (!loginLimiter.check(k)) throw E.rate('Troppi tentativi di accesso. Riprova tra qualche minuto.', { retryAfterSec: loginLimiter.retryAfterSec(k) });
    try { return auth.login(req.body?.username, req.body?.password, { userAgent: req.headers['user-agent'] }); } catch (e) { loginLimiter.hit(k); throw e; }
  }));
  api.post('/auth/logout', need, route((req) => { auth.logout(req.token); return { ok: true }; }));
  api.get('/me', need, route((req) => ({ user: req.user, projects: ctx.projects.mine(req.user), pending: ctx.projects.pendingMine(req.user) })));

  // ───── account (pagina dedicata #/account) ─────
  const pwdLimiter = new RateLimiter(5, 10 * 60_000); ctx.limiters.push(pwdLimiter);
  api.get('/account', need, route((req) => auth.accountInfo(req.user, req.token)));
  api.patch('/account', need, route((req) => ({ user: auth.updateProfile(req.user, req.body || {}) })));
  api.post('/account/password', need, route((req) => {
    const k = `pwd:${req.user.id}`; if (!pwdLimiter.check(k)) throw E.rate('Troppi tentativi di cambio password. Riprova tra qualche minuto.', { retryAfterSec: pwdLimiter.retryAfterSec(k) });
    try { const r = auth.changePassword(req.user, req.token, req.body || {}); ctx.access.audit(req.user.id, null, 'account.password', { closed: r.closedSessions }); return r; }
    catch (e) { if (e.code === 'password_errata') pwdLimiter.hit(k); throw e; }
  }));
  api.delete('/account/sessions/:id', need, route((req) => auth.revokeSession(req.user, req.token, req.params.id)));
  api.post('/account/sessions/revoke-others', need, route((req) => ({ ok: true, closed: auth.revokeOthers(req.user, req.token) })));
  api.get('/subjects', need, route(() => ({ subjects: subjects.list(), modes: [
    { id: 'spiega', label: 'Spiegami un concetto', description: 'Spiegazione chiara con analogia ed esempio, poi una domanda di verifica.' },
    { id: 'esercizio', label: 'Guidami in un esercizio', description: 'Ti guido passo per passo, senza darti la soluzione.' },
    { id: 'verifica', label: 'Verifica la mia comprensione', description: 'Una domanda alla volta, con feedback sul ragionamento.' },
    { id: 'ripasso', label: 'Ripasso guidato', description: 'Ripasso dei punti chiave con brevi domande di richiamo.' }],
    levels: [{ id: 'base', label: 'Base' }, { id: 'intermedio', label: 'Intermedio' }, { id: 'avanzato', label: 'Avanzato' }] })));

  // ───── sessioni di chat (SOLO le proprie) ─────
  api.post('/sessions', need, route((req, res) => { res.status(201); return { session: tutor.createSession(req.user, req.body || {}) }; }));
  api.get('/sessions', need, route((req) => ({ sessions: tutor.listSessions(req.user) })));
  api.get('/sessions/:id', need, route((req) => tutor.getSession(req.user, req.params.id)));
  api.patch('/sessions/:id', need, route((req) => ({ session: tutor.updateSession(req.user, req.params.id, req.body || {}) })));
  api.delete('/sessions/:id', need, route((req) => { tutor.deleteSession(req.user, req.params.id); return { ok: true }; }));
  api.post('/sessions/:id/messages', need, route(async (req) => tutor.turn(req.user, req.params.id, { text: req.body?.text, action: req.body?.action || null, useMaterials: req.body?.useMaterials !== false, useWeb: req.body?.useWeb === true, useLinks: req.body?.useLinks !== false })));
  // Stessa cosa di POST /messages, ma la risposta arriva IN STREAMING (Server-Sent Events) mentre il modello scrive.
  // Eventi: start · phase · context · delta · replace · done · error. Gli errori PRIMA dell'inizio (sessione inesistente, limiti, messaggio vuoto)
  // restano normali risposte JSON con il loro codice HTTP. Se il browser chiude la connessione (pulsante Stop) il modello viene interrotto.
  api.post('/sessions/:id/messages/stream', need, async (req, res, next) => {
    let started = false; let finished = false; let beat = null; const ac = new AbortController();
    const send = (type, data) => {
      if (res.writableEnded || res.destroyed) return;
      if (!started) {
        started = true; res.socket?.setNoDelay?.(true);
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' });
        res.write(': omar\n\n'); beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000); // segnale di vita: i proxy non chiudono una richiesta lenta
      }
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.on('close', () => { clearInterval(beat); if (!finished) ac.abort(); });
    const b = req.body || {};
    try {
      const r = await tutor.turn(req.user, req.params.id, { text: b.text, action: b.action || null, useMaterials: b.useMaterials !== false, useWeb: b.useWeb === true, useLinks: b.useLinks !== false, onEvent: send, signal: ac.signal });
      finished = true; if (r) send('done', r);
      clearInterval(beat); if (started) res.end(); else res.status(204).end();
    } catch (e) {
      finished = true; clearInterval(beat);
      if (!started) return next(e);
      const known = e instanceof HttpError;
      if (!known) ctx.log.error('errore nello streaming', { err: e });
      send('error', { error: known ? { code: e.code, message: e.message, ...e.extra } : { code: 'errore_interno', message: 'Si è verificato un errore. Riprova; se continua avvisa il docente.' } });
      res.end();
    }
  });
  // Allega alla chat un materiale già caricato (così «spiegami questo documento» funziona anche senza ripetere le parole del testo)
  api.post('/sessions/:id/materials', need, route((req) => { materials.pin(req.user, req.params.id, str(req.body?.materialId, 'materialId', { min: 8, max: 64 })); return { ok: true }; }));
  api.patch('/sessions/:id/messages/:mid', need, route((req) => { tutor.setShareExcluded(req.user, req.params.id, req.params.mid, !!req.body?.shareExcluded); return { ok: true }; }));
  // Condivisione ESPLICITA di un messaggio o di una sintesi verso un progetto
  api.post('/sessions/:id/messages/:mid/share', need, route((req) => ({ contribution: ctx.contributions.share(req.user, str(req.body?.projectId, 'projectId'), { sessionId: req.params.id, messageId: req.params.mid, kind: 'messaggio' }) })));
  api.post('/sessions/:id/share-summary', need, route((req) => ({ contribution: ctx.contributions.share(req.user, str(req.body?.projectId, 'projectId'), { sessionId: req.params.id, kind: 'sintesi', content: req.body?.content }) })));

  // ───── «Spiegami questo»: spiega o traduce il testo selezionato (non viene salvato) ─────
  api.post('/explain', need, route(async (req) => ctx.explain.explain(req.user, { text: req.body?.text, action: req.body?.action, targetLang: req.body?.targetLang, simpler: !!req.body?.simpler, subjectId: req.body?.subjectId })));
  api.get('/explain/languages', need, route(() => ({ languages: Object.entries(ctx.explain.LANGS).map(([id, name]) => ({ id, name })) })));

  // ───── link: il server legge la pagina e ne fa un materiale citabile dal tutor ─────
  api.post('/links/import', need, route(async (req, res) => {
    const b = req.body || {};
    const r = await ctx.links.importUrl(req.user, { url: b.url, visibility: b.visibility || 'personale', projectId: b.projectId || null, subjectId: b.subjectId || null, sessionId: b.sessionId || null });
    res.status(r.reused ? 200 : 201); return r;
  }));

  // ───── materiali ─────
  const handleUpload = (req, res, next) => upload.single('file')(req, res, (err) => (err ? next(err) : next()));
  api.post('/materials', need, handleUpload, route((req, res) => {
    if (!req.file) throw E.bad('Nessun file ricevuto.');
    const b = req.body || {};
    const m = materials.upload({ user: req.user, file: { originalname: fixName(req.file.originalname), buffer: req.file.buffer }, visibility: b.visibility, projectId: b.projectId || null, subjectId: b.subjectId || null, topicId: b.topicId || null, name: b.name || undefined, materialId: b.materialId || undefined, expectedVersion: b.expectedVersion, folder: b.folder || null });
    if (b.sessionId) materials.pin(req.user, String(b.sessionId), m.materialId);
    res.status(201); return { material: m };
  }));
  api.post('/materials/:id/versions', need, handleUpload, route((req, res) => {
    if (!req.file) throw E.bad('Nessun file ricevuto.');
    const m = materials.upload({ user: req.user, file: { originalname: fixName(req.file.originalname), buffer: req.file.buffer }, visibility: 'x', materialId: req.params.id, expectedVersion: req.body?.expectedVersion });
    res.status(201); return { material: m };
  }));
  api.get('/materials', need, route((req) => ({ materials: materials.list(req.user, { scope: req.query.scope || 'corso', projectId: req.query.projectId, subjectId: req.query.subjectId, topicId: req.query.topicId }) })));
  api.get('/materials/:id', need, route((req) => ({ material: materials.toPublic(materials.get(req.user, req.params.id), req.user) })));
  api.get('/materials/:id/file', need, (req, res, next) => {
    try {
      const f = materials.filePath(req.user, req.params.id);
      const inline = ['pdf', 'immagine'].includes(f.kind);
      res.set({ 'Content-Type': f.mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
      res.sendFile(f.path);
    } catch (e) { next(e); }
  });
  api.patch('/materials/:id', need, route((req) => materials.setFolder(req.user, req.params.id, req.body?.folder ?? null)));
  api.post('/materials-folders/rename', need, route((req) => materials.renameFolder(req.user, { scope: req.body?.scope, projectId: req.body?.projectId || null, from: req.body?.from, to: req.body?.to || null })));
  api.post('/materials/:id/reprocess', need, route(async (req) => ({ material: await materials.reprocess(req.user, req.params.id) })));
  api.get('/sessions/:id/attachments', need, route((req) => { tutor.getSession(req.user, req.params.id); return { attachments: materials.attachments(req.user, req.params.id) }; }));
  api.delete('/sessions/:id/materials/:mid', need, route((req) => { tutor.getSession(req.user, req.params.id); db.run('DELETE FROM session_materials WHERE session_id = ? AND material_id = ?', req.params.id, req.params.mid); return { ok: true }; }));
  api.delete('/materials/:id', need, route((req) => { materials.remove(req.user, req.params.id); return { ok: true }; }));

  // ───── area docente (permessi separati dall'area studente) ─────
  const T = express.Router(); T.use(need, teacher);
  T.get('/objectives', route((req) => ({ objectives: db.all('SELECT * FROM learning_objectives WHERE (? IS NULL OR subject_id = ?) ORDER BY created_at DESC', req.query.subjectId || null, req.query.subjectId || null).map((o) => ({ id: o.id, subjectId: o.subject_id, topicId: o.topic_id, text: o.text, createdAt: o.created_at })) })));
  T.post('/objectives', route((req, res) => {
    const { subjectId, topicId } = req.body || {}; const text = str(req.body?.text, 'text', { min: 5, max: 400 });
    if (!subjects.get(subjectId)) throw E.bad('Materia non valida.'); if (topicId && !subjects.hasTopic(subjectId, topicId)) throw E.bad('Argomento non valido.');
    const id = uuid(); db.run('INSERT INTO learning_objectives (id, subject_id, topic_id, text, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, subjectId, topicId || null, text, req.user.id, now(), now());
    res.status(201); return { id };
  }));
  T.put('/objectives/:id', route((req) => { const r = db.run('UPDATE learning_objectives SET text = ?, updated_at = ? WHERE id = ?', str(req.body?.text, 'text', { min: 5, max: 400 }), now(), req.params.id); if (!r.changes) throw E.notFound('Obiettivo non trovato.'); return { ok: true }; }));
  T.delete('/objectives/:id', route((req) => { db.run('DELETE FROM learning_objectives WHERE id = ?', req.params.id); return { ok: true }; }));
  T.get('/materials', route((req) => ({ materials: materials.list(req.user, { scope: 'corso', subjectId: req.query.subjectId, topicId: req.query.topicId }) })));
  T.get('/overview', route(() => ({ // solo conteggi aggregati: i docenti NON leggono le chat personali degli studenti
    materialiCorso: db.get("SELECT COUNT(*) n FROM materials WHERE visibility = 'corso' AND deleted_at IS NULL").n,
    obiettivi: db.get('SELECT COUNT(*) n FROM learning_objectives').n,
    utenti: db.all("SELECT role, COUNT(*) n FROM users WHERE deleted_at IS NULL GROUP BY role"),
    note: 'Per tutela della privacy il docente non ha accesso alle conversazioni personali degli studenti; vede solo ciò che gli studenti condividono nei progetti a cui il docente partecipa.',
  })));
  api.use('/teacher', T);

  // ───── privacy ─────
  api.get('/me/export', need, route((req) => ctx.privacy.exportMyData(req.user)));
  api.delete('/me/sessions', need, route((req) => ctx.privacy.deleteMyChats(req.user)));
  api.delete('/me/data', need, route((req) => ctx.privacy.deleteMyData(req.user, { confirm: req.body?.confirm })));

  app.use('/api', api);
  ctx.apiRouter = api;
};
