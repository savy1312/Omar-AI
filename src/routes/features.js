'use strict';
// Route delle funzioni di organizzazione: trasferimenti tra dispositivi collegati, Hub di progetto (Kanban, asset, relazione PDF),
// Planner (scadenze e suggeritore di studio), Bacheca (circolari e avvisi), feed della sessione e Live Code Runner.
const express = require('express');
const { RateLimiter } = require('../lib/ratelimit');
const { E } = require('../lib/errors');
const { route, str } = require('./util');

module.exports = function features(app, ctx) {
  const { auth, transfers, projectHub, planner, bulletin, runner } = ctx;
  const r = express.Router(); r.use(auth.requireAuth);
  const xfLimiter = new RateLimiter(20, 10 * 60_000); ctx.limiters.push(xfLimiter);
  const pdfLimiter = new RateLimiter(6, 60_000); ctx.limiters.push(pdfLimiter);
  const proposeLimiter = new RateLimiter(6, 60_000); ctx.limiters.push(proposeLimiter);
  const limit = (lim, key, msg) => { if (!lim.allow(key)) throw E.rate(msg, { retryAfterSec: lim.retryAfterSec(key) }); };

  // ── trasferimenti tra dispositivi collegati ──
  r.post('/projects/:pid/transfers', route((req, res) => { limit(xfLimiter, req.user.id, 'Stai inviando molti file: riprova tra qualche minuto.'); res.status(201); return { transfer: transfers.create(req.user, req.params.pid, req.body || {}) }; }));
  r.get('/transfers', route((req) => ({ transfers: transfers.list(req.user), pendingIn: transfers.pendingCount(req.user) })));
  r.post('/transfers/:id/accept', route((req) => transfers.accept(req.user, req.params.id)));
  r.post('/transfers/:id/decline', route((req) => ({ transfer: transfers.decline(req.user, req.params.id) })));
  r.post('/transfers/:id/cancel', route((req) => ({ transfer: transfers.cancel(req.user, req.params.id) })));

  // ── Hub di progetto: Kanban ──
  r.get('/projects/:pid/tasks', route((req) => projectHub.listTasks(req.user, req.params.pid)));
  r.post('/projects/:pid/tasks', route((req, res) => { res.status(201); return { task: projectHub.createTask(req.user, req.params.pid, req.body || {}) }; }));
  r.patch('/projects/:pid/tasks/:tid', route((req) => ({ task: projectHub.updateTask(req.user, req.params.pid, req.params.tid, req.body || {}) })));
  r.delete('/projects/:pid/tasks/:tid', route((req) => projectHub.deleteTask(req.user, req.params.pid, req.params.tid)));
  r.post('/projects/:pid/tasks/propose', route(async (req) => { limit(proposeLimiter, req.user.id, 'Attendi qualche secondo prima di chiedere nuove proposte.'); return projectHub.proposeTasks(req.user, req.params.pid, { useAI: req.body?.useAI !== false }); }));
  // ── Asset Manager ──
  r.get('/projects/:pid/assets', route((req) => projectHub.listAssets(req.user, req.params.pid)));
  r.post('/projects/:pid/snippets', route((req, res) => { res.status(201); return { snippet: projectHub.createSnippet(req.user, req.params.pid, req.body || {}) }; }));
  r.patch('/projects/:pid/snippets/:sid', route((req) => ({ snippet: projectHub.updateSnippet(req.user, req.params.pid, req.params.sid, req.body || {}) })));
  r.delete('/projects/:pid/snippets/:sid', route((req) => projectHub.deleteSnippet(req.user, req.params.pid, req.params.sid)));
  r.post('/projects/:pid/assets/harvest', route((req) => projectHub.harvest(req.user, req.params.pid)));
  // ── Relazione tecnica in PDF ──
  r.get('/projects/:pid/report.pdf', (req, res, next) => {
    try {
      limit(pdfLimiter, req.user.id, 'Hai generato molte relazioni: attendi un minuto.');
      const sections = typeof req.query.sections === 'string' && req.query.sections ? req.query.sections.split(',').slice(0, 10) : undefined;
      const out = projectHub.buildReport(req.user, req.params.pid, { sections });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(out.filename)}`, 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Pages': String(out.pages) });
      res.send(out.buffer);
    } catch (e) { next(e); }
  });
  // ── feed della sessione ──
  r.get('/feed', route((req) => projectHub.feed(req.user, { projectId: req.query.projectId || null, limit: Math.min(80, parseInt(req.query.limit, 10) || 40) })));

  // ── Planner ──
  r.get('/planner', route((req) => ({ ...planner.plan(req.user), deadlines: planner.visible(req.user), kinds: planner.KINDS })));
  r.post('/planner/deadlines', route((req, res) => { res.status(201); return { deadline: planner.create(req.user, req.body || {}) }; }));
  r.patch('/planner/deadlines/:id', route((req) => ({ deadline: planner.update(req.user, req.params.id, req.body || {}) })));
  r.delete('/planner/deadlines/:id', route((req) => planner.remove(req.user, req.params.id)));
  r.put('/planner/deadlines/:id/progress', route((req) => ({ deadline: planner.setProgress(req.user, req.params.id, req.body || {}) })));
  r.put('/planner/prefs', route((req) => ({ prefs: planner.setPrefs(req.user, req.body || {}) })));
  r.get('/projects/:pid/planner', route((req) => planner.groupBoard(req.user, req.params.pid)));

  // ── Bacheca ──
  r.get('/bulletins', route((req) => bulletin.list(req.user, { kind: req.query.kind || null, q: req.query.q || '', includeExpired: req.query.all === '1' })));
  r.get('/bulletins/unread', route((req) => ({ unread: bulletin.unreadCount(req.user) })));
  r.post('/bulletins', route((req, res) => { res.status(201); return { bulletin: bulletin.create(req.user, req.body || {}) }; }));
  r.patch('/bulletins/:id', route((req) => ({ bulletin: bulletin.update(req.user, req.params.id, req.body || {}) })));
  r.delete('/bulletins/:id', route((req) => bulletin.remove(req.user, req.params.id)));
  r.post('/bulletins/:id/read', route((req) => bulletin.markRead(req.user, req.params.id, req.body?.read !== false)));
  r.post('/bulletins/read-all', route((req) => bulletin.markAllRead(req.user)));
  r.post('/bulletins/draft-from-url', route(async (req) => ({ draft: await bulletin.draftFromUrl(req.user, str(req.body?.url, 'url', { min: 8, max: 2000 })) })));

  // ── Quick Tools: Live Code Runner (Python/C++ sul server solo se acceso) ──
  r.get('/tools/runner', route(() => runner.info()));
  r.post('/tools/run', route(async (req) => runner.run(req.user, req.body || {})));

  app.use('/api', r);
};
