// Privacy e trasparenza: dove vanno i dati, cosa viene conservato, esportazione ed eliminazione.
import { h, add, toast, dialog } from './dom.js';
import { get, del, auth } from './api.js';

export async function renderPrivacy(main, S) {
  const ai = S.info.ai; const lim = S.info.limits;
  const exportData = async () => {
    try { const data = await get('/me/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'i-miei-dati-assistente-omar.json' }); document.body.append(a); a.click(); a.remove(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  add(main, h('div', { class: 'page' }, [h('h1', { text: 'Privacy e trasparenza' }),
    h('div', { class: 'card' }, [h('h2', { text: 'Dove vanno le tue domande' }), h('p', { text: ai.notice }), h('p', { class: 'small muted', text: S.info.sync }),
      h('p', null, h('span', { class: `badge ${ai.simulated ? 'sim' : ai.dataLeavesNetwork ? 'warn' : 'ok'}`, text: ai.simulated ? 'Modalità simulazione' : ai.dataLeavesNetwork ? 'Provider IA esterno' : 'Modello nella rete locale' }), ai.model && ` Modello: ${ai.model}`)]),
    h('div', { class: 'card', style: 'margin-top:1rem' }, [h('h2', { text: 'Cosa viene conservato' }), h('ul', null, [
      h('li', { text: `Le tue conversazioni: solo tu puoi leggerle (nemmeno i docenti). Vengono cancellate automaticamente dopo ${lim.retentionChatDays} giorni, o prima se le elimini tu.` }),
      h('li', { text: 'I file che carichi: personali (solo tuoi) o condivisi col gruppo. Immagini e CAD non vengono interpretati dall’IA.' }),
      h('li', { text: 'Ciò che condividi col gruppo resta visibile ai partecipanti; se ti ritiri o ritiri un contributo, viene oscurato.' }),
      h('li', { text: 'I registri tecnici del server non contengono il testo delle conversazioni né dei documenti.' })]),
      h('p', { class: 'small muted', text: 'Una revoca non può cancellare le copie che qualcuno ha già scaricato o copiato.' })]),
    h('div', { class: 'card', style: 'margin-top:1rem' }, [h('h2', { text: 'I tuoi diritti' }),
      h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: 'Scarica i miei dati', onclick: exportData }),
        h('button', { class: 'btn danger', type: 'button', text: 'Elimina tutte le mie conversazioni', onclick: async () => { if (await dialog('Eliminare le conversazioni?', h('p', { text: 'Tutte le tue chat verranno cancellate dal server. Non si può annullare.' }), [{ label: 'Annulla', value: false }, { label: 'Elimina', value: true, danger: true }])) { try { const r = await del('/me/sessions'); toast(`Eliminate ${r.deleted ?? ''} conversazioni.`); } catch (e) { toast(e.message, 'bad'); } } } }),
        h('button', { class: 'btn danger', type: 'button', text: 'Elimina il mio account e i miei dati', onclick: async () => {
          const c = h('input', { type: 'text', 'aria-label': 'Scrivi ELIMINA', placeholder: 'ELIMINA' });
          if (await dialog('Eliminare l’account?', h('div', null, [h('p', { text: 'Verranno cancellate chat e file personali; i contributi condivisi col gruppo vengono resi anonimi. Per confermare scrivi ELIMINA.' }), c]), [{ label: 'Annulla', value: false }, { label: 'Elimina tutto', value: true, danger: true }])) {
            try { await del('/me/data', { confirm: c.value }); auth.token = null; location.reload(); } catch (e) { toast(e.message, 'bad'); } } } })])]),
    h('p', { class: 'small muted', style: 'margin-top:1rem', text: 'Questo strumento è un supporto allo studio. Non sostituisce il docente, non certifica la sicurezza di macchine o impianti e non è una valutazione ufficiale.' }),
  ]));
}
