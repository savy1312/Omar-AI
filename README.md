# Omar AI

Tutor IA socratico per l'istituto tecnico (Meccatronica, Meccanica, Disegno 3D) con lavoro di gruppo:
collegamento dispositivi con codice invito, allegati in tempo reale, Cross-Chat Sync, Eco di Gruppo (diario e briefing)
e Scatola Nera (controlli di coerenza sui parametri di progetto).

> **Stato onesto.** I 77 test automatici passano e verificano i *controlli dell'applicazione* (permessi, sicurezza, flussi),
> con modelli IA simulati dai test. **La qualità didattica con un modello reale NON è stata verificata**: serve la
> valutazione descritta in [docs/VALUTAZIONE_DIDATTICA.md](docs/VALUTAZIONE_DIDATTICA.md). Vedi anche [docs/FASI_E_LIMITI.md](docs/FASI_E_LIMITI.md).

## Installazione come applicazione (icona sul Desktop)

Dal pacchetto scaricato (`omar-ai-1.0.0.zip`), dopo averlo estratto:
- **Windows**: `INSTALLA-WINDOWS.bat` copia Omar in `%LOCALAPPDATA%\Programs\OmarAI` (senza permessi di amministratore) e crea l'icona **«Omar AI»** sul Desktop e nel menu Start. Rilanciato su una versione già installata, la aggiorna lasciando intatti `.env` e `data/`.
- **macOS**: `installa-mac.command` (tasto destro → Apri) installa in `~/Applications/OmarAI` e crea «Omar AI» sul Desktop.
- **Linux**: `./installa-linux.sh` installa in `~/.local/share/omar-ai` e crea la voce nel menu e sul Desktop.

**Solo applicazione, niente web app.** Omar AI si usa esclusivamente dall'icona: a ogni avvio il server crea una chiave segreta (in `data/.launch-key`) e la consegna alla sola finestra dell'app. Senza quella chiave interfaccia, API e WebSocket rispondono «Omar AI si apre dall'applicazione», anche aprendo `localhost:3300` in un browser. La finestra usa un profilo separato (`data/finestra-app`), quindi non condivide cookie né cronologia con il browser normale. Unica eccezione, da decidere con la scuola: il server d'aula in rete locale (`DESKTOP_ONLY=false`, vedi `docs/RETE_LOCALE.md`).

### Versione web (online, con Groq)

Con l'IA su Groq Omar può anche essere pubblicato online e usato dal browser con un link: procedura passo passo in `docs/PUBBLICARE_ONLINE.md` (Render: `render.yaml` con disco per le classi, `render-free.yaml` gratis per una demo; senza carta: Hugging Face Spaces con `Dockerfile`, § 6).

### Gruppi tra computer diversi: il «server della classe»

Ogni computer ha il suo Omar, con i suoi account e i suoi gruppi: **un codice di invito vale solo sul computer dove è stato creato**. Per lavorare in gruppo da computer diversi:
1. Su UN computer della classe (di solito quello del docente): *Account → Server della classe → «Rendi questo computer il server della classe»*, poi si riapre l'icona. Omar mostra **indirizzo** (es. `192.168.1.20:3300`) e **codice d'aula** (es. `ABCD-EFGH-JKMN-PQRS`, stabile, in `data/.aula-key`). Se Windows chiede il permesso del firewall, consentire solo le reti private.
2. Sugli altri computer: *Gruppo → Collega un dispositivo → «Collegati al server della classe»* (oppure da Account), una volta sola. Da quel momento l'icona apre direttamente la classe (`data/classe.json`); ci si registra lì con il codice di registrazione. «Usa Omar solo su questo computer» torna indietro.
3. Sul server della classe gruppi, inviti, approvazioni e notifiche funzionano tra tutti i computer collegati. Anche lì un normale browser non entra: serve l'app con il codice d'aula. Il server della classe deve restare acceso con Omar aperto; l'IA delle domande fatte lì gira sul suo Ollama.

I codici di invito si scrivono senza badare a maiuscole, spazi o trattino; chi gestisce il gruppo li rivede tra i **«Codici attivi»** (salvati cifrati) con *Copia* e *Annulla*. Chi chiede di entrare vede «Richiesta inviata… in attesa» e, all'approvazione, riceve subito un avviso ed entra nel gruppo senza ricaricare.

L'icona lancia `avvia-omar.bat` / `avvia-omar.sh`: si apre la finestra del server (non va chiusa: chiudendola Omar si spegne) e, appena il server risponde, Omar si apre in una finestra **da applicazione** (Edge o Chrome in modalità `--app`, senza barre del browser; se mancano, il browser predefinito). Un secondo doppio clic con Omar già acceso apre solo la finestra. Le istruzioni per chi scarica sono in `LEGGIMI-INSTALLAZIONE.txt`.

## Installazione su Windows (a mano)

1. Installa **Node.js 22.13 o successivo** (LTS) da nodejs.org. Verifica: `node -v`.
2. Apri PowerShell nella cartella del progetto:
   ```powershell
   npm install
   copy .env.example .env
   ```
3. Apri `.env` con il Blocco note e **cambia i due codici di registrazione** (`STUDENT_REGISTRATION_CODE`, `TEACHER_REGISTRATION_CODE`).
4. Avvia con `avvia-omar.bat` (apre la finestra dell'app). Con il solo `npm start` il server parte, ma l'interfaccia si apre solo dalla finestra dell'app: `node scripts/apri-finestra.js`.

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia il server con la configurazione di `.env` |
| `npm run demo` | Demo con dati fittizi (Elia e Marco, "Mulino a vento (ESEMPIO)"), tutor **simulato**, porta 3100, dati in `data-demo/` |
| `npm run seed:admin -- docente1 "Nome Cognome" teacher` | Crea un account docente/amministratore (password richiesta in modo interattivo) |
| `npm test` | 77 test automatici (≈30 s) |
| `npm run setup:ollama` | Collega l'app a Ollama in locale, sceglie il modello e fa una prova reale |
| `npm run eval:live` | Esegue gli 8 scenari didattici contro il provider configurato e salva le risposte per la revisione del docente |

## Scegliere il motore IA (`.env`)

| `AI_PROVIDER` | Dove vanno i testi | Note |
|---|---|---|
| `demo` | Restano sul server | **Simulazione**, non è un modello: risposte a regole fisse, sempre etichettate come simulate |
| `anthropic` | **Escono dalla rete scolastica** verso Anthropic | Richiede `AI_API_KEY` e `AI_MODEL` |
| `openai-compatible` | Dipende dall'endpoint | OpenAI, Mistral, vLLM…; con `AI_BASE_URL` |
| `openai-compatible` + Ollama/LM Studio | Restano sul server della scuola | `AI_BASE_URL=http://localhost:11434/v1`, `AI_MODEL=<modello locale>` |

### Risposte in diretta (streaming)

La chat mostra la risposta **mentre il modello la scrive** (come Gemini): fasi di attesa («Leggo la pagina…», «Cerco sul web…», «Consulto i materiali…»), fonti web già visibili prima del testo, formule e codice che si compongono man mano, cursore che pulsa e pulsante **Stop** che interrompe il modello e salva la parte già scritta.
Funziona con `anthropic`, `openai-compatible` (OpenAI, Ollama, LM Studio…) e con la simulazione `demo`; un provider che non sa fare streaming mostra la risposta tutta insieme. I controlli didattici restano attivi **durante** lo streaming (vedi `docs/FASI_E_LIMITI.md`).

Tre cose diverse da non confondere: la **sincronizzazione in rete locale** (i dispositivi parlano con il server della scuola),
il **provider esterno** (i testi delle chat vanno a terzi) e il **modello locale** (nessun invio all'esterno). La chiave API vive
solo nel server (`.env`, mai nel browser, mai nei log). Per usare i dispositivi della rete scolastica leggi [docs/RETE_LOCALE.md](docs/RETE_LOCALE.md).

## Guida rapida

**Studente.** Registrati con la tua **email scolastica `@itiomar.net`** e il codice dato dal docente → scegli materia e modalità (spiegami / esercizio / verifica / ripasso)
e scrivi. Il tutor guida con domande e suggerimenti progressivi, non consegna soluzioni. "Collega un dispositivo" crea un gruppo
o entra con un codice invito. Ogni allegato e ogni condivisione verso il gruppo richiedono una scelta esplicita
(personale / gruppo). Le chat restano separate: il tutor usa i contributi di un compagno solo se chiedi esplicitamente e li cita con la provenienza.

**Docente.** Account creato con `seed:admin` o con il codice docente. Nell'area Docente: obiettivi, materiali del corso (usati
con citazioni dal tutor) e prova del tutor in sandbox. Gli studenti vedono i materiali del corso, non quelli personali dei compagni.

**Privacy.** Dalla pagina Privacy lo studente vede quale provider è attivo, esporta i propri dati, cancella le chat o l'account.

## Interfaccia

Sfondo: la **foto fornita dalla scuola, usata così com'è** (`public/img/sfondo.png`; per cambiarla basta sostituire quel file, anche con un altro formato se aggiorni `--wall` in `public/css/app.css`), con la scritta «Omar» in basso al centro, saluto centrale e campo di scrittura bianco. Lo sfondo è lo stesso nel tema chiaro e in quello scuro (cambiano i pannelli). **Tutta la navigazione è nella Dynamic Island** in alto:
- è una pillola nera compatta (logo + spia); passandoci sopra si espande con una molla morbida e la segue leggermente (solo mentre il puntatore è sopra di essa); contiene Nuova chat, Cronologia, Materiali, Hub di progetto, Planner, Bacheca, Gruppo e dispositivi, Area docente, Spiega/traduci, Quick Tools e Account;
- la **spia** è verde quando l'IA è attiva, **arancione** dopo 60 s senza che l'utente scriva, **rossa** se manca la rete, il server non risponde o il modello IA dà errore;
- **parola o frase non chiara?** Selezionala e trascinala sulla pillola (oppure usa il pulsante «Spiega / Traduci» che compare accanto alla selezione): la pillola la spiega in italiano semplice o la traduce. Il testo non ### Chat senza menu, fluttuante

- **Niente menu a tendina** per materia, argomento, modalità o livello: il server li riconosce dal messaggio (`src/engine/router.js`, parole chiave nei file `src/subjects/*.json`) e li mostra in alto nella chat, in sola lettura; il «?» spiega perché. È **prudente**: nel dubbio tra spiegare e guidare un esercizio sceglie sempre la guida, quindi non dà soluzioni pronte. Se la materia non si capisce resta «Generale».
- La chat **non ha più il riquadro**: messaggi, intestazione e pulsanti galleggiano sopra la foto, ognuno con il suo vetro scuro (chiaro nel tema chiaro) per restare leggibile.

### Pagine e strumenti

- **Account** (`#/account`, pagina dedicata): nome, cambio password (con verifica della password attuale, misuratore di robustezza, chiusura degli altri dispositivi), dispositivi collegati con «Disconnetti», tema, Omar Voice, privacy, rivedi il video.
- **Cronologia**: per giorno, con ricerca, filtro per materia, rinomina ed elimina (pannello della pillola e pagina `#/cronologia`).
- **Materiali**: cartelle; se sei collegato a un gruppo puoi **inviare file o cartelle** a un compagno: lui riceve un'offerta e solo se accetta ottiene una copia tra i suoi file personali (scade dopo 7 giorni).
- **Hub di progetto** (`#/projects`): Kanban con **proposte di attività** ricavate SOLO dai contributi condivisi, dal diario e dalla Scatola Nera (da accettare a mano); **Asset Manager** (file del gruppo, codice, formule, schemi, note, link; raccolta automatica dai contributi condivisi); **relazione tecnica in PDF**; feed delle attività recenti.
- **Planner** (`#/planner`): scadenze personali, di gruppo o del corso (docenti), avanzamento personale e **suggeritore di studio** (tempo che resta, piano di oggi) con quadro dei compagni.
- **Bacheca** (`#/bulletin-board`, Sede di Oleggio): circolari, avvisi, concorsi ed eventi pubblicati dai docenti, anche **importandoli da una pagina pubblica del sito** (bozza da rivedere); voce del **concorso di design UI/UX** da completare; feed in tempo reale dei gruppi.
- **Quick Tools** (chiave inglese nella pillola o **Alt+T**, da ogni pagina): convertitore di unità, calcolatrice tecnica (senza `eval`) con formule rapide, BIN/HEX/DEC/OCT, **Live Code Runner** (JavaScript nel browser in un worker isolato; Python e C++ solo se `CODE_RUNNER_ENABLED=true`, vedi `.env.example`), formattatore di codice e JSON.
- **Omar Voice**: microfono nel campo di scrittura (dettatura) e altoparlante sulle risposte (lettura ad alta voce, anche automatica dall'Account).

### Video tutorial di primo accesso

La prima volta che un account entra si apre a tutto schermo un **unico video guidato (circa 14 minuti, 16 capitoli)** che spiega con calma, passo per passo e con i sottotitoli, tutte le funzioni: Dynamic Island, campo di scrittura e riconoscimento automatico, domanda e risposta, Spiega/Traduci, cronologia, materiali e invii, collegamento, Cross-Chat Sync, Eco di Gruppo e Scatola Nera, Hub, Planner, Bacheca, Quick Tools, Account.
- È una **simulazione animata disegnata dall'app con dati di esempio**, non un file video, e non fa richieste di rete.
- Comandi come un lettore video: play/pausa, capitolo precedente/successivo, barra del tempo con i capitoli (clic per saltare), velocità 0,75× · 1× · 1,25×, «Salta il video», «Ho capito, inizia ad usare l'IA». Tastiera: Spazio, ← →, Esc.
- Chiuso il video parte l'**animazione d'ingresso in stile «Zoom foto» di Canva** (lo sfondo e l'app partono ingranditi e sfocati e si allontanano fino alla misura reale; poi arriva la pillola). Con «riduci animazioni» non parte.
- Lo stato «già visto» è nel localStorage (`omar.hasSeenTutorial.<id account>`, versione `2`: chi aveva visto il vecchio tutorial vedrà il nuovo video una volta). Si rivede dall'Account.
- Codice: `public/js/tutorial.js` (lettore), `tutorial-stage.js`, `tutorial-scenes.js` (capitoli e testi), `tutorial-pages.js` (pagine di esempio), `tutorial-state.js`, `public/css/tutorial.css`; animazione d'ingresso in `public/css/features.css` (`body.intro-zoom`).

rica solo a chi lo deve vedere.

### Il pulsante «+» e i link

«+» apre un menu con quattro scelte, e ogni volta si decide **chi può vedere l'allegato** (solo io / gruppo):
- **Immagine** (PNG, JPEG, GIF, WebP, BMP; anche incollata con Ctrl+V): con un modello IA «vista» installato Omar la **guarda**: descrive cosa contiene (disegno tecnico, schema, grafico, esercizio scritto a mano, schermata…) e **ne trascrive il testo**; poi risponde su quello. Foto grandi sono rimpicciolite nel browser (lato lungo 2048 px). Senza modello «vista» l'immagine è solo mostrata.
- **File**: Omar legge PDF (anche scansionati, se le pagine sono JPEG e c'è il modello «vista»), Word (.docx, .doc in parte), Excel (.xlsx, .xls in parte), PowerPoint (.pptx con note, .ppt in parte), OpenDocument (.odt/.ods/.odp), RTF, HTML, EPUB, CSV/TSV, testi e codice (Python, C/C++, Java, JS, G-code, Arduino, SQL, JSON, XML, YAML…), SVG, CAD aperti (DXF: testi, quote e layer; STEP/IGES: nome e struttura delle parti; STL/OBJ/3MF: dimensioni d'ingombro, superficie, volume; FreeCAD .FCStd: oggetti e parametri) e archivi **ZIP** (legge i file dentro). I formati proprietari (DWG, SolidWorks, Inventor, Fusion, progetti TIA Portal), audio e video sono **archiviati** con un suggerimento su come esportarli in un formato leggibile. I programmi eseguibili sono rifiutati.
- **Aggiungi una cartella** (o trascinala sul campo di scrittura): fino a 25 file, prima quelli che Omar sa leggere; i file nascosti o di sistema sono ignorati, e quelli esclusi (vuoti, troppo grandi, eseguibili) sono elencati con il motivo.
- Sopra il campo di scrittura la **barra degli allegati** mostra ogni file della chat con miniatura e stato («Omar sta leggendo…», «letto», «non letto» + motivo). Se fai una domanda mentre un file è ancora in lettura, Omar aspetta di averlo letto prima di rispondere. «Rileggi» rifà la lettura (ad esempio dopo aver installato il modello «vista»).
- **Importa un link**: il **server** (non il browser) scarica la pagina o il PDF, ne ricava il testo e lo salva come materiale personale (o di gruppo, eliminabile in qualsiasi momento). Poi puoi chiedere di spiegarlo o riassumerlo e il tutor cita la fonte. Il server rifiuta indirizzi della rete locale/interni e porte diverse da 80/443, e non può leggere pagine che richiedono un accesso.

### «Cerca» (ricerca sul web)

«Cerca» è **spento di default**. Quando lo accendi diventa grigio e, per le domande successive, il server cerca sul web e fa leggere al tutor le pagine trovate, che compaiono come fonti cliccabili sotto la risposta.
Cosa esce dalla rete: solo la **domanda ripulita** (senza link, codice e dati personali riconoscibili) verso il motore di ricerca, e le richieste alle pagine trovate. Le conversazioni non sono inviate al motore.
Il motore si sceglie in `.env` con `WEB_SEARCH_PROVIDER`: `duckduckgo` (predefinito, nessuna chiave; **non è un'API ufficiale**: legge la pagina HTML pubblica e può smettere di funzionare), `brave` (API ufficiale, serve `BRAVE_API_KEY`), `searxng` (istanza della scuola, `SEARXNG_URL`) oppure `off`.
I contenuti del web sono trattati come **dati non fidati**, mai come istruzioni, ma **possono essere sbagliati**: il tutor non li presenta come verificati.
Altre variabili: `LINKS_ENABLED`, `WEB_SEARCH_MAX_RESULTS`, `WEB_SEARCH_FETCH_PAGES`, `WEB_SEARCH_PER_MIN`, `LINKS_PER_MIN`, `WEB_TIMEOUT_MS`, `WEB_MAX_PAGE_KB`.
`ALLOW_PRIVATE_LINKS=1` **spegne la protezione contro l'accesso a reti interne**: serve solo ai test automatici, non attivarlo mai su un server vero.

## Registrazione degli studenti

Gli studenti si registrano solo con un'email `@itiomar.net` (`STUDENT_EMAIL_DOMAIN` in `.env`) più il codice studenti; i docenti no. **Limite:** l'app non invia email di verifica, quindi il dominio non dimostra che la casella esista o appartenga a chi si registra: il codice di registrazione resta il secondo filtro e la verifica vera richiede un servizio email o l'accesso con l'account scolastico (SSO) della scuola.

## Struttura

`src/engine` (tutor, policy, guard, retrieval) · `src/collab` (gruppi, inviti, sync) · `src/realtime` (WebSocket) ·
`src/materials` (allegati ed estrazione) · `src/journal` (Eco di Gruppo) · `src/blackbox` (regole R1–R8, ricalcolo guidato) ·
`public` (interfaccia) · `tests` · `scripts` · `docs`.
