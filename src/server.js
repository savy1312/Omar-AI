'use strict';
const os = require('node:os');
const { createApp } = require('./app');

const fs = require('node:fs');
const path = require('node:path');
const { server, ctx, close } = createApp();
const { cfg, log } = ctx;

const loopback = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);
if (cfg.desktopOnly && !loopback && !cfg.aula) {
  console.error(`\n  Omar AI è configurato come applicazione (solo su questo computer), ma in .env c'è HOST=${cfg.host}.`);
  console.error('  Per far lavorare in gruppo computer diversi attiva il server della classe (AULA=true, oppure dall\'app: Account > Server della classe), altrimenti togli HOST.\n');
  process.exit(1);
}
// la finestra dell'app (scripts/apri-finestra.js) legge qui la chiave di questo avvio; il file è leggibile solo dall'utente
const keyFile = path.join(cfg.dataDir, '.launch-key');

try { ctx.privacy.purgeExpired(); } catch (e) { log.error('retention iniziale', { err: e }); }

server.listen(cfg.port, cfg.host, () => {
  // la chiave si scrive solo quando la porta è davvero nostra (un secondo avvio non deve sovrascrivere quella giusta)
  if (cfg.desktopOnly) fs.writeFileSync(keyFile, JSON.stringify({ port: cfg.port, key: ctx.launchKey }), { mode: 0o600 });
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Omar AI — server avviato');
  if (cfg.aula) {
    const addrs = ctx.desktop.lanAddresses();
    console.log('  ★ SERVER DELLA CLASSE attivo: gli altri computer si collegano dall\'app (Gruppo > Collega un dispositivo > «Collegati al server della classe»)');
    console.log(`    Indirizzo: ${addrs.join('  oppure  ') || '(nessuna rete trovata)'}`);
    console.log(`    Codice d'aula: ${ctx.desktop.aulaKey}`);
    try { fs.writeFileSync(path.join(cfg.dataDir, 'COLLEGAMENTO-CLASSE.txt'), `Server della classe di Omar AI\r\nIndirizzo: ${addrs.join('  oppure  ')}\r\nCodice d'aula: ${ctx.desktop.aulaKey}\r\n`); } catch { /* facoltativo */ }
  }
  if (cfg.desktopOnly) console.log('  Modalità applicazione: Omar si apre dall\'icona «Omar AI» (non da un normale browser). Non chiudere questa finestra.');
  else console.log(`  Su questo computer:   http://localhost:${cfg.port}`);
  if (cfg.host === '0.0.0.0' && !cfg.desktopOnly) console.log(`  Dagli altri dispositivi della rete: ${lan.map((a) => `http://${a}:${cfg.port}`).join('  ')}`);
  else if (!cfg.desktopOnly) console.log('  Accessibile SOLO da questo computer (per la rete scolastica imposta HOST=0.0.0.0, vedi docs/RETE_LOCALE.md)');
  console.log(`  Provider IA: ${ctx.provider.name}${ctx.provider.simulated ? '  ⚠ SIMULAZIONE: le risposte NON sono generate da un modello IA' : ` (${ctx.provider.model})${cfg.ai.dataLeavesNetwork ? ' — i testi delle domande escono dalla rete scolastica' : ''}`}`);
  if (cfg.host === '0.0.0.0') console.log('  ⚠ Rete locale senza HTTPS: usala solo su una rete scolastica protetta (vedi docs/RETE_LOCALE.md).');
  console.log('');
});

const shutdown = () => { try { fs.rmSync(keyFile, { force: true }); } catch { /* già rimosso */ } close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`\n  La porta ${cfg.port} è già in uso: Omar è probabilmente già acceso. Riapri l'icona «Omar AI».\n`); process.exit(1); } throw e; });
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
