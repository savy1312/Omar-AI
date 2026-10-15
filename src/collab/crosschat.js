'use strict';
// CROSS-CHAT SYNC: le chat restano separate; il backend costruisce un CONTESTO DI PROGETTO con soli contributi condivisi e autorizzati.
// Nessun modello "parla" con un altro: c'è un solo meccanismo, implementato qui, che recupera dati già condivisi e verificati sul server.
const { keywords } = require('../lib/util');
const { norm } = require('../blackbox/rules');
const { neutralize } = require('../engine/injection');
const { RETRACTED } = require('./contributions');

const GENERIC_SINGULAR = /\b(il mio compagno|la mia compagna|il mio collega|la mia collega|il mio amico|la mia amica|mio compagno|mia compagna|il compagno|la compagna)\b/i;
const GENERIC_PLURAL = /\b(i miei compagni|le mie compagne|i miei colleghi|gli altri|i compagni|il gruppo)\b/i;
const day = (iso) => String(iso || '').slice(0, 10);

function createCrosschat(ctx) {
  const { db, access } = ctx;

  function resolveTargets(user, projectId, text) {
    const t = ` ${norm(text)} `;
    const others = access.activeMembers(projectId).filter((m) => m.user_id !== user.id);
    const label = (m) => `${m.display_name}${m.workstream ? ` (${m.workstream})` : ''}`;
    if (!others.length) return { targets: [], problem: 'Nel progetto non ci sono altri partecipanti attivi oltre a te.' };
    // 1) nome esplicito
    const byName = others.filter((m) => norm(m.display_name).split(' ').some((w) => w.length >= 3 && t.includes(` ${w} `)));
    if (byName.length) return { targets: byName, how: 'nome' };
    // 2) sottoprogetto / area di lavoro menzionata
    const byWs = others.filter((m) => m.workstream && norm(m.workstream).split(' ').some((w) => w.length >= 4 && !['del', 'della', 'dello', 'progetto'].includes(w) && t.includes(` ${w}`)));
    if (byWs.length) return { targets: byWs, how: 'sottoprogetto' };
    // 3) riferimento generico
    if (GENERIC_PLURAL.test(text)) return { targets: others, how: 'tutti' };
    if (GENERIC_SINGULAR.test(text)) {
      if (others.length === 1) return { targets: others, how: 'unico_compagno' };
      return { targets: [], ambiguous: others.map(label), problem: `A quale compagno ti riferisci? Nel progetto ci sono: ${others.map(label).join('; ')}. Scrivimi il nome (o il sottoprogetto) e riparto da lì.` };
    }
    return { targets: [], how: 'nessuno' };
  }

  function contextForTurn({ user, projectId, text, signals }) {
    const proj = access.project(projectId);
    const notices = []; const refs = new Map();
    // Briefing: risposta deterministica costruita dai dati del progetto (nessuna invenzione del modello)
    if (signals.briefing && ctx.journal) {
      const b = ctx.journal.briefing(user, projectId);
      notices.push({ type: 'briefing', text: 'Briefing costruito dai contenuti condivisi e dai dati del progetto (non dalle chat personali).' });
      return { clarification: b.markdown, notices, refs, block: '' };
    }
    const wantsPeers = signals.crossChat;
    let targets = [];
    if (wantsPeers) {
      const r = resolveTargets(user, projectId, text);
      if (r.problem) { notices.push({ type: 'chiarimento', text: r.problem }); return { clarification: r.problem, notices, refs, block: '' }; }
      targets = r.targets;
      if (!targets.length) { // intento cross-chat ma nessun riferimento riconoscibile
        const others = access.activeMembers(projectId).filter((m) => m.user_id !== user.id);
        const msg = `Mi stai chiedendo di usare il lavoro di un compagno, ma non capisco a chi. Nel progetto ci sono: ${others.map((m) => `${m.display_name}${m.workstream ? ` (${m.workstream})` : ''}`).join('; ') || 'nessun altro partecipante'}. Di chi vuoi usare il contributo?`;
        notices.push({ type: 'chiarimento', text: msg }); return { clarification: msg, notices, refs, block: '' };
      }
    }

    const lines = [`Progetto: ${proj.name}. Partecipanti attivi: ${access.activeMembers(projectId).map((m) => `${m.display_name}${m.workstream ? ` (${m.workstream})` : ''}`).join('; ')}.`];
    let n = { C: 0, D: 0, P: 0 };

    if (targets.length) {
      const kw = keywords(text, 10);
      const found = [];
      for (const m of targets) {
        const rows = db.all("SELECT * FROM shared_contributions WHERE project_id = ? AND author_id = ? AND status = 'attivo' ORDER BY created_at DESC LIMIT 30", projectId, m.user_id);
        if (!rows.length) {
          const msg = `${m.display_name}${m.workstream ? ` (${m.workstream})` : ''} non ha ancora condiviso nulla nel progetto. Non posso leggere la sua chat personale: posso solo usare ciò che sceglie di condividere. Vuoi chiedergli di condividere il suo contributo?`;
          notices.push({ type: 'non_condiviso', text: msg, action: { type: 'request_share', targetUserId: m.user_id, label: `Chiedi a ${m.display_name} di condividere` } });
          if (targets.length === 1) return { clarification: msg, notices, refs, block: '' };
          continue;
        }
        const scored = rows.map((c) => { const nt = norm(c.content); return { c, s: kw.reduce((a, w) => a + (nt.includes(w) ? 1 : 0), 0) }; }).sort((a, b) => b.s - a.s || b.c.created_at.localeCompare(a.c.created_at));
        found.push(...scored.slice(0, 3).map((x) => ({ ...x.c, member: m })));
      }
      for (const c of found.slice(0, 5)) {
        if (c.content === RETRACTED) continue;
        const ref = `C${++n.C}`;
        refs.set(ref, { kind: 'contributo', id: c.id, author: c.author_label, workstream: c.workstream, version: c.version, status: 'condiviso dall\'autore', at: day(c.created_at), preview: c.content.slice(0, 120) });
        lines.push(`[${ref}] Contributo condiviso da ${c.author_label}${c.workstream ? ` (sottoprogetto: ${c.workstream})` : ''}, versione ${c.version}, ${c.kind}${c.auto ? ' condiviso automaticamente' : ''}, del ${day(c.created_at)}:\n«${neutralize(c.content).text.slice(0, 800)}»`);
      }
      if (found.length) notices.push({ type: 'provenienza', text: `Contesto condiviso usato da: ${[...new Set(found.map((f) => f.author_label))].join(', ')}.` });
    }

    // Decisioni (le sole "confermate" sono decisioni del gruppo) e parametri attivi: sempre utili e già condivisi con tutti i membri
    const decs = db.all("SELECT * FROM decisions WHERE project_id = ? AND status IN ('confermata','proposta') ORDER BY (status = 'confermata') DESC, updated_at DESC LIMIT 6", projectId);
    for (const d of decs) {
      const ref = `D${++n.D}`;
      refs.set(ref, { kind: 'decisione', id: d.id, author: d.proposed_label, version: d.version, status: d.status === 'confermata' ? 'confermata' : 'proposta (NON ancora decisa)', at: day(d.updated_at), preview: d.title });
      lines.push(`[${ref}] Decisione ${d.status === 'confermata' ? 'CONFERMATA' : 'solo PROPOSTA (non confermata)'}: ${neutralize(d.title).text}${d.body ? ` — ${neutralize(d.body).text.slice(0, 300)}` : ''} (proposta da ${d.proposed_label}, v${d.version})`);
    }
    if (targets.length || signals.groupDecisions) {
      for (const p of db.all("SELECT * FROM project_parameters WHERE project_id = ? AND status = 'attivo' ORDER BY component, name LIMIT 25", projectId)) {
        const ref = `P${++n.P}`;
        refs.set(ref, { kind: 'parametro', id: p.id, author: p.author_label, version: p.version, status: 'attivo', at: day(p.updated_at), preview: `${p.component} › ${p.name} = ${p.value} ${p.unit}` });
        lines.push(`[${ref}] Parametro ${p.component} › ${p.name} = ${p.value} ${p.unit} (inserito da ${p.author_label}, v${p.version})`);
      }
    }
    return { block: `<contesto_progetto>\n${lines.join('\n')}\n</contesto_progetto>`, refs, notices, clarification: null };
  }

  return { contextForTurn, resolveTargets };
}
module.exports = { createCrosschat };
