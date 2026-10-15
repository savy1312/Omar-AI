// Hub di progetto (#/projects): Kanban delle attività (con proposte dell'IA dai contenuti condivisi), Asset Manager
// (file del gruppo, codice, formule, schemi, note, link), relazione tecnica in PDF e attività recenti del gruppo.
import { h, add, clear, toast, dialog, confirmDialog, fmtDate, fmtSize, renderMarkdown } from './dom.js';
import { get, post, patch, del, getBlob } from './api.js';
import { icon } from './icons.js';
import { openFile, statusBadge } from './materials.js';

const TABS = [['kanban', 'Attività', 'board'], ['asset', 'Asset', 'code'], ['relazione', 'Relazione PDF', 'report'], ['feed', 'Attività recenti', 'bell']];
const KIND_IC = { codice: 'code', formula: 'calc', schema: 'move', nota: 'list', link: 'link' };
const due = (iso) => { if (!iso) return null; const d = Math.ceil((new Date(iso) - Date.now()) / 864e5); return { text: d < 0 ? `scaduta da ${-d} g` : d === 0 ? 'scade oggi' : d === 1 ? 'domani' : `tra ${d} giorni`, late: d < 0, soon: d >= 0 && d <= 2 }; };
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export async function renderProjects(main, S, [tab]) {
  const page = h('div', { class: 'page hub' }); main.append(page);
  if (!S.active) {
    add(page, [h('h1', { text: 'Hub di progetto' }), h('div', { class: 'empty-state' }, [icon('board', 34), h('h2', { text: 'Collegati a un gruppo per usare l’Hub' }),
      h('p', { class: 'muted', text: 'Qui il gruppo organizza il progetto: attività su una bacheca Kanban (l’IA propone i compiti leggendo SOLO ciò che avete scelto di condividere), asset comuni come codice, formule e schemi, e la relazione tecnica in PDF.' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => S.openGroupPanel?.() }, icon('users', 16), 'Collega un dispositivo')])]);
    return;
  }
  let cur = TABS.some(([k]) => k === tab) ? tab : 'kanban';
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Sezioni dell’Hub' }); const body = h('div', { class: 'hub-body' });
  add(page, [h('div', { class: 'hub-top' }, [h('div', null, h('h1', { text: S.active.name }), h('p', { class: 'muted small', text: `Hub di progetto · ${S.overview?.participantCount || 1} partecipanti${S.overview ? ` · ${S.overview.onlineCount} online` : ''}` })),
    h('div', { class: 'hub-avatars', 'aria-label': 'Partecipanti' }, (S.overview?.members || []).slice(0, 6).map((m) => h('span', { class: `hub-av${m.online ? ' on' : ''}`, title: `${m.displayName}${m.workstream ? ` · ${m.workstream}` : ''}`, text: m.displayName.slice(0, 1).toUpperCase() })))]), tabs, body]);
  const drawTabs = () => { clear(tabs); for (const [k, l, ic] of TABS) tabs.append(h('a', { href: `#/projects/${k}`, 'aria-current': k === cur ? 'page' : null }, icon(ic, 15), l)); };
  drawTabs();
  let off = null;
  const views = { kanban: viewKanban, asset: viewAssets, relazione: viewReport, feed: viewFeed };
  off = await views[cur](body, S);
  return () => { off?.(); };
}

// ───────── Kanban ─────────
async function viewKanban(body, S) {
  const pid = S.active.id; let data = null; let busy = false;
  const board = h('div', { class: 'kb', role: 'list' });
  const info = h('p', { class: 'small muted' });
  const propose = h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (busy) return; busy = true; propose.disabled = true; propose.lastChild.textContent = 'Leggo i contenuti condivisi…';
    try { const r = await post(`/projects/${pid}/tasks/propose`, { useAI: true }); toast(r.created ? `${r.created} nuove proposte${r.usedAI ? ' (dal modello IA)' : ''}: controllale nella prima colonna.` : r.note, r.created ? '' : ''); await load(); }
    catch (e) { toast(e.message, 'bad'); } finally { busy = false; propose.disabled = false; propose.lastChild.textContent = 'Proponi attività dalle chat condivise'; }
  } }, icon('wand', 16), h('span', { text: 'Proponi attività dalle chat condivise' }));
  add(body, [h('div', { class: 'row hub-tools' }, [h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog() }, icon('plus', 16), 'Nuova attività'), propose, h('span', { class: 'sp' }), info]), board]);

  const members = () => data?.members || [];
  async function taskDialog(t = null, status = 'da_fare') {
    const title = h('input', { type: 'text', id: 'tk-t', maxLength: 140, value: t?.title || '', placeholder: 'es. Verificare la coppia del motoriduttore' });
    const desc = h('textarea', { id: 'tk-d', rows: 3, maxLength: 1500, placeholder: 'Dettagli, dati, link…' }); desc.value = t?.description || '';
    const who = h('select', { id: 'tk-a' }, [h('option', { value: '', text: '— nessuno —' }), ...members().map((m) => h('option', { value: m.id, text: `${m.displayName}${m.workstream ? ` (${m.workstream})` : ''}`, selected: t?.assignee?.id === m.id }))]);
    const date = h('input', { type: 'date', id: 'tk-due', value: toLocalInput(t?.dueAt) });
    const st = h('select', { id: 'tk-s' }, data.columns.filter((c) => c.id !== 'proposta' || t?.status === 'proposta').map((c) => h('option', { value: c.id, text: c.label, selected: (t?.status || status) === c.id })));
    const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const r = await dialog(t ? 'Modifica attività' : 'Nuova attività', h('div', null, [h('label', { for: 'tk-t', text: 'Titolo' }), title, h('label', { for: 'tk-d', text: 'Descrizione' }), desc,
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'tk-a', text: 'Incaricato' }), who), h('div', null, h('label', { for: 'tk-due', text: 'Entro il' }), date), h('div', null, h('label', { for: 'tk-s', text: 'Stato' }), st)]),
      t?.reason && h('p', { class: 'small muted', text: t.reason }), err]), [
      ...(t ? [{ label: 'Elimina', danger: true, onClick: async () => { if (!(await confirmDialog('Eliminare l’attività?', `“${t.title}” sparirà per tutto il gruppo.`, { ok: 'Elimina', danger: true }))) return false; try { await del(`/projects/${pid}/tasks/${t.id}`); return 'deleted'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }] : []),
      { label: 'Annulla', value: null },
      { label: t ? 'Salva' : 'Aggiungi', primary: true, onClick: async () => {
        const b = { title: title.value, description: desc.value, assigneeId: who.value || null, dueAt: date.value ? new Date(`${date.value}T18:00:00`).toISOString() : null, status: st.value };
        try { if (t) await patch(`/projects/${pid}/tasks/${t.id}`, { ...b, expectedVersion: t.version }); else await post(`/projects/${pid}/tasks`, b); return 'ok'; }
        catch (e) { err.textContent = e.status === 409 ? 'Un compagno ha appena modificato questa attività: chiudi e riapri per vedere la versione aggiornata.' : e.message; err.hidden = false; return false; }
      } }]);
    if (r) load();
  }
  async function move(t, status) {
    try { await patch(`/projects/${pid}/tasks/${t.id}`, { status, expectedVersion: t.version }); } catch (e) { toast(e.status === 409 ? 'Un compagno l’ha appena spostata: aggiorno la bacheca.' : e.message, 'bad'); }
    load();
  }
  function card(t) {
    const d = due(t.dueAt); const prop = t.status === 'proposta';
    const el = h('article', { class: `kb-card${prop ? ' prop' : ''}`, draggable: 'true', tabindex: '0', 'aria-label': t.title, dataset: { id: t.id } }, [
      h('div', { class: 'kb-t', text: t.title }),
      t.description && h('div', { class: 'kb-d', text: t.description.length > 140 ? `${t.description.slice(0, 140)}…` : t.description }),
      h('div', { class: 'kb-meta' }, [t.assignee ? h('span', { class: 'kb-who', title: `Incaricato: ${t.assignee.displayName}` }, h('i', { text: t.assignee.displayName.slice(0, 1).toUpperCase() }), t.assignee.displayName) : h('span', { class: 'kb-who none', text: 'nessun incaricato' }),
        d && h('span', { class: `kb-due${d.late ? ' late' : d.soon ? ' soon' : ''}` }, icon('calendar', 12), d.text), t.origin !== 'manuale' && h('span', { class: 'kb-ai', title: t.originLabel }, icon('wand', 12), 'IA')]),
      prop ? h('div', { class: 'kb-prop' }, [h('button', { class: 'btn sm primary', type: 'button', onclick: (e) => { e.stopPropagation(); move(t, 'da_fare'); } }, icon('check', 14), 'Accetta'),
        h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { e.stopPropagation(); try { await del(`/projects/${pid}/tasks/${t.id}`); load(); } catch (ex) { toast(ex.message, 'bad'); } } }, 'Scarta')])
        : h('select', { class: 'kb-move', 'aria-label': `Sposta “${t.title}” in`, onclick: (e) => e.stopPropagation(), onchange: (e) => move(t, e.target.value) }, data.columns.filter((c) => c.id !== 'proposta').map((c) => h('option', { value: c.id, text: c.label, selected: c.id === t.status }))),
    ]);
    el.addEventListener('click', () => taskDialog(t));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) taskDialog(t); });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/omar-task', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('drag'); });
    el.addEventListener('dragend', () => el.classList.remove('drag'));
    return el;
  }
  function draw() {
    clear(board);
    const done = data.tasks.filter((t) => t.status === 'fatto').length; const real = data.tasks.filter((t) => t.status !== 'proposta').length;
    info.textContent = real ? `${done} di ${real} completate` : '';
    for (const c of data.columns) {
      const list = data.tasks.filter((t) => t.status === c.id);
      if (c.id === 'proposta' && !list.length) continue;
      const col = h('section', { class: `kb-col kb-${c.id}`, role: 'listitem', 'aria-label': c.label }, [
        h('header', { class: 'kb-h' }, h('strong', { text: c.label }), h('span', { class: 'kb-n', text: String(list.length) }), c.id !== 'proposta' && h('button', { class: 'kb-add', type: 'button', title: `Aggiungi in “${c.label}”`, 'aria-label': `Aggiungi un’attività in ${c.label}`, onclick: () => taskDialog(null, c.id) }, icon('plus', 15))),
        c.hint && h('p', { class: 'kb-hint', text: c.hint }),
        h('div', { class: 'kb-cards' }, list.length ? list.map(card) : h('p', { class: 'kb-empty', text: c.id === 'da_fare' ? 'Niente da fare… per ora.' : 'Trascina qui un’attività' }))]);
      if (c.id !== 'proposta') {
        col.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/omar-task')) { e.preventDefault(); col.classList.add('over'); } });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
        col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/omar-task'); const t = data.tasks.find((x) => x.id === id); if (t && t.status !== c.id) move(t, c.id); });
      }
      board.append(col);
    }
  }
  async function load() { try { data = await get(`/projects/${pid}/tasks`); draw(); } catch (e) { clear(board); board.append(h('p', { class: 'err', text: e.message })); } }
  await load();
  return S.on((ev) => { if (/^task\./.test(ev.type) || /^member\./.test(ev.type)) load(); });
}

// ───────── Asset Manager ─────────
async function viewAssets(body, S) {
  const pid = S.active.id; let data = null; let filter = 'tutti'; let q = '';
  const grid = h('div', { class: 'as-grid' }); const chips = h('div', { class: 'hx-chips', role: 'group', 'aria-label': 'Tipo di asset' });
  const search = h('input', { type: 'search', class: 'msearch', placeholder: 'Cerca negli asset…', 'aria-label': 'Cerca negli asset', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
  add(body, [h('div', { class: 'row hub-tools' }, [h('button', { class: 'btn primary', type: 'button', onclick: () => snippetDialog() }, icon('plus', 16), 'Nuovo asset'),
    h('button', { class: 'btn', type: 'button', onclick: async () => { try { const r = await post(`/projects/${pid}/assets/harvest`); toast(r.note); load(); } catch (e) { toast(e.message, 'bad'); } } }, icon('wand', 16), 'Raccogli dai contributi condivisi'),
    h('a', { class: 'btn', href: '#/materiali/gruppo' }, icon('upload', 16), 'Carica file del gruppo'), h('span', { class: 'sp' }), search]), chips, grid]);

  async function snippetDialog(s = null) {
    const kind = h('select', { id: 'sn-k', disabled: !!s }, Object.entries(data.kinds).map(([k, l]) => h('option', { value: k, text: l, selected: (s?.kind || 'codice') === k })));
    const lang = h('select', { id: 'sn-l' }, data.languages.map((l) => h('option', { value: l, text: l, selected: (s?.language || 'javascript') === l })));
    const title = h('input', { type: 'text', id: 'sn-t', maxLength: 120, value: s?.title || '', placeholder: 'es. Lettura dell’encoder' });
    const content = h('textarea', { id: 'sn-c', rows: 9, class: 'mono', maxLength: 20000, spellcheck: false, placeholder: 'Incolla qui il codice, la formula (LaTeX), lo schema in testo, la nota o il link…' }); content.value = s?.content || '';
    const langWrap = h('div', null, h('label', { for: 'sn-l', text: 'Linguaggio' }), lang);
    const sync = () => { langWrap.hidden = kind.value !== 'codice'; }; kind.addEventListener('change', sync); sync();
    const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const r = await dialog(s ? 'Modifica asset' : 'Nuovo asset del gruppo', h('div', null, [h('div', { class: 'row' }, [h('div', null, h('label', { for: 'sn-k', text: 'Tipo' }), kind), langWrap]), h('label', { for: 'sn-t', text: 'Titolo' }), title, h('label', { for: 'sn-c', text: 'Contenuto' }), content, h('p', { class: 'small muted', text: 'Il codice viene solo salvato e mostrato, mai eseguito dal server. Per provarlo usa i Quick Tools.' }), err]), [
      ...(s && s.mine ? [{ label: 'Elimina', danger: true, onClick: async () => { if (!(await confirmDialog('Eliminare l’asset?', `“${s.title}” sparirà per tutto il gruppo.`, { ok: 'Elimina', danger: true }))) return false; try { await del(`/projects/${pid}/snippets/${s.id}`); return 'x'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }] : []),
      { label: 'Annulla', value: null },
      { label: 'Salva', primary: true, onClick: async () => { try { if (s) await patch(`/projects/${pid}/snippets/${s.id}`, { title: title.value, content: content.value, language: lang.value, expectedVersion: s.version }); else await post(`/projects/${pid}/snippets`, { kind: kind.value, title: title.value, content: content.value, language: lang.value }); return 'ok'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }]);
    if (r) load();
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copiato negli appunti.'); } catch { toast('Impossibile copiare.', 'bad'); } };
  function snipCard(s) {
    const prev = s.kind === 'formula' ? renderMarkdown(`$$${s.content}$$`) : s.kind === 'link' ? h('a', { href: /^https?:\/\//i.test(s.content) ? s.content : '#', target: '_blank', rel: 'noopener noreferrer', class: 'as-link', text: s.content.replace(/^https?:\/\//, '').slice(0, 80) }) : s.kind === 'nota' ? h('p', { class: 'as-note', text: s.content.slice(0, 400) }) : h('pre', { class: 'as-code' }, h('code', { text: s.content.split('\n').slice(0, 12).join('\n') }));
    return h('article', { class: `as-card k-${s.kind}` }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic', 'aria-hidden': true }, icon(KIND_IC[s.kind], 15)), h('strong', { text: s.title }), s.language && h('span', { class: 'badge', text: s.language })]), prev,
      h('footer', { class: 'as-f' }, [h('span', { class: 'small muted', text: `${s.author.displayName}${s.source?.kind === 'contributo' ? ' · da un contributo condiviso' : ''} · ${fmtDate(s.updatedAt)}` }), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm ghost', type: 'button', title: 'Copia', 'aria-label': `Copia ${s.title}`, onclick: () => copy(s.content) }, icon('copy', 14)),
        s.kind === 'codice' && h('button', { class: 'btn sm ghost', type: 'button', title: 'Apri nei Quick Tools', 'aria-label': `Prova ${s.title} nei Quick Tools`, onclick: () => S.tools?.open('code', { code: s.content, language: s.language }) }, icon('play', 14)),
        (s.mine || ['owner', 'teacher'].includes(S.active?.myRole)) && h('button', { class: 'btn sm ghost', type: 'button', title: 'Modifica', 'aria-label': `Modifica ${s.title}`, onclick: () => snippetDialog(s) }, icon('edit', 14))])]);
  }
  const fileCard = (m) => h('article', { class: 'as-card k-file' }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic', 'aria-hidden': true }, icon(m.kind === 'pdf' ? 'report' : m.kind === 'immagine' ? 'image' : 'file', 15)), h('strong', { text: m.name }), statusBadge(m)]),
    h('p', { class: 'small muted', text: `${m.capabilityLabel} · v${m.version} · ${fmtSize(m.size)}${m.folder ? ` · cartella ${m.folder}` : ''}` }),
    h('footer', { class: 'as-f' }, [h('span', { class: 'small muted', text: `${m.uploadedBy.displayName} · ${fmtDate(m.createdAt)}` }), h('span', { class: 'sp' }), h('button', { class: 'btn sm', type: 'button', text: m.kind === 'pdf' || m.kind === 'immagine' ? 'Apri' : 'Scarica', onclick: () => openFile(m) })])]);
  function draw() {
    clear(chips); clear(grid);
    const all = [...data.files.map((f) => ({ type: 'file', f, k: f.kind === 'pdf' ? 'pdf' : 'file', at: f.createdAt, text: `${f.name} ${f.folder || ''}` })), ...data.snippets.map((s) => ({ type: 'snip', s, k: s.kind, at: s.updatedAt, text: `${s.title} ${s.content}` }))].sort((a, b) => b.at.localeCompare(a.at));
    const kinds = [['tutti', 'Tutti'], ['file', 'File'], ['pdf', 'PDF'], ['codice', 'Codice'], ['formula', 'Formule'], ['schema', 'Schemi'], ['nota', 'Note'], ['link', 'Link']].filter(([k]) => k === 'tutti' || all.some((a) => a.k === k));
    for (const [k, l] of kinds) chips.append(h('button', { type: 'button', class: 'hx-chip', 'aria-pressed': String(filter === k), text: `${l}${k === 'tutti' ? '' : ` (${all.filter((a) => a.k === k).length})`}`, onclick: () => { filter = k; draw(); } }));
    const shown = all.filter((a) => (filter === 'tutti' || a.k === filter) && (!q || a.text.toLowerCase().includes(q)));
    if (!shown.length) { grid.append(h('div', { class: 'empty-state small' }, icon('code', 26), h('p', { class: 'muted', text: all.length ? 'Nessun asset corrisponde.' : 'Ancora nessun asset. Aggiungine uno, carica un file del gruppo o raccoglili dai contributi condivisi in chat.' }))); return; }
    for (const a of shown) grid.append(a.type === 'file' ? fileCard(a.f) : snipCard(a.s));
  }
  async function load() { try { data = await get(`/projects/${pid}/assets`); draw(); } catch (e) { clear(grid); grid.append(h('p', { class: 'err', text: e.message })); } }
  await load();
  return S.on((ev) => { if (/^(snippet|material)\./.test(ev.type)) load(); });
}

// ───────── Relazione tecnica PDF ─────────
async function viewReport(body, S) {
  const pid = S.active.id;
  const SECT = [['gruppo', 'Gruppo di lavoro e obiettivi'], ['decisioni', 'Decisioni'], ['parametri', 'Parametri e dimensioni'], ['scatola_nera', 'Verifiche di compatibilità (Scatola Nera)'], ['attivita', 'Attività e scadenze'], ['asset', 'Materiali e asset'], ['diario', 'Diario di bordo']];
  const boxes = SECT.map(([k, l]) => h('label', { class: 'radio' }, h('input', { type: 'checkbox', value: k, checked: true }), l));
  const frame = h('div', { class: 'rp-prev' }, h('p', { class: 'muted small', text: 'L’anteprima comparirà qui.' }));
  let lastUrl = null;
  const gen = async (download) => {
    const sections = boxes.map((b) => b.querySelector('input')).filter((c) => c.checked).map((c) => c.value);
    if (!sections.length) { toast('Scegli almeno una sezione.', 'bad'); return; }
    try {
      const { blob, filename } = await getBlob(`/projects/${pid}/report.pdf?sections=${sections.join(',')}`);
      if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = URL.createObjectURL(blob);
      if (download) { const a = h('a', { href: lastUrl, download: filename }); document.body.append(a); a.click(); a.remove(); toast('Relazione scaricata.'); }
      else { clear(frame); frame.append(h('div', { class: 'rp-ready' }, icon('report', 30), h('div', null, h('strong', { text: filename }), h('p', { class: 'small muted', text: `${(blob.size / 1024).toFixed(0)} KB · pronta` })), h('a', { class: 'btn primary', href: lastUrl, target: '_blank', rel: 'noopener' }, icon('eye', 15), 'Apri l’anteprima'))); }
    } catch (e) { toast(e.message, 'bad'); }
  };
  add(body, h('div', { class: 'rp' }, [h('div', { class: 'acc-card' }, [h('h2', null, icon('report', 19), 'Relazione tecnica del progetto'),
    h('p', { class: 'muted', text: 'Omar AI impagina in un PDF tutto ciò che il gruppo ha inserito e condiviso: partecipanti, decisioni, parametri, avvisi della Scatola Nera, attività, asset e diario. Le proposte restano segnate come proposte: niente viene inventato.' }),
    h('p', { class: 'dlg-label', text: 'Sezioni da includere' }), ...boxes,
    h('div', { class: 'row', style: 'margin-top:1rem' }, [h('button', { class: 'btn primary', type: 'button', onclick: () => gen(false) }, icon('eye', 16), 'Genera l’anteprima'), h('button', { class: 'btn', type: 'button', onclick: () => gen(true) }, icon('download', 16), 'Scarica il PDF')]),
    h('p', { class: 'small muted', text: 'La relazione è un punto di partenza: rileggila e completala con il docente prima della consegna.' })]), frame]));
  return () => { if (lastUrl) URL.revokeObjectURL(lastUrl); };
}

// ───────── feed delle attività del gruppo (in tempo reale) ─────────
async function viewFeed(body, S) {
  const list = h('ol', { class: 'feed', 'aria-live': 'polite' });
  add(body, [h('p', { class: 'muted small', text: 'Cosa succede nel gruppo: file sincronizzati, contributi condivisi dalle chat, attività spostate, decisioni. Si aggiorna da solo.' }), list]);
  const item = (x, fresh = false) => h('li', { class: `feed-i${fresh ? ' fresh' : ''}${x.mine ? ' mine' : ''}` }, h('span', { class: 'feed-ic', 'aria-hidden': true }, icon(x.icon, 15)), h('span', { class: 'feed-t', text: x.text }), h('time', { class: 'small muted', dateTime: x.at, text: fmtDate(x.at) }));
  async function load() { try { const r = await get(`/feed?projectId=${S.active.id}&limit=60`); clear(list); if (!r.items.length) list.append(h('li', { class: 'muted', text: 'Ancora nessuna attività nel gruppo.' })); for (const x of r.items) list.append(item(x)); } catch (e) { clear(list); list.append(h('li', { class: 'err', text: e.message })); } }
  await load();
  let t = 0;
  return S.on((ev) => { if (ev.seq && ev.projectId === S.active?.id) { clearTimeout(t); t = setTimeout(load, 250); } });
}
