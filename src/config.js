'use strict';
// Configurazione letta SOLO da variabili d'ambiente (.env opzionale). Nessuna credenziale nel codice.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|si|sì|on)$/i.test(String(v)));

function loadConfig(over = {}) {
  const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env');
  if (!over.skipEnvFile && fs.existsSync(envFile)) {
    try { process.loadEnvFile(envFile); } catch { /* .env non valido: valori di default */ }
  }
  const e = { ...process.env, ...(over.env || {}) };
  const dataDir = path.resolve(over.dataDir || e.DATA_DIR || './data');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  let secret = e.SERVER_SECRET;
  if (!secret) {
    const f = path.join(dataDir, '.server-secret');
    if (fs.existsSync(f)) secret = fs.readFileSync(f, 'utf8').trim();
    else { secret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, secret, { mode: 0o600 }); }
  }

  // Senza configurazione Omar usa il modello LOCALE di Ollama (pronto all'uso a scuola). La simulazione "demo" va chiesta esplicitamente.
  const provider = (e.AI_PROVIDER || 'openai-compatible').toLowerCase();
  if (!e.AI_PROVIDER) { e.AI_BASE_URL = e.AI_BASE_URL || 'http://127.0.0.1:11434/v1'; e.AI_MODEL = e.AI_MODEL || 'qwen2.5:7b'; e.AI_TIMEOUT_MS = e.AI_TIMEOUT_MS || '120000'; }
  const local = /^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(e.AI_BASE_URL || '');
  return {
    env: e.NODE_ENV || 'development',
    port: int(e.PORT, 3300),
    host: e.HOST || '127.0.0.1', // per la rete locale: HOST=0.0.0.0 (vedi docs/RETE_LOCALE.md)
    trustProxy: bool(e.TRUST_PROXY, false),
    dataDir,
    dbFile: over.dbFile || e.DB_FILE || path.join(dataDir, 'omar.db'),
    secret,
    ai: {
      provider, // anthropic | openai-compatible | demo
      apiKey: e.AI_API_KEY || '',
      model: e.AI_MODEL || '',
      baseUrl: e.AI_BASE_URL || '',
      timeoutMs: int(e.AI_TIMEOUT_MS, 45000),
      maxTokens: int(e.AI_MAX_TOKENS, 1200),
      temperature: Number(e.AI_TEMPERATURE ?? 0.4),
      retries: int(e.AI_RETRIES, 1),
      dailyLimitPerUser: int(e.AI_DAILY_LIMIT_PER_USER, 150),
      // lettura di immagini, foto e scansioni: modello "vista" (vuoto = trovato in automatico tra i modelli di Ollama)
      visionModel: e.AI_VISION_MODEL || '',
      visionEnabled: bool(e.AI_VISION, true),
      visionTimeoutMs: int(e.AI_VISION_TIMEOUT_MS, 240000),
      dataLeavesNetwork: provider === 'anthropic' || (provider === 'openai-compatible' && !local),
    },
    auth: {
      sessionTtlHours: int(e.SESSION_TTL_HOURS, 12),
      studentCode: e.STUDENT_REGISTRATION_CODE || '',
      teacherCode: e.TEACHER_REGISTRATION_CODE || '',
      openRegistration: bool(e.ALLOW_OPEN_REGISTRATION, false),
      // Gli STUDENTI possono registrarsi solo con un'email di questo dominio (stringa vuota = nessun vincolo, solo per prove)
      studentEmailDomain: String(e.STUDENT_EMAIL_DOMAIN ?? 'itiomar.net').trim().toLowerCase().replace(/^@/, ''),
      minPasswordLength: int(e.MIN_PASSWORD_LENGTH, 10),
    },
    limits: {
      maxUploadBytes: int(e.MAX_UPLOAD_MB, 25) * 1024 * 1024,
      maxProjectBytes: int(e.MAX_PROJECT_MB, 200) * 1024 * 1024,
      maxMessageChars: int(e.MAX_MESSAGE_CHARS, 4000),
      explainMaxChars: int(e.EXPLAIN_MAX_CHARS, 1200),
      inviteTtlMinDefault: int(e.INVITE_TTL_MIN, 30),
      inviteTtlMinMax: int(e.INVITE_TTL_MIN_MAX, 24 * 60),
      inviteMaxUses: int(e.INVITE_MAX_USES, 10),
      inviteFailsPerUser: int(e.INVITE_FAILS_PER_USER, 5),
      inviteFailsPerIp: int(e.INVITE_FAILS_PER_IP, 30),
      ipRequestsPerMin: int(e.IP_REQUESTS_PER_MIN, 600),
      messagesPerMin: int(e.MESSAGES_PER_MIN, 20),
    },
    retention: {
      chatDays: int(e.RETENTION_CHAT_DAYS, 180),
      authSessionDays: int(e.RETENTION_AUTH_DAYS, 30),
      auditDays: int(e.RETENTION_AUDIT_DAYS, 90),
      eventsDays: int(e.RETENTION_EVENTS_DAYS, 60),
    },
    // Accesso al web: lettura di link indicati dallo studente e ricerca («Cerca»). Le richieste partono SOLO dal server.
    web: {
      linksEnabled: bool(e.LINKS_ENABLED, true),
      searchProvider: String(e.WEB_SEARCH_PROVIDER || 'duckduckgo').toLowerCase(), // duckduckgo | brave | searxng | off
      braveKey: e.BRAVE_API_KEY || '',
      braveUrl: e.BRAVE_API_URL || 'https://api.search.brave.com/res/v1/web/search',
      searxngUrl: e.SEARXNG_URL || '',
      ddgUrl: e.WEB_SEARCH_DDG_URL || 'https://html.duckduckgo.com/html/',
      maxResults: Math.min(8, Math.max(1, int(e.WEB_SEARCH_MAX_RESULTS, 5))),
      fetchPages: Math.min(3, Math.max(0, int(e.WEB_SEARCH_FETCH_PAGES, 2))), // quante pagine dei risultati leggere per intero (0 = solo anteprime)
      timeoutMs: int(e.WEB_TIMEOUT_MS, 8000),
      maxPageBytes: int(e.WEB_MAX_PAGE_KB, 2048) * 1024,
      searchPerMin: int(e.WEB_SEARCH_PER_MIN, 10),
      linksPerMin: int(e.LINKS_PER_MIN, 12),
      allowPrivate: bool(e.ALLOW_PRIVATE_LINKS, false), // SOLO per le prove automatiche su server locali finti: SPEGNE la protezione contro l'accesso a reti interne
    },
    // Esecuzione di codice Python/C++ sul SERVER (Quick Tools → Live Code Runner). SPENTA di default: chi la accende
    // permette agli utenti di eseguire programmi sul computer che fa da server (con limiti di tempo e di output, ma senza un vero isolamento).
    // JavaScript gira sempre e solo nel browser, in un worker isolato senza rete.
    tools: {
      runnerEnabled: bool(e.CODE_RUNNER_ENABLED, false),
      pythonCmd: e.CODE_RUNNER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      cxxCmd: e.CODE_RUNNER_CXX || 'g++',
      timeoutMs: int(e.CODE_RUNNER_TIMEOUT_MS, 5000),
      perMin: int(e.CODE_RUNNER_PER_MIN, 8),
    },
    features: {
      blackboxAi: bool(e.BLACKBOX_AI, true),
      journalAi: bool(e.JOURNAL_AI, true),
    },
    ...over.merge,
  };
}
module.exports = { loadConfig };
