'use strict';
// Apre Omar AI nella sua finestra "da applicazione" (Edge/Chrome in modalità --app con un profilo separato, senza barre
// del browser) appena il server risponde, consegnandole la chiave segreta di questo avvio (data/.launch-key):
// senza la chiave l'interfaccia non si apre, quindi Omar si usa solo dall'icona e non da un normale browser.
// Se non trova Edge o Chrome usa il browser predefinito.
// Uso: node scripts/apri-finestra.js [porta]     (lo lanciano avvia-omar.bat e avvia-omar.sh)
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = process.argv[2] || process.env.PORT || 3300;
const base = `http://localhost:${port}`;
function envValue(k) {
  try { const m = new RegExp(`^${k}=(.*)$`, 'm').exec(fs.readFileSync(path.join(root, '.env'), 'utf8')); return m ? m[1].trim() : ''; } catch { return ''; }
}
const dataDir = path.resolve(root, process.env.DATA_DIR || envValue('DATA_DIR') || './data');
async function classeUrl() {
  // collegato al server della classe? (data/classe.json, scritto dall'app) → la finestra apre direttamente quello
  let c; try { c = JSON.parse(fs.readFileSync(path.join(dataDir, 'classe.json'), 'utf8')); } catch { return null; }
  if (!c?.address || !c?.key) return null;
  try { const r = await fetch(`http://${c.address}/desktop/ping`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return `http://${c.address}/desktop/apri?k=${encodeURIComponent(c.key)}`; } catch { /* non raggiungibile */ }
  console.log(`Il server della classe (${c.address}) non risponde: apro Omar su questo computer.`);
  return null;
}
function appUrl() {
  try { const { key } = JSON.parse(fs.readFileSync(path.join(dataDir, '.launch-key'), 'utf8')); if (key) return `${base}/desktop/apri?k=${encodeURIComponent(key)}`; } catch { /* modalità rete locale: nessuna chiave */ }
  return base;
}

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

async function open() {
  const url = (await classeUrl()) || appUrl();
  const [b] = browsers();
  // profilo separato: la finestra di Omar è un'app a sé (icona propria sulla barra) e non condivide nulla con il browser normale
  const flags = [`--user-data-dir=${path.join(dataDir, 'finestra-app')}`, '--no-first-run', '--no-default-browser-check', `--app=${url}`];
  if (process.platform === 'darwin') return b ? run('open', ['-na', b, '--args', ...flags]) : run('open', [url]);
  if (b) return run(b, flags);
  if (process.platform === 'win32') return run('cmd', ['/c', 'start', '""', url]);
  return run('xdg-open', [url]);
}

(async () => {
  for (let i = 0; i < 120; i++) {   // fino a 2 minuti: il primo avvio può essere lento
    try { const r = await fetch(`${base}/desktop/ping`, { signal: AbortSignal.timeout(1500) }); if (r.ok) { await open(); return; } } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('Omar non risponde ancora: chiudi questa finestra e riprova dall\'icona «Omar AI».');
})();
