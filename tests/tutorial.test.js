'use strict';
// Test del tutorial di primo accesso: verificano i file serviti, regole di sicurezza del codice e la LOGICA DELLO STATO («già visto»).
// NON eseguono l'animazione (serve un browser): quella si guarda a mano o con uno script Playwright, vedi docs/FASI_E_LIMITI.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const FILES = ['js/tutorial.js', 'js/tutorial-stage.js', 'js/tutorial-scenes.js', 'js/tutorial-pages.js', 'js/tutorial-state.js', 'css/tutorial.css'];
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('tutorial: i file sono serviti dall\'app e non richiedono risorse esterne (CSP stretta)', async () => {
  const t = await boot();
  try {
    for (const f of FILES) {
      const r = await fetch(`${t.base}/${f}`);
      assert.equal(r.status, 200, `${f} non servito`);
      assert.match(r.headers.get('cache-control') || '', /no-cache/, `${f}: i file statici devono ripresentarsi aggiornati`);
      await r.arrayBuffer();
    }
  } finally { await t.close(); }
  for (const f of FILES) {
    const src = read(f);
    assert.doesNotMatch(src.replaceAll('http://www.w3.org/2000/svg', ''), /https?:\/\//, `${f}: nessun indirizzo esterno (il solo URI dello spazio-nomi SVG non è una risorsa)`);
    if (f.endsWith('.js')) {
      assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/, `${f}: niente HTML costruito da stringhe né eval`);
      assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/, `${f}: il tutorial non fa richieste di rete (è una simulazione locale)`);
    }
  }
});

test('tutorial: lo stato «già visto» è per account, resiste a localStorage bloccato e può essere azzerato da una nuova versione', () => {
  const src = read('js/tutorial-state.js').replace(/^export /gm, '');
  const make = (storage) => {
    const ctx = vm.createContext({ localStorage: storage, Set });
    vm.runInContext(`${src}\n;this.api = { hasSeenTutorial, markTutorialSeen, TUTORIAL_VERSION };`, ctx);
    return ctx.api;
  };
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const a = make(ls); const elia = { id: 'u-elia' }; const marco = { id: 'u-marco' };

  assert.equal(a.hasSeenTutorial(elia), false, 'al primo accesso non è visto');
  a.markTutorialSeen(elia);
  assert.equal(a.hasSeenTutorial(elia), true);
  assert.equal(a.hasSeenTutorial(marco), false, 'un altro account sullo stesso PC lo vede comunque');
  assert.equal([...store.keys()].filter((k) => k.startsWith('omar.hasSeenTutorial.')).length, 1, 'una sola voce, nel localStorage');
  assert.ok(![...store.keys()].some((k) => k.includes('Elia')), 'nessun nome o dato personale nella chiave');
  assert.equal(make(ls).hasSeenTutorial(elia), true, 'dopo il ricaricamento della pagina resta visto (stato nel localStorage)');

  store.set('omar.hasSeenTutorial.u-marco', '0');   // versione vecchia del tutorial → lo rivede
  assert.equal(make(ls).hasSeenTutorial(marco), false);

  const broken = { getItem() { throw new Error('bloccato'); }, setItem() { throw new Error('bloccato'); } };
  const b = make(broken);
  assert.equal(b.hasSeenTutorial(elia), false);
  assert.doesNotThrow(() => b.markTutorialSeen(elia));
  assert.equal(b.hasSeenTutorial(elia), true, 'con lo storage bloccato vale finché la pagina resta aperta');
  assert.equal(b.hasSeenTutorial(undefined), false, 'senza utente non si rompe');
});

test('tutorial: l\'avvio lo mostra prima della chat solo a chi non l\'ha visto, e non blocca l\'app se non si carica', () => {
  const app = read('js/app.js');
  assert.match(app, /const first = !hasSeenTutorial\(S\.user\);\s*if \(first\) await openTutorial\(false\)/, 'il primo accesso passa dal tutorial prima del router');
  assert.match(app, /if \(first\) playIntro\(\)/, 'dopo il video parte l\'animazione d\'ingresso (Zoom foto)');
  assert.match(app, /catch \(e\) \{[^}]*console\.error\('tutorial'[^}]*return null/, 'un errore di caricamento non impedisce di usare l\'app');
  assert.match(read('js/tutorial.js'), /markTutorialSeen\(user\)/, 'completando o saltando lo stato viene salvato');
});

test('video tutorial: copre tutte le sezioni dell\'app con capitoli calmi e senza menu di materia', () => {
  const sc = read('js/tutorial-scenes.js');
  for (const id of ['intro', 'island', 'composer', 'ask', 'explain', 'history', 'materials', 'link', 'sync', 'group', 'hub', 'planner', 'bulletin', 'tools', 'account', 'outro']) assert.match(sc, new RegExp(`id: '${id}'`), `manca il capitolo ${id}`);
  const est = [...sc.matchAll(/est: (\d+)/g)].map((m) => +m[1]);
  assert.ok(est.reduce((a, b) => a + b, 0) >= 8 * 60_000, 'un video completo e con calma dura diversi minuti');
  assert.match(read('js/tutorial-stage.js'), /readMs = \(t\) => Math\.max\(3200/, 'ogni didascalia resta il tempo di leggerla');
  assert.doesNotMatch(read('js/tutorial-stage.js'), /cchip/, 'il video non mostra più il menu di materia e modalità');
  assert.match(read('css/features.css'), /body\.intro-zoom/, 'animazione d\'ingresso definita');
});
