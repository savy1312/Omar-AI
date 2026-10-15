'use strict';
class ProviderError extends Error {
  constructor(code, message, { retryable = true, status } = {}) { super(message); this.code = code; this.retryable = retryable; this.status = status; }
}
// Messaggi comprensibili per studenti (mai dettagli tecnici o chiavi).
const FRIENDLY = {
  timeout: 'Il servizio IA ha impiegato troppo tempo a rispondere. Puoi riprovare.',
  unavailable: 'Il servizio IA non è raggiungibile in questo momento. Puoi riprovare tra qualche istante.',
  rate_limited: 'Il servizio IA è molto richiesto. Attendi qualche secondo e riprova.',
  auth: "Il servizio IA non è configurato correttamente. Avvisa il docente o l'amministratore.",
  bad_response: 'La risposta del servizio IA non è utilizzabile. Puoi riprovare.',
  not_configured: "Il servizio IA non è configurato. Avvisa il docente o l'amministratore.",
  demo_unsupported: 'Funzione non disponibile in modalità simulazione.',
};
module.exports = { ProviderError, friendly: (c) => FRIENDLY[c] || FRIENDLY.unavailable };
