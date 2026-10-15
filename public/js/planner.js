// Planner (#/planner): registro delle scadenze (progetti di gruppo, verifiche, consegne di laboratorio, compiti)
// e suggeritore di studio: tempo che resta e priorità di oggi, calcolati dalle stime e dall'avanzamento che inserisci.
import { h, add, clear, toast, dialog, confirmDialog } from './dom.js';
import { get, post, patch, put, del } from './api.js';
import { icon } from './icons.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const KIND_IC = { progetto: 'board', verifica: 'check', interrogazione: 'mic', laboratorio: 'tool', compito: 'edit', altro: 'flag' };
const ST = { scaduta: ['late', 'Scaduta'], oggi: ['late', 'Entro oggi'], vicina: ['soon', 'Vicina'], impegnativa: ['soon', 'Impegnativa'], in_tempo: ['ok', 'In tempo'] };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}′` : ''}` : `${m} min`);
const dayLabel = (iso) => new Date(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const toLocal = (iso) => { const d = iso ? new Date(iso) : new Date(Date.now() + 3 * 864e5); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export async function renderPlanner(main, S) {
  const page = h('div', { class: 'page pl' }); main.append(page);
  let data = null; let view = 'lista';
  const today = h('section', { class: 'pl-today acc-card', 'aria-labelledby': 'pl-oggi' });
  const listBox = h('section', { class: 'pl-list' });
  const groupBox = h('section', { class: 'pl-group' });
  add(page, [h('div', { class: 'hub-top' }, [h('div', null, h('h1', { text: 'Planner' }), h('p', { class: 'muted small', text: 'Scadenze, verifiche e consegne: ti dico quanto tempo resta e cosa conviene fare oggi.' })),
    h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', onclick: () => prefsDialog() }, icon('clock', 16), 'Tempo di studio'), h('button', { class: 'btn primary', type: 'button', onclick: () => deadlineDialog() }, icon('plus', 16), 'Nuova scadenza')])]),
  h('div', { class: 'pl-grid' }, [today, h('div', null, [listBox, groupBox])])]);

  async function deadlineDialog(d = null) {
    const title = h('input', { type: 'text', id: 'dl-t', maxLength: 120, value: d?.title || '', placeholder: 'es. Verifica sulle trasmissioni' });
    const kind = h('select', { id: 'dl-k' }, Object.entries(data.kinds).map(([k, l]) => h('option', { value: k, text: l, selected: (d?.kind || 'verifica') === k })));
    const when = h('input', { type: 'datetime-local', id: 'dl-w', value: toLocal(d?.dueAt) });
    const est = h('input', { type: 'number', id: 'dl-e', min: 0.25, max: 200, step: 0.25, value: d?.estimateHours ?? 2 });
    const subj = h('select', { id: 'dl-s' }, [h('option', { value: '', text: '— nessuna —' }), ...S.subjects.map((s) => h('option', { value: s.id, text: s.name, selected: d?.subjectId === s.id }))]);
    const scopes = [['personale', 'Solo per me'], ...(S.active ? [['gruppo', `Per tutto il gruppo “${S.active.name}”`]] : []), ...(S.isTeacher() ? [['corso', 'Per tutto il corso (docente)']] : [])];
    const scope = h('select', { id: 'dl-sc', disabled: !!d }, scopes.map(([v, l]) => h('option', { value: v, text: l, selected: (d?.scope || 'personale') === v })));
    const notes = h('textarea', { id: 'dl-n', rows: 2, maxLength: 600, placeholder: 'Argomenti, pagine, materiale da portare…' }); notes.value = d?.notes || '';
    const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const r = await dialog(d ? 'Modifica scadenza' : 'Nuova scadenza', h('div', null, [h('label', { for: 'dl-t', text: 'Cosa' }), title,
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'dl-k', text: 'Tipo' }), kind), h('div', { class: 'grow' }, h('label', { for: 'dl-w', text: 'Quando' }), when)]),
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'dl-e', text: 'Ore di lavoro stimate' }), est), h('div', { class: 'grow' }, h('label', { for: 'dl-s', text: 'Materia' }), subj)]),
      h('label', { for: 'dl-sc', text: 'Per chi' }), scope, h('label', { for: 'dl-n', text: 'Note' }), notes,
      h('p', { class: 'small muted', text: 'La stima serve al suggeritore: quante ore in tutto ti servono per prepararti o completare la consegna.' }), err]), [
      ...(d?.canEdit ? [{ label: 'Elimina', danger: true, onClick: async () => { if (!(await confirmDialog('Eliminare la scadenza?', `“${d.title}”${d.scope === 'gruppo' ? ' sparirà per tutto il gruppo' : ''}.`, { ok: 'Elimina', danger: true }))) return false; try { await del(`/planner/deadlines/${d.id}`); return 'x'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }] : []),
      { label: 'Annulla', value: null },
      { label: 'Salva', primary: true, onClick: async () => {
        const b = { title: title.value, kind: kind.value, dueAt: when.value ? new Date(when.value).toISOString() : null, estimateHours: Number(est.value), subjectId: subj.value || null, notes: notes.value };
        try { if (d) await patch(`/planner/deadlines/${d.id}`, b); else await post('/planner/deadlines', { ...b, scope: scope.value, projectId: scope.value === 'gruppo' ? S.active.id : undefined }); return 'ok'; }
        catch (e) { err.textContent = e.message; err.hidden = false; return false; }
      } }]);
    if (r) load();
  }
  async function prefsDialog() {
    const mins = h('input', { type: 'range', id: 'pf-m', min: 15, max: 360, step: 15, value: data.prefs.dailyMinutes });
    const out = h('output', { for: 'pf-m', text: fmtMin(data.prefs.dailyMinutes) }); mins.addEventListener('input', () => { out.textContent = fmtMin(+mins.value); });
    const days = DAYS.map((l, i) => h('label', { class: 'pf-day' }, h('input', { type: 'checkbox', value: i, checked: data.prefs.studyDays.includes(i) }), l));
    const r = await dialog('Il tuo tempo di studio', h('div', null, [h('label', { for: 'pf-m' }, 'Quanto tempo puoi studiare in un giorno: ', out), mins, h('p', { class: 'dlg-label', text: 'In quali giorni studi' }), h('div', { class: 'pf-days' }, days)]),
      [{ label: 'Annulla', value: null }, { label: 'Salva', primary: true, onClick: async () => { try { await put('/planner/prefs', { dailyMinutes: +mins.value, studyDays: days.map((d) => d.querySelector('input')).filter((c) => c.checked).map((c) => +c.value) }); return 'ok'; } catch (e) { toast(e.message, 'bad'); return false; } } }]);
    if (r) load();
  }
  const setProgress = async (d, b) => { try { await put(`/planner/deadlines/${d.id}/progress`, b); load(); } catch (e) { toast(e.message, 'bad'); } };

  function drawToday() {
    clear(today);
    const pct = data.prefs.dailyMinutes ? Math.min(100, Math.round((data.todayMinutes / data.prefs.dailyMinutes) * 100)) : 0;
    add(today, [h('div', { class: 'pl-th' }, [h('div', { class: 'pl-ring', style: `--p:${pct}`, 'aria-hidden': true }, h('span', { text: fmtMin(data.todayMinutes) })), h('div', null, h('h2', { id: 'pl-oggi', text: 'Il piano di oggi' }), h('p', { class: 'small muted', text: new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) + ` · ${fmtMin(data.prefs.dailyMinutes)} disponibili` }))]),
      data.today.length ? h('ol', { class: 'pl-steps' }, data.today.map((t, i) => h('li', null, h('span', { class: 'pl-n', text: String(i + 1) }), h('div', { class: 'grow' }, h('strong', { text: t.title }), h('div', { class: 'small muted', text: `${t.kindLabel} · ${t.why}` })), h('span', { class: 'pl-min', text: fmtMin(t.minutes) }))))
        : h('p', { class: 'muted', text: data.items.length ? 'Per oggi niente: sei in pari.' : 'Aggiungi una scadenza e ti preparo il piano.' }),
      data.warnings.map((w) => h('p', { class: 'notice warn', role: 'note', text: w })),
      h('p', { class: 'small muted', text: data.note })]);
  }
  function row(d) {
    const it = data.items.find((x) => x.id === d.id); const [cls, lab] = d.done ? ['ok', 'Completata'] : ST[it?.status] || ['', ''];
    const prog = h('input', { type: 'range', min: 0, max: 100, step: 10, value: d.progress, 'aria-label': `Avanzamento di ${d.title}`, onchange: (e) => setProgress(d, { progress: +e.target.value }) });
    return h('div', { class: `pl-row${d.done ? ' done' : ''}` }, [
      h('span', { class: `pl-ic k-${d.kind}`, 'aria-hidden': true }, icon(KIND_IC[d.kind] || 'flag', 17)),
      h('div', { class: 'grow' }, [h('div', { class: 'pl-title' }, h('strong', { text: d.title }), lab && h('span', { class: `pl-st ${cls}`, text: lab }), d.scope !== 'personale' && h('span', { class: 'badge', text: d.scope === 'gruppo' ? `gruppo ${d.projectName || ''}` : 'corso' })),
        h('div', { class: 'small muted', text: `${d.kindLabel}${d.subjectName ? ` · ${d.subjectName}` : ''} · ${dayLabel(d.dueAt)}${it ? ` · ${it.daysLeft} g · restano ~${fmtMin(it.remainingMinutes)}` : ''}${d.scope !== 'personale' ? ` · da ${d.owner.displayName}` : ''}` }),
        h('div', { class: 'pl-prog' }, [prog, h('span', { class: 'small', text: `${d.progress}%` })])]),
      h('div', { class: 'pl-acts' }, [h('button', { class: `btn sm${d.done ? '' : ' primary'}`, type: 'button', onclick: () => setProgress(d, { done: !d.done }) }, icon(d.done ? 'replay' : 'check', 14), d.done ? 'Riapri' : 'Fatto'),
        d.canEdit && h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Modifica ${d.title}`, onclick: () => deadlineDialog(d) }, icon('edit', 14))]),
    ]);
  }
  function drawList() {
    clear(listBox);
    const up = data.deadlines.filter((d) => !d.done); const done = data.deadlines.filter((d) => d.done);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' }, [['lista', 'Lista', 'list'], ['calendario', '14 giorni', 'calendar']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(view === v), onclick: () => { view = v; drawList(); } }, icon(ic, 15), l)));
    add(listBox, [h('div', { class: 'pl-lh' }, h('h2', { text: 'Scadenze' }), seg)]);
    if (view === 'calendario') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const cal = h('div', { class: 'pl-cal' });
      for (let i = 0; i < 14; i++) {
        const d0 = new Date(start.getTime() + i * 864e5); const d1 = new Date(d0.getTime() + 864e5);
        const evs = up.filter((d) => { const t = new Date(d.dueAt); return t >= d0 && t < d1; });
        cal.append(h('div', { class: `pl-day${i === 0 ? ' today' : ''}${[0, 6].includes(d0.getDay()) ? ' we' : ''}` }, h('span', { class: 'pl-dn', text: `${DAYS[d0.getDay()]} ${d0.getDate()}` }), evs.map((d) => h('button', { class: `pl-ev k-${d.kind}`, type: 'button', title: d.title, onclick: () => (d.canEdit ? deadlineDialog(d) : null) }, icon(KIND_IC[d.kind], 12), d.title))));
      }
      listBox.append(cal);
    } else {
      listBox.append(up.length ? h('div', { class: 'pl-rows' }, up.map(row)) : h('div', { class: 'empty-state small' }, icon('calendar', 26), h('p', { class: 'muted', text: 'Nessuna scadenza in arrivo.' })));
      if (done.length) listBox.append(h('details', { class: 'xf-hist' }, h('summary', { text: `Completate (${done.length})` }), h('div', { class: 'pl-rows' }, done.slice(0, 30).map(row))));
    }
  }
  async function drawGroup() {
    clear(groupBox); if (!S.active) return;
    let g; try { g = await get(`/projects/${S.active.id}/planner`); } catch { return; }
    if (!g.deadlines.length) return;
    add(groupBox, [h('h2', null, icon('users', 18), ` Il gruppo “${S.active.name}”`), h('p', { class: 'small muted', text: g.note }),
      g.deadlines.map((d) => h('div', { class: 'acc-card pl-gcard' }, [h('strong', { text: d.title }), h('span', { class: 'small muted', text: ` · ${dayLabel(d.dueAt)}` }),
        h('div', { class: 'pl-members' }, d.members.map((m) => h('div', { class: 'pl-mem' }, h('span', { class: 'hub-av', text: m.displayName.slice(0, 1).toUpperCase() }), h('div', { class: 'grow' }, h('div', { class: 'small', text: `${m.displayName}${m.workstream ? ` · ${m.workstream}` : ''}` }), h('div', { class: 'pl-bar' }, h('i', { style: `width:${m.progress}%` }))), h('span', { class: 'small muted', text: m.done ? 'fatto' : `${m.progress}% · ~${fmtMin(m.perDayMinutes)}/g` }))))]))]);
  }
  async function load() {
    try { data = await get('/planner'); } catch (e) { clear(listBox); listBox.append(h('p', { class: 'err', text: e.message })); return; }
    drawToday(); drawList(); drawGroup();
  }
  await load();
  return S.on((ev) => { if (/^deadline\./.test(ev.type) || (ev.type === 'notify' && ev.event?.type === 'planner.updated') || ev.type === 'self.project') load(); });
}
