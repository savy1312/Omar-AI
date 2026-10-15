'use strict';
// Apre Omar AI in una finestra "da applicazione" (Edge/Chrome in modalità --app, senza barre del browser)
// appena il server risponde. Se non trova Edge o Chrome usa il browser predefinito.
// Uso: node scripts/apri-finestra.js [porta]     (lo lanciano avvia-omar.bat e avvia-omar.sh)
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = process.argv[2] || process.env.PORT || 3300;
const url = `http://localhost:${port}`;

function browsers() {
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe'];
    return rel.flatMap((r) => roots.map((p) => path.join(p, r))).filter((p) => fs.existsSync(p));
  }
  if (process.platform === 'darwin') return ['Google Chrome', 'Microsoft Edge', 'Chromium'].filter((a) => fs.existsSync(`/Applications/${a}.app`));
  const dirs = (process.env.PATH || '').split(':');
  return ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].map((b) => dirs.map((d) => path.join(d, b)).find((p) => fs.existsSync(p))).filter(Boolean);
}
const run = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();

function open() {
  const [b] = browsers();
  if (process.platform === 'darwin') return b ? run('open', ['-na', b, '--args', `--app=${url}`]) : run('open', [url]);
  if (b) return run(b, [`--app=${url}`]);
  if (process.platform === 'win32') return run('cmd', ['/c', 'start', '""', url]);
  return run('xdg-open', [url]);
}

(async () => {
  for (let i = 0; i < 120; i++) {   // fino a 2 minuti: il primo avvio può essere lento
    try { const r = await fetch(`${url}/api/info`, { signal: AbortSignal.timeout(1500) }); if (r.ok) { open(); return; } } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`Omar non risponde ancora: aprilo a mano su ${url}`);
})();
