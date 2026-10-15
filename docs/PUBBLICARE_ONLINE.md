# Pubblicare Omar AI online (versione web, con Groq)

Con l'IA su Groq Omar non ha più bisogno di Ollama, quindi può girare su un server in internet e si usa dal browser con un link
(es. `https://omar-ai.onrender.com`). Nel progetto c'è già `render.yaml`, che configura tutto per **Render**.

> **Prima di pubblicare, da decidere con la scuola** (dirigente / responsabile privacy): online, account, chat e file degli
> studenti (spesso minorenni) stanno sul server di Render (regione Frankfurt, UE) e le domande vengono elaborate da Groq
> (fuori dalla scuola). Omar lo segnala con il suo avviso; serve un'informativa per studenti e famiglie.

## Cosa serve
- Un account **GitHub** (gratuito) e **GitHub Desktop** (https://desktop.github.com) per caricare il codice.
- Un account **Render** (https://render.com): per le classi serve il piano **Starter** (a pagamento, con disco
  persistente: i servizi gratuiti a ogni riavvio cancellerebbero account, chat e file); per una **demo gratis**
  basta il piano Free, vedi § 5 (`render-free.yaml`).
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

## 4. Dominio personalizzato (es. `omar.ai`)

Render dà un link gratis (`https://omar-ai.onrender.com`); per usare un tuo dominio serve comprarlo e collegarlo.
Nessuna modifica al codice: l'app usa URL relativi e accetta qualsiasi host.

1. **Compra il dominio** da un registrar (es. Cloudflare Registrar, Porkbun, Namecheap). Nota: i domini `.ai`
   costano ~80 €/anno e i nomi corti come `omar.ai` sono spesso già occupati o premium (prezzo a cifre alte):
   verifica la disponibilità sul sito del registrar e, se occupato, valuta alternative
   (`omar-ai.it`, `omarai.scuola.it`, `tutor-omar.it`…).
2. Su Render: servizio → *Settings → Custom Domains* → *Add Custom Domain* → scrivi il dominio
   (consigliato sia `omar.ai` sia `www.omar.ai`).
3. Render mostra i record DNS da creare dal registrar:
   - radice (`omar.ai`): record `A` verso l'IP indicato da Render (o `ALIAS`/`ANAME` se il registrar lo supporta);
   - `www`: record `CNAME` verso `omar-ai.onrender.com` (il tuo indirizzo Render).
4. Attendi la propagazione DNS (pochi minuti / qualche ora). Render emette da solo il certificato HTTPS:
   quando lo stato è *Verified*, il sito risponde su `https://omar.ai`.
5. Prova: registrazione, domanda all'IA, invito a un gruppo da un altro PC.
6. Le chiavi e i codici restano in Render → *Environment*; ogni *push* su GitHub ripubblica da solo.

> Con dominio personalizzato restano validi gli avvisi privacy del § sopra (dati su Render UE, testi a Groq):
> aggiorna l'informativa per studenti e famiglie con l'indirizzo definitivo.

## 5. Sottodominio gratis (demo, piano Free: `render-free.yaml`)

Se basta una **demo gratuita** con un sottodominio tipo `https://omar-ai.onrender.com`, nel progetto c'è
`render-free.yaml`: piano `free`, senza disco. Completamente gratis (come la chiave Groq in fascia gratuita).

1. Repository **privato** su GitHub come al § 1 (`.env` escluso: contiene la chiave).
2. Su Render: *New → Blueprint* → scegli il repository → quando chiede il file Blueprint indica
   `render-free.yaml` → inserisci i tre segreti (`AI_API_KEY`, `STUDENT_REGISTRATION_CODE`,
   `TEACHER_REGISTRATION_CODE`) → *Apply*. (Se l'interfaccia legge solo `render.yaml`: *New → Web Service*,
   piano **Free**, Build `npm ci --omit=dev`, Start `npm start`, Health Check `/desktop/ping`, e le stesse
   variabili di `render-free.yaml`.)
3. Quando lo stato è **Live**, l'indirizzo in alto (`https://omar-ai.onrender.com`, o simile se il nome è preso)
   è il link da aprire nel browser e condividere.

Limiti (accettabili per una demo, non per le classi):
- dopo ~15 minuti senza visite il servizio dorme: la prima apertura richiede ~50 secondi;
- **niente disco**: a ogni riavvio si azzerano account, chat, gruppi e file caricati;
- per l'uso reale passa al § 2 (`render.yaml`, piano Starter con disco).

## App da installare e versione web insieme
Il pacchetto da scaricare resta «solo applicazione». La versione web usa `DESKTOP_ONLY=false`, impostato da `render.yaml`.
