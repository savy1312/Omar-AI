// Client API + WebSocket con riconnessione e recupero degli eventi mancanti. Il token resta nella sessione del browser (si perde chiudendo la scheda: scelta voluta per i PC condivisi della scuola).
const KEY = 'omar.token';
export const auth = {
  get token() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set token(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* ignora */ } },
};
export class ApiError extends Error { constructor(status, body) { super(body?.error?.message || `Errore ${status}`); this.status = status; this.code = body?.error?.code; this.details = body?.error; } }

// Eventi per la spia della Dynamic Island: rete (omar:net), modello IA (omar:ai), richiesta IA in corso (omar:busy)
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const isAiCall = (method, url) => method === 'POST' && (/^\/sessions\/[^/]+\/messages$/.test(url) || url === '/explain');
export async function api(method, url, body, { signal } = {}) {
  const isForm = body instanceof FormData;
  const ai = isAiCall(method, url); if (ai) emit('omar:busy', { busy: true });
  try { return await request(method, url, body, { signal, isForm, ai }); } finally { if (ai) emit('omar:busy', { busy: false }); }
}
async function request(method, url, body, { signal, isForm, ai }) {
  let res;
  try {
    res = await fetch('/api' + url, { method, signal, headers: { ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch (e) { if (e.name === 'AbortError') throw e; emit('omar:net', { up: false }); throw new ApiError(0, { error: { code: 'rete', message: 'Impossibile raggiungere il server. Controlla la connessione di rete e riprova.' } }); }
  emit('omar:net', { up: true });
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (ai) emit('omar:ai', { ok: res.ok || res.status !== 502 });
  if (!res.ok) {
    if (res.status === 401 && auth.token) { auth.token = null; window.dispatchEvent(new CustomEvent('omar:logout')); }
    throw new ApiError(res.status, json);
  }
  return json;
}

// ── risposta in streaming (SSE): il testo arriva a pezzi mentre il modello scrive ──
// onEvent(tipo, dati) riceve start/phase/context/delta/replace; il valore restituito è l'evento finale `done`.
// Un errore dopo l'inizio arriva come evento `error` e diventa un ApiError; Stop (signal) lancia AbortError.
export const canStream = () => typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined' && typeof fetch === 'function';
export async function stream(url, body, { signal, onEvent } = {}) {
  emit('omar:busy', { busy: true });
  const netDown = (msg) => { emit('omar:net', { up: false }); return new ApiError(0, { error: { code: 'rete', message: msg, retryable: true } }); };
  try {
    let res;
    try { res = await fetch('/api' + url, { method: 'POST', signal, headers: { ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body || {}) }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw netDown('Impossibile raggiungere il server. Controlla la connessione di rete e riprova.'); }
    emit('omar:net', { up: true });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('event-stream')) {
      const json = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
      if (res.status === 401 && auth.token) { auth.token = null; window.dispatchEvent(new CustomEvent('omar:logout')); }
      if (!res.ok) { emit('omar:ai', { ok: res.status !== 502 }); throw new ApiError(res.status, json); }
      throw new ApiError(res.status, { error: { code: 'risposta_vuota', message: 'Il tutor non ha dato nessuna risposta. Riprova.', retryable: true } });
    }
    const reader = res.body.getReader(); const dec = new TextDecoder('utf-8'); let buf = ''; let result = null; let failure = null;
    const handle = (block) => {
      const ev = /^event: ?(.*)$/m.exec(block); const dt = /^data: ?(.*)$/m.exec(block);
      if (!ev || !dt) return; // righe di commento (": ping") = segnale di vita del server
      let data; try { data = JSON.parse(dt[1]); } catch { return; }
      const kind = ev[1].trim(); if (kind === 'done') result = data; else if (kind === 'error') failure = data?.error || { code: 'errore_interno', message: 'Si è verificato un errore. Riprova.' }; else onEvent?.(kind, data);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.search(/\r?\n\r?\n/)) >= 0) { const m = /\r?\n\r?\n/.exec(buf); handle(buf.slice(0, i)); buf = buf.slice(i + m[0].length); }
      }
      buf += dec.decode(); if (buf.trim()) handle(buf);
    } catch (e) { if (e.name === 'AbortError') throw e; throw netDown('La connessione si è interrotta mentre il tutor scriveva.'); }
    if (failure) { emit('omar:ai', { ok: failure.code !== 'ia_non_disponibile' }); throw new ApiError(failure.code === 'ia_non_disponibile' ? 502 : 500, { error: failure }); }
    if (!result) throw netDown('La connessione si è interrotta mentre il tutor scriveva.');
    emit('omar:ai', { ok: true });
    return result;
  } finally { emit('omar:busy', { busy: false }); }
}
// File binario (es. relazione PDF): restituisce un Blob, con lo stesso token e la stessa gestione degli errori
export async function getBlob(url) {
  let res; try { res = await fetch('/api' + url, { headers: auth.token ? { authorization: `Bearer ${auth.token}` } : {} }); }
  catch { emit('omar:net', { up: false }); throw new ApiError(0, { error: { code: 'rete', message: 'Impossibile raggiungere il server.' } }); }
  if (!res.ok) { const json = await res.json().catch(() => null); if (res.status === 401 && auth.token) { auth.token = null; window.dispatchEvent(new CustomEvent('omar:logout')); } throw new ApiError(res.status, json); }
  return { blob: await res.blob(), filename: decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') || '') || [])[1] || 'documento') };
}
export const get = (u) => api('GET', u); export const post = (u, b) => api('POST', u, b || {}); export const patch = (u, b) => api('PATCH', u, b || {}); export const put = (u, b) => api('PUT', u, b || {}); export const del = (u, b) => api('DELETE', u, b);

// ── realtime ──
export function createRealtime({ onEvent, onStatus, onPresence, onResync, onNotify }) {
  let ws = null; let projectId = null; let lastSeq = 0; let timer = null; let stopped = false; let tries = 0; let status = 'offline';
  const set = (s) => { status = s; onStatus?.(s); };
  const send = (o) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };
  function connect() {
    if (stopped || !auth.token) return;
    set('connecting');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => send({ type: 'auth', token: auth.token }); // il token NON viaggia nell'URL
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ready') { tries = 0; if (projectId) send({ type: 'subscribe', projectId, lastSeq }); else set('online'); }
      else if (m.type === 'subscribed') { set('online'); if (m.resync) onResync?.(); }
      else if (m.type === 'event') { if (m.event.seq > lastSeq) { lastSeq = m.event.seq; onEvent?.(m.event); } }
      else if (m.type === 'presence') onPresence?.(m.online);
      else if (m.type === 'notify') onNotify?.(m.event); // notifiche personali (trasferimenti, bacheca, scadenze): solo "c'è qualcosa di nuovo"
      else if (m.type === 'error' && m.code === 'sessione_chiusa') { stopped = true; auth.token = null; window.dispatchEvent(new CustomEvent('omar:logout')); }
      else if (m.type === 'unsubscribed') { onEvent?.({ type: 'self.unsubscribed', reason: m.reason, projectId: m.projectId }); }
      else if (m.type === 'error' && m.code === 'non_autorizzato') onEvent?.({ type: 'self.unsubscribed', reason: 'accesso_terminato', projectId });
    };
    ws.onclose = () => { ws = null; if (stopped) return set('offline'); set('reconnecting'); clearTimeout(timer); timer = setTimeout(connect, Math.min(1000 * 2 ** tries++, 15000)); };
    ws.onerror = () => { /* onclose gestisce la riconnessione */ };
  }
  return {
    start() { stopped = false; if (!ws) connect(); },
    stop() { stopped = true; clearTimeout(timer); ws?.close(); ws = null; projectId = null; set('offline'); },
    subscribe(pid, seq = 0) { projectId = pid; lastSeq = seq; if (ws?.readyState === 1) send({ type: 'subscribe', projectId: pid, lastSeq: seq }); else this.start(); },
    unsubscribe() { if (projectId) send({ type: 'unsubscribe', projectId }); projectId = null; },
    get status() { return status; },
    get lastSeq() { return lastSeq; },
  };
}
