'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { loadConfig } = require('./config');
const { make: makeLogger } = require('./lib/logger');
const { RateLimiter } = require('./lib/ratelimit');
const { HttpError, E } = require('./lib/errors');
const { openDb } = require('./db');
const { createAuth } = require('./auth/service');
const { loadSubjects } = require('./subjects/registry');
const { createProvider } = require('./ai');
const { ProviderError } = require('./ai/errors');
const { createAccess } = require('./projects/access');
const { createEvents } = require('./realtime/events');
const { createHub } = require('./realtime/hub');
const { createDesktop } = require('./desktop');
const { createMaterials } = require('./materials/service');
const { createTutor } = require('./engine/tutor');
const { createExplainer } = require('./engine/explain');
const { createProjects } = require('./projects/service');
const { createData } = require('./collab/data');
const { createJournal } = require('./collab/journal');
const { createContributions } = require('./collab/contributions');
const { createCrosschat } = require('./collab/crosschat');
const { createBlackbox } = require('./blackbox/service');
const { createChecks } = require('./blackbox/checks');
const { createPrivacy } = require('./privacy');
const { createWeb } = require('./web');
const { createTransfers } = require('./materials/transfers');
const { createProjectHub } = require('./projects/hub');
const { createPlanner } = require('./planner/service');
const { createBulletin } = require('./bulletin/service');
const { createRunner } = require('./tools/runner');

function createContext(over = {}) {
  const cfg = loadConfig(over.config || {});
  const log = over.logger || makeLogger(over.logLevel);
  const db = openDb(cfg.dbFile);
  let provider;
  try { provider = over.provider || createProvider(cfg.ai, over.fetch); } catch (e) {
    if (!(e instanceof ProviderError)) throw e; // configurazione IA incompleta: il server parte, le richieste al tutor restituiscono un errore comprensibile
    log.warn('provider IA non configurato', { code: e.code });
    provider = { name: cfg.ai.provider, model: cfg.ai.model, simulated: false, complete: async () => { throw e; } };
  }
  // Stato di salute del modello: aggiornato a ogni chiamata (spia della Dynamic Island)
  const aiHealth = { lastOkAt: 0, lastErrorAt: 0, lastErrorCode: null, probe: { at: 0, ok: true } };
  const rawComplete = provider.complete;
  provider.complete = async function wrapped(...args) {
    try { const r = await rawComplete.apply(provider, args); aiHealth.lastOkAt = Date.now(); return r; }
    catch (e) { aiHealth.lastErrorAt = Date.now(); aiHealth.lastErrorCode = e?.code || 'errore'; throw e; }
  };
  if (typeof provider.stream === 'function') { // lo streaming aggiorna la spia come complete(); un'interruzione voluta non è un errore
    const rawStream = provider.stream;
    provider.stream = async function wrappedStream(...args) {
      try { const r = await rawStream.apply(provider, args); if (!r?.aborted) aiHealth.lastOkAt = Date.now(); return r; }
      catch (e) { aiHealth.lastErrorAt = Date.now(); aiHealth.lastErrorCode = e?.code || 'errore'; throw e; }
    };
  }
  const ctx = { cfg, log, db, subjects: loadSubjects(), provider, aiHealth, aiNoDebounce: !!over.aiNoDebounce };
  // modello "vista": chiede al provider quale modello legge le immagini (in cache); `ready` serve all'upload, che è sincrono
  ctx.vision = {
    ready: false, name: null,
    async model() { try { const m = provider.visionModel ? await provider.visionModel() : null; ctx.vision.ready = !!m && typeof provider.vision === 'function'; ctx.vision.name = m || null; return ctx.vision.ready ? m : null; } catch { ctx.vision.ready = false; return null; } },
  };
  ctx.vision.model(); const vTimer = setInterval(() => ctx.vision.model(), 120_000); vTimer.unref();
  ctx.auth = createAuth(ctx);
  ctx.access = createAccess(ctx);
  ctx.events = createEvents(ctx);
  ctx.materials = createMaterials(ctx);
  ctx.projects = createProjects(ctx);
  ctx.data = createData(ctx);
  ctx.journal = createJournal(ctx);
  ctx.contributions = createContributions(ctx);
  ctx.blackbox = createBlackbox(ctx);
  ctx.checks = createChecks(ctx);
  ctx.crosschat = createCrosschat(ctx);
  ctx.collab = { contextForTurn: ctx.crosschat.contextForTurn, onTurnCompleted: ctx.contributions.onTurnCompleted, retractAllBy: ctx.contributions.retractAllBy };
  ctx.tutor = createTutor(ctx);
  ctx.explain = createExplainer(ctx);
  ctx.privacy = createPrivacy(ctx);
  ctx.hub = createHub(ctx);
  ctx.limiters = [];
  ctx.web = createWeb(ctx, over.web); ctx.links = ctx.web.links; // lettura link e ricerca web (protezioni in web/safe-fetch.js)
  ctx.transfers = createTransfers(ctx);
  ctx.projectHub = createProjectHub(ctx);
  ctx.planner = createPlanner(ctx);
  ctx.bulletin = createBulletin(ctx);
  ctx.runner = createRunner(ctx);
  // chi esce da un gruppo (o viene revocato): le offerte di trasferimento in sospeso in quel gruppo si annullano
  ctx.onMembershipEnded = (projectId, userId) => { try { ctx.transfers.dropFor(userId, projectId); } catch (e) { log.warn('trasferimenti', { err: e }); } };
  ctx.waitIdle = async () => { await ctx.materials.waitIdle(); await ctx.journal.waitIdle(); await ctx.blackbox.waitIdle(); };
  return ctx;
}

function createApp(over = {}) {
  const ctx = createContext(over);
  const { cfg, log } = ctx;
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  // ── Solo applicazione e server della classe (src/desktop.js) ──
  ctx.desktop = createDesktop(ctx);
  ctx.launchKey = ctx.desktop.launchKey;
  ctx.desktopGate = ctx.desktop.gate;
  ctx.desktop.mountPublic(app);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    });
    next();
  });
  const ipLimiter = new RateLimiter(cfg.limits.ipRequestsPerMin, 60_000); ctx.limiters.push(ipLimiter);
  app.use('/api', (req, _res, next) => (ipLimiter.allow(req.ip) ? next() : next(E.rate('Troppe richieste da questo dispositivo.', { retryAfterSec: ipLimiter.retryAfterSec(req.ip) }))));
  app.use(express.json({ limit: '200kb' }));

  ctx.desktop.mountApi(app);
  require('./routes/core')(app, ctx);
  require('./routes/collab')(app, ctx);
  require('./routes/features')(app, ctx);

  const pub = path.join(__dirname, '..', 'public');
  app.use('/vendor/katex', express.static(path.join(__dirname, '..', 'node_modules', 'katex', 'dist'), { maxAge: '7d' }));
  // worker del Live Code Runner (JavaScript): unico file a cui è concesso eval, senza rete né DOM
  app.get('/js/runner-worker.js', (_req, res, next) => { res.set('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-eval'"); next(); });
  app.use(express.static(pub, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  app.use('/api', (_req, _res, next) => next(E.notFound('Risorsa non trovata.')));
  app.get('*', (_req, res) => res.sendFile(path.join(pub, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.status === 429 && err.extra?.retryAfterSec) res.set('Retry-After', String(err.extra.retryAfterSec));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'troppo_grande', message: `Il file supera il limite di ${Math.round(cfg.limits.maxUploadBytes / 1048576)} MB.` } });
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: { code: 'richiesta_non_valida', message: 'Richiesta non valida.' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'troppo_grande', message: 'Richiesta troppo grande.' } });
    log.error('errore non gestito', { err, path: req.path });
    return res.status(500).json({ error: { code: 'errore_interno', message: 'Si è verificato un errore. Riprova; se continua avvisa il docente.' } });
  });

  const server = http.createServer(app);
  ctx.hub.attach(server);
  const timer = setInterval(() => { try { ctx.privacy.purgeExpired(); } catch (e) { log.error('retention', { err: e }); } }, 6 * 3600e3); timer.unref();
  const close = () => new Promise((res) => { clearInterval(timer); ctx.hub.close(); server.close(() => { try { ctx.db.close(); } catch { /* già chiuso */ } res(); }); server.closeAllConnections?.(); });
  return { app, server, ctx, close };
}
module.exports = { createApp, createContext };
