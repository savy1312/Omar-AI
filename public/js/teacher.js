// Area docente: obiettivi didattici, materiali del corso, prova del tutor. Permessi separati: il docente NON legge le chat personali degli studenti.
import { h, add, clear, toast, dialog, confirmDialog, fmtDate } from './dom.js';
import { get, post, put, del } from './api.js';
import { uploadDialog, materialRow } from './materials.js';

export async function renderTeacher(main, S) {
  if (!S.isTeacher()) { add(main, h('div', { class: 'err', text: 'Quest’area è riservata ai docenti.' })); return; }
  const ov = await get('/teacher/overview');
  const objBox = h('div'); const matBox = h('div');
  let subj = S.subjects[0].id;
  const subjSel = h('select', { id: 'tsub', onchange: (e) => { subj = e.target.value; drawTopics(); drawObj(); drawMat(); } }, S.subjects.map((s) => h('option', { value: s.id, text: s.name })));
  const topicSel = h('select', { id: 'ttop' }); const text = h('input', { type: 'text', id: 'tobj', maxLength: 400, placeholder: 'es. Lo studente sa calcolare il momento di una forza rispetto a un punto' });
  const drawTopics = () => { clear(topicSel); add(topicSel, [h('option', { value: '', text: 'Tutta la materia' }), S.subjects.find((s) => s.id === subj).topics.map((t) => h('option', { value: t.id, text: t.name }))]); };
  async function drawObj() {
    const { objectives } = await get(`/teacher/objectives?subjectId=${subj}`); clear(objBox);
    add(objBox, objectives.length ? objectives.map((o) => h('div', { class: 'item row' }, h('div', { class: 'grow' }, o.text, h('div', { class: 'small muted', text: o.topicId ? S.subjects.find((s) => s.id === subj).topics.find((t) => t.id === o.topicId)?.name : 'Tutta la materia' })),
      h('button', { class: 'btn sm', type: 'button', text: 'Modifica', onclick: async () => { const t = h('input', { type: 'text', value: o.text, maxLength: 400, 'aria-label': 'Obiettivo' }); if (await dialog('Modifica obiettivo', t, [{ label: 'Annulla', value: false }, { label: 'Salva', value: true, primary: true }])) { try { await put(`/teacher/objectives/${o.id}`, { text: t.value }); drawObj(); } catch (e) { toast(e.message, 'bad'); } } } }),
      h('button', { class: 'btn sm danger', type: 'button', text: 'Elimina', onclick: async () => { await del(`/teacher/objectives/${o.id}`); drawObj(); } }))) : h('p', { class: 'muted', text: 'Nessun obiettivo per questa materia: il tutor userà quelli generali.' }));
  }
  async function drawMat() { const { materials } = await get(`/teacher/materials?subjectId=${subj}`); clear(matBox); add(matBox, materials.length ? materials.map((m) => materialRow(S, m, { reload: drawMat })) : h('p', { class: 'muted', text: 'Nessun materiale del corso per questa materia.' })); }
  drawTopics();
  add(main, h('div', { class: 'page' }, [h('h1', { text: 'Area docente' }),
    h('div', { class: 'card' }, [h('p', { text: ov.note }), h('p', { class: 'small' }, `Materiali del corso: ${ov.materialiCorso} · Obiettivi: ${ov.obiettivi} · Utenti: ${ov.utenti.map((u) => `${u.n} ${u.role}`).join(', ')}`)]),
    h('div', { class: 'row', style: 'margin:1rem 0' }, [h('div', { class: 'grow' }, h('label', { for: 'tsub', text: 'Materia' }), subjSel),
      h('button', { class: 'btn', type: 'button', text: 'Prova il tutor (non salva dati degli studenti)', onclick: async () => { try { const s = await post('/sessions', { subjectId: subj, mode: 'esercizio', level: 'base', sandbox: true }); location.hash = `#/chat/${s.session.id}`; } catch (e) { toast(e.message, 'bad'); } } })]),
    h('h2', { text: 'Obiettivi didattici' }), h('p', { class: 'small muted', text: 'Gli obiettivi vengono passati al tutor per orientare le domande guida.' }),
    h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'ttop', text: 'Argomento' }), topicSel), h('div', { class: 'grow' }, h('label', { for: 'tobj', text: 'Nuovo obiettivo' }), text),
      h('button', { class: 'btn primary', type: 'button', text: 'Aggiungi', onclick: async () => { try { await post('/teacher/objectives', { subjectId: subj, topicId: topicSel.value || undefined, text: text.value }); text.value = ''; drawObj(); } catch (e) { toast(e.message, 'bad'); } } })]),
    objBox,
    h('h2', { text: 'Materiali del corso', style: 'margin-top:1.5rem' }), h('p', { class: 'small muted', text: 'Gli studenti li vedono e il tutor li cita con la fonte. Se un documento contiene frasi che sembrano istruzioni per l’IA, vengono neutralizzate e segnalate qui.' }),
    h('button', { class: 'btn primary', type: 'button', text: 'Carica un materiale del corso', onclick: async () => { if (await uploadDialog(S, { fixed: 'corso' })) drawMat(); } }), h('div', { style: 'margin-top:1rem' }, matBox),
    h('h2', { text: 'Valutazione del tutor', style: 'margin-top:1.5rem' }), h('p', { class: 'small', text: 'La qualità didattica delle risposte non si misura con i test automatici: usa la griglia di revisione in docs/VALUTAZIONE_DIDATTICA.md con i casi di prova guidati.' }),
  ]));
  await Promise.all([drawObj(), drawMat()]);
}
