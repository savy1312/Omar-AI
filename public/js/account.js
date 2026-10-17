// Pagina dedicata all'account (#/account): profilo, cambio password, dispositivi collegati, tema, voce, tutorial, privacy, uscita.
import { h, add, clear, toast, confirmDialog, fmtDate } from './dom.js';
import { get, post, patch, del } from './api.js';
import { icon } from './icons.js';
import { showRecoveryCode } from './recovery.js';
import { soundOn, setSound } from './sound.js';
import { limOn, setLim } from './lim.js';

// Stima della robustezza della password (solo indicativa, lato browser: la regola vera la applica il server)
function strength(pw, min) {
  let s = 0;
  if (pw.length >= min) s++; if (pw.length >= min + 4) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++;
  if (/(.)\1{3,}/.test(pw) || /^(password|1234|qwerty)/i.test(pw)) s = Math.min(s, 1);
  return Math.min(4, s);
}
const LABELS = ['Molto debole', 'Debole', 'Discreta', 'Buona', 'Ottima'];

export async function renderAccount(main, S) {
  let info; try { info = await get('/account'); } catch (e) { add(main, h('div', { class: 'err', text: e.message })); return; }
  const min = info.minPasswordLength || 10;
  const page = h('div', { class: 'page acc' });
  const initial = () => (S.user.displayName || '?').trim().slice(0, 1).toUpperCase();

  // ── profilo ──
  const nameIn = h('input', { type: 'text', id: 'acc-name', maxLength: 40, value: S.user.displayName, autocomplete: 'nickname' });
  const av = h('div', { class: 'acc-av', 'aria-hidden': true, text: initial() });
  const profile = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-p' }, [
    h('div', { class: 'acc-hero' }, [av, h('div', null, [h('h1', { id: 'acc-p', text: S.user.displayName }), h('p', { class: 'muted', text: `${info.roleLabel} · ${info.email || S.user.username}` }), h('p', { class: 'small muted', text: `Account creato il ${new Date(info.createdAt).toLocaleDateString('it-IT')}` })])]),
    h('div', { class: 'acc-stats' }, [['Chat', info.counts.chats, 'clock'], ['File personali', info.counts.materials, 'file'], ['Gruppi', info.counts.groups, 'users']].map(([l, n, ic]) => h('div', { class: 'acc-stat' }, icon(ic, 18), h('strong', { text: String(n) }), h('span', { text: l })))),
    h('label', { for: 'acc-name', text: 'Nome che vedono i compagni' }),
    h('div', { class: 'row' }, nameIn, h('button', { class: 'btn', type: 'button', text: 'Salva il nome', onclick: async () => {
      try { const r = await patch('/account', { displayName: nameIn.value }); S.user = { ...S.user, ...r.user }; S.onUserChange?.(S.user); profile.querySelector('h1').textContent = r.user.displayName; av.textContent = initial(); toast('Nome aggiornato.'); } catch (e) { toast(e.message, 'bad'); }
    } })),
  ]);

  // ── password ──
  const cur = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password', required: true });
  const nw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', required: true, minLength: min, maxLength: 200 });
  const rep = h('input', { type: 'password', id: 'pw-rep', autocomplete: 'new-password', required: true });
  const others = h('input', { type: 'checkbox', id: 'pw-oth', checked: true });
  const meter = h('div', { class: 'pw-meter', 'aria-hidden': true }, [h('i'), h('i'), h('i'), h('i')]);
  const meterTxt = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const checks = h('ul', { class: 'pw-checks' });
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const show = h('button', { class: 'btn sm ghost', type: 'button', 'aria-pressed': 'false', onclick: () => { const on = show.getAttribute('aria-pressed') !== 'true'; show.setAttribute('aria-pressed', String(on)); for (const i of [cur, nw, rep]) i.type = on ? 'text' : 'password'; show.lastChild.textContent = on ? 'Nascondi' : 'Mostra'; } }, icon('eye', 15), 'Mostra');
  const update = () => {
    const pw = nw.value; const s = pw ? strength(pw, min) : -1;
    meter.dataset.s = String(s); meterTxt.textContent = pw ? `Robustezza: ${LABELS[s]}` : '';
    clear(checks);
    for (const [ok, t] of [[pw.length >= min, `Almeno ${min} caratteri`], [pw && pw !== cur.value, 'Diversa da quella attuale'], [pw && rep.value === pw, 'Le due password coincidono'], [pw && !pw.toLowerCase().includes(S.user.username.split('@')[0].toLowerCase()), 'Non contiene il tuo nome utente']]) checks.append(h('li', { class: ok ? 'ok' : '' }, icon(ok ? 'check' : 'x', 13), t));
  };
  for (const i of [cur, nw, rep]) i.addEventListener('input', update); update();
  const submit = async (e) => {
    e.preventDefault(); err.hidden = true;
    if (nw.value !== rep.value) { err.textContent = 'Le due nuove password non coincidono.'; err.hidden = false; rep.focus(); return; }
    const btn = e.submitter || form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await post('/account/password', { currentPassword: cur.value, newPassword: nw.value, signOutOthers: others.checked });
      cur.value = nw.value = rep.value = ''; update();
      toast(r.closedSessions ? `Password cambiata. Disconnessi ${r.closedSessions} altri dispositivi.` : 'Password cambiata.');
      drawSessions(true);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; (ex.code === 'password_errata' ? cur : nw).focus(); }
    finally { btn.disabled = false; }
  };
  const form = h('form', { class: 'acc-card', 'aria-labelledby': 'acc-pw', onsubmit: submit }, [
    h('div', { class: 'acc-head' }, h('h2', { id: 'acc-pw' }, icon('key', 19), 'Cambia la password'), show),
    h('label', { for: 'pw-cur', text: 'Password attuale' }), cur,
    h('label', { for: 'pw-new', text: 'Nuova password' }), nw, h('div', { class: 'pw-row' }, meter, meterTxt),
    h('label', { for: 'pw-rep', text: 'Ripeti la nuova password' }), rep, checks,
    h('label', { class: 'radio' }, others, 'Disconnetti gli altri dispositivi (consigliato)'),
    err, h('div', { class: 'row', style: 'margin-top:.8rem' }, h('button', { class: 'btn primary', type: 'submit', text: 'Cambia password' })),
  ]);
  // ── codice di recupero: permette di scegliere una nuova password da soli se la si dimentica ──
  const recPw = h('input', { type: 'password', id: 'rc-pw', autocomplete: 'current-password', placeholder: 'La tua password attuale' });
  const recErr = h('div', { class: 'err', role: 'alert', hidden: true });
  const recState = h('p', { class: 'small', text: info.hasRecovery ? '✓ Hai già un codice di recupero. Generandone uno nuovo, quello vecchio smette di valere.' : 'Non hai ancora un codice di recupero: generalo ora, così se dimentichi la password potrai cambiarla da solo.' });
  const recovery = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-rc' }, [h('h2', { id: 'acc-rc' }, icon('lock', 19), 'Password dimenticata? Codice di recupero'), recState,
    h('label', { for: 'rc-pw', text: 'Conferma con la password attuale' }), recPw, recErr,
    h('div', { class: 'row', style: 'margin-top:.6rem' }, h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      const b = e.currentTarget; recErr.hidden = true; b.disabled = true;
      try { const r = await post('/account/recovery', { currentPassword: recPw.value }); recPw.value = ''; await showRecoveryCode(r.code, { username: info.user.username }); recState.textContent = '✓ Codice di recupero creato. Quello precedente non vale più.'; }
      catch (ex) { recErr.textContent = ex.message; recErr.hidden = false; } finally { b.disabled = false; }
    } }, icon('key', 15), info.hasRecovery ? 'Genera un nuovo codice' : 'Genera il codice di recupero')),
    h('p', { class: 'small muted', text: 'Con il codice: schermata di accesso › «Password dimenticata?». Senza codice, chi gestisce il computer usa «REIMPOSTA-PASSWORD» e ti dà una password temporanea, da cambiare al primo accesso.' })]);

  // ── dispositivi ──
  const devBox = h('div', { class: 'acc-devs' });
  async function drawSessions(reload = false) {
    if (reload) { try { info = await get('/account'); } catch { /* resta la lista precedente */ } }
    clear(devBox);
    for (const s of info.sessions) {
      devBox.append(h('div', { class: `acc-dev${s.current ? ' cur' : ''}` }, [h('span', { class: 'acc-dev-ic', 'aria-hidden': true }, icon('device', 18)),
        h('div', { class: 'grow' }, h('strong', { text: s.device }), h('div', { class: 'small muted', text: `${s.current ? 'Questo dispositivo · ' : ''}ultimo uso ${fmtDate(s.lastSeen)} · accesso del ${fmtDate(s.createdAt)}` })),
        s.current ? h('span', { class: 'badge ok', text: 'in uso' }) : h('button', { class: 'btn sm', type: 'button', text: 'Disconnetti', onclick: async () => { try { await del(`/account/sessions/${s.id}`); toast('Dispositivo disconnesso.'); drawSessions(true); } catch (e) { toast(e.message, 'bad'); } } })]));
    }
    if (info.sessions.length > 1) devBox.append(h('button', { class: 'btn sm danger', type: 'button', text: 'Disconnetti tutti gli altri', onclick: async () => {
      if (!(await confirmDialog('Disconnettere gli altri dispositivi?', 'Su tutti gli altri computer e telefoni dovrai accedere di nuovo.', { ok: 'Disconnetti', danger: true }))) return;
      try { const r = await post('/account/sessions/revoke-others'); toast(`Disconnessi ${r.closed} dispositivi.`); drawSessions(true); } catch (e) { toast(e.message, 'bad'); } } }));
  }
  drawSessions();
  const devices = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-d' }, [h('h2', { id: 'acc-d' }, icon('device', 19), 'Dove hai fatto l’accesso'), h('p', { class: 'small muted', text: 'Le sessioni aperte con il tuo account. Se non riconosci un dispositivo, disconnettilo e cambia la password.' }), devBox]);

  // ── preferenze ──
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' }, [['dark', 'Scuro', 'moon'], ['light', 'Chiaro', 'sun']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(S.theme?.get() === v), onclick: (e) => { S.theme.set(v); for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, icon(ic, 16), l)));
  const voice = S.voice;
  // (lettura ad alta voce rimossa: non restano elementi di voce da costruire qui)
  const prefs = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-pref' }, [h('h2', { id: 'acc-pref' }, icon('sun', 19), 'Preferenze'),
    h('p', { class: 'dlg-label', text: 'Tema' }), seg,
    h('p', { class: 'dlg-label', text: 'Classe e lavagna' }),
    h('label', { class: 'radio', for: 'acc-lim' }, h('input', { type: 'checkbox', id: 'acc-lim', checked: limOn(), onchange: (e) => setLim(e.target.checked) }), 'Modalità LIM / proiettore: testo più grande e contrasto alto'),
    h('label', { class: 'radio', for: 'acc-snd' }, h('input', { type: 'checkbox', id: 'acc-snd', checked: soundOn(), onchange: (e) => setSound(e.target.checked) }), 'Suoni dell’interfaccia (clic, avvisi, contributi dei compagni)'),
    h('label', { class: 'radio', for: 'acc-mic' }, h('input', { type: 'checkbox', id: 'acc-mic', checked: false, disabled: true }), 'Scrivere a voce: usa il microfono accanto al campo di scrittura'),
    // NB: la lettura ad alta voce (Omar Voice) è stata tolta dall'interfaccia: restano solo tema, LIM e suoni.
    h('p', { class: 'small muted', text: voice?.canListen ? 'Dettatura: premi il microfono accanto al campo di scrittura. Nota: in Chrome ed Edge il riconoscimento vocale è svolto dai server di Google o Microsoft, fuori dalla scuola.' : 'La dettatura vocale non è supportata da questo browser (prova Chrome o Edge).' }),
  ]);

  const more = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-m' }, [h('h2', { id: 'acc-m' }, icon('more', 19), 'Altro'),
    h('div', { class: 'acc-links' }, [
      h('button', { class: 'acc-link', type: 'button', onclick: () => S.replayTutorial?.() }, icon('play', 18), h('span', null, h('strong', { text: 'Rivedi il tutorial' }), h('small', { text: 'Il video che spiega tutte le funzioni, passo per passo.' }))),
      h('a', { class: 'acc-link', href: '#/privacy' }, icon('lock', 18), h('span', null, h('strong', { text: 'Privacy e dati' }), h('small', { text: 'Scarica o elimina i tuoi dati, cosa resta privato.' }))),
      h('a', { class: 'acc-link', href: '#/cronologia' }, icon('history', 18), h('span', null, h('strong', { text: 'Tutta la cronologia' }), h('small', { text: 'Le tue conversazioni, per giorno e materia.' }))),
      h('button', { class: 'acc-link danger', type: 'button', onclick: () => S.logout?.() }, icon('power', 18), h('span', null, h('strong', { text: 'Esci' }), h('small', { text: 'Chiude la sessione su questo dispositivo.' }))),
    ])]);

  // ── Server della classe: i gruppi tra computer diversi passano da UN computer della classe ──
  const classeBody = h('div');
  const classe = h('section', { class: 'acc-card', 'aria-labelledby': 'acc-c' }, [h('h2', { id: 'acc-c' }, icon('users', 19), 'Server della classe'), classeBody]);
  const copyBtn = (t) => h('button', { class: 'btn sm', type: 'button', text: 'Copia', onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.target.textContent = 'Copiato'; } catch { toast(t); } } });
  const setAula = async (on) => {
    if (on && !(await confirmDialog('Rendere questo computer il server della classe?', 'Gli altri computer della classe potranno collegarsi a questo Omar con l’indirizzo e il codice d’aula, per lavorare in gruppo. Questo computer deve restare acceso con Omar aperto mentre la classe lo usa, sulla rete della scuola. Se Windows chiede il permesso del firewall, consenti solo le reti private.', { ok: 'Attiva' }))) return;
    try { const r = await post('/desktop/aula', { on }); toast(r.message); drawClasse(); } catch (e) { toast(e.message, 'bad'); }
  };
  async function drawClasse() {
    clear(classeBody);
    let d; try { d = await get('/desktop'); } catch { add(classeBody, h('p', { class: 'small muted', text: 'Stato non disponibile.' })); return; }
    if (!d.desktopOnly) { classe.hidden = true; return; } // versione web: tutti usano già lo stesso server
    if (!d.local) {
      add(classeBody, [h('p', { class: 'small', text: 'Sei collegato al server della classe da un altro computer: gruppi e codici di invito sono condivisi con tutta la classe.' }),
        h('a', { class: 'btn sm', href: 'http://localhost:3300/desktop/locale', text: 'Usa Omar solo su questo computer' })]);
      return;
    }
    if (d.aula) {
      add(classeBody, [h('p', { class: 'small', text: 'Questo computer è il server della classe. Comunica ai compagni (una volta sola) indirizzo e codice d’aula: lo inseriscono in Gruppo > Collega un dispositivo > «Collegati al server della classe».' }),
        h('div', { class: 'item row' }, h('span', { class: 'grow' }, h('small', { class: 'muted', text: 'Indirizzo  ' }), h('strong', { text: (d.addresses || []).join('  oppure  ') || 'nessuna rete' })), d.addresses?.[0] && copyBtn(d.addresses[0])),
        h('div', { class: 'item row' }, h('span', { class: 'grow' }, h('small', { class: 'muted', text: 'Codice d’aula  ' }), h('strong', { class: 'code', style: 'font-size:1.05rem;margin:0', text: d.aulaKey })), copyBtn(d.aulaKey)),
        h('button', { class: 'btn sm', type: 'button', text: 'Disattiva il server della classe', onclick: () => setAula(false) })]);
      return;
    }
    if (d.classe) {
      add(classeBody, [h('p', { class: 'small', text: `L’icona «Omar AI» apre il server della classe ${d.classe.nome ? `(${d.classe.nome}) ` : ''}su ${d.classe.address}.` }),
        h('button', { class: 'btn sm', type: 'button', text: 'Scollega da quel server', onclick: async () => { try { await del('/desktop/classe'); toast('Scollegato: l’icona aprirà Omar su questo computer.'); drawClasse(); } catch (e) { toast(e.message, 'bad'); } } })]);
      return;
    }
    add(classeBody, [h('p', { class: 'small muted', text: 'Ogni computer ha il suo Omar: gruppi e codici di invito valgono solo sul computer dove sono stati creati. Per lavorare in gruppo da computer diversi, un computer della classe (di solito quello del docente) diventa server della classe e gli altri si collegano.' }),
      h('div', { class: 'row' }, [h('button', { class: 'btn sm primary', type: 'button', text: 'Collegati a un server della classe', onclick: async () => (await import('./app.js')).classeDialog() }),
        h('button', { class: 'btn sm', type: 'button', text: 'Rendi questo computer il server della classe', onclick: () => setAula(true) })])]);
  }
  drawClasse();

  add(page, [h('div', { class: 'acc-grid' }, [h('div', { class: 'acc-col' }, [profile, devices, prefs]), h('div', { class: 'acc-col' }, [form, recovery, classe, more])])]);
  main.append(page);
}
