// Avvio, autenticazione, struttura della pagina, router e barra "Collega un dispositivo".
import { h, add, clear, $, toast, dialog, confirmDialog, fmtDate, registerBlock } from './dom.js';
import { api, get, post, patch, del, auth, ApiError, createRealtime } from './api.js';
import { renderHome, renderChat } from './chat.js';
import { play } from './sound.js';
import { createSearch } from './search.js';
import { initLim, setLim, limOn } from './lim.js';
import { renderMaterials } from './materials.js';
import { renderGroup } from './group.js';
import { renderTeacher } from './teacher.js';
import { renderPrivacy } from './privacy.js';
import { createIsland } from './island.js';
import { hasSeenTutorial } from './tutorial-state.js';
import { renderAccount } from './account.js';
import { renderHistory } from './history.js';
import { renderProjects } from './projects.js';
import { renderPlanner } from './planner.js';
import { renderBulletin } from './bulletin.js';
import { renderProva } from './prova.js';
import { createTools } from './tools.js';
import { renderSim } from './sims.js';
import { createRadar } from './airdrop.js';
import { showRecoveryCode } from './recovery.js';
registerBlock('sim', (src) => renderSim(src));
import { createVoice } from './voice.js';

const PKEY = 'omar.project';
let island = null;
const store = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignora */ } };
const load = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };

export const S = {
  user: null, info: null, currentSubject: null, subjects: [], modes: [], levels: [], projects: [], active: null, overview: null, conn: 'offline', online: [],
  listeners: new Set(), rt: null,
  on(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); },
  emit(ev) { for (const fn of [...S.listeners]) { try { fn(ev); } catch (e) { console.error(e); } } },
  isTeacher() { return ['teacher', 'admin'].includes(S.user?.role); },
  async refreshOverview() {
    if (!S.active) { S.overview = null; return; }
    try { S.overview = await get(`/projects/${S.active.id}`); S.active = { ...S.active, ...S.overview.project }; renderBar(); } catch (e) { if (e.status === 404) await leaveLocal('accesso_terminato'); }
  },
  async setActive(project, seq) {
    S.active = project; store(PKEY, project?.id || null);
    if (project) { await S.refreshOverview(); S.rt.subscribe(project.id, seq ?? S.overview?.lastSeq ?? 0); } else { S.overview = null; S.rt.unsubscribe(); }
    renderBar(); S.emit({ type: 'self.project' });
  },
};

// ───────── avvio ─────────
async function boot() {
  const root = document.getElementById('app');
  S.voice = createVoice();
  S.tools = createTools({ S });
  initLim();
  S.search = createSearch({ S, navigate: (hash) => go(hash) });
  island = createIsland({ S, navigate: go, renderGroup: renderGroupInto, toast, logout, theme: THEME, subjectId: () => S.currentSubject, tutorial: () => openTutorial(true), tools: S.tools, search: S.search, lim: { on: limOn, set: setLim } });
  S.theme = THEME; S.logout = logout; S.replayTutorial = () => openTutorial(true);
  S.openGroupPanel = () => island.openPanel('group');
  S.setBulletinUnread = (n) => island?.setBadge('bulletin-board', n > 0);
  S.onUserChange = (u) => island?.setUser(u);
  S.rt = createRealtime({
    onStatus: (s) => { S.conn = s; renderBar(); updateBanners(); },
    onPresence: (online) => { S.online = online; S.overview?.members?.forEach((m) => { m.online = online.includes(m.userId); }); if (S.overview) S.overview.onlineCount = online.length; renderBar(); S.emit({ type: 'presence' }); },
    onResync: () => { S.refreshOverview(); S.emit({ type: 'resync' }); },
    onEvent: onRealtimeEvent,
    onNotify: onNotify,
  });
  try { S.info = await get('/info'); } catch (e) { root.replaceChildren(h('p', { class: 'boot err', text: e.message })); return; }
  island.poke();
  window.addEventListener('omar:logout', () => { S.user = null; showAuth('La sessione è scaduta: accedi di nuovo.'); });
  window.addEventListener('hashchange', route);
  if (auth.token) { try { await startSession(); return; } catch { auth.token = null; } }
  showAuth();
}

// password temporanea (impostata da chi gestisce il computer): prima di tutto se ne sceglie una nuova
async function forcedPasswordChange() {
  for (;;) {
    const cur = h('input', { type: 'password', id: 'fp0', autocomplete: 'current-password' }); const nw = h('input', { type: 'password', id: 'fp1', autocomplete: 'new-password' }); const nw2 = h('input', { type: 'password', id: 'fp2', autocomplete: 'new-password' });
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const ok = await dialog('Scegli una nuova password', h('div', null, [h('p', { text: 'Stai usando una password temporanea. Per continuare scegline una tua.' }),
      h('label', { for: 'fp0', text: 'Password temporanea' }), cur, h('label', { for: 'fp1', text: `Nuova password (almeno ${S.info?.auth?.minPasswordLength || 10} caratteri)` }), nw, h('label', { for: 'fp2', text: 'Ripeti la nuova password' }), nw2, err]), [
      { label: 'Salva la password', primary: true, onClick: async () => {
        if (nw.value !== nw2.value) { err.textContent = 'Le due password non coincidono.'; err.hidden = false; return false; }
        try { await post('/account/password', { currentPassword: cur.value, newPassword: nw.value, signOutOthers: true }); return true; } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
      } }]);
    if (ok) { S.user.mustChangePassword = false; toast('Password salvata.'); try { const r = await post('/account/recovery', { currentPassword: nw.value }); await showRecoveryCode(r.code, { username: S.user.username }); } catch { /* si crea anche dall'Account */ } return; }
  }
}
async function startSession() {
  const me = await get('/me'); S.user = me.user; S.projects = me.projects; S.pendingJoins = me.pending || [];
  const sub = await get('/subjects'); S.subjects = sub.subjects; S.modes = sub.modes; S.levels = sub.levels;
  buildShell();
  if (S.user.mustChangePassword) await forcedPasswordChange();
  S.rt.start();
  const saved = load(PKEY); const p = S.projects.find((x) => x.id === saved);
  if (p) await S.setActive(p); else renderBar();
  const first = !hasSeenTutorial(S.user);
  if (first) await openTutorial(false);   // primo accesso di questo account: prima il tutorial-video, poi l'app
  if (!location.hash || location.hash === '#/') location.hash = '#/home'; else route();
  refreshBadges();
  if (first) playIntro(); // animazione d'ingresso in stile "Zoom foto" dopo la chiusura del tutorial
}

// Tutorial di benvenuto (presentazione animata a tutto schermo). Il modulo e il suo stile si caricano solo quando servono;
// se non si caricano l'app parte lo stesso e il tutorial si ripresenta al prossimo accesso (non viene segnato come visto).
async function openTutorial(replay) {
  let r = null;
  try { const m = await import('./tutorial.js'); r = await m.showTutorial({ user: S.user, replay }); }
  catch (e) { console.error('tutorial', e); return null; }
  if (replay) playIntro();
  return r;
}
// Animazione d'ingresso di tutta l'app in stile «Zoom foto» di Canva: la scena parte ingrandita e sfocata e si "allontana"
// fino alla sua dimensione reale; lo sfondo ha un suo zoom più lento (effetto profondità), poi entrano pillola e contenuti.
function playIntro() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const b = document.body; b.classList.remove('intro-zoom'); void b.offsetWidth; b.classList.add('intro-zoom');
  setTimeout(() => b.classList.remove('intro-zoom'), 3500);
}
async function refreshBadges() {
  try { const r = await get('/bulletins/unread'); island?.setBadge('bulletin-board', r.unread > 0); } catch { /* facoltativo */ }
  try { const r = await get('/transfers'); island?.setBadge('materiali', r.pendingIn > 0); } catch { /* facoltativo */ }
}
async function onNotify(ev) {
  if (ev.type === 'transfer.updated') {
    refreshBadges();
    if (ev.status === 'pending') { try { const r = await get('/transfers'); const x = r.transfers.find((t) => t.id === ev.id); if (x?.direction === 'in') toast(`${x.from.displayName} ti vuole inviare ${x.folder ? `la cartella “${x.folder}”` : `${x.count} file`}: aprili in Materiali.`); } catch { /* ignora */ } }
    else if (ev.status === 'accepted') { try { const r = await get('/transfers'); const x = r.transfers.find((t) => t.id === ev.id); if (x?.direction === 'out') toast(`${x.to.displayName} ha accettato i tuoi file.`); } catch { /* ignora */ } }
  }
  if (ev.type === 'membership.updated') { // la richiesta di ingresso in un gruppo è stata decisa
    const me = await get('/me').catch(() => null);
    if (me) { S.projects = me.projects; S.pendingJoins = me.pending || []; }
    if (ev.status === 'active') {
      const p = S.projects.find((x) => x.id === ev.projectId);
      toast(`Sei stato approvato: ora fai parte del gruppo “${ev.projectName || p?.name || ''}”.`);
      if (p && !S.active) await S.setActive(p);
    } else if (ev.status === 'rejected') toast(`La tua richiesta per il gruppo “${ev.projectName || ''}” non è stata accettata.`, 'bad');
    renderBar();
  }
  if (ev.type === 'bulletin.updated') { refreshBadges(); if (!location.hash.startsWith('#/bulletin-board')) toast('Novità in bacheca.'); }
  S.emit({ type: 'notify', event: ev });
}

function showAuth(message) {
  delete document.body.dataset.view;
  S.rt?.stop(); island?.setUser(null); S.currentSubject = null;
  const root = document.getElementById('app'); clear(root);
  const domain = S.info?.studentEmailDomain; let mode = 'login';
  const card = h('div', { class: 'auth' });
  const draw = () => {
    clear(card);
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const f = {
      username: h('input', { type: 'text', id: 'u', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false, placeholder: domain ? `nome.cognome@${domain}` : 'nome utente' }), display: h('input', { type: 'text', id: 'dn', autocomplete: 'name', maxLength: 40, placeholder: 'es. Elia' }),
      password: h('input', { type: 'password', id: 'pw', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minLength: mode === 'login' ? 1 : (S.info?.auth?.minPasswordLength || 10) }), code: h('input', { type: 'text', id: 'rc', autocomplete: 'off', autocapitalize: 'characters' }),
      rcode: h('input', { type: 'text', id: 'rk', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'XXXX-XXXX-XXXX-XXXX', style: 'letter-spacing:.08em', required: true }),
      pw2: h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password', required: true }),
    };
    const submit = async (e) => {
      e.preventDefault(); err.hidden = true;
      try {
        if (mode === 'recover') {
          if (f.password.value !== f.pw2.value) throw new Error('Le due password non coincidono.');
          const r = await post('/auth/recover', { username: f.username.value, code: f.rcode.value, newPassword: f.password.value });
          auth.token = r.token; await showRecoveryCode(r.recoveryCode, { username: r.user.username, reason: 'used' }); await startSession(); return;
        }
        const body = mode === 'login' ? { username: f.username.value, password: f.password.value } : { username: f.username.value, displayName: f.display.value, password: f.password.value, registrationCode: f.code.value };
        const r = await post(mode === 'login' ? '/auth/login' : '/auth/register', body); auth.token = r.token;
        if (r.recoveryCode) await showRecoveryCode(r.recoveryCode, { username: r.user.username });
        await startSession();
      } catch (ex) { console.error('accesso', ex); err.textContent = ex.message; err.hidden = false; }
    };
    add(card, [
      h('div', { class: 'logo' }, h('img', { src: '/img/logo.png', alt: '', width: 34, height: 34 }), 'Omar AI'),
      h('p', { class: 'muted', text: 'Il tutor che ti aiuta a ragionare nelle materie tecniche: ti guida con domande e indizi, non ti consegna i compiti svolti.' }),
      message && h('p', { class: 'notice warn', text: message }),
      h('form', { onsubmit: submit },
        h('label', { for: 'u', text: mode === 'login' ? 'Email scolastica o nome utente' : (domain ? `Email scolastica (@${domain})` : 'Nome utente') }), f.username,
        mode === 'register' && [domain && h('p', { class: 'small muted', text: `Gli studenti possono registrarsi solo con l’email scolastica @${domain}. I docenti possono usare un nome utente.` }),
          h('label', { for: 'dn', text: 'Nome da mostrare ai compagni' }), f.display, h('label', { for: 'rc', text: 'Codice di registrazione (te lo dà il docente)' }), f.code],
        mode === 'recover' && [h('p', { class: 'small muted', text: 'Usa il codice di recupero che hai salvato quando hai creato l’account (o dall’Account). Se non ce l’hai, chiedi a chi gestisce il computer o il server della classe: con «REIMPOSTA-PASSWORD» ti dà una password temporanea.' }),
          h('label', { for: 'rk', text: 'Codice di recupero' }), f.rcode],
        h('label', { for: 'pw', text: mode === 'recover' ? `Nuova password (almeno ${S.info?.auth?.minPasswordLength || 10} caratteri)` : 'Password' + (mode === 'register' ? ' (almeno 10 caratteri)' : '') }), f.password,
        mode === 'recover' && [h('label', { for: 'pw2', text: 'Ripeti la nuova password' }), f.pw2],
        h('div', { style: 'margin-top:1rem' }, err),
        h('div', { class: 'row', style: 'margin-top:1rem' }, h('button', { class: 'btn primary', type: 'submit', text: mode === 'login' ? 'Accedi' : mode === 'recover' ? 'Imposta la nuova password' : 'Crea account' }),
          h('button', { class: 'btn ghost', type: 'button', text: mode === 'login' ? 'Non hai un account? Registrati' : 'Torna all’accesso', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } })),
        mode === 'login' && h('button', { class: 'linkbtn small', type: 'button', style: 'margin-top:.6rem', text: 'Password dimenticata?', onclick: () => { mode = 'recover'; draw(); } })),
      S.info?.ai?.simulated && h('p', { class: 'banner sim show', style: 'margin-top:1rem;border-radius:12px;display:block', text: S.info.ai.notice }),
      h('p', { class: 'small muted', style: 'margin-top:1rem', text: 'Le conversazioni sono personali: il docente non le legge. Usa questo strumento come supporto allo studio, non come sostituto del tuo lavoro.' }),
    ]);
    f.username.focus();
  };
  draw(); root.append(h('div', { class: 'authwrap' }, card));
}

// ───────── struttura: sfondo + Dynamic Island (navbar) + contenuto ───────
const THEME_KEY = 'omar.theme';
const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
const THEME = {
  get: () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  set: (t) => { applyTheme(t); try { localStorage.setItem(THEME_KEY, t); } catch { /* ignora */ } },
};
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme('dark'); } // tema scuro di default, come nel disegno
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
S.refreshHistory = () => island?.refreshHistory();

function buildShell() {
  const root = document.getElementById('app'); clear(root);
  add(root, h('div', { class: 'app' }, [h('div', { id: 'banners' }), h('main', { id: 'main', tabindex: '-1' })]));
  updateBanners(); island.setUser(S.user);
}
// il server acceso è di una versione precedente ai file aggiornati: le funzioni nuove risponderebbero «Risorsa non trovata»
async function restartServer(btn) {
  btn.disabled = true; btn.textContent = 'Riavvio in corso…';
  const before = S.info?.server?.build;
  try { await post('/server/restart'); } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Riavvia Omar'; return; }
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    try { const r = await fetch('/desktop/ping', { cache: 'no-store' }); const j = await r.json(); if (j.build && j.build !== before) { location.reload(); return; } } catch { /* ancora spento */ }
  }
  toast('Omar non si è riacceso da solo: chiudi la finestra nera «Omar AI» e riapri l’icona.', 'bad');
}
function staleBanner() {
  if (!S.info?.server?.stale) return null;
  const btn = S.info.server.canRestart ? h('button', { class: 'btn sm primary', type: 'button', text: 'Riavvia Omar', onclick: (e) => restartServer(e.currentTarget) }) : null;
  return h('div', { class: 'banner upd show', role: 'alert' }, [h('span', { text: btn ? 'Omar AI è stato aggiornato: riavvialo per usare le funzioni nuove. ' : 'Omar AI è stato aggiornato: chiudi la finestra nera «Omar AI» e riapri l’icona per usare le funzioni nuove.' }), btn]);
}
setInterval(async () => { if (!S.user || document.hidden) return; try { const i = await get('/info'); const was = !!S.info?.server?.stale; S.info = i; if (!!i.server?.stale !== was) updateBanners(); } catch { /* ignora */ } }, 60_000);
function updateBanners() {
  const b = $('#banners'); if (!b) return; clear(b);
  const st = staleBanner(); if (st) b.append(st);
  const ai = S.info?.ai;
  // NB: l'avviso «provider IA esterno» non viene mostrato (richiesta della docente): l'informazione resta nella pagina Privacy.
  if (ai?.simulated) b.append(h('div', { class: 'banner sim show', role: 'status', text: '🧪 MODALITÀ SIMULAZIONE — le risposte non sono generate da un modello IA' }));
  if (S.user && S.conn === 'reconnecting') b.append(h('div', { class: 'banner offline show', role: 'status', text: 'Connessione con il gruppo interrotta: riconnessione in corso' }));
}
async function logout() { try { await post('/auth/logout'); } catch { /* già scaduta */ } auth.token = null; store(PKEY, null); S.user = null; S.active = null; S.rt.stop(); location.hash = ''; showAuth(); }

// ───────── router ─────────
let cleanup = null;
const VIEWS = { home: renderHome, chat: renderChat, materiali: renderMaterials, gruppo: renderGroup, docente: renderTeacher, privacy: renderPrivacy,
  account: renderAccount, cronologia: renderHistory, projects: renderProjects, planner: renderPlanner, 'bulletin-board': renderBulletin, prova: renderProva };
async function route() {
  if (!S.user) return;
  const [, name = 'home', ...rest] = location.hash.split('/');
  const main = $('#main'); if (!main) return;
  if (cleanup) { try { cleanup(); } catch { /* ignora */ } cleanup = null; }
  S.listeners.clear(); S.currentSubject = null;
  island.setRoute(name); island.close(); document.body.dataset.view = name;
  clear(main);
  const fn = VIEWS[name] || renderHome;
  const host = ['home', 'chat'].includes(name) || !VIEWS[name] ? main : main.appendChild(h('div', { class: `sheet sheet-${name}` }));
  try { cleanup = (await fn(host, S, rest)) || null; } catch (e) { host.append(h('div', { class: 'err', role: 'alert', text: e.message || 'Errore imprevisto.' })); }
  if (name === 'home' || !VIEWS[name]) S.on((ev) => { if (ev.type === 'self.project') route(); });
  main.focus({ preventScroll: true });
}

// ───────── eventi in tempo reale ─────────
const EV_TEXT = { 'member.joined': (e) => `${e.data?.displayName || 'Un compagno'} è entrato nel gruppo`, 'member.left': (e) => `${e.data?.displayName || 'Un compagno'} ha lasciato il gruppo`, 'member.pending': (e) => `${e.data?.displayName || 'Qualcuno'} chiede di entrare: serve la tua approvazione`,
  'material.disponibile': () => 'Nuovo allegato condiviso nel gruppo', 'material.pronto': () => 'Un allegato del gruppo è pronto da consultare', 'contribution.shared': (e) => `${e.data?.author || 'Un compagno'} ha condiviso un contributo`, 'decision.confirmed': () => 'Una decisione è stata confermata', 'decision.proposed': () => 'Nuova proposta di decisione',
  'alert.opened': () => 'La Scatola Nera ha un nuovo avviso da controllare', 'share.requested': () => 'Un compagno ti chiede di condividere un contributo' };
async function onRealtimeEvent(ev) {
  if (ev.type === 'self.unsubscribed') { await leaveLocal(ev.reason); return; }
  if (['member.joined', 'member.left', 'member.revoked', 'member.approved', 'member.pending', 'member.rejected'].includes(ev.type)) await S.refreshOverview();
  const txt = EV_TEXT[ev.type]; if (txt && ev.actorId !== S.user.id) toast(txt(ev));
  if (!ev.replay) { // suoni: armonico quando un compagno condivide, avviso sommesso quando la Scatola Nera trova un conflitto
    if (ev.type === 'contribution.shared' && ev.actorId !== S.user.id) play('chime');
    if (ev.type === 'alert.opened') play('warn');
    if (ev.type === 'arena.message' && ev.actorId !== S.user.id) play('chime');
  }
  S.emit(ev);
}
async function leaveLocal(reason) {
  const was = S.active; S.projects = (await get('/me').catch(() => ({ projects: [] }))).projects;
  S.active = null; S.overview = null; store(PKEY, null); S.rt.unsubscribe(); renderBar();
  if (was) toast(reason === 'revocato' ? `Il tuo accesso al gruppo “${was.name}” è stato revocato.` : reason === 'uscito' ? `Hai lasciato il gruppo “${was.name}”.` : `Non hai più accesso al gruppo “${was.name}”.`, reason === 'uscito' ? '' : 'bad');
  S.emit({ type: 'self.project' }); if (location.hash.startsWith('#/gruppo')) location.hash = '#/home';
}

// ───────── gruppo: contenuto del pannello "Gruppo e dispositivi" nella Dynamic Island ───────
export function renderBar() { island?.refreshGroup(); }
function renderGroupInto(bar) {
  clear(bar);
  if (!S.active) {
    add(bar, [h('span', { class: 'muted', text: 'Collega i dispositivi tuoi e dei compagni per lavorare a un progetto. Le chat restano personali: condividi solo ciò che scegli.' }),
      (S.pendingJoins || []).map((p) => h('span', { class: 'badge warn', title: 'Entrerai appena il creatore del gruppo ti approva: riceverai un avviso.', text: `Richiesta inviata a “${p.name}”: in attesa di approvazione` })),
      h('button', { class: 'btn primary sm', type: 'button', text: 'Collega un dispositivo', onclick: linkDialog }),
      S.projects.length > 0 && h('button', { class: 'btn sm', type: 'button', text: `I miei gruppi (${S.projects.length})`, onclick: myGroupsDialog })]);
    return;
  }
  const CONN = { online: ['on', 'Connesso'], connecting: ['wait', 'Connessione…'], reconnecting: ['wait', 'Riconnessione…'], offline: ['', 'Non connesso'] };
  const [cls, label] = CONN[S.conn] || CONN.offline; const ov = S.overview; const n = ov?.participantCount ?? 1;
  const manager = ['owner', 'teacher'].includes(S.active.myRole);
  add(bar, [h('div', { class: 'row' }, h('span', { class: `dot ${cls}`, 'aria-hidden': true }), h('span', { text: label })),
    h('strong', { text: `Gruppo: ${S.active.name}` }),
    h('span', { text: `${n} partecipant${n === 1 ? 'e' : 'i'}${ov ? ` · ${ov.onlineCount} online` : ''}` }),
    ov?.pending?.length > 0 && h('a', { class: 'badge warn', href: '#/gruppo/panoramica', text: `${ov.pending.length} in attesa di approvazione` }),
    h('div', { class: 'row' }, [h('button', { class: 'btn sm', type: 'button', text: 'Partecipanti', onclick: participantsDialog }), h('a', { class: 'btn sm', href: '#/gruppo', text: 'Apri', onclick: () => island.close() }),
      manager && h('button', { class: 'btn sm', type: 'button', text: 'Invita', onclick: () => inviteDialog() })]),
    h('button', { class: 'btn sm danger', type: 'button', text: 'Esci dal gruppo', onclick: leaveDialog })]);
}

async function linkDialog() {
  const mk = (id, label, el) => [h('label', { for: id, text: label }), el];
  const code = h('input', { type: 'text', id: 'lc', placeholder: 'ABCD-EFGH', autocomplete: 'off', maxLength: 12, style: 'text-transform:uppercase;letter-spacing:.1em' });
  const ws1 = h('input', { type: 'text', id: 'lw', placeholder: 'es. struttura del mulino', maxLength: 60 });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'pn', placeholder: 'es. Mulino a vento', maxLength: 80 });
  const subj = h('select', { id: 'ps' }, h('option', { value: '', text: '— nessuna —' }), S.subjects.map((s) => h('option', { value: s.id, text: s.name })));
  const ws2 = h('input', { type: 'text', id: 'pw2', placeholder: 'es. motore', maxLength: 60 });
  const appr = h('input', { type: 'checkbox', id: 'pa', checked: true });
  const radar = createRadar({ me: S.user.displayName, label: 'Inserisci il codice che ti ha dato il compagno', size: 'sm' }).searching();
  code.addEventListener('input', () => { if (radar.el.dataset.state === 'error') radar.searching('Inserisci il codice che ti ha dato il compagno'); });
  const body = h('div', null, [radar.el,
    h('p', { class: 'small muted', text: 'Collegarsi non condivide nulla: le tue chat restano personali. Condividi tu, di volta in volta, ciò che vuoi.' }),
    h('h3', { text: 'Ho un codice di invito' }), mk('lc', 'Codice', code), mk('lw', 'Di cosa ti occupi nel progetto? (facoltativo)', ws1),
    h('button', { class: 'btn primary', type: 'button', style: 'margin-top:.7rem', text: 'Collegati', onclick: async (e) => {
      err.hidden = true; e.target.disabled = true; const dlgEl = e.target.closest('dialog');
      radar.state('connect').label('Mi collego al gruppo…'); radar.progress(0.15);
      try {
        const r = await post('/projects/join', { code: code.value, workstream: ws1.value || undefined });
        // animazione «AirDrop»: l'anello si chiude, il gruppo compare con la spunta, poi la finestra si chiude
        await radar.connect(r.project?.name || 'Gruppo', { sub: r.status === 'pending' ? 'in attesa di approvazione' : 'collegato', ms: 900 });
        radar.label(r.status === 'pending' ? 'Richiesta inviata: aspetta l’approvazione' : 'Collegato!');
        await new Promise((ok) => setTimeout(ok, 1100));
        await afterLink(r); dlgEl?.close();
      }
      catch (ex) {
        radar.error('Codice non valido o scaduto');
        err.textContent = ex.message + (ex.code === 'invito_non_valido' ? ' Controlla che il codice sia ancora attivo (chi l\u2019ha creato lo rivede in «Invita»). Se il gruppo è stato creato su un ALTRO computer, collegatevi prima allo stesso server della classe (qui sotto).' : '');
        err.hidden = false;
      } finally { e.target.disabled = false; } } }),
    h('hr'), h('h3', { text: 'Oppure crea una sessione di gruppo' }), mk('pn', 'Nome del progetto', name), mk('ps', 'Materia', subj), mk('pw2', 'Di cosa ti occupi tu? (facoltativo)', ws2),
    h('label', { style: 'font-weight:400;display:flex;gap:.5rem;align-items:center' }, appr, 'Chi entra con il codice deve essere approvato da me'),
    h('button', { class: 'btn', type: 'button', style: 'margin-top:.7rem', text: 'Crea la sessione di gruppo', onclick: async (e) => {
      err.hidden = true; e.target.disabled = true;
      try { const r = await post('/projects', { name: name.value, subjectId: subj.value || null, requiresApproval: appr.checked, workstream: ws2.value || undefined }); S.projects = (await get('/me')).projects; await S.setActive(S.projects.find((p) => p.id === r.project.id) || r.project); e.target.closest('dialog').close(); toast('Gruppo creato. Ora genera un codice di invito per i compagni.'); inviteDialog(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { e.target.disabled = false; } } }),
    h('div', { style: 'margin-top:.8rem' }, err), h('hr'), classeBox()]);
  await dialog('Collega un dispositivo', body, [{ label: 'Chiudi', value: null }]);
}
// ───────── server della classe: i gruppi tra computer diversi passano da UN computer della classe ─────────
export async function loadDesk() { try { S.desk = await get('/desktop'); } catch { S.desk = null; } return S.desk; }
function classeBox() {
  const box = h('div', { class: 'classe-box' });
  (async () => {
    const d = S.desk || await loadDesk(); if (!d || !d.desktopOnly) return; // versione web: niente server della classe (sono già tutti sullo stesso server)
    if (!d.local) { // finestra aperta sul server della classe da un altro computer
      add(box, [h('p', { class: 'small', text: 'Sei collegato al server della classe: gruppi e codici di invito sono condivisi con tutti i computer collegati qui.' }),
        h('a', { class: 'btn sm', href: 'http://localhost:3300/desktop/locale', text: 'Usa Omar solo su questo computer' })]);
      return;
    }
    if (d.aula) { add(box, h('p', { class: 'small', text: `Questo computer è il server della classe. Gli altri si collegano con: indirizzo ${(d.addresses || []).join(' oppure ')} · codice d’aula ${d.aulaKey}` })); return; }
    add(box, [h('h3', { text: 'Un altro computer o un telefono?' }),
      h('p', { class: 'small muted', text: 'Su questo computer Omar funziona solo qui: un codice di invito vale solo sul Omar dove è stato creato, quindi un altro dispositivo con il suo Omar lo vede «non valido». Per collegare altri dispositivi tutti devono usare lo STESSO Omar:' }),
      h('p', { class: 'small', text: '• Dal browser, anche da telefono: chiudi Omar e avvia LINK-ONLINE.bat (nella cartella di Omar). Esce un link https://…: apritelo sugli altri dispositivi, accedete e inserite il codice.' }),
      h('p', { class: 'small', text: '• Tra computer con l’app: un computer diventa «server della classe» (Account) e gli altri si collegano qui sotto.' }),
      h('button', { class: 'btn sm primary', type: 'button', text: 'Collegati al server della classe', onclick: classeDialog })]);
  })();
  return box;
}
export async function classeDialog() {
  const addr = h('input', { type: 'text', id: 'ca', placeholder: 'es. 192.168.1.20', autocomplete: 'off', maxLength: 80 });
  const code = h('input', { type: 'text', id: 'cc', placeholder: 'ABCD-EFGH-JKMN-PQRS', autocomplete: 'off', maxLength: 24, style: 'text-transform:uppercase;letter-spacing:.08em' });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const body = h('div', null, [h('p', { class: 'small muted', text: 'Indirizzo e codice d’aula li vede chi ha il server della classe (Account > Server della classe). Si inseriscono una volta sola: poi l’icona «Omar AI» apre direttamente la classe.' }),
    h('label', { for: 'ca', text: 'Indirizzo del server della classe' }), addr, h('label', { for: 'cc', text: 'Codice d’aula' }), code, err]);
  await dialog('Collegati al server della classe', body, [{ label: 'Annulla', value: null }, { label: 'Collegati', primary: true, onClick: async () => {
    err.hidden = true;
    try { const r = await post('/desktop/classe', { address: addr.value, code: code.value }); toast(`Collegato${r.nome ? ` a ${r.nome}` : ''}: apro il server della classe…`); setTimeout(() => { location.href = r.openUrl; }, 600); return true; }
    catch (ex) { err.textContent = ex.message; err.hidden = false; return false; }
  } }]);
}
async function afterLink(r) {
  const me = await get('/me'); S.projects = me.projects; S.pendingJoins = me.pending || [];
  if (r.status === 'pending') { toast(r.already ? `La tua richiesta per “${r.project?.name || 'il gruppo'}” è già in attesa: entrerai appena il creatore ti approva.` : 'Richiesta inviata: attendi che il creatore del gruppo ti approvi.'); renderBar(); return; }
  const p = S.projects.find((x) => x.id === r.project?.id) || r.project;
  await S.setActive(p); toast(r.already ? `Fai già parte di “${p.name}”: questo dispositivo ora è collegato al gruppo.` : `Sei nel gruppo “${p.name}”.`); if (location.hash.startsWith('#/gruppo')) route();
}
async function myGroupsDialog() {
  const body = h('div', null, S.projects.map((p) => h('div', { class: 'item row' }, h('strong', { class: 'grow', text: p.name }), h('span', { class: 'badge', text: p.myRole }),
    h('button', { class: 'btn sm primary', type: 'button', text: 'Apri', onclick: async (e) => { await S.setActive(p); e.target.closest('dialog').close(); } }))));
  await dialog('I miei gruppi', body, [{ label: 'Chiudi' }]);
}
async function participantsDialog() {
  await S.refreshOverview(); const ov = S.overview; if (!ov) return;
  const manager = ['owner', 'teacher'].includes(S.active.myRole);
  const body = h('div', null, [
    h('table', null, h('thead', null, h('tr', null, ['Nome', 'Ruolo', 'Si occupa di', 'Stato', ''].map((t) => h('th', { text: t })))), h('tbody', null, ov.members.map((m) => h('tr', null,
      h('td', { text: m.displayName + (m.userId === S.user.id ? ' (tu)' : '') }), h('td', { text: m.role === 'owner' ? 'creatore' : m.role === 'teacher' ? 'docente' : 'partecipante' }), h('td', { text: m.workstream || '—' }),
      h('td', null, h('span', { class: `badge ${m.online ? 'ok' : ''}`, text: m.online ? 'online' : 'offline' })),
      h('td', null, manager && m.role !== 'owner' && m.userId !== S.user.id && h('button', { class: 'btn sm danger', type: 'button', text: 'Revoca', onclick: async (e) => {
        if (!(await confirmDialog('Revocare l’accesso?', `${m.displayName} non potrà più vedere né ricevere contenuti del gruppo. Eventuali copie già scaricate non possono essere cancellate.`, { ok: 'Revoca', danger: true }))) return;
        try { await post(`/projects/${S.active.id}/members/${m.userId}/revoke`); toast('Accesso revocato.'); await S.refreshOverview(); e.target.closest('dialog').close(); } catch (ex) { toast(ex.message, 'bad'); } } })))))),
    ov.pending?.length > 0 && [h('h3', { text: 'In attesa di approvazione' }), ov.pending.map((m) => h('div', { class: 'item row' }, h('strong', { class: 'grow', text: m.displayName }),
      h('button', { class: 'btn sm primary', type: 'button', text: 'Approva', onclick: async (e) => { await post(`/projects/${S.active.id}/members/${m.userId}/approve`); await S.refreshOverview(); e.target.closest('dialog').close(); } }),
      h('button', { class: 'btn sm', type: 'button', text: 'Rifiuta', onclick: async (e) => { await post(`/projects/${S.active.id}/members/${m.userId}/reject`); await S.refreshOverview(); e.target.closest('dialog').close(); } })))]]);
  await dialog(`Partecipanti — ${S.active.name}`, body, [{ label: 'Chiudi' }]);
}
export async function inviteDialog() {
  const out = h('div'); const err = h('div', { class: 'err', hidden: true, role: 'alert' });
  const ttl = h('select', { id: 'ttl' }, [[15, '15 minuti'], [60, '1 ora'], [1440, '1 giorno']].map(([v, l]) => h('option', { value: v, text: l, selected: v === 60 })));
  const uses = h('input', { type: 'number', id: 'uses', min: 1, max: 100, value: 5 });
  const copy = (code) => h('button', { class: 'btn sm', type: 'button', text: 'Copia', onclick: async (e) => { try { await navigator.clipboard.writeText(code); e.target.textContent = 'Copiato'; } catch { toast(`Codice: ${code}`); } } });
  const active = h('div');
  const loadActive = async () => {
    clear(active);
    let list = []; try { list = (await get(`/projects/${S.active.id}/invites`)).invites.filter((i) => i.active); } catch { return; }
    if (!list.length) { add(active, h('p', { class: 'small muted', text: 'Nessun codice attivo: generane uno.' })); return; }
    add(active, [h('h3', { text: 'Codici attivi' }), list.map((i) => h('div', { class: 'item row' }, h('span', { class: 'code', style: 'font-size:1.05rem;margin:0', text: i.code || '(creato prima dell’aggiornamento: rigeneralo)' }),
      h('span', { class: 'small muted grow', text: `scade ${fmtDate(i.expiresAt)} · usato ${i.uses}/${i.maxUses}` }), i.code && copy(i.code),
      h('button', { class: 'btn sm danger', type: 'button', text: 'Annulla', onclick: async () => { try { await del(`/projects/${S.active.id}/invites/${i.id}`); loadActive(); } catch (ex) { toast(ex.message, 'bad'); } } })))]);
  };
  // online (link web) l'invito completo contiene anche l'indirizzo: chi lo riceve sa dove aprire Omar e cosa scrivere
  const online = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const fullInvite = (code) => `Unisciti al gruppo “${S.active.name}” su Omar AI:\n1) apri ${location.origin}\n2) accedi o registrati\n3) Gruppo > Collega un dispositivo > codice ${code}`;
  const copyFull = (code) => h('button', { class: 'btn sm primary', type: 'button', text: 'Copia invito completo', onclick: async (e) => { try { await navigator.clipboard.writeText(fullInvite(code)); e.target.textContent = 'Copiato'; } catch { toast(fullInvite(code)); } } });
  // radar «AirDrop»: mentre il codice è attivo, i compagni che entrano compaiono intorno a te con un suono
  const radar = createRadar({ me: S.user.displayName, label: 'Genera un codice: i compagni che entrano compaiono qui', size: 'sm' });
  radar.state('idle');
  const unsub = S.on((ev) => {
    if (ev.type === 'member.joined' && ev.actorId !== S.user.id) { const pe = radar.addPeer(ev.data?.displayName || 'Compagno', { sub: 'entrato' }); setTimeout(() => pe.done(), 350); radar.label(`${ev.data?.displayName || 'Un compagno'} è entrato nel gruppo`); }
    if (ev.type === 'member.pending') { const pe = radar.addPeer(ev.data?.displayName || 'Compagno', { sub: 'da approvare' }); pe.progress(0.5); radar.label(`${ev.data?.displayName || 'Qualcuno'} chiede di entrare: approvalo in «Partecipanti»`); }
  });
  const show = (r) => { radar.searching('In attesa dei compagni…'); clear(out); add(out, [h('p', null, 'Nuovo codice di invito (valido fino alle ', fmtDate(r.expiresAt), ', max ', r.maxUses, ' usi):'), h('div', { class: 'row' }, h('div', { class: 'code', text: r.code }), copy(r.code), online && copyFull(r.code)),
    online ? h('p', { class: 'small muted', text: `Chi vuoi invitare apre ${location.origin}, accede e inserisce il codice in Gruppo > Collega un dispositivo.` }) : h('p', { class: 'small muted', text: r.note })]); loadActive(); };
  const gen = (path) => async () => { err.hidden = true; try { show(await post(`/projects/${S.active.id}/invites${path}`, { ttlMin: +ttl.value, maxUses: +uses.value })); } catch (ex) { err.textContent = ex.message; err.hidden = false; } };
  loadActive();
  const body = h('div', null, [radar.el, h('p', { class: 'small muted', text: 'Comunica il codice a voce o scrivilo ai compagni. Il codice non dà permessi speciali, scade da solo e puoi annullarlo o rigenerarlo quando vuoi.' }),
    h('div', { class: 'row' }, [h('div', null, h('label', { for: 'ttl', text: 'Durata' }), ttl), h('div', null, h('label', { for: 'uses', text: 'Usi massimi' }), uses)]),
    h('div', { class: 'row', style: 'margin-top:.7rem' }, [h('button', { class: 'btn primary', type: 'button', text: 'Genera un nuovo codice', onclick: gen('') }),
      h('button', { class: 'btn', type: 'button', text: 'Rigenera (annulla i codici attivi)', onclick: gen('/regenerate') })]), h('div', { style: 'margin-top:1rem' }, out), err, active, h('hr'), classeBox()]);
  try { await dialog('Invita compagni nel gruppo', body, [{ label: 'Chiudi' }]); } finally { unsub?.(); radar.destroy(); }
}
async function leaveDialog() {
  const retract = h('input', { type: 'checkbox', id: 'rt' });
  const body = h('div', null, [h('p', { text: `Uscendo da “${S.active.name}” non vedrai più i contenuti del gruppo. Le tue chat personali restano tue.` }),
    h('label', { style: 'font-weight:400;display:flex;gap:.5rem;align-items:center' }, retract, 'Ritira anche i contributi che ho condiviso (resteranno oscurati per il gruppo)')]);
  const ok = await dialog('Esci dal gruppo', body, [{ label: 'Annulla', value: false }, { label: 'Esci dal gruppo', value: true, danger: true }]);
  if (!ok) return;
  try { await post(`/projects/${S.active.id}/leave`, { retractContributions: retract.checked }); await leaveLocal('uscito'); } catch (ex) { toast(ex.message, 'bad'); }
}

boot();

// Un file lasciato cadere fuori dal campo di scrittura non deve far uscire dall'app (il browser lo aprirebbe al posto di Omar).
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files') && !e.defaultPrevented) e.preventDefault(); });

// clic morbido quando si cambia scheda (in tutta l'app)
document.addEventListener('click', (e) => { if (e.target.closest?.('[role=tab], .tabs a, .qt-tab')) play('tab'); });

// Ctrl+Maiusc+L: modalità LIM / proiettore al volo
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); setLim(!limOn()); toast(limOn() ? 'Modalità LIM attiva: testo grande e contrasto alto.' : 'Modalità LIM disattivata.'); } });
