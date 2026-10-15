'use strict';
// RICALCOLO GUIDATO: guida lo studente nell'impostazione e VERIFICA il suo calcolo senza mai rivelare il risultato atteso.
// Indizi progressivi (1 concettuale, 2 principio, 3 passaggio parziale, 4 esempio analogo con dati diversi). Il risultato non è un'approvazione.
const { E } = require('../lib/errors');
const { now, uuid, jparse } = require('../lib/util');
const { toSI, parseQuantity, DIM_LABEL } = require('./units');
const { norm, fmt } = require('./rules');

const DISCLAIMER = 'Esercizio di verifica a scopo didattico sui dati dichiarati dal gruppo: NON è un\'approvazione a costruire o utilizzare una macchina reale. Le verifiche pratiche restano soggette alla supervisione del docente.';
const TOL = 0.015;
const within = (a, b) => Math.abs(a - b) <= Math.max(TOL * Math.abs(b), 1e-9);

const TEMPLATES = {
  forza_da_coppia: {
    title: 'Dalla coppia del motore alla forza sul supporto',
    expect: { dim: 'force', unit: 'N' },
    steps: [
      { key: 'ipotesi', prompt: (v) => `**Ipotesi di partenza** (dai dati del progetto):\n${v.assumptions.map((a) => `- ${a}`).join('\n')}\n\nLa relazione di equilibrio tra coppia e forza dipende da queste ipotesi. Ti tornano? Se qualcosa non ti convince scrivilo; altrimenti scrivi "ok".` },
      { key: 'principio', prompt: () => 'Quale relazione lega la **forza F**, la **coppia T** e il **braccio r** a cui la forza è applicata? Scrivila a parole o con una formula.',
        ok: (t) => /(\bf\b[^a-z]{0,6}[=*x·]\s*[^a-z]{0,3}\br\b|\bt\b\s*[=\/]\s*\bf\b|\bf\b\s*=\s*\bt\b\s*\/\s*\br\b|\bt\b\s*\/\s*\br\b|diviso|momento|braccio|equilibrio)/i.test(norm(t) + ' ' + t),
        hints: [
          () => 'Pensa a come una forza genera un momento rispetto a un punto: quale grandezza geometrica conta?',
          () => 'La relazione utile è il momento di una forza rispetto a un punto: M = F · r (con r distanza dall\'asse).',
          () => 'Passaggio parziale: se il momento (coppia) è T e il braccio è r, la forza si ottiene "isolando" F nella relazione T = F · r. Come la scriveresti?',
          () => 'Esempio analogo con dati diversi: T = 20 N·m, r = 0,1 m → F = T / r = 200 N. Ora scrivi la relazione generale nel tuo problema.',
        ] },
      { key: 'calcolo', numeric: true, prompt: (v) => `Calcola la forza **F** con i dati del progetto (coppia ${v.torqueLabel}, braccio ${v.armLabel}). Scrivi il risultato **con l'unità di misura**. Attento a usare unità coerenti.`,
        hints: [
          () => 'Prima di calcolare: coppia e braccio sono espressi in unità coerenti tra loro? Cosa devi convertire?',
          () => 'Per avere la forza in newton servono la coppia in N·m e il braccio in metri (oppure N·mm e mm).',
          (v) => `Passaggio parziale: il braccio in metri vale ${fmt(v.arm_m)} m. Ora puoi dividere la coppia per questo valore.`,
          () => 'Esempio analogo con dati diversi: T = 30 N·m, r = 150 mm → r = 0,15 m → F = 30 / 0,15 = 200 N. Rifai gli stessi passaggi con i tuoi dati.',
        ] },
      { key: 'confronto', free: true, prompt: (v) => `Confronta la tua forza con ${v.declaredLabel ? `l'ipotesi di carico dichiarata (${v.declaredLabel})` : 'le ipotesi di carico del progetto'}. È coerente? Motiva la risposta e indica quale margine di sicurezza considereresti e perché.` },
    ],
  },
  potenza_da_coppia_regime: {
    title: 'Dalla coppia e dal regime alla potenza meccanica',
    expect: { dim: 'power', unit: 'W' },
    steps: [
      { key: 'ipotesi', prompt: (v) => `**Ipotesi di partenza** (dai dati del progetto):\n${v.assumptions.map((a) => `- ${a}`).join('\n')}\n\nTi tornano? Altrimenti scrivi cosa non convince; se va bene scrivi "ok".` },
      { key: 'principio', prompt: () => 'Quale relazione lega la **potenza P**, la **coppia T** e la **velocità angolare ω**? E come passi da giri/min a rad/s?',
        ok: (t) => /(p\s*=\s*t\s*[*x·]?\s*(ω|omega|w\b)|potenza[^.]{0,30}coppia[^.]{0,30}velocit|2\s*(π|pi|greco)|\/\s*60|coppia\s*(per|x|\*)\s*velocit)/i.test(t),
        hints: [
          () => 'La potenza meccanica in rotazione dipende da quanta coppia eroghi e da quanto veloce giri.',
          () => 'Relazione utile: P = T · ω, con ω in rad/s.',
          () => 'Passaggio parziale: da n [giri/min] a ω [rad/s] si usa ω = 2π·n / 60. Quanto vale ω nel tuo caso?',
          () => 'Esempio analogo con dati diversi: T = 5 N·m, n = 600 giri/min → ω = 62,8 rad/s → P ≈ 314 W. Ora applica lo stesso ragionamento ai tuoi dati.',
        ] },
      { key: 'calcolo', numeric: true, prompt: (v) => `Calcola la potenza **P** (coppia ${v.torqueLabel}, regime ${v.speedLabel}). Scrivi il risultato **con l'unità** (W o kW).`,
        hints: [
          () => 'Hai convertito il regime in rad/s prima di moltiplicare per la coppia?',
          () => 'Ricorda: P [W] = T [N·m] · ω [rad/s].',
          (v) => `Passaggio parziale: la velocità angolare vale ${fmt(v.omega)} rad/s. Cosa ottieni moltiplicandola per la coppia?`,
          () => 'Esempio analogo con dati diversi: T = 8 N·m, n = 1500 giri/min → ω ≈ 157,1 rad/s → P ≈ 1257 W. Rifai i passaggi con i tuoi dati.',
        ] },
      { key: 'confronto', free: true, prompt: (v) => `Confronta il risultato con la potenza ${v.declaredLabel ? `dichiarata (${v.declaredLabel})` : 'del motore'}. È coerente? Motiva e indica da cosa potrebbe dipendere un'eventuale differenza (rendimento, regime, dati di targa).` },
    ],
  },
};

function createChecks(ctx) {
  const { db, access, events } = ctx;
  const ARM_RX = /(braccio|raggio|interasse|distanza)/; const LOAD_RX = /(carico|forza|reazione|peso)/;
  const pv = (p) => `${p.component} › ${p.name} = ${fmt(p.value)} ${p.unit}`;

  function buildInputs(projectId, alert) {
    const all = db.all("SELECT * FROM project_parameters WHERE project_id = ? AND status = 'attivo'", projectId).map((p) => ({ ...p, si: toSI(p.value, p.unit), n: norm(p.name) }));
    const ids = new Set(jparse(alert.involved_json, []).map((x) => x.id));
    const inv = all.filter((p) => ids.has(p.id));
    const pick = (list, dim, rx) => list.find((p) => p.si?.dim === dim && (!rx || rx.test(p.n)));
    const torque = pick(inv, 'torque') || pick(all, 'torque');
    if (!torque) throw E.conflict('Per un ricalcolo guidato serve almeno la coppia del motore tra i parametri.', { missing: ['coppia (N·m)'] });
    const arm = pick(inv, 'length', ARM_RX) || pick(all, 'length', ARM_RX);
    const speed = all.find((p) => p.si?.dim === 'angular_speed' && p.component === torque.component);
    const load = pick(inv, 'force', LOAD_RX) || pick(all, 'force', LOAD_RX);
    if (arm) {
      return { template: 'forza_da_coppia', assumptions: [`Coppia: ${pv(torque)} (inserita da ${torque.author_label})`, `Braccio/interasse: ${pv(arm)} (inserito da ${arm.author_label})`, 'Relazione assunta: la forza tangenziale F equilibra la coppia T al braccio r (F = T / r).', ...(load ? [`Ipotesi di carico dichiarata: ${pv(load)}`] : [])],
        torqueLabel: `${fmt(torque.value)} ${torque.unit}`, armLabel: `${fmt(arm.value)} ${arm.unit}`, arm_m: arm.si.si, expected_si: torque.si.si / arm.si.si,
        declaredLabel: load ? `${fmt(load.value)} ${load.unit}` : null, declared_si: load?.si?.si ?? null, paramIds: [torque.id, arm.id, ...(load ? [load.id] : [])] };
    }
    if (speed) {
      const omega = speed.si.si;
      return { template: 'potenza_da_coppia_regime', assumptions: [`Coppia: ${pv(torque)}`, `Regime: ${pv(speed)}`, 'Relazione assunta: P = T · ω (potenza meccanica all\'albero).'], torqueLabel: `${fmt(torque.value)} ${torque.unit}`, speedLabel: `${fmt(speed.value)} ${speed.unit}`,
        omega, expected_si: torque.si.si * omega, declaredLabel: null, declared_si: null, paramIds: [torque.id, speed.id] };
    }
    throw E.conflict('Dati insufficienti per il ricalcolo: manca il braccio/interasse (o il regime). Aggiungi il dato mancante e riprova.', { missing: ['braccio / interasse (mm)', 'oppure regime (rpm)'] });
  }

  const view = (c, extra = {}) => {
    const inp = jparse(c.inputs_json, {}); const T = TEMPLATES[inp.template]; const done = c.status === 'verificato';
    const step = T.steps[Math.min(c.step, T.steps.length - 1)];
    return { id: c.id, alertId: c.alert_id, template: inp.template, title: T.title, status: c.status, step: c.step + (done ? 0 : 1), totalSteps: T.steps.length, stepKey: step.key,
      prompt: done ? null : step.prompt(inp), hintLevel: c.hint_level, attempts: c.attempts, disclaimer: DISCLAIMER, ...(done ? { confirmed: { value: c.confirmed_value, unit: c.confirmed_unit } } : {}), ...extra };
  };
  const own = (user, projectId, id) => { const c = db.get('SELECT * FROM guided_checks WHERE id = ? AND project_id = ? AND user_id = ?', id, projectId, user.id); if (!c) throw E.notFound('Verifica guidata non trovata.'); return c; };

  function start(user, projectId, alertId) {
    access.requireMember(user, projectId);
    const alert = ctx.blackbox.getAlert(projectId, alertId);
    if (!['R5_CARICO', 'IA_CONTESTO'].includes(alert.rule_id)) throw E.bad('Per questo avviso non è previsto un ricalcolo guidato: usa la domanda guida e confronta i dati dichiarati.', 'ricalcolo_non_previsto');
    const inputs = buildInputs(projectId, alert);
    const open = db.get("SELECT * FROM guided_checks WHERE project_id = ? AND alert_id = ? AND user_id = ? AND status = 'in_corso'", projectId, alertId, user.id);
    if (open) return view(open);
    const id = uuid(); const t = now();
    db.run('INSERT INTO guided_checks (id, project_id, alert_id, user_id, template_id, inputs_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, projectId, alertId, user.id, inputs.template, JSON.stringify(inputs), t, t);
    if (alert.status === 'aperto') ctx.blackbox.setStatus(user, projectId, alertId, 'in_verifica');
    return view(db.get('SELECT * FROM guided_checks WHERE id = ?', id));
  }
  const get = (user, projectId, id) => { access.requireMember(user, projectId); return view(own(user, projectId, id)); };

  function hintFor(c, level) {
    const inp = jparse(c.inputs_json, {}); const step = TEMPLATES[inp.template].steps[c.step];
    if (!step.hints) return level >= 1 ? 'Rileggi le ipotesi e prova a motivare la tua risposta: cosa ti dice il confronto sui margini?' : null;
    return level >= 1 ? step.hints[Math.min(level, 4) - 1](inp) : null;
  }
  function hint(user, projectId, id) {
    access.requireMember(user, projectId);
    const c = own(user, projectId, id); if (c.status !== 'in_corso') throw E.conflict('Verifica già conclusa.');
    const level = Math.min(c.hint_level + 1, 4);
    db.run('UPDATE guided_checks SET hint_level = ?, updated_at = ? WHERE id = ?', level, now(), id);
    const fresh = db.get('SELECT * FROM guided_checks WHERE id = ?', id);
    return view(fresh, { hint: hintFor(fresh, level), hintNote: level >= 4 ? 'Questo è il livello massimo di aiuto: ora il passaggio successivo tocca a te.' : null });
  }

  function answer(user, projectId, id, { text }) {
    access.requireMember(user, projectId);
    const c = own(user, projectId, id); if (c.status !== 'in_corso') throw E.conflict('Verifica già conclusa.');
    text = String(text || '').trim();
    if (!text) throw E.bad('Scrivi la tua risposta.');
    const inp = jparse(c.inputs_json, {}); const T = TEMPLATES[inp.template]; const step = T.steps[c.step];
    let good = false; let feedback = ''; let confirmed = null;

    if (step.numeric) {
      const q = parseQuantity(text);
      if (!q || !Number.isFinite(q.value)) feedback = 'Scrivi il risultato come numero **con unità di misura** (per esempio "123 N").';
      else if (!q.unit) feedback = q.dim === null && /[a-z°]/i.test(text.replace(/[0-9.,\s-]/g, '')) ? 'Non riconosco l\'unità di misura che hai scritto: controlla di averla scritta correttamente.' : 'Manca l\'unità di misura: in quale unità hai espresso il risultato?';
      else if (q.dim !== T.expect.dim) feedback = `L'unità "${q.unit}" misura una ${DIM_LABEL[q.dim]}, ma qui stai cercando una ${DIM_LABEL[T.expect.dim]}. Ricontrolla le unità di misura.`;
      else {
        const si = toSI(q.value, q.unit).si;
        if (within(si, inp.expected_si)) { good = true; confirmed = { value: q.value, unit: q.unit, si }; }
        else if (inp.expected_si > 0 && [1e3, 1e-3].some((k) => within(si / inp.expected_si, k))) feedback = 'Il risultato ha l\'ordine di grandezza sbagliato di un fattore 1000: ricontrolla la conversione delle unità (mm ↔ m, W ↔ kW).';
        else feedback = 'Il risultato non torna con i dati del progetto: ricontrolla l\'impostazione e i passaggi.';
      }
    } else if (step.free) {
      good = text.length >= 20; if (!good) feedback = 'Motiva meglio la risposta (almeno una o due frasi): perché il confronto è coerente o no?';
    } else if (step.ok) {
      good = step.ok(text); if (!good) feedback = 'Non è ancora la relazione che cerco: prova a riscriverla con parole tue.';
    } else good = text.length >= 2;

    if (!good) { // errore: indizio di livello crescente, MAI la soluzione
      const level = Math.min(c.hint_level + 1, 4);
      db.run('UPDATE guided_checks SET attempts = attempts + 1, hint_level = ?, updated_at = ? WHERE id = ?', level, now(), id);
      const fresh = db.get('SELECT * FROM guided_checks WHERE id = ?', id);
      return view(fresh, { correct: false, feedback, hint: hintFor(fresh, level), hintNote: level >= 4 ? 'Questo è il livello massimo di aiuto: ora riprova tu con i tuoi dati.' : null });
    }
    const last = c.step + 1 >= T.steps.length;
    if (!last) {
      db.run('UPDATE guided_checks SET step = step + 1, attempts = 0, hint_level = MAX(0, hint_level - 1), confirmed_value = COALESCE(?, confirmed_value), confirmed_unit = COALESCE(?, confirmed_unit), updated_at = ? WHERE id = ?', confirmed?.value ?? null, confirmed?.unit ?? null, now(), id);
      return view(db.get('SELECT * FROM guided_checks WHERE id = ?', id), { correct: true, feedback: step.numeric ? 'Il calcolo torna. Ottimo lavoro: ora il confronto.' : 'Bene, andiamo avanti.' });
    }
    // conclusione: registra l'esito CONFERMATO dallo studente
    db.run("UPDATE guided_checks SET status = 'verificato', updated_at = ? WHERE id = ?", now(), id);
    const fin = db.get('SELECT * FROM guided_checks WHERE id = ?', id);
    const si = toSI(fin.confirmed_value, fin.confirmed_unit)?.si;
    let comparison = null;
    if (inp.declared_si != null && si != null) {
      const ratio = inp.declared_si / si;
      comparison = ratio >= 0.9 ? 'L\'ipotesi dichiarata è almeno pari al valore ricalcolato: sul piano aritmetico i dati non risultano in contrasto.' : `L'ipotesi dichiarata (${inp.declaredLabel}) è inferiore al valore ricalcolato (${fmt(fin.confirmed_value)} ${fin.confirmed_unit}): le ipotesi sono discordanti e vanno riviste dal gruppo.`;
    }
    ctx.journal.addItem(user, projectId, { type: 'ipotesi', status: 'da_verificare', title: `Verifica guidata di ${user.displayName}: ${T.title} = ${fmt(fin.confirmed_value)} ${fin.confirmed_unit}`,
      body: `Esito confermato dallo studente nel ricalcolo guidato. ${comparison || ''} ${DISCLAIMER}` });
    events.publish(projectId, { type: 'check.completed', entityType: 'check', entityId: id, actorId: user.id });
    access.audit(user.id, projectId, 'ricalcolo.concluso', { id });
    return view(fin, { correct: true, done: true, feedback: 'Verifica conclusa: il tuo risultato è stato registrato come ipotesi da verificare nel diario di bordo.', comparison });
  }
  return { start, get, hint, answer, TEMPLATES, DISCLAIMER };
}
module.exports = { createChecks };
