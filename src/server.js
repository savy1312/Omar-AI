'use strict';
const os = require('node:os');
const { createApp } = require('./app');

const { server, ctx, close } = createApp();
const { cfg, log } = ctx;

try { ctx.privacy.purgeExpired(); } catch (e) { log.error('retention iniziale', { err: e }); }

server.listen(cfg.port, cfg.host, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Omar AI — server avviato');
  console.log(`  Su questo computer:   http://localhost:${cfg.port}`);
  if (cfg.host === '0.0.0.0') console.log(`  Dagli altri dispositivi della rete: ${lan.map((a) => `http://${a}:${cfg.port}`).join('  ')}`);
  else console.log('  Accessibile SOLO da questo computer (per la rete scolastica imposta HOST=0.0.0.0, vedi docs/RETE_LOCALE.md)');
  console.log(`  Provider IA: ${ctx.provider.name}${ctx.provider.simulated ? '  ⚠ SIMULAZIONE: le risposte NON sono generate da un modello IA' : ` (${ctx.provider.model})${cfg.ai.dataLeavesNetwork ? ' — i testi delle domande escono dalla rete scolastica' : ''}`}`);
  if (cfg.host === '0.0.0.0') console.log('  ⚠ Rete locale senza HTTPS: usala solo su una rete scolastica protetta (vedi docs/RETE_LOCALE.md).');
  console.log('');
});

const shutdown = () => { close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
