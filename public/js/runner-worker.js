// Worker del Live Code Runner (JavaScript). Gira isolato: niente DOM, niente rete (la CSP di questo file vieta ogni
// connessione), niente accesso ai dati della pagina. Il codice dello studente viene eseguito qui e l'output torna alla pagina.
/* eslint-disable no-restricted-globals */
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) { try { self[k] = undefined; } catch { /* non modificabile */ } }
const fmt = (v) => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x === undefined ? '«undefined»' : x), 2) ?? String(v); } catch { return String(v); }
};
self.onmessage = async (e) => {
  const { code, stdin = '' } = e.data || {};
  const lines = String(stdin).split('\n'); let li = 0;
  const out = (kind) => (...a) => self.postMessage({ type: 'out', kind, text: a.map(fmt).join(' ') });
  const con = { log: out('log'), info: out('log'), warn: out('warn'), error: out('error'), table: out('log'), debug: out('log') };
  const t0 = performance.now();
  try {
    // input() legge una riga dall'"input del programma" (come in Python), prompt() lo stesso
    const fn = new Function('console', 'input', 'prompt', `"use strict";\nreturn (async () => {\n${code}\n})();`);
    const r = await fn(con, () => (li < lines.length ? lines[li++] : ''), () => (li < lines.length ? lines[li++] : ''));
    if (r !== undefined) self.postMessage({ type: 'out', kind: 'result', text: `← ${fmt(r)}` });
    self.postMessage({ type: 'done', ok: true, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ type: 'out', kind: 'error', text: err && err.stack ? String(err.stack).split('\n').slice(0, 3).join('\n') : fmt(err) });
    self.postMessage({ type: 'done', ok: false, ms: Math.round(performance.now() - t0) });
  }
};
