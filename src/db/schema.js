'use strict';
// Migrazioni versionate. Per modificare lo schema: nuovo elemento in fondo all'array (mai modificare i precedenti).
module.exports = [
{ id: 1, name: 'init', sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE learning_objectives (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, topic_id TEXT, text TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, subject_id TEXT, owner_id TEXT NOT NULL REFERENCES users(id),
  requires_approval INTEGER NOT NULL DEFAULT 1, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, closed_at TEXT
);
CREATE TABLE memberships (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member','teacher')),
  status TEXT NOT NULL CHECK (status IN ('active','pending','left','revoked','rejected')),
  workstream TEXT, auto_share INTEGER NOT NULL DEFAULT 0, auto_share_consent_at TEXT,
  joined_at TEXT, left_at TEXT, last_briefing_at TEXT, created_at TEXT NOT NULL,
  UNIQUE (project_id, user_id)
);
CREATE INDEX idx_memb_user ON memberships(user_id, status);
CREATE TABLE invites (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, subject_id TEXT NOT NULL, topic_id TEXT,
  mode TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'base', title TEXT, sandbox INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_sess_user ON chat_sessions(user_id, updated_at);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL,
  meta_json TEXT, share_excluded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX idx_msg_sess ON messages(session_id, created_at);
CREATE TABLE materials (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, subject_id TEXT, topic_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('personale','gruppo','corso')),
  name TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE material_versions (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('ia_testo','visualizzabile','solo_archivio')),
  size INTEGER NOT NULL, sha256 TEXT NOT NULL, storage_name TEXT NOT NULL, uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL, available_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('ricevuto','disponibile','in_elaborazione','pronto','fallito','non_supportato')),
  error TEXT, page_count INTEGER, chunk_count INTEGER NOT NULL DEFAULT 0, injection_flags INTEGER NOT NULL DEFAULT 0,
  UNIQUE (material_id, version)
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, material_id TEXT NOT NULL, version_id TEXT NOT NULL,
  ord INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL
);
CREATE INDEX idx_chunks_ver ON chunks(version_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE shared_contributions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL, author_label TEXT,
  source_session_id TEXT, source_message_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('messaggio','sintesi')), content TEXT NOT NULL, workstream TEXT,
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo','ritirato')),
  auto INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, retracted_at TEXT
);
CREATE INDEX idx_contrib_proj ON shared_contributions(project_id, status, created_at);
CREATE TABLE share_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at TEXT NOT NULL, responded_at TEXT
);
CREATE TABLE journal_items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT, assignee_id TEXT, status TEXT NOT NULL CHECK (status IN ('proposta','ipotesi','da_verificare','confermata','superata')),
  contested INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('manuale','ia','regole')), source_kind TEXT, source_ref TEXT,
  fingerprint TEXT, redacted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_journal_proj ON journal_items(project_id, updated_at);
CREATE UNIQUE INDEX idx_journal_fp ON journal_items(project_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE TABLE journal_revisions (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES journal_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE journal_reviews (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES journal_items(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL CHECK (action IN ('conferma','correzione','contestazione')),
  note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, status TEXT NOT NULL CHECK (status IN ('proposta','confermata','superata')),
  version INTEGER NOT NULL DEFAULT 1, proposed_by TEXT REFERENCES users(id) ON DELETE SET NULL, proposed_label TEXT,
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL, confirmed_at TEXT, supersedes_id TEXT,
  source_ref TEXT, param_refs TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_parameters (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component TEXT NOT NULL, name TEXT NOT NULL, quantity TEXT NOT NULL, kind TEXT NOT NULL,
  value REAL NOT NULL, unit TEXT NOT NULL, linked_to TEXT, author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT, confirmed INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL DEFAULT 'manuale',
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo','superato')),
  supersedes_id TEXT, source_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_param_proj ON project_parameters(project_id, status);
CREATE TABLE incompat_alerts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL, level TEXT NOT NULL CHECK (level IN ('verificato','possibile','dati_insufficienti')),
  priority TEXT NOT NULL CHECK (priority IN ('alta','media','bassa')), priority_reason TEXT NOT NULL,
  title TEXT NOT NULL, reason TEXT NOT NULL, involved_json TEXT NOT NULL, sources_json TEXT NOT NULL,
  missing_json TEXT NOT NULL, guiding_question TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'regola',
  fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aperto'
    CHECK (status IN ('aperto','in_verifica','risolto','falso_positivo','non_piu_rilevato')),
  resolution_note TEXT, resolved_by TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_alert_proj ON incompat_alerts(project_id, status);
CREATE TABLE guided_checks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, alert_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, template_id TEXT NOT NULL,
  inputs_json TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  hint_level INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'in_corso' CHECK (status IN ('in_corso','verificato')),
  confirmed_value REAL, confirmed_unit TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sync_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, entity_type TEXT, entity_id TEXT, actor_id TEXT, data_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_events_proj ON sync_events(project_id, seq);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, project_id TEXT, action TEXT NOT NULL, meta_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
` },
{ id: 2, name: 'link_e_allegati_di_sessione', sql: `
ALTER TABLE material_versions ADD COLUMN source_url TEXT;
CREATE TABLE session_materials (
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, PRIMARY KEY (session_id, material_id)
);
` },
{ id: 3, name: 'riconoscimento_automatico', sql: `
ALTER TABLE chat_sessions ADD COLUMN pins TEXT;
ALTER TABLE chat_sessions ADD COLUMN detect_json TEXT;
UPDATE chat_sessions SET pins = '{"subject":true,"topic":true,"mode":true,"level":true}';
` },
{ id: 4, name: 'hub_planner_bacheca_trasferimenti', sql: `
ALTER TABLE materials ADD COLUMN folder TEXT;
ALTER TABLE auth_sessions ADD COLUMN device TEXT;
CREATE TABLE transfers (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items_json TEXT NOT NULL, folder TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  result_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, responded_at TEXT
);
CREATE INDEX idx_transfers_to ON transfers(to_id, status);
CREATE INDEX idx_transfers_from ON transfers(from_id, status);
CREATE TABLE project_tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'da_fare' CHECK (status IN ('proposta','da_fare','in_corso','revisione','fatto')),
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_label TEXT,
  origin TEXT NOT NULL DEFAULT 'manuale' CHECK (origin IN ('manuale','regole','ia')), source_kind TEXT, source_ref TEXT, reason TEXT,
  fingerprint TEXT, due_at TEXT, position REAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_proj ON project_tasks(project_id, status, position);
CREATE UNIQUE INDEX idx_tasks_fp ON project_tasks(project_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE TABLE project_snippets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL, author_label TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('codice','formula','schema','nota','link')), title TEXT NOT NULL, content TEXT NOT NULL, language TEXT,
  source_kind TEXT, source_ref TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_snip_proj ON project_snippets(project_id, deleted_at);
CREATE TABLE deadlines (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('personale','gruppo','corso')),
  kind TEXT NOT NULL CHECK (kind IN ('progetto','verifica','laboratorio','compito','interrogazione','altro')),
  title TEXT NOT NULL, subject_id TEXT, due_at TEXT NOT NULL, estimate_hours REAL NOT NULL DEFAULT 2, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_dead_owner ON deadlines(owner_id); CREATE INDEX idx_dead_proj ON deadlines(project_id);
CREATE TABLE deadline_progress (
  deadline_id TEXT NOT NULL REFERENCES deadlines(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0, done_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (deadline_id, user_id)
);
CREATE TABLE user_prefs (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, prefs_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE bulletins (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('circolare','avviso','concorso','evento')),
  campus TEXT NOT NULL DEFAULT 'Oleggio', number TEXT, title TEXT NOT NULL, body TEXT NOT NULL, link TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, example INTEGER NOT NULL DEFAULT 0, author_id TEXT REFERENCES users(id) ON DELETE SET NULL, author_label TEXT,
  published_at TEXT NOT NULL, expires_at TEXT, deadline_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE bulletin_reads (bulletin_id TEXT NOT NULL REFERENCES bulletins(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, read_at TEXT NOT NULL, PRIMARY KEY (bulletin_id, user_id));
` },
];
