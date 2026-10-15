// Cronologia delle chat con una nuova estetica: raggruppata per giorno (Oggi, Ieri, Ultimi 7 giorni, …), ricerca,
// filtro per materia (colori), anteprima dell'ultima risposta, rinomina ed eliminazione. Usata sia nella pagina #/cronologia
// sia (in versione compatta) nel pannello della Dynamic Island.
import { h, add, clear, toast, confirmDialog, dialog } from './dom.js';
import { get, patch, api } from './api.js';
import { icon } from './icons.js';
import { SUBJECT_COLOR } from './chat.js';

const MODE_IC = { spiega: 'sparkle', esercizio: 'edit', verifica: 'check', ripasso: 'replay' };
function bucket(iso) {
  const d = new Date(iso); const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (diff <= 0) return 'Oggi'; if (diff === 1) return 'Ieri'; if (diff < 7) return 'Ultimi 7 giorni'; if (diff < 30) return 'Ultimi 30 giorni';
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase());
}
const timeOf = (iso) => { const d = new Date(iso); const b = bucket(iso); return b === 'Oggi' || b === 'Ieri' ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };

export function mountHistory(host, { S, compact = false, onOpen, currentId = null } = {}) {
  let sessions = []; let q = ''; let subj = '';
  const listEl = h('div', { class: 'hx-list', role: 'list' });
  const chips = h('div', { class: 'hx-chips', role: 'group', 'aria-label': 'Filtra per materia' });
  const search = h('input', { type: 'search', class: 'hx-search', placeholder: 'Cerca nelle chat…', 'aria-label': 'Cerca nelle chat', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
  add(host, h('div', { class: `hx${compact ? ' compact' : ''}` }, [h('div', { class: 'hx-bar' }, [h('span', { class: 'hx-sic', 'aria-hidden': true }, icon('search', 16)), search]), chips, listEl]));

  async function rename(x) {
    const inp = h('input', { type: 'text', maxLength: 80, value: x.title || '', 'aria-label': 'Titolo della chat' });
    const r = await dialog('Rinomina la chat', inp, [{ label: 'Annulla', value: null }, { label: 'Salva', primary: true, value: 'ok' }]);
    if (r !== 'ok' || !inp.value.trim()) return;
    try { await patch(`/sessions/${x.id}`, { title: inp.value.trim() }); x.title = inp.value.trim(); draw(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove(x) {
    if (!(await confirmDialog('Eliminare la conversazione?', `“${x.title || 'Nuova conversazione'}” verrà cancellata per sempre dal server.`, { ok: 'Elimina', danger: true }))) return;
    try { await api('DELETE', `/sessions/${x.id}`); sessions = sessions.filter((s) => s !== x); draw(); if (location.hash.includes(x.id)) location.hash = '#/home'; toast('Conversazione eliminata.'); } catch (e) { toast(e.message, 'bad'); }
  }
  function card(x) {
    const col = SUBJECT_COLOR[x.subjectId] || SUBJECT_COLOR.generale;
    return h('div', { class: `hx-item${x.id === currentId ? ' cur' : ''}`, role: 'listitem', style: `--sc:${col}` }, [
      h('a', { class: 'hx-main', href: `#/chat/${x.id}`, onclick: () => onOpen?.(x) }, [
        h('span', { class: 'hx-ic', 'aria-hidden': true }, icon(MODE_IC[x.mode] || 'edit', compact ? 15 : 17)),
        h('span', { class: 'hx-txt' }, [h('span', { class: 'hx-title', text: x.title || 'Nuova conversazione' }),
          !compact && x.preview && h('span', { class: 'hx-prev', text: x.preview }),
          h('span', { class: 'hx-meta' }, [h('span', { class: 'hx-subj', text: x.subjectId === 'generale' ? 'Generale' : x.subjectName || '' }), x.topicName && !compact ? ` · ${x.topicName}` : '', ` · ${timeOf(x.updatedAt)}`, x.messageCount ? ` · ${Math.ceil(x.messageCount / 2)} scambi` : '', x.projectId ? ' · gruppo' : ''])]),
      ]),
      h('div', { class: 'hx-acts' }, [
        h('button', { class: 'hx-btn', type: 'button', title: 'Rinomina', 'aria-label': `Rinomina ${x.title || 'la conversazione'}`, onclick: () => rename(x) }, icon('edit', 14)),
        h('button', { class: 'hx-btn', type: 'button', title: 'Elimina', 'aria-label': `Elimina ${x.title || 'la conversazione'}`, onclick: () => remove(x) }, icon('trash', 14))]),
    ]);
  }
  function draw() {
    clear(chips); clear(listEl);
    const present = [...new Set(sessions.map((s) => s.subjectId))];
    if (present.length > 1) {
      chips.append(h('button', { type: 'button', class: 'hx-chip', 'aria-pressed': String(!subj), text: 'Tutte', onclick: () => { subj = ''; draw(); } }));
      for (const id of present) { const name = id === 'generale' ? 'Generale' : sessions.find((s) => s.subjectId === id)?.subjectName || id; chips.append(h('button', { type: 'button', class: 'hx-chip', style: `--sc:${SUBJECT_COLOR[id] || SUBJECT_COLOR.generale}`, 'aria-pressed': String(subj === id), onclick: () => { subj = subj === id ? '' : id; draw(); } }, h('i', { 'aria-hidden': true }), name)); }
    }
    const shown = sessions.filter((s) => (!subj || s.subjectId === subj) && (!q || `${s.title || ''} ${s.preview || ''} ${s.subjectName || ''} ${s.topicName || ''}`.toLowerCase().includes(q)));
    if (!sessions.length) { listEl.append(h('div', { class: 'hx-empty' }, icon('history', 28), h('p', { text: 'Le tue conversazioni compariranno qui.' }), h('a', { class: 'btn sm', href: '#/home', text: 'Inizia una chat' }))); return; }
    if (!shown.length) { listEl.append(h('p', { class: 'muted hx-none', text: 'Nessuna chat corrisponde alla ricerca.' })); return; }
    let last = null;
    for (const x of shown) { const b = bucket(x.updatedAt); if (b !== last) { listEl.append(h('div', { class: 'hx-group', role: 'presentation', text: b })); last = b; } listEl.append(card(x)); }
  }
  const load = async () => { try { sessions = (await get('/sessions')).sessions; draw(); } catch (e) { clear(listEl); listEl.append(h('p', { class: 'err', text: e.message })); } };
  listEl.append(h('div', { class: 'hx-skel', 'aria-label': 'Carico' }, [h('i'), h('i'), h('i')]));
  load();
  return { reload: load, focus: () => search.focus() };
}

export async function renderHistory(main, S) {
  const host = h('div');
  add(main, h('div', { class: 'page hx-page' }, [h('div', { class: 'hx-top' }, h('h1', { text: 'Cronologia' }), h('a', { class: 'btn primary', href: '#/home' }, icon('edit', 16), 'Nuova chat')),
    h('p', { class: 'muted', text: `Le tue conversazioni sono personali: il docente non le legge. Le chat più vecchie di ${S.info?.limits?.retentionChatDays || 180} giorni vengono cancellate in automatico.` }), host]));
  mountHistory(host, { S });
}
