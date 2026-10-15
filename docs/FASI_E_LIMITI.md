# Fasi, limiti e verifiche prima del rilascio

## Stato per fase

| Fase | Contenuto | Implementata | Verifica |
|---|---|---|---|
| 1 | Motore tutor socratico, 4 modalità, materie, materiali del docente con citazioni, sessioni, privacy | Sì | Test automatici (modelli simulati) |
| 2 | Gruppi, codici invito (scadenza, revoca, anti brute-force, approvazione), allegati realtime con visibilità e 5 stati | Sì | Test automatici |
| 3 | Cross-Chat Sync (chat separate, consenso, provenienza, chiarimento ambiguità) | Sì | Test automatici |
| 4 | Eco di Gruppo: diario (le voci automatiche non sono mai "confermate") e briefing | Sì | Test automatici |
| 5 | Scatola Nera: regole R1–R8, analisi IA "possibile", avvisi, ricalcolo guidato | Sì | Test automatici |

| 6 | Chat senza menu (riconoscimento automatico), Account, cronologia, cartelle e invii, Hub (Kanban, asset, PDF), Planner, Bacheca, Quick Tools, Omar Voice, video tutorial | Sì | Test automatici + prova in Chromium |

Totale: **106 test, 106 superati** (16 motore, 24 collaborazione, 9 supporto, 7 Dynamic Island/registrazione, 8 web, 13 streaming, 7 riconoscimento automatico, 4 account, 9 cartelle/invii/Hub/Planner/Bacheca/feed/runner, 5 Quick Tools e voce, 4 tutorial), inclusi i 18 test collaborativi obbligatori.
Verificata anche l'interfaccia in Chromium (due utenti, gruppo, codice, cross-chat, conflitto parametri, area docente, tema scuro, tablet; risposta in diretta con Stop, errori a metà risposta, scorrimento automatico e Liquid Glass in tema chiaro, scuro e su telefono).
**Non verificato:** qualità con modello reale; lo **streaming con un servizio reale** (Ollama, Anthropic, OpenAI): gli adattatori sono provati solo contro flussi SSE simulati e contro il provider `demo`, non contro i server veri; lettura di link e ricerca sul web **su internet vero** (provate solo contro server locali finti: il sandbox di sviluppo non raggiunge siti esterni); il percorso verso un provider reale è stato provato solo contro un endpoint locale finto.

## Limiti noti

- **Streaming.** I controlli didattici lavorano anche sul testo in arrivo: se il modello scrive un programma completo (in modalità esercizio/verifica) o consiglia di aggirare una protezione, il modello viene fermato e il testo sostituito. Prima che il controllo scatti lo studente può aver già visto fino a 12 righe di codice (lo stesso limite del controllo a risposta finita). Se il servizio IA cade a metà risposta il testo parziale **non** viene salvato e la richiesta non viene conteggiata: lo studente vede un errore e può riprovare. Con «Stop» invece la parte già scritta viene salvata e contrassegnata come interrotta. Un provider senza `stream()` mostra la risposta tutta insieme; la spiegazione della Dynamic Island («Spiega / Traduci») non è in streaming. Le risposte `demo` sono una simulazione dello streaming, non un modello.
- **Video tutorial.** È una simulazione animata scritta nell'app (dati di esempio, testi fissi), non un video registrato: se l'interfaccia cambia, i capitoli in `public/js/tutorial-scenes.js` e `tutorial-pages.js` vanno aggiornati a mano. Durata misurata solo in Chromium headless (a velocità accelerata, tempi convertiti a 1×): circa 14:30. Provato con Playwright (tutti i 16 capitoli fino alla fine senza errori, schermate controllate a mano, animazione d'ingresso fotogramma per fotogramma); **non** provato su Safari, Firefox, telefoni reali né con un lettore di schermo vero. Stato «già visto» solo nel localStorage del browser.
- **Riconoscimento automatico** di materia/argomento/modalità/livello: è a parole chiave, deterministico e prudente; può sbagliare argomento o restare su «Generale» con messaggi molto brevi o ambigui. Provato con 7 test (`tests/router.test.js`); la qualità reale va osservata con i messaggi degli studenti.
- **Trasferimenti di file**: avvengono tramite il server della scuola (non dispositivo-a-dispositivo diretto); si inviano solo file personali propri a compagni attivi nello stesso gruppo.
- **Proposte di attività (Kanban)**: con un modello vero il modello propone fino a 8 attività legate a un contributo reale; altrimenti (o se il modello non risponde) si usano regole sulle frasi ("dobbiamo", "bisogna", "verificare"…). Le regole possono proporre frasi poco pulite: per questo restano proposte da accettare.
- **Relazione PDF**: solo testo (niente immagini, grafici o disegni), font standard; caratteri fuori dal set Windows-1252 vengono sostituiti (es. «≤» → «<=»).
- **Planner**: il suggeritore usa solo le stime e l'avanzamento inseriti a mano; non conosce l'orario scolastico.
- **Bacheca**: nessuna circolare reale è inserita dal sistema. L'importazione da sito legge una pagina pubblica (stesse protezioni dei link); pagine fatte con JavaScript o PDF scansionati non producono testo utile. Il sito della scuola **non** è stato letto durante lo sviluppo.
- **Quick Tools**: JavaScript gira in un Web Worker con CSP propria (senza rete); Python/C++ lato server sono **spenti di default** e, se accesi, hanno solo limiti di tempo/output: non sono un vero sandbox. Il formattatore di codice è un riordino di base dell'indentazione.
- **Omar Voice**: usa la Web Speech API del browser; in Chrome/Edge la dettatura è elaborata dai server di Google/Microsoft (fuori dalla scuola) e non funziona in Firefox. Non provato con microfoni reali (solo in Chromium headless, dove l'API esiste ma non riceve audio).
- **Liquid Glass.** È realizzato solo con CSS (sfocatura, saturazione, velo colorato, riflessi sui bordi): non c'è la rifrazione vera dei bordi e, nei browser senza `backdrop-filter`, o con «riduci trasparenza» attivo, i pannelli diventano opachi.

- L'email `@itiomar.net` degli studenti **non è verificata** (nessuna email di conferma né SSO): è un filtro sul dominio, non una prova d'identità.
- La spia arancione scatta dopo 60 s senza tasti premuti o clic (costante `IDLE_MS` in `public/js/island.js`).
- Spiega/traduci con il provider `demo` non produce testi: dichiara che serve un modello vero. La qualità di spiegazioni e traduzioni con il modello scelto va controllata dal docente.
- La Dynamic Island non è stata provata su browser/dispositivi touch reali: lì si usa il pulsante «Spiega / Traduci» accanto alla selezione, perché il trascinamento del testo selezionato non è supportato da tutti i telefoni.

- **Link e «Cerca».** Il server scarica le pagine: se la rete della scuola obbliga a passare da un proxy, le richieste dirette possono essere bloccate e la funzione non lavora finché non si configura la rete. La ricerca `duckduckgo` legge una pagina HTML pubblica, non un'API: può smettere di funzionare o bloccare le richieste automatiche (consigliati `brave` o un `searxng` della scuola). Le pagine che richiedono JavaScript, un accesso o sono fatte di sole immagini non si leggono. I risultati del web **non sono verificati** e possono essere errati o parziali; il testo di una pagina letta è una copia di un momento preciso. Le protezioni contro l'accesso a reti interne (indirizzi privati, redirect, DNS) sono provate con test, ma un controllo di sicurezza indipendente prima dell'uso reale è consigliato.
- «Cerca» manda al motore di ricerca la domanda ripulita da link, codice e dati personali riconoscibili: la pulizia è euristica e non garantisce l'assenza di dati personali scritti in forme insolite.
- **Immagini**: le legge un modello «vista» locale (predefinito `qwen2.5vl:3b`, installato da `npm run setup:ollama`), che produce una descrizione e una trascrizione salvate come testo del materiale; il tutor risponde su quel testo. La trascrizione **può contenere errori** (scrittura a mano, foto storte o sfocate, formule complesse) ed è segnalata come tale al tutor. La qualità reale va provata sul PC della scuola: nei test automatici il modello «vista» è simulato. Senza modello «vista» le immagini sono solo mostrate. Lettura lenta su PC senza GPU (anche 1-3 minuti per immagine).
- HEIC (foto iPhone) e TIFF non si leggono: il server non ha una libreria per decodificarli (archiviati, con il consiglio di esportarli in JPEG/PNG). Le foto scattate dalla fotocamera del browser sono già JPEG.
- PDF scansionati: si leggono solo se le pagine sono immagini JPEG (il caso più comune degli scanner) e al massimo 12 pagine; scansioni in altri formati interni (JBIG2, CCITT) restano senza testo.
- CAD: dei formati aperti si leggono testi, quote, struttura e misure, **non** la geometria come disegno (Omar non "vede" la forma di un DXF/STEP: per farglielo vedere, allega anche uno screenshot). DWG, SolidWorks, Inventor, Fusion 360 sono proprietari: solo archiviati.
- .doc/.xls/.ppt (vecchio Office): estrazione parziale del testo; per un risultato affidabile salvarli in .docx/.xlsx/.pptx.
- ZIP: nessun ZIP64, nessun archivio cifrato; RAR e 7z solo archiviati.
- Limitatori di frequenza in memoria: **una sola istanza** del server; si azzerano al riavvio.
- Nessun HTTPS integrato: usare un reverse proxy con certificato o accettare il rischio solo in rete locale protetta.
- `pdf-parse` fallisce su PDF molto piccoli (<4 KB): aggirato con riempimento; PDF scansionati senza testo non producono contenuto.
- L'estrazione euristica di parametri dal testo è debole: la Scatola Nera può mancare conflitti o segnalarne di dubbi; le sue analisi IA sono sempre "possibili".
- Il provider `demo` **non è un modello**: è una simulazione, sempre etichettata.
- La revoca di un accesso non cancella copie già scaricate o viste.
- SQLite locale: niente alta disponibilità né backup automatico (fare copie della cartella `data`).

## Conservazione dei dati (predefiniti, modificabili in `.env`)

Chat 180 giorni · sessioni di accesso 30 · registro di audit 90 · eventi realtime 60. Il registro tecnico non contiene testi
di conversazioni né contenuto dei documenti. Quando un membro lascia un gruppo o cancella i dati, i suoi contributi condivisi
restano come contributi del gruppo senza collegamento al profilo (anonimizzati); le sue chat e i materiali personali vengono eliminati.

## Controlli della scuola prima del rilascio

Questo software **non garantisce** la conformità al GDPR: la responsabilità è del titolare del trattamento (la scuola).

- [ ] Scelto il provider IA e, se esterno, firmato l'accordo di trattamento dati; verificata la sede del trattamento.
- [ ] Informativa agli studenti e ai genitori (minori) e basi giuridiche/autorizzazioni definite dalla scuola.
- [ ] Periodi di conservazione approvati e impostati in `.env`.
- [ ] Codici di registrazione cambiati e consegnati solo a chi ne ha diritto.
- [ ] HTTPS e accesso di rete decisi (vedi RETE_LOCALE.md); backup e accessi al server definiti.
- [ ] Regole d'uso (solo addestramento e simulazione; mai per disattivare protezioni su macchine reali).
- [ ] Valutazione didattica S1–S8 con il modello scelto completata e conservata.
- [ ] Prova pilota con una classe e docente presente.
