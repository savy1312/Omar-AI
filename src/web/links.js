'use strict';
// Importazione di un link: il server legge la pagina (con le protezioni di safe-fetch), ne ricava il testo e lo salva come
// MATERIALE dello studente (personale o di gruppo). Così l'IA può spiegarlo, cercare nel testo e CITARLO con [M#], come per un PDF caricato.
const { HttpError, E } = require('../lib/errors');
const { now } = require('../lib/util');
const { RateLimiter } = require('../lib/ratelimit');
const { WebError } = require('./safe-fetch');
const { htmlToText } = require('./html');

const MAX_TEXT = 120_000;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function extractUrls(text, max = 2) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?)\]}»”’]+$/, '');
    if (u.length <= 2000 && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeFile = (s) => String(s || 'pagina').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pagina';
function asHttp(e) {
  if (!(e instanceof WebError)) return e;
  return new HttpError(e.code === 'url_non_valida' ? 400 : 422, e.code === 'url_non_valida' ? 'url_non_valida' : 'link_non_leggibile', e.message, { reason: e.code, retryable: e.code === 'timeout' || e.code === 'rete' });
}

function createLinks(ctx, { fetchPublic, decode, check }) {
  const { db, cfg, access, materials } = ctx;
  const limiter = new RateLimiter(cfg.web.linksPerMin, 60_000); ctx.limiters?.push(limiter);
  const enabled = cfg.web.linksEnabled;

  async function importUrl(user, { url, visibility = 'personale', projectId = null, subjectId = null, topicId = null, sessionId = null } = {}) {
    if (!enabled) throw E.forbidden('La lettura dei link è disattivata dall\'amministratore.');
    if (!['personale', 'gruppo', 'corso'].includes(visibility)) throw E.bad('Scegli chi può vedere il link: solo tu oppure il gruppo.', 'visibilita_mancante');
    if (visibility === 'gruppo') access.requireMember(user, projectId);
    if (visibility === 'corso' && user.role === 'student') throw E.forbidden('Solo i docenti possono aggiungere materiali del corso.');
    if (sessionId && !db.get('SELECT 1 x FROM chat_sessions WHERE id = ? AND user_id = ?', sessionId, user.id)) throw E.notFound('Sessione non trovata.');
    let target; try { target = check(url); } catch (e) { throw asHttp(e); }
    if (!limiter.allow(user.id)) throw E.rate('Stai importando molti link: attendi qualche secondo.', { retryAfterSec: limiter.retryAfterSec(user.id) });

    // stesso link già letto da poco dallo stesso utente (e ancora presente): si riusa, senza rifare la richiesta
    const since = new Date(Date.now() - 6 * 3600e3).toISOString();
    const again = db.get(`SELECT v.id vid, m.id mid FROM material_versions v JOIN materials m ON m.id = v.material_id
                          WHERE m.owner_id = ? AND m.visibility = ? AND COALESCE(m.project_id,'') = COALESCE(?,'') AND v.source_url = ? AND m.deleted_at IS NULL AND v.version = m.current_version AND v.status = 'pronto' AND v.created_at > ?`,
      user.id, visibility, visibility === 'gruppo' ? projectId : null, target.href, since);
    if (again) {
      if (sessionId) materials.pin(user, sessionId, again.mid);
      const material = materials.publicVersion(again.vid, user);
      return { material, title: material.name, host: hostOf(target.href), url: target.href, reused: true };
    }

    let page;
    try { page = await fetchPublic(target.href, { maxBytes: cfg.web.maxPageBytes }); } catch (e) { throw asHttp(e); }
    const host = hostOf(page.url) || hostOf(target.href);
    let file; let title = '';
    if (page.type === 'application/pdf') {
      const last = decodeURIComponent(new URL(page.url).pathname.split('/').filter(Boolean).pop() || '').replace(/\.pdf$/i, '');
      title = last.replace(/[-_]+/g, ' ').trim() || 'Documento PDF';
      file = { originalname: `${safeFile(last || host)}.pdf`, buffer: page.buffer };
    } else {
      const raw = decode(page.buffer, page.charset);
      const isHtml = page.type === 'text/html' || page.type === 'application/xhtml+xml';
      const x = isHtml ? htmlToText(raw, { max: MAX_TEXT }) : { title: '', text: raw.replace(/\r\n/g, '\n').slice(0, MAX_TEXT) };
      title = x.title || host;
      if (x.text.trim().length < 120) throw new HttpError(422, 'link_non_leggibile', 'Nella pagina non c\'è abbastanza testo da leggere (potrebbe richiedere JavaScript, un accesso o essere fatta di sole immagini).', { reason: 'poco_testo', retryable: false });
      const head = `Fonte web: ${page.url}\nTitolo: ${title}\nPagina letta il ${now().slice(0, 10)} (il contenuto online può cambiare).\n\n`;
      file = { originalname: `${safeFile(host)}.txt`, buffer: Buffer.from(head + x.text, 'utf8') };
    }
    const label = `${title}${title.toLowerCase().includes(host.toLowerCase()) ? '' : ` — ${host}`}`.slice(0, 120);
    const pub = materials.upload({ user, file, visibility, projectId, subjectId, topicId, name: label, sourceUrl: page.url, inline: true });
    await materials.process(pub.id);
    const material = materials.publicVersion(pub.id, user);
    if (material.status !== 'pronto') { try { materials.remove(user, material.materialId); } catch { /* già rimosso */ } throw new HttpError(422, 'link_non_leggibile', material.error || 'Non sono riuscito a leggere il contenuto del link.', { reason: 'estrazione', retryable: false }); }
    if (sessionId) materials.pin(user, sessionId, material.materialId);
    return { material, title, host, url: page.url, reused: false };
  }
  return { importUrl, extractUrls, enabled };
}
module.exports = { createLinks, extractUrls, hostOf };
