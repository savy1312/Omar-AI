'use strict';
// DEMO "Elia + compagno": mostra l'intero flusso collaborativo con DATI DI ESEMPIO, in una cartella separata (./data-demo).
//  - Gli account, il gruppo e i contenuti sono marcati "demo/ESEMPIO" e NON si mescolano con i dati reali (./data).
//  - Il tutor usa il provider "demo": risposte SIMULATE (regole fisse), mai presentate come output di un modello IA.
//  - Il recupero del contesto, i permessi, le decisioni, la Scatola Nera e il ricalcolo guidato sono invece il codice REALE dell'applicazione.
// Uso:  npm run demo            (esegue il copione, poi lascia il server acceso su http://localhost:3100)
//       npm run demo -- --no-serve   (esegue il copione ed esce)
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createProvider } = require('../src/ai');

const DIR = path.resolve(__dirname, '..', 'data-demo');
const PORT = Number(process.env.DEMO_PORT || 3100);
const NO_SERVE = process.argv.includes('--no-serve');
const PW = { elia: 'demo-elia-2026', marco: 'demo-marco-2026' };

fs.rmSync(DIR, { recursive: true, force: true }); // ricrea sempre da zero: solo dati di esempio

const base = createProvider({ provider: 'demo' });
const seen = { lastTutorSystem: '', lastTutorUser: '' };
const provider = { ...base, async complete(args) { if (args.task === 'tutor') { seen.lastTutorSystem = args.system; seen.lastTutorUser = args.messages.at(-1).content; } return base.complete(args); } };

const { server, ctx, close } = createApp({ config: { skipEnvFile: true, dataDir: DIR, env: { AI_PROVIDER: 'demo', HOST: '127.0.0.1', PORT: String(PORT) } }, provider, logLevel: 'silent' });
const say = (t) => console.log(t);
const step = (n, t) => say(`\n\x1b[1m${n}. ${t}\x1b[0m`);
const note = (t) => say(`   ${t}`);

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${PORT}`;
  const mk = (username, displayName) => {
    ctx.auth.createUser({ username, displayName, password: PW[username], role: 'student', isDemo: true });
    const { token } = ctx.auth.login(username, PW[username]);
    return async (method, p, body) => {
      const res = await fetch(url + p, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${json?.error?.message || ''}`);
      return json;
    };
  };
  say('\n=== DEMO ASSISTENTE OMAR — DATI DI ESEMPIO, TUTOR IN SIMULAZIONE ===');
  say('Account, gruppo e testi qui sotto sono inventati per la dimostrazione. Le risposte del tutor NON sono generate da un modello IA.');
  const elia = mk('elia', 'Elia (demo)'); const marco = mk('marco', 'Marco (demo)');

  step(1, 'Elia crea il gruppo "Mulino a vento (ESEMPIO)" e genera un codice d\'invito');
  const { project } = await elia('POST', '/api/projects', { name: 'Mulino a vento (ESEMPIO)', subjectId: 'meccanica', requiresApproval: false, workstream: 'motore' });
  ctx.db.run('UPDATE projects SET is_demo = 1 WHERE id = ?', project.id);
  const inv = await elia('POST', `/api/projects/${project.id}/invites`, { ttlMin: 60 });
  note(`Codice: ${inv.code}  (scade ${inv.expiresAt}; sul server resta solo l'impronta del codice)`);

  step(2, 'Marco (struttura del mulino) si collega con il codice dal suo dispositivo');
  const j = await marco('POST', '/api/projects/join', { code: inv.code, workstream: 'struttura del mulino' });
  note(`Esito: ${j.message} — le chat dei due restano separate.`);
  note(`Partecipanti: ${(await elia('GET', `/api/projects/${project.id}`)).members.map((m) => `${m.displayName} (${m.workstream})`).join(' · ')}`);

  step(3, 'Marco condivide un allegato col gruppo: compare subito per Elia, con lo stato di elaborazione');
  const fd = new FormData(); fd.append('visibility', 'gruppo'); fd.append('projectId', project.id);
  fd.append('file', new Blob(['SCHEDA STRUTTURA (ESEMPIO). Il castello è a quattro montanti in alluminio, altezza 600 mm. Interasse dei supporti del motore: 120 mm. Carico stimato sul supporto: 40 N.'], { type: 'text/plain' }), 'scheda_struttura_ESEMPIO.txt');
  const token = (await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'marco', password: PW.marco }) }).then((r) => r.json())).token;
  const up = await fetch(url + '/api/materials', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }).then((r) => r.json());
  note(`Stato dopo il caricamento: "${up.material.statusLabel}"`);
  await ctx.waitIdle();
  note(`Elia vede: ${(await elia('GET', `/api/materials?scope=gruppo&projectId=${project.id}`)).materials.map((m) => `${m.name} → ${m.statusLabel}`).join('; ')}`);

  step(4, 'Marco scrive al tutor nella SUA chat e sceglie di condividere solo un messaggio');
  const sm = (await marco('POST', '/api/sessions', { subjectId: 'meccanica', topicId: 'statica', mode: 'esercizio', projectId: project.id })).session;
  await marco('POST', `/api/sessions/${sm.id}/messages`, { text: 'Non sono sicuro di niente (messaggio PRIVATO che non verrà condiviso).' });
  await marco('POST', `/api/sessions/${sm.id}/messages`, { text: 'Propongo un castello a quattro montanti in alluminio, altezza 600 mm, con supporti a interasse 120 mm.' });
  const msgs = (await marco('GET', `/api/sessions/${sm.id}`)).messages.filter((m) => m.role === 'user');
  await marco('POST', `/api/sessions/${sm.id}/messages/${msgs[1].id}/share`, { projectId: project.id });
  note('Condiviso: solo il secondo messaggio. Il primo (privato) resta nella chat di Marco.');

  step(5, 'Elia, nella sua chat: "Prendi l\'idea di come costruire il mulino dalla chat del mio compagno" (Cross-Chat Sync)');
  const se = (await elia('POST', '/api/sessions', { subjectId: 'meccanica', topicId: 'statica', mode: 'esercizio', projectId: project.id })).session;
  const r = await elia('POST', `/api/sessions/${se.id}/messages`, { text: 'Prendi l\'idea di come costruire il mulino dalla chat del mio compagno e adattiamo i supporti del motore.' });
  note('Contesto di progetto arrivato al modello (solo dati autorizzati, con fonte e versione):');
  say(seen.lastTutorUser.split('\n').filter((l) => /^\[C|^\[D|^\[P|^«|<contesto_progetto>|^Progetto:/.test(l)).map((l) => '     ' + l.slice(0, 200)).join('\n'));
  note(`Avvisi mostrati a Elia: ${r.assistantMessage.notices.map((n) => n.text).join(' | ')}`);
  note(`Il messaggio privato di Marco NON è presente nel contesto: ${!/Non sono sicuro di niente/.test(seen.lastTutorUser) && !/PRIVATO/.test(seen.lastTutorUser) ? 'verificato' : 'ERRORE'}`);
  note(`(Risposta del tutor: SIMULATA — "${r.assistantMessage.content.split('\n').find((l) => l.trim() && !l.includes('SIMULAZIONE'))?.slice(0, 120)}")`);

  step(6, 'Decisioni: una proposta non è una decisione finché un altro partecipante non la conferma');
  const d = (await elia('POST', `/api/projects/${project.id}/decisions`, { title: 'Alimentazione del LED a 12 V', body: 'Proposta di Elia' })).decision;
  note(`Stato iniziale: ${d.status}`);
  const c = (await marco('POST', `/api/projects/${project.id}/decisions/${d.id}/confirm`, {})).decision;
  note(`Dopo la conferma di Marco: ${c.status} (proposta da ${c.proposedBy.displayName}, confermata da ${c.confirmedBy.displayName})`);

  step(7, 'Dati dichiarati: la Scatola Nera confronta i valori e segnala un conflitto verificabile');
  await elia('POST', `/api/projects/${project.id}/parameters`, { component: 'motore', name: 'coppia', quantity: 'coppia', value: 12, unit: 'N·m', linkedTo: 'supporti' });
  await marco('POST', `/api/projects/${project.id}/parameters`, { component: 'supporti', name: 'interasse', quantity: 'lunghezza', value: 120, unit: 'mm', linkedTo: 'motore' });
  await marco('POST', `/api/projects/${project.id}/parameters`, { component: 'supporti', name: 'carico', quantity: 'forza', value: 40, unit: 'N' });
  const al = (await elia('GET', `/api/projects/${project.id}/alerts?status=attivi`)).alerts.find((a) => a.ruleId === 'R5_CARICO');
  note(`[${al.levelLabel}] ${al.title}`); note(`Motivo: ${al.reason}`); note(`Domanda guida: ${al.guidingQuestion}`);
  note(al.disclaimer);

  step(8, 'Ricalcolo guidato: indizi progressivi; il risultato atteso non viene mai rivelato dal sistema');
  let ck = (await elia('POST', `/api/projects/${project.id}/alerts/${al.id}/guide`, {})).check;
  const ans = async (t) => { const x = (await elia('POST', `/api/projects/${project.id}/checks/${ck.id}/answer`, { text: t })).check; ck = x; return x; };
  let x = await ans('ok'); note(`Elia: "ok" → ${x.stepKey}`);
  x = await ans('non so'); note(`Elia: "non so" → ${x.feedback} Indizio ${x.hintLevel}: ${x.hint}`);
  x = await ans('F = T / r'); note(`Elia: "F = T / r" → ${x.feedback || 'avanti'} (passo: ${x.stepKey})`);
  x = await ans('100'); note(`Elia: "100" → ${x.feedback}`);
  x = await ans('F = 12 / 0,12 = 100 N'); note(`Elia calcola da sola: "F = 12 / 0,12 = 100 N" → ${x.feedback}`);
  x = await ans('Il carico dichiarato è 40 N ma la forza ricalcolata è 100 N: non è coerente, va rivisto con un margine di sicurezza.');
  note(`Esito: ${x.comparison}`); note(x.disclaimer);

  step(9, 'Briefing per un nuovo partecipante (dai soli dati condivisi e confermati; le voci estratte sono "provvisorie")');
  const b = await elia('GET', `/api/projects/${project.id}/briefing?markSeen=0`);
  say(b.markdown.split('\n').map((l) => '     ' + l).join('\n'));

  say('\n=== FINE DEMO ===');
  say('Tutti i dati di questa dimostrazione sono di ESEMPIO e stanno in ./data-demo (separati da ./data).');
  if (NO_SERVE) { await close(); return; }
  say(`\nPuoi esplorare il risultato nel browser: http://localhost:${PORT}`);
  say(`  Elia:  utente "elia"  password "${PW.elia}"\n  Marco: utente "marco" password "${PW.marco}"  (usa due finestre, una in navigazione privata)`);
  say('Premi Ctrl+C per fermare la demo.\n');
  process.on('SIGINT', () => close().then(() => process.exit(0)));
}
main().catch(async (e) => { console.error('Demo interrotta:', e.message); await close().catch(() => {}); process.exit(1); });
