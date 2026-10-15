'use strict';
const { DatabaseSync } = require('node:sqlite');
const migrations = require('./schema');

// Wrapper sincrono: parametri posizionali, undefined -> null, transazioni annidabili.
function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const prep = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  let depth = 0;
  const db = {
    raw,
    get: (sql, ...p) => prep(sql).get(...norm(p)),
    all: (sql, ...p) => prep(sql).all(...norm(p)),
    run: (sql, ...p) => prep(sql).run(...norm(p)),
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      raw.exec('BEGIN IMMEDIATE'); depth = 1;
      try { const r = fn(); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* già annullata */ } throw e; }
      finally { depth = 0; }
    },
    close: () => raw.close(),
  };
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.all('SELECT id FROM schema_migrations').map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    db.tx(() => { db.exec(m.sql); db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)', m.id, m.name, new Date().toISOString()); });
  }
}
module.exports = { openDb };
