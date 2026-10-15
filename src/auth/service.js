'use strict';
const crypto = require('node:crypto');
const { E } = require('../lib/errors');
const { now, uuid, hmac } = require('../lib/util');

const USERNAME_RE = /^[a-z0-9._%+@-]{3,64}$/i; // nome utente semplice oppure indirizzo email
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createAuth(ctx) {
  const { db, cfg } = ctx;
  const SCRYPT = { N: 16384, r: 8, p: 1 };
  const hashPassword = (pw) => {
    const salt = crypto.randomBytes(16);
    return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64, SCRYPT).toString('base64')}`;
  };
  const DUMMY = hashPassword('dummy-password-for-timing');
  const verifyPassword = (pw, stored) => {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const exp = Buffer.from(h, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), exp.length, SCRYPT);
    return crypto.timingSafeEqual(exp, got);
  };
  const pub = (u) => u && ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, isDemo: !!u.is_demo });

  function createUser({ username, displayName, password, role = 'student', isDemo = false }) {
    username = String(username || '').trim();
    displayName = String(displayName || '').trim();
    if (!USERNAME_RE.test(username) || (username.includes('@') && !EMAIL_RE.test(username))) throw E.bad('Inserisci un nome utente (3-32 caratteri: lettere, numeri, punto, trattino) oppure un indirizzo email valido.', 'username_non_valido');
    if (displayName.length < 2 || displayName.length > 40) throw E.bad('Il nome visualizzato deve avere 2-40 caratteri (puoi usare un soprannome).', 'nome_non_valido');
    if (String(password || '').length < cfg.auth.minPasswordLength) throw E.bad(`La password deve avere almeno ${cfg.auth.minPasswordLength} caratteri.`, 'password_debole');
    if (db.get('SELECT 1 x FROM users WHERE username = ?', username)) throw E.conflict('Nome utente già in uso.');
    const id = uuid();
    db.run('INSERT INTO users (id, username, display_name, password_hash, role, is_demo, created_at) VALUES (?,?,?,?,?,?,?)',
      id, username, displayName, hashPassword(password), role, isDemo ? 1 : 0, now());
    return pub(db.get('SELECT * FROM users WHERE id = ?', id));
  }

  function register({ username, displayName, password, registrationCode }) {
    username = String(username || '').trim();
    let role = null;
    const code = String(registrationCode || '').trim();
    // i codici non distinguono maiuscole/minuscole né spazi ai bordi (errori frequenti di digitazione)
    const eq = (a, b) => { a = String(a || '').trim().toLowerCase(); b = String(b || '').toLowerCase(); return a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
    if (eq(cfg.auth.teacherCode, code)) role = 'teacher';
    else if (eq(cfg.auth.studentCode, code)) role = 'student';
    else if (cfg.auth.openRegistration && !code) role = 'student'; // solo sviluppo/demo; mai docente
    if (!role) throw E.forbidden('Codice di registrazione non valido. Chiedilo al tuo docente.');
    const domain = cfg.auth.studentEmailDomain;
    if (role === 'student' && domain) { // gli studenti si registrano solo con l'email scolastica; il nome utente coincide con l'email
      const email = String(username || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || !email.endsWith(`@${domain}`)) throw E.forbidden(`Gli studenti possono registrarsi solo con l'email scolastica (@${domain}).`, 'email_non_scolastica');
      username = email;
    }
    return createUser({ username, displayName, password, role });
  }

  // Descrizione leggibile del dispositivo (solo browser e sistema, niente IP): serve a riconoscere le proprie sessioni.
  function deviceLabel(ua = '') {
    ua = String(ua); const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'App' : 'Browser';
    const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
    return o ? `${b} su ${o}` : b;
  }
  function login(username, password, { userAgent } = {}) {
    const u = db.get('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', String(username || ''));
    const ok = verifyPassword(String(password || ''), u ? u.password_hash : DUMMY);
    if (!u || !ok) throw E.unauth('Nome utente o password non corretti.');
    const token = crypto.randomBytes(32).toString('base64url');
    const t = Date.now();
    db.run('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen, device) VALUES (?,?,?,?,?,?)',
      hmac(cfg.secret, token), u.id, new Date(t).toISOString(), new Date(t + cfg.auth.sessionTtlHours * 3600e3).toISOString(), new Date(t).toISOString(), deviceLabel(userAgent));
    return { token, user: pub(u) };
  }

  function authenticate(token) {
    if (!token) return null;
    const h = hmac(cfg.secret, token);
    const s = db.get('SELECT s.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.deleted_at IS NULL', h);
    if (!s) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) { db.run('DELETE FROM auth_sessions WHERE token_hash = ?', h); return null; }
    db.run('UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?', now(), h);
    return pub(db.get('SELECT * FROM users WHERE id = ?', s.user_id));
  }
  // Chi si occupa delle connessioni in tempo reale si registra qui: quando una sessione viene chiusa, i suoi WebSocket si chiudono subito.
  const revokeListeners = new Set();
  const onRevoke = (fn) => { revokeListeners.add(fn); return () => revokeListeners.delete(fn); };
  const notifyRevoked = (hashes) => { if (!hashes.length) return; for (const fn of revokeListeners) { try { fn(hashes); } catch { /* ignora */ } } };
  const tokenHash = (token) => (token ? hmac(cfg.secret, token) : null);
  const logout = (token) => { if (!token) return; const h = tokenHash(token); db.run('DELETE FROM auth_sessions WHERE token_hash = ?', h); notifyRevoked([h]); };

  // ───── account ─────
  const ROLE_LABEL = { student: 'Studente', teacher: 'Docente', admin: 'Amministratore' };
  const sid = (hash) => hash.slice(0, 16); // identificativo pubblico della sessione: un prefisso dell'hash, mai il token
  function accountInfo(user, token) {
    const u = db.get('SELECT * FROM users WHERE id = ?', user.id);
    const mine = tokenHash(token);
    const sessions = db.all('SELECT token_hash, created_at, last_seen, expires_at, device FROM auth_sessions WHERE user_id = ? ORDER BY last_seen DESC', user.id)
      .filter((s) => new Date(s.expires_at).getTime() > Date.now())
      .map((s) => ({ id: sid(s.token_hash), device: s.device || 'Dispositivo', createdAt: s.created_at, lastSeen: s.last_seen, current: s.token_hash === mine }));
    const counts = {
      chats: db.get('SELECT COUNT(*) n FROM chat_sessions WHERE user_id = ?', user.id).n,
      materials: db.get("SELECT COUNT(*) n FROM materials WHERE owner_id = ? AND deleted_at IS NULL AND visibility = 'personale'", user.id).n,
      groups: db.get("SELECT COUNT(*) n FROM memberships WHERE user_id = ? AND status = 'active'", user.id).n,
    };
    return { user: pub(u), roleLabel: ROLE_LABEL[u.role], createdAt: u.created_at, email: u.username.includes('@') ? u.username : null, sessions, counts, minPasswordLength: cfg.auth.minPasswordLength };
  }
  function updateProfile(user, { displayName }) {
    const d = String(displayName ?? '').trim();
    if (d.length < 2 || d.length > 40) throw E.bad('Il nome visualizzato deve avere 2-40 caratteri (puoi usare un soprannome).', 'nome_non_valido');
    db.run('UPDATE users SET display_name = ? WHERE id = ?', d, user.id);
    return pub(db.get('SELECT * FROM users WHERE id = ?', user.id));
  }
  function changePassword(user, token, { currentPassword, newPassword, signOutOthers = true }) {
    const u = db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', user.id);
    if (!u || !verifyPassword(String(currentPassword || ''), u.password_hash)) throw E.bad('La password attuale non è corretta.', 'password_errata');
    const pw = String(newPassword || '');
    if (pw.length < cfg.auth.minPasswordLength) throw E.bad(`La nuova password deve avere almeno ${cfg.auth.minPasswordLength} caratteri.`, 'password_debole');
    if (pw.length > 200) throw E.bad('La nuova password è troppo lunga (massimo 200 caratteri).', 'password_lunga');
    if (pw === String(currentPassword)) throw E.bad('La nuova password deve essere diversa da quella attuale.', 'password_uguale');
    const low = pw.toLowerCase();
    if (low.includes(u.username.toLowerCase().split('@')[0]) || (u.display_name.length >= 3 && low.includes(u.display_name.toLowerCase()))) throw E.bad('La password non deve contenere il tuo nome o il nome utente.', 'password_debole');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), u.id);
    let closed = 0;
    if (signOutOthers) closed = revokeOthers(user, token);
    return { ok: true, closedSessions: closed };
  }
  function revokeSession(user, token, id) {
    if (!/^[0-9a-f]{16}$/.test(String(id || ''))) throw E.bad('Sessione non valida.');
    const s = db.all('SELECT token_hash FROM auth_sessions WHERE user_id = ?', user.id).find((x) => sid(x.token_hash) === id);
    if (!s) throw E.notFound('Sessione non trovata.');
    if (s.token_hash === tokenHash(token)) throw E.bad('Per chiudere la sessione di questo dispositivo usa «Esci».', 'sessione_corrente');
    db.run('DELETE FROM auth_sessions WHERE token_hash = ?', s.token_hash); notifyRevoked([s.token_hash]);
    return { ok: true };
  }
  function revokeOthers(user, token) {
    const mine = tokenHash(token);
    const others = db.all('SELECT token_hash FROM auth_sessions WHERE user_id = ? AND token_hash != ?', user.id, mine || '').map((x) => x.token_hash);
    db.run('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', user.id, mine || ''); notifyRevoked(others);
    return others.length;
  }
  const bearer = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };

  const requireAuth = (req, _res, next) => {
    try { const u = authenticate(bearer(req)); if (!u) throw E.unauth(); req.user = u; req.token = bearer(req); next(); } catch (e) { next(e); }
  };
  const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user.role) ? next() : next(E.forbidden('Funzione riservata ai docenti.')));
  return { createUser, register, login, logout, authenticate, requireAuth, requireRole, pub, accountInfo, updateProfile, changePassword, revokeSession, revokeOthers, onRevoke, tokenHash, deviceLabel };
}
module.exports = { createAuth };
