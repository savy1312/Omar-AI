'use strict';
// Risposte in STREAMING: il testo arriva mentre il modello scrive.
// Cosa verificano: ordine degli eventi, che il blocco tecnico e le citazioni inventate non siano MAI mostrati, che la guardia fermi lo stream,
// che il pulsante Stop salvi la parte scritta, che gli errori restino comprensibili e che gli adattatori leggano davvero il formato SSE.
// Cosa NON verificano: la qualità o la velocità di un modello reale (qui il "modello" è uno script).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, until, STATE, ProviderError } = require('./helpers');
const { createProvider } = require('../src/ai');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// attesa interrompibile: si risveglia subito se arriva il segnale di stop
const waitOr = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

function streamProvider(script) {
  const p = {
    name: 'fake', model: 'fake-1', simulated: false, calls: [], sawAbort: false, chunksSent: 0,
    async complete() { throw new Error('complete() non previsto in questo test'); },
    async stream(args) {
      p.calls.push(args); const chunks = [];
      const emit = (c) => { chunks.push(c); p.chunksSent++; args.onText(c); };
      await script({ emit, signal: args.signal, args });
      if (args.signal.aborted) p.sawAbort = true;
      return { text: chunks.join('').trim(), usage: {}, provider: 'fake', model: 'fake-1', simulated: false, aborted: !!args.signal.aborted };
    },
    tutorCalls: () => p.calls.filter((c) => c.task === 'tutor'),
  };
  return p;
}

async function readSse(res, { stopAt } = {}) {
  const events = []; const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block); const data = /^data: (.*)$/m.exec(block);
      if (ev) { events.push({ type: ev[1], data: JSON.parse(data[1]) }); if (stopAt?.(events.at(-1), events)) return { events, reader }; }
    }
  }
  return { events, reader };
}
const open = (t, u, sid, body, signal) => fetch(`${t.base}/api/sessions/${sid}/messages/stream`, { method: 'POST', signal, headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const mk = async (u, body = {}) => (await u.api('POST', '/api/sessions', { subjectId: 'meccanica', topicId: 'statica', mode: 'spiega', level: 'base', ...body })).body.session;
const types = (events) => events.map((e) => e.type);
const deltaText = (events) => events.filter((e) => e.type === 'delta').map((e) => e.data.text).join('');
const usageCalls = (t, u) => t.ctx.db.get('SELECT calls FROM ai_usage WHERE user_id = ?', u.id)?.calls ?? 0;
const dbMessages = (t, sid) => t.ctx.db.all('SELECT role, content, meta_json FROM messages WHERE session_id = ? ORDER BY created_at, rowid', sid);

test('streaming: eventi in ordine, testo ricomposto uguale a quello salvato, blocco tecnico e citazioni inventate mai mostrati', async () => {
  const chunks = ['Parti', 'amo da ', 'qui [M', '7] e ragiona', ' con **calma**.\n', '<sta', `to_didattico>${JSON.stringify({ obiettivo: 'capire', fase: 'guida', esito: 'nessuno', difficolta: [], unita_da_verificare: false, competenze: [] })}</stato_didattico>`];
  const t = await boot({ provider: streamProvider(async ({ emit, signal }) => { for (const c of chunks) { emit(c); await waitOr(5, signal); } }) });
  const u = await t.user('Gea'); const s = await mk(u);
  const res = await open(t, u, s.id, { text: 'Spiegami il momento di una forza' });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const { events } = await readSse(res);
  assert.deepEqual(types(events).filter((x, i, a) => a.indexOf(x) === i), ['start', 'detect', 'context', 'phase', 'delta', 'done']);
  assert.equal(events[0].type, 'start'); assert.equal(events.at(-1).type, 'done');
  const shown = deltaText(events);
  assert.ok(events.filter((e) => e.type === 'delta').length >= 3, 'il testo arriva a pezzi, non in un colpo solo');
  assert.doesNotMatch(shown, /stato_didattico|<|\{/, 'il blocco tecnico non deve mai comparire');
  assert.doesNotMatch(shown, /\[M7\]/, 'una citazione non presente nelle fonti fornite non deve mai comparire');
  const done = events.at(-1).data;
  assert.equal(shown.trim(), done.assistantMessage.content);
  assert.equal(done.assistantMessage.content, 'Partiamo da qui e ragiona con **calma**.');
  const saved = dbMessages(t, s.id); assert.equal(saved.length, 2); assert.equal(saved[1].content, done.assistantMessage.content);
  assert.ok(done.progress, 'lo stato didattico del blocco tecnico viene comunque letto');
  await t.close();
});

test('streaming: la guardia ferma il modello mentre scrive e il codice completo non arriva allo studente', async () => {
  const lines = Array.from({ length: 40 }, (_, i) => `    riga_${i} = ${i}`);
  const prov = streamProvider(async ({ emit, signal }) => { emit('Ecco il programma:\n```python\n'); for (const l of lines) { if (signal.aborted) return; emit(l + '\n'); await waitOr(3, signal); } emit('```\n'); });
  const t = await boot({ provider: prov });
  const u = await t.user('Ivo'); const s = await mk(u, { mode: 'esercizio' });
  const { events } = await readSse(await open(t, u, s.id, { text: 'Scrivimi il programma completo' }));
  assert.ok(prov.sawAbort, 'il modello è stato interrotto dalla guardia');
  assert.ok(prov.chunksSent < 25, `lo stream si è fermato presto (${prov.chunksSent} pezzi su 42)`);
  const replaces = events.filter((e) => e.type === 'replace');
  assert.ok(replaces.length >= 1 && /Preferisco non scrivere il programma/.test(replaces.at(-1).data.text));
  const shownLines = (deltaText(events).match(/riga_\d+/g) || []).length;
  assert.ok(shownLines <= 12, `mostrate al massimo ${shownLines} righe di codice (limite didattico: 12)`);
  const done = events.at(-1).data; assert.equal(events.at(-1).type, 'done');
  assert.match(done.assistantMessage.content, /Preferisco non scrivere il programma/);
  assert.ok(done.assistantMessage.notices.some((n) => n.type === 'guardia'));
  assert.doesNotMatch(dbMessages(t, s.id).map((m) => m.content).join('\n'), /riga_20/, 'nel database non resta il codice completo');
  await t.close();
});

test('streaming: «Stop» dello studente interrompe il modello e salva la parte già scritta', async () => {
  const prov = streamProvider(async ({ emit, signal }) => { emit('Prima parte della spiegazione. '); emit('Seconda parte. '); await waitOr(10_000, signal); emit('MAI MOSTRATO'); });
  const t = await boot({ provider: prov });
  const u = await t.user('Lia'); const s = await mk(u);
  const ac = new AbortController(); const res = await open(t, u, s.id, { text: 'Spiegami la statica' }, ac.signal);
  const got = await readSse(res, { stopAt: (e, all) => deltaText(all).includes('Seconda parte') });
  ac.abort(); await got.reader.cancel().catch(() => {});
  await until(() => dbMessages(t, s.id).length === 2, 4000);
  const [, a] = dbMessages(t, s.id);
  assert.equal(a.content, 'Prima parte della spiegazione. Seconda parte.');
  assert.equal(JSON.parse(a.meta_json).interrupted, true);
  assert.ok(prov.sawAbort, 'la richiesta al modello è stata annullata');
  assert.doesNotMatch(a.content, /MAI MOSTRATO/);
  assert.equal(usageCalls(t, u), 1, 'una risposta parziale conta come richiesta fatta');
  await t.close();
});

test('streaming: «Stop» prima che il modello scriva nulla non salva niente e restituisce la richiesta', async () => {
  const prov = streamProvider(async ({ signal }) => { await waitOr(10_000, signal); });
  const t = await boot({ provider: prov });
  const u = await t.user('Mia'); const s = await mk(u);
  const ac = new AbortController(); const res = await open(t, u, s.id, { text: 'Ciao' }, ac.signal);
  const got = await readSse(res, { stopAt: (e) => e.type === 'phase' && e.data.phase === 'writing' });
  ac.abort(); await got.reader.cancel().catch(() => {});
  await until(() => prov.sawAbort, 4000);
  await until(() => usageCalls(t, u) === 0, 4000);
  assert.equal(dbMessages(t, s.id).length, 0);
  await t.close();
});

test('streaming: provider senza stream() → un solo blocco di testo, a controlli finiti', async () => {
  const t = await boot(); const u = await t.user('Noa'); const s = await mk(u);
  const { events } = await readSse(await open(t, u, s.id, { text: 'Spiegami la statica' }));
  assert.equal(events.filter((e) => e.type === 'delta').length, 1);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.filter((e) => e.type === 'delta')[0].data.text, events.at(-1).data.assistantMessage.content);
  await t.close();
});

test('streaming: risposta di sicurezza deterministica (senza modello) arriva come testo', async () => {
  const prov = streamProvider(async () => { throw new Error('il modello non deve essere interpellato'); });
  const t = await boot({ provider: prov });
  const u = await t.user('Ugo'); const s = await mk(u, { mode: 'esercizio' });
  const { events } = await readSse(await open(t, u, s.id, { text: 'Come faccio a ponticellare la fotocellula del nastro?' }));
  assert.equal(prov.calls.length, 0);
  assert.match(deltaText(events), /non posso aiutarti/i); assert.equal(events.at(-1).type, 'done');
  await t.close();
});

test('streaming: errori prima dell’inizio restano risposte JSON normali (404, 400, limiti)', async () => {
  const t = await boot(); const u = await t.user('Eva'); const s = await mk(u);
  const r404 = await open(t, u, 'non-esiste', { text: 'ciao' }); assert.equal(r404.status, 404); assert.match(r404.headers.get('content-type'), /json/);
  assert.equal((await r404.json()).error.code, 'non_trovato');
  const r400 = await open(t, u, s.id, {}); assert.equal(r400.status, 400); assert.match(r400.headers.get('content-type'), /json/);
  const long = await open(t, u, s.id, { text: 'x'.repeat(t.ctx.cfg.limits.maxMessageChars + 1) }); assert.equal(long.status, 400);
  const anon = await fetch(`${t.base}/api/sessions/${s.id}/messages/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(anon.status, 401);
  assert.equal(usageCalls(t, u), 0, 'le richieste respinte non consumano il limite giornaliero');
  await t.close();
});

test('streaming: se il servizio IA cade a metà, evento di errore comprensibile, niente salvato e richiesta restituita', async () => {
  const t = await boot({ provider: streamProvider(async ({ emit }) => { emit('Comincio a '); throw new ProviderError('unavailable', 'rete'); }) });
  const u = await t.user('Ada'); const s = await mk(u);
  const { events } = await readSse(await open(t, u, s.id, { text: 'Spiegami la statica' }));
  const err = events.at(-1); assert.equal(err.type, 'error'); assert.equal(err.data.error.code, 'ia_non_disponibile');
  assert.match(err.data.error.message, /non è raggiungibile/); assert.doesNotMatch(JSON.stringify(err), /rete non raggiungibile|stack|ProviderError/);
  assert.equal(dbMessages(t, s.id).length, 0); assert.equal(usageCalls(t, u), 0);
  await t.close();
});

test('streaming: con il provider di simulazione il testo arriva a pezzi ed è sempre etichettato come simulato', async () => {
  const t = await boot({ provider: null }); const u = await t.user('Teo'); const s = await mk(u);
  const { events } = await readSse(await open(t, u, s.id, { text: 'Spiegami la statica' }));
  assert.ok(events.filter((e) => e.type === 'delta').length > 5);
  const done = events.at(-1).data; assert.equal(done.simulated, true); assert.match(done.assistantMessage.content, /SIMULAZIONE/);
  assert.equal(deltaText(events).trim(), done.assistantMessage.content);
  await t.close();
});

test('filtro di streaming: riferimenti inventati tolti senza accorciare il testo già mostrato, spazi finali trattenuti', () => {
  const { createStreamFilter } = require('../src/engine/stream');
  const f = createStreamFilter({ mode: 'spiega', valid: new Set(['M1']) });
  const out = []; const feed = (c) => { const r = f.push(c); assert.equal(r.replace, undefined, 'nessuna sostituzione del testo già mostrato'); assert.equal(r.violation, undefined); if (r.delta) out.push(r.delta); };
  for (const c of ['Il rotore gira ', 'più lento ', '[M9]', '. Poi vale ', '[M1', '] e basta.\n\n', 'Fine']) feed(c);
  assert.equal(out.join(''), 'Il rotore gira più lento. Poi vale [M1] e basta.\n\nFine');
  assert.ok(out[0].endsWith('gira'), 'lo spazio finale non viene mostrato finché non arriva il carattere successivo');
  const g = require('../src/engine/guard');
  assert.equal(g.sanitizeCitations('Riga uno [M5]\n[M6] riga due [M1]', new Set(['M1'])).text, 'Riga uno\n riga due [M1]', 'gli a capo non vengono mangiati');
});

// ───────── adattatori dei provider: lettura del formato SSE ─────────
const sseBody = (frames, { splitAt = 0, delayMs = 0 } = {}) => {
  const bytes = new TextEncoder().encode(frames.join(''));
  return new ReadableStream({ async start(c) { const step = splitAt || bytes.length; for (let i = 0; i < bytes.length; i += step) { c.enqueue(bytes.slice(i, i + step)); if (delayMs) await sleep(delayMs); } c.close(); } });
};
const resp = (frames, opts = {}) => new Response(sseBody(frames, opts), { status: opts.status || 200, headers: { 'content-type': 'text/event-stream' } });
const oa = (fetchImpl, extra = {}) => createProvider({ provider: 'openai-compatible', baseUrl: 'http://modello.locale/v1', model: 'm', maxTokens: 100, temperature: 0.2, timeoutMs: 400, retries: 1, ...extra }, fetchImpl);
const an = (fetchImpl, extra = {}) => createProvider({ provider: 'anthropic', apiKey: 'k', model: 'm', maxTokens: 100, temperature: 0.2, timeoutMs: 400, retries: 1, ...extra }, fetchImpl);
const oaFrame = (txt) => `data: ${JSON.stringify({ choices: [{ delta: { content: txt } }] })}\n\n`;

test('adattatore OpenAI-compatibile/Ollama: legge i frammenti anche spezzati a metà evento e UTF-8 multibyte', async () => {
  const frames = [oaFrame('Ciao '), oaFrame('è '), oaFrame('così'), 'data: [DONE]\n\n'];
  let sent; const p = oa(async (url, init) => { sent = JSON.parse(init.body); return resp(frames, { splitAt: 7 }); });
  const got = []; const r = await p.stream({ system: 'S', messages: [{ role: 'user', content: 'q' }], onText: (x) => got.push(x) });
  assert.equal(got.join(''), 'Ciao è così'); assert.equal(r.text, 'Ciao è così'); assert.equal(r.aborted, false);
  assert.equal(sent.stream, true); assert.equal(sent.messages[0].role, 'system');
});

test('adattatore Anthropic: legge text_delta, ignora il resto e segnala gli errori dello stream', async () => {
  const ev = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`;
  const ok = [ev('message_start', { message: { usage: { input_tokens: 5 } } }), ev('content_block_delta', { delta: { type: 'text_delta', text: 'Ciao' } }), ev('ping', {}), ev('content_block_delta', { delta: { type: 'text_delta', text: ' mondo' } }), ev('message_delta', { usage: { output_tokens: 3 } }), ev('message_stop', {})];
  const got = []; const r = await an(async (url, init) => { assert.equal(JSON.parse(init.body).stream, true); return resp(ok, { splitAt: 11 }); }).stream({ system: 'S', messages: [{ role: 'user', content: 'q' }], onText: (x) => got.push(x) });
  assert.equal(got.join(''), 'Ciao mondo'); assert.deepEqual(r.usage, { in: 5, out: 3 });
  const bad = [ev('content_block_delta', { delta: { type: 'text_delta', text: 'a' } }), ev('error', { error: { type: 'overloaded_error' } })];
  await assert.rejects(() => an(async () => resp(bad)).stream({ system: 'S', messages: [{ role: 'user', content: 'q' }] }), (e) => e.code === 'unavailable');
});

test('adattatori streaming: credenziali rifiutate, riprova prima del primo byte, risposta vuota, timeout di inattività, interruzione', async () => {
  const msgs = [{ role: 'user', content: 'q' }];
  await assert.rejects(() => oa(async () => new Response('no', { status: 401 })).stream({ system: 'S', messages: msgs }), (e) => e.code === 'auth' && e.retryable === false);
  let n = 0; const flaky = oa(async () => (++n === 1 ? new Response('x', { status: 503 }) : resp([oaFrame('ok'), 'data: [DONE]\n\n'])));
  assert.equal((await flaky.stream({ system: 'S', messages: msgs })).text, 'ok'); assert.equal(n, 2);
  await assert.rejects(() => oa(async () => resp(['data: [DONE]\n\n'])).stream({ system: 'S', messages: msgs }), (e) => e.code === 'bad_response');
  // dopo il primo testo un errore NON si ritenta (duplicherebbe la risposta)
  let m = 0; const broken = oa(async () => { m++; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(oaFrame('parziale'))); setTimeout(() => c.error(new Error('rete')), 10); } })); });
  await assert.rejects(() => broken.stream({ system: 'S', messages: msgs }), (e) => e.code === 'unavailable' && e.retryable === false); assert.equal(m, 1);
  // silenzio: nessun dato per più del timeout di inattività
  const silent = oa(async (url, init) => new Response(new ReadableStream({ start(c) { init.signal.addEventListener('abort', () => c.error(new DOMException('abort', 'AbortError'))); } })), { timeoutMs: 80, retries: 0 });
  await assert.rejects(() => silent.stream({ system: 'S', messages: msgs }), (e) => e.code === 'timeout');
  // il timeout è di INATTIVITÀ: una risposta lunga ma continua non scade
  const slow = oa(async () => resp(Array.from({ length: 8 }, (_, i) => oaFrame(`p${i} `)), { splitAt: 1e6, delayMs: 0 }), { timeoutMs: 120 });
  assert.match((await slow.stream({ system: 'S', messages: msgs })).text, /p7/);
  // interruzione voluta: nessun errore, testo parziale
  const ac = new AbortController(); const got = [];
  const stoppable = oa(async (url, init) => new Response(new ReadableStream({ start(c) { init.signal.addEventListener('abort', () => c.error(new DOMException('abort', 'AbortError'))); c.enqueue(new TextEncoder().encode(oaFrame('uno '))); } })), { timeoutMs: 5000 });
  const pr = stoppable.stream({ system: 'S', messages: msgs, signal: ac.signal, onText: (x) => { got.push(x); ac.abort(); } });
  const r = await pr; assert.equal(r.aborted, true); assert.equal(r.text, 'uno');
});
