// Avvio, autenticazione, struttura della pagina, router e barra "Collega un dispositivo".
import { h, add, clear, $, toast, dialog, confirmDialog, fmtDate } from './dom.js';
import { api, get, post, patch, auth, ApiError, createRealtime } from './api.js';
import { renderHome, renderChat } from './chat.js';
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
import { createTools } from './tools.js';
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
  island = createIsland({ S, navigate: go, renderGroup: renderGroupInto, toast, logout, theme: THEME, subjectId: () => S.currentSubject, tutorial: () => openTutorial(true), tools: S.tools });
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

async function startSession() {
  const me = await get('/me'); S.user = me.user; S.projects = me.projects;
  const sub = await get('/subjects'); S.subjects = sub.subjects; S.modes = sub.modes; S.levels = sub.levels;
  buildShell();
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
      password: h('input', { type: 'password', id: 'pw', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true }), code: h('input', { type: 'text', id: 'rc', autocomplete: 'off', autocapitalize: 'characters' }),
    };
    const submit = async (e) => {
      e.preventDefault(); err.hidden = true;
      try {
        const body = mode === 'login' ? { username: f.username.value, password: f.password.value } : { username: f.username.value, displayName: f.display.value, password: f.password.value, registrationCode: f.code.value };
        const r = await post(mode === 'login' ? '/auth/login' : '/auth/register', body); auth.token = r.token; await startSession();
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
        h('label', { for: 'pw', text: 'Password' + (mode === 'register' ? ' (almeno 10 caratteri)' : '') }), f.password,
        h('div', { style: 'margin-top:1rem' }, err),
        h('div', { class: 'row', style: 'margin-top:1rem' }, h('button', { class: 'btn primary', type: 'submit', text: mode === 'login' ? 'Accedi' : 'Crea account' }),
          h('button', { class: 'btn ghost', type: 'button', text: mode === 'login' ? 'Non hai un account? Registrati' : 'Ho già un account', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } }))),
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
function updateBanners() {
  const b = $('#banners'); if (!b) return; clear(b);
  const ai = S.info?.ai;
  if (ai?.simulated) b.append(h('div', { class: 'banner sim show', role: 'status', text: '🧪 MODALITÀ SIMULAZIONE — le risposte non sono generate da un modello IA' }));
  else if (ai?.dataLeavesNetwork) b.append(h('div', { class: 'banner ext show', text: 'Le domande sono elaborate da un provider IA esterno: non inserire dati personali' }));
  if (S.user && S.conn === 'reconnecting') b.append(h('div', { class: 'banner offline show', role: 'status', text: 'Connessione con il gruppo interrotta: riconnessione in corso' }));
}
async function logout() { try { await post('/auth/logout'); } catch { /* già scaduta */ } auth.token = null; store(PKEY, null); S.user = null; S.active = null; S.rt.stop(); location.hash = ''; showAuth(); }

// ───────── router ─────────
let cleanup = null;
const VIEWS = { home: renderHome, chat: renderChat, materiali: renderMaterials, gruppo: renderGroup, docente: renderTeacher, privacy: renderPrivacy,
  account: renderAccount, cronologia: renderHistory, projects: renderProjects, planner: renderPlanner, 'bulletin-board': renderBulletin };
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
  const body = h('div', null, [
    h('p', { class: 'small muted', text: 'Collegarsi non condivide nulla: le tue chat restano personali. Condividi tu, di volta in volta, ciò che vuoi.' }),
    h('h3', { text: 'Ho un codice di invito' }), mk('lc', 'Codice', code), mk('lw', 'Di cosa ti occupi nel progetto? (facoltativo)', ws1),
    h('button', { class: 'btn primary', type: 'button', style: 'margin-top:.7rem', text: 'Collegati', onclick: async (e) => {
      err.hidden = true; e.target.disabled = true;
      try { const r = await post('/projects/join', { code: code.value, workstream: ws1.value || undefined }); await afterLink(r); e.target.closest('dialog').close(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { e.target.disabled = false; } } }),
    h('hr'), h('h3', { text: 'Oppure crea una sessione di gruppo' }), mk('pn', 'Nome del progetto', name), mk('ps', 'Materia', subj), mk('pw2', 'Di cosa ti occupi tu? (facoltativo)', ws2),
    h('label', { style: 'font-weight:400;display:flex;gap:.5rem;align-items:center' }, appr, 'Chi entra con il codice deve essere approvato da me'),
    h('button', { class: 'btn', type: 'button', style: 'margin-top:.7rem', text: 'Crea la sessione di gruppo', onclick: async (e) => {
      err.hidden = true; e.target.disabled = true;
      try { const r = await post('/projects', { name: name.value, subjectId: subj.value || null, requiresApproval: appr.checked, workstream: ws2.value || undefined }); S.projects = (await get('/me')).projects; await S.setActive(S.projects.find((p) => p.id === r.project.id) || r.project); e.target.closest('dialog').close(); toast('Gruppo creato. Ora genera un codice di invito per i compagni.'); inviteDialog(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { e.target.disabled = false; } } }),
    h('div', { style: 'margin-top:.8rem' }, err)]);
  await dialog('Collega un dispositivo', body, [{ label: 'Chiudi', value: null }]);
}
async function afterLink(r) {
  S.projects = (await get('/me')).projects;
  if (r.status === 'pending') { toast('Richiesta inviata: attendi che il creatore del gruppo ti approvi.'); renderBar(); return; }
  const p = S.projects.find((x) => x.id === r.project?.id) || r.project;
  await S.setActive(p); toast(`Sei nel gruppo “${p.name}”.`); if (location.hash.startsWith('#/gruppo')) route();
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
  const show = (r) => { clear(out); add(out, [h('p', null, 'Codice di invito (valido fino alle ', fmtDate(r.expiresAt), ', max ', r.maxUses, ' usi):'), h('div', { class: 'code', text: r.code }), h('p', { class: 'small muted', text: r.note })]); };
  const gen = (path) => async () => { err.hidden = true; try { show(await post(`/projects/${S.active.id}/invites${path}`, { ttlMin: +ttl.value, maxUses: +uses.value })); } catch (ex) { err.textContent = ex.message; err.hidden = false; } };
  const body = h('div', null, [h('p', { class: 'small muted', text: 'Comunica il codice a voce o scrivilo ai compagni. Il codice non dà permessi speciali, scade da solo e puoi annullarlo o rigenerarlo quando vuoi.' }),
    h('div', { class: 'row' }, [h('div', null, h('label', { for: 'ttl', text: 'Durata' }), ttl), h('div', null, h('label', { for: 'uses', text: 'Usi massimi' }), uses)]),
    h('div', { class: 'row', style: 'margin-top:.7rem' }, [h('button', { class: 'btn primary', type: 'button', text: 'Genera un nuovo codice', onclick: gen('') }),
      h('button', { class: 'btn', type: 'button', text: 'Rigenera (annulla i codici attivi)', onclick: gen('/regenerate') })]), h('div', { style: 'margin-top:1rem' }, out), err]);
  await dialog('Invita compagni nel gruppo', body, [{ label: 'Chiudi' }]);
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
