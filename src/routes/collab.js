'use strict';
// Route collaborative: progetti, inviti, membri, contributi, diario, decisioni, parametri, briefing, Scatola Nera, ricalcolo guidato.
// Ogni handler passa da un servizio che verifica l'appartenenza al progetto LATO SERVER: l'id nell'URL non basta mai.
const express = require('express');
const { E } = require('../lib/errors');
const { route, str } = require('./util');

module.exports = function collab(app, ctx) {
  const { auth, projects, contributions, journal, data, blackbox, checks, events, access, hub } = ctx;
  const r = express.Router(); r.use(auth.requireAuth);
  const pid = (req) => req.params.pid;

  // ── progetti, inviti, membri ──
  r.get('/projects', route((req) => ({ projects: projects.mine(req.user) })));
  r.post('/projects', route((req, res) => { const b = req.body || {}; res.status(201); return { project: projects.create(req.user, { name: b.name, subjectId: b.subjectId || null, requiresApproval: b.requiresApproval !== false, workstream: b.workstream }) }; }));
  r.post('/projects/join', route((req) => projects.redeem(req.user, str(req.body?.code, 'code', { min: 4, max: 20 }), { ip: req.ip, workstream: req.body?.workstream })));
  r.get('/projects/:pid', route((req) => projects.overview(req.user, pid(req), hub.onlineSet(pid(req)))));
  r.patch('/projects/:pid', route((req) => ({ project: projects.updateSettings(req.user, pid(req), req.body || {}) })));
  r.post('/projects/:pid/invites', route((req, res) => { res.status(201); return projects.createInvite(req.user, pid(req), req.body || {}); }));
  r.post('/projects/:pid/invites/regenerate', route((req, res) => { res.status(201); return projects.regenerateInvite(req.user, pid(req), req.body || {}); }));
  r.get('/projects/:pid/invites', route((req) => ({ invites: projects.listInvites(req.user, pid(req)) })));
  r.delete('/projects/:pid/invites/:iid', route((req) => { projects.revokeInvite(req.user, pid(req), req.params.iid); return { ok: true }; }));
  r.post('/projects/:pid/members/:uid/approve', route((req) => { projects.decide(req.user, pid(req), req.params.uid, true); return { ok: true }; }));
  r.post('/projects/:pid/members/:uid/reject', route((req) => { projects.decide(req.user, pid(req), req.params.uid, false); return { ok: true }; }));
  r.post('/projects/:pid/members/:uid/revoke', route((req) => { projects.revokeMember(req.user, pid(req), req.params.uid); return { ok: true, note: 'L\'accesso futuro è interrotto. Eventuali copie già scaricate dal partecipante non possono essere eliminate automaticamente.' }; }));
  r.post('/projects/:pid/leave', route((req) => { projects.leave(req.user, pid(req), { retractContributions: !!req.body?.retractContributions }); return { ok: true }; }));
  r.patch('/projects/:pid/me', route((req) => { projects.setMyProfile(req.user, pid(req), { workstream: req.body?.workstream }); return { ok: true }; }));
  // Recupero degli eventi mancanti anche senza WebSocket (stessi dati, stesso controllo di appartenenza)
  r.get('/projects/:pid/events', route((req) => { access.requireMember(req.user, pid(req)); const after = Math.max(0, parseInt(req.query.after, 10) || 0); const list = events.since(pid(req), after, 500); return { events: list, lastSeq: events.lastSeq(pid(req)), resync: list.length >= 500 }; }));

  // ── contributi condivisi / cross-chat ──
  r.get('/projects/:pid/contributions', route((req) => ({ contributions: contributions.list(req.user, pid(req), { mine: req.query.mine === '1' }) })));
  r.patch('/projects/:pid/contributions/:cid', route((req) => ({ contribution: contributions.update(req.user, pid(req), req.params.cid, req.body || {}) })));
  r.post('/projects/:pid/contributions/:cid/retract', route((req) => { contributions.retract(req.user, pid(req), req.params.cid); return { ok: true }; }));
  r.put('/projects/:pid/auto-share', route((req) => contributions.setAutoShare(req.user, pid(req), { enabled: !!req.body?.enabled, consent: req.body?.consent })));
  r.post('/projects/:pid/share-requests', route((req, res) => { res.status(201); return contributions.requestShare(req.user, pid(req), req.body || {}); }));
  r.get('/projects/:pid/share-requests', route((req) => ({ requests: contributions.listRequests(req.user, pid(req)) })));
  r.post('/projects/:pid/share-requests/:rid/respond', route((req) => contributions.respondRequest(req.user, pid(req), req.params.rid, !!req.body?.accept)));

  // ── diario di bordo (Eco di Gruppo) e briefing ──
  r.get('/projects/:pid/journal', route((req) => ({ items: journal.list(req.user, pid(req), { type: req.query.type, status: req.query.status }), types: journal.TYPES, statuses: journal.STATUS })));
  r.post('/projects/:pid/journal', route((req, res) => { res.status(201); return { item: journal.addItem(req.user, pid(req), req.body || {}) }; }));
  r.post('/projects/:pid/journal/:iid/confirm', route((req) => ({ item: journal.confirm(req.user, pid(req), req.params.iid, req.body || {}) })));
  r.post('/projects/:pid/journal/:iid/correct', route((req) => ({ item: journal.correct(req.user, pid(req), req.params.iid, req.body || {}) })));
  r.post('/projects/:pid/journal/:iid/contest', route((req) => ({ item: journal.contest(req.user, pid(req), req.params.iid, req.body || {}) })));
  r.post('/projects/:pid/journal/:iid/resolve', route((req) => ({ item: journal.resolveProblem(req.user, pid(req), req.params.iid, req.body || {}) })));
  r.get('/projects/:pid/journal/:iid/history', route((req) => journal.history(req.user, pid(req), req.params.iid)));
  r.get('/projects/:pid/briefing', route((req) => journal.briefing(req.user, pid(req), { markSeen: req.query.markSeen !== '0' })));

  // ── decisioni e parametri ──
  r.get('/projects/:pid/decisions', route((req) => ({ decisions: data.listDecisions(req.user, pid(req), { status: req.query.status }) })));
  r.post('/projects/:pid/decisions', route((req, res) => { res.status(201); return { decision: data.proposeDecision(req.user, pid(req), req.body || {}) }; }));
  r.post('/projects/:pid/decisions/:did/confirm', route((req) => ({ decision: data.confirmDecision(req.user, pid(req), req.params.did, req.body || {}) })));
  r.post('/projects/:pid/decisions/:did/revise', route((req) => ({ decision: data.reviseDecision(req.user, pid(req), req.params.did, req.body || {}) })));
  r.post('/projects/:pid/decisions/:did/withdraw', route((req) => { data.withdrawDecision(req.user, pid(req), req.params.did); return { ok: true }; }));
  r.get('/projects/:pid/decisions/:did/history', route((req) => ({ history: data.decisionHistory(req.user, pid(req), req.params.did) })));
  r.get('/projects/:pid/parameters', route((req) => ({ parameters: data.listParameters(req.user, pid(req), { includeSuperseded: req.query.all === '1' }) })));
  r.post('/projects/:pid/parameters', route((req, res) => { res.status(201); return data.addParameter(req.user, pid(req), req.body || {}); }));
  r.delete('/projects/:pid/parameters/:id', route((req) => { data.retireParameter(req.user, pid(req), req.params.id); return { ok: true }; }));

  // ── Scatola Nera ──
  r.get('/projects/:pid/alerts', route((req) => ({ alerts: blackbox.list(req.user, pid(req), { status: req.query.status }) })));
  r.post('/projects/:pid/analyze', route((req) => { access.requireMember(req.user, pid(req)); return blackbox.analyze(pid(req)); }));
  r.get('/projects/:pid/alerts/:aid/sources', route((req) => blackbox.sources(req.user, pid(req), req.params.aid)));
  r.post('/projects/:pid/alerts/:aid/false-positive', route((req) => ({ alert: blackbox.markFalsePositive(req.user, pid(req), req.params.aid, req.body || {}) })));
  r.post('/projects/:pid/alerts/:aid/resolve', route((req) => blackbox.resolve(req.user, pid(req), req.params.aid, req.body || {})));
  r.post('/projects/:pid/alerts/:aid/guide', route((req) => ({ check: checks.start(req.user, pid(req), req.params.aid) })));
  r.post('/projects/:pid/alerts/:aid/missing-data', route((req, res) => { // "Aggiungi il dato mancante": inserisce un parametro e rilancia i controlli
    blackbox.getAlert(pid(req), req.params.aid); res.status(201); return data.addParameter(req.user, pid(req), req.body || {});
  }));
  r.get('/projects/:pid/checks/:cid', route((req) => ({ check: checks.get(req.user, pid(req), req.params.cid) })));
  r.post('/projects/:pid/checks/:cid/answer', route((req) => ({ check: checks.answer(req.user, pid(req), req.params.cid, req.body || {}) })));
  r.post('/projects/:pid/checks/:cid/hint', route((req) => ({ check: checks.hint(req.user, pid(req), req.params.cid) })));

  app.use('/api', r);
};
