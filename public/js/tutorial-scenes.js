// Video tutorial — il copione, diviso in CAPITOLI che scorrono uno dopo l'altro come un unico video.
// Ogni capitolo pilota il palcoscenico (cursore, scrittura, finestre) e racconta con calma, passo per passo, cosa succede.
// I testi dell'interfaccia riprodotta sono quelli veri dell'app; persone, dati e fonti (Elia, Marco, «Mulino a vento»,
// Dispense_Meccanica.pdf…) sono DI ESEMPIO e il video lo dichiara.
import { h, fmtDate } from './dom.js';
import { icon } from './icons.js';
import { historyPanel, materialsPage, transferBody, kanbanPage, assetsPage, reportPage, plannerPage, bulletinPage, quickTools, accountPage } from './tutorial-pages.js';

const Q = 'Come trovo la tensione tangenziale su un perno che trasmette 2 kN?';
const A = 'Partiamo da ciò che già sai: quando una forza tende a far **scorrere** una sezione del perno rispetto all’altra, la sollecitazione si chiama **taglio** [M1].\n\n'
  + 'Prova a rispondere a due domande:\n- Oltre alla forza $F$, quale altra grandezza ti serve per ottenere una tensione?\n- Se il perno ha diametro $d$, quanto vale l’area della sezione che resiste?\n\n'
  + 'Scrivimi la relazione che immagini per $\\tau$ e la verifichiamo insieme.';
const SRC_CHIP = '[M1] Dispense_Meccanica.pdf p.12 v1';
const A2 = 'Marco ha condiviso che per il motore ha scelto **750 W a 3000 giri/min** [C1].\n\nCon questo dato, quale coppia ti aspetti all’albero? Ricorda come sono legate potenza, coppia e velocità angolare.';

// una «battuta»: mostra la didascalia, esegue l'azione e lascia comunque il tempo di leggerla con calma
async function step(k, text, action = null, extra = 0) {
  k.say(text); const t0 = k.elapsed();
  if (action) await action();
  await k.hold(Math.max(700, k.readMs(text) - (k.elapsed() - t0)) + extra);
}
async function streamText(k, live, text) {
  for (const w of text.match(/\S+\s*/g) || []) { live.event('delta', { text: w }); await k.wait(w.includes('\n') ? 210 : 85); }
}
const field = (label, input) => [h('label', { text: label }), input];
const input = (ph, extra) => h('input', { type: 'text', placeholder: ph, tabindex: -1, ...extra });
const ISLAND_ITEMS = [['home', 'Nuova chat'], ['history', 'Cronologia'], ['materiali', 'Materiali'], ['projects', 'Hub di progetto'], ['planner', 'Planner'], ['bacheca', 'Bacheca'], ['gruppo', 'Gruppo e dispositivi'], ['explain', 'Spiega o traduci un testo'], ['tools', 'Quick Tools'], ['account', 'Account']];
async function openFromIsland(k, id) { // passa sulla pillola e clicca una voce
  await k.move(k.shape, { dur: 900 }); k.island.hover(true); await k.wait(650);
  await k.move(k.btns[id], { dur: 600 }); await k.click(); k.island.hover(false);
}

// ───────── 1. benvenuto ─────────
async function intro(k) {
  k.home();
  k.card({ logo: true, title: 'Benvenuto in Omar AI', text: 'Il tutor di Meccatronica, Meccanica e Disegno 3D della tua scuola. In questo video ti mostro, con calma e passo per passo, tutto quello che puoi fare. Persone e dati sono di esempio.' });
  await k.narrate('Omar AI ti aiuta a ragionare con domande e indizi: non ti consegna i compiti già svolti. Mettiti comodo: in pochi minuti vediamo insieme ogni funzione dell’app.', 800);
  await k.narrate('Puoi mettere in pausa quando vuoi, tornare al capitolo precedente o cambiare velocità con i comandi qui sotto.');
}

// ───────── 2. la Dynamic Island ─────────
async function island(k) {
  k.home();
  await step(k, 'In alto c’è la Dynamic Island, la barra di navigazione di Omar AI. A riposo è una piccola pillola nera.', () => k.hold(400));
  await step(k, 'Passaci sopra con il mouse: si allarga con un movimento morbido e mostra tutte le sezioni dell’app.', async () => { await k.move(k.shape, { dur: 1200 }); k.island.hover(true); await k.wait(800); });
  k.say('Ecco le voci, da sinistra a destra.');
  for (const [id, text] of ISLAND_ITEMS) {
    const b = k.btns[id]; await k.move(b, { dur: 480 }); b.classList.add('tut-hot'); k.tip(b, text); await k.hold(1050); b.classList.remove('tut-hot');
  }
  k.tip(null);
  await step(k, 'Ognuna la vedremo nei prossimi capitoli. Ora guarda la spia colorata a destra: racconta lo stato dell’intelligenza artificiale.', () => k.move(k.dot, { dur: 900 }));
  await step(k, 'Verde vuol dire che l’IA è attiva e pronta a risponderti.');
  k.island.status('idle'); await step(k, 'Arancione vuol dire «in pausa»: non scrivi da un po’. Basta riprendere a scrivere e torna verde.');
  k.island.status('bad'); await step(k, 'Rossa segnala un problema: la rete, il server della scuola o il modello IA non rispondono. In quel caso avvisa il docente.');
  k.island.status('ok');
  await k.move({ x: k.W * 0.7, y: k.H * 0.6 }, { dur: 900 }); k.island.hover(false);
  await k.hold(700);
}

// ───────── 3. la home e il campo di scrittura ─────────
async function composer(k) {
  const c = k.home({ group: 'Mulino a vento' });
  await step(k, 'Questa è la schermata di partenza: un saluto e il campo bianco dove scrivi.');
  await step(k, 'Non devi scegliere la materia, l’argomento o il livello da nessun menu: Omar capisce da solo, leggendo ciò che scrivi, se parli di Meccanica, Meccatronica o Disegno 3D e che tipo di aiuto ti serve.', () => k.move(c.ta.el, { dur: 1000 }));
  await step(k, 'Il pulsante «+» serve ad allegare: una foto o una schermata, un file (PDF, Word, Excel, PowerPoint, CAD, codice, ZIP), un’intera cartella oppure un link. Puoi anche trascinarli sul campo o incollare un’immagine: Omar li legge e ti risponde su quello che contengono.', async () => { await k.move(c.plusBtn, { dur: 1000 }); await k.click(); c.menu(true); });
  for (const it of c.items) { await k.move(it, { dur: 520 }); await k.hold(650); }
  c.menu(false);
  await step(k, '«Cerca» fa cercare il tutor anche sul web. È spento di default: quando lo accendi diventa grigio e la tua domanda viene inviata a un motore di ricerca esterno.', async () => { await k.move(c.cerca, { dur: 900 }); await k.click(); c.pressCerca(true); });
  c.pressCerca(false);
  await step(k, 'Se sei collegato a un gruppo, questo interruttore lega la nuova chat al progetto comune. Lo vedremo nel capitolo sul lavoro di gruppo.', () => k.move(c.groupBtn, { dur: 900 }));
  await step(k, 'Il microfono è Omar Voice: premilo e detta la domanda a voce, il testo compare nel campo. Poi controlli e invii tu.', async () => { await k.move(c.mic, { dur: 900 }); await k.click(); c.listen(true); c.focus(true); await k.hold(600); await k.type((s) => c.ta.set(s), 'Come si calcola la coppia di un motore?', { cps: 11 }); });
  c.listen(false);
  await step(k, 'La freccia nera invia. Mentre il tutor risponde diventa un quadrato: premendolo interrompi la risposta.', () => k.move(c.send, { dur: 900 }));
  c.ta.set(''); c.focus(false);
}

// ───────── 4. fai una domanda ─────────
async function ask(k) {
  const c = k.home();
  await step(k, 'Proviamo con una domanda vera. Scrivila con parole tue; se hai già provato qualcosa, raccontalo: il tutor parte da lì.', async () => { await k.move(c.ta.el, { dur: 900 }); await k.click(); c.focus(true); await k.type((s) => c.ta.set(s), Q, { cps: 14 }); });
  await k.move(c.send, { dur: 800 }); await k.click();
  const ch = k.chat({ title: 'Omar AI', mode: null });
  ch.addUser(Q);
  k.island.status('ok', true);
  const lr = ch.live();
  await step(k, 'Prima di rispondere Omar riconosce di cosa si tratta. Guarda in alto: «Meccanica · Resistenza dei materiali · Guida all’esercizio».', async () => { await k.hold(1200); ch.detect({ title: 'Meccanica', topic: 'Resistenza dei materiali', mode: 'Guida all’esercizio' }); await k.move(ch.det, { dur: 1000 }); });
  await step(k, 'Nel dubbio tra spiegare la teoria e guidarti in un esercizio sceglie sempre la guida, così non ti dà mai la soluzione già pronta. Con il punto di domanda vedi perché ha capito così.', () => k.move(ch.det.querySelector('.cd-i'), { dur: 900 }));
  k.say('Ora il tutor ci pensa (i puntini e la spia che pulsa) e poi scrive la risposta in diretta, parola dopo parola.');
  await k.move({ x: k.W * 0.62, y: k.H * 0.5 }, { dur: 900 });
  await streamText(k, lr, A); await lr.finish();
  const m = ch.settle(lr, A, { chips: [SRC_CHIP] });
  k.island.status('ok', false);
  await k.hold(1200);
  await step(k, 'Vedi? Niente risultato già fatto: ti fa due domande per farti arrivare alla formula da solo. Quando rispondi, controlla il tuo ragionamento e ti dà indizi sempre più precisi se sei bloccato.');
  await step(k, 'Il numero tra parentesi quadre, [M1], è la fonte: cliccalo e vedi da quale materiale arriva l’informazione, con versione e pagina.', async () => { await k.move(m.querySelector('.cite'), { dur: 1100 }); await k.click(); });
  const body = h('div', null, [h('p', null, h('strong', { text: '[M1] Dispense_Meccanica.pdf' })), h('p', { text: 'Versione 1 · pagina 12' }), h('p', { class: 'small muted', text: 'Passaggio recuperato dai materiali caricati. Il tutor non conosce altre fonti: se una norma non è nei materiali, te lo dice.' })]);
  const d = k.dialog('Fonte', body, [{ label: 'Chiudi' }]);
  await k.hold(3600); await k.move(d.btn('Chiudi'), { dur: 700 }); await k.click(); d.close();
  await step(k, 'L’altoparlante accanto alla risposta è ancora Omar Voice: te la legge ad alta voce. Nell’Account puoi farle leggere tutte in automatico.', () => k.move(m.querySelector('.speak'), { dur: 900 }));
  await step(k, 'Sotto ci sono tre aiuti rapidi: «Dammi un indizio», «Spiegalo più semplicemente» e «Fammi una domanda di verifica».', () => k.move(ch.quick, { dur: 1000 }));
  await step(k, 'Ricorda: Omar AI può sbagliare. Controlla sempre unità di misura, risultati e fonti.');
}

// ───────── 5. una parola che non capisci ─────────
async function explain(k) {
  const ch = k.chat({ title: 'Meccanica', topic: 'Resistenza dei materiali' });
  ch.addUser(Q);
  const am = ch.assistant(A, { chips: [SRC_CHIP] });
  const w = [...am.querySelectorAll('strong')].find((s) => s.textContent === 'taglio');
  await step(k, 'Se in una risposta c’è una parola che non capisci, selezionala con il mouse.', async () => { await k.move(w, { dur: 1200 }); await k.click(); await k.wait(120); await k.click(); w.classList.add('tut-sel'); });
  const chip = k.selChip(w);
  await step(k, 'Accanto alla selezione compaiono due pulsanti: «Spiega» e «Traduci» (in inglese, spagnolo, rumeno, arabo, cinese e altre lingue).');
  chip.remove();
  await step(k, 'Oppure trascina la parola sulla pillola in alto: la Dynamic Island si apre per accoglierla.', async () => {
    k.press(true); const g = k.ghost('taglio'); await k.wait(250); k.island.state('drop');
    await k.move({ x: k.W / 2, y: 70 }, { dur: 1300 }); k.island.hot(true); await k.hold(900);
    k.press(false); g.remove(); k.island.hot(false); w.classList.remove('tut-sel');
  });
  k.island.showPanel('explain', k.panels.explain({ text: 'taglio', loading: true }), 'explain');
  await k.hold(1500);
  k.island.showPanel('explain', k.panels.explain({ text: 'taglio', result: 'Il **taglio** è lo sforzo che nasce quando due parti di un corpo vengono spinte in versi opposti lungo una sezione, come succede con le lame di una forbice.' }), 'explain');
  await step(k, 'Omar spiega la parola con un esempio semplice. Se non basta, chiedi «Spiegalo più semplice». La spiegazione non viene salvata nella cronologia.', null, 1200);
  k.island.closePanel(); await k.hold(500);
}

// ───────── 6. la cronologia ─────────
async function history(k) {
  k.home();
  await step(k, 'Tutte le tue conversazioni restano nella Cronologia. Si apre dalla pillola, con l’orologio.', () => openFromIsland(k, 'history'));
  const p = historyPanel(); k.island.showPanel('history', p.nodes, 'history');
  await step(k, 'Le chat sono raggruppate per giorno: Oggi, Ieri, Ultimi 7 giorni… Il colore indica la materia riconosciuta e l’icona il tipo di aiuto.', () => k.move(p.list, { dur: 1000, ay: 0.3 }));
  await step(k, 'Puoi cercare una vecchia chat, filtrarle per materia, rinominarle o eliminarle. Con «Vedi tutto» si apre la pagina completa, con l’anteprima dell’ultima risposta.', () => k.move(p.chips, { dur: 900 }));
  await step(k, 'Le chat sono personali: il docente non le legge. Le più vecchie vengono cancellate automaticamente dopo un certo periodo.');
  k.island.closePanel(); await k.hold(400);
}

// ───────── 7. materiali: cartelle e invio ai compagni ─────────
async function materials(k) {
  k.home(); await openFromIsland(k, 'materiali');
  let pg = materialsPage(); k.sheet(pg.el);
  await step(k, 'In Materiali trovi i file del corso caricati dai docenti, quelli condivisi con il gruppo e i tuoi file personali.');
  await step(k, 'I file si organizzano in cartelle, come sul computer: qui la cartella «Motore» con due file. Il tutor legge PDF, testi e codice e li usa per risponderti citando la fonte.', () => k.move(pg.fold, { dur: 1000, ay: 0.15 }));
  await step(k, 'Se sei collegato a un compagno, puoi inviargli un file o un’intera cartella direttamente sul suo dispositivo.', async () => { await k.move(pg.sendFolder, { dur: 1000 }); await k.click(); });
  const d = k.dialog('Invia la cartella a un compagno', transferBody(), [{ label: 'Annulla' }, { label: 'Invia', primary: true }]);
  await step(k, 'Scegli a chi mandarla, aggiungi un messaggio se vuoi, e invia.', null, 600);
  await k.move(d.btn('Invia'), { dur: 900 }); await k.click(); d.close();
  const t = k.toast('Inviato a Marco: 2 file in attesa di conferma.');
  await step(k, 'Il compagno non riceve niente in automatico: gli arriva un’offerta con i nomi e le dimensioni dei file, e decide lui se accettarla.', null, 400);
  t.remove();
  pg = materialsPage({ incoming: true }); k.sheet(pg.el);
  await step(k, 'Ecco cosa vede il compagno nella sua pagina Materiali: «Marco ti invia la cartella “Telaio”». Se accetta, riceve una copia tra i suoi file personali; i file di chi li ha inviati restano suoi.', () => k.move(pg.card, { dur: 1000, ay: 0.2 }));
  await k.move(pg.card.querySelector('.tut-accept'), { dur: 900 }); await k.click();
  const t2 = k.toast('Ricevuti 2 file nei tuoi materiali personali.');
  await step(k, 'Le offerte non accettate scadono dopo una settimana, e chi esce dal gruppo non può più riceverne.');
  t2.remove();
}

// ───────── 8. collega un dispositivo ─────────
async function link(k) {
  k.home();
  await step(k, 'Per lavorare a un progetto con i compagni, apri «Gruppo e dispositivi» nella pillola.', () => openFromIsland(k, 'gruppo'));
  k.island.showPanel('group', k.panels.group(false), 'gruppo');
  await step(k, 'Scegli «Collega un dispositivo».', async () => { await k.move(k.shape.querySelector('.btn.primary'), { dur: 900 }); await k.click(); });
  const code = input('ABCD-EFGH', { style: 'text-transform:uppercase;letter-spacing:.1em' });
  const ws = input('es. struttura del mulino');
  const connect = h('div', { class: 'btn primary', style: 'margin-top:.7rem', text: 'Collegati' });
  const body = h('div', null, [h('p', { class: 'small muted', text: 'Collegarsi non condivide nulla: le tue chat restano personali. Condividi tu, di volta in volta, ciò che vuoi.' }),
    h('h3', { text: 'Ho un codice di invito' }), field('Codice', code), field('Di cosa ti occupi nel progetto? (facoltativo)', ws), connect,
    h('hr'), h('h3', { text: 'Oppure crea una sessione di gruppo' }), field('Nome del progetto', input('es. Mulino a vento')), h('div', { class: 'btn', style: 'margin-top:.7rem', text: 'Crea la sessione di gruppo' })]);
  const d = k.dialog('Collega un dispositivo', body, [{ label: 'Chiudi' }]);
  await step(k, 'Chi crea il gruppo genera un codice di invito: scade da solo e vale per un numero limitato di persone. Tu lo inserisci qui.', async () => { await k.move(code, { dur: 900 }); await k.click(); await k.type((s) => { code.value = s; }, 'K7QM-92XD', { cps: 8 }); });
  await step(k, 'Puoi anche scrivere di quale parte del progetto ti occupi: aiuta Omar a proporre chi fa cosa.', async () => { await k.move(ws, { dur: 700 }); await k.click(); await k.type((s) => { ws.value = s; }, 'struttura', { cps: 10 }); });
  await k.move(connect, { dur: 800 }); await k.click(); d.close();
  const t = k.toast('Sei nel gruppo “Mulino a vento”.');
  k.island.groupDot(true); k.island.showPanel('group', k.panels.group(true), 'gruppo');
  await step(k, 'Fatto: sei nel gruppo e vedi chi è online. Collegarsi non condivide nulla: le tue chat restano personali finché non decidi tu di condividere.', null, 400);
  t.remove(); k.island.closePanel();
}

// ───────── 9. Cross-Chat Sync ─────────
async function sync(k) {
  const d = k.devices(); k.island.hide(true);
  const mc = k.chat({ title: 'Meccatronica', topic: 'Sensori e attuatori', project: true, host: d.marco.body });
  const ec = k.chat({ title: 'Omar AI', mode: null, project: true, host: d.elia.body, intro: true });
  const um = mc.addUser('Per il motore ho scelto 750 W a 3000 giri/min.', { share: true });
  mc.assistant('Perfetto, hai già due dati chiari: potenza e regime. Ora pensa ai supporti dell’albero: che forza dovranno sopportare?');
  await step(k, 'Cross-Chat Sync: ogni studente ha la sua chat, che resta personale. A sinistra c’è Marco, sul suo dispositivo, che lavora al motore. A destra ci sei tu, Elia.', null, 800);
  await step(k, 'Marco decide di condividere un messaggio con il gruppo. Lo sceglie lui, messaggio per messaggio.', async () => { await k.move(um.querySelector('.meta .btn'), { dur: 1200 }); await k.click(); });
  const ask = h('div', null, [h('p', null, 'Stai per condividere con il gruppo ', h('strong', { text: '“Mulino a vento”' }), ' questo messaggio:'), h('blockquote', { text: 'Per il motore ho scelto 750 W a 3000 giri/min.' }),
    h('p', { class: 'small muted', text: 'Verranno condivisi solo queste parole (email e numeri di telefono vengono tolti). Il resto della chat resta privato. Potrai ritirare il contributo quando vuoi.' })]);
  const dlg = k.dialog('Condividere con il gruppo?', ask, [{ label: 'Annulla' }, { label: 'Condividi', primary: true }], d.marco.body);
  await k.hold(3600); await k.move(dlg.btn('Condividi'), { dur: 900 }); await k.click(); dlg.close();
  const t1 = k.toast('Condiviso con il gruppo.', d.marco.toastHost);
  await k.wait(500); await k.fly(um, k.isPortrait ? d.hub : d.elia.body, { dur: 1500 }); t1.remove();
  d.focus('elia');
  const t2 = k.toast('Marco ha condiviso un contributo', d.elia.toastHost);
  await step(k, 'Il contributo arriva al gruppo con il nome di chi l’ha scritto, e tutti ricevono un avviso. Il resto della chat di Marco resta privato.', null, 300);
  t2.remove();
  const q = 'Quanta potenza ha scelto Marco per il motore?'; const c = ec.composer;
  await step(k, 'Ora tu, Elia, chiedi al tutor del lavoro di Marco.', async () => { await k.move(c.ta.el, { dur: 1100 }); await k.click(); c.focus(true); await k.type((s) => c.ta.set(s), q, { cps: 14 }); });
  await k.move(c.send, { dur: 700 }); await k.click(); c.ta.set(''); c.focus(false);
  ec.addUser(q); const lr = ec.live(); ec.detect({ title: 'Meccatronica', topic: 'Sensori e attuatori', mode: 'Guida all’esercizio' });
  await k.hold(1800); await streamText(k, lr, A2); await lr.finish();
  ec.settle(lr, A2, { chips: ['[C1] contributo · Marco · v1'], notice: 'Contesto condiviso usato da: Marco.' });
  await step(k, 'Il tutor risponde citando il contributo condiviso, [C1], con autore e versione. Non ha letto la chat di Marco: usa solo ciò che lui ha scelto di condividere.', null, 600);
  await step(k, 'Se un compagno non ha condiviso nulla, Omar te lo dice e ti propone di chiederglielo. La sua chat personale non si può leggere.');
}

// ───────── 10. Eco di Gruppo e Scatola Nera ─────────
function groupPage() {
  const TABS = ['Panoramica', 'Briefing', 'Scatola Nera', 'Diario (Eco di Gruppo)', 'Decisioni', 'Parametri', 'Contributi condivisi'];
  const links = Object.fromEntries(TABS.map((t) => [t, h('a', { text: t })]));
  const body = h('div');
  const el = h('div', { class: 'page' }, [h('h1', { text: 'Gruppo: Mulino a vento' }), h('nav', { class: 'tabs' }, Object.values(links)), body]);
  const show = (tab, ...nodes) => { for (const [t, a] of Object.entries(links)) { if (t === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); } body.replaceChildren(...nodes.flat().filter(Boolean)); };
  const people = [['Marco', 'motore', 'creatore', true], ['Elia', 'struttura', 'partecipante', true], ['Luca', 'area non indicata', 'partecipante', false]];
  show('Panoramica', h('div', { class: 'card' }, [h('h2', { text: 'Partecipanti' }), h('ul', null, people.map(([n, w, r, on]) => h('li', null, h('span', { class: `dot ${on ? 'on' : ''}` }), ' ', h('strong', { text: n }), ` — ${w} `, h('span', { class: 'small muted', text: `(${r}, ${on ? 'online' : 'offline'})` }))))]));
  const diary = (confirmed) => [
    h('p', { class: 'muted', text: 'Il diario raccoglie ipotesi, scelte, problemi e modifiche. Ogni voce dice chi l’ha scritta e come è nata. Le voci estratte automaticamente restano “da verificare” finché un compagno non le conferma.' }),
    h('div', { class: `item ${confirmed ? '' : 'prov'}` }, [
      h('div', { class: 'row' }, h('strong', { text: 'Motore: 750 W a 3000 giri/min' }), h('span', { class: 'badge', text: 'Componente scelto' }), h('span', { class: `badge ${confirmed ? 'ok' : 'warn'}`, text: confirmed ? 'confermato' : 'provvisorio' }), h('span', { class: 'badge', text: 'estratta automaticamente con regole semplici (da verificare)' })),
      h('div', { class: 'small muted', text: `Marco · v1 · ${fmtDate(new Date().toISOString())}` }),
      h('div', { class: 'row', style: 'margin-top:.4rem' }, [!confirmed && h('div', { class: 'btn sm', 'data-act': 'confirm', text: 'Conferma' }), h('div', { class: 'btn sm', text: 'Correggi' }), h('div', { class: 'btn sm', text: 'Contesta' }), h('div', { class: 'btn sm ghost', text: 'Storico' })])])];
  const blackbox = () => [
    h('p', { class: 'notice', text: 'La Scatola Nera confronta i dati dichiarati dal gruppo (unità, diametri, tensioni, ipotesi di carico). Un avviso “verificato” viene da una regola precisa; uno “possibile” è un’ipotesi da controllare. Non certifica la sicurezza di niente.' }),
    h('h2', { text: 'Da controllare (1)', style: 'margin-top:1rem' }),
    h('article', { class: 'item alert-high' }, [
      h('div', { class: 'row' }, h('strong', { text: 'Valori diversi per "Motore › Potenza"' }), h('span', { class: 'badge bad', text: 'Conflitto verificato da una regola' }), h('span', { class: 'badge', text: 'priorità alta' })),
      h('p', { text: 'Sono attivi due valori non equivalenti: 500 W (Elia) e 750 W (Marco).' }),
      h('p', null, h('strong', { text: 'Per ragionarci: ' }), 'Quale dei due valori è quello giusto e perché? Il vecchio valore va marcato come superato?'),
      h('div', { class: 'row' }, [h('div', { class: 'btn sm', text: 'Mostra le fonti' }), h('div', { class: 'btn sm', text: 'Ricalcolo guidato' }), h('div', { class: 'btn sm', text: 'Risolto' })])])];
  return { el, links, body, show, diary, blackbox };
}
async function group(k) {
  const pg = groupPage(); k.sheet(pg.el); k.island.groupDot(true);
  await step(k, 'Ogni gruppo ha una pagina di lavoro: partecipanti, briefing, diario del progetto, decisioni, parametri e la Scatola Nera.');
  await k.move(pg.links['Diario (Eco di Gruppo)'], { dur: 1100 }); await k.click(); pg.show('Diario (Eco di Gruppo)', pg.diary(false));
  await step(k, 'Eco di Gruppo è il diario di bordo: si compone da solo con ciò che il gruppo condivide. Ma le voci estratte in automatico restano «da verificare» finché un compagno non le conferma.', null, 400);
  await k.move(pg.body.querySelector('[data-act=confirm]'), { dur: 900 }); await k.click(); pg.show('Diario (Eco di Gruppo)', pg.diary(true));
  await k.hold(1600);
  await k.move(pg.links['Scatola Nera'], { dur: 1000 }); await k.click(); pg.show('Scatola Nera', pg.blackbox());
  await step(k, 'La Scatola Nera controlla che i dati del gruppo siano coerenti tra loro. Qui ha trovato due potenze diverse per lo stesso motore.', null, 600);
  await step(k, 'Non ti dice quale sia giusta e non certifica la sicurezza di niente: ti fa una domanda per ragionarci e, se serve, ti guida a ricalcolare passo per passo.');
}

// ───────── 11. Hub di progetto ─────────
async function hub(k) {
  k.home(); await openFromIsland(k, 'projects');
  let pg = kanbanPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'L’Hub di progetto è il quartier generale del gruppo. La prima sezione è una bacheca Kanban: attività da fare, in corso e finite.');
  await step(k, 'Il pulsante «Proponi attività dalle chat condivise» chiede a Omar di leggere SOLO ciò che avete scelto di condividere e di trasformarlo in compiti, con un incaricato suggerito.', async () => { await k.move(pg.propose, { dur: 1000 }); await k.click(); });
  await step(k, 'Le proposte compaiono nella prima colonna, tratteggiate. Nessuna parte da sola: si accettano o si scartano.', () => k.move(pg.p1, { dur: 1000, ay: 0.25 }));
  await step(k, 'Accettiamo la prima: passa in «Da fare». Poi le attività si spostano trascinandole da una colonna all’altra.', async () => {
    await k.move(pg.p1.querySelector('.tut-acc'), { dur: 900 }); await k.click();
    pg.p1.remove(); pg.p1.classList.remove('prop'); pg.p1.querySelector('.kb-prop')?.remove(); pg.cols.da_fare.querySelector('.kb-cards').prepend(pg.p1); pg.p1.classList.add('fresh');
  });
  pg = assetsPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'Nella sezione Asset il gruppo raccoglie tutto il materiale comune: file e PDF, pezzi di codice, formule, schemi, note e link.');
  await step(k, 'Con «Raccogli dai contributi condivisi» Omar trova da solo il codice, le formule e i link che i compagni hanno sincronizzato dalle loro chat, con autore e fonte.', () => k.move(pg.harvest, { dur: 1000 }));
  await step(k, 'Il codice non viene mai eseguito dal server: con il pulsante ▶ lo apri nei Quick Tools per provarlo.', () => k.move(pg.code.querySelector('.tut-try'), { dur: 1000 }));
  pg = reportPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'Infine la Relazione tecnica: scegli le sezioni e Omar impagina in un PDF partecipanti, decisioni, parametri, verifiche, attività, asset e diario.', async () => { await k.move(pg.gen, { dur: 1100 }); await k.click(); pg.showPdf(); });
  await step(k, 'Niente viene inventato: le proposte restano segnate come proposte. È un punto di partenza da rileggere con il docente prima della consegna.');
}

// ───────── 12. Planner ─────────
async function planner(k) {
  k.home(); await openFromIsland(k, 'planner');
  const pg = plannerPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'Il Planner è il tuo registro delle scadenze: verifiche, interrogazioni, consegne di laboratorio, compiti e progetti di gruppo.', () => k.move(pg.list, { dur: 1000, ay: 0.2 }));
  await step(k, 'Per ogni scadenza indichi quante ore di lavoro ti servono e, man mano, a che punto sei. Le scadenze di gruppo le vedono tutti i compagni.', () => k.move(pg.add, { dur: 1000 }));
  await step(k, 'A sinistra c’è il suggeritore di studio: calcola quanto tempo ti resta e ti propone le priorità di oggi, in base al tempo che hai detto di avere.', async () => {
    await k.move(pg.ring, { dur: 1000 });
    for (let p = 0; p <= 96; p += 4) { pg.ring.style.setProperty('--p', p); pg.ring.firstChild.textContent = `${Math.round(p * 1.2)} min`; await k.wait(40); }
    pg.ring.firstChild.textContent = '1 h 55′';
  });
  await step(k, 'Prima la verifica di dopodomani, poi un pezzo del progetto. Se il tempo non basta, il Planner te lo dice in anticipo. È un aiuto per organizzarti, non un obbligo.', () => k.move(pg.steps, { dur: 900 }));
}

// ───────── 13. Bacheca ─────────
async function bulletin(k) {
  k.home(); await openFromIsland(k, 'bacheca');
  const pg = bulletinPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'La Bacheca raccoglie le circolari e gli avvisi della Sede di Oleggio, pubblicati dai docenti o importati dal sito della scuola con il link alla fonte.');
  await step(k, 'Qui trovi anche il concorso di design UI/UX per l’app della scuola: regolamento e date li pubblicheranno i docenti proprio in questa voce.', () => k.move(pg.contest, { dur: 1000, ay: 0.25 }));
  await step(k, 'Le novità hanno l’etichetta «nuovo» e un pallino sulla pillola. A destra, in diretta, vedi cosa succede nei tuoi gruppi: file sincronizzati, contributi condivisi, attività spostate.', () => k.move(pg.feed, { dur: 1000 }));
}

// ───────── 14. Quick Tools ─────────
async function tools(k) {
  k.home();
  await step(k, 'I Quick Tools sono una cassetta degli attrezzi sempre a portata di mano: si aprono dalla chiave inglese nella pillola, oppure con Alt+T, da qualsiasi pagina.', () => openFromIsland(k, 'tools'));
  const qt = quickTools(); k.layer.append(qt.el);
  qt.views.conv('6');
  await step(k, 'Il convertitore di unità: bar, MPa, N·m, kW, giri al minuto, millimetri, pollici e molte altre. Un valore, tutte le unità insieme.', () => k.move(qt.body, { dur: 900 }));
  qt.views.calc('', '');
  await step(k, 'La calcolatrice tecnica: radici, potenze, trigonometria in gradi o radianti, costanti come pi greco e g, e alcune formule rapide di meccanica ed elettrotecnica.', async () => {
    const ex = '2*pi*1450/60'; let s = '';
    for (const ch of ex) { s += ch; qt.views.calc(s, ''); await k.wait(110); }
    await k.hold(500); qt.views.calc(ex, '= 151,8436449');
  });
  qt.views.code('');
  await step(k, 'Il Live Code Runner esegue JavaScript direttamente nel browser, isolato e senza internet. Python e C++ funzionano solo se l’amministratore della scuola li ha attivati sul server.', async () => { await k.move(qt.el.querySelector('.tut-run'), { dur: 1000 }); await k.click(); await k.hold(400); qt.views.code('Potenza: 1.82 kW\n— terminato in 2 ms'); });
  await step(k, 'Ci sono anche il convertitore BIN/HEX/DEC, utile per PLC e microcontrollori, e il formattatore di codice e JSON.', () => k.move(qt.tabs[2], { dur: 900 }));
  qt.el.remove();
}

// ───────── 15. Account ─────────
async function account(k) {
  k.home(); await openFromIsland(k, 'account');
  const pg = accountPage(); k.sheet(pg.el, { wide: true });
  await step(k, 'L’Account ha una pagina tutta sua: il tuo profilo, il nome che vedono i compagni e quante chat, file e gruppi hai.');
  await step(k, 'Qui cambi la password: scrivi quella attuale e la nuova due volte. La barra colorata ti dice quanto è robusta.', async () => { await k.move(pg.newPw, { dur: 1000 }); await k.click(); const pw = 'Mulino-a-vento-2026'; let s = ''; for (const ch of pw) { s += ch; pg.typePw(s); await k.wait(140); } pg.okChecks(); });
  await step(k, 'Puoi vedere su quali dispositivi hai fatto l’accesso e disconnetterne uno che non riconosci. Cambiando la password, gli altri dispositivi vengono disconnessi.', () => k.move(pg.el.querySelector('.tut-disc'), { dur: 1000 }));
  await step(k, 'Ci sono anche il tema chiaro o scuro, le preferenze di Omar Voice, la privacy con i tuoi dati e il pulsante per rivedere questo video.');
}

// ───────── 16. tocca a te ─────────
async function outro(k) {
  k.home();
  k.card({ logo: true, title: 'Tocca a te', items: ['Scrivi la tua prima domanda: Omar capisce da solo materia e tipo di aiuto.', 'Non capisci una parola? Trascinala sulla pillola in alto.', 'Collegati ai compagni per Hub, asset, Planner e invio di file.', 'Quick Tools sempre a portata: Alt+T.', 'Le tue chat sono personali. Puoi rivedere questo video dall’Account.'] });
  await k.narrate('Hai visto tutto. Ricorda: Omar AI può sbagliare, quindi controlla sempre unità, risultati e fonti. Quando sei pronto, premi «Ho capito, inizia ad usare l’IA».', 1200);
}

// est = durata indicativa in millisecondi a velocità 1× (serve alla barra del video; misurata sull'animazione reale)
export const SCENES = [
  { id: 'intro', title: 'Benvenuto', est: 20500, run: intro },
  { id: 'island', title: 'La Dynamic Island', est: 61500, run: island },
  { id: 'composer', title: 'La home e il campo di scrittura', est: 72000, run: composer },
  { id: 'ask', title: 'Fai una domanda', est: 111500, run: ask },
  { id: 'explain', title: 'Una parola che non capisci', est: 35500, run: explain },
  { id: 'history', title: 'La cronologia', est: 37500, run: history },
  { id: 'materials', title: 'Materiali, cartelle e invii', est: 71000, run: materials },
  { id: 'link', title: 'Collega un dispositivo', est: 37000, run: link },
  { id: 'sync', title: 'Cross-Chat Sync', est: 89500, run: sync },
  { id: 'group', title: 'Eco di Gruppo e Scatola Nera', est: 51500, run: group },
  { id: 'hub', title: 'Hub di progetto', est: 90500, run: hub },
  { id: 'planner', title: 'Planner', est: 44500, run: planner },
  { id: 'bulletin', title: 'Bacheca', est: 37000, run: bulletin },
  { id: 'tools', title: 'Quick Tools', est: 53500, run: tools },
  { id: 'account', title: 'Account', est: 42000, run: account },
  { id: 'outro', title: 'Tocca a te', est: 13000, run: outro },
];
void icon;
