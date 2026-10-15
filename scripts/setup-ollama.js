'use strict';
// Collega Omar AI a Ollama in locale: trova i modelli installati, scrive .env, fa una prova reale.
// Poi collega anche un modello «vista» (per leggere foto, schermate, schizzi e PDF scansionati): se manca lo scarica una volta sola.
// Uso:  npm run setup:ollama [-- nome-modello] [--vista=nome-modello-vista] [--senza-vista]
//       (Ollama deve essere avviato: di solito parte con Windows)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOST = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';
const PREFERITI = ['qwen2.5:7b', 'qwen2.5', 'llama3.1', 'llama3.2', 'mistral', 'gemma2', 'gemma3', 'phi3', 'qwen3'];
// modelli che vedono le immagini, in ordine di preferenza (qwen2.5vl legge bene il testo nelle foto)
const VISTA = ['qwen2.5vl', 'gemma3', 'llama3.2-vision', 'minicpm-v', 'llava'];
const VISTA_DEFAULT = 'qwen2.5vl:3b'; // ~3,2 GB; per una lettura migliore (serve più RAM/GPU): --vista=qwen2.5vl:7b
const isVista = (n) => VISTA.some((f) => n === f || n.startsWith(`${f}:`)) && !/embed/i.test(n);
const ENV = path.join(__dirname, '..', '.env');
const EXAMPLE = path.join(__dirname, '..', '.env.example');

async function getJson(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function setEnv(text, pairs) {
  let out = text;
  for (const [k, v] of Object.entries(pairs)) {
    const rx = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    out = rx.test(out) ? out.replace(rx, `${k}=${v}`) : `${out.replace(/\s*$/, '\n')}${k}=${v}\n`;
  }
  return out;
}
(async () => {
  // provider esterno già configurato (es. Groq): non tocco nulla, Ollama non serve
  try {
    const cur = fs.readFileSync(ENV, 'utf8');
    const base = (cur.match(/^AI_BASE_URL=(\S+)/m) || [])[1] || '';
    const prov = ((cur.match(/^AI_PROVIDER=(\S+)/m) || [])[1] || '').toLowerCase();
    if (prov === 'anthropic' || (base && !/^https?:\/\/(localhost|127\.|10\.|192\.168\.)/i.test(base))) {
      console.log(`✓ Provider IA esterno già configurato (${prov === 'anthropic' ? 'Anthropic' : base}): Ollama non serve, lascio il .env com'è.`);
      process.exit(0);
    }
  } catch { /* nessun .env: si configura Ollama */ }
  let tags;
  try { tags = await getJson(`${HOST}/api/tags`); }
  catch (e) {
    console.error(`✗ Ollama non risponde su ${HOST} (${e.message}).`);
    console.error('  Avvia l\'app "Ollama" (icona nella barra accanto all\'orologio) oppure esegui "ollama serve" e riprova.');
    process.exit(2);
  }
  const installati = (tags.models || []).map((m) => m.name);
  console.log(`✓ Ollama attivo. Modelli installati: ${installati.length ? installati.join(', ') : '(nessuno)'}`);
  const args = process.argv.slice(2);
  const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}`)); return a === undefined ? undefined : (a.split('=')[1] ?? true); };
  let model = args.find((x) => !x.startsWith('--'));
  if (!model) model = PREFERITI.map((p) => installati.find((n) => n === p || n.startsWith(p.includes(':') ? p : `${p}:`))).find(Boolean) || installati.find((n) => !/embed/i.test(n) && !isVista(n)) || installati.find((n) => !/embed/i.test(n));
  if (!model) {
    model = 'qwen2.5:7b';
    console.log(`Nessun modello: scarico ${model} (circa 4,7 GB, serve internet una volta sola)…`);
    const r = spawnSync('ollama', ['pull', model], { stdio: 'inherit', shell: true });
    if (r.status !== 0) { console.error(`✗ Download non riuscito. Esegui a mano:  ollama pull ${model}`); process.exit(3); }
  } else if (!installati.includes(model)) {
    console.error(`✗ Il modello "${model}" non è installato. Installa con:  ollama pull ${model}`); process.exit(3);
  }
  console.log(`→ Modello scelto: ${model}`);

  let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : fs.readFileSync(EXAMPLE, 'utf8');
  env = setEnv(env, { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: `${HOST}/v1`, AI_MODEL: model, AI_TIMEOUT_MS: 120000, AI_MAX_TOKENS: 900 });
  fs.writeFileSync(ENV, env);
  console.log('✓ .env aggiornato (provider locale: i testi NON lasciano questo computer).');

  console.log('Prova reale del modello (la prima volta può richiedere 1-2 minuti per caricarlo)…');
  const t0 = Date.now();
  try {
    const r = await fetch(`${HOST}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(300000),
      body: JSON.stringify({ model, max_tokens: 60, temperature: 0.2, messages: [
        { role: 'system', content: 'Sei un tutor di meccanica. Rispondi in italiano con UNA sola domanda guida, senza dare il risultato.' },
        { role: 'user', content: 'Una forza di 50 N agisce a 0,3 m da un perno. Dammi il momento.' }] }),
    });
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content;
    if (!txt) throw new Error(JSON.stringify(j).slice(0, 200));
    console.log(`✓ Il modello risponde (${((Date.now() - t0) / 1000).toFixed(1)} s): ${txt.trim().slice(0, 200)}`);
  } catch (e) { console.error(`✗ Prova non riuscita: ${e.message}`); process.exit(4); }

  // ── modello «vista»: facoltativo. Se qualcosa va storto Omar funziona lo stesso, ma le immagini restano solo archiviate. ──
  if (opt('senza-vista')) {
    fs.writeFileSync(ENV, setEnv(fs.readFileSync(ENV, 'utf8'), { AI_VISION: 'false' }));
    console.log('→ Modello «vista» disattivato su richiesta: le immagini saranno solo archiviate e mostrate.');
  } else {
    const chiesto = typeof opt('vista') === 'string' ? opt('vista') : null;
    const giaInEnv = (fs.readFileSync(ENV, 'utf8').match(/^AI_VISION_MODEL=(\S+)/m) || [])[1];
    let vista = chiesto || [giaInEnv, ...VISTA].filter(Boolean).map((p) => installati.find((n) => n === p || n.startsWith(`${p}:`))).find(Boolean)
      || (isVista(model) ? model : null);
    if (!vista) {
      vista = VISTA_DEFAULT;
      console.log(`\nPer leggere foto, schizzi e PDF scansionati serve un modello «vista». Scarico ${vista} (circa 3,2 GB, una volta sola)…`);
      console.log('  (per saltare questo passo: npm run setup:ollama -- --senza-vista)');
      const r = spawnSync('ollama', ['pull', vista], { stdio: 'inherit', shell: true });
      if (r.status !== 0) { console.error(`✗ Download non riuscito: le immagini saranno solo archiviate. Riprova più tardi con:  ollama pull ${vista}`); vista = null; }
    } else if (chiesto && !installati.includes(chiesto)) {
      const r = spawnSync('ollama', ['pull', chiesto], { stdio: 'inherit', shell: true });
      if (r.status !== 0) { console.error(`✗ Non riesco a scaricare ${chiesto}.`); vista = null; }
    }
    if (vista) {
      console.log(`→ Modello «vista»: ${vista}. Prova su un'immagine di esempio…`);
      // immagine PNG 1x1 bianca: basta a verificare che il modello accetti immagini
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
      const t1 = Date.now();
      try {
        const r = await fetch(`${HOST}/v1/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(400000),
          body: JSON.stringify({ model: vista, max_tokens: 40, temperature: 0, messages: [{ role: 'user', content: [
            { type: 'text', text: 'Di che colore è questa immagine? Rispondi con una parola in italiano.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }] }),
        });
        const j = await r.json(); const txt = j.choices?.[0]?.message?.content;
        if (!txt) throw new Error(JSON.stringify(j).slice(0, 200));
        console.log(`✓ Il modello «vista» risponde (${((Date.now() - t1) / 1000).toFixed(1)} s): ${txt.trim().slice(0, 80)}`);
        fs.writeFileSync(ENV, setEnv(fs.readFileSync(ENV, 'utf8'), { AI_VISION: 'true', AI_VISION_MODEL: vista }));
        console.log('✓ .env aggiornato: Omar ora legge immagini e PDF scansionati.');
      } catch (e) {
        console.error(`✗ Il modello «vista» non ha risposto (${e.message}). Omar funziona lo stesso; le immagini restano solo archiviate.`);
        console.error('  Se il PC ha poca memoria prova un modello più piccolo:  npm run setup:ollama -- --vista=gemma3:4b');
      }
    }
  }
  console.log('\nFatto. Avvia con:  npm start   →  http://localhost:3300');
  console.log('Per giudicare la qualità didattica:  npm run eval:live   (poi la griglia in docs/VALUTAZIONE_DIDATTICA.md)');
})();
