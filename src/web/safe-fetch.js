'use strict';
// Lettura di pagine web per conto dello studente, con protezioni contro l'uso del server come "ponte" verso reti interne (SSRF):
//  - solo http/https, solo porte 80/443, niente nome utente/password nell'indirizzo;
//  - nomi e indirizzi non pubblici rifiutati (loopback, reti private, link-local, metadati cloud, CGNAT, multicast, IPv6 locale e indirizzi IPv4 "nascosti" in IPv6);
//  - il controllo avviene NEL MOMENTO della connessione (lookup personalizzato): un DNS che cambia risposta dopo il controllo non aggira la regola;
//  - reindirizzamenti seguiti a mano (max 4) e ricontrollati a ogni passo; tempo massimo complessivo; dimensione massima della risposta; solo tipi di contenuto ammessi.
// Limite noto: se la rete scolastica obbliga a passare da un proxy, la connessione diretta può fallire (vedi docs).
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');

class WebError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

// ── indirizzi non pubblici ──
const bl = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) bl.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001::', 32], ['2001:db8::', 32], ['100::', 64]]) bl.addSubnet(a, p, 'ipv6');

function expandV6(input) { // → 8 numeri a 16 bit, oppure null
  let ip = String(input).split('%')[0];
  const m = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const p = m[2].split('.').map(Number); if (p.length !== 4 || p.some((x) => x > 255)) return null; ip = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`; }
  const halves = ip.split('::'); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : []; const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let all;
  if (halves.length === 1) { if (head.length !== 8) return null; all = head; } else { const fill = 8 - head.length - tail.length; if (fill < 0) return null; all = [...head, ...Array(fill).fill('0'), ...tail]; }
  const nums = all.map((x) => (/^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}
const v4of = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
function isPublicIp(ip) {
  if (net.isIPv4(ip)) return !bl.check(ip, 'ipv4');
  if (!net.isIPv6(ip)) return false;
  const h = expandV6(ip); if (!h) return false;
  const lead0 = (n) => h.slice(0, n).every((x) => x === 0);
  if (lead0(5) && h[5] === 0xffff) return isPublicIp(v4of(h[6], h[7]));          // ::ffff:a.b.c.d (IPv4 mappato)
  if (lead0(6) && !(h[6] === 0 && h[7] <= 1)) return isPublicIp(v4of(h[6], h[7])); // ::a.b.c.d (compatibile, obsoleto)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPublicIp(v4of(h[6], h[7])); // NAT64
  if (h[0] === 0x2002) return isPublicIp(v4of(h[1], h[2]));                      // 6to4
  return !bl.check(ip, 'ipv6');
}

const BAD_SUFFIX = /\.(localhost|local|internal|lan|home|corp|intranet|test|invalid|example)$/i;
function parseTarget(raw, { allowPrivate = false, ports = [80, 443], isPublic = isPublicIp } = {}) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new WebError('url_non_valida', 'Indirizzo non valido: incolla un link completo che inizi con http:// o https://.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new WebError('url_non_valida', 'Sono ammessi solo link http:// o https://.');
  if (u.username || u.password) throw new WebError('url_non_valida', 'Il link non può contenere nome utente o password.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.length > 253) throw new WebError('url_non_valida', 'Indirizzo non valido.');
  if (!allowPrivate) {
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    const blocked = () => new WebError('host_non_consentito', 'Per sicurezza non apro indirizzi della rete locale, privati o non pubblici.');
    if (ports && !ports.includes(port)) throw new WebError('host_non_consentito', 'Per sicurezza apro solo link sulle porte web standard (80 e 443).');
    if (net.isIP(host)) { if (!isPublic(host)) throw blocked(); } else if (!host.includes('.') || BAD_SUFFIX.test(host)) throw blocked();
  }
  return u;
}

const OK_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'text/csv', 'application/pdf']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// Le opzioni lookup / isPublic / ports servono SOLO alle prove automatiche (DNS finto, server locali); in produzione restano quelle sicure.
function createSafeFetch(cfgWeb, { lookup: lookupOverride, isPublic = isPublicIp, ports } = {}) {
  const portRule = ports === undefined ? [80, 443] : ports;
  const baseLookup = lookupOverride || ((host, opts, cb) => dns.lookup(host, opts, cb));

  function once(u, { allowPrivate, deadline, maxBytes, accept, headers, types }) {
    return new Promise((resolve, reject) => {
      const mod = u.protocol === 'https:' ? https : http;
      const lookup = (hostname, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        baseLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
          if (err) return cb(err);
          const list = (Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIPv6(addrs) ? 6 : 4 }]);
          if (!list.length) return cb(new Error('nessun indirizzo'));
          if (!allowPrivate && list.some((a) => !isPublic(a.address))) { const e = new Error('indirizzo non consentito'); e.code = 'EBLOCKED'; return cb(e); } // basta UN indirizzo non pubblico
          return opts?.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
        });
      };
      const left = deadline - Date.now(); if (left <= 0) return reject(new WebError('timeout', 'La pagina ha impiegato troppo tempo a rispondere.'));
      let done = false; const fail = (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } };
      const req = mod.request({ protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: `${u.pathname}${u.search}`, method: 'GET', agent: false, lookup,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmarAI/1.0; lettura di una pagina richiesta da uno studente)', accept: accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.1', 'accept-language': 'it-IT,it;q=0.9,en;q=0.6', 'accept-encoding': 'gzip, deflate, br', ...headers } });
      const timer = setTimeout(() => { req.destroy(); fail(new WebError('timeout', 'La pagina ha impiegato troppo tempo a rispondere.')); }, left);
      req.on('error', (e) => fail(e.code === 'EBLOCKED' ? new WebError('host_non_consentito', 'Per sicurezza non apro indirizzi della rete locale, privati o non pubblici.')
        : e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? new WebError('rete', 'Non trovo questo sito: controlla l’indirizzo.')
        : new WebError('rete', 'Non riesco a collegarmi a questo sito.')));
      req.on('response', (res) => {
        const status = res.statusCode || 0;
        if (REDIRECTS.has(status)) { res.resume(); clearTimeout(timer); done = true; return resolve({ isRedirect: true, redirect: res.headers.location || '', status }); }
        const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || 'text/html';
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(String(res.headers['content-type'] || ''))?.[1] || null;
        if (status >= 400) { res.resume(); return fail(new WebError('http_errore', status === 404 ? 'Pagina non trovata (errore 404).' : status === 401 || status === 403 ? 'Il sito richiede l’accesso oppure blocca la lettura automatica (errore ' + status + ').' : status === 429 ? 'Il sito sta limitando le richieste: riprova tra poco.' : `Il sito ha risposto con un errore (${status}).`, { status })); }
        if (status < 200 || status >= 300) { res.resume(); return fail(new WebError('http_errore', `Risposta inattesa dal sito (${status}).`, { status })); }
        if (!(types || OK_TYPES).has(type)) { res.resume(); return fail(new WebError('tipo_non_supportato', 'Questo tipo di contenuto non è leggibile (accetto pagine web, testo e PDF).')); }
        const cap = type === 'application/pdf' ? Math.max(maxBytes, cfgWeb.pdfBytes || 0) : maxBytes;
        const declared = Number(res.headers['content-length']); if (declared > cap) { res.destroy(); return fail(new WebError('troppo_grande', 'La pagina è troppo grande per essere letta.')); }
        const parts = []; let size = 0;
        res.on('data', (c) => { size += c.length; if (size > cap) { res.destroy(); fail(new WebError('troppo_grande', 'La pagina è troppo grande per essere letta.')); } else parts.push(c); });
        res.on('error', () => fail(new WebError('rete', 'Connessione interrotta durante la lettura.')));
        res.on('end', () => {
          if (done) return;
          try {
            let buf = Buffer.concat(parts); const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
            const opt = { maxOutputLength: cap };
            if (enc === 'gzip' || enc === 'x-gzip') buf = zlib.gunzipSync(buf, opt); else if (enc === 'deflate') buf = zlib.inflateSync(buf, opt); else if (enc === 'br') buf = zlib.brotliDecompressSync(buf, opt); else if (enc && enc !== 'identity') throw new WebError('tipo_non_supportato', 'Codifica della risposta non supportata.');
            clearTimeout(timer); done = true; resolve({ status, type, charset, buffer: buf });
          } catch (e) { fail(e instanceof WebError ? e : new WebError('troppo_grande', 'La pagina è troppo grande o danneggiata.')); }
        });
      });
      req.end();
    });
  }

  // Legge un indirizzo pubblico. opts: { allowPrivate, maxBytes, accept, headers, timeoutMs, types (insieme di tipi MIME ammessi) }
  async function fetchPublic(raw, opts = {}) {
    const allowPrivate = opts.allowPrivate ?? cfgWeb.allowPrivate;
    const deadline = Date.now() + (opts.timeoutMs || cfgWeb.timeoutMs);
    let u = parseTarget(raw, { allowPrivate, ports: portRule, isPublic });
    for (let hop = 0; hop <= 4; hop++) {
      const r = await once(u, { allowPrivate, deadline, maxBytes: opts.maxBytes || cfgWeb.maxPageBytes, accept: opts.accept, headers: opts.headers, types: opts.types });
      if (!r.isRedirect) return { url: u.href, status: r.status, type: r.type, charset: r.charset, buffer: r.buffer };
      if (!r.redirect) throw new WebError('http_errore', 'Reindirizzamento non valido.');
      let next; try { next = new URL(r.redirect, u); } catch { throw new WebError('http_errore', 'Reindirizzamento non valido.'); }
      u = parseTarget(next.href, { allowPrivate, ports: portRule, isPublic }); // il nuovo indirizzo passa gli stessi controlli
    }
    throw new WebError('troppi_reindirizzamenti', 'Il link rimanda a troppi indirizzi di seguito.');
  }

  // Decodifica il testo rispettando il charset dichiarato (header o <meta>); in caso di dubbio UTF-8.
  function decode(buf, charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const meta = charset || /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] || /charset=([\w-]+)/i.exec(head)?.[1] || 'utf-8';
    try { return new TextDecoder(meta, { fatal: false }).decode(buf); } catch { return buf.toString('utf8'); }
  }
  const check = (raw, allowPrivate) => parseTarget(raw, { allowPrivate: allowPrivate ?? cfgWeb.allowPrivate, ports: portRule, isPublic }); // controllo dell'indirizzo senza collegarsi
  return { fetchPublic, decode, check };
}
module.exports = { createSafeFetch, parseTarget, isPublicIp, WebError, OK_TYPES };
