'use strict';
// PLANNER: registro delle scadenze (progetti di gruppo, verifiche, consegne di laboratorio, compiti) e
// SUGGERITORE DI STUDIO deterministico: calcola il tempo che resta e propone le priorità di oggi per ciascuno.
// Ambiti: personale (solo io) · gruppo (tutti i partecipanti attivi del progetto) · corso (inserite da un docente, visibili a tutti).
// Ogni persona segna il PROPRIO avanzamento: il piano è individuale anche per le scadenze condivise.
const { E } = require('../lib/errors');
const { now, uuid, jparse, clamp } = require('../lib/util');

const KINDS = { progetto: 'Progetto di gruppo', verifica: 'Verifica', interrogazione: 'Interrogazione', laboratorio: 'Consegna di laboratorio', compito: 'Compito', altro: 'Altro' };
const DEFAULT_PREFS = { dailyMinutes: 120, studyDays: [1, 2, 3, 4, 5, 6] }; // lun–sab
const DAY = 864e5;

function createPlanner(ctx) {
  const { db, access, events } = ctx;

  const prefsOf = (userId) => ({ ...DEFAULT_PREFS, ...(jparse(db.get('SELECT prefs_json FROM user_prefs WHERE user_id = ?', userId)?.prefs_json, {}) || {}).planner });
  function setPrefs(user, { dailyMinutes, studyDays }) {
    const cur = jparse(db.get('SELECT prefs_json FROM user_prefs WHERE user_id = ?', user.id)?.prefs_json, {}) || {};
    const p = { ...DEFAULT_PREFS, ...(cur.planner || {}) };
    if (dailyMinutes !== undefined) { const m = Number(dailyMinutes); if (!Number.isFinite(m) || m < 15 || m > 600) throw E.bad('Il tempo di studio giornaliero va da 15 a 600 minuti.'); p.dailyMinutes = Math.round(m); }
    if (studyDays !== undefined) { const d = [...new Set((Array.isArray(studyDays) ? studyDays : []).map(Number).filter((x) => x >= 0 && x <= 6))]; if (!d.length) throw E.bad('Scegli almeno un giorno di studio.'); p.studyDays = d.sort(); }
    db.run('INSERT INTO user_prefs (user_id, prefs_json, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at', user.id, JSON.stringify({ ...cur, planner: p }), now());
    return p;
  }

  const canSee = (user, d) => d.scope === 'corso' || (d.scope === 'personale' && d.owner_id === user.id) || (d.scope === 'gruppo' && !!access.membership(user.id, d.project_id));
  const canEdit = (user, d) => d.owner_id === user.id || (d.scope === 'gruppo' && ['owner', 'teacher'].includes(access.membership(user.id, d.project_id)?.role)) || (d.scope === 'corso' && user.role !== 'student');
  const progressOf = (id, userId) => db.get('SELECT * FROM deadline_progress WHERE deadline_id = ? AND user_id = ?', id, userId);
  function pub(d, user) {
    const p = progressOf(d.id, user.id);
    return { id: d.id, scope: d.scope, kind: d.kind, kindLabel: KINDS[d.kind], title: d.title, subjectId: d.subject_id, subjectName: d.subject_id ? ctx.subjects.get(d.subject_id)?.name || null : null,
      projectId: d.project_id, projectName: d.project_id ? access.project(d.project_id)?.name : null, dueAt: d.due_at, estimateHours: d.estimate_hours, notes: d.notes,
      owner: { id: d.owner_id, displayName: access.userLabel(d.owner_id) }, canEdit: canEdit(user, d), progress: p?.progress || 0, done: !!p?.done_at, doneAt: p?.done_at || null, createdAt: d.created_at };
  }
  function validate(user, b, existing = null) {
    const title = String(b.title ?? existing?.title ?? '').replace(/\s+/g, ' ').trim();
    if (title.length < 3 || title.length > 120) throw E.bad('Il titolo deve avere da 3 a 120 caratteri.');
    const kind = b.kind ?? existing?.kind ?? 'altro'; if (!KINDS[kind]) throw E.bad('Tipo di scadenza non valido.');
    const due = new Date(b.dueAt ?? existing?.due_at); if (Number.isNaN(+due)) throw E.bad('Data della scadenza non valida.');
    if (!existing && +due < Date.now() - DAY) throw E.bad('La scadenza è già passata.');
    if (+due > Date.now() + 400 * DAY) throw E.bad('La scadenza è troppo lontana (oltre un anno).');
    const est = Number(b.estimateHours ?? existing?.estimate_hours ?? 2); if (!Number.isFinite(est) || est < 0.25 || est > 200) throw E.bad('Il tempo stimato va da 15 minuti a 200 ore.');
    const subjectId = b.subjectId === undefined ? existing?.subject_id ?? null : b.subjectId || null; if (subjectId && !ctx.subjects.get(subjectId)) throw E.bad('Materia non valida.');
    const notes = String(b.notes ?? existing?.notes ?? '').trim().slice(0, 600) || null;
    return { title, kind, due: due.toISOString(), est: Math.round(est * 4) / 4, subjectId, notes };
  }
  function create(user, b = {}) {
    const scope = b.scope || 'personale';
    if (!['personale', 'gruppo', 'corso'].includes(scope)) throw E.bad('Ambito non valido.');
    let projectId = null;
    if (scope === 'gruppo') { access.requireMember(user, b.projectId); projectId = b.projectId; }
    if (scope === 'corso' && user.role === 'student') throw E.forbidden('Solo i docenti possono inserire scadenze per tutto il corso.');
    if (db.get('SELECT COUNT(*) n FROM deadlines WHERE owner_id = ?', user.id).n >= 300) throw E.bad('Hai troppe scadenze registrate: elimina quelle vecchie.');
    const v = validate(user, b);
    const id = uuid(); const t = now();
    db.run('INSERT INTO deadlines (id, owner_id, project_id, scope, kind, title, subject_id, due_at, estimate_hours, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, user.id, projectId, scope, v.kind, v.title, v.subjectId, v.due, v.est, v.notes, t, t);
    if (projectId) events.publish(projectId, { type: 'deadline.added', entityType: 'deadline', entityId: id, actorId: user.id });
    if (scope === 'corso') ctx.hub?.notify('*', { type: 'planner.updated' });
    return pub(db.get('SELECT * FROM deadlines WHERE id = ?', id), user);
  }
  const get = (user, id) => { const d = db.get('SELECT * FROM deadlines WHERE id = ?', id); if (!d || !canSee(user, d)) throw E.notFound('Scadenza non trovata.'); return d; };
  function update(user, id, b = {}) {
    const d = get(user, id); if (!canEdit(user, d)) throw E.forbidden('Può modificarla solo chi l’ha inserita.');
    const v = validate(user, b, d);
    db.run('UPDATE deadlines SET title = ?, kind = ?, due_at = ?, estimate_hours = ?, subject_id = ?, notes = ?, updated_at = ? WHERE id = ?', v.title, v.kind, v.due, v.est, v.subjectId, v.notes, now(), id);
    if (d.project_id) events.publish(d.project_id, { type: 'deadline.updated', entityType: 'deadline', entityId: id, actorId: user.id });
    return pub(db.get('SELECT * FROM deadlines WHERE id = ?', id), user);
  }
  function remove(user, id) {
    const d = get(user, id); if (!canEdit(user, d)) throw E.forbidden('Può eliminarla solo chi l’ha inserita.');
    db.run('DELETE FROM deadlines WHERE id = ?', id);
    if (d.project_id) events.publish(d.project_id, { type: 'deadline.deleted', entityType: 'deadline', entityId: id, actorId: user.id });
    return { ok: true };
  }
  function setProgress(user, id, { progress, done }) {
    const d = get(user, id);
    let p = progress !== undefined ? clamp(Math.round(Number(progress) || 0), 0, 100) : progressOf(id, user.id)?.progress || 0;
    if (done === true) p = 100;
    const doneAt = done === true || p >= 100 ? now() : null;
    db.run('INSERT INTO deadline_progress (deadline_id, user_id, progress, done_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(deadline_id, user_id) DO UPDATE SET progress = excluded.progress, done_at = excluded.done_at, updated_at = excluded.updated_at',
      id, user.id, done === false && p >= 100 ? 90 : p, done === false ? null : doneAt, now());
    if (d.project_id) events.publish(d.project_id, { type: 'deadline.progress', entityType: 'deadline', entityId: id, actorId: user.id });
    return pub(d, user);
  }
  function visible(user, { includeDone = true, from = null } = {}) {
    const pids = access.myProjects(user.id).map((p) => p.id);
    const rows = db.all(`SELECT * FROM deadlines WHERE (scope = 'personale' AND owner_id = ?) OR scope = 'corso' ${pids.length ? `OR (scope = 'gruppo' AND project_id IN (${pids.map(() => '?').join(',')}))` : ''} ORDER BY due_at`, user.id, ...pids);
    return rows.filter((d) => !from || d.due_at >= from).map((d) => pub(d, user)).filter((d) => includeDone || !d.done);
  }

  // ── suggeritore di studio ──
  // Per ogni scadenza non completata: ore che restano = stima × (1 − avanzamento); giorni utili fino alla scadenza
  // (solo i giorni di studio scelti, escluso il giorno della consegna se è mattina presto); fabbisogno = ore / giorni utili.
  // Priorità = fabbisogno giornaliero (con un peso maggiore per verifiche e interrogazioni vicine). Il tempo di oggi si distribuisce in ordine di priorità.
  function studyDaysBetween(from, to, studyDays) {
    let n = 0; const d = new Date(from); d.setHours(0, 0, 0, 0); const end = new Date(to);
    if (end.getHours() < 14) end.setHours(0, 0, 0, 0); // consegna al mattino: quel giorno non si studia più per essa
    while (d < end && n < 400) { if (studyDays.includes(d.getDay())) n++; d.setDate(d.getDate() + 1); }
    return n;
  }
  function plan(user, { at = Date.now() } = {}) {
    const prefs = prefsOf(user.id);
    const today = new Date(at); const isStudyDay = prefs.studyDays.includes(today.getDay());
    const items = visible(user, { includeDone: false }).map((d) => {
      const due = new Date(d.dueAt).getTime();
      const remainingH = Math.max(0, d.estimateHours * (1 - d.progress / 100));
      const hoursLeft = (due - at) / 3600e3;
      const days = Math.max(1, studyDaysBetween(at, due, prefs.studyDays));
      const overdue = due < at;
      const perDayMin = overdue ? Math.round(remainingH * 60) : Math.ceil((remainingH * 60) / days);
      const weight = ['verifica', 'interrogazione'].includes(d.kind) ? 1.25 : d.kind === 'progetto' ? 1.1 : 1;
      const urgency = overdue ? 1e6 : (perDayMin * weight) / Math.sqrt(Math.max(1, hoursLeft / 24));
      const status = overdue ? 'scaduta' : hoursLeft < 24 ? 'oggi' : hoursLeft < 72 ? 'vicina' : perDayMin > prefs.dailyMinutes * 0.6 ? 'impegnativa' : 'in_tempo';
      return { ...d, remainingMinutes: Math.round(remainingH * 60), daysLeft: Math.max(0, Math.ceil((due - at) / DAY)), hoursLeft: Math.round(hoursLeft), studyDaysLeft: overdue ? 0 : days, perDayMinutes: perDayMin, urgency, status };
    }).sort((a, b) => b.urgency - a.urgency || a.dueAt.localeCompare(b.dueAt));
    let budget = isStudyDay ? prefs.dailyMinutes : 0; const today_ = [];
    for (const it of items) {
      if (budget <= 0) break; if (!it.remainingMinutes) continue;
      const want = it.status === 'scaduta' || it.status === 'oggi' ? it.remainingMinutes : Math.max(15, it.perDayMinutes);
      const give = Math.min(budget, want, it.remainingMinutes); if (give < 10) continue;
      const mins = Math.round(give / 5) * 5 || give;
      today_.push({ deadlineId: it.id, title: it.title, kindLabel: it.kindLabel, minutes: mins, why: reason(it) }); budget -= mins;
    }
    const totalNeed = items.reduce((n, i) => n + (i.status === 'scaduta' ? 0 : i.perDayMinutes), 0);
    const warnings = [];
    if (items.some((i) => i.status === 'scaduta')) warnings.push('Hai scadenze già passate non segnate come completate: aggiornale o parlane con il docente.');
    if (totalNeed > prefs.dailyMinutes) warnings.push(`Per stare nei tempi servirebbero circa ${Math.round(totalNeed)} minuti al giorno, più dei ${prefs.dailyMinutes} che hai indicato: anticipa il lavoro o chiedi aiuto al gruppo.`);
    if (!isStudyDay) warnings.push('Oggi non è tra i tuoi giorni di studio: nessun piano per oggi.');
    return { prefs, today: today_, todayMinutes: today_.reduce((n, x) => n + x.minutes, 0), items, warnings,
      note: 'Suggerimento calcolato dalle stime di tempo e dall’avanzamento che inserisci tu: è un aiuto per organizzarti, non un obbligo.' };
  }
  function reason(it) {
    if (it.status === 'scaduta') return 'È già scaduta: chiudila il prima possibile.';
    if (it.status === 'oggi') return `Scade tra meno di 24 ore: restano circa ${fmtMin(it.remainingMinutes)}.`;
    return `Mancano ${it.daysLeft} giorn${it.daysLeft === 1 ? 'o' : 'i'} (${it.studyDaysLeft} di studio): servono ~${fmtMin(it.perDayMinutes)} al giorno.`;
  }
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

  // Quadro del gruppo: per ogni scadenza di gruppo, l'avanzamento dichiarato da ciascun partecipante e il suo carico giornaliero stimato.
  function groupBoard(user, projectId) {
    access.requireMember(user, projectId);
    const members = access.activeMembers(projectId);
    const deadlines = db.all("SELECT * FROM deadlines WHERE scope = 'gruppo' AND project_id = ? AND due_at >= ? ORDER BY due_at", projectId, new Date(Date.now() - 7 * DAY).toISOString());
    return {
      deadlines: deadlines.map((d) => ({ ...pub(d, user), members: members.map((m) => { const p = progressOf(d.id, m.user_id); const remain = d.estimate_hours * (1 - (p?.progress || 0) / 100); const prefs = prefsOf(m.user_id);
        const days = Math.max(1, studyDaysBetween(Date.now(), new Date(d.due_at), prefs.studyDays));
        return { id: m.user_id, displayName: m.display_name, workstream: m.workstream, progress: p?.progress || 0, done: !!p?.done_at, perDayMinutes: Math.ceil((remain * 60) / days) }; }) })),
      note: 'Ognuno vede l’avanzamento che i compagni hanno segnato sulle scadenze del gruppo, non le loro scadenze personali.',
    };
  }
  const exportFor = (user) => ({ scadenze: db.all('SELECT * FROM deadlines WHERE owner_id = ?', user.id).map((d) => pub(d, user)), avanzamento: db.all('SELECT * FROM deadline_progress WHERE user_id = ?', user.id), preferenze: prefsOf(user.id) });
  return { create, update, remove, setProgress, visible, plan, groupBoard, setPrefs, prefsOf, exportFor, KINDS };
}
module.exports = { createPlanner };
