// Materiali: del corso (caricati dai docenti), del gruppo (condivisi in tempo reale) e personali, organizzati in CARTELLE.
// Se sei collegato a un gruppo puoi INVIARE file o cartelle ai dispositivi dei compagni: il compagno riceve un'offerta e,
// solo se accetta, una copia tra i suoi file personali. La visibilità si sceglie sempre in modo esplicito.
import { h, add, clear, toast, dialog, confirmDialog, fmtDate, fmtSize } from './dom.js';
import { get, post, patch, api, del, auth } from './api.js';
import { linkDialog, shrinkImage } from './attach.js';
import { icon } from './icons.js';

export async function openFile(m) {
  try {
    const res = await fetch(`/api/materials/${m.materialId}/file`, { headers: { authorization: `Bearer ${auth.token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'File non disponibile.');
    const url = URL.createObjectURL(await res.blob());
    if (['pdf', 'immagine'].includes(m.kind)) window.open(url, '_blank', 'noopener'); else { const a = h('a', { href: url, download: m.filename }); document.body.append(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message, 'bad'); }
}
export const statusBadge = (m) => h('span', { class: `badge ${m.status === 'pronto' ? 'ok' : m.status === 'fallito' ? 'bad' : m.status === 'non_supportato' ? 'warn' : ''}`, text: m.statusLabel, title: m.error || '' });
const kindIcon = (m) => (m.sourceUrl ? 'link' : m.kind === 'immagine' ? 'image' : m.kind === 'codice' ? 'code' : 'file');
// compagni collegati nel gruppo attivo (destinatari possibili di un invio)
const peersOf = (S) => (S.overview?.members || []).filter((m) => m.userId !== S.user.id);

export async function uploadDialog(S, { fixed, folder = '', folders = [] } = {}) {
  const file = h('input', { type: 'file', id: 'upf', multiple: true });
  const opts = [['personale', 'Solo io (personale)'], ...(S.active ? [['gruppo', `Gruppo “${S.active.name}”`]] : []), ...(S.isTeacher() ? [['corso', 'Tutto il corso (materiale del docente)']] : [])].filter(([v]) => !fixed || v === fixed);
  const radios = opts.map(([v, l], i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'upv', value: v, checked: i === 0 }), l));
  const subj = h('select', { id: 'ups' }, S.subjects.map((s) => h('option', { value: s.id, text: s.name })));
  const dl = h('datalist', { id: 'upfl' }, folders.map((f) => h('option', { value: f })));
  const fold = h('input', { type: 'text', id: 'upfo', maxLength: 40, placeholder: 'es. Statica, Progetto mulino…', list: 'upfl', value: folder });
  const err = h('div', { class: 'err', hidden: true, role: 'alert' }); const prog = h('p', { class: 'small muted' });
  const body = h('div', null, [h('label', { for: 'upf', text: 'File (anche più di uno)' }), file, h('p', { class: 'small muted', text: S.info?.capabilities?.imageAnalysis ? 'Omar legge PDF (anche scansionati), Word, Excel, PowerPoint, OpenDocument, testi e codice, CAD aperti (DXF, STEP, STL, OBJ, 3MF, FreeCAD), G-code, archivi ZIP e immagini (ne descrive il contenuto e ne trascrive il testo). I formati proprietari (DWG, SolidWorks, Inventor…) vengono solo archiviati.' : 'Omar legge PDF, Word, Excel, PowerPoint, OpenDocument, testi e codice, CAD aperti (DXF, STEP, STL, OBJ, 3MF, FreeCAD), G-code e archivi ZIP. Le immagini sono mostrate ma non lette finché non è installato un modello IA «vista».' }),
    h('label', { for: 'upfo', text: 'Cartella (facoltativa)' }), fold, dl,
    h('p', { class: 'dlg-label', text: 'Chi può vederlo? (scelta obbligatoria)' }), ...radios, S.isTeacher() && [h('label', { for: 'ups', text: 'Materia (per il materiale del corso)' }), subj], prog, err]);
  return dialog('Carica materiali', body, [{ label: 'Annulla', value: null }, { label: 'Carica', primary: true, onClick: async () => {
    err.hidden = true; const files = [...file.files]; if (!files.length) { err.textContent = 'Scegli almeno un file.'; err.hidden = false; return false; }
    const vis = document.querySelector('input[name=upv]:checked').value; let last = null; let ok = 0;
    for (const [i, f] of files.entries()) {
      prog.textContent = `Carico ${i + 1} di ${files.length}: ${f.name}`;
      const fd = new FormData(); fd.append('visibility', vis); if (vis === 'gruppo') fd.append('projectId', S.active.id); if (vis === 'corso') fd.append('subjectId', subj.value);
      if (fold.value.trim()) fd.append('folder', fold.value.trim()); const ff = await shrinkImage(f); fd.append('file', ff, ff.name);
      try { last = (await api('POST', '/materials', fd)).material; ok++; } catch (e) { err.textContent = `${f.name}: ${e.message}`; err.hidden = false; }
    }
    if (ok) toast(ok === 1 ? `${last.name}: ${last.statusLabel}` : `${ok} file caricati.`);
    return ok ? last : false;
  } }]);
}

// finestra "sposta in una cartella"
async function folderDialog(m, folders) {
  const dl = h('datalist', { id: 'mvfl' }, folders.map((f) => h('option', { value: f })));
  const inp = h('input', { type: 'text', id: 'mvf', maxLength: 40, value: m.folder || '', list: 'mvfl', placeholder: 'Nome della cartella' });
  const err = h('div', { class: 'err', hidden: true, role: 'alert' });
  return dialog(`Sposta “${m.name}”`, h('div', null, [h('label', { for: 'mvf', text: 'Cartella' }), inp, dl, h('p', { class: 'small muted', text: 'Lascia vuoto per toglierlo da ogni cartella. Se la cartella non esiste viene creata.' }), err]),
    [{ label: 'Annulla', value: null }, { label: 'Sposta', primary: true, onClick: async () => { try { await patch(`/materials/${m.materialId}`, { folder: inp.value.trim() || null }); toast(inp.value.trim() ? `Spostato in “${inp.value.trim()}”.` : 'Tolto dalla cartella.'); return true; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }]);
}

// finestra "invia a un compagno" (file scelti oppure un'intera cartella)
export async function transferDialog(S, { files = [], folder = null, preselect = [] } = {}) {
  const peers = peersOf(S);
  if (!S.active || !peers.length) { toast('Per inviare file collegati prima con un compagno: Dynamic Island → «Gruppo e dispositivi» → «Collega un dispositivo».', 'bad'); return null; }
  const pr = peers.map((p, i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'xfto', value: p.userId, checked: i === 0 }), h('span', { class: `dot ${p.online ? 'on' : ''}`, 'aria-hidden': true }), `${p.displayName}${p.workstream ? ` · ${p.workstream}` : ''}`, h('span', { class: 'small muted', text: p.online ? ' (online)' : '' })));
  const checks = folder ? null : files.map((m) => h('li', null, h('input', { type: 'checkbox', value: m.materialId, checked: preselect.includes(m.materialId), 'aria-label': m.name }), icon(kindIcon(m), 15), h('span', { class: 'fn', text: m.name }), h('span', { class: 'small muted', text: fmtSize(m.size) })));
  const note = h('input', { type: 'text', id: 'xfn', maxLength: 200, placeholder: 'es. Ecco i calcoli del motore' });
  const err = h('div', { class: 'err', hidden: true, role: 'alert' });
  const body = h('div', null, [
    h('p', { class: 'small muted', text: 'Il compagno riceve un’offerta: vede nomi e dimensioni e decide se accettare. Solo se accetta riceve una COPIA tra i suoi file personali. I tuoi file restano tuoi.' }),
    h('p', { class: 'dlg-label', text: 'A chi?' }), ...pr,
    h('p', { class: 'dlg-label', text: folder ? 'Cosa invii' : 'Quali file?' }),
    folder ? h('p', null, icon('folder', 16), ' L’intera cartella ', h('strong', { text: `“${folder}”` })) : h('ul', { class: 'flist' }, checks),
    h('label', { for: 'xfn', text: 'Messaggio (facoltativo)' }), note, err]);
  return dialog(folder ? 'Invia la cartella a un compagno' : 'Invia file a un compagno', body, [{ label: 'Annulla', value: null }, { label: 'Invia', primary: true, onClick: async () => {
    err.hidden = true;
    const to = document.querySelector('input[name=xfto]:checked')?.value;
    const ids = checks ? checks.map((li) => li.querySelector('input')).filter((c) => c.checked).map((c) => c.value) : [];
    if (!folder && !ids.length) { err.textContent = 'Scegli almeno un file.'; err.hidden = false; return false; }
    try { const r = await post(`/projects/${S.active.id}/transfers`, { toUserId: to, materialIds: ids, folder: folder || undefined, note: note.value || undefined }); toast(`Inviato a ${r.transfer.to.displayName}: ${r.transfer.count} file in attesa di conferma.`); return r.transfer; }
    catch (e) { err.textContent = e.message; err.hidden = false; return false; }
  } }]);
}

export function materialRow(S, m, { reload, folders = [], selectable = null }) {
  const mine = m.uploadedBy.id === S.user.id; const canManage = mine || S.isTeacher() || (m.visibility === 'gruppo' && ['owner', 'teacher'].includes(S.active?.myRole));
  const canMove = (m.visibility === 'personale' && mine) || m.visibility === 'gruppo' || (m.visibility === 'corso' && S.isTeacher());
  const newVer = h('input', { type: 'file', hidden: true });
  newVer.addEventListener('change', async () => {
    const f = newVer.files[0]; if (!f) return; const fd = new FormData(); fd.append('expectedVersion', String(m.version)); fd.append('file', f);
    try { await api('POST', `/materials/${m.materialId}/versions`, fd); toast('Nuova versione caricata.'); reload(); } catch (e) { toast(e.status === 409 ? 'Nel frattempo qualcuno ha caricato una versione più recente: ricarico la lista.' : e.message, 'bad'); reload(); }
  });
  return h('div', { class: 'item row mrow' }, [
    selectable && h('input', { type: 'checkbox', class: 'msel', 'aria-label': `Seleziona ${m.name}`, checked: selectable.has(m.materialId), onchange: (e) => { if (e.target.checked) selectable.add(m.materialId); else selectable.delete(m.materialId); selectable.onChange?.(); } }),
    h('span', { class: 'mico', 'aria-hidden': true }, icon(kindIcon(m), 18)),
    h('div', { class: 'grow' }, h('strong', { text: m.name }), h('div', { class: 'small muted', text: `v${m.version} · ${fmtSize(m.size)} · ${m.uploadedBy.displayName} · ${fmtDate(m.createdAt)}${m.pageCount ? ` · ${m.pageCount} pag.` : ''}` }), h('div', { class: 'small', text: m.capabilityLabel })),
    h('span', { class: `badge ${m.visibility === 'personale' ? '' : 'ok'}`, text: m.visibility === 'personale' ? 'personale' : m.visibility === 'gruppo' ? 'gruppo' : 'corso' }), statusBadge(m), m.injectionFlags > 0 && h('span', { class: 'badge warn', title: 'Il documento contiene frasi che sembrano istruzioni: sono state neutralizzate.', text: `${m.injectionFlags} frasi neutralizzate` }),
    m.sourceUrl && /^https?:\/\//i.test(m.sourceUrl) && h('a', { class: 'btn sm', href: m.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Pagina originale ↗' }),
    canManage && ['fallito', 'non_supportato'].includes(m.status) && !m.sourceUrl && h('button', { class: 'btn sm', type: 'button', title: 'Fai rileggere il file a Omar (ad esempio dopo aver installato il modello «vista»)', onclick: async (e) => { e.currentTarget.disabled = true; try { await post(`/materials/${m.materialId}/reprocess`); toast(`Omar sta rileggendo “${m.name}”.`); reload(); } catch (ex) { toast(ex.message, 'bad'); reload(); } } }, icon('replay', 15), 'Rileggi'),
    h('button', { class: 'btn sm', type: 'button', text: m.sourceUrl ? 'Testo letto' : m.kind === 'pdf' || m.kind === 'immagine' ? 'Apri' : 'Scarica', onclick: () => openFile(m) }),
    canMove && h('button', { class: 'btn sm', type: 'button', title: 'Sposta in una cartella', 'aria-label': `Sposta ${m.name} in una cartella`, onclick: async () => { if (await folderDialog(m, folders)) reload(); } }, icon('folder', 15)),
    m.visibility === 'personale' && mine && S.active && peersOf(S).length > 0 && h('button', { class: 'btn sm', type: 'button', title: 'Invia a un compagno', 'aria-label': `Invia ${m.name} a un compagno`, onclick: () => transferDialog(S, { files: [m], preselect: [m.materialId] }) }, icon('send', 15)),
    canManage && [h('button', { class: 'btn sm', type: 'button', text: 'Nuova versione', onclick: () => newVer.click() }), newVer,
      h('button', { class: 'btn sm danger', type: 'button', text: 'Elimina', onclick: async () => { if (!(await confirmDialog('Eliminare il materiale?', `“${m.name}” non sarà più disponibile${m.visibility === 'gruppo' ? ' per il gruppo' : ''}.`, { ok: 'Elimina', danger: true }))) return; try { await del(`/materials/${m.materialId}`); toast('Eliminato.'); reload(); } catch (e) { toast(e.message, 'bad'); } } })]]);
}

// ── invii in arrivo e in uscita ──
function drawTransfers(box, S, list, reload) {
  clear(box);
  const inc = list.filter((x) => x.direction === 'in' && x.status === 'pending');
  const out = list.filter((x) => x.direction === 'out' && x.status === 'pending');
  const past = list.filter((x) => x.status !== 'pending').slice(0, 20);
  if (!inc.length && !out.length && !past.length) { box.hidden = true; return; }
  box.hidden = false;
  const items = (x) => h('ul', { class: 'xf-items' }, x.items.slice(0, 6).map((i) => h('li', null, icon('file', 13), h('span', { text: i.name }), h('span', { class: 'small muted', text: fmtSize(i.size || 0) }))), x.items.length > 6 && h('li', { class: 'small muted', text: `…e altri ${x.items.length - 6}` }));
  add(box, [
    inc.length > 0 && h('div', { class: 'xf-in' }, [h('h2', { class: 'xf-h' }, icon('inbox', 18), `In arrivo (${inc.length})`),
      inc.map((x) => h('div', { class: 'xf-card' }, [
        h('div', { class: 'xf-top' }, h('span', { class: 'xf-ic', 'aria-hidden': true }, icon(x.folder ? 'folder' : 'file', 18)), h('div', { class: 'grow' },
          h('strong', { text: `${x.from.displayName} ti invia ${x.folder ? `la cartella “${x.folder}”` : x.count === 1 ? '1 file' : `${x.count} file`}` }),
          h('div', { class: 'small muted', text: `${fmtSize(x.totalSize)} · gruppo “${x.projectName}” · ${fmtDate(x.createdAt)} · scade ${fmtDate(x.expiresAt)}` }))),
        x.note && h('p', { class: 'xf-note', text: `“${x.note}”` }), items(x),
        x.blocked ? h('p', { class: 'small muted', text: 'Non siete più collegati nello stesso gruppo: non si può accettare.' }) : h('div', { class: 'row' }, [
          h('button', { class: 'btn sm primary', type: 'button', onclick: async (e) => { e.target.disabled = true; try { const r = await post(`/transfers/${x.id}/accept`); toast(`Ricevuti ${r.copied.length} file nei tuoi materiali personali${r.missing.length ? ` (${r.missing.length} non più disponibili)` : ''}.`); reload(); } catch (ex) { toast(ex.message, 'bad'); e.target.disabled = false; } } }, icon('download', 15), 'Accetta e salva'),
          h('button', { class: 'btn sm', type: 'button', text: 'Rifiuta', onclick: async () => { try { await post(`/transfers/${x.id}/decline`); toast('Invio rifiutato.'); reload(); } catch (ex) { toast(ex.message, 'bad'); } } })]),
      ]))]),
    out.length > 0 && h('div', { class: 'xf-out' }, [h('h2', { class: 'xf-h' }, icon('send', 17), `Inviati, in attesa (${out.length})`),
      out.map((x) => h('div', { class: 'item row' }, h('div', { class: 'grow' }, h('strong', { text: `A ${x.to.displayName}: ${x.folder ? `cartella “${x.folder}”` : `${x.count} file`}` }), h('div', { class: 'small muted', text: `${fmtDate(x.createdAt)} · in attesa che accetti` })),
        h('button', { class: 'btn sm', type: 'button', text: 'Annulla', onclick: async () => { try { await post(`/transfers/${x.id}/cancel`); reload(); } catch (ex) { toast(ex.message, 'bad'); } } })))]),
    past.length > 0 && h('details', { class: 'xf-hist' }, h('summary', { text: `Storico invii (${past.length})` }), past.map((x) => h('div', { class: 'small xf-past' },
      h('span', { class: `badge ${x.status === 'accepted' ? 'ok' : ''}`, text: x.statusLabel }), ` ${x.direction === 'in' ? `da ${x.from.displayName}` : `a ${x.to.displayName}`} · ${x.folder ? `cartella “${x.folder}”` : `${x.count} file`} · ${fmtDate(x.respondedAt || x.createdAt)}`))),
  ]);
}

export async function renderMaterials(main, S, [tab]) {
  const scopes = [['corso', 'Materiali del corso'], ...(S.active ? [['gruppo', `Gruppo: ${S.active.name}`]] : []), ['personale', 'I miei file']];
  let cur = scopes.some(([k]) => k === tab) ? tab : scopes[0][0];
  const box = h('div'); const tabs = h('nav', { class: 'tabs', 'aria-label': 'Tipo di materiale' });
  const xfBox = h('section', { class: 'xf', hidden: true, 'aria-label': 'File inviati e ricevuti' });
  const open = new Set(); let q = '';
  let hasPending = false;
  const loadTransfers = async () => { try { const r = await get('/transfers'); drawTransfers(xfBox, S, r.transfers, () => { loadTransfers(); draw(); }); } catch { xfBox.hidden = true; } };
  async function draw() {
    clear(tabs); for (const [k, l] of scopes) tabs.append(h('a', { href: `#/materiali/${k}`, text: l, 'aria-current': k === cur ? 'page' : null }));
    clear(box);
    const qs = cur === 'gruppo' ? `?scope=gruppo&projectId=${S.active.id}` : `?scope=${cur}`;
    let list; try { list = (await get('/materials' + qs)).materials; } catch (e) { box.append(h('div', { class: 'err', text: e.message })); return; }
    hasPending = list.some((m) => !['pronto', 'fallito', 'non_supportato'].includes(m.status));
    const folders = [...new Set(list.map((m) => m.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const shown = q ? list.filter((m) => `${m.name} ${m.folder || ''}`.toLowerCase().includes(q)) : list;
    const sel = new Set(); const canSend = cur === 'personale' && S.active && peersOf(S).length > 0;
    const sendSel = h('button', { class: 'btn sm', type: 'button', hidden: true, onclick: () => transferDialog(S, { files: list, preselect: [...sel] }) }, icon('send', 15), 'Invia i selezionati');
    sel.onChange = () => { sendSel.hidden = !sel.size; sendSel.lastChild.textContent = `Invia i selezionati (${sel.size})`; };
    const search = h('input', { type: 'search', class: 'msearch', placeholder: 'Cerca nei materiali…', 'aria-label': 'Cerca nei materiali', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); clearTimeout(search.t); search.t = setTimeout(draw, 200); } });
    const rows = (ms) => ms.map((m) => materialRow(S, m, { reload: draw, folders, selectable: canSend && m.uploadedBy.id === S.user.id ? sel : null }));
    const groupsBy = new Map(); for (const m of shown) { const k = m.folder || ''; if (!groupsBy.has(k)) groupsBy.set(k, []); groupsBy.get(k).push(m); }
    const folderEls = [...groupsBy.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'it')).map((f) => {
      const ms = groupsBy.get(f);
      const d = h('details', { class: 'mfold', open: open.has(f) || !!q, ontoggle: (e) => { if (e.target.open) open.add(f); else open.delete(f); } });
      add(d, [h('summary', { class: 'mf-head' }, [icon('folder', 18), h('strong', { text: f }), h('span', { class: 'small muted', text: `${ms.length} file` }), h('span', { class: 'sp' }),
        canSend && h('button', { class: 'btn sm', type: 'button', title: 'Invia la cartella a un compagno', onclick: (e) => { e.preventDefault(); transferDialog(S, { folder: f }); } }, icon('send', 14), 'Invia la cartella'),
        cur !== 'corso' || S.isTeacher() ? h('button', { class: 'btn sm ghost', type: 'button', title: 'Rinomina la cartella', 'aria-label': `Rinomina la cartella ${f}`, onclick: async (e) => {
          e.preventDefault(); const inp = h('input', { type: 'text', maxLength: 40, value: f, 'aria-label': 'Nuovo nome' });
          const r = await dialog('Rinomina la cartella', h('div', null, [inp, h('p', { class: 'small muted', text: 'Lascia vuoto per sciogliere la cartella (i file restano, fuori da cartelle).' })]), [{ label: 'Annulla', value: null }, { label: 'Salva', primary: true, value: 'ok' }]);
          if (r !== 'ok') return; try { await post('/materials-folders/rename', { scope: cur, projectId: cur === 'gruppo' ? S.active.id : undefined, from: f, to: inp.value.trim() || null }); toast(inp.value.trim() ? 'Cartella rinominata.' : 'Cartella sciolta.'); draw(); } catch (ex) { toast(ex.message, 'bad'); }
        } }, icon('edit', 14)) : null]),
      h('div', { class: 'mf-body' }, rows(ms))]);
      return d;
    });
    const loose = groupsBy.get('') || [];
    add(box, [h('div', { class: 'row mtools' }, [
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await uploadDialog(S, { fixed: cur === 'corso' && !S.isTeacher() ? 'personale' : cur, folders }); if (r) draw(); } }, icon('upload', 16), 'Carica file'),
        cur !== 'corso' && h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await linkDialog(S, { groupId: cur === 'gruppo' ? S.active?.id : null, fixed: cur }); if (r) draw(); } }, icon('link', 16), 'Importa un link'),
        canSend && h('button', { class: 'btn', type: 'button', onclick: () => transferDialog(S, { files: list.filter((m) => m.uploadedBy.id === S.user.id) }) }, icon('send', 16), 'Invia a un compagno'), sendSel,
        h('span', { class: 'sp' }), search]),
      cur === 'personale' && !canSend && h('p', { class: 'small muted xf-hint' }, icon('device', 14), S.active ? ' Nessun compagno collegato nel gruppo: quando qualcuno entra potrai inviargli file e cartelle.' : ' Collegati a un compagno (Dynamic Island → «Gruppo e dispositivi») per inviargli file e intere cartelle.'),
      cur === 'gruppo' && h('p', { class: 'small muted', text: 'I file condivisi compaiono sui dispositivi dei compagni appena sono disponibili.' }), cur === 'corso' && !S.isTeacher() && h('p', { class: 'small muted', text: 'Qui trovi i materiali caricati dai docenti.' }),
      h('div', { class: 'mlist' }, shown.length ? [folderEls, rows(loose)] : h('p', { class: 'muted', text: q ? 'Nessun materiale corrisponde alla ricerca.' : 'Nessun materiale in questa sezione.' }))]);
  }
  add(main, h('div', { class: 'page' }, [h('h1', { text: 'Materiali' }), xfBox, tabs, box]));
  await Promise.all([draw(), loadTransfers()]);
  const off = S.on((ev) => {
    if (/^material\./.test(ev.type) || ev.type === 'self.project' || ev.type === 'resync' || /^member\.(joined|left|revoked)/.test(ev.type)) draw();
    if (ev.type === 'notify' && ev.event?.type === 'transfer.updated') { loadTransfers(); if (ev.event.status === 'accepted') draw(); }
  });
  const poll = setInterval(() => { if (!document.hidden && hasPending) draw(); }, 8000);
  return () => { off(); clearInterval(poll); };
}
