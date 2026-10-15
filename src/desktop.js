'use strict';
// Omar AI come APPLICAZIONE (non web app) e «server della classe».
//
// • Solo applicazione: a ogni avvio il server crea una chiave casuale; la finestra aperta dall'icona (scripts/apri-finestra.js)
//   la riceve e ottiene un cookie. Senza chiave interfaccia, API e WebSocket rispondono «si apre dall'applicazione».
// • Server della classe (AULA=true): UN computer (di solito del docente) tiene i gruppi di tutta la classe. Ha una chiave
//   d'aula stabile (data/.aula-key) che gli altri computer inseriscono UNA volta nella loro app per collegarsi: così i codici
//   di invito funzionano tra computer diversi. Anche qui, senza chiave un normale browser non apre nulla.
// • Collegamento alla classe (data/classe.json, solo sul proprio computer): l'icona apre direttamente il server della classe.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { E } = require('./lib/errors');
const { route, str } = require('./routes/util');
const { RateLimiter } = require('./lib/ratelimit');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const aulaCode = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')).join('-');
const normAula = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})(.{4})(.{4})$/, '$1-$2-$3-$4');
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

const SOLO_APP_HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omar AI</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#f4f4f5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
main{max-width:30rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .6rem}p{color:#a1a1aa;margin:.4rem 0}strong{color:#f4f4f5}</style></head>
<body><main><h1>Omar AI si apre dall’applicazione</h1><p>Omar AI non è un sito web: è un’applicazione installata su questo computer.</p>
<p>Fai doppio clic sull’icona <strong>«Omar AI»</strong> sul Desktop (o nel menu Start).</p>
<p>Non hai ancora l’icona? Scarica Omar AI dalla pagina di download della scuola e lancia l’installazione.</p></main></body></html>`;
const LOCALE_HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Omar AI</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#f4f4f5;font:16px/1.5 system-ui,sans-serif;padding:24px}main{max-width:30rem;text-align:center}p{color:#a1a1aa}</style></head>
<body><main><h1>Fatto: Omar userà solo questo computer</h1><p>Chiudi questa finestra e riapri l’icona «Omar AI».</p></main></body></html>`;

function lanAddresses(port) {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `${i.address}:${port}`);
}

function createDesktop(ctx) {
  const { cfg } = ctx;
  const launchKey = crypto.randomBytes(24).toString('base64url');
  const keyFile = path.join(cfg.dataDir, '.aula-key');
  let aulaKey = null;
  if (cfg.aula) {
    try { aulaKey = normAula(fs.readFileSync(keyFile, 'utf8').trim()); } catch { /* prima volta */ }
    if (!aulaKey || aulaKey.length !== 19) { aulaKey = aulaCode(); fs.writeFileSync(keyFile, aulaKey, { mode: 0o600 }); }
  }
  const classeFile = path.join(cfg.dataDir, 'classe.json');
  const readClasse = () => { try { const c = JSON.parse(fs.readFileSync(classeFile, 'utf8')); return c && c.address ? c : null; } catch { return null; } };
  const keyOk = (k) => !!k && (same(k, launchKey) || (!!aulaKey && same(normAula(k), aulaKey)));
  const cookieKey = (req) => (/(?:^|;\s*)omar_app=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1];
  const gate = (req) => !cfg.desktopOnly || keyOk(cookieKey(req));
  const failLimiter = new RateLimiter(10, 10 * 60_000); ctx.limiters?.push(failLimiter);

  // rotte libere (prima del blocco): «è acceso?», ingresso della finestra, verifica della chiave d'aula, ritorno al solo computer
  function mountPublic(app) {
    app.get('/desktop/ping', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, app: 'Omar AI' }));
    app.get('/desktop/apri', (req, res) => {
      if (!cfg.desktopOnly) return res.redirect(302, '/');
      const k = String(req.query.k || '');
      if (!failLimiter.check(req.ip) || !keyOk(k)) { failLimiter.hit(req.ip); return res.status(403).type('html').send(SOLO_APP_HTML); }
      const v = same(k, launchKey) ? launchKey : aulaKey.replace(/-/g, '');
      res.set('Set-Cookie', `omar_app=${v}; HttpOnly; SameSite=Lax; Path=/`).redirect(302, '/');
    });
    app.get('/desktop/verifica', (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!failLimiter.check(req.ip)) return res.status(429).json({ ok: false, message: 'Troppi tentativi: riprova tra qualche minuto.' });
      if (!cfg.aula || !aulaKey || !same(normAula(req.query.k), aulaKey)) { failLimiter.hit(req.ip); return res.status(403).json({ ok: false, message: cfg.aula ? 'Codice d’aula errato.' : 'Questo computer non è un server della classe.' }); }
      res.json({ ok: true, app: 'Omar AI', aula: true, nome: os.hostname() });
    });
    app.get('/desktop/locale', (req, res) => {
      if (!isLoopback(req)) return res.status(403).type('html').send(SOLO_APP_HTML);
      try { fs.rmSync(classeFile, { force: true }); } catch { /* già tolto */ }
      res.type('html').send(LOCALE_HTML);
    });
    app.use((req, res, next) => {
      if (gate(req)) return next();
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: { code: 'solo_app', message: 'Omar AI si usa solo dall’applicazione: aprila dall’icona «Omar AI» sul Desktop.' } });
      return res.status(403).type('html').send(SOLO_APP_HTML);
    });
  }

  // rotte dell'app (dopo l'autenticazione): stato, collegamento al server della classe, attivazione del server della classe
  function mountApi(app) {
    const api = express.Router();
    const need = ctx.auth.requireAuth;
    const localOnly = (req) => { if (!isLoopback(req)) throw E.forbidden('Si può fare solo dall’app sul proprio computer.'); };
    api.get('/desktop', need, route((req) => {
      const local = isLoopback(req);
      return {
        local, aula: cfg.aula, desktopOnly: cfg.desktopOnly,
        ...(cfg.aula ? { addresses: lanAddresses(cfg.port), hostname: os.hostname() } : {}),
        ...(cfg.aula && local ? { aulaKey } : {}),
        ...(local ? { classe: readClasse() && { address: readClasse().address, nome: readClasse().nome } } : {}),
      };
    }));
    api.post('/desktop/classe', need, route(async (req) => {
      localOnly(req);
      let address = str(req.body?.address, 'address', { min: 3, max: 80 }).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      if (!/:\d+$/.test(address)) address += ':3300';
      if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(address)) throw E.bad('Indirizzo non valido: scrivilo come 192.168.1.20 oppure 192.168.1.20:3300.');
      const code = normAula(req.body?.code);
      if (code.length !== 19) throw E.bad('Il codice d’aula ha 16 caratteri, ad esempio ABCD-EFGH-JKMN-PQRS.');
      let r;
      try { r = await fetch(`http://${address}/desktop/verifica?k=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(5000) }); }
      catch { throw E.bad(`Non trovo il server della classe su ${address}. Controlla l'indirizzo, che quel computer abbia Omar acceso e che siate sulla stessa rete.`); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw E.bad(j.message || 'Il server ha rifiutato il codice d’aula.');
      fs.writeFileSync(classeFile, JSON.stringify({ address, key: code, nome: String(j.nome || '').slice(0, 60), at: new Date().toISOString() }), { mode: 0o600 });
      return { ok: true, address, nome: j.nome || null, openUrl: `http://${address}/desktop/apri?k=${encodeURIComponent(code)}` };
    }));
    api.delete('/desktop/classe', need, route((req) => { localOnly(req); fs.rmSync(classeFile, { force: true }); return { ok: true }; }));
    api.post('/desktop/aula', need, route((req) => {
      localOnly(req);
      const on = !!req.body?.on;
      const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env');
      if (ctx.cfg.envFileDisabled) throw E.bad('Configurazione non modificabile in questa modalità.');
      let text = ''; try { text = fs.readFileSync(envFile, 'utf8'); } catch { /* nuovo file */ }
      const set = (t, k, v) => { const rx = new RegExp(`^#?\\s*${k}=.*$`, 'm'); return rx.test(t) ? t.replace(rx, `${k}=${v}`) : `${t.replace(/\s*$/, '\n')}${k}=${v}\n`; };
      text = set(text, 'AULA', on ? 'true' : 'false');
      fs.writeFileSync(envFile, text);
      ctx.log?.info?.('aula', { on });
      return { ok: true, on, restart: true, message: on ? 'Fatto. Chiudi la finestra nera di Omar e riapri l’icona: questo computer diventerà il server della classe.' : 'Fatto. Chiudi la finestra nera di Omar e riapri l’icona: Omar tornerà solo su questo computer.' };
    }));
    app.use('/api', api);
  }

  return { launchKey, get aulaKey() { return aulaKey; }, gate, mountPublic, mountApi, readClasse, lanAddresses: () => lanAddresses(cfg.port), SOLO_APP_HTML };
}
module.exports = { createDesktop, normAula, isLoopback };
