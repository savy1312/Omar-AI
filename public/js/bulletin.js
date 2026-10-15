// Bacheca (#/bulletin-board) della Sede di Oleggio: circolari, avvisi, concorsi (incluso quello di design UI/UX dell'app)
// ed eventi pubblicati da docenti e amministratori; accanto, il feed in tempo reale dei gruppi a cui partecipi.
import { h, add, clear, toast, dialog, confirmDialog, fmtDate, renderMarkdown } from './dom.js';
import { get, post, patch, del } from './api.js';
import { icon } from './icons.js';

const KIND_IC = { circolare: 'report', avviso: 'megaphone', concorso: 'sparkle', evento: 'calendar' };
const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');

export async function renderBulletin(main, S) {
  const page = h('div', { class: 'page bb' }); main.append(page);
  let data = null; let kind = ''; let q = ''; let openId = null;
  const list = h('div', { class: 'bb-list' }); const chips = h('div', { class: 'hx-chips', role: 'group', 'aria-label': 'Tipo' });
  const feed = h('ol', { class: 'feed', 'aria-live': 'polite' });
  const unread = h('span', { class: 'badge', hidden: true });
  const search = h('input', { type: 'search', class: 'msearch', placeholder: 'Cerca nella bacheca…', 'aria-label': 'Cerca nella bacheca', oninput: (e) => { q = e.target.value.trim(); clearTimeout(search.t); search.t = setTimeout(load, 250); } });
  add(page, [h('div', { class: 'hub-top' }, [h('div', null, h('h1', null, 'Bacheca ', unread), h('p', { class: 'muted small', text: 'ITI Omar · Sede di Oleggio — circolari, avvisi, concorsi ed eventi.' })),
    h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', onclick: async () => { try { await post('/bulletins/read-all'); load(); } catch (e) { toast(e.message, 'bad'); } } }, icon('check', 16), 'Segna tutto come letto'),
      S.isTeacher() && h('button', { class: 'btn', type: 'button', onclick: () => importDialog() }, icon('link', 16), 'Importa dal sito'),
      S.isTeacher() && h('button', { class: 'btn primary', type: 'button', onclick: () => editDialog() }, icon('plus', 16), 'Pubblica')])]),
  h('div', { class: 'bb-grid' }, [h('div', null, [h('div', { class: 'row bb-tools' }, [chips, h('span', { class: 'sp' }), search]), list]),
    h('aside', { class: 'acc-card bb-feed', 'aria-labelledby': 'bb-f' }, [h('h2', { id: 'bb-f' }, h('span', { class: 'live-dot', 'aria-hidden': true }), 'Dai tuoi gruppi, in diretta'), h('p', { class: 'small muted', text: 'Quando un compagno sincronizza un file, condivide dalla chat o aggiorna il progetto, lo vedi qui.' }), feed])])]);

  async function editDialog(b = null, draft = null) {
    const v = b || draft || {};
    const kindSel = h('select', { id: 'bb-k' }, Object.entries(data.kinds).map(([k, l]) => h('option', { value: k, text: l, selected: (v.kind || 'avviso') === k })));
    const num = h('input', { type: 'text', id: 'bb-n', maxLength: 30, value: v.number || '', placeholder: 'es. 45' });
    const title = h('input', { type: 'text', id: 'bb-t', maxLength: 160, value: v.title || '' });
    const bodyT = h('textarea', { id: 'bb-b', rows: 8, maxLength: 8000 }); bodyT.value = v.body || '';
    const link = h('input', { type: 'url', id: 'bb-l', value: v.link || '', placeholder: 'https://… (facoltativo)' });
    const dl = h('input', { type: 'date', id: 'bb-d', value: toLocal(v.deadlineAt) });
    const exp = h('input', { type: 'date', id: 'bb-e', value: toLocal(v.expiresAt) });
    const pin = h('input', { type: 'checkbox', id: 'bb-p', checked: !!v.pinned });
    const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const r = await dialog(b ? 'Modifica avviso' : 'Pubblica in bacheca', h('div', null, [h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'bb-k', text: 'Tipo' }), kindSel), h('div', null, h('label', { for: 'bb-n', text: 'Numero' }), num)]),
      h('label', { for: 'bb-t', text: 'Titolo' }), title, h('label', { for: 'bb-b', text: 'Testo (puoi usare **grassetto** ed elenchi con -)' }), bodyT, h('label', { for: 'bb-l', text: 'Link alla fonte' }), link,
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, h('label', { for: 'bb-d', text: 'Data limite (es. iscrizioni)' }), dl), h('div', { class: 'grow' }, h('label', { for: 'bb-e', text: 'Togli dalla bacheca dopo il' }), exp)]),
      h('label', { class: 'radio', for: 'bb-p' }, pin, 'Fissa in alto'), err]), [
      ...(b ? [{ label: 'Elimina', danger: true, onClick: async () => { if (!(await confirmDialog('Eliminare l’avviso?', `“${b.title}” sparirà dalla bacheca di tutti.`, { ok: 'Elimina', danger: true }))) return false; try { await del(`/bulletins/${b.id}`); return 'x'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }] : []),
      { label: 'Annulla', value: null },
      { label: b ? 'Salva' : 'Pubblica', primary: true, onClick: async () => {
        const p = { kind: kindSel.value, number: num.value, title: title.value, body: bodyT.value, link: link.value || null, pinned: pin.checked, deadlineAt: dl.value ? new Date(`${dl.value}T23:59:00`).toISOString() : null, expiresAt: exp.value ? new Date(`${exp.value}T23:59:00`).toISOString() : null };
        try { if (b) await patch(`/bulletins/${b.id}`, p); else await post('/bulletins', p); return 'ok'; } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
      } }]);
    if (r) { toast(b ? 'Avviso aggiornato.' : 'Pubblicato in bacheca.'); load(); }
  }
  async function importDialog() {
    const url = h('input', { type: 'url', id: 'bb-u', placeholder: 'https://… (pagina pubblica del sito della scuola)' });
    const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const d = await dialog('Importa una circolare dal sito', h('div', null, [h('label', { for: 'bb-u', text: 'Indirizzo della pagina o del PDF' }), url, h('p', { class: 'small muted', text: 'Il server legge la pagina pubblica e prepara una bozza con titolo, testo e link alla fonte: la rivedi prima di pubblicarla.' }), err]),
      [{ label: 'Annulla', value: null }, { label: 'Leggi la pagina', primary: true, onClick: async () => { try { return (await post('/bulletins/draft-from-url', { url: url.value })).draft; } catch (e) { err.textContent = e.message; err.hidden = false; return false; } } }]);
    if (d) editDialog(null, d);
  }
  function card(b) {
    const exp = openId === b.id;
    const longBody = b.body.length > 260;
    const el = h('article', { class: `bb-card k-${b.kind}${b.read ? '' : ' unread'}${b.pinned ? ' pinned' : ''}` }, [
      h('header', { class: 'bb-h' }, [h('span', { class: 'bb-ic', 'aria-hidden': true }, icon(KIND_IC[b.kind], 18)), h('div', { class: 'grow' }, [
        h('div', { class: 'bb-kicker' }, [b.kindLabel, b.number ? ` n. ${b.number}` : '', ` · ${new Date(b.publishedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`, b.pinned ? ' · in evidenza' : '']),
        h('h3', { class: 'bb-t', text: b.title })]), !b.read && h('span', { class: 'bb-new', text: 'nuovo' })]),
      b.example && h('p', { class: 'notice warn', role: 'note', text: 'Voce da completare a cura della scuola: regolamento, date e premi non sono ancora stati pubblicati.' }),
      h('div', { class: `bb-body${exp || !longBody ? '' : ' clamp'}` }, renderMarkdown(b.body)),
      h('footer', { class: 'bb-f' }, [b.deadlineAt && h('span', { class: 'kb-due soon' }, icon('calendar', 12), `entro il ${new Date(b.deadlineAt).toLocaleDateString('it-IT')}`),
        b.link && /^https?:\/\//i.test(b.link) && h('a', { class: 'btn sm', href: b.link, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 13), `${b.linkHost || 'Fonte'} ↗`), h('span', { class: 'sp' }),
        longBody && h('button', { class: 'btn sm ghost', type: 'button', text: exp ? 'Riduci' : 'Leggi tutto', onclick: () => { openId = exp ? null : b.id; if (!b.read) markRead(b, true); else draw(); } }),
        h('button', { class: 'btn sm ghost', type: 'button', text: b.read ? 'Segna come da leggere' : 'Segna come letto', onclick: () => markRead(b, !b.read) }),
        b.canEdit && h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Modifica ${b.title}`, onclick: () => editDialog(b) }, icon('edit', 14))]),
    ]);
    return el;
  }
  async function markRead(b, read) { try { const r = await post(`/bulletins/${b.id}/read`, { read }); b.read = read; data.unread = r.unread; S.setBulletinUnread?.(r.unread); draw(); } catch (e) { toast(e.message, 'bad'); } }
  function draw() {
    clear(chips); clear(list);
    unread.hidden = !data.unread; unread.textContent = `${data.unread} da leggere`;
    for (const [k, l] of [['', 'Tutto'], ...Object.entries(data.kinds)]) chips.append(h('button', { type: 'button', class: 'hx-chip', 'aria-pressed': String(kind === k), text: l, onclick: () => { kind = k; load(); } }));
    if (!data.items.length) { list.append(h('div', { class: 'empty-state small' }, icon('megaphone', 26), h('p', { class: 'muted', text: q || kind ? 'Nessun avviso corrisponde.' : 'La bacheca è vuota.' }))); return; }
    for (const b of data.items) list.append(card(b));
  }
  async function load() {
    try { data = await get(`/bulletins?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(q ? { q } : {}) })}`); S.setBulletinUnread?.(data.unread); draw(); } catch (e) { clear(list); list.append(h('p', { class: 'err', text: e.message })); }
  }
  const feedItem = (x) => h('li', { class: `feed-i${x.mine ? ' mine' : ''}` }, h('span', { class: 'feed-ic', 'aria-hidden': true }, icon(x.icon, 14)), h('span', { class: 'feed-t' }, x.text, h('span', { class: 'small muted', text: ` · ${x.projectName}` })), h('time', { class: 'small muted', dateTime: x.at, text: fmtDate(x.at) }));
  async function loadFeed() {
    try { const r = await get('/feed?limit=25'); clear(feed); if (!r.items.length) feed.append(h('li', { class: 'muted small', text: S.projects.length ? 'Ancora nessuna attività nei tuoi gruppi.' : 'Non sei ancora in un gruppo: collegati a un compagno per vedere qui cosa succede.' })); for (const x of r.items) feed.append(feedItem(x)); } catch { /* il feed è facoltativo */ }
  }
  await Promise.all([load(), loadFeed()]);
  let t = 0;
  return S.on((ev) => {
    if (ev.type === 'notify' && ev.event?.type === 'bulletin.updated') load();
    if (ev.seq) { clearTimeout(t); t = setTimeout(loadFeed, 300); }
  });
}
