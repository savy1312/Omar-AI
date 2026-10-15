'use strict';
// Omar AI come applicazione: senza la chiave dell'avvio (consegnata dalla finestra dell'icona) l'interfaccia, le API
// e il WebSocket sono chiusi; con la chiave si apre tutto. DESKTOP_ONLY=false (server di rete locale) toglie il blocco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createApp } = require('../src/app');

async function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omar-desk-'));
  const app = createApp({ config: { skipEnvFile: true, dataDir: dir, env: { AI_PROVIDER: 'demo', ...env } }, logLevel: 'silent' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}`, port: app.server.address().port };
}
const wsStatus = (port, cookie) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: cookie ? { cookie } : {} });
  ws.on('open', () => { ws.close(); resolve('open'); });
  ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
  ws.on('error', () => resolve('error'));
});

test('applicazione: senza la chiave dell\'avvio interfaccia, API e WebSocket non si aprono', async () => {
  const a = await start();
  try {
    assert.equal(a.ctx.cfg.desktopOnly, true, 'per impostazione predefinita Omar è solo applicazione');
    assert.equal((await fetch(`${a.base}/desktop/ping`)).status, 200, 'il controllo «è acceso?» resta libero');
    const page = await fetch(`${a.base}/`);
    assert.equal(page.status, 403);
    assert.match(await page.text(), /icona <strong>«Omar AI»<\/strong>/);
    const info = await fetch(`${a.base}/api/info`);
    assert.equal(info.status, 403);
    assert.equal((await info.json()).error.code, 'solo_app');
    assert.equal((await fetch(`${a.base}/js/app.js`)).status, 403, 'nemmeno i file dell\'interfaccia');
    assert.equal(await wsStatus(a.port), 403);
    // chiave sbagliata: niente cookie
    const bad = await fetch(`${a.base}/desktop/apri?k=sbagliata`, { redirect: 'manual' });
    assert.equal(bad.status, 403); assert.equal(bad.headers.get('set-cookie'), null);
    assert.equal((await fetch(`${a.base}/api/info`, { headers: { cookie: 'omar_app=sbagliata' } })).status, 403);
  } finally { await a.close(); }
});

test('applicazione: la finestra con la chiave riceve il cookie e usa tutto, anche il WebSocket', async () => {
  const a = await start();
  try {
    const r = await fetch(`${a.base}/desktop/apri?k=${a.ctx.launchKey}`, { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
    const cookie = sc.split(';')[0];
    assert.equal((await fetch(`${a.base}/`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${a.base}/api/info`, { headers: { cookie } })).status, 200);
    assert.equal(await wsStatus(a.port, cookie), 'open');
    // a ogni avvio la chiave cambia: il cookie di un avvio precedente non vale più
    const b = await start();
    try { assert.notEqual(b.ctx.launchKey, a.ctx.launchKey); assert.equal((await fetch(`${b.base}/api/info`, { headers: { cookie } })).status, 403); }
    finally { await b.close(); }
  } finally { await a.close(); }
});

test('server di rete locale (DESKTOP_ONLY=false): nessun blocco', async () => {
  const a = await start({ DESKTOP_ONLY: 'false' });
  try {
    assert.equal((await fetch(`${a.base}/api/info`)).status, 200);
    assert.equal((await fetch(`${a.base}/`)).status, 200);
  } finally { await a.close(); }
});
