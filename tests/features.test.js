'use strict';
// Cartelle e trasferimenti tra dispositivi collegati, Hub di progetto (Kanban, asset, PDF), Planner, Bacheca, feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, form, until, mulinoScenario } = require('./helpers');

const upload = (u, name, text, extra = {}) => u.api('POST', '/api/materials', form({ visibility: 'personale', ...extra }, { name, data: Buffer.from(text), type: 'text/plain' }));

test('cartelle: caricamento in cartella, riuso del nome, spostamento e rinomina', async () => {
  const t = await boot(); const u = await t.user('Ada');
  const a = (await upload(u, 'appunti.txt', 'Appunti sul momento di una forza e sulle leve.', { folder: 'Statica' })).body.material;
  assert.equal(a.folder, 'Statica');
  const b = (await upload(u, 'esercizi.txt', 'Esercizi sulle travi appoggiate.', { folder: 'statica' })).body.material;
  assert.equal(b.folder, 'Statica'); // stesso nome senza distinguere maiuscole
  let r = await u.api('PATCH', `/api/materials/${b.materialId}`, { folder: 'Ripasso / verifica' });
  assert.equal(r.status, 200); assert.equal(r.body.folder, 'Ripasso verifica');
  r = await u.api('POST', '/api/materials-folders/rename', { scope: 'personale', from: 'statica', to: 'Meccanica - statica' });
  assert.equal(r.body.moved, 1);
  const list = (await u.api('GET', '/api/materials?scope=personale')).body.materials;
  assert.deepEqual(list.map((m) => m.folder).sort(), ['Meccanica - statica', 'Ripasso verifica']);
  const v = await t.user('Ugo');
  assert.equal((await v.api('PATCH', `/api/materials/${a.materialId}`, { folder: 'X' })).status, 404); // file altrui: non esiste
  await t.close();
});

test('trasferimenti: offerta, accettazione con copia nei materiali personali, rifiuto, annullamento', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  const f1 = (await upload(elia, 'motore.txt', 'Scelta del motore: coppia, regime e potenza.', { folder: 'Motore' })).body.material;
  const f2 = (await upload(elia, 'calcoli.txt', 'Calcoli della trasmissione con rapporto 1:5.', { folder: 'Motore' })).body.material;
  await t.ctx.waitIdle();
  // solo verso un compagno collegato, solo i propri file personali
  const out = await t.user('Estraneo');
  assert.equal((await elia.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: out.id, materialIds: [f1.materialId] })).status, 400);
  assert.equal((await marco.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: elia.id, materialIds: [f1.materialId] })).status, 404);
  assert.equal((await out.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: elia.id, materialIds: [] })).status, 404);
  // invio di una cartella intera
  let r = await elia.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: marco.id, folder: 'motore', note: 'Ecco i miei calcoli' });
  assert.equal(r.status, 201); assert.equal(r.body.transfer.count, 2); assert.equal(r.body.transfer.folder, 'Motore');
  const id = r.body.transfer.id;
  const inbox = (await marco.api('GET', '/api/transfers')).body;
  assert.equal(inbox.pendingIn, 1); assert.equal(inbox.transfers[0].direction, 'in'); assert.equal(inbox.transfers[0].note, 'Ecco i miei calcoli');
  assert.equal((await elia.api('POST', `/api/transfers/${id}/accept`)).status, 403); // il mittente non accetta per l'altro
  r = await marco.api('POST', `/api/transfers/${id}/accept`);
  assert.equal(r.status, 200); assert.equal(r.body.copied.length, 2);
  await t.ctx.waitIdle();
  const mine = (await marco.api('GET', '/api/materials?scope=personale')).body.materials;
  assert.equal(mine.length, 2); assert.ok(mine.every((m) => m.folder === 'Motore' && m.uploadedBy.id === marco.id));
  assert.equal((await marco.api('POST', `/api/transfers/${id}/accept`)).status, 409); // già accettato
  // i file di Elia restano suoi e intatti
  assert.equal((await elia.api('GET', '/api/materials?scope=personale')).body.materials.length, 2);
  // rifiuto e annullamento
  const x = (await elia.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: marco.id, materialIds: [f1.materialId] })).body.transfer;
  assert.equal((await marco.api('POST', `/api/transfers/${x.id}/decline`)).body.transfer.status, 'declined');
  const y = (await elia.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: marco.id, materialIds: [f2.materialId] })).body.transfer;
  assert.equal((await marco.api('POST', `/api/transfers/${y.id}/cancel`)).status, 403);
  assert.equal((await elia.api('POST', `/api/transfers/${y.id}/cancel`)).body.transfer.status, 'cancelled');
  // un estraneo non vede nulla
  assert.equal((await out.api('GET', '/api/transfers')).body.transfers.length, 0);
  assert.equal((await out.api('POST', `/api/transfers/${y.id}/accept`)).status, 404);
  await t.close();
});

test('trasferimenti: chi esce dal gruppo non può più ricevere; notifiche in tempo reale senza contenuti', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  const f = (await upload(elia, 'schema.txt', 'Schema del telaio con le quote principali.')).body.material;
  const ws = t.ws(marco.token); await ws.auth();
  const tr = (await elia.api('POST', `/api/projects/${project.id}/transfers`, { toUserId: marco.id, materialIds: [f.materialId] })).body.transfer;
  const n = await ws.wait((m) => m.type === 'notify' && m.event.type === 'transfer.updated');
  assert.equal(n.event.status, 'pending'); assert.ok(!JSON.stringify(n).includes('schema'));
  await marco.api('POST', `/api/projects/${project.id}/leave`, {});
  const l = (await marco.api('GET', '/api/transfers')).body.transfers.find((x) => x.id === tr.id);
  assert.equal(l.status, 'cancelled');
  assert.equal((await marco.api('POST', `/api/transfers/${tr.id}/accept`)).status, 409);
  await ws.close(); await t.close();
});

test('Kanban: attività manuali, proposte automatiche dai contributi condivisi (solo condivisi), accetta/scarta', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  let r = await elia.api('POST', `/api/projects/${project.id}/tasks`, { title: 'Disegnare il telaio', assigneeId: marco.id });
  assert.equal(r.status, 201); assert.equal(r.body.task.status, 'da_fare'); assert.equal(r.body.task.assignee.displayName, 'Marco');
  const task = r.body.task;
  r = await marco.api('PATCH', `/api/projects/${project.id}/tasks/${task.id}`, { status: 'in_corso', expectedVersion: task.version });
  assert.equal(r.body.task.status, 'in_corso');
  assert.equal((await elia.api('PATCH', `/api/projects/${project.id}/tasks/${task.id}`, { title: 'Vecchio', expectedVersion: task.version })).status, 409);
  assert.equal((await elia.api('POST', `/api/projects/${project.id}/tasks`, { title: 'X', assigneeId: 'nessuno' })).status, 400);
  // una chat privata NON genera proposte; un contributo condiviso sì
  const s = (await marco.api('POST', '/api/sessions', { projectId: project.id })).body.session;
  await marco.api('POST', `/api/sessions/${s.id}/messages`, { text: 'Segreto: devo ancora studiare tutto.' });
  r = await elia.api('POST', `/api/projects/${project.id}/tasks/propose`, {});
  assert.equal(r.body.created, 0);
  const s2 = (await elia.api('POST', '/api/sessions', { projectId: project.id })).body.session;
  const m = (await elia.api('POST', `/api/sessions/${s2.id}/messages`, { text: 'Per il motore dobbiamo verificare la coppia del motoriduttore da 12 N·m. Poi bisogna scegliere il cuscinetto dell albero.' })).body;
  await elia.api('POST', `/api/sessions/${s2.id}/messages/${m.userMessage.id}/share`, { projectId: project.id });
  r = await elia.api('POST', `/api/projects/${project.id}/tasks/propose`, {});
  assert.ok(r.body.created >= 2, JSON.stringify(r.body));
  const props = (await marco.api('GET', `/api/projects/${project.id}/tasks`)).body.tasks.filter((x) => x.status === 'proposta');
  assert.ok(props.every((p) => ['contributo', 'diario'].includes(p.source.kind) && p.createdBy.displayName === 'Omar AI'), JSON.stringify(props.map((p) => [p.title, p.source, p.assignee])));
  assert.ok(props.some((p) => p.assignee?.id === elia.id)); // suggerito in base al lavoro di cui si occupa
  r = await elia.api('POST', `/api/projects/${project.id}/tasks/propose`, {});
  assert.equal(r.body.created, 0); // nessun duplicato
  assert.equal((await marco.api('PATCH', `/api/projects/${project.id}/tasks/${props[0].id}`, { status: 'da_fare' })).body.task.status, 'da_fare');
  assert.equal((await marco.api('DELETE', `/api/projects/${project.id}/tasks/${props[1].id}`)).status, 200);
  const out = await t.user('Fuori');
  assert.equal((await out.api('GET', `/api/projects/${project.id}/tasks`)).status, 404);
  await t.close();
});

test('Asset Manager: snippet, raccolta dai contributi, permessi; relazione PDF valida', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  let r = await elia.api('POST', `/api/projects/${project.id}/snippets`, { kind: 'codice', title: 'Lettura encoder', content: 'int giri = 0;\nvoid loop() { giri++; }', language: 'arduino' });
  assert.equal(r.status, 201);
  assert.equal((await marco.api('PATCH', `/api/projects/${project.id}/snippets/${r.body.snippet.id}`, { title: 'Mio' })).status, 403);
  assert.equal((await elia.api('POST', `/api/projects/${project.id}/snippets`, { kind: 'link', title: 'Sito', content: 'javascript:alert(1)' })).status, 400);
  const s = (await marco.api('POST', '/api/sessions', { projectId: project.id })).body.session;
  const msg = (await marco.api('POST', `/api/sessions/${s.id}/messages`, { text: 'La formula è $$M = F \\cdot b$$ e il codice:\n```python\nprint(12*0.5)\n```\nvedi https://example.org/guida' })).body;
  await marco.api('POST', `/api/sessions/${s.id}/messages/${msg.userMessage.id}/share`, { projectId: project.id });
  r = await elia.api('POST', `/api/projects/${project.id}/assets/harvest`);
  assert.equal(r.body.created, 3);
  assert.equal((await elia.api('POST', `/api/projects/${project.id}/assets/harvest`)).body.created, 0);
  const assets = (await elia.api('GET', `/api/projects/${project.id}/assets`)).body;
  assert.equal(assets.snippets.length, 4); assert.ok(assets.snippets.some((x) => x.kind === 'codice' && x.language === 'python' && x.author.displayName === 'Marco'));
  await elia.api('POST', `/api/projects/${project.id}/tasks`, { title: 'Verificare la coppia', assigneeId: marco.id });
  await elia.api('POST', '/api/planner/deadlines', { scope: 'gruppo', projectId: project.id, kind: 'progetto', title: 'Consegna del mulino', dueAt: new Date(Date.now() + 10 * 864e5).toISOString(), estimateHours: 6 });
  const res = await fetch(`${t.base}/api/projects/${project.id}/report.pdf`, { headers: { authorization: `Bearer ${elia.token}` } });
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.match(buf.subarray(-6).toString(), /%%EOF/);
  // il PDF si rilegge con il lettore usato dai materiali (verifica di struttura e testo)
  const pdf = await require('pdf-parse')(buf);
  assert.match(pdf.text, /Relazione tecnica/); assert.match(pdf.text, /Verificare la coppia/); assert.match(pdf.text, /Consegna del mulino/); assert.match(pdf.text, /Lettura encoder/);
  const out = await t.user('Fuori');
  assert.equal((await fetch(`${t.base}/api/projects/${project.id}/report.pdf`, { headers: { authorization: `Bearer ${out.token}` } })).status, 404);
  await t.close();
});

test('Planner: scadenze per ambito, piano di oggi e quadro del gruppo', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  const day = 864e5;
  assert.equal((await marco.api('POST', '/api/planner/deadlines', { scope: 'corso', title: 'Verifica', dueAt: new Date(Date.now() + day).toISOString() })).status, 403);
  await marco.api('POST', '/api/planner/deadlines', { title: 'Verifica di statica', kind: 'verifica', dueAt: new Date(Date.now() + 2 * day).toISOString(), estimateHours: 3, subjectId: 'meccanica' });
  const g = (await elia.api('POST', '/api/planner/deadlines', { scope: 'gruppo', projectId: project.id, kind: 'laboratorio', title: 'Consegna relazione di laboratorio', dueAt: new Date(Date.now() + 9 * day).toISOString(), estimateHours: 4 })).body.deadline;
  const prof = await t.user('Prof', 'teacher');
  await prof.api('POST', '/api/planner/deadlines', { scope: 'corso', kind: 'compito', title: 'Esercizi pag. 120', dueAt: new Date(Date.now() + 5 * day).toISOString(), estimateHours: 1 });
  await marco.api('PUT', '/api/planner/prefs', { dailyMinutes: 90, studyDays: [0, 1, 2, 3, 4, 5, 6] });
  let p = (await marco.api('GET', '/api/planner')).body;
  assert.equal(p.deadlines.length, 3); assert.ok(p.today.length >= 1);
  assert.equal(p.today[0].title, 'Verifica di statica'); // la più urgente prima
  assert.ok(p.todayMinutes <= 90);
  // l'avanzamento è personale
  await marco.api('PUT', `/api/planner/deadlines/${g.id}/progress`, { progress: 50 });
  assert.equal((await elia.api('GET', '/api/planner')).body.deadlines.find((d) => d.id === g.id).progress, 0);
  const board = (await elia.api('GET', `/api/projects/${project.id}/planner`)).body;
  assert.equal(board.deadlines[0].members.find((m) => m.id === marco.id).progress, 50);
  // le scadenze personali di Marco non sono visibili a Elia
  assert.ok(!(await elia.api('GET', '/api/planner')).body.deadlines.some((d) => d.title === 'Verifica di statica'));
  assert.equal((await marco.api('PATCH', `/api/planner/deadlines/${g.id}`, { title: 'Cambio' })).status, 403);
  assert.equal((await marco.api('PUT', `/api/planner/deadlines/${g.id}/progress`, { done: true })).body.deadline.done, true);
  p = (await marco.api('GET', '/api/planner')).body;
  assert.ok(!p.items.some((i) => i.id === g.id));
  await t.close();
});

test('Bacheca: voce del concorso da completare, pubblicazione riservata ai docenti, letture, notifiche', async () => {
  const t = await boot(); const s = await t.user('Sofia'); const prof = await t.user('Prof', 'teacher');
  let b = (await s.api('GET', '/api/bulletins')).body;
  assert.equal(b.items.length, 1); assert.equal(b.items[0].kind, 'concorso'); assert.equal(b.items[0].example, true); assert.equal(b.unread, 1);
  assert.equal((await s.api('POST', '/api/bulletins', { kind: 'avviso', title: 'Falso avviso', body: 'Testo' })).status, 403);
  const ws = t.ws(s.token); await ws.auth();
  const c = await prof.api('POST', '/api/bulletins', { kind: 'circolare', number: '45', title: 'Uscita didattica al museo', body: 'Gli studenti delle classi terze partecipano all’uscita.', pinned: true });
  assert.equal(c.status, 201);
  await ws.wait((m) => m.type === 'notify' && m.event.type === 'bulletin.updated');
  b = (await s.api('GET', '/api/bulletins')).body; assert.equal(b.unread, 2);
  assert.equal((await s.api('POST', `/api/bulletins/${c.body.bulletin.id}/read`)).body.unread, 1);
  assert.equal((await s.api('GET', '/api/bulletins?q=museo')).body.items.length, 1);
  // aggiornare il concorso toglie l'etichetta "da completare" e lo rende di nuovo da leggere
  const contest = b.items.find((x) => x.kind === 'concorso');
  await s.api('POST', `/api/bulletins/${contest.id}/read`);
  const u = await prof.api('PATCH', `/api/bulletins/${contest.id}`, { body: 'Regolamento: consegna entro maggio.' });
  assert.equal(u.body.bulletin.example, false);
  assert.equal((await s.api('GET', '/api/bulletins')).body.items.find((x) => x.id === contest.id).read, false);
  assert.equal((await s.api('POST', '/api/bulletins/read-all')).body.unread, 0);
  await ws.close(); await t.close();
});

test('feed della sessione: eventi del gruppo in parole, solo ai partecipanti', async () => {
  const t = await boot(); const { elia, marco, project } = await mulinoScenario(t);
  await elia.api('POST', `/api/projects/${project.id}/tasks`, { title: 'Montare il rotore' });
  await marco.api('POST', `/api/projects/${project.id}/snippets`, { kind: 'nota', title: 'Promemoria', content: 'Controllare le viti.' });
  const f = (await marco.api('GET', '/api/feed')).body.items;
  assert.ok(f.some((x) => /Elia ha aggiunto un’attività: “Montare il rotore”/.test(x.text)));
  assert.ok(f.some((x) => x.text.startsWith('Tu ha') || /Tu ha aggiunto un asset/.test(x.text)));
  const out = await t.user('Fuori');
  assert.equal((await out.api('GET', '/api/feed')).body.items.length, 0);
  assert.equal((await out.api('GET', `/api/feed?projectId=${project.id}`)).status, 404);
  await t.close();
});

test('Live Code Runner: spento di default; acceso esegue Python con limiti', async () => {
  const t = await boot(); const u = await t.user('Ciro');
  assert.equal((await u.api('GET', '/api/tools/runner')).body.enabled, false);
  assert.equal((await u.api('POST', '/api/tools/run', { language: 'python', code: 'print(1)' })).status, 403);
  await t.close();
  const t2 = await boot({ env: { CODE_RUNNER_ENABLED: 'true', CODE_RUNNER_TIMEOUT_MS: '1500' } }); const v = await t2.user('Dora');
  const info = (await v.api('GET', '/api/tools/runner')).body;
  if (info.languages.python.available) {
    let r = await v.api('POST', '/api/tools/run', { language: 'python', code: 'x = input()\nprint(int(x) * 2)', stdin: '21' });
    assert.equal(r.status, 200); assert.equal(r.body.stdout.trim(), '42');
    r = await v.api('POST', '/api/tools/run', { language: 'python', code: 'while True: pass' });
    assert.equal(r.body.timedOut, true);
  }
  assert.equal((await v.api('POST', '/api/tools/run', { language: 'bash', code: 'ls' })).status, 400);
  await t2.close();
});
