'use strict';
// Crea un account docente o amministratore dalla riga di comando.
// Uso:  npm run seed:admin -- <nome-utente> "<Nome Cognome>" <ruolo: teacher|admin>
// La password viene chiesta in modo interattivo (non resta nella cronologia della shell) oppure letta da OMAR_NEW_PASSWORD.
const readline = require('node:readline');
const { createContext } = require('../src/app');

const [username, displayName, role = 'teacher'] = process.argv.slice(2);
if (!username || !displayName || !['teacher', 'admin'].includes(role)) {
  console.error('Uso: npm run seed:admin -- <nome-utente> "<Nome Cognome>" <teacher|admin>');
  process.exit(1);
}
function ask(q) {
  return new Promise((res) => {
    if (process.env.OMAR_NEW_PASSWORD) return res(process.env.OMAR_NEW_PASSWORD);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(a); });
  });
}
(async () => {
  const ctx = createContext({});
  const password = await ask('Password (almeno 10 caratteri): ');
  try {
    if (ctx.db.get('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL', username)) throw new Error('Nome utente già esistente: scegline un altro.');
    const u = ctx.auth.createUser({ username, displayName, password, role });
    console.log(`Account creato: ${u.username} (${u.role}).`);
  } catch (e) { console.error('Errore:', e.message); process.exitCode = 1; }
  ctx.db.close?.();
})();
