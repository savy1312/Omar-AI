'use strict';
class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const E = {
  bad: (m = 'Richiesta non valida.', code = 'richiesta_non_valida', x) => new HttpError(400, code, m, x),
  unauth: (m = 'Accesso richiesto.') => new HttpError(401, 'non_autenticato', m),
  forbidden: (m = 'Non hai i permessi per questa operazione.') => new HttpError(403, 'non_autorizzato', m),
  notFound: (m = 'Risorsa non trovata.') => new HttpError(404, 'non_trovato', m),
  conflict: (m = 'Conflitto di versione.', x) => new HttpError(409, 'conflitto', m, x),
  tooLarge: (m = 'File troppo grande.') => new HttpError(413, 'troppo_grande', m),
  rate: (m = 'Troppe richieste. Riprova tra poco.', x) => new HttpError(429, 'troppe_richieste', m, x),
};
module.exports = { HttpError, E };
