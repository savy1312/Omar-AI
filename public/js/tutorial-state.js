// Stato del tutorial di primo accesso: «questa persona l'ha già visto?». Si salva nel browser (localStorage), una voce per account:
// sui PC condivisi della scuola ogni studente lo vede la prima volta che entra, senza che chi arriva dopo di lui lo salti.
// Se localStorage non è disponibile (navigazione privata, dati bloccati) lo stato vale finché la pagina resta aperta.
const PREFIX = 'omar.hasSeenTutorial';
export const TUTORIAL_VERSION = '2';   // cambiandolo, chi lo ha già visto lo rivede (2 = nuovo video con tutte le funzioni)
const memory = new Set();
const keyOf = (user) => `${PREFIX}.${user?.id ?? 'anon'}`;

export function hasSeenTutorial(user) {
  const k = keyOf(user);
  if (memory.has(k)) return true;
  try { return localStorage.getItem(k) === TUTORIAL_VERSION; } catch { return false; }
}
export function markTutorialSeen(user) {
  const k = keyOf(user); memory.add(k);
  try { localStorage.setItem(k, TUTORIAL_VERSION); } catch { /* salvato solo in memoria */ }
}
