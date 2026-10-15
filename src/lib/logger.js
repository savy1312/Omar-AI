'use strict';
// Log tecnici: mai contenuti di conversazioni, documenti, password o token.
const FORBIDDEN = /^(content|text|message|body|password|token|authorization|code|prompt|snippet|payload)$/i;
function scrub(meta) {
  const o = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (FORBIDDEN.test(k)) continue;
    o[k] = v instanceof Error ? v.message.slice(0, 200) : (typeof v === 'string' ? v.slice(0, 200) : v);
  }
  return o;
}
function make(level = process.env.LOG_LEVEL || 'info') {
  const order = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
  const lim = order[level] ?? 1;
  const emit = (lv, msg, meta) => { if (order[lv] >= lim) process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: lv, msg, ...scrub(meta) }) + '\n'); };
  return { debug: (m, x) => emit('debug', m, x), info: (m, x) => emit('info', m, x), warn: (m, x) => emit('warn', m, x), error: (m, x) => emit('error', m, x), scrub };
}
module.exports = { make, scrub };
