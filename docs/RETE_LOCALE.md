# Uso in rete locale (più dispositivi nella stessa aula)

Il collegamento tra dispositivi passa **dal server dell'applicazione**: un computer della scuola esegue Omar AI e gli altri dispositivi aprono la pagina dal browser. Non serve alcun servizio esterno per la sincronizzazione.

## Tre cose diverse (non vanno confuse)

| Cosa | Dove avviene | Cosa esce dalla rete scolastica |
|---|---|---|
| **Sincronizzazione tra dispositivi** (gruppi, allegati, avvisi, diario) | sul server della scuola, via WebSocket | niente |
| **Elaborazione IA con provider esterno** (`anthropic`, `openai-compatible` verso internet) | il server invia a Internet il testo delle domande e i passaggi dei materiali pertinenti | **sì**: domande e brani di documenti |
| **Elaborazione IA con modello locale** (Ollama, LM Studio, llama.cpp nella rete) | sul server o su un altro PC della scuola | niente |

L'applicazione mostra sempre quale dei casi è attivo (banner e pagina *Privacy*). In modalità `demo` le risposte sono **simulate**.

## Avvio per la rete

> **Consigliato:** per far lavorare in gruppo computer diversi usa il **server della classe** (README, «Gruppi tra computer diversi»): resta un'applicazione, e i computer si collegano con indirizzo + codice d'aula. La modalità web qui sotto serve solo se qualcuno deve usare Omar da un browser senza app.
>
> Omar AI si distribuisce come **applicazione da scaricare** e, così installato, si apre **solo** dalla sua icona: il server rifiuta i normali browser (una chiave segreta nuova a ogni avvio viene consegnata alla sola finestra dell'app). La modalità di rete qui sotto è un'eccezione da decidere con la scuola, per un solo PC che fa da server per l'aula: lì gli altri dispositivi usano il browser.

1. Imposta nel file `.env`: `HOST=0.0.0.0`, **`DESKTOP_ONLY=false`** e i codici di registrazione. (Con `HOST=0.0.0.0` ma senza `DESKTOP_ONLY=false` il server non parte, per non aprire per sbaglio l'app alla rete.)
2. Avvia con `npm start`: nella finestra compaiono gli indirizzi, ad esempio `http://192.168.1.20:3300`.
3. Sugli altri dispositivi apri quell'indirizzo nel browser.
4. Se il firewall di Windows chiede il permesso, consenti l'accesso **solo alle reti private**.

## Requisiti di sicurezza (leggere prima dell'uso)

- **Nessun HTTPS incluso.** Sulla rete locale password e messaggi viaggiano in chiaro: usa una rete scolastica protetta (non il Wi-Fi ospiti) oppure metti davanti un proxy HTTPS gestito dall'ufficio tecnico (e imposta `TRUST_PROXY`).
- Non esporre la porta su Internet.
- Cambia i codici di registrazione di esempio. Chi ha il codice *docenti* diventa docente.
- Il server deve stare su un computer aggiornato e con accesso fisico controllato: nella cartella `data/` ci sono database e file caricati.
- Limitatori di tentativi (accesso, inviti) e code in memoria: funzionano con **una sola istanza** del server.
- Il codice d'invito non dà poteri speciali: chi entra resta un partecipante semplice; il creatore può approvare, revocare, rigenerare i codici.
