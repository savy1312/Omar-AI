// Home di Omar AI (saluto centrale + campo bianco) e chat con formule, fonti, indizi, condivisione esplicita, allegati (immagine, file, cartella, link) e ricerca sul web.
import { h, add, clear, $, toast, dialog, confirmDialog, renderMarkdown, fmtDate } from './dom.js';
import { get, post, patch, del, api, ApiError, stream, canStream, auth } from './api.js';
import { icon } from './icons.js';
import { createLiveReply } from './livereply.js';
import { prepareFiles, filesDialog, linkDialog, trackMaterials, summaryText, IMAGE_EXT, MAX_FOLDER_FILES } from './attach.js';

// File trascinati sul campo di scrittura: anche intere cartelle (si visitano le sottocartelle). Ogni file porta il percorso relativo.
async function droppedFiles(dt) {
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return { files: [...(dt.files || [])], folder: null };
  const out = []; let folder = null;
  const walk = async (e, prefix) => {
    if (out.length > 200) return;
    if (e.isFile) { const f = await new Promise((r, j) => e.file(r, j)).catch(() => null); if (f) { Object.defineProperty(f, 'omarRel', { value: prefix + f.name }); out.push(f); } return; }
    if (e.isDirectory) {
      const reader = e.createReader(); let batch;
      do { batch = await new Promise((r) => reader.readEntries(r, () => r([]))); for (const c of batch) await walk(c, `${prefix}${e.name}/`); } while (batch.length);
    }
  };
  for (const e of entries) { if (e.isDirectory && !folder) folder = e.name; await walk(e, ''); }
  return { files: out, folder: entries.length === 1 && entries[0].isDirectory ? folder : null };
}

const FIRST_KEY = 'omar.first';
const CERCA_KEY = 'omar.cerca.web';
// Allegati scelti dalla home, elaborati appena la chat esiste: gruppi di file (file / immagini / cartella) e link già letti dal server
export const pending = { groups: [], links: [] };
// «Cerca» = ricerca sul web. Spenta di default a ogni nuova sessione del browser: la domanda esce dalla scuola solo se lo studente lo sceglie.
const cerca = { get: () => { try { return sessionStorage.getItem(CERCA_KEY) === '1'; } catch { return false; } }, set: (v) => { try { sessionStorage.setItem(CERCA_KEY, v ? '1' : '0'); } catch { /* ignora */ } } };
// Foto profilo dell'IA: il logo di Omar AI
const avatar = () => h('img', { class: 'avatar', src: '/img/logo.png', alt: '', width: 32, height: 32, draggable: 'false' });
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

// Campo di scrittura: «+» (immagine, file, cartella, link), «Cerca» (web), eventuali comandi extra (gruppo, voce), invio.
// Niente menu di materia/modalità/livello: li riconosce il server dal messaggio.
export function buildComposer({ S, placeholder, maxLength, onSend, onPick, onLink, extra = [], id, rows = 1 }) {
  const input = h('textarea', { id, rows, maxLength, placeholder, 'aria-label': placeholder });
  const sendBtn = h('button', { class: 'csend', type: 'button', 'aria-label': 'Invia', title: 'Invia' }, icon('up', 18));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 240) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend('enter'); } });
  sendBtn.addEventListener('click', () => onSend('click'));
  // mentre il tutor scrive, il pulsante diventa «Interrompi» (quadrato); finita la risposta torna la freccia di invio
  const setStop = (on) => { sendBtn.classList.toggle('stop', on); sendBtn.setAttribute('aria-label', on ? 'Interrompi la risposta' : 'Invia'); sendBtn.title = on ? 'Interrompi la risposta' : 'Invia'; clear(sendBtn); sendBtn.append(icon(on ? 'stop' : 'up', 18)); };

  // selettori di file nascosti (uno per tipo di scelta)
  const caps = S.info?.capabilities || {};
  const exts = caps.anyFile ? '' : (caps.formats || []).map((f) => f.ext).join(',');
  const vision = !!caps.imageAnalysis;
  const picker = (kind, props) => { const el = h('input', { type: 'file', hidden: true, 'aria-hidden': true, tabindex: -1, ...props }); el.addEventListener('change', () => { const list = [...el.files]; el.value = ''; if (list.length) onPick(kind, list); }); return el; };
  const imageInput = picker('image', { accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp', multiple: true });
  const fileInput = picker('file', exts ? { accept: exts, multiple: true } : { multiple: true });
  const folderInput = picker('folder', { multiple: true }); folderInput.setAttribute('webkitdirectory', ''); folderInput.setAttribute('directory', '');

  const MENU = [
    { ic: 'image', t: 'Immagine', d: vision ? 'Omar la guarda, ne legge il testo e te la spiega. Puoi anche incollarla.' : 'Archiviata e mostrata: manca il modello IA «vista» per leggerla.', run: () => imageInput.click() },
    { ic: 'file', t: 'File', d: 'PDF, Word, Excel, PowerPoint, CAD (DXF/STEP/STL), codice, ZIP…', run: () => fileInput.click() },
    { ic: 'folder', t: 'Aggiungi una cartella', d: `Omar legge i file della cartella (fino a ${MAX_FOLDER_FILES}). Puoi anche trascinarla qui.`, run: () => folderInput.click() },
    { ic: 'link', t: 'Importa un link', d: 'L’IA legge la pagina e te la spiega.', run: () => onLink() },
  ];
  const items = MENU.map((m) => h('button', { class: 'cmenu', type: 'button', role: 'menuitem', onclick: () => { closePops(); m.run(); } },
    h('span', { class: 'cm-ico', 'aria-hidden': true }, icon(m.ic, 19)), h('span', { class: 'cm-txt' }, h('strong', { text: m.t }), h('small', { text: m.d }))));
  const plusPop = h('div', { class: 'cpop plus', hidden: true, role: 'menu', 'aria-label': 'Cosa vuoi allegare?' }, items);
  plusPop.addEventListener('keydown', (e) => { // frecce su/giù tra le voci del menu
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault();
    const i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  const closePops = () => { plusPop.hidden = true; plusBtn.setAttribute('aria-expanded', 'false'); };
  const toggle = (pop, btn) => { const was = pop.hidden; closePops(); pop.hidden = !was; btn.setAttribute('aria-expanded', String(was)); if (was && pop === plusPop) items[0].focus(); };
  const plusBtn = h('button', { class: 'cbtn cplus', type: 'button', 'aria-label': 'Allega: immagine, file, cartella o link', title: 'Allega…', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => toggle(plusPop, plusBtn) }, icon('plus', 20));

  // «Cerca»: se attivo (grigio) il tutor cerca anche sul web. Spento di default.
  const web = S.info?.web?.search || { enabled: false };
  const cercaBtn = h('button', { class: 'cbtn ccerca', type: 'button', 'aria-pressed': String(cerca.get() && web.enabled), title: web.enabled ? 'Cerca sul web: il tutor consulta anche pagine trovate online' : 'La ricerca sul web non è attiva su questo server', onclick: () => {
    if (!web.enabled) { toast('La ricerca sul web non è attiva su questo server: chiedi all’amministratore.', 'bad'); return; }
    cerca.set(!cerca.get()); cercaBtn.setAttribute('aria-pressed', String(cerca.get()));
    toast(cerca.get() ? `Cerca attivo. ${web.notice}` : 'Cerca disattivato: il tutor non cerca sul web.');
  } }, icon('globe', 18), h('span', { text: 'Cerca' }));
  if (!web.enabled) cercaBtn.classList.add('off');


  // vassoio degli allegati scelti dalla home (file, immagini, cartelle, link): ognuno si può togliere prima dell'invio
  const tray = h('div', { class: 'ctray', hidden: true, 'aria-label': 'Allegati scelti' });
  const drawTray = () => {
    clear(tray); const n = pending.groups.length + pending.links.length; tray.hidden = !n;
    const chipEl = (ic, text, sub, remove) => h('span', { class: 'cfile' }, icon(ic, 15), h('span', { class: 'cf-t', text }), sub && h('span', { class: 'cf-s', text: sub }), h('button', { type: 'button', 'aria-label': `Rimuovi ${text}`, title: 'Rimuovi', onclick: remove }, icon('x', 12)));
    for (const g of pending.groups) tray.append(chipEl(g.kind === 'folder' ? 'folder' : g.kind === 'image' ? 'image' : 'file', g.label, g.files.length > 1 ? `${g.files.length} file` : null, () => { pending.groups.splice(pending.groups.indexOf(g), 1); drawTray(); }));
    for (const l of pending.links) tray.append(chipEl('link', l.label, l.host, () => { pending.links.splice(pending.links.indexOf(l), 1); drawTray(); }));
  };
  const dropHint = h('div', { class: 'cdrop', 'aria-hidden': true }, icon('upload', 22), h('span', { text: 'Rilascia qui file, foto o cartelle' }));
  const el = h('div', { class: 'composer-card' }, [tray, input, h('div', { class: 'cbar' }, [plusBtn, cercaBtn, ...extra.filter(Boolean), h('span', { class: 'sp' }), sendBtn]), plusPop, imageInput, fileInput, folderInput, dropHint]);
  // trascina qui file, foto o un'intera cartella · incolla (Ctrl+V) uno screenshot o una foto
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let depth = 0;
  el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.classList.add('dropping'); });
  el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; el.classList.remove('dropping'); } });
  el.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; el.classList.remove('dropping');
    const { files, folder } = await droppedFiles(e.dataTransfer); if (!files.length) return;
    onPick(folder ? 'folder' : files.every((f) => IMAGE_EXT.test(f.name)) ? 'image' : 'file', files, { folder });
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])]; if (!files.length) return;
    e.preventDefault();
    const named = files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `incollata-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}${i ? `-${i}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
    onPick(named.every((f) => IMAGE_EXT.test(f.name)) ? 'image' : 'file', named, {});
  });
  document.addEventListener('pointerdown', (e) => { if (!el.isConnected) return; if (!el.contains(e.target)) closePops(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !plusPop.hidden) { e.stopPropagation(); closePops(); plusBtn.focus(); } });
  return { el, input, sendBtn, grow, closePops, drawTray, setStop };
}

// Colori delle materie (cronologia, intestazione della chat)
export const SUBJECT_COLOR = { meccanica: '#ffb454', meccatronica: '#8ab4ff', disegno_3d: '#7be0a8', generale: '#9aa0ad' };
const CONF_LABEL = { alta: 'riconosciuta con sicurezza', media: 'riconosciuta', bassa: 'incerta', fissata: 'scelta da te' };

export async function renderHome(main, S) {
  // «Gruppo»: collega la nuova chat al gruppo attivo (Cross-Chat Sync). Attivo di default quando c'è un gruppo.
  let linkGroup = !!S.active;
  const groupBtn = S.active ? h('button', { class: 'cbtn cgroup', type: 'button', 'aria-pressed': 'true', title: `Collega questa chat al gruppo “${S.active.name}”`, onclick: () => { linkGroup = !linkGroup; groupBtn.setAttribute('aria-pressed', String(linkGroup)); toast(linkGroup ? `La chat sarà collegata al gruppo “${S.active.name}”.` : 'Chat personale, non collegata al gruppo.'); } },
    icon('users', 17), h('span', { class: 'cg-t', text: `Gruppo: ${S.active.name}` })) : null;
  const start = async () => {
    const text = comp.input.value.trim(); comp.sendBtn.disabled = true;
    try {
      const r = await post('/sessions', { projectId: linkGroup && S.active ? S.active.id : undefined });
      try { if (text) sessionStorage.setItem(FIRST_KEY, JSON.stringify({ id: r.session.id, text })); } catch { /* ignora */ }
      location.hash = `#/chat/${r.session.id}`;
    } catch (e) { toast(e.message, 'bad'); comp.sendBtn.disabled = false; }
  };
  // file, immagini e cartelle scelti dalla home: restano nel vassoio e vengono caricati (con la scelta di visibilità) quando la chat si apre
  const onPick = (kind, list, { folder: dropped } = {}) => {
    const prep = prepareFiles(list, S, { folder: kind === 'folder' });
    if (!prep.files.length) { toast(prep.skipped.length ? `Nessun file utilizzabile: ${prep.skipped[0][1]}.` : 'Nessun file utilizzabile.', 'bad'); return; }
    const root = kind === 'folder' ? dropped || (list[0].omarRel || list[0].webkitRelativePath || '').split('/')[0] || 'Cartella' : prep.files.length <= 2 ? prep.files.map((x) => x.rel).join(', ') : `${prep.files[0].rel} e altri ${prep.files.length - 1}`;
    pending.groups.push({ kind, label: root, files: prep.files, skipped: prep.skipped }); comp.drawTray();
    if (prep.skipped.length) toast(`${prep.skipped.length} file non allegati (formato non ammesso, troppo grandi o oltre il limite).`);
  };
  const onLink = async () => {
    const r = await linkDialog(S, { groupId: linkGroup ? S.active?.id : null });
    if (!r) return; pending.links.push({ materialId: r.material.materialId, label: r.title, host: r.host }); comp.drawTray(); toast(`Pagina letta: “${r.title}”.`);
  };
  const comp = buildComposer({ S, id: 'first', rows: 2, placeholder: 'Scrivi l’esercizio, la domanda o cosa non ti torna…', maxLength: S.info.limits.maxMessageChars, onSend: start, onPick, onLink, extra: [groupBtn, S.voice?.micButton?.(() => comp.input)] });
  comp.drawTray();
  add(main, h('div', { class: 'hero' }, [
    h('h1', { text: 'Come posso aiutarti oggi?' }), comp.el,
    h('p', { class: 'hint-line', text: 'Scrivi pure come ti viene: capisco da solo la materia e se ti serve una spiegazione, una guida all’esercizio o un ripasso. Se non capisci una parola, selezionala e trascinala sulla pillola in alto.' }),
  ]));
  comp.input.focus();
}

export async function renderChat(main, S, [id]) {
  if (!id) { location.hash = '#/home'; return; }
  let data; let sessions = [];
  const load = async () => { [data, { sessions }] = await Promise.all([get(`/sessions/${id}`), get('/sessions')]); };
  try { await load(); } catch (e) { add(main, h('div', { class: 'err', text: e.message })); add(main, h('p', null, h('a', { href: '#/home', text: 'Torna alla home' }))); return; }
  const wrap = h('div', { class: 'chat', 'aria-label': 'Chat con il tutor' }); main.append(wrap);
  const msgsEl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversazione' });
  S.currentSubject = data.session.subjectId === 'generale' ? null : data.session.subjectId;
  const comp = buildComposer({ S, id: 'composer', rows: 1, placeholder: 'Scrivi il tuo ragionamento, i dati o la domanda…', maxLength: S.info.limits.maxMessageChars, onSend: (src) => { if (busy) { if (src === 'click') stopStream(); return; } send(); },
    onPick: (kind, list, o) => pickFiles(kind, list, o), onLink: () => importLink(), extra: [S.voice?.micButton?.(() => comp.input)] });
  const { input, sendBtn } = comp;
  const status = h('div', { class: 'small muted', 'aria-live': 'polite' });
  let busy = false; let lastFailed = null;

  const realSubject = () => (data.session.subjectId && data.session.subjectId !== 'generale' ? data.session.subjectId : null);

  // Intestazione: cosa ha capito Omar (materia, argomento, tipo di aiuto, livello). Solo lettura: niente menu.
  const detEl = h('div', { class: 'cdet', 'aria-live': 'polite' });
  const whyDialog = () => {
    const d = data.session.detect; const ss = data.session;
    dialog('Come ho capito cosa ti serve', h('div', null, [
      h('p', { text: 'Non devi scegliere niente da un menu: leggo il tuo messaggio e capisco da solo la materia, l’argomento e il tipo di aiuto. Se cambi argomento, me ne accorgo.' }),
      h('ul', { class: 'det-list' }, [
        h('li', null, h('strong', { text: 'Materia: ' }), ss.subjectName || 'non ancora chiara', d?.confidence ? h('span', { class: 'muted', text: ` (${CONF_LABEL[d.confidence] || d.confidence})` }) : null),
        ss.topicName && h('li', null, h('strong', { text: 'Argomento: ' }), ss.topicName),
        h('li', null, h('strong', { text: 'Tipo di aiuto: ' }), ss.modeLabel || ''),
        h('li', null, h('strong', { text: 'Livello: ' }), ss.levelLabel || ''),
      ]),
      d?.why?.length ? h('div', null, [h('p', { class: 'small', text: 'Perché:' }), h('ul', { class: 'small muted' }, d.why.map((w) => h('li', { text: w })))]) : null,
      h('p', { class: 'small muted', text: 'Nel dubbio tra spiegarti la teoria e guidarti in un esercizio, scelgo sempre la guida: così non ti do soluzioni pronte. Se ho capito male, scrivilo pure (per esempio “è teoria, spiegamela”).' }),
    ]), [{ label: 'Ho capito' }]);
  };
  function drawDet(flash = false) {
    const ss = data.session; clear(detEl);
    const col = SUBJECT_COLOR[ss.subjectId] || SUBJECT_COLOR.generale;
    add(detEl, [
      h('span', { class: 'cd-dot', style: `background:${col}`, 'aria-hidden': true }),
      h('strong', { class: 'cd-s', text: ss.subjectId === 'generale' ? 'Omar AI' : ss.subjectName || '' }),
      ss.topicName && h('span', { class: 'cd-t', text: ss.topicName }),
      ss.modeLabel && h('span', { class: 'badge auto', text: ss.modeLabel }),
      h('button', { class: 'cd-i', type: 'button', 'aria-label': 'Come ho capito cosa ti serve', title: 'Come ho capito cosa ti serve', onclick: whyDialog }, '?'),
    ]);
    if (flash) { detEl.classList.remove('flash'); void detEl.offsetWidth; detEl.classList.add('flash'); }
  }
  function applyDetect(d) {
    const ss = data.session; const changed = ss.subjectId !== d.subjectId || ss.mode !== d.mode || ss.topicId !== d.topicId;
    Object.assign(ss, { subjectId: d.subjectId, subjectName: d.subjectName, topicId: d.topicId, topicName: d.topicName, mode: d.mode, modeLabel: d.modeLabel, level: d.level, levelLabel: d.levelLabel, detect: d });
    S.currentSubject = realSubject(); drawDet(changed);
  }
  const inProject = () => data.session.projectId && S.active?.id === data.session.projectId;

  function sourcesDialog(m, ref) {
    if (/^W/.test(ref)) { // risultato di una ricerca sul web
      const w = (m.webSources || []).find((x) => x.ref === ref);
      return dialog('Fonte dal web', w ? h('div', null, [h('p', null, h('strong', { text: `[${ref}] ${w.title}` })), h('p', null, 'Sito: ', safeUrl(w.url) ? h('a', { href: w.url, target: '_blank', rel: 'noopener noreferrer', text: `${w.host} ↗` }) : w.host),
        h('p', { class: 'small muted', text: w.read ? 'Il tutor ha letto il testo della pagina (solo l’inizio).' : 'Il tutor ha visto solo l’anteprima del motore di ricerca, non la pagina intera.' }),
        h('p', { class: 'small muted', text: 'Trovato con una ricerca sul web: la scuola non ha verificato questo contenuto e può essere sbagliato o datato. Controlla sempre la fonte originale.' })]) : h('p', { text: 'Fonte non disponibile.' }), [{ label: 'Chiudi' }]);
    }
    const list = [...(m.consulted || []), ...(m.projectConsulted || [])]; const it = list.find((x) => x.ref === ref);
    const body = it ? (it.kind ? h('div', null, h('p', null, h('strong', { text: `[${ref}] ${it.kind[0].toUpperCase() + it.kind.slice(1)}` })), h('p', { text: `Autore: ${it.author} · versione ${it.version} · ${it.status} · ${it.at}` }), h('blockquote', { text: it.preview }), h('p', { class: 'small muted', text: 'Dato condiviso dal gruppo: controlla sempre la fonte originale.' }))
      : h('div', null, h('p', null, h('strong', { text: `[${ref}] ${it.name}` })), h('p', { text: it.sourceUrl ? 'Pagina web che hai importato' : `Versione ${it.version}${it.page ? ` · pagina ${it.page}` : ''}` }), safeUrl(it.sourceUrl) && h('p', null, h('a', { href: it.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: `${it.sourceUrl.replace(/^https?:\/\//, '').slice(0, 70)} ↗` })), h('p', { class: 'small muted', text: it.sourceUrl ? 'Testo letto dal server al momento dell’importazione: la pagina online può essere cambiata.' : 'Passaggio recuperato dai materiali caricati. Il tutor non conosce altre fonti: se una norma non è nei materiali, te lo dice.' }))) : h('p', { text: 'Fonte non disponibile.' });
    dialog('Fonte', body, [{ label: 'Chiudi' }]);
  }
  async function share(m) {
    const body = h('div', null, [h('p', null, 'Stai per condividere con il gruppo ', h('strong', { text: `“${S.active.name}”` }), ' questo messaggio:'), h('blockquote', { text: m.content.slice(0, 500) + (m.content.length > 500 ? '…' : '') }),
      h('p', { class: 'small muted', text: 'Verranno condivisi solo queste parole (email e numeri di telefono vengono tolti). Il resto della chat resta privato. Potrai ritirare il contributo quando vuoi.' })]);
    if (!(await dialog('Condividere con il gruppo?', body, [{ label: 'Annulla', value: false }, { label: 'Condividi', value: true, primary: true }]))) return;
    try { await post(`/sessions/${id}/messages/${m.id}/share`, { projectId: S.active.id }); toast('Condiviso con il gruppo.'); } catch (e) { toast(e.message, 'bad'); }
  }
  async function shareSummary() {
    const t = h('textarea', { rows: 4, maxLength: 1500, 'aria-label': 'Sintesi' }); const err = h('div', { class: 'err', hidden: true });
    const r = await dialog('Condividi una sintesi con parole tue', h('div', null, [h('p', { class: 'small muted', text: 'Scrivi tu cosa vuoi far sapere al gruppo (idea, scelta, dimensioni…).' }), t, err]),
      [{ label: 'Annulla', value: false }, { label: 'Condividi', primary: true, onClick: async () => { try { await post(`/sessions/${id}/share-summary`, { projectId: S.active.id, content: t.value }); toast('Sintesi condivisa.'); return true; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }]);
    return r;
  }

  function msgEl(m) {
    const outer = h('article', { class: `msg ${m.role}`, 'aria-label': m.role === 'user' ? 'Tu' : 'Tutor' });
    const el = m.role === 'user' ? outer : h('div', { class: 'body' });
    if (m.role === 'user') add(el, h('div', { text: m.content, style: 'white-space:pre-wrap' }));
    else { outer.append(avatar(), el); add(el, renderMarkdown(m.content, { onCite: (ref) => sourcesDialog(m, ref) })); }
    const meta = h('div', { class: 'meta' });
    if (m.role === 'assistant' && m.content) { const sp = S.voice?.speakButton(() => m.content); if (sp) meta.append(sp); }
    if (m.simulated) meta.append(h('span', { class: 'badge sim', text: 'Risposta simulata — non generata da un modello IA' }));
    for (const c of m.citations || []) meta.append(c.sourceUrl && safeUrl(c.sourceUrl) ? h('a', { class: 'src web', href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer', title: c.sourceUrl }, icon('link', 13), `[${c.ref}] ${c.name.slice(0, 60)}`)
      : h('span', { class: 'src', text: `[${c.ref}] ${c.name}${c.page ? ` p.${c.page}` : ''} v${c.version}` }));
    if (m.webSources?.length) { // ricerca sul web: quali siti sono stati consultati, con collegamento (prima quelli citati)
      const box = h('div', { class: 'websrc' }, h('span', { class: 'small muted', text: `Cercato${m.webSearch?.provider ? ` su ${m.webSearch.provider}` : ' sul web'}${m.webSearch?.query ? `: “${m.webSearch.query.slice(0, 80)}”` : ''}` }));
      for (const w of [...m.webSources].sort((a, b) => b.cited - a.cited)) if (safeUrl(w.url)) box.append(h('a', { class: `src web${w.cited ? ' cited' : ''}`, href: w.url, target: '_blank', rel: 'noopener noreferrer', title: `${w.title} — ${w.url}` }, icon('globe', 13), `${w.cited ? `[${w.ref}] ` : ''}${w.host}`));
      el.append(box);
    }
    for (const c of m.projectRefs || []) meta.append(h('span', { class: 'src', text: `[${c.ref}] ${c.kind} · ${c.author} · v${c.version}` }));
    if (m.role === 'user' && inProject()) {
      meta.append(h('button', { class: 'btn sm ghost', type: 'button', text: m.shareExcluded ? 'Escluso dalla condivisione' : 'Condividi con il gruppo', onclick: () => (m.shareExcluded ? null : share(m)) }));
      meta.append(h('button', { class: 'btn sm ghost', type: 'button', text: m.shareExcluded ? 'Consenti la condivisione' : 'Escludi', 'aria-label': m.shareExcluded ? 'Consenti la condivisione di questo messaggio' : 'Escludi questo messaggio dalla condivisione automatica', onclick: async (e) => { try { await patch(`/sessions/${id}/messages/${m.id}`, { shareExcluded: !m.shareExcluded }); m.shareExcluded = !m.shareExcluded; e.target.closest('article').replaceWith(msgEl(m)); } catch (ex) { toast(ex.message, 'bad'); } } }));
    }
    if (meta.childNodes.length) el.append(meta);
    if (m.interrupted && m.role === 'assistant') el.append(h('div', { class: 'small muted interrupted', text: 'Risposta interrotta da te.' }));
    for (const n of m.notices || []) {
      if (n.type === 'guardia' || n.type === 'non_condiviso' || n.type === 'chiarimento') add(el, h('div', { class: 'notice warn', role: 'note' }, n.text, n.action?.type === 'request_share' && h('div', null, h('button', { class: 'btn sm', type: 'button', style: 'margin-top:.4rem', text: n.action.label, onclick: () => requestShare(n.action.targetUserId) }))));
      else add(el, h('div', { class: 'notice', role: 'note', text: n.text }));
    }
    return outer;
  }
  async function requestShare(uid) {
    const note = h('input', { type: 'text', maxLength: 200, placeholder: 'Messaggio facoltativo', 'aria-label': 'Messaggio' });
    if (!(await dialog('Chiedi di condividere', h('div', null, [h('p', { text: 'Il compagno vedrà la tua richiesta e deciderà lui cosa condividere. Non posso leggere la sua chat.' }), note]), [{ label: 'Annulla', value: false }, { label: 'Invia richiesta', value: true, primary: true }]))) return;
    try { await post(`/projects/${S.active.id}/share-requests`, { targetUserId: uid, note: note.value || undefined }); toast('Richiesta inviata.'); } catch (e) { toast(e.message, 'bad'); }
  }
  // Scorrimento: segue la risposta che si scrive, ma se lo studente risale per rileggere si ferma e compare «vai in fondo»
  let follow = true;
  const nearBottom = () => msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
  const jump = h('button', { class: 'tobottom', type: 'button', hidden: true, 'aria-label': 'Vai in fondo alla conversazione', title: 'Vai in fondo', onclick: () => { scroll(); jump.hidden = true; } }, icon('down', 18));
  msgsEl.addEventListener('scroll', () => { follow = nearBottom(); jump.hidden = follow || !busy; }, { passive: true });
  const scroll = () => { follow = true; msgsEl.scrollTop = msgsEl.scrollHeight; };
  const tick = () => { if (follow) msgsEl.scrollTop = msgsEl.scrollHeight; else if (busy) jump.hidden = false; };
  function drawAll() {
    clear(msgsEl);
    if (!data.messages.length) msgsEl.append(h('div', { class: 'empty-chat intro' }, h('h2', { text: 'Di cosa hai bisogno?' }), h('p', { text: 'Scrivi l’esercizio o la domanda come ti viene: capisco da solo la materia e il tipo di aiuto. Se hai già provato qualcosa, raccontamelo: parto da lì.' })));
    for (const m of data.messages) msgsEl.append(msgEl(m));
    scroll();
  }

  // Dopo uno Stop (o una connessione caduta) il server salva ciò che era già stato scritto: lo si rilegge per avere i messaggi veri
  async function reconcile(before) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, i ? 450 : 250));
      try { const fresh = await get(`/sessions/${id}`); if (fresh.messages.length >= before + 2) return fresh; } catch { /* riprova */ }
    }
    return null;
  }
  let abortCtl = null;
  const stopStream = () => { if (abortCtl && !abortCtl.signal.aborted) abortCtl.abort(); };
  const setBusy = (on) => { busy = on; wrap.classList.toggle('is-busy', on); comp.setStop(on); msgsEl.setAttribute('aria-busy', String(on)); if (!on) jump.hidden = true; };

  async function send(action, retryText) {
    if (busy) return; const text = retryText ?? input.value.trim();
    if (!text && !action) return;
    setBusy(true); status.textContent = ''; msgsEl.querySelector('.intro')?.remove();
    document.querySelectorAll('.err.retry').forEach((e) => e.remove());
    const before = data.messages.length;
    const tmp = { id: 'tmp', role: 'user', content: text || { hint: 'Dammi un indizio', simpler: 'Spiegalo più semplicemente', check: 'Fammi una domanda di verifica' }[action] };
    const tmpEl = h('article', { class: 'msg user' }, h('div', { text: tmp.content, style: 'white-space:pre-wrap' }));
    const web = cerca.get() && S.info?.web?.search?.enabled && !!text;
    const live = createLiveReply({ avatar: avatar(), web, onPaint: tick, onCite: () => toast('Le fonti si aprono quando la risposta è completa.') });
    msgsEl.append(tmpEl, live.el); scroll();
    input.value = ''; input.style.height = 'auto'; comp.closePops();
    const payload = { text: text || undefined, action: action || undefined, useWeb: web };
    abortCtl = new AbortController(); const ctl = abortCtl;
    let r = null; let err = null;
    try {
      r = canStream() ? await stream(`/sessions/${id}/messages/stream`, payload, { signal: ctl.signal, onEvent: (t, d) => { if (t === 'detect') applyDetect(d); live.event(t, d); } }) : await post(`/sessions/${id}/messages`, payload);
    } catch (e) { err = e; }
    // server avviato con una versione precedente (senza lo streaming): si ripiega sulla risposta normale, intera
    if (!r && (err?.status === 404 || err?.status === 405) && !ctl.signal.aborted) { try { r = await post(`/sessions/${id}/messages`, payload); err = null; } catch (e2) { err = e2; } }
    abortCtl = null;
    try {
      if (r) { // risposta completa: si finisce di scrivere in fretta e poi si sostituisce con il messaggio salvato (con fonti, avvisi, azioni)
        await live.finish();
        data.messages.push(r.userMessage, r.assistantMessage); data.progress = r.progress;
        if (r.session) { data.session = r.session; S.currentSubject = realSubject(); drawDet(); }
        S.voice?.maybeAutoRead(r.assistantMessage.content); loadAttach();
        tmpEl.replaceWith(msgEl(r.userMessage)); live.el.replaceWith(msgEl(r.assistantMessage)); tick(); lastFailed = null;
        if (!data.session.title) data.session.title = r.userMessage.content.slice(0, 60);
        S.refreshHistory?.();
      } else {
        const stopped = err?.name === 'AbortError' || ctl.signal.aborted;
        const hadText = !!live.text();
        if (stopped) live.freeze();
        let fresh = null;
        if (hadText && (stopped || err?.code === 'rete')) fresh = await reconcile(before); // il server ha salvato la parte già scritta
        if (fresh) {
          data.messages = fresh.messages; data.progress = fresh.progress || data.progress;
          const [u, a] = fresh.messages.slice(-2); tmpEl.replaceWith(msgEl(u)); live.el.replaceWith(msgEl(a)); tick(); lastFailed = null;
          if (!data.session.title) data.session.title = u.content.slice(0, 60);
          S.refreshHistory?.();
        } else if (stopped && hadText) { // salvataggio non ancora visibile: resta la parte già scritta, senza azioni
          live.el.append(h('div', { class: 'small muted interrupted', text: 'Risposta interrotta da te.' }));
        } else {
          live.destroy(); tmpEl.remove(); lastFailed = { text, action };
          if (stopped) { toast('Richiesta interrotta: non è stato salvato nulla.'); if (!action) input.value = text; }
          else {
            const box = h('div', { class: 'err retry', role: 'alert' }, h('strong', { text: err.code === 'ia_non_disponibile' ? 'Il tutor al momento non risponde. ' : '' }), err.message || 'Si è verificato un errore.', ' Il tuo messaggio non è andato perso. ',
              err.details?.retryable !== false && h('button', { class: 'btn sm', type: 'button', style: 'margin-left:.5rem', text: 'Riprova', onclick: () => send(action, text) }));
            msgsEl.append(box); if (!action) input.value = text; scroll();
          }
        }
      }
    } finally { setBusy(false); input.focus(); }
  }

  // allegati (immagine, file, cartella, link): la visibilità si sceglie PRIMA dell'invio; ogni allegato viene legato a questa chat, così «spiegami questo» funziona anche senza ripetere le parole del testo
  let stopTrack = null;
  const track = (ids, label) => { stopTrack?.(); stopTrack = trackMaterials(ids, (r) => { status.textContent = `${label}: ${summaryText(r)}`; if (!r.wait && r.ready) toast(`${label}: ${summaryText(r)}.`); }, { get }); };
  async function attachFiles(files, skipped, title, folder = null) {
    const r = await filesDialog(S, { files, skipped, title, sessionId: id, subjectId: realSubject(), groupId: data.session.projectId, folder });
    if (!r?.done?.length) return [];
    if (r.failed.length) toast(`${r.failed.length} file non caricati: ${r.failed[0][1]}`, 'bad');
    const ids = r.done.map((m) => m.materialId);
    track(ids, r.done.length === 1 ? `“${r.done[0].name}”` : `${r.done.length} file`);
    loadAttach(); input.focus(); return ids;
  }

  // ── barra degli allegati di questa chat: anteprima, stato di lettura, «Rileggi», togli dalla chat ──
  const abar = h('div', { class: 'abar', hidden: true, 'aria-label': 'File allegati a questa chat' });
  const thumbs = new Map(); let attPoll = 0;
  const thumb = (m) => {
    if (m.kind !== 'immagine') return null;
    const img = h('img', { class: 'ab-th', alt: '', width: 34, height: 34 });
    if (thumbs.has(m.materialId)) img.src = thumbs.get(m.materialId);
    else fetch(`/api/materials/${m.materialId}/file`, { headers: { authorization: `Bearer ${auth.token}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { const u = URL.createObjectURL(b); thumbs.set(m.materialId, u); img.src = u; } }).catch(() => {});
    return img;
  };
  const KIND_IC = { pdf: 'report', immagine: 'image', cad: 'move', foglio: 'list', presentazione: 'board', codice: 'code', archivio: 'folder', pagina: 'link' };
  async function loadAttach() {
    clearTimeout(attPoll);
    let list; try { list = (await get(`/sessions/${id}/attachments`)).attachments; } catch { return; }
    clear(abar); abar.hidden = !list.length;
    for (const m of list) {
      const busy = ['ricevuto', 'disponibile', 'in_elaborazione'].includes(m.status);
      const st = busy ? ['busy', m.kind === 'immagine' ? 'Omar la sta guardando…' : 'In lettura…'] : m.status === 'pronto' ? ['ok', m.kind === 'immagine' ? 'Vista e letta' : 'Letto'] : m.status === 'non_supportato' ? ['warn', m.kind === 'immagine' ? 'Solo mostrata' : 'Solo archiviato'] : ['bad', 'Non letto'];
      abar.append(h('div', { class: `ab-chip ${st[0]}`, title: m.error || m.capabilityLabel }, [thumb(m) || h('span', { class: 'ab-ic' }, icon(m.sourceUrl ? 'link' : KIND_IC[m.kind] || 'file', 16)),
        h('span', { class: 'ab-txt' }, h('strong', { text: m.name }), h('small', { text: st[1] })),
        st[0] === 'busy' && h('span', { class: 'ab-spin', 'aria-hidden': true }),
        st[0] !== 'ok' && st[0] !== 'busy' && !m.sourceUrl && h('button', { type: 'button', class: 'ab-btn', title: 'Rileggi', 'aria-label': `Rileggi ${m.name}`, onclick: async () => { try { await post(`/materials/${m.materialId}/reprocess`); loadAttach(); } catch (e) { toast(e.message, 'bad'); } } }, icon('replay', 13)),
        h('button', { type: 'button', class: 'ab-btn', title: 'Togli dalla chat', 'aria-label': `Togli ${m.name} dalla chat`, onclick: async () => { try { await del(`/sessions/${id}/materials/${m.materialId}`); loadAttach(); } catch (e) { toast(e.message, 'bad'); } } }, icon('x', 12))]));
    }
    if (list.some((m) => ['ricevuto', 'disponibile', 'in_elaborazione'].includes(m.status))) attPoll = setTimeout(loadAttach, 2000);
  }
  // aspetta (al massimo qualche secondo) che i file appena caricati siano letti, così la prima domanda può già usarli
  const waitReady = async (ids, ms = 8000) => {
    const end = Date.now() + ms; const final = ['pronto', 'fallito', 'non_supportato'];
    while (Date.now() < end) {
      const st = await Promise.all(ids.map((x) => get(`/materials/${x}`).then((m) => m.material.status).catch(() => 'fallito')));
      if (st.every((x) => final.includes(x))) return; await new Promise((r) => setTimeout(r, 500));
    }
  };
  function pickFiles(kind, list, { folder: dropped } = {}) {
    const prep = prepareFiles(list, S, { folder: kind === 'folder' });
    if (!prep.files.length) { toast(prep.skipped.length ? `Nessun file utilizzabile: ${prep.skipped[0][1]}.` : 'Nessun file utilizzabile.', 'bad'); return; }
    const folder = kind === 'folder' ? dropped || (list[0].omarRel || list[0].webkitRelativePath || '').split('/')[0] || 'Cartella' : null;
    attachFiles(prep.files, prep.skipped, folder ? `Allega la cartella “${folder}”` : kind === 'image' ? 'Allega immagini' : 'Allega file', folder);
  }
  async function importLink() {
    const r = await linkDialog(S, { sessionId: id, subjectId: realSubject(), groupId: data.session.projectId });
    if (!r) return; loadAttach(); status.textContent = `Pagina “${r.title}” (${r.host}) letta${r.reused ? ' (già importata poco fa)' : ''}: ora puoi chiedermi di spiegarla o riassumerla.`; toast(`Pagina letta: “${r.title}”.`); input.focus();
  }

  // intestazione e indicatori di progresso
  const progress = () => { const p = data.progress; dialog('I tuoi progressi in questa conversazione', h('div', null, [h('p', { class: 'notice warn', text: p.avviso }), h('p', null, h('strong', { text: 'Autonomia: ' }), p.autonomia), h('p', null, h('strong', { text: 'Tentativi: ' }), String(p.tentativi)), p.competenzeOsservate.length ? h('ul', null, p.competenzeOsservate.map((c) => h('li', { text: `${c.competenza} (${c.riscontriPositivi})` }))) : h('p', { class: 'muted', text: 'Ancora nessuna competenza osservata.' }), p.difficoltaEmerse?.length > 0 && h('p', null, h('strong', { text: 'Punti da riprendere: ' }), p.difficoltaEmerse.join('; ')), h('p', { class: 'small muted', text: p.limiti })]), [{ label: 'Chiudi' }]); };
  drawAll(); drawDet();
  add(wrap, [
    h('div', { class: 'chathead' }, [detEl, h('span', { style: 'flex:1' }),
      h('button', { class: 'btn sm', type: 'button', text: 'I miei progressi', onclick: progress }), inProject() && h('button', { class: 'btn sm', type: 'button', text: 'Condividi una sintesi', onclick: shareSummary }), data.session.projectId && !inProject() && h('span', { class: 'badge warn', text: 'chat non più collegata al gruppo' })]),
    msgsEl, h('div', { class: 'tobottom-wrap' }, jump),
    h('div', { class: 'composer' }, [
      h('div', { class: 'quick', role: 'group', 'aria-label': 'Azioni rapide' }, [['hint', 'Dammi un indizio'], ['simpler', 'Spiegalo più semplicemente'], ['check', 'Fammi una domanda di verifica']].map(([a, l]) => h('button', { class: 'btn sm', type: 'button', text: l, onclick: () => send(a) }))),
      abar, comp.el,
      h('div', { class: 'foot' }, [status, S.info.ai.simulated ? 'Modalità simulazione: risposte non generate da un modello IA.' : 'Omar AI può sbagliare: controlla sempre unità, risultati e fonti. Non capisci una parola? Selezionala e trascinala sulla pillola.'])]),
  ]);
  // allegati scelti dalla home: prima si legano i link, poi si carica la cartella/i file (con la scelta di visibilità); la prima domanda parte dopo
  const linksNow = pending.links.splice(0); const groupsNow = pending.groups.splice(0);
  const handoff = (async () => {
    await new Promise((r) => setTimeout(r, 100));
    let ok = 0; for (const l of linksNow) { try { await post(`/sessions/${id}/materials`, { materialId: l.materialId }); ok++; } catch { /* eliminato nel frattempo */ } }
    if (ok) loadAttach();
    if (ok) status.textContent = `${ok === 1 ? `Pagina “${linksNow[0].label}” allegata` : `${ok} pagine allegate`}: chiedimi di spiegarle o riassumerle.`;
    if (groupsNow.length) {
      const files = groupsNow.flatMap((g) => g.files); const skipped = groupsNow.flatMap((g) => g.skipped || []);
      await attachFiles(files, skipped, groupsNow.length === 1 && groupsNow[0].kind === 'folder' ? `Allega la cartella “${groupsNow[0].label}”` : 'Allega alla conversazione', groupsNow.length === 1 && groupsNow[0].kind === 'folder' ? groupsNow[0].label : null);
      // non serve aspettare qui: se un file è ancora in lettura, il server attende che sia pronto prima di rispondere
    }
  })().catch(() => { /* gli errori sono già mostrati dai singoli passaggi */ });
  input.focus(); loadAttach();
  const off = S.on((ev) => { if (ev.type === 'self.project') { drawAll(); } });
  // messaggio iniziale scritto dalla home
  try { const f = JSON.parse(sessionStorage.getItem('omar.first') || 'null'); if (f?.id === id) { sessionStorage.removeItem('omar.first'); if (!data.messages.length && f.text) handoff.then(() => send(null, f.text)); } } catch { /* ignora */ }
  return () => { off(); clearTimeout(attPoll); for (const u of thumbs.values()) URL.revokeObjectURL(u); };
}
