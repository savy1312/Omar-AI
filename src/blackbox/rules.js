'use strict';
// REGOLE DETERMINISTICHE della Scatola Nera. Funzioni pure: stessi dati -> stessi avvisi.
// Livelli: 'verificato' = incoerenza aritmetica/dimensionale accertata da una regola sui DATI DICHIARATI;
//          'possibile' = da verificare (manca un confronto); 'dati_insufficienti' = servono informazioni.
// NON sono certificazioni di sicurezza e non confrontano mai grandezze fisiche di natura diversa.
const crypto = require('node:crypto');
const { toSI, QUANTITIES, DIM_LABEL } = require('./units');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = (n) => { const a = Math.abs(n); return Number(a >= 100 ? n.toFixed(1) : a >= 1 ? n.toFixed(2) : n.toPrecision(3)).toString(); };
const fp = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
const STRUCT_RX = /(support|struttur|telaio|staffa|basament|mensol|piastra|\bbase\b|carter|castello)/;
const LOAD_NAME_RX = /(carico|forza|reazione|peso)/;
const ARM_NAME_RX = /(braccio|raggio|interasse|distanza)/;
const ref = (p) => ({ type: 'parametro', id: p.id, label: `${p.component} › ${p.name} = ${fmt(p.value)} ${p.unit}` });
const src = (p) => ({ type: 'parametro', id: p.id, author: p.author_label, at: p.created_at, version: p.version });

function enrich(p) {
  const si = toSI(p.value, p.unit);
  return { ...p, _dim: si?.dim || null, _si: si?.si ?? null, _c: norm(p.component), _n: norm(p.name), _l: norm(p.linked_to) };
}
const linked = (a, b) => {
  const hit = (l, c) => l && c && (c.includes(l) || l.includes(c));
  return hit(a._l, b._c) || hit(b._l, a._c);
};
const close = (x, y, rel = 1e-6) => Math.abs(x - y) <= rel * Math.max(1, Math.abs(x), Math.abs(y));

function evaluate(rawParams, decisions = []) {
  const all = rawParams.map(enrich);
  const params = all.filter((p) => p.status === 'attivo');
  const out = [];
  const add = (a) => out.push({ origin: 'regola', missing: [], sources: [], ...a });

  // R1 — unità incompatibile con la grandezza dichiarata / unità non riconosciuta
  for (const p of params) {
    const expected = QUANTITIES[p.quantity];
    if (p._dim === null) {
      add({ rule_id: 'R1_UNITA', level: 'dati_insufficienti', priority: 'media', priority_reason: 'Con un\'unità non riconosciuta non si può confrontare il dato con gli altri.',
        title: 'Unità di misura non riconosciuta', involved: [ref(p)], sources: [src(p)],
        reason: `L'unità "${p.unit}" indicata per "${p.component} › ${p.name}" non è riconosciuta dal sistema.`,
        missing: ['unità di misura riconoscibile (es. mm, N, N·m, kW, V)'], guiding_question: `Quale unità di misura corretta ha "${p.name}"?`, fingerprint: fp('R1u', p.id, p.unit) });
    } else if (expected && expected !== p._dim) {
      add({ rule_id: 'R1_UNITA', level: 'verificato', priority: 'media', priority_reason: 'Un\'unità incompatibile falsa tutti i calcoli successivi, ma si corregge subito.',
        title: 'Unità incompatibile con la grandezza dichiarata', involved: [ref(p)], sources: [src(p)],
        reason: `"${p.name}" è dichiarata come ${DIM_LABEL[expected]}, ma l'unità "${p.unit}" misura una ${DIM_LABEL[p._dim]}.`,
        guiding_question: `"${p.name}" è davvero una ${DIM_LABEL[expected]}? Quale unità le corrisponde?`, fingerprint: fp('R1', p.id, p.unit, p.quantity) });
    }
  }

  // R2 — due valori attivi diversi per la stessa grandezza dello stesso componente (conflitto tra versioni/ipotesi)
  const groups = new Map();
  for (const p of params) { const k = `${p._c}|${p._n}`; (groups.get(k) || groups.set(k, []).get(k)).push(p); }
  for (const g of groups.values()) {
    const vals = g.filter((p) => p._si !== null);
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) {
      const a = vals[i], b = vals[j];
      if (a._dim !== b._dim || close(a._si, b._si)) continue;
      add({ rule_id: 'R2_VALORI_DISCORDANTI', level: 'verificato', priority: 'alta', priority_reason: 'Due partecipanti stanno lavorando con valori diversi per la stessa grandezza: tutto ciò che ne dipende è incerto.',
        title: `Valori diversi per "${a.component} › ${a.name}"`, involved: [ref(a), ref(b)], sources: [src(a), src(b)],
        reason: `Sono attivi due valori non equivalenti: ${fmt(a.value)} ${a.unit} (${a.author_label || 'autore ignoto'}) e ${fmt(b.value)} ${b.unit} (${b.author_label || 'autore ignoto'}).`,
        guiding_question: 'Quale dei due valori è quello giusto e perché? Il vecchio valore va marcato come superato?', fingerprint: fp('R2', [a.id, b.id].sort().join()) });
    }
  }

  // R3 — interfacce meccaniche: diametri nominali collegati ma diversi (foro/albero o stessa grandezza)
  const diam = params.filter((p) => p._dim === 'length' && /diametro/.test(p._n));
  for (let i = 0; i < diam.length; i++) for (let j = i + 1; j < diam.length; j++) {
    const a = diam[i], b = diam[j];
    if (a._c === b._c || !linked(a, b) || close(a._si, b._si, 1e-4)) continue;
    const holeShaft = (/foro/.test(a._n) && /(albero|perno)/.test(b._n)) || (/foro/.test(b._n) && /(albero|perno)/.test(a._n));
    if (!(holeShaft || a._n === b._n)) continue;
    add({ rule_id: 'R3_INTERFACCIA', level: 'verificato', priority: 'alta', priority_reason: 'Se i diametri nominali accoppiati non coincidono i pezzi non si montano: lo si scopre solo a fine progetto.',
      title: 'Interfaccia meccanica non compatibile', involved: [ref(a), ref(b)], sources: [src(a), src(b)],
      reason: `I diametri nominali dei componenti collegati non coincidono: ${fmt(a.value)} ${a.unit} (${a.component}) contro ${fmt(b.value)} ${b.unit} (${b.component}).`,
      guiding_question: 'Quale diametro nominale deve avere l\'accoppiamento, e quali tolleranze prevedete per foro e albero?', fingerprint: fp('R3', [a.id, b.id].sort().join()) });
  }

  // R4 — tensioni di alimentazione
  const supply = params.filter((p) => p._dim === 'voltage' && /aliment/.test(p._n));
  for (let i = 0; i < supply.length; i++) for (let j = i + 1; j < supply.length; j++) {
    const a = supply[i], b = supply[j];
    if (a._c === b._c || close(a._si, b._si)) continue;
    const isLinked = linked(a, b);
    add({ rule_id: 'R4_ALIMENTAZIONE', level: isLinked ? 'verificato' : 'possibile', priority: isLinked ? 'alta' : 'bassa',
      priority_reason: isLinked ? 'Componenti collegati con alimentazioni diverse: su un impianto reale potrebbero danneggiarsi (resta una verifica da fare con il docente, in simulazione).' : 'Alimentazioni diverse ma non risulta un collegamento dichiarato: va solo chiarito se i componenti sono connessi.',
      title: isLinked ? 'Tensioni di alimentazione incompatibili tra componenti collegati' : 'Tensioni di alimentazione differenti: collegamento da chiarire',
      involved: [ref(a), ref(b)], sources: [src(a), src(b)],
      reason: `${a.component} è alimentato a ${fmt(a.value)} ${a.unit}, ${b.component} a ${fmt(b.value)} ${b.unit}${isLinked ? ' e risultano collegati' : ' (collegamento non dichiarato)'}.`,
      missing: isLinked ? [] : ['indicare se i due componenti sono collegati'],
      guiding_question: isLinked ? 'Serve un adattamento (alimentatore, convertitore, interfaccia di segnale) o una delle due tensioni è sbagliata?' : 'I due componenti sono collegati tra loro? Se sì, come gestite la differenza di tensione?', fingerprint: fp('R4', [a.id, b.id].sort().join()) });
  }

  // R5 — ipotesi di carico: coppia del motore vs supporti/struttura collegati (mai potenza vs carico direttamente)
  const comps = [...new Set(params.map((p) => p._c))];
  for (const cA of comps) {
    const pa = params.filter((p) => p._c === cA);
    const torque = pa.find((p) => p._dim === 'torque'); const power = pa.find((p) => p._dim === 'power');
    if (!torque && !power) continue;
    for (const cB of comps) {
      if (cB === cA || !STRUCT_RX.test(cB)) continue;
      const pb = params.filter((p) => p._c === cB);
      if (!pa.some((a) => pb.some((b) => linked(a, b)))) continue; // nessun collegamento dichiarato tra i due componenti
      const loads = pb.filter((p) => p._dim === 'force' && LOAD_NAME_RX.test(p._n));
      const arm = [...pa, ...pb].find((p) => p._dim === 'length' && ARM_NAME_RX.test(p._n));
      const geometry = pb.filter((p) => p._dim === 'length');
      const motorLbl = `${pa[0].component}`; const supLbl = `${pb[0].component}`;
      const base = { involved: [ref(torque || power), ...pb.slice(0, 3).map(ref)], sources: [src(torque || power), ...pb.slice(0, 3).map(src)] };
      if (!torque) {
        add({ ...base, rule_id: 'R5_CARICO', level: 'dati_insufficienti', priority: 'media', priority_reason: 'Dalla sola potenza non si ricava il carico sui supporti: serve la coppia e il regime.',
          title: `Dati insufficienti per confrontare ${motorLbl} e ${supLbl}`,
          reason: `Per ${motorLbl} è indicata solo la potenza. Potenza e carico sono grandezze diverse e non si confrontano direttamente.`,
          missing: ['coppia del motore (N·m)', 'regime (rpm)', 'geometria dei supporti (braccio, interasse)', 'forze e masse agenti'],
          guiding_question: 'Che coppia eroga il motore al regime di lavoro? (Ricorda la relazione tra potenza, coppia e velocità angolare.)', fingerprint: fp('R5p', torque?.id || power.id, cB) });
        continue;
      }
      if (!loads.length) {
        const enough = geometry.length > 0 || !!arm;
        add({ ...base, rule_id: 'R5_CARICO', level: enough ? 'possibile' : 'dati_insufficienti', priority: enough ? 'alta' : 'media',
          priority_reason: enough ? 'Riguarda carichi su componenti strutturali: va chiarito prima di proseguire con il dimensionamento dei supporti.' : 'Mancano i dati minimi per qualunque confronto.',
          title: enough ? 'Possibile incompatibilità da verificare' : `Dati insufficienti per confrontare ${motorLbl} e ${supLbl}`,
          reason: `La coppia indicata per ${motorLbl} (${fmt(torque.value)} ${torque.unit}) non risulta ancora confrontata con le ipotesi di carico di ${supLbl}.`,
          missing: ['forza (ipotesi di carico) agente sui supporti', ...(arm ? [] : ['braccio / interasse di applicazione']), 'peso del motore e masse in movimento', 'regime (se il carico è dinamico)'],
          guiding_question: `Quale forza agisce sui ${supLbl} nella configurazione scelta?`, fingerprint: fp('R5m', torque.id, cB, pb.map((x) => x.id).sort().join()) });
        continue;
      }
      if (!arm) {
        add({ ...base, involved: [...base.involved, ...loads.map(ref)], rule_id: 'R5_CARICO', level: 'possibile', priority: 'media', priority_reason: 'Esiste un\'ipotesi di carico ma non il braccio che la lega alla coppia.',
          title: 'Possibile incompatibilità da verificare', reason: `Per ${supLbl} è dichiarato un carico, ma senza un braccio/interasse non è possibile metterlo in relazione con la coppia di ${motorLbl}.`,
          missing: ['braccio / raggio / interasse (mm)'], guiding_question: 'A quale distanza dall\'asse (o tra i supporti) agisce la forza che equilibra la coppia?', fingerprint: fp('R5a', torque.id, loads.map((x) => x.id).sort().join()) });
        continue;
      }
      for (const L of loads) {
        const fMin = torque._si / arm._si; // F = T / r (relazione di equilibrio dichiarata)
        if (L._si >= 0.9 * fMin) continue;
        add({ ...base, involved: [ref(torque), ref(arm), ref(L)], sources: [src(torque), src(arm), src(L)], rule_id: 'R5_CARICO', level: 'verificato', priority: 'alta',
          priority_reason: 'Ipotesi di carico incoerenti su un componente strutturale: il dimensionamento si baserebbe su dati che non si accordano.',
          title: 'Ipotesi di carico discordanti',
          reason: `Con coppia ${fmt(torque.value)} ${torque.unit} e braccio ${fmt(arm.value)} ${arm.unit}, l'equilibrio F = T/r richiede una forza di almeno ${fmt(fMin)} N; l'ipotesi dichiarata per ${supLbl} è ${fmt(L.value)} ${L.unit}. (Controllo aritmetico sui dati dichiarati, non una verifica di resistenza.)`,
          missing: ['conferma che F = T/r sia la relazione adatta alla configurazione', 'regime e carichi dinamici'],
          guiding_question: 'Come passate dalla coppia del motore alla forza sui supporti? Quale braccio usate e perché?', fingerprint: fp('R5v', torque.id, arm.id, L.id) });
      }
    }
  }

  // R6 — vincoli dichiarati violati (nome "… max/massimo/minimo")
  for (const lim of params) {
    const m = /^(.*?)\s*(max|massim[oa]|min|minim[oa])$/.exec(lim._n);
    if (!m || !m[1]) continue;
    const isMax = /^max|^massim/.test(m[2]);
    for (const v of params.filter((p) => p._c === lim._c && p._n === m[1] && p._dim === lim._dim && p.id !== lim.id)) {
      if (isMax ? v._si <= lim._si * (1 + 1e-9) : v._si >= lim._si * (1 - 1e-9)) continue;
      const decs = decisions.filter((d) => d.status === 'confermata' && (d.param_ids || []).includes(v.id));
      add({ rule_id: 'R6_VINCOLO', level: 'verificato', priority: 'alta', priority_reason: 'Un valore scelto viola un vincolo che il gruppo ha dichiarato.',
        title: 'Valore che contraddice un vincolo dichiarato', involved: [ref(v), ref(lim), ...decs.map((d) => ({ type: 'decisione', id: d.id, label: d.title }))],
        sources: [src(v), src(lim), ...decs.map((d) => ({ type: 'decisione', id: d.id, author: d.proposed_label, at: d.updated_at, version: d.version }))],
        reason: `${v.component} › ${v.name} = ${fmt(v.value)} ${v.unit}, ma il vincolo "${lim.name}" è ${fmt(lim.value)} ${lim.unit}.`,
        guiding_question: 'Va cambiato il valore scelto o va riconsiderato il vincolo? Su quali ipotesi si basa ciascuno?', fingerprint: fp('R6', v.id, lim.id) });
    }
  }

  // R7 — decisione confermata che si basa su un parametro superato
  const superseded = new Map(all.filter((p) => p.status === 'superato').map((p) => [p.id, p]));
  for (const d of decisions.filter((x) => x.status === 'confermata')) {
    for (const pid of d.param_ids || []) {
      const old = superseded.get(pid); if (!old) continue;
      add({ rule_id: 'R7_VERSIONE', level: 'verificato', priority: 'media', priority_reason: 'La decisione confermata fa riferimento a un valore che nel frattempo è stato sostituito.',
        title: 'Decisione basata su un parametro superato', involved: [{ type: 'decisione', id: d.id, label: d.title }, ref(old)],
        sources: [{ type: 'decisione', id: d.id, author: d.proposed_label, at: d.updated_at, version: d.version }, src(old)],
        reason: `La decisione "${d.title}" cita "${old.component} › ${old.name}" (${fmt(old.value)} ${old.unit}), che è stato superato da un valore più recente.`,
        guiding_question: 'La decisione è ancora valida con il nuovo valore? Serve una nuova conferma?', fingerprint: fp('R7', d.id, old.id) });
    }
  }

  // R8 — quota del componente diversa dalla quota dell'assieme
  const asm = params.filter((p) => /^assieme/.test(p._c) && p._si !== null);
  for (const a of asm) for (const b of params.filter((p) => p._n === a._n && p._c !== a._c && p._dim === a._dim && linked(p, a))) {
    if (close(a._si, b._si, 1e-4)) continue;
    add({ rule_id: 'R8_ASSIEME', level: 'verificato', priority: 'media', priority_reason: 'La quota dell\'assieme e quella del componente devono coincidere o avere una differenza giustificata.',
      title: 'Quota del componente diversa da quella dell\'assieme', involved: [ref(a), ref(b)], sources: [src(a), src(b)],
      reason: `"${a.name}": ${fmt(a.value)} ${a.unit} nell'assieme, ${fmt(b.value)} ${b.unit} nel componente "${b.component}".`,
      guiding_question: 'Quale delle due quote è aggiornata? La differenza è voluta (gioco, tolleranza) o è un errore?', fingerprint: fp('R8', [a.id, b.id].sort().join()) });
  }

  // deduplica per fingerprint
  const seen = new Set();
  return out.filter((a) => (seen.has(a.fingerprint) ? false : seen.add(a.fingerprint)));
}
module.exports = { evaluate, norm, fmt };
