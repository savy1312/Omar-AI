// Tutorial — riproduzioni delle pagine dell'app (stesse classi CSS di quelle vere) con DATI DI ESEMPIO:
// cronologia, materiali con cartelle e invii, Hub di progetto (Kanban, asset, relazione), Planner, Bacheca, Quick Tools, Account.
// Sono solo da guardare: nessun dato reale, nessuna richiesta di rete.
import { h, renderMarkdown } from './dom.js';
import { icon } from './icons.js';

const dv = (cls, ...kids) => h('div', { class: cls }, ...kids);
const btn = (text, { primary = false, sm = true, ic = null, cls = '' } = {}) => h('div', { class: `btn${sm ? ' sm' : ''}${primary ? ' primary' : ''} ${cls}` }, ic && icon(ic, 15), text);

// ───────── cronologia (pannello della pillola) ─────────
export function historyPanel() {
  const COL = { m: '#ffb454', t: '#8ab4ff', d: '#7be0a8' };
  const item = (c, ic, title, meta) => h('div', { class: 'hx-item', style: `--sc:${c}` }, [h('div', { class: 'hx-main' }, [h('span', { class: 'hx-ic' }, icon(ic, 15)), h('span', { class: 'hx-txt' }, [h('span', { class: 'hx-title', text: title }), h('span', { class: 'hx-meta' }, [h('span', { class: 'hx-subj', text: meta[0] }), ` · ${meta[1]}`])])]), h('div', { class: 'hx-acts' }, [h('div', { class: 'hx-btn' }, icon('edit', 14)), h('div', { class: 'hx-btn' }, icon('trash', 14))])]);
  const chips = dv('hx-chips', [['Tutte', true], ['Meccanica', false, COL.m], ['Meccatronica', false, COL.t], ['Disegno 3D', false, COL.d]].map(([t, on, c]) => h('div', { class: 'hx-chip', 'aria-pressed': String(on), style: c ? `--sc:${c}` : '' }, c && h('i'), t)));
  const list = dv('hx-list', [h('div', { class: 'hx-group', text: 'Oggi' }), item(COL.m, 'edit', 'Tensione tangenziale su un perno', ['Meccanica', '10:42 · 3 scambi']), item(COL.t, 'sparkle', 'Che cos’è un temporizzatore TON?', ['Meccatronica', '09:15 · 2 scambi']),
    h('div', { class: 'hx-group', text: 'Ieri' }), item(COL.d, 'check', 'Verifica: vincoli negli schizzi', ['Disegno industriale tridimensionale', '17:30 · 5 scambi']),
    h('div', { class: 'hx-group', text: 'Ultimi 7 giorni' }), item(COL.m, 'replay', 'Ripasso: flessione delle travi', ['Meccanica', '12 ott · 6 scambi'])]);
  const search = h('div', { class: 'hx-bar' }, [h('span', { class: 'hx-sic' }, icon('search', 16)), h('div', { class: 'hx-search tut-fakein', text: 'Cerca nelle chat…' })]);
  const head = h('div', { class: 'isl-head' }, h('strong', { text: 'Cronologia' }), h('span', { class: 'isl-link', text: 'Vedi tutto' }), h('div', { class: 'isl-ico' }, icon('x', 16)));
  return { nodes: [head, h('div', { class: 'isl-pill primary' }, icon('edit', 16), 'Nuova chat'), h('div', { class: 'hx compact' }, [search, chips, list])], chips, list };
}

// ───────── materiali: cartelle, invio a un compagno, offerta in arrivo ─────────
export function materialsPage({ incoming = false } = {}) {
  const row = (name, meta) => dv('item row mrow', [h('span', { class: 'msel tut-box' }), h('span', { class: 'mico' }, icon('file', 18)), dv('grow', h('strong', { text: name }), h('div', { class: 'small muted', text: meta })),
    h('span', { class: 'badge', text: 'personale' }), h('span', { class: 'badge ok', text: 'Contenuto pronto per l’uso dell’IA' }), btn('Scarica'), h('div', { class: 'btn sm' }, icon('folder', 15)), h('div', { class: 'btn sm', 'data-k': 'send1' }, icon('send', 15))]);
  const sendFolder = btn('Invia la cartella', { ic: 'send' });
  const fold = h('div', { class: 'mfold', 'data-open': '1' }, [h('div', { class: 'mf-head' }, [icon('folder', 18), h('strong', { text: 'Motore' }), h('span', { class: 'small muted', text: '2 file' }), h('span', { class: 'sp' }), sendFolder, h('div', { class: 'btn sm ghost' }, icon('edit', 14))]),
    dv('mf-body', [row('calcoli_coppia.pdf', 'v1 · 240 KB · Elia · 3 pag.'), row('scelta_motore.txt', 'v2 · 4 KB · Elia')])]);
  const fold2 = h('div', { class: 'mfold' }, h('div', { class: 'mf-head' }, [icon('folder', 18), h('strong', { text: 'Statica' }), h('span', { class: 'small muted', text: '4 file' })]));
  const xf = dv('xf');
  const card = incoming ? dv('xf-card', [dv('xf-top', [h('span', { class: 'xf-ic' }, icon('folder', 18)), dv('grow', h('strong', { text: 'Marco ti invia la cartella “Telaio”' }), h('div', { class: 'small muted', text: '1,2 MB · gruppo “Mulino a vento” · scade tra 7 giorni' }))]),
    h('p', { class: 'xf-note', text: '“Ecco le quote del telaio”' }), h('ul', { class: 'xf-items' }, [['telaio_quote.pdf', '980 KB'], ['note_montaggio.txt', '3 KB']].map(([n, s]) => h('li', null, icon('file', 13), h('span', { text: n }), h('span', { class: 'small muted', text: s })))),
    dv('row', [btn('Accetta e salva', { primary: true, ic: 'download', cls: 'tut-accept' }), btn('Rifiuta')])]) : null;
  if (card) xf.append(h('h2', { class: 'xf-h' }, icon('inbox', 18), 'In arrivo (1)'), card);
  const tabs = h('nav', { class: 'tabs' }, [h('a', { text: 'Materiali del corso' }), h('a', { text: 'Gruppo: Mulino a vento' }), h('a', { text: 'I miei file', 'aria-current': 'page' })]);
  const tools = dv('row mtools', [btn('Carica file', { primary: true, sm: false, ic: 'upload' }), btn('Importa un link', { sm: false, ic: 'link' }), btn('Invia a un compagno', { sm: false, ic: 'send' })]);
  const el = h('div', { class: 'page' }, [h('h1', { text: 'Materiali' }), incoming ? xf : null, tabs, tools, h('div', { class: 'mlist' }, [fold, fold2])]);
  return { el, sendFolder, fold, card };
}
export function transferBody() {
  const peers = [['Marco', 'struttura del mulino', true], ['Luca', 'area non indicata', false]].map(([n, w, on], i) => h('label', { class: 'radio' }, h('span', { class: `tut-radio${i === 0 ? ' on' : ''}` }), h('span', { class: `dot ${on ? 'on' : ''}` }), `${n} · ${w}`, h('span', { class: 'small muted', text: on ? ' (online)' : '' })));
  return h('div', null, [h('p', { class: 'small muted', text: 'Il compagno riceve un’offerta: vede nomi e dimensioni e decide se accettare. Solo se accetta riceve una COPIA tra i suoi file personali. I tuoi file restano tuoi.' }),
    h('p', { class: 'dlg-label', text: 'A chi?' }), ...peers, h('p', { class: 'dlg-label', text: 'Cosa invii' }), h('p', null, icon('folder', 16), ' L’intera cartella ', h('strong', { text: '“Motore”' })),
    h('label', { text: 'Messaggio (facoltativo)' }), h('div', { class: 'tut-fakein light', text: 'Ecco i calcoli del motore' })]);
}

// ───────── Hub di progetto ─────────
const hubTop = (tab) => [h('div', { class: 'hub-top' }, [h('div', null, h('h1', { text: 'Mulino a vento' }), h('p', { class: 'muted small', text: 'Hub di progetto · 3 partecipanti · 2 online' })), h('div', { class: 'hub-avatars' }, ['M', 'E', 'L'].map((x, i) => h('span', { class: `hub-av${i < 2 ? ' on' : ''}`, text: x })))]),
  h('nav', { class: 'tabs' }, [['Attività', 'board'], ['Asset', 'code'], ['Relazione PDF', 'report'], ['Attività recenti', 'bell']].map(([t, ic]) => h('a', { 'aria-current': t === tab ? 'page' : null }, icon(ic, 15), t)))];
export function kanbanPage() {
  const card = (t, who, extra = {}) => h('article', { class: `kb-card${extra.prop ? ' prop' : ''}` }, [dv('kb-t', t), extra.d && dv('kb-d', extra.d), dv('kb-meta', [who ? h('span', { class: 'kb-who' }, h('i', { text: who[0] }), who) : h('span', { class: 'kb-who none', text: 'nessun incaricato' }), extra.due && h('span', { class: `kb-due ${extra.late ? 'late' : 'soon'}` }, icon('calendar', 12), extra.due), extra.prop && h('span', { class: 'kb-ai' }, icon('wand', 12), 'IA')]),
    extra.prop ? dv('kb-prop', [btn('Accetta', { primary: true, ic: 'check', cls: 'tut-acc' }), btn('Scarta')]) : null]);
  const col = (id, label, cards, hint) => h('section', { class: `kb-col kb-${id}` }, [h('header', { class: 'kb-h' }, h('strong', { text: label }), h('span', { class: 'kb-n', text: String(cards.length) })), hint && h('p', { class: 'kb-hint', text: hint }), dv('kb-cards', cards.length ? cards : h('p', { class: 'kb-empty', text: 'Trascina qui un’attività' }))]);
  const p1 = card('Verificare la coppia del motoriduttore', 'Marco', { prop: true, d: 'Dal contributo condiviso di Marco: “dobbiamo verificare la coppia a 3000 giri/min”' });
  const p2 = card('Scegliere il cuscinetto dell’albero', 'Elia', { prop: true, d: 'Dal diario di gruppo (compito)' });
  const todo = dv('kb-cards'); const doing = card('Disegnare il telaio in CAD', 'Elia', { due: 'tra 3 giorni' });
  const cols = { proposta: col('proposta', 'Proposte dell’IA', [p1, p2], 'Da accettare o scartare: nessuna attività parte da sola.'), da_fare: col('da_fare', 'Da fare', [card('Preparare la distinta dei materiali', 'Luca', { due: 'domani' })]), in_corso: col('in_corso', 'In corso', [doing]), fatto: col('fatto', 'Fatto', [card('Scegliere il motore', 'Marco')]) };
  const propose = btn('Proponi attività dalle chat condivise', { sm: false, ic: 'wand' });
  const el = h('div', { class: 'page hub' }, [...hubTop('Attività'), dv('row hub-tools', [btn('Nuova attività', { primary: true, sm: false, ic: 'plus' }), propose, h('span', { class: 'sp' }), h('span', { class: 'small muted', text: '1 di 3 completate' })]), h('div', { class: 'kb' }, Object.values(cols))]);
  void todo;
  return { el, propose, p1, p2, cols };
}
export function assetsPage() {
  const code = h('article', { class: 'as-card k-codice' }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic' }, icon('code', 15)), h('strong', { text: 'Lettura dell’encoder' }), h('span', { class: 'badge', text: 'arduino' })]),
    h('pre', { class: 'as-code' }, h('code', { text: 'volatile long impulsi = 0;\nvoid conta() { impulsi++; }\nvoid setup() {\n  attachInterrupt(0, conta, RISING);\n}' })), h('footer', { class: 'as-f' }, [h('span', { class: 'small muted', text: 'Marco · da un contributo condiviso' }), h('span', { class: 'sp' }), h('div', { class: 'btn sm ghost' }, icon('copy', 14)), h('div', { class: 'btn sm ghost tut-try' }, icon('play', 14))])]);
  const formula = h('article', { class: 'as-card k-formula' }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic' }, icon('calc', 15)), h('strong', { text: 'Coppia all’albero' })]), renderMarkdown('$$C = \\frac{P}{\\omega}$$'), h('footer', { class: 'as-f' }, h('span', { class: 'small muted', text: 'Elia · manuale' }))]);
  const file = h('article', { class: 'as-card k-file' }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic' }, icon('report', 15)), h('strong', { text: 'telaio_quote.pdf' }), h('span', { class: 'badge ok', text: 'pronto' })]), h('p', { class: 'small muted', text: 'Testo letto dall’IA · v2 · 980 KB · cartella Telaio' }), h('footer', { class: 'as-f' }, h('span', { class: 'small muted', text: 'Marco' }))]);
  const link = h('article', { class: 'as-card k-link' }, [h('header', { class: 'as-h' }, [h('span', { class: 'as-ic' }, icon('link', 15)), h('strong', { text: 'Catalogo cuscinetti' })]), h('span', { class: 'as-link', text: 'esempio.it/cuscinetti/6204' }), h('footer', { class: 'as-f' }, h('span', { class: 'small muted', text: 'Luca' }))]);
  const harvest = btn('Raccogli dai contributi condivisi', { sm: false, ic: 'wand' });
  const el = h('div', { class: 'page hub' }, [...hubTop('Asset'), dv('row hub-tools', [btn('Nuovo asset', { primary: true, sm: false, ic: 'plus' }), harvest]), dv('hx-chips', ['Tutti', 'File', 'PDF', 'Codice', 'Formule', 'Link'].map((t, i) => h('div', { class: 'hx-chip', 'aria-pressed': String(i === 0), text: t }))), h('div', { class: 'as-grid' }, [code, formula, file, link])]);
  return { el, harvest, code };
}
export function reportPage() {
  const SECT = ['Gruppo di lavoro e obiettivi', 'Decisioni', 'Parametri e dimensioni', 'Verifiche di compatibilità (Scatola Nera)', 'Attività e scadenze', 'Materiali e asset', 'Diario di bordo'];
  const gen = btn('Genera l’anteprima', { primary: true, sm: false, ic: 'eye' });
  const prev = dv('rp-prev', h('p', { class: 'muted small', text: 'L’anteprima comparirà qui.' }));
  const el = h('div', { class: 'page hub' }, [...hubTop('Relazione PDF'), dv('rp', [dv('acc-card', [h('h2', null, icon('report', 19), 'Relazione tecnica del progetto'), h('p', { class: 'muted', text: 'Omar AI impagina in un PDF ciò che il gruppo ha inserito e condiviso. Le proposte restano segnate come proposte: niente viene inventato.' }),
    h('p', { class: 'dlg-label', text: 'Sezioni da includere' }), ...SECT.map((s) => h('label', { class: 'radio' }, h('span', { class: 'tut-check on' }), s)), dv('row', [gen, btn('Scarica il PDF', { sm: false, ic: 'download' })])]), prev])]);
  const showPdf = () => { prev.replaceChildren(dv('tut-pdf tut-enter', [h('div', { class: 'tut-pdf-h', text: 'Relazione tecnica — Mulino a vento' }), ...['1. Gruppo di lavoro', '2. Decisioni', '3. Parametri e dimensioni', '4. Scatola Nera', '5. Attività (Kanban)'].map((t) => [h('div', { class: 'tut-pdf-t', text: t }), h('i'), h('i'), h('i', { class: 's' })]).flat(), h('div', { class: 'tut-pdf-f', text: 'Pagina 1 di 3' })])); };
  return { el, gen, showPdf };
}

// ───────── Planner ─────────
export function plannerPage() {
  const row = (ic, k, t, st, cls, meta, p) => h('div', { class: 'pl-row' }, [h('span', { class: `pl-ic k-${k}` }, icon(ic, 17)), dv('grow', [dv('pl-title', [h('strong', { text: t }), h('span', { class: `pl-st ${cls}`, text: st })]), h('div', { class: 'small muted', text: meta }), dv('pl-prog', [h('div', { class: 'tut-range' }, h('i', { style: `width:${p}%` })), h('span', { class: 'small', text: `${p}%` })])]), dv('pl-acts', btn('Fatto', { primary: true, ic: 'check' }))]);
  const steps = h('ol', { class: 'pl-steps' }, [['Verifica di statica', 'Verifica · Mancano 2 giorni: servono ~1 h al giorno.', '1 h'], ['Consegna del mulino', 'Progetto di gruppo · Mancano 9 giorni: ~55 min al giorno.', '55 min']].map(([t, w, m], i) => h('li', null, h('span', { class: 'pl-n', text: String(i + 1) }), dv('grow', h('strong', { text: t }), h('div', { class: 'small muted', text: w })), h('span', { class: 'pl-min', text: m }))));
  const ring = h('div', { class: 'pl-ring', style: '--p:0' }, h('span', { text: '0 min' }));
  const today = dv('acc-card pl-today', [dv('pl-th', [ring, h('div', null, h('h2', { text: 'Il piano di oggi' }), h('p', { class: 'small muted', text: 'giovedì · 2 h disponibili' }))]), steps, h('p', { class: 'small muted', text: 'Suggerimento calcolato dalle stime di tempo e dall’avanzamento che inserisci tu.' })]);
  const list = dv('pl-rows', [row('check', 'verifica', 'Verifica di statica', 'Vicina', 'soon', 'Verifica · Meccanica · sab 17 ott · restano ~3 h', 0), row('board', 'progetto', 'Consegna del mulino', 'In tempo', 'ok', 'Progetto di gruppo · sab 24 ott · restano ~6 h · da Marco', 25), row('tool', 'laboratorio', 'Relazione di laboratorio PLC', 'In tempo', 'ok', 'Consegna di laboratorio · Meccatronica · mer 28 ott', 60)]);
  const add = btn('Nuova scadenza', { primary: true, sm: false, ic: 'plus' });
  const el = h('div', { class: 'page pl' }, [h('div', { class: 'hub-top' }, [h('div', null, h('h1', { text: 'Planner' }), h('p', { class: 'muted small', text: 'Scadenze, verifiche e consegne: ti dico quanto tempo resta e cosa conviene fare oggi.' })), dv('row', [btn('Tempo di studio', { sm: false, ic: 'clock' }), add])]),
    dv('pl-grid', [today, h('div', null, [dv('pl-lh', [h('h2', { text: 'Scadenze' }), dv('seg', [h('div', { class: 'tut-segb on' }, icon('list', 15), 'Lista'), h('div', { class: 'tut-segb' }, icon('calendar', 15), '14 giorni')])]), list])])]);
  return { el, ring, steps, add, list };
}

// ───────── Bacheca ─────────
export function bulletinPage() {
  const card = (k, ic, kicker, t, body, extra = {}) => h('article', { class: `bb-card k-${k}${extra.unread ? ' unread' : ''}${extra.pinned ? ' pinned' : ''}` }, [h('header', { class: 'bb-h' }, [h('span', { class: 'bb-ic' }, icon(ic, 18)), dv('grow', [dv('bb-kicker', kicker), h('h3', { class: 'bb-t', text: t })]), extra.unread && h('span', { class: 'bb-new', text: 'nuovo' })]),
    extra.example && h('p', { class: 'notice warn', text: 'Voce da completare a cura della scuola: regolamento, date e premi non sono ancora stati pubblicati.' }), dv('bb-body', renderMarkdown(body)), h('footer', { class: 'bb-f' }, [h('span', { class: 'sp' }), btn('Segna come letto', { cls: 'ghost' })])]);
  const contest = card('concorso', 'sparkle', 'Concorso · in evidenza', 'Concorso di design UI/UX per l’app della scuola', 'Progetta schermate, flussi e idee per rendere l’app più chiara e utile per tutti.', { unread: true, pinned: true, example: true });
  const circ = card('circolare', 'report', 'Circolare n. 00 · esempio', 'Esempio di circolare della Sede di Oleggio', 'Qui compaiono le circolari pubblicate dai docenti o importate dal sito della scuola, con il link alla fonte.', { unread: true });
  const feed = h('ol', { class: 'feed' }, [['upload', 'Marco ha caricato un file nel gruppo'], ['send', 'Luca ha sincronizzato un contributo dalla sua chat'], ['board', 'Elia ha spostato un’attività in “In corso”']].map(([ic, t]) => h('li', { class: 'feed-i' }, h('span', { class: 'feed-ic' }, icon(ic, 14)), h('span', { class: 'feed-t', text: t }), h('time', { class: 'small muted', text: 'ora' }))));
  const el = h('div', { class: 'page bb' }, [h('div', { class: 'hub-top' }, [h('div', null, h('h1', null, 'Bacheca ', h('span', { class: 'badge', text: '2 da leggere' })), h('p', { class: 'muted small', text: 'ITI Omar · Sede di Oleggio — circolari, avvisi, concorsi ed eventi.' })), btn('Segna tutto come letto', { sm: false, ic: 'check' })]),
    dv('bb-grid', [h('div', null, [dv('hx-chips', ['Tutto', 'Circolare', 'Avviso', 'Concorso', 'Evento'].map((t, i) => h('div', { class: 'hx-chip', 'aria-pressed': String(i === 0), text: t }))), dv('bb-list', [contest, circ])]),
      h('aside', { class: 'acc-card bb-feed' }, [h('h2', null, h('span', { class: 'live-dot' }), 'Dai tuoi gruppi, in diretta'), feed])])]);
  return { el, contest, feed };
}

// ───────── Quick Tools ─────────
export function quickTools() {
  const tabs = [['Unità', 'swap'], ['Calcolatrice', 'calc'], ['BIN/HEX', 'hash'], ['Code Runner', 'code'], ['Formatta', 'list']].map(([t, ic]) => h('div', { class: 'qt-tab', 'aria-selected': 'false' }, icon(ic, 15), t));
  const body = dv('qt-body');
  const el = h('div', { class: 'qt tut-qt' }, [dv('qt-head', [icon('tool', 18), h('strong', { text: 'Quick Tools' }), h('span', { class: 'qt-kb', text: 'Alt+T' }), h('span', { class: 'sp' }), h('div', { class: 'isl-ico' }, icon('x', 16))]), dv('qt-tabs', tabs), body]);
  const sel = (i) => tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
  const views = {
    conv: (v = '6') => { sel(0); body.replaceChildren(h('div', { class: 'tut-fakein dark', text: 'Pressione / tensione' }), dv('qt-conv', [h('div', { class: 'tut-fakein dark', text: v }), h('div', { class: 'tut-fakein dark', text: 'bar' }), h('div', { class: 'qt-swap' }, icon('swap', 15)), h('div', { class: 'tut-fakein dark', text: 'MPa' })]),
      dv('qt-result', `${v} bar = ${String(+v / 10).replace('.', ',')} MPa`), h('p', { class: 'qt-lbl', text: 'Lo stesso valore in tutte le unità' }), dv('qt-all', [['600.000', 'Pa'], ['600', 'kPa'], ['0,6', 'N/mm²'], ['87,02', 'psi']].map(([n, u]) => h('div', { class: 'qt-chip' }, h('strong', { text: n }), ` ${u}`)))); },
    calc: (expr = '', res = '') => { sel(1); body.replaceChildren(dv('qt-row', [h('div', { class: 'tut-fakein dark mono qt-expr', text: expr || ' ' }), h('div', { class: 'qt-chip', 'aria-pressed': 'true', text: 'Gradi (°)' })]), dv('qt-result', res), dv('qt-keys', ['(', ')', 'pi', '^', 'sqrt(', 'sin(', 'cos(', 'tan(', 'ln(', 'log(', 'ans', 'g'].map((k) => h('div', { class: 'qt-key', text: k })))); },
    code: (out = '') => { sel(3); body.replaceChildren(dv('qt-row', [h('div', { class: 'tut-fakein dark', text: 'JavaScript (nel browser)' }), h('span', { class: 'sp' }), btn('Esegui', { primary: true, ic: 'play', cls: 'tut-run' })]),
      h('pre', { class: 'qt-editor tut-code mono', text: 'const coppia = 12;   // N·m\nconst giri = 1450;   // giri/min\nconsole.log("Potenza:", (coppia * giri / 9549).toFixed(2), "kW");' }), h('pre', { class: 'qt-out', text: out }), h('p', { class: 'qt-note', text: 'Gira nel tuo browser, isolato e senza accesso a internet.' })); },
  };
  return { el, tabs, views, body };
}

// ───────── Account ─────────
export function accountPage() {
  const field = (label, text = '') => [h('label', { text: label }), h('div', { class: 'tut-fakein', text })];
  const meter = h('div', { class: 'pw-meter', dataset: { s: '-1' } }, [h('i'), h('i'), h('i'), h('i')]);
  const newPw = h('div', { class: 'tut-fakein', text: '' });
  const checks = h('ul', { class: 'pw-checks' }, ['Almeno 10 caratteri', 'Diversa da quella attuale', 'Le due password coincidono', 'Non contiene il tuo nome utente'].map((t) => h('li', null, icon('x', 13), t)));
  const change = btn('Cambia password', { primary: true, sm: false });
  const el = h('div', { class: 'page acc' }, dv('acc-grid', [dv('acc-col', [dv('acc-card', [dv('acc-hero', [h('div', { class: 'acc-av', text: 'E' }), h('div', null, h('h1', { text: 'Elia' }), h('p', { class: 'muted', text: 'Studente · elia.rossi@itiomar.net' }))]),
      dv('acc-stats', [['Chat', '12', 'clock'], ['File personali', '8', 'file'], ['Gruppi', '1', 'users']].map(([l, n, ic]) => dv('acc-stat', icon(ic, 18), h('strong', { text: n }), h('span', { text: l }))))]),
    dv('acc-card', [h('h2', null, icon('device', 19), 'Dove hai fatto l’accesso'), dv('acc-devs', [dv('acc-dev cur', [h('span', { class: 'acc-dev-ic' }, icon('device', 18)), dv('grow', h('strong', { text: 'Chrome su Windows' }), h('div', { class: 'small muted', text: 'Questo dispositivo' })), h('span', { class: 'badge ok', text: 'in uso' })]),
      dv('acc-dev', [h('span', { class: 'acc-dev-ic' }, icon('device', 18)), dv('grow', h('strong', { text: 'Chrome su Android' }), h('div', { class: 'small muted', text: 'ultimo uso ieri' })), btn('Disconnetti', { cls: 'tut-disc' })])])]),
    dv('acc-card', [h('h2', null, icon('volume', 19), 'Omar Voice'), h('label', { class: 'radio' }, h('span', { class: 'tut-check on' }), 'Leggi ad alta voce le risposte appena arrivano'), h('p', { class: 'small muted', text: 'Dettatura: premi il microfono accanto al campo di scrittura.' })])]),
  dv('acc-col', [h('div', { class: 'acc-card' }, [h('h2', null, icon('key', 19), 'Cambia la password'), ...field('Password attuale', '••••••••••'), h('label', { text: 'Nuova password' }), newPw, dv('pw-row', [meter, h('span', { class: 'small muted tut-mtxt', text: '' })]), ...field('Ripeti la nuova password', ''), checks, change]),
    dv('acc-card', [h('h2', null, icon('more', 19), 'Altro'), dv('acc-links', [['play', 'Rivedi il tutorial', 'Questo video, quando vuoi.'], ['lock', 'Privacy e dati', 'Scarica o elimina i tuoi dati.'], ['power', 'Esci', 'Chiude la sessione su questo dispositivo.']].map(([ic, t, d]) => h('div', { class: `acc-link${ic === 'power' ? ' danger' : ''}` }, icon(ic, 18), h('span', null, h('strong', { text: t }), h('small', { text: d })))))])])]));
  const typePw = (s) => { newPw.textContent = '•'.repeat(s.length); const n = s.length; const st = n === 0 ? -1 : n < 6 ? 0 : n < 10 ? 1 : n < 13 ? 3 : 4; meter.dataset.s = String(st); el.querySelector('.tut-mtxt').textContent = n ? `Robustezza: ${['Molto debole', 'Debole', 'Discreta', 'Buona', 'Ottima'][Math.max(0, st)]}` : ''; };
  const okChecks = () => { for (const li of checks.children) { li.classList.add('ok'); li.firstChild.replaceWith(icon('check', 13)); } };
  return { el, newPw, typePw, okChecks, change };
}
