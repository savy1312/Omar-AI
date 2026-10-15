'use strict';
// Ricerca sul web per il tasto «Cerca». Parte SOLO dal server, solo quando lo studente attiva «Cerca» e invia una domanda.
// Motori: duckduckgo (nessuna chiave, ma è la pagina HTML pubblica: NON è un'API ufficiale e può smettere di funzionare),
// brave (API ufficiale, serve BRAVE_API_KEY), searxng (istanza della scuola, SEARXNG_URL), off.
// I risultati sono DATI non fidati: titoli e testi passano da neutralize() e arrivano al modello dentro <contesto_web>.
const { E } = require('../lib/errors');
const { scrubPII } = require('../lib/util');
const { RateLimiter } = require('../lib/ratelimit');
const { neutralize } = require('../engine/injection');
const { WebError } = require('./safe-fetch');
const { htmlToText, decodeEntities } = require('./html');

const LABEL = { duckduckgo: 'DuckDuckGo', brave: 'Brave Search', searxng: 'il motore di ricerca della scuola (SearXNG)' };
const JSON_TYPES = new Set(['application/json', 'text/json']);
const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Da una domanda dello studente a una stringa di ricerca: senza link, codice o dati personali, breve.
function buildQuery(text, subjectName) {
  let q = scrubPII(String(text || '')).replace(/\[(?:email rimossa|numero rimosso)\]/g, ' ').replace(/https?:\/\/\S+/gi, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>$\\{}[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length > 200) q = q.slice(0, 200).replace(/\s+\S*$/, '');
  if (q && q.split(' ').length < 4 && subjectName) q = `${q} ${subjectName}`; // domande molto brevi: si aggiunge la materia per chiarire il contesto
  return q;
}

function parseDdg(html, max) {
  const out = []; let pos = 0;
  while (out.length < max * 2) {
    const i = html.indexOf('result__a', pos); if (i < 0) break;
    const aStart = html.lastIndexOf('<a', i); const open = html.indexOf('>', i); const aEnd = html.indexOf('</a>', open);
    if (aStart < 0 || open < 0 || aEnd < 0) break;
    const href = /href="([^"]+)"/.exec(html.slice(aStart, open + 1))?.[1];
    const title = stripTags(html.slice(open + 1, aEnd)); pos = aEnd;
    const next = html.indexOf('result__a', pos); const sn = html.indexOf('result__snippet', pos);
    let snippet = '';
    if (sn >= 0 && (next < 0 || sn < next)) { const ss = html.indexOf('>', sn) + 1; const se = html.indexOf('</a>', ss); snippet = stripTags(html.slice(ss, se < 0 ? ss + 500 : se)); }
    if (!href || !title) continue;
    let url;
    try {
      const u = new URL(decodeEntities(href), 'https://duckduckgo.com');
      if (u.hostname.endsWith('duckduckgo.com')) { if (u.pathname.startsWith('/l/') && u.searchParams.get('uddg')) url = u.searchParams.get('uddg'); else continue; } // il resto sono pubblicità o pagine interne
      else url = u.href;
    } catch { continue; }
    out.push({ title, url, snippet });
  }
  return out;
}

function createWebSearch(ctx, { fetchPublic, decode, check }) {
  const { cfg, log } = ctx; const w = cfg.web;
  let provider = w.searchProvider;
  if (provider === 'brave' && !w.braveKey) { log.warn('ricerca web: BRAVE_API_KEY mancante, ricerca disattivata'); provider = 'off'; }
  if (provider === 'searxng' && !w.searxngUrl) { log.warn('ricerca web: SEARXNG_URL mancante, ricerca disattivata'); provider = 'off'; }
  if (!LABEL[provider]) provider = 'off';
  const limiter = new RateLimiter(w.searchPerMin, 60_000); ctx.limiters?.push(limiter);

  const providers = {
    async duckduckgo(q) {
      const url = new URL(w.ddgUrl); url.searchParams.set('q', q); url.searchParams.set('kl', 'it-it'); url.searchParams.set('kp', '1'); // kp=1: ricerca sicura attiva (utenti spesso minorenni)
      const r = await fetchPublic(url.href, { maxBytes: 1_500_000, timeoutMs: 7000, accept: 'text/html' });
      const html = decode(r.buffer, r.charset);
      const found = parseDdg(html, w.maxResults);
      if (!found.length && /anomaly|challenge|captcha|unusual traffic/i.test(html)) throw new WebError('ricerca_bloccata', 'Il motore di ricerca ha bloccato la richiesta automatica. Riprova più tardi.');
      return found;
    },
    async brave(q) {
      const url = new URL(w.braveUrl); url.searchParams.set('q', q); url.searchParams.set('count', String(w.maxResults)); url.searchParams.set('search_lang', 'it'); url.searchParams.set('country', 'it'); url.searchParams.set('safesearch', 'strict');
      const r = await fetchPublic(url.href, { maxBytes: 1_000_000, timeoutMs: 7000, accept: 'application/json', headers: { 'x-subscription-token': w.braveKey }, types: JSON_TYPES });
      const j = JSON.parse(decode(r.buffer, r.charset));
      return (j.web?.results || []).map((x) => ({ title: stripTags(x.title), url: x.url, snippet: stripTags(x.description) }));
    },
    async searxng(q) {
      const url = new URL('/search', w.searxngUrl); url.searchParams.set('q', q); url.searchParams.set('format', 'json'); url.searchParams.set('language', 'it'); url.searchParams.set('safesearch', '2');
      const r = await fetchPublic(url.href, { allowPrivate: true, maxBytes: 1_000_000, timeoutMs: 7000, accept: 'application/json', types: JSON_TYPES }); // l'indirizzo lo ha scelto l'amministratore: può stare nella rete della scuola
      const j = JSON.parse(decode(r.buffer, r.charset));
      return (j.results || []).map((x) => ({ title: stripTags(x.title), url: x.url, snippet: stripTags(x.content) }));
    },
  };

  async function search(user, text, { subjectName } = {}) {
    if (provider === 'off') throw new WebError('ricerca_non_disponibile', 'La ricerca sul web non è attiva su questo server.');
    const q = buildQuery(text, subjectName);
    if (q.length < 3) throw new WebError('ricerca_non_disponibile', 'La domanda è troppo breve per cercare sul web.');
    if (!limiter.allow(user.id)) throw E.rate('Hai fatto molte ricerche sul web in poco tempo: attendi qualche secondo.', { retryAfterSec: limiter.retryAfterSec(user.id) });
    let raw;
    try { raw = await providers[provider](q); } catch (e) {
      if (e instanceof WebError) throw e.code === 'http_errore' || e.code === 'rete' || e.code === 'timeout' ? new WebError('ricerca_non_disponibile', 'Il motore di ricerca non risponde in questo momento.') : e;
      throw new WebError('ricerca_non_disponibile', 'Non sono riuscito a leggere i risultati della ricerca.');
    }
    // solo indirizzi web pubblici e ben formati, senza doppioni
    const seen = new Set(); const results = [];
    for (const r of raw) {
      let u; try { u = check(r.url); } catch { continue; }
      const key = u.hostname + u.pathname; if (seen.has(key)) continue; seen.add(key);
      results.push({ ref: `W${results.length + 1}`, title: r.title.slice(0, 140), url: u.href, host: hostOf(u.href), snippet: r.snippet.slice(0, 320), excerpt: '' });
      if (results.length >= w.maxResults) break;
    }
    // lettura per intero delle prime pagine (in parallelo, con tempo limite): se non riesce resta l'anteprima del motore di ricerca
    const toRead = results.slice(0, w.fetchPages);
    await Promise.allSettled(toRead.map(async (r) => {
      const p = await fetchPublic(r.url, { maxBytes: 1_500_000, timeoutMs: 6000, accept: 'text/html,text/plain', types: new Set(['text/html', 'application/xhtml+xml', 'text/plain']) });
      const x = p.type === 'text/plain' ? { text: decode(p.buffer, p.charset) } : htmlToText(decode(p.buffer, p.charset), { max: 20_000 });
      const text = x.text.replace(/\s+/g, ' ').trim();
      if (text.length > 200) r.excerpt = text.slice(0, 2200);
    }));
    return { query: q, provider, label: LABEL[provider], results };
  }

  // Blocco di contesto per il modello. Tutto ciò che viene dal web è neutralizzato: sono dati, non istruzioni.
  function format(web) {
    if (!web?.results?.length) return '';
    return '<contesto_web>\n' + web.results.map((r) => `[${r.ref}] ${neutralize(r.title).text} (${r.host})${r.excerpt ? ' — testo letto dalla pagina' : ' — solo anteprima del motore di ricerca'}:\n${neutralize(r.excerpt || r.snippet || '(nessuna anteprima)').text}`).join('\n\n') + '\n</contesto_web>';
  }
  return { enabled: provider !== 'off', provider, label: LABEL[provider] || null, search, format, buildQuery };
}
module.exports = { createWebSearch, buildQuery, parseDdg };
