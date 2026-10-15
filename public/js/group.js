// Gruppo: panoramica, contributi, diario di bordo (Eco di Gruppo), decisioni, parametri, Scatola Nera (avvisi + ricalcolo guidato), briefing.
import { h, add, clear, toast, dialog, confirmDialog, renderMarkdown, fmtDate } from './dom.js';
import { get, post, patch, put, del, ApiError } from './api.js';
import { inviteDialog } from './app.js';

const QUANT = [['lunghezza', 'Lunghezza'], ['forza', 'Forza'], ['coppia', 'Coppia'], ['potenza', 'Potenza'], ['tensione_elettrica', 'Tensione elettrica'], ['corrente', 'Corrente'], ['pressione', 'Pressione'], ['tensione_meccanica', 'Tensione meccanica'], ['velocita_angolare', 'Velocità angolare'], ['massa', 'Massa'], ['angolo', 'Angolo'], ['tempo', 'Tempo'], ['frequenza', 'Frequenza']];
const TABS = [['panoramica', 'Panoramica'], ['briefing', 'Briefing'], ['avvisi', 'Scatola Nera'], ['diario', 'Diario (Eco di Gruppo)'], ['decisioni', 'Decisioni'], ['parametri', 'Parametri'], ['contributi', 'Contributi condivisi']];
const err = (e) => toast(e instanceof ApiError ? e.message : 'Errore imprevisto.', 'bad');
const field = (id, label, el) => h('div', null, h('label', { for: id, text: label }), el);
const formDialog = (title, fields, submitLabel, onSubmit) => {
  const errBox = h('div', { class: 'err', hidden: true, role: 'alert' });
  return dialog(title, h('div', null, [...fields, errBox]), [{ label: 'Annulla', value: false }, { label: submitLabel, primary: true, onClick: async () => { try { await onSubmit(); return true; } catch (e) { errBox.textContent = e.message; errBox.hidden = false; return false; } } }]);
};
const provTag = (it) => (it.provisional ? h('span', { class: 'badge warn', text: 'provvisorio' }) : h('span', { class: 'badge ok', text: 'confermato' }));

export async function renderGroup(main, S, [tab]) {
  if (!S.active) {
    add(main, h('div', { class: 'page' }, [h('h1', { text: 'Gruppo' }), h('div', { class: 'card' }, [h('p', { text: 'Non sei collegato a nessun gruppo. Con un gruppo puoi lavorare a un progetto insieme ai compagni: le chat restano personali e condividi solo ciò che scegli.' }), h('p', { class: 'muted', text: 'Apri la Dynamic Island in alto e tocca l’icona Gruppo → “Collega un dispositivo”: inserisci il codice che ti ha dato il compagno oppure crea tu una sessione di gruppo.' })])]));
    return;
  }
  const pid = S.active.id; const P = (s = '') => `/projects/${pid}${s}`;
  const cur = TABS.some(([k]) => k === tab) ? tab : 'panoramica';
  const body = h('div');
  add(main, h('div', { class: 'page' }, [h('h1', { text: `Gruppo: ${S.active.name}` }), h('nav', { class: 'tabs', 'aria-label': 'Sezioni del gruppo' }, TABS.map(([k, l]) => h('a', { href: `#/gruppo/${k}`, text: l, 'aria-current': k === cur ? 'page' : null }))), body]));
  const views = { panoramica, briefing, avvisi, diario, decisioni, parametri, contributi };
  const draw = async () => { try { await views[cur](); } catch (e) { clear(body); body.append(h('div', { class: 'err', text: e.message })); } };
  await draw();
  let t = null; const off = S.on((ev) => { if (ev.type === 'presence') return; clearTimeout(t); t = setTimeout(draw, 250); });
  return () => { off(); clearTimeout(t); };

  // ───────── panoramica ─────────
  async function panoramica() {
    await S.refreshOverview(); const ov = S.overview; const manager = ['owner', 'teacher'].includes(S.active.myRole);
    const [{ requests }, invites] = await Promise.all([get(P('/share-requests')), manager ? get(P('/invites')) : { invites: [] }]);
    const ws = h('input', { type: 'text', id: 'myws', maxLength: 60, value: S.active.myWorkstream || '', placeholder: 'es. motore' });
    const consent = h('input', { type: 'checkbox', id: 'as', checked: !!S.active.autoShare });
    clear(body); add(body, [
      h('div', { class: 'grid' }, [
        h('div', { class: 'card' }, [h('h2', { text: 'Partecipanti' }), h('ul', null, ov.members.map((m) => h('li', null, h('span', { class: `dot ${m.online ? 'on' : ''}`, 'aria-hidden': true }), ' ', h('strong', { text: m.displayName }), ` — ${m.workstream || 'area non indicata'} `, h('span', { class: 'small muted', text: `(${m.role === 'owner' ? 'creatore' : m.role === 'teacher' ? 'docente' : 'partecipante'}, ${m.online ? 'online' : 'offline'})` })))),
          manager && ov.pending.length > 0 && [h('h3', { text: 'Richieste di ingresso' }), ov.pending.map((m) => h('div', { class: 'row item' }, h('strong', { class: 'grow', text: m.displayName }), h('button', { class: 'btn sm primary', type: 'button', text: 'Approva', onclick: async () => { try { await post(P(`/members/${m.userId}/approve`)); draw(); } catch (e) { err(e); } } }), h('button', { class: 'btn sm', type: 'button', text: 'Rifiuta', onclick: async () => { try { await post(P(`/members/${m.userId}/reject`)); draw(); } catch (e) { err(e); } } })))]]),
        h('div', { class: 'card' }, [h('h2', { text: 'Di cosa mi occupo' }), field('myws', 'Area di lavoro', ws), h('button', { class: 'btn sm', type: 'button', style: 'margin-top:.6rem', text: 'Salva', onclick: async () => { try { await patch(P('/me'), { workstream: ws.value }); S.active.myWorkstream = ws.value; toast('Salvato.'); } catch (e) { err(e); } } }),
          h('h3', { text: 'Condivisione automatica', style: 'margin-top:1rem' }), h('p', { class: 'small muted', text: 'Se la attivi, i tuoi messaggi che contengono dati o componenti del progetto vengono condivisi col gruppo senza chiederti ogni volta (senza email e telefoni). Puoi escludere un messaggio o ritirare un contributo quando vuoi. È disattivata finché non la attivi tu.' }),
          h('label', { style: 'font-weight:400;display:flex;gap:.5rem;align-items:center' }, consent, 'Acconsento alla condivisione automatica dei dati di progetto'),
          h('button', { class: 'btn sm', type: 'button', style: 'margin-top:.5rem', text: 'Applica', onclick: async () => { try { await put(P('/auto-share'), { enabled: consent.checked, consent: consent.checked ? true : undefined }); S.active.autoShare = consent.checked; toast(consent.checked ? 'Condivisione automatica attiva.' : 'Condivisione automatica disattivata.'); } catch (e) { err(e); } } })]),
        h('div', { class: 'card' }, [h('h2', { text: 'Richieste di condivisione' }), requests.length ? requests.map((r) => h('div', { class: 'item' }, h('strong', { text: r.from.displayName }), ' ti chiede di condividere un contributo.', r.note && h('p', { class: 'small', text: `“${r.note}”` }),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', text: 'Va bene, lo farò', onclick: async () => { try { const x = await post(P(`/share-requests/${r.id}/respond`), { accept: true }); toast(x.note || 'Fatto.'); draw(); } catch (e) { err(e); } } }), h('button', { class: 'btn sm', type: 'button', text: 'No, grazie', onclick: async () => { try { await post(P(`/share-requests/${r.id}/respond`), { accept: false }); draw(); } catch (e) { err(e); } } })))) : h('p', { class: 'muted', text: 'Nessuna richiesta.' }), h('p', { class: 'small muted', text: 'Accettare non condivide nulla da solo: scegli tu cosa condividere dalla tua chat.' })]),
      ]),
      manager && h('div', { class: 'card', style: 'margin-top:1rem' }, [h('h2', { text: 'Inviti' }), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Genera / rigenera il codice', onclick: () => inviteDialog() }),
        h('label', { style: 'font-weight:400;display:flex;gap:.5rem;align-items:center;margin:0' }, h('input', { type: 'checkbox', checked: !!ov.project.requiresApproval, onchange: async (e) => { try { await patch(P(), { requiresApproval: e.target.checked }); toast('Impostazione aggiornata.'); } catch (x) { err(x); } } }), 'Chi entra deve essere approvato')),
        h('table', { style: 'margin-top:.7rem' }, h('thead', null, h('tr', null, ['Creato', 'Scade', 'Usi', 'Stato', ''].map((x) => h('th', { text: x })))), h('tbody', null, invites.invites.map((i) => h('tr', null, h('td', { text: fmtDate(i.createdAt) }), h('td', { text: fmtDate(i.expiresAt) }), h('td', { text: `${i.uses}/${i.maxUses}` }), h('td', null, h('span', { class: `badge ${i.active ? 'ok' : ''}`, text: i.revoked ? 'annullato' : i.active ? 'attivo' : 'scaduto/esaurito' })),
          h('td', null, i.active && h('button', { class: 'btn sm danger', type: 'button', text: 'Annulla', onclick: async () => { try { await del(P(`/invites/${i.id}`)); draw(); } catch (e) { err(e); } } })))))), h('p', { class: 'small muted', text: 'Il codice completo si vede una sola volta alla creazione: sul server resta soltanto un’impronta non reversibile.' })]),
    ]);
  }

  // ───────── briefing ─────────
  async function briefing() {
    const b = await get(P('/briefing'));
    clear(body); add(body, [h('p', { class: 'muted', text: 'Riepilogo costruito dai dati condivisi e dalle decisioni del gruppo — mai dalle chat personali. Le voci provvisorie sono da verificare.' }),
      b.previousAccess && h('p', { class: 'small muted', text: `Ultimo briefing letto: ${fmtDate(b.previousAccess)}` }),
      b.sections.map((s) => h('section', { class: 'card', style: 'margin-bottom:.8rem' }, [h('h2', { text: s.title }), s.items.length ? s.items.map((i) => h('div', { class: `item ${i.provisional ? 'prov' : ''}` }, [h('div', { text: i.text }), h('div', { class: 'small muted' }, `${i.source?.author ? 'fonte: ' + i.source.author : ''}${i.source?.confirmedBy ? ' · confermata da ' + i.source.confirmedBy : ''}${i.source?.at ? ' · ' + i.source.at : ''} `, i.provisional ? h('span', { class: 'badge warn', text: 'provvisorio' }) : null)])) : h('p', { class: 'muted', text: s.empty || 'Niente da segnalare.' }), s.note && h('p', { class: 'small muted', text: s.note })]))]);
  }

  // ───────── contributi ─────────
  async function contributi() {
    const { contributions } = await get(P('/contributions'));
    clear(body); add(body, [h('p', { class: 'muted', text: 'Solo ciò che i compagni hanno scelto di condividere. Ogni contributo ha un autore e una versione.' }),
      contributions.length ? contributions.map((c) => h('div', { class: 'item' }, [h('div', { class: 'row' }, h('strong', { text: c.author.displayName }), c.workstream && h('span', { class: 'badge', text: c.workstream }), h('span', { class: 'badge', text: c.kind }), c.auto && h('span', { class: 'badge', text: 'condivisione automatica' }), h('span', { class: 'small muted', text: `v${c.version} · ${fmtDate(c.createdAt)}` }), h('span', { class: 'grow' }),
        c.mine && h('button', { class: 'btn sm danger', type: 'button', text: 'Ritira', onclick: async () => { if (!(await confirmDialog('Ritirare il contributo?', 'Non sarà più usato dal tutor né mostrato ai compagni (le voci del diario derivate saranno oscurate).', { ok: 'Ritira', danger: true }))) return; try { await post(P(`/contributions/${c.id}/retract`)); draw(); } catch (e) { err(e); } } })), h('div', { style: 'white-space:pre-wrap', text: c.content })])) : h('p', { text: 'Nessun contributo condiviso, per ora.' })]);
  }

  // ───────── diario ─────────
  async function diario() {
    const r = await get(P('/journal'));
    const typeSel = h('select', { id: 'jt' }, Object.entries(r.types).map(([k, l]) => h('option', { value: k, text: l }))); const title = h('input', { type: 'text', id: 'jti', maxLength: 140 }); const text = h('textarea', { id: 'jb', rows: 2, maxLength: 800 });
    clear(body); add(body, [h('p', { class: 'muted', text: 'Il diario raccoglie ipotesi, scelte, problemi e modifiche. Ogni voce dice chi l’ha scritta e come è nata. Le voci estratte automaticamente restano “da verificare” finché un compagno non le conferma.' }),
      h('details', { class: 'card', style: 'margin-bottom:1rem' }, h('summary', { text: 'Aggiungi una voce' }), h('div', { class: 'row' }, field('jt', 'Tipo', typeSel), h('div', { class: 'grow' }, field('jti', 'Titolo', title))), field('jb', 'Dettagli (facoltativo)', text),
        h('button', { class: 'btn primary sm', type: 'button', style: 'margin-top:.5rem', text: 'Aggiungi', onclick: async () => { try { await post(P('/journal'), { type: typeSel.value, title: title.value, body: text.value || undefined }); draw(); } catch (e) { err(e); } } })),
      r.items.length ? r.items.map(jItem) : h('p', { text: 'Il diario è ancora vuoto.' })]);
  }
  function jItem(i) {
    return h('div', { class: `item ${i.provisional ? 'prov' : ''}` }, [h('div', { class: 'row' }, h('strong', { text: i.title }), h('span', { class: 'badge', text: i.typeLabel }), provTag(i), i.contested && h('span', { class: 'badge bad', text: 'contestata' }), h('span', { class: 'badge', title: 'Come è nata questa voce', text: i.originLabel })),
      i.body && h('p', { text: i.body }), h('div', { class: 'small muted', text: `${i.author.displayName} · v${i.version} · ${fmtDate(i.updatedAt)}` }),
      h('div', { class: 'row', style: 'margin-top:.4rem' }, [
        i.status !== 'confermata' && i.status !== 'superata' && h('button', { class: 'btn sm', type: 'button', text: 'Conferma', onclick: async () => { try { await post(P(`/journal/${i.id}/confirm`), { expectedVersion: i.version }); draw(); } catch (e) { err(e); draw(); } } }),
        i.status !== 'superata' && h('button', { class: 'btn sm', type: 'button', text: 'Correggi', onclick: () => formDialog('Correggi la voce', [field('ct', 'Titolo', h('input', { type: 'text', id: 'ct', value: i.title, maxLength: 140 })), field('cb', 'Dettagli', h('textarea', { id: 'cb', rows: 3, text: i.body || '' })), field('cr', 'Motivo della correzione', h('input', { type: 'text', id: 'cr', maxLength: 200 }))], 'Salva', async () => { await post(P(`/journal/${i.id}/correct`), { title: document.getElementById('ct').value, body: document.getElementById('cb').value, reason: document.getElementById('cr').value || undefined, expectedVersion: i.version }); }).then((ok) => ok && draw()) }),
        i.status !== 'superata' && h('button', { class: 'btn sm', type: 'button', text: 'Contesta', onclick: () => formDialog('Contesta la voce', [field('cn', 'Perché non ti convince?', h('textarea', { id: 'cn', rows: 3, maxLength: 400 }))], 'Contesta', async () => { await post(P(`/journal/${i.id}/contest`), { note: document.getElementById('cn').value }); }).then((ok) => ok && draw()) }),
        i.type === 'problema_aperto' && i.status !== 'superata' && h('button', { class: 'btn sm', type: 'button', text: 'Segna come risolto', onclick: () => formDialog('Problema risolto', [field('rn', 'Come è stato risolto?', h('textarea', { id: 'rn', rows: 3, maxLength: 400 }))], 'Risolto', async () => { await post(P(`/journal/${i.id}/resolve`), { note: document.getElementById('rn').value }); }).then((ok) => ok && draw()) }),
        h('button', { class: 'btn sm ghost', type: 'button', text: 'Storico', onclick: async () => { try { const hs = await get(P(`/journal/${i.id}/history`)); dialog('Storico della voce', h('div', null, [hs.revisions.map((v) => h('div', { class: 'item' }, h('strong', { text: `v${v.version}: ${v.snapshot.title}` }), h('div', { class: 'small muted', text: `${v.by} · ${fmtDate(v.at)}${v.reason ? ' · ' + v.reason : ''}` }))), hs.reviews.map((v) => h('div', { class: 'small', text: `${fmtDate(v.at)} — ${v.by}: ${v.action}${v.note ? ' (' + v.note + ')' : ''}` })), !hs.revisions.length && !hs.reviews.length && h('p', { class: 'muted', text: 'Nessuna modifica.' })]), [{ label: 'Chiudi' }]); } catch (e) { err(e); } } })])]);
  }

  // ───────── decisioni ─────────
  async function decisioni() {
    const { decisions } = await get(P('/decisions'));
    const t = h('input', { type: 'text', id: 'dt', maxLength: 140 }); const b = h('textarea', { id: 'db', rows: 2, maxLength: 800 });
    clear(body); add(body, [h('p', { class: 'muted', text: 'Una decisione diventa “confermata” solo quando un altro partecipante la conferma. Se cambia, la vecchia non viene cancellata: resta nello storico come “superata”.' }),
      h('details', { class: 'card', style: 'margin-bottom:1rem' }, h('summary', { text: 'Proponi una decisione' }), field('dt', 'Titolo', t), field('db', 'Motivazione', b), h('button', { class: 'btn primary sm', type: 'button', style: 'margin-top:.5rem', text: 'Proponi', onclick: async () => { try { await post(P('/decisions'), { title: t.value, body: b.value || undefined }); draw(); } catch (e) { err(e); } } })),
      decisions.length ? decisions.map((d) => h('div', { class: `item ${d.status === 'confermata' ? '' : 'prov'}` }, [h('div', { class: 'row' }, h('strong', { text: d.title }), h('span', { class: `badge ${d.status === 'confermata' ? 'ok' : d.status === 'proposta' ? 'warn' : ''}`, text: d.status }), h('span', { class: 'small muted', text: `v${d.version}` })),
        d.body && h('p', { text: d.body }), h('div', { class: 'small muted', text: `Proposta da ${d.proposedBy.displayName}${d.confirmedBy ? ` · confermata da ${d.confirmedBy.displayName} (${fmtDate(d.confirmedAt)})` : ''}` }),
        h('div', { class: 'row', style: 'margin-top:.4rem' }, [d.status === 'proposta' && h('button', { class: 'btn sm primary', type: 'button', text: 'Conferma', onclick: async () => { try { await post(P(`/decisions/${d.id}/confirm`), { expectedVersion: d.version }); draw(); } catch (e) { err(e); draw(); } } }),
          (d.status === 'proposta' || d.status === 'confermata') && h('button', { class: 'btn sm', type: 'button', text: 'Proponi una modifica', onclick: () => formDialog('Proponi una modifica', [field('rt2', 'Nuovo titolo', h('input', { type: 'text', id: 'rt2', value: d.title, maxLength: 140 })), field('rb2', 'Motivazione', h('textarea', { id: 'rb2', rows: 3, text: d.body || '' }))], 'Proponi', async () => { await post(P(`/decisions/${d.id}/revise`), { title: document.getElementById('rt2').value, body: document.getElementById('rb2').value, expectedVersion: d.version }); }).then((ok) => ok && draw()) }),
          d.status === 'proposta' && h('button', { class: 'btn sm ghost', type: 'button', text: 'Ritira', onclick: async () => { try { await post(P(`/decisions/${d.id}/withdraw`)); draw(); } catch (e) { err(e); } } }),
          h('button', { class: 'btn sm ghost', type: 'button', text: 'Storico', onclick: async () => { try { const { history } = await get(P(`/decisions/${d.id}/history`)); dialog('Storico della decisione', h('div', null, history.map((x) => h('div', { class: 'item' }, h('strong', { text: x.title }), ' ', h('span', { class: 'badge', text: x.status }), h('div', { class: 'small muted', text: `v${x.version} · ${x.proposedBy.displayName}${x.confirmedBy ? ' · confermata da ' + x.confirmedBy.displayName : ''}` })))), [{ label: 'Chiudi' }]); } catch (e) { err(e); } } })])])) : h('p', { text: 'Nessuna decisione, per ora.' })]);
  }

  // ───────── parametri ─────────
  async function parametri() {
    const { parameters } = await get(P('/parameters'));
    const paramForm = (prev) => {
      const f = { c: h('input', { type: 'text', id: 'pc', maxLength: 60, value: prev?.component || '', placeholder: 'es. motore' }), n: h('input', { type: 'text', id: 'pn', maxLength: 60, value: prev?.name || '', placeholder: 'es. coppia' }),
        q: h('select', { id: 'pq' }, QUANT.map(([k, l]) => h('option', { value: k, text: l, selected: prev?.quantity === k }))), v: h('input', { type: 'text', id: 'pv', value: prev ? String(prev.value) : '', inputMode: 'decimal' }), u: h('input', { type: 'text', id: 'pu', value: prev?.unit || '', placeholder: 'es. N·m, mm, kW' }), l: h('input', { type: 'text', id: 'pl', maxLength: 60, value: prev?.linkedTo || '', placeholder: 'componente collegato (facoltativo)' }) };
      return [f, [h('div', { class: 'row' }, field('pc', 'Componente', f.c), field('pn', 'Parametro', f.n)), h('div', { class: 'row' }, field('pq', 'Grandezza', f.q), field('pv', 'Valore', f.v), field('pu', 'Unità', f.u)), field('pl', 'Collegato a', f.l)]];
    };
    const submit = (f, prev) => post(P('/parameters'), { component: f.c.value, name: f.n.value, quantity: f.q.value, value: Number(String(f.v.value).replace(',', '.')), unit: f.u.value, linkedTo: f.l.value || undefined, supersedes: prev?.id });
    const addNew = async () => { const [f, fs] = paramForm(); if (await formDialog('Nuovo parametro del progetto', fs, 'Aggiungi', async () => { const r = await submit(f); if (r.alerts?.length) toast('La Scatola Nera ha trovato qualcosa da controllare: vedi gli avvisi.'); })) draw(); };
    clear(body); add(body, [h('p', { class: 'muted', text: 'I dati dichiarati dal gruppo (con unità di misura) sono la base dei controlli della Scatola Nera. Un valore modificato non cancella il precedente.' }), h('button', { class: 'btn primary', type: 'button', text: 'Aggiungi un parametro', onclick: addNew }),
      h('table', { style: 'margin-top:1rem' }, h('thead', null, h('tr', null, ['Componente', 'Parametro', 'Valore', 'Collegato a', 'Inserito da', ''].map((x) => h('th', { text: x })))), h('tbody', null, parameters.map((p) => h('tr', null, h('td', { text: p.component }), h('td', { text: p.name }), h('td', { text: `${p.value} ${p.unit}` }), h('td', { text: p.linkedTo || '—' }), h('td', { text: `${p.author.displayName} (v${p.version})` }),
        h('td', null, h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', text: 'Aggiorna', onclick: async () => { const [f, fs] = paramForm(p); if (await formDialog('Aggiorna il parametro', fs, 'Salva (il valore precedente resta nello storico)', async () => { await submit(f, p); })) draw(); } }),
          h('button', { class: 'btn sm ghost', type: 'button', text: 'Ritira', onclick: async () => { try { await del(P(`/parameters/${p.id}`)); draw(); } catch (e) { err(e); } } }))))))), !parameters.length && h('p', { class: 'muted', text: 'Nessun parametro inserito.' })]);
  }

  // ───────── Scatola Nera ─────────
  async function avvisi() {
    const { alerts } = await get(P('/alerts?status=attivi')); const { alerts: closed } = await get(P('/alerts?status=risolto'));
    clear(body); add(body, [h('p', { class: 'notice', text: 'La Scatola Nera confronta i dati dichiarati dal gruppo (unità, diametri, tensioni, ipotesi di carico). Un avviso “verificato” viene da una regola precisa; uno “possibile” è un’ipotesi da controllare. Non certifica la sicurezza di niente.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Ricontrolla ora', onclick: async () => { try { await post(P('/analyze')); toast('Controllo eseguito.'); draw(); } catch (e) { err(e); } } })),
      h('h2', { text: `Da controllare (${alerts.length})`, style: 'margin-top:1rem' }), alerts.length ? alerts.map(alertCard) : h('p', { class: 'muted', text: 'Nessun avviso aperto: i dati inseriti finora non risultano in contrasto. (Non significa che sia tutto corretto.)' }),
      closed.length > 0 && [h('h2', { text: 'Chiusi di recente' }), closed.slice(0, 5).map((a) => h('div', { class: 'item' }, h('strong', { text: a.title }), ' ', h('span', { class: 'badge', text: a.statusLabel }), a.resolutionNote && h('div', { class: 'small', text: a.resolutionNote })))]]);
  }
  function alertCard(a) {
    return h('article', { class: `item alert-${a.priority === 'alta' ? 'high' : a.priority === 'media' ? 'mid' : 'low'}` }, [
      h('div', { class: 'row' }, h('strong', { text: a.title }), h('span', { class: `badge ${a.level === 'verificato' ? 'bad' : 'warn'}`, text: a.levelLabel }), h('span', { class: 'badge', text: `priorità ${a.priority}` }), h('span', { class: 'badge', text: a.statusLabel }), a.origin === 'ia' && h('span', { class: 'badge sim', text: 'segnalazione IA' })),
      h('p', { text: a.reason }), h('p', { class: 'small muted', text: `Perché questa priorità: ${a.priorityReason}` }),
      a.missing?.length > 0 && h('div', null, h('strong', { text: 'Dati che mancano:' }), h('ul', null, a.missing.map((m) => h('li', { text: m })))),
      h('p', null, h('strong', { text: 'Per ragionarci: ' }), a.guidingQuestion), h('p', { class: 'small muted', text: a.originLabel }),
      h('div', { class: 'row' }, [['R5_CARICO', 'IA_CONTESTO'].includes(a.ruleId) && h('button', { class: 'btn sm primary', type: 'button', text: 'Guidami nel ricalcolo', onclick: () => guide(a) }), h('button', { class: 'btn sm', type: 'button', text: 'Mostra le fonti', onclick: () => sources(a) }),
        h('button', { class: 'btn sm', type: 'button', text: 'Aggiungi il dato mancante', onclick: () => location.hash = '#/gruppo/parametri' }),
        h('button', { class: 'btn sm', type: 'button', text: 'Falso positivo', onclick: () => formDialog('Segna come falso positivo', [field('fp', 'Perché non è un problema reale?', h('textarea', { id: 'fp', rows: 2, maxLength: 300 }))], 'Conferma', async () => { await post(P(`/alerts/${a.id}/false-positive`), { note: document.getElementById('fp').value }); }).then((ok) => ok && draw()) }),
        h('button', { class: 'btn sm', type: 'button', text: 'Risolto', onclick: () => formDialog('Segna come risolto', [field('rs', 'Come è stato risolto? (obbligatorio)', h('textarea', { id: 'rs', rows: 2, maxLength: 400 }))], 'Risolto', async () => { await post(P(`/alerts/${a.id}/resolve`), { note: document.getElementById('rs').value }); }).then((ok) => ok && draw()) })]),
      h('p', { class: 'small muted', style: 'margin-top:.6rem', text: a.disclaimer })]);
  }
  async function sources(a) { try { const r = await get(P(`/alerts/${a.id}/sources`)); dialog('Fonti dell’avviso', h('div', null, r.sources.map((s) => h('div', { class: 'item' }, h('strong', { text: s.type }), ': ', s.description, h('div', { class: 'small muted', text: `${s.author || ''} ${s.at ? '· ' + s.at : ''}` })))), [{ label: 'Chiudi' }]); } catch (e) { err(e); } }
  async function guide(a) {
    let c; try { c = (await post(P(`/alerts/${a.id}/guide`))).check; } catch (e) { if (e.details?.missing) { dialog('Mancano dei dati', h('div', null, [h('p', { text: e.message }), h('ul', null, e.details.missing.map((m) => h('li', { text: m })))]), [{ label: 'Chiudi' }]); return; } err(e); return; }
    const out = h('div'); const ans = h('textarea', { rows: 3, id: 'ga', 'aria-label': 'La tua risposta' }); const fb = h('div', { 'aria-live': 'polite' });
    const draw2 = () => { clear(out); add(out, [h('p', { class: 'small muted', text: `${c.title} — passo ${c.step} di ${c.totalSteps}` }), c.status === 'verificato' ? null : renderMarkdown(c.prompt)]); };
    const show = (r) => { c = { ...c, ...r }; clear(fb); if (r.feedback) fb.append(h('div', { class: `notice ${r.correct === false ? 'warn' : ''}`, text: r.feedback })); if (r.hint) fb.append(h('div', { class: 'notice', text: 'Indizio: ' + r.hint })); if (r.hintNote) fb.append(h('p', { class: 'small muted', text: r.hintNote }));
      if (r.done) { add(fb, [r.comparison && h('p', { text: r.comparison }), h('p', { class: 'notice warn', text: r.disclaimer })]); ans.disabled = true; } else draw2(); ans.value = ''; };
    draw2();
    await dialog('Ricalcolo guidato', h('div', null, [out, ans, fb]), [{ label: 'Chiudi', value: null },
      { label: 'Dammi un indizio', onClick: async () => { try { show((await post(P(`/checks/${c.id}/hint`))).check); } catch (e) { err(e); } return false; } },
      { label: 'Rispondi', primary: true, onClick: async () => { if (!ans.value.trim()) return false; try { show((await post(P(`/checks/${c.id}/answer`), { text: ans.value })).check); } catch (e) { err(e); } return false; } }]);
    draw();
  }
}
