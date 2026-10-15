'use strict';
// Banco di prova: avvia l'app reale su una porta libera, con un DB temporaneo e un provider IA "scriptato".
// ATTENZIONE: il provider scriptato NON è un modello. Questi test verificano i CONTROLLI DELL'APPLICAZIONE
// (permessi, filtri, guard, stato, recupero dati, errori), non la qualità delle risposte di un modello reale.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createApp } = require('../src/app');
const { ProviderError } = require('../src/ai/errors');

const STATE = '<stato_didattico>{"obiettivo":"capire","esercizio":null,"fase":"guida","esito":"nessuno","difficolta":[],"unita_da_verificare":false,"competenze":[]}</stato_didattico>';
const defaultHandler = () => `Partiamo dal tuo obiettivo: cosa hai già provato a fare?\n${STATE}`;

function fakeProvider(handler = defaultHandler) {
  const p = {
    name: 'fake', model: 'fake-1', simulated: false, calls: [], handler,
    async complete(args) {
      p.calls.push(args);
      const out = await p.handler(args, p.calls.length);
      if (out instanceof Error) throw out;
      return { text: typeof out === 'string' ? out : out.text, usage: {}, provider: 'fake', model: 'fake-1', simulated: false };
    },
    last: () => p.calls[p.calls.length - 1],
    tutorCalls: () => p.calls.filter((c) => c.task === 'tutor'),
  };
  return p;
}

// Chiusura garantita di tutti i server avviati, anche se un test fallisce a metà (altrimenti il processo resta appeso)
const booted = new Set();
require('node:test').after(async () => { for (const t of [...booted]) await t.close().catch(() => {}); });

async function boot({ provider = fakeProvider(), env = {}, aiNoDebounce = true, logLevel = 'silent', app = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omar-test-'));
  const { server, ctx, close } = createApp({ config: { skipEnvFile: true, dataDir: dir, env: { DESKTOP_ONLY: 'false', AI_PROVIDER: 'demo', STUDENT_REGISTRATION_CODE: 'CLASSE-123', TEACHER_REGISTRATION_CODE: 'DOCENTI-456', ...env } }, provider, logLevel, aiNoDebounce, ...app });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const t = { base, ctx, provider, dir, server };
  let closed = false;
  t.close = async () => { if (closed) return; closed = true; booted.delete(t); try { await ctx.waitIdle(); } catch { /* ignora */ } await close(); fs.rmSync(dir, { recursive: true, force: true }); };
  booted.add(t);
  let n = 0;
  t.user = async (displayName, role = 'student') => {
    const username = `${displayName.toLowerCase().replace(/\W/g, '')}${++n}`;
    ctx.auth.createUser({ username, displayName, password: 'password-sicura-1', role });
    const { token, user } = ctx.auth.login(username, 'password-sicura-1');
    const api = async (method, url, body, extra = {}) => {
      const isForm = body instanceof FormData;
      const res = await fetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...extra.headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
      const type = res.headers.get('content-type') || '';
      const json = type.includes('json') ? await res.json() : null;
      return { status: res.status, body: json, res };
    };
    return { user, token, api, id: user.id, name: displayName };
  };
  t.anon = async (method, url, body) => { const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  t.ws = (token) => wsClient(base, token);
  return t;
}

// Client WebSocket di prova con deduplica per seq (come farebbe il frontend)
function wsClient(base, token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const c = { ws, msgs: [], events: [], lastSeq: 0, closed: false };
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()); c.msgs.push(m);
    if (m.type === 'event' && m.event.seq > c.lastSeq) { c.events.push(m.event); c.lastSeq = m.event.seq; }
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  ws.on('close', () => { c.closed = true; });
  c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const hit = c.msgs.find(pred); if (hit) return res(hit);
    const w = { pred, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout in attesa del messaggio WebSocket')); } }, ms);
  });
  c.open = () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.auth = async () => { await c.open(); c.send({ type: 'auth', token }); await c.wait((m) => m.type === 'ready'); };
  c.subscribe = async (projectId, lastSeq = 0) => { c.send({ type: 'subscribe', projectId, lastSeq }); return c.wait((m) => m.type === 'subscribed' && m.projectId === projectId && !m.__seen && (m.__seen = true)); };
  c.close = () => new Promise((r) => { if (c.closed) return r(); ws.on('close', r); ws.close(); });
  c.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return c;
}

// PDF minimale (1 pagina per testo) valido per pdf-parse
function makePdf(pages) {
  const list = Array.isArray(pages) ? pages : [pages];
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  const fontId = 3; const kids = [];
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('PLACEHOLDER'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const text of list) {
    const stream = `BT /F1 12 Tf 50 750 Td (${String(text).replace(/[()\\]/g, ' ')}) Tj ET`;
    const cid = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pid = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`);
    kids.push(`${pid} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const form = (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, v); if (file) f.append('file', new Blob([file.data], { type: file.type || 'application/octet-stream' }), file.name); return f; };
const until = async (fn, ms = 4000, step = 25) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout in attesa della condizione'); await new Promise((r) => setTimeout(r, step)); } };

// Scenario condiviso: progetto "Mulino" con Elia (motore) e Marco (struttura)
async function mulinoScenario(t, { requiresApproval = false } = {}) {
  const elia = await t.user('Elia'); const marco = await t.user('Marco');
  const p = (await elia.api('POST', '/api/projects', { name: 'Mulino a vento', subjectId: 'meccanica', requiresApproval, workstream: 'motore' })).body.project;
  const inv = (await elia.api('POST', `/api/projects/${p.id}/invites`, {})).body;
  const j = await marco.api('POST', '/api/projects/join', { code: inv.code, workstream: 'struttura del mulino' });
  if (requiresApproval) await elia.api('POST', `/api/projects/${p.id}/members/${marco.id}/approve`);
  return { elia, marco, project: p, invite: inv, join: j };
}
module.exports = { boot, fakeProvider, makePdf, form, until, mulinoScenario, STATE, ProviderError, wsClient };
