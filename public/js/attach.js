// Allegati della chat: file, immagini, cartelle e link. La visibilità (solo io / gruppo) si sceglie SEMPRE prima dell'invio.
// Omar legge quasi tutto: PDF (anche scansionati), Word/Excel/PowerPoint, testi e codice, CAD aperti (DXF, STEP, STL…), ZIP e,
// con il modello «vista», immagini e foto. Le foto grandi vengono rimpicciolite nel browser prima dell'invio (più veloci da leggere).
import { h, add, clear, dialog, toast, fmtSize } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { createThinking } from './thinking.js';

export const MAX_FOLDER_FILES = 25;
const JUNK = /(^|\/)(\.[^/]+|thumbs\.db|desktop\.ini|node_modules|__macosx)(\/|$)/i;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const BLOCKED = /\.(exe|dll|msi|com|scr|cpl|sys|apk|app|dmg|iso|lnk|pif)$/i;
const extOf = (n) => (/\.[^./\\]+$/.exec(String(n)) || [''])[0].toLowerCase();
const fmtOf = (S, name) => (S.info?.capabilities?.formats || []).find((f) => f.ext === extOf(name));
// cosa farà Omar con questo file: 'legge' | 'mostra' | 'archivia'
export const fateOf = (S, name) => { const f = fmtOf(S, name); if (!f) return 'legge?'; return f.capability === 'ia_testo' ? 'legge' : f.capability === 'visualizzabile' ? 'mostra' : 'archivia'; };

// Sceglie i file di una cartella: tiene solo i formati ammessi dal server, salta file di sistema, vuoti o troppo grandi, e applica il tetto di 25 file.
export function prepareFiles(list, S, { folder = false } = {}) {
  const max = (S.info?.limits?.maxUploadMb || 25) * 1048576; const files = []; const skipped = [];
  for (const f of [...list]) {
    const rel = f.omarRel || (folder ? (f.webkitRelativePath || f.name) : f.name);
    if (JUNK.test(rel)) continue;                                                       // file nascosti e di sistema: nemmeno elencati
    if (!f.size) skipped.push([rel, 'file vuoto']);
    else if (BLOCKED.test(f.name)) skipped.push([rel, 'programma eseguibile: non ammesso']);
    else if (f.size > max && !IMAGE_EXT.test(f.name)) skipped.push([rel, `supera ${Math.round(max / 1048576)} MB`]);
    else files.push({ file: f, rel });
  }
  const rank = (x) => ({ legge: 2, 'legge?': 1, mostra: 1, archivia: 0 }[fateOf(S, x.rel)]);
  files.sort((a, b) => (rank(b) - rank(a)) || a.rel.localeCompare(b.rel, 'it'));                // prima i file che Omar legge
  for (const x of files.splice(MAX_FOLDER_FILES)) skipped.push([x.rel, `oltre il limite di ${MAX_FOLDER_FILES} file`]);
  return { files, skipped };
}

const visRadios = (S, { fixed, groupId } = {}) => {
  const opts = [['personale', 'Solo io (allegato personale)'], ...(groupId && S.active?.id === groupId ? [['gruppo', `Condividi con il gruppo “${S.active.name}”`]] : [])].filter(([v]) => !fixed || v === fixed);
  return opts.map(([v, l], i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'vis', value: v, checked: i === 0 }), l));
};
const chosenVis = () => document.querySelector('dialog input[name=vis]:checked')?.value || 'personale';

// Foto grandi: rimpicciolite nel browser (lato lungo max 2048 px, JPEG) prima dell'invio. Più leggere da caricare e da far leggere al modello.
export async function shrinkImage(file, { maxSide = 2048, maxBytes = 1.5 * 1048576 } = {}) {
  if (!IMAGE_EXT.test(file.name) || /\.gif$/i.test(file.name) || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= maxBytes) { bmp.close?.(); return file; }
    const w = Math.round(bmp.width * scale); const hh = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.drawImage(bmp, 0, 0, w, hh); bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88)); if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch { return file; }
}
// Carica uno o più file. Ritorna { done:[materiale], failed:[[nome, messaggio]] }.
async function uploadAll(S, items, { visibility, sessionId, subjectId, folder, onProgress }) {
  const done = []; const failed = []; let n = 0;
  for (const it of items) {
    const { rel } = it; onProgress?.(++n, items.length, rel);
    const file = await shrinkImage(it.file);
    const fd = new FormData(); fd.append('visibility', visibility); if (visibility === 'gruppo') fd.append('projectId', S.active.id);
    if (subjectId) fd.append('subjectId', subjectId); if (sessionId) fd.append('sessionId', sessionId); if (rel !== it.file.name) fd.append('name', rel.slice(0, 120)); if (folder || it.folder) fd.append('folder', folder || it.folder); fd.append('file', file);
    try { done.push((await api('POST', '/materials', fd)).material); } catch (e) { failed.push([rel, e.message]); }
  }
  return { done, failed };
}

// Finestra «Allega»: riepilogo dei file scelti, scelta della visibilità, caricamento con avanzamento.
export function filesDialog(S, { files, skipped = [], title = 'Allega alla conversazione', sessionId, subjectId, groupId, folder = null }) {
  const vision = !!S.info?.capabilities?.imageAnalysis;
  const hasImg = files.some((x) => IMAGE_EXT.test(x.rel)); const hasRead = files.some((x) => !IMAGE_EXT.test(x.rel) && fateOf(S, x.rel).startsWith('legge')); const hasOther = files.some((x) => fateOf(S, x.rel) === 'archivia');
  const total = files.reduce((n, x) => n + x.file.size, 0);
  const FATE = { legge: ['ok', 'letto'], 'legge?': ['ok', 'letto se è testo'], mostra: ['', 'solo mostrato'], archivia: ['warn', 'solo archiviato'] };
  const list = h('ul', { class: 'flist' }, files.slice(0, 8).map((x) => { const [c, l] = FATE[fateOf(S, x.rel)]; return h('li', null, icon(IMAGE_EXT.test(x.rel) ? 'image' : 'file', 15), h('span', { class: 'fn', text: x.rel }), h('span', { class: `badge ${c}`, text: l }), h('span', { class: 'fs', text: fmtSize(x.file.size) })); }), files.length > 8 && h('li', { class: 'more', text: `… e altri ${files.length - 8} file` }));
  const notes = [hasRead && 'Omar legge il contenuto (testo, tabelle, diapositive, quote dei disegni, codice) e lo cita quando ti risponde.',
    hasImg && (vision ? 'Immagini e foto: il modello «vista» le descrive e ne trascrive il testo (formule, quote, appunti a mano). Ci vuole qualche secondo in più; le foto grandi vengono rimpicciolite.' : 'Immagini: vengono conservate e mostrate, ma su questo server manca il modello «vista» che le legge (chiedi all’amministratore).'),
    hasOther && 'Alcuni file sono in un formato proprietario: vengono conservati e scaricabili, ma Omar non può leggerli (esportali in PDF, STEP o DXF).'].filter(Boolean);
  const skip = skipped.length ? h('details', { class: 'skipped' }, h('summary', { text: `${skipped.length} file non allegati` }), h('ul', null, skipped.slice(0, 12).map(([n, why]) => h('li', { text: `${n} — ${why}` })), skipped.length > 12 && h('li', { text: `… e altri ${skipped.length - 12}` }))) : null;
  const prog = h('p', { class: 'small muted', hidden: true, role: 'status' }); const err = h('div', { class: 'err', hidden: true, role: 'alert' });
  const body = h('div', null, [h('p', null, h('strong', { text: `${files.length} file` }), ` · ${fmtSize(total)}`), list, skip,
    h('p', { class: 'dlg-label', text: 'Chi può vederli?' }), ...visRadios(S, { groupId }), ...notes.map((t) => h('p', { class: 'small muted', text: t })), prog, err]);
  if (!files.length) { add(body, h('p', { class: 'err', text: 'Nessun file utilizzabile tra quelli scelti.' })); return dialog(title, body, [{ label: 'Chiudi', value: null }]); }
  return dialog(title, body, [{ label: 'Annulla', value: null }, { label: files.length > 1 ? `Allega ${files.length} file` : 'Allega', primary: true, onClick: async (dlg) => {
    for (const b of dlg.querySelectorAll('button')) b.disabled = true; prog.hidden = false; err.hidden = true;
    const r = await uploadAll(S, files, { visibility: chosenVis(), sessionId, subjectId, folder, onProgress: (i, n, name) => { prog.textContent = `Carico ${i} di ${n}: ${name}`; } });
    if (!r.done.length) { for (const b of dlg.querySelectorAll('button')) b.disabled = false; prog.hidden = true; err.textContent = r.failed.map(([n, m]) => `${n}: ${m}`).join(' · ') || 'Caricamento non riuscito.'; err.hidden = false; return false; }
    return { ...r, visibility: chosenVis() };
  } }]);
}

// Finestra «Importa un link»: il SERVER legge la pagina (non il tuo browser) e ne ricava il testo, che diventa un tuo materiale.
export function linkDialog(S, { sessionId = null, subjectId = null, groupId = null, fixed } = {}) {
  const url = h('input', { type: 'text', id: 'lk-url', inputmode: 'url', autocomplete: 'off', spellcheck: false, placeholder: 'https://…', 'aria-label': 'Indirizzo della pagina web' });
  const err = h('div', { class: 'err', hidden: true, role: 'alert' }); const wait = h('div', { class: 'lk-wait', hidden: true, role: 'status' }, createThinking({ width: 40, height: 26, dot: 2.8 }), h('span', { text: 'Sto leggendo la pagina…' }));
  const body = h('div', null, [h('label', { for: 'lk-url', text: 'Indirizzo della pagina o del PDF' }), url,
    h('p', { class: 'dlg-label', text: 'Chi può vederla?' }), ...visRadios(S, { groupId, fixed }),
    h('p', { class: 'small muted', text: 'Il server scarica la pagina e ne tiene il testo come tuo materiale: poi puoi chiedere di spiegarla, riassumerla o cercare un punto, e il tutor cita la fonte. Non apro indirizzi della rete locale né pagine che richiedono un accesso. Puoi eliminare il materiale quando vuoi dalla sezione Materiali.' }), wait, err]);
  const go = async (dlg) => {
    err.hidden = true; const value = url.value.trim();
    if (!/^https?:\/\//i.test(value)) { err.textContent = 'Incolla un link completo che inizi con http:// o https://'; err.hidden = false; url.focus(); return false; }
    for (const b of dlg.querySelectorAll('button, input')) b.disabled = true; wait.hidden = false;
    try {
      const vis = chosenVis();
      return await api('POST', '/links/import', { url: value, visibility: vis, projectId: vis === 'gruppo' ? S.active.id : undefined, subjectId: subjectId || undefined, sessionId: sessionId || undefined });
    } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
    finally { wait.hidden = true; for (const b of dlg.querySelectorAll('button, input')) b.disabled = false; }
  };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.closest('dialog')?.querySelector('button.primary')?.click(); } });
  return dialog('Importa un link', body, [{ label: 'Annulla', value: null }, { label: 'Leggi la pagina', primary: true, onClick: go }]);
}

// Controlla finché i materiali sono pronti; chiama onUpdate con un riepilogo leggibile.
export function trackMaterials(ids, onUpdate, { get }) {
  let n = 0; let stopped = false; const final = ['pronto', 'fallito', 'non_supportato'];
  const tick = async () => {
    if (stopped) return;
    const ms = []; for (const id of ids) { try { ms.push((await get(`/materials/${id}`)).material); } catch { /* eliminato */ } }
    const ready = ms.filter((m) => m.status === 'pronto').length; const notRead = ms.filter((m) => m.status === 'non_supportato').length; const failed = ms.filter((m) => m.status === 'fallito').length; const wait = ms.length - ready - notRead - failed;
    onUpdate({ total: ms.length, ready, notRead, failed, wait, items: ms });
    if (wait > 0 && ++n < 160) setTimeout(tick, 1500); // le immagini lette dal modello vista possono richiedere fino a qualche minuto
  };
  tick(); return () => { stopped = true; };
}
export const summaryText = (r) => {
  const parts = [];
  if (r.ready) parts.push(`${r.ready} ${r.ready === 1 ? 'pronto' : 'pronti'} da consultare`);
  if (r.wait) parts.push(`${r.wait} in elaborazione`);
  if (r.notRead) parts.push(`${r.notRead} solo ${r.notRead === 1 ? 'conservato' : 'conservati'} (Omar non può leggerli)`);
  if (r.failed) parts.push(`${r.failed} non ${r.failed === 1 ? 'letto' : 'letti'}`);
  return parts.join(' · ');
};
