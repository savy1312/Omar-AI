'use strict';
// Pagina Account: profilo, cambio password, dispositivi collegati (sessioni) e chiusura immediata dei WebSocket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

test('account: dati del profilo e sessioni, senza token né hash completi', async () => {
  const t = await boot(); const u = await t.user('Gaia');
  const r = await u.api('GET', '/api/account');
  assert.equal(r.status, 200); assert.equal(r.body.user.displayName, 'Gaia'); assert.equal(r.body.roleLabel, 'Studente');
  assert.equal(r.body.sessions.length, 1); assert.equal(r.body.sessions[0].current, true); assert.match(r.body.sessions[0].id, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(r.body).includes(u.token));
  const p = await u.api('PATCH', '/api/account', { displayName: 'Gaia R.' });
  assert.equal(p.body.user.displayName, 'Gaia R.');
  assert.equal((await u.api('PATCH', '/api/account', { displayName: 'G' })).status, 400);
  await t.close();
});

test('cambio password: verifica della password attuale, regole, chiusura delle altre sessioni', async () => {
  const t = await boot(); const u = await t.user('Paolo');
  const other = t.ctx.auth.login(u.user.username, 'password-sicura-1', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
  let r = await u.api('POST', '/api/account/password', { currentPassword: 'sbagliata-123', newPassword: 'nuova-password-ok' });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'password_errata');
  r = await u.api('POST', '/api/account/password', { currentPassword: 'password-sicura-1', newPassword: 'corta' });
  assert.equal(r.body.error.code, 'password_debole');
  r = await u.api('POST', '/api/account/password', { currentPassword: 'password-sicura-1', newPassword: 'password-sicura-1' });
  assert.equal(r.body.error.code, 'password_uguale');
  r = await u.api('POST', '/api/account/password', { currentPassword: 'password-sicura-1', newPassword: `${u.user.username}-lunga` });
  assert.equal(r.body.error.code, 'password_debole');
  r = await u.api('POST', '/api/account/password', { currentPassword: 'password-sicura-1', newPassword: 'Una-nuova-password-77' });
  assert.equal(r.status, 200); assert.equal(r.body.closedSessions, 1);
  assert.equal(t.ctx.auth.authenticate(other.token), null);            // l'altro dispositivo è uscito
  assert.equal((await u.api('GET', '/api/me')).status, 200);            // questo no
  assert.throws(() => t.ctx.auth.login(u.user.username, 'password-sicura-1'));
  assert.ok(t.ctx.auth.login(u.user.username, 'Una-nuova-password-77').token);
  await t.close();
});

test('cambio password: troppi tentativi sbagliati vengono bloccati', async () => {
  const t = await boot(); const u = await t.user('Ivo');
  for (let i = 0; i < 5; i++) assert.equal((await u.api('POST', '/api/account/password', { currentPassword: `no-${i}-xxxxxx`, newPassword: 'nuova-password-ok' })).status, 400);
  assert.equal((await u.api('POST', '/api/account/password', { currentPassword: 'password-sicura-1', newPassword: 'nuova-password-ok' })).status, 429);
  await t.close();
});

test('dispositivi: disconnettere un altro dispositivo chiude subito il suo WebSocket', async () => {
  const t = await boot(); const u = await t.user('Lia');
  const other = t.ctx.auth.login(u.user.username, 'password-sicura-1', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });
  const ws = t.ws(other.token); await ws.auth();
  const acc = (await u.api('GET', '/api/account')).body;
  const s = acc.sessions.find((x) => !x.current); assert.equal(s.device, 'Chrome su Android');
  assert.equal((await u.api('DELETE', `/api/account/sessions/${acc.sessions.find((x) => x.current).id}`)).status, 400); // non la propria
  assert.equal((await u.api('DELETE', `/api/account/sessions/${s.id}`)).status, 200);
  await new Promise((r) => { const t0 = Date.now(); const k = setInterval(() => { if (ws.closed || Date.now() - t0 > 3000) { clearInterval(k); r(); } }, 20); });
  assert.equal(ws.closed, true);
  assert.equal(t.ctx.auth.authenticate(other.token), null);
  // un utente non può chiudere sessioni altrui
  const v = await t.user('Vera');
  assert.equal((await v.api('DELETE', `/api/account/sessions/${s.id}`)).status, 404);
  await t.close();
});
