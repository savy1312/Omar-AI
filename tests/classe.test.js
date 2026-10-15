'use strict';
// Codici di invito e gruppi tra computer diversi: codici rileggibili, avviso di approvazione, richieste in attesa,
// e «server della classe» (un computer tiene i gruppi; gli altri si collegano con indirizzo + codice d'aula).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createApp } = require('../src/app');

async function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omar-classe-'));
  const app = createApp({ config: { skipEnvFile: true, dataDir: dir, env: { AI_PROVIDER: 'demo', HOST: '127.0.0.1', ...env } }, logLevel: 'silent' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  return { ...app, dir, port, base: `http://127.0.0.1:${port}` };
}
function user(a, username, role = 'student') {
  a.ctx.auth.createUser({ username, displayName: username[0].toUpperCase() + username.slice(1), password: 'password-sicura-1', role });
  return a.ctx.auth.login(username, 'password-sicura-1').token;
}
const call = (a, token, method, p, body, cookie) => fetch(a.base + '/api' + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
async function windowCookie(a, key) {
  const r = await fetch(`${a.base}/desktop/apri?k=${encodeURIComponent(key)}`, { redirect: 'manual' });
  assert.equal(r.status, 302, 'la chiave apre la finestra');
  return r.headers.get('set-cookie').split(';')[0];
}

test('inviti: i codici attivi si rivedono, il compagno in attesa lo sa e riceve l\'avviso di approvazione', async () => {
  const a = await start({ DESKTOP_ONLY: 'false' });
  try {
    const elia = user(a, 'elia'); const marco = user(a, 'marco');
    const { body: { project } } = await call(a, elia, 'POST', '/projects', { name: 'Mulino a vento', requiresApproval: true });
    const inv = (await call(a, elia, 'POST', `/projects/${project.id}/invites`, { ttlMin: 60, maxUses: 5 })).body;
    const list = (await call(a, elia, 'GET', `/projects/${project.id}/invites`)).body.invites;
    assert.equal(list[0].code, inv.code, 'il codice attivo è rileggibile da chi gestisce il gruppo');
    assert.ok([403, 404].includes((await call(a, marco, 'GET', `/projects/${project.id}/invites`)).status), 'ma non dagli altri');

    // il codice si può scrivere in minuscolo, senza trattino o con spazi
    const j = await call(a, marco, 'POST', '/projects/join', { code: ` ${inv.code.replace('-', '').toLowerCase()} ` });
    assert.equal(j.status, 200); assert.equal(j.body.status, 'pending');
    const me = (await call(a, marco, 'GET', '/me')).body;
    assert.deepEqual(me.pending.map((p) => p.name), ['Mulino a vento'], 'la richiesta in attesa è visibile a chi l\'ha fatta');

    // marco è collegato in tempo reale: all'approvazione riceve un avviso personale
    const ws = new WebSocket(`ws://127.0.0.1:${a.port}/ws`);
    const got = new Promise((resolve) => ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'notify' && m.event.type === 'membership.updated') resolve(m.event); }));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: marco }));
    await new Promise((r) => setTimeout(r, 150));
    const meElia = (await call(a, elia, 'GET', '/me')).body.user;
    const marcoId = (await call(a, marco, 'GET', '/me')).body.user.id;
    assert.equal((await call(a, elia, 'POST', `/projects/${project.id}/members/${marcoId}/approve`)).status, 200);
    const ev = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('nessun avviso')), 2000))]);
    assert.equal(ev.status, 'active'); assert.equal(ev.projectId, project.id); assert.ok(meElia);
    ws.close();
    const after = (await call(a, marco, 'GET', '/me')).body;
    assert.equal(after.projects[0].id, project.id); assert.equal(after.pending.length, 0);
    // codice sbagliato: errore chiaro
    const bad = await call(a, marco, 'POST', '/projects/join', { code: 'AAAA-BBBB' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'invito_non_valido');
  } finally { await a.close(); }
});

test('server della classe: un altro computer si collega con indirizzo e codice d\'aula e il codice di invito funziona', async () => {
  const aula = await start({ AULA: 'true' });            // il computer del docente
  const pc = await start();                               // il computer di uno studente (solo applicazione)
  try {
    const key = aula.ctx.desktop.aulaKey;
    assert.match(key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(aula.ctx.cfg.desktopOnly, true, 'anche il server della classe resta «solo applicazione»');
    assert.equal((await fetch(`${aula.base}/api/info`)).status, 403, 'un normale browser non entra nemmeno qui');
    // la chiave d'aula è stabile tra un avvio e l'altro
    assert.equal(fs.readFileSync(path.join(aula.dir, '.aula-key'), 'utf8').trim(), key);

    // sul computer dello studente: la finestra dell'app (chiave dell'avvio) chiede di collegarsi alla classe
    const pcCookie = await windowCookie(pc, pc.ctx.launchKey);
    const marcoPc = user(pc, 'marco');
    const wrong = await call(pc, marcoPc, 'POST', '/desktop/classe', { address: `127.0.0.1:${aula.port}`, code: 'AAAA-BBBB-CCCC-DDDD' }, pcCookie);
    assert.equal(wrong.status, 400); assert.match(wrong.body.error.message, /errato/);
    const ok = await call(pc, marcoPc, 'POST', '/desktop/classe', { address: `http://127.0.0.1:${aula.port}/`, code: key.toLowerCase().replace(/-/g, ' ') }, pcCookie);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.openUrl, `http://127.0.0.1:${aula.port}/desktop/apri?k=${encodeURIComponent(key)}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(pc.dir, 'classe.json'), 'utf8')).address, `127.0.0.1:${aula.port}`, 'l\'icona aprirà la classe');
    assert.equal((await call(pc, marcoPc, 'GET', '/desktop', null, pcCookie)).body.classe.address, `127.0.0.1:${aula.port}`);

    // la finestra va sul server della classe con la chiave d'aula: lì elia ha creato il gruppo e il codice di invito
    const aulaCookie = await windowCookie(aula, ok.body.openUrl.split('k=')[1] && decodeURIComponent(ok.body.openUrl.split('k=')[1]));
    const elia = user(aula, 'elia'); const marco = user(aula, 'marco');
    const { body: { project } } = await call(aula, elia, 'POST', '/projects', { name: 'Progetto di classe', requiresApproval: false }, aulaCookie);
    const inv = (await call(aula, elia, 'POST', `/projects/${project.id}/invites`, {}, aulaCookie)).body;
    const j = await call(aula, marco, 'POST', '/projects/join', { code: inv.code }, aulaCookie);
    assert.equal(j.status, 200); assert.equal(j.body.status, 'active', 'il codice funziona tra computer diversi');
    // il server della classe mostra indirizzo e codice d'aula solo sul proprio computer
    const st = (await call(aula, elia, 'GET', '/desktop', null, aulaCookie)).body;
    assert.equal(st.aula, true); assert.equal(st.aulaKey, key);

    // tornare a «solo questo computer»
    assert.equal((await call(pc, marcoPc, 'DELETE', '/desktop/classe', null, pcCookie)).status, 200);
    assert.equal(fs.existsSync(path.join(pc.dir, 'classe.json')), false);
  } finally { await aula.close(); await pc.close(); }
});

test('server della classe: un computer non in modalità aula rifiuta la verifica', async () => {
  const a = await start();
  try {
    const r = await fetch(`${a.base}/desktop/verifica?k=AAAA-BBBB-CCCC-DDDD`);
    assert.equal(r.status, 403); assert.match((await r.json()).message, /non è un server della classe/);
  } finally { await a.close(); }
});
