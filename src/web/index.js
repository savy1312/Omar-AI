'use strict';
const { createSafeFetch, WebError } = require('./safe-fetch');
const { createLinks } = require('./links');
const { createWebSearch } = require('./search');

// Accesso al web: lettore di pagine sicuro + importazione di link + ricerca. `over.lookup` serve solo alle prove (DNS finto).
function createWeb(ctx, over = {}) {
  const { cfg, log } = ctx;
  if (cfg.web.allowPrivate) log.warn('ALLOW_PRIVATE_LINKS attivo: la protezione contro l\'accesso a reti interne è SPENTA (solo per prove locali)');
  const sf = createSafeFetch({ ...cfg.web, pdfBytes: cfg.limits.maxUploadBytes }, { lookup: over.lookup, isPublic: over.isPublic, ports: over.ports });
  return { ...sf, links: createLinks(ctx, sf), search: createWebSearch(ctx, sf), WebError };
}
module.exports = { createWeb };
