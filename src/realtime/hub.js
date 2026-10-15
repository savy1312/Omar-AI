'use strict';
// Hub WebSocket.
// Protocollo (JSON):
//   client -> {type:'auth', token}                      (entro 5 s dalla connessione; il token NON passa dall'URL)
//   client -> {type:'subscribe', projectId, lastSeq}    (recupero degli eventi mancanti + flusso live)
//   client -> {type:'unsubscribe', projectId} | {type:'ping'}
//   server -> {type:'ready'} | {type:'subscribed', projectId, replayed, lastSeq, resync}
//   server -> {type:'event', event:{seq,eventId,type,...}} | {type:'presence', projectId, online:[userId]}
//   server -> {type:'unsubscribed', projectId, reason} | {type:'error', code, message}
// Garanzie: la membership è RICONTROLLATA a ogni consegna; i revocati escono subito. Il client deduplica per seq.
const { WebSocketServer } = require('ws');

const MANAGER_ONLY = new Set(['member.pending', 'member.rejected']);
const MAX_SOCKETS_PER_USER = 6;

function createHub(ctx) {
  const { auth, access, events, log } = ctx;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Set(); // { ws, user, subs:Set<projectId> }

  const send = (c, obj) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); };
  const onlineSet = (projectId) => { const s = new Set(); for (const c of clients) if (c.user && c.subs.has(projectId)) s.add(c.user.id); return s; };
  const broadcastPresence = (projectId) => {
    const online = [...onlineSet(projectId)];
    for (const c of clients) if (c.user && c.subs.has(projectId)) send(c, { type: 'presence', projectId, online });
  };

  function deliver(ev) {
    // prima chiude le iscrizioni di chi è uscito/revocato (con il motivo specifico), poi consegna agli altri
    const ended = ['member.left', 'member.revoked'].includes(ev.type);
    if (ended) {
      for (const c of clients) if (c.user?.id === ev.entityId && c.subs.delete(ev.projectId)) send(c, { type: 'unsubscribed', projectId: ev.projectId, reason: ev.type === 'member.revoked' ? 'revocato' : 'uscito' });
    }
    for (const c of clients) {
      if (!c.user || !c.subs.has(ev.projectId)) continue;
      const m = access.membership(c.user.id, ev.projectId);
      if (!m) { c.subs.delete(ev.projectId); send(c, { type: 'unsubscribed', projectId: ev.projectId, reason: 'accesso_terminato' }); continue; }
      if (MANAGER_ONLY.has(ev.type) && !['owner', 'teacher'].includes(m.role)) continue;
      send(c, { type: 'event', event: ev });
    }
    if (ended) broadcastPresence(ev.projectId);
  }
  events.subscribe(deliver);

  function handle(c, msg) {
    if (msg.type === 'ping') return send(c, { type: 'pong' });
    if (msg.type === 'auth') {
      const u = auth.authenticate(String(msg.token || ''));
      if (!u) { send(c, { type: 'error', code: 'non_autenticato', message: 'Accesso richiesto.' }); return c.ws.close(4401); }
      const mine = [...clients].filter((x) => x.user?.id === u.id).length;
      if (mine >= MAX_SOCKETS_PER_USER) { send(c, { type: 'error', code: 'troppe_connessioni', message: 'Troppe connessioni aperte.' }); return c.ws.close(4429); }
      c.user = u; c.tokenHash = auth.tokenHash(String(msg.token)); clearTimeout(c.authTimer); return send(c, { type: 'ready' });
    }
    if (!c.user) { send(c, { type: 'error', code: 'non_autenticato', message: 'Invia prima il token.' }); return c.ws.close(4401); }
    if (msg.type === 'subscribe') {
      const pid = String(msg.projectId || '');
      if (!access.membership(c.user.id, pid)) return send(c, { type: 'error', code: 'non_autorizzato', message: 'Progetto non trovato o accesso non consentito.', projectId: pid });
      c.subs.add(pid); // registrazione e replay avvengono nello stesso tick: nessun evento può inserirsi nel mezzo
      const last = Number.isFinite(+msg.lastSeq) ? +msg.lastSeq : 0;
      const missed = events.since(pid, last, 500);
      const m = access.membership(c.user.id, pid);
      for (const ev of missed) if (!(MANAGER_ONLY.has(ev.type) && !['owner', 'teacher'].includes(m.role))) send(c, { type: 'event', event: ev, replay: true });
      send(c, { type: 'subscribed', projectId: pid, replayed: missed.length, lastSeq: events.lastSeq(pid), resync: missed.length >= 500 });
      return broadcastPresence(pid);
    }
    if (msg.type === 'unsubscribe') { const pid = String(msg.projectId || ''); if (c.subs.delete(pid)) broadcastPresence(pid); }
  }

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let path; try { path = new URL(req.url, 'http://x').pathname; } catch { path = ''; }
      if (path !== '/ws') return socket.destroy();
      if (ctx.desktopGate && !ctx.desktopGate(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
      const origin = req.headers.origin; // contro il cross-site WebSocket hijacking
      if (origin) { let h; try { h = new URL(origin).host; } catch { h = ''; } if (h !== req.headers.host) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); } }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const c = { ws, user: null, subs: new Set(), alive: true, count: 0, windowStart: Date.now() };
        clients.add(c);
        c.authTimer = setTimeout(() => { if (!c.user) ws.close(4401); }, 5000);
        ws.on('pong', () => { c.alive = true; });
        ws.on('message', (data) => {
          const t = Date.now(); if (t - c.windowStart > 10_000) { c.windowStart = t; c.count = 0; }
          if (++c.count > 100) return ws.close(4429);
          let msg; try { msg = JSON.parse(data.toString()); } catch { return send(c, { type: 'error', code: 'richiesta_non_valida', message: 'Messaggio non valido.' }); }
          try { handle(c, msg); } catch (e) { log.error('ws', { err: e }); }
        });
        ws.on('close', () => { clearTimeout(c.authTimer); clients.delete(c); for (const p of c.subs) broadcastPresence(p); });
        ws.on('error', () => ws.terminate());
      });
    });
  }
  // sessione chiusa (logout, cambio password, «disconnetti dispositivo»): i suoi WebSocket si chiudono subito
  auth.onRevoke?.((hashes) => { const set = new Set(hashes); for (const c of clients) if (c.tokenHash && set.has(c.tokenHash)) { send(c, { type: 'error', code: 'sessione_chiusa', message: 'Sessione chiusa.' }); c.ws.close(4401); } });
  // Notifiche personali effimere (trasferimenti, bacheca, scadenze): niente contenuti, solo "c'è qualcosa di nuovo"; i dati si rileggono via REST.
  // to = array di userId oppure '*' (tutti gli utenti collegati).
  function notify(to, payload) {
    const set = to === '*' ? null : new Set(to);
    for (const c of clients) if (c.user && (!set || set.has(c.user.id))) send(c, { type: 'notify', event: { ...payload, at: new Date().toISOString() } });
  }
  const beat = setInterval(() => { for (const c of clients) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch { /* chiusa */ } } }, 25_000);
  beat.unref();
  const close = () => { clearInterval(beat); for (const c of clients) c.ws.terminate(); wss.close(); };
  return { attach, onlineSet, close, notify, clientCount: () => clients.size };
}
module.exports = { createHub };
