# Pubblicare Omar AI online (versione web, con Groq)

Con l'IA su Groq Omar non ha più bisogno di Ollama, quindi può girare su un server in internet e si usa dal browser con un link
(es. `https://omar-ai.onrender.com`). Nel progetto c'è già `render.yaml`, che configura tutto per **Render**.

> **Prima di pubblicare, da decidere con la scuola** (dirigente / responsabile privacy): online, account, chat e file degli
> studenti (spesso minorenni) stanno sul server di Render (regione Frankfurt, UE) e le domande vengono elaborate da Groq
> (fuori dalla scuola). Omar lo segnala con il suo avviso; serve un'informativa per studenti e famiglie.

## Cosa serve
- Un account **GitHub** (gratuito) e **GitHub Desktop** (https://desktop.github.com) per caricare il codice.
- Un account **Render** (https://render.com) con il piano **Starter** (a pagamento): i servizi gratuiti di Render non hanno
  disco persistente e a ogni riavvio cancellerebbero account, chat e file.
- La chiave API di Groq (quella nuova, non quelle incollate in chat).

## 1. Carica il codice su GitHub (repository PRIVATO)
1. Apri GitHub Desktop → *File → Add local repository* → scegli la cartella `AssistenteOmar` → *create a repository*.
2. Controlla nell'elenco dei file che **`.env` NON compaia** (contiene la chiave Groq: è escluso da `.gitignore`;
   esclusi anche `data/`, `node_modules/`, `pubblicazione/`). Se compare, fermati.
3. *Commit to main* → *Publish repository* → lascia spuntato **Keep this code private** → *Publish*.

## 2. Crea il servizio su Render
1. Su Render: *New → Blueprint* → collega GitHub e scegli il repository `AssistenteOmar`.
2. Render legge `render.yaml` e chiede i tre valori segreti:
   - `AI_API_KEY` → la chiave Groq;
   - `STUDENT_REGISTRATION_CODE` → il codice che darai agli studenti (lungo, non `ER26OCT08` se è già circolato);
   - `TEACHER_REGISTRATION_CODE` → il codice dei docenti, da tenere riservato.
3. *Apply*. Il primo avvio richiede qualche minuto. Quando lo stato è **Live**, in alto c'è il link
   `https://omar-ai.onrender.com` (o simile, se il nome è già preso): è il link da condividere.

## 3. Prova
1. Apri il link, *Registrati* con un'email `@itiomar.net` e il codice studenti. Per un docente: codice docenti.
2. Fai una domanda: la risposta deve arrivare in pochi secondi, senza il banner «simulazione».
3. Crea un gruppo e invita un compagno da un altro PC: online sono tutti sullo stesso server, quindi i codici funzionano subito.

## Aggiornare e manutenzione
- Ogni modifica caricata con GitHub Desktop (*Commit* + *Push*) viene ripubblicata da sola (pochi secondi di pausa).
- Le chiavi e i codici si cambiano in Render → servizio → *Environment*.
- Backup: Render → *Disks* fa snapshot giornalieri del disco; per una copia tua, scarica `/var/data` dalla *Shell* del servizio.
- Limiti d'uso: `AI_DAILY_LIMIT_PER_USER` (predefinito 150 richieste al giorno per utente) protegge la quota Groq.

## Immagini (facoltativo)
`AI_VISION=false` perché `openai/gpt-oss-20b` non legge immagini. Se scegli un modello Groq con visione (vedi la lista
modelli nella console Groq), imposta `AI_VISION=true` e `AI_VISION_MODEL=<nome del modello>`.

## Alternativa veloce per una prova: tunnel dal PC
Per un test di qualche ora senza Render, dal PC con Omar: imposta nel `.env` `DESKTOP_ONLY=false` e `TRUST_PROXY=true`,
avvia Omar e in un'altra finestra esegui `cloudflared tunnel --url http://localhost:3300` (cloudflared:
`winget install Cloudflare.cloudflared`). Compare un link `https://….trycloudflare.com`, valido finché il PC resta acceso e la
finestra aperta; cambia a ogni avvio. Non adatto all'uso con le classi.

## App da installare e versione web insieme
Il pacchetto da scaricare resta «solo applicazione». La versione web usa `DESKTOP_ONLY=false`, impostato da `render.yaml`.
