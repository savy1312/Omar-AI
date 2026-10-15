'use strict';
// Live Code Runner lato server per Python e C++ (Quick Tools). SPENTO di default (CODE_RUNNER_ENABLED=false).
// Quando è acceso: solo utenti autenticati, limite al minuto, codice max 20.000 caratteri, input max 4.000,
// tempo massimo di esecuzione, output troncato a 64 KB, cartella temporanea cancellata subito dopo, nessuna variabile d'ambiente del server.
// NON è un sandbox vero: va acceso solo su un computer dedicato (vedi .env.example).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { E } = require('../lib/errors');
const { RateLimiter } = require('../lib/ratelimit');

const MAX_OUT = 64 * 1024;

function createRunner(ctx) {
  const { cfg, log } = ctx;
  const t = cfg.tools || {};
  const limiter = new RateLimiter(t.perMin || 8, 60_000); ctx.limiters?.push(limiter);
  const which = {};
  function available(cmd) {
    if (cmd in which) return which[cmd];
    try { const r = require('node:child_process').spawnSync(cmd, ['--version'], { timeout: 4000, windowsHide: true }); which[cmd] = r.status === 0; } catch { which[cmd] = false; }
    return which[cmd];
  }
  const info = () => ({
    enabled: !!t.runnerEnabled,
    languages: { javascript: { where: 'browser', available: true }, python: { where: 'server', available: !!t.runnerEnabled && available(t.pythonCmd) }, cpp: { where: 'server', available: !!t.runnerEnabled && available(t.cxxCmd) } },
    note: t.runnerEnabled ? 'Python e C++ vengono eseguiti sul server della scuola con limiti di tempo.' : 'Python e C++ non sono attivi su questo server (l’amministratore può accenderli). JavaScript funziona sempre, direttamente nel browser.',
  });

  function exec(cmd, args, { cwd, input = '', timeoutMs }) {
    return new Promise((resolve) => {
      const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: cwd, TMP: cwd, HOME: cwd, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
      let out = ''; let err = ''; let killed = false; const t0 = Date.now();
      let p; try { p = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, stdout: '', stderr: String(e.message), ms: 0 }); return; }
      const timer = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch { /* già terminato */ } }, timeoutMs);
      const cap = (s, d) => (s.length < MAX_OUT ? s + d.toString('utf8') : s);
      p.stdout.on('data', (d) => { out = cap(out, d); if (out.length >= MAX_OUT) { killed = true; p.kill('SIGKILL'); } });
      p.stderr.on('data', (d) => { err = cap(err, d); });
      p.on('error', (e) => { err += String(e.message); });
      p.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: out.slice(0, MAX_OUT), stderr: err.slice(0, MAX_OUT), ms: Date.now() - t0, killed }); });
      try { p.stdin.end(String(input).slice(0, 4000)); } catch { /* stdin chiuso */ }
    });
  }

  async function run(user, { language, code, stdin = '' } = {}) {
    if (!t.runnerEnabled) throw E.forbidden('L’esecuzione di Python e C++ non è attiva su questo server.');
    if (!['python', 'cpp'].includes(language)) throw E.bad('Linguaggio non supportato sul server.');
    code = String(code || ''); if (!code.trim()) throw E.bad('Scrivi del codice da eseguire.'); if (code.length > 20000) throw E.bad('Codice troppo lungo (massimo 20.000 caratteri).');
    if (!limiter.allow(user.id)) throw E.rate('Stai eseguendo molti programmi: attendi qualche secondo.', { retryAfterSec: limiter.retryAfterSec(user.id) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omar-run-'));
    try {
      const timeoutMs = t.timeoutMs || 5000;
      if (language === 'python') {
        if (!available(t.pythonCmd)) throw E.bad('Python non è installato sul server.');
        fs.writeFileSync(path.join(dir, 'main.py'), code);
        const r = await exec(t.pythonCmd, ['-I', '-B', 'main.py'], { cwd: dir, input: stdin, timeoutMs });
        log.info('runner', { language, ms: r.ms, code: r.code });
        return { language, phase: 'run', ...r, timedOut: r.killed && r.ms >= timeoutMs - 50 };
      }
      if (!available(t.cxxCmd)) throw E.bad('Il compilatore C++ non è installato sul server.');
      fs.writeFileSync(path.join(dir, 'main.cpp'), code);
      const exe = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
      const c = await exec(t.cxxCmd, ['-std=c++17', '-O1', '-o', exe, 'main.cpp'], { cwd: dir, timeoutMs: Math.max(timeoutMs, 15000) });
      if (c.code !== 0) return { language, phase: 'compile', ...c };
      const r = await exec(exe, [], { cwd: dir, input: stdin, timeoutMs });
      log.info('runner', { language, ms: r.ms, code: r.code });
      return { language, phase: 'run', ...r, timedOut: r.killed && r.ms >= timeoutMs - 50 };
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignora */ } }
  }
  return { info, run };
}
module.exports = { createRunner };
