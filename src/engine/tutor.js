'use strict';
// MOTORE DIDATTICO: indipendente da interfaccia (HTTP) e da provider del modello (adattatore ctx.provider).
const { E, HttpError } = require('../lib/errors');
const { now, uuid, jparse } = require('../lib/util');
const { RateLimiter } = require('../lib/ratelimit');
const { ProviderError, friendly } = require('../ai/errors');
const { analyze, SAFETY_REFUSAL } = require('./policy');
const { initialState, applyUserTurn, applyModelReport, progressSummary } = require('./state');
const { buildSystemPrompt } = require('./prompts/system');
const guard = require('./guard');
const { createStreamFilter } = require('./stream');
const router = require('./router');
const { WebError } = require('../web/safe-fetch');
const { hostOf } = require('../web/links');

const MODES = ['esercizio', 'spiega', 'verifica', 'ripasso'];
const LEVELS = ['base', 'intermedio', 'avanzato'];
const ACTION_LABEL = { hint: 'Dammi un indizio', simpler: 'Spiegalo più semplicemente', check: 'Fammi una domanda di verifica' };
const NORM_RX = /\b(norm[ae]\b|normativ\w+|direttiv\w+|regolament\w+|prescrizion\w+|tabell\w+|(?:uni|iso|din|cei|en)\s*(?:en\s*)?\d+)/i;
const TAGS_RX = /<\s*\/?\s*(contesto_materiali|contesto_progetto|contesto_web|stato_didattico|system|assistant|istruzioni)[^>]*>/gi;

function createTutor(ctx) {
  const { db, cfg, access, materials, subjects, log } = ctx;
  const perMinute = new RateLimiter(cfg.limits.messagesPerMin, 60_000);
  const day = () => new Date().toISOString().slice(0, 10);

  const pinsOf = (s) => jparse(s.pins, {}) || {};
  const pubSession = (s) => {
    const sub = subjects.resolve(s.subject_id); const pins = pinsOf(s);
    return { id: s.id, subjectId: s.subject_id, subjectName: sub?.name || null, topicId: s.topic_id, topicName: sub?.topics?.find((t) => t.id === s.topic_id)?.name || null,
      mode: s.mode, modeLabel: router.MODE_LABEL[s.mode], level: s.level, levelLabel: router.LEVEL_LABEL[s.level], title: s.title, projectId: s.project_id, sandbox: !!s.sandbox,
      pins, auto: !Object.values(pins).some(Boolean), detect: jparse(s.detect_json, null), createdAt: s.created_at, updatedAt: s.updated_at };
  };
  const pubMsg = (m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at, shareExcluded: !!m.share_excluded, ...jparse(m.meta_json, {}) });

  function ownSession(user, id) {
    const s = db.get('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?', id, user.id); // solo le proprie sessioni
    if (!s) throw E.notFound('Sessione non trovata.');
    return s;
  }

  // Senza parametri la sessione parte in riconoscimento automatico; i campi passati esplicitamente restano "fissati" (pins).
  function createSession(user, { subjectId, topicId, mode, level, projectId = null, sandbox = false } = {}) {
    const pins = { subject: !!subjectId, topic: !!topicId, mode: !!mode, level: !!level };
    if (subjectId && !subjects.get(subjectId)) throw E.bad('Materia non valida.', 'materia_non_valida');
    if (topicId && (!subjectId || !subjects.hasTopic(subjectId, topicId))) throw E.bad('Argomento non valido.', 'argomento_non_valido');
    if (mode && !MODES.includes(mode)) throw E.bad('Modalità non valida.');
    if (level && !LEVELS.includes(level)) throw E.bad('Livello non valido.');
    subjectId = subjectId || 'generale'; mode = mode || 'esercizio'; level = level || 'base';
    if (projectId) access.requireMember(user, projectId);
    if (sandbox && user.role === 'student') throw E.forbidden('La prova del tutor è riservata ai docenti.');
    const id = uuid(); const t = now();
    db.run(`INSERT INTO chat_sessions (id, user_id, project_id, subject_id, topic_id, mode, level, title, sandbox, state_json, pins, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, user.id, projectId, subjectId, topicId || null, mode, level, null, sandbox ? 1 : 0, JSON.stringify(initialState()), JSON.stringify(pins), t, t);
    return pubSession(db.get('SELECT * FROM chat_sessions WHERE id = ?', id));
  }
  const listSessions = (user) => db.all(`SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) n_msg,
      (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1) last_reply
      FROM chat_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT 200`, user.id)
    .map((s) => ({ ...pubSession(s), messageCount: s.n_msg, preview: s.last_reply ? s.last_reply.replace(/[#*_`>$\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 140) : null }));
  function getSession(user, id) {
    const s = ownSession(user, id);
    return { session: pubSession(s), messages: db.all('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, rowid', id).map(pubMsg), progress: progressSummary(jparse(s.state_json, initialState())) };
  }
  // Ciò che si imposta a mano resta fissato; { auto: true } riporta tutto al riconoscimento automatico. { title } rinomina la chat.
  function updateSession(user, id, { mode, level, topicId, subjectId, auto, title } = {}) {
    const s = ownSession(user, id);
    const pins = pinsOf(s);
    if (mode !== undefined && !MODES.includes(mode)) throw E.bad('Modalità non valida.');
    if (level !== undefined && !LEVELS.includes(level)) throw E.bad('Livello non valido.');
    if (subjectId !== undefined && !subjects.get(subjectId)) throw E.bad('Materia non valida.');
    const sid = subjectId ?? s.subject_id;
    if (topicId && !subjects.hasTopic(sid, topicId)) throw E.bad('Argomento non valido.');
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 80)) throw E.bad('Il titolo deve avere da 1 a 80 caratteri.');
    if (auto === true) { pins.subject = pins.topic = pins.mode = pins.level = false; }
    if (mode !== undefined) pins.mode = true;
    if (level !== undefined) pins.level = true;
    if (subjectId !== undefined) pins.subject = true;
    if (topicId !== undefined) pins.topic = !!topicId;
    const newTopic = topicId !== undefined ? topicId || null : subjectId !== undefined && subjectId !== s.subject_id ? null : s.topic_id;
    db.run('UPDATE chat_sessions SET subject_id = ?, mode = ?, level = ?, topic_id = ?, pins = ?, title = ?, updated_at = ? WHERE id = ?',
      sid, mode ?? s.mode, level ?? s.level, newTopic, JSON.stringify(pins), title !== undefined ? title.trim() : s.title, now(), id);
    return pubSession(db.get('SELECT * FROM chat_sessions WHERE id = ?', id));
  }
  function deleteSession(user, id) { ownSession(user, id); db.run('DELETE FROM chat_sessions WHERE id = ?', id); }
  function setShareExcluded(user, sessionId, messageId, excluded) {
    ownSession(user, sessionId);
    const r = db.run('UPDATE messages SET share_excluded = ? WHERE id = ? AND session_id = ?', excluded ? 1 : 0, messageId, sessionId);
    if (!r.changes) throw E.notFound('Messaggio non trovato.');
  }

  function chargeUsage(user) {
    if (!perMinute.allow(user.id)) throw E.rate('Stai scrivendo molto velocemente: attendi qualche secondo.', { retryAfterSec: perMinute.retryAfterSec(user.id) });
    const row = db.get('SELECT calls FROM ai_usage WHERE user_id = ? AND day = ?', user.id, day());
    if ((row?.calls || 0) >= cfg.ai.dailyLimitPerUser) throw E.rate('Hai raggiunto il limite giornaliero di richieste al tutor. Riprova domani.', { daily: true });
    db.run('INSERT INTO ai_usage (user_id, day, calls) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + 1', user.id, day());
  }
  const refundUsage = (user) => db.run('UPDATE ai_usage SET calls = MAX(0, calls - 1) WHERE user_id = ? AND day = ?', user.id, day());

  function formatContext(found) {
    if (!found.length) return '<contesto_materiali>\n(nessun passaggio pertinente trovato nei materiali)\n</contesto_materiali>';
    return '<contesto_materiali>\n' + found.map((c) => `[${c.ref}] (${c.name}, versione ${c.version}${c.page && !c.sourceUrl ? `, pag. ${c.page}` : ''}${c.sourceUrl ? `, pagina web: ${c.sourceUrl}` : ''}):\n${c.text.slice(0, 1200)}`).join('\n\n') + '\n</contesto_materiali>';
  }

  // Un turno di conversazione. Senza `onEvent` risponde a risposta finita; con `onEvent(tipo, dati)` racconta man mano cosa succede
// (fasi, fonti, testo in arrivo) e, se il provider lo supporta, scrive in streaming. `signal` = interruzione richiesta dallo studente.
async function turn(user, sessionId, { text = '', action = null, useMaterials = true, useWeb = false, useLinks = true, onEvent = null, signal = null } = {}) {
    const emit = (type, data = {}) => { if (onEvent) { try { onEvent(type, data); } catch { /* il canale può essersi chiuso: non deve rompere il turno */ } } };
    const s = ownSession(user, sessionId);
    text = String(text || '').trim();
    if (action && !ACTION_LABEL[action]) throw E.bad('Azione non valida.');
    if (!text && !action) throw E.bad('Scrivi un messaggio.');
    if (text.length > cfg.limits.maxMessageChars) throw E.bad(`Il messaggio supera ${cfg.limits.maxMessageChars} caratteri.`, 'messaggio_troppo_lungo');
    // L'appartenenza al progetto viene ricontrollata a OGNI turno: una revoca interrompe subito l'accesso al contesto di gruppo.
    const projectId = s.project_id && access.membership(user.id, s.project_id) ? s.project_id : null;

    const history = db.all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 14', sessionId).reverse();
    const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
    const effectiveText = text || lastUser;
    const prevState = jparse(s.state_json, initialState());
    // Riconoscimento automatico (deterministico e prudente): materia, argomento, modalità e livello di QUESTO turno
    const pre = analyze(text, { mode: 'esercizio' });
    const det = router.resolve({ text: text || (action ? '' : lastUser), action, session: { subjectId: s.subject_id, topicId: s.topic_id, mode: s.mode, level: s.level, pins: pinsOf(s) }, state: prevState, history, subjects, signals: pre });
    const subject = subjects.resolve(det.subjectId) || subjects.GENERALE;
    const topic = subject.topics.find((t) => t.id === det.topicId) || null;
    const mode = det.mode; const level = det.level;
    const signals = analyze(text, { mode });
    const detectInfo = { subjectId: subject.id, subjectName: subject.name, topicId: topic?.id || null, topicName: topic?.name || null, mode, modeLabel: det.modeLabel, level, levelLabel: det.levelLabel, confidence: det.confidence, why: det.why, changed: det.changed };
    // con materia incerta i materiali si cercano in tutte le materie (con preferenza per quella probabile)
    const strictSubject = pinsOf(s).subject || det.confidence === 'alta';
    const searchSubject = subject.virtual ? null : strictSubject ? subject.id : null;
    const display = text || ACTION_LABEL[action];
    const userContent = action && text ? `${ACTION_LABEL[action]} — ${text}` : display;

    chargeUsage(user);
    emit('start');
    emit('detect', detectInfo);
    let state = applyUserTurn(prevState, { action, signals });
    const notices = [];
    let reply = null; let meta = {}; let simulated = false; let provider = null; let interrupted = false; let viaModel = false;

    try {
      // 1) Richiesta di aggirare protezioni: risposta deterministica, senza modello
      if (signals.safetyBypass === 'howto') {
        reply = SAFETY_REFUSAL; notices.push({ type: 'sicurezza', text: 'Richiesta sulla sicurezza: il tutor non guida a escludere protezioni.' });
      }
      // 2) Contesto di progetto (cross-chat sync): può chiedere chiarimenti senza interpellare il modello
      let project = null;
      if (!reply && projectId && ctx.collab) {
        project = ctx.collab.contextForTurn({ user, session: s, projectId, text: effectiveText, signals });
        if (project.clarification) reply = project.clarification;
        notices.push(...(project.notices || []));
      }
      // 3) Chiamata al modello
      if (!reply) {
        // 3a) link scritti dallo studente nel messaggio: il server li legge (con protezioni anti-SSRF) e li salva come suoi materiali personali, allegati a questa chat
        let linksRead = 0; let linksFailed = 0;
        if (useLinks !== false && text && ctx.links?.enabled) {
          const urls = ctx.links.extractUrls(text, 2); if (urls.length) emit('phase', { phase: 'links', count: urls.length });
          for (const url of urls) {
            try { const r = await ctx.links.importUrl(user, { url, visibility: 'personale', subjectId: searchSubject || undefined, sessionId }); linksRead++; notices.push({ type: 'link', text: `Ho letto la pagina “${r.title}” (${r.host}).` }); }
            catch (e) { linksFailed++; notices.push({ type: 'link', text: `Non sono riuscito a leggere il link ${hostOf(url) || ''}: ${e.message}` }); log.info('link non letto', { code: e.code || e.extra?.reason }); }
          }
        }
        // 3b) ricerca sul web (solo se lo studente ha attivato «Cerca»)
        let web = null; let webTried = false;
        if (useWeb && text) {
          webTried = true; emit('phase', { phase: 'web' });
          try {
            web = await ctx.web.search.search(user, text, { subjectName: subject.virtual ? undefined : subject.name });
            if (!web.results.length) notices.push({ type: 'web', text: 'La ricerca sul web non ha trovato risultati utili.' });
          } catch (e) {
            notices.push({ type: 'web', text: e instanceof WebError || e instanceof HttpError ? e.message : 'La ricerca sul web non è riuscita.' });
            log.warn('ricerca web non riuscita', { code: e.code });
          }
        }
        const webFound = web?.results?.length || 0;
        // 3c) materiali: prima quelli allegati a questa chat (file, cartella, link), poi i più pertinenti tra tutti quelli visibili
        let found = [];
        // allegati di questa chat ancora in lettura (es. una foto appena caricata, letta dal modello vista): si aspetta che siano pronti
        const pinned = materials.pinnedIds(sessionId); let attachInfo = null;
        if (pinned.length) {
          await materials.waitReady(pinned, 150_000, (n) => emit('phase', { phase: 'files', count: n }));
          const att = materials.attachments(user, sessionId);
          const notRead = att.filter((m) => m.status !== 'pronto');
          for (const m of notRead) notices.push({ type: 'materiali', text: `«${m.name}» non è stato letto: ${m.error || m.statusLabel}` });
          attachInfo = { read: att.filter((m) => m.status === 'pronto').map((m) => m.name), notRead: notRead.map((m) => m.name) };
        }
        if (useMaterials !== false) {
          const seen = new Set();
          for (const c of [...materials.focusPassages(user, sessionId, effectiveText, { subjectId: searchSubject, projectId }), ...materials.search(user, effectiveText, { subjectId: searchSubject, preferSubject: subject.virtual ? null : subject.id, topicId: topic?.id || null, projectId, k: 5 })]) {
            if (!seen.has(c.chunkId)) { seen.add(c.chunkId); found.push(c); }
          }
          found = found.slice(0, 9).map((c, i) => ({ ...c, ref: `M${i + 1}` }));
        }
        const objectives = db.all('SELECT text FROM learning_objectives WHERE subject_id = ? AND (topic_id IS NULL OR topic_id = ?) ORDER BY created_at', subject.id, topic?.id || null).map((r) => r.text);
        const asksNorm = NORM_RX.test(effectiveText);
        if (!found.length && !webFound && useMaterials !== false) notices.push({ type: 'materiali', text: asksNorm ? 'Nei materiali caricati non risultano passaggi su questo punto: il tutor non inventerà riferimenti.' : 'Nessun passaggio dei materiali pertinente a questa domanda.' });
        const system = buildSystemPrompt({ attachInfo, subject, topic, mode, level, autoDetected: !pinsOf(s).subject || !pinsOf(s).mode, detectConfidence: det.confidence, state, objectives, signals, action, materialsFound: found.length, asksNorm, hasProjectContext: !!project?.block, simulated: ctx.provider.simulated, webFound, webTried, linksRead, linksFailed });
        const safeText = effectiveText.replace(TAGS_RX, '‹tag rimosso›');
        const ctxBlocks = [webFound ? ctx.web.search.format(web) : '', formatContext(found), project?.block || ''].filter(Boolean).join('\n\n');
        const userMsg = `${ctxBlocks}\n\nMessaggio dello studente${action ? ` (azione: ${ACTION_LABEL[action]})` : ''}:\n${action && !text ? ACTION_LABEL[action] : safeText}`;
        const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userMsg }];
        const valid = new Set([...found.map((f) => f.ref), ...(web?.results || []).map((r) => r.ref), ...(project?.refs ? [...project.refs.keys()] : [])]);
        // fonti trovate: le mostro subito, prima che il modello inizi a scrivere
        emit('context', { materials: found.length, links: linksRead, notices: [...notices],
          web: webTried ? { provider: web?.label || null, query: web?.query || null, found: webFound, sources: (web?.results || []).map(({ ref, title, url, host, excerpt }) => ({ ref, title, url, host, read: !!excerpt })) } : null });
        if (signal?.aborted) { refundUsage(user); return null; } // lo studente ha interrotto prima che il modello partisse
        emit('phase', { phase: 'writing' }); viaModel = true;
        let out; let violation = null; let filter = null;
        if (onEvent && ctx.provider.stream) {
          filter = createStreamFilter({ mode, valid });
          const ac = new AbortController(); const relay = () => ac.abort(); signal?.addEventListener('abort', relay, { once: true });
          try {
            out = await ctx.provider.stream({ system, messages, task: 'tutor', signal: ac.signal, onText: (chunk) => {
              if (violation || ac.signal.aborted) return; // dopo Stop o dopo un blocco della guardia, il testo in ritardo non viene più mostrato
              const r = filter.push(chunk);
              if (r.violation) { violation = r.violation; ac.abort(); return; } // la guardia ferma il modello: il resto non verrà mai mostrato
              if (r.replace != null) emit('replace', { text: r.replace }); else if (r.delta) emit('delta', { text: r.delta });
            } });
          } finally { signal?.removeEventListener('abort', relay); }
        } else out = await ctx.provider.complete({ system, messages, task: 'tutor' });
        simulated = !!out.simulated; provider = { name: out.provider, model: out.model };
        if (violation) {
          reply = guard.FALLBACKS[violation]; notices.push({ type: 'guardia', text: 'La risposta è stata sostituita da un controllo applicativo (rispetto delle regole didattiche).' }); log.info('guard', { issues: violation, streaming: true });
          emit('replace', { text: reply });
        } else if (filter && signal?.aborted) {
          interrupted = true; reply = filter.emitted.trim(); // risposta interrotta dallo studente: si tiene ciò che era già stato mostrato (già passato dalla guardia)
          if (!reply) { refundUsage(user); return null; }
        } else {
          const split = guard.splitTrailer(out.text);
          reply = split.text;
          state = applyModelReport(state, split.report);
          const issues = guard.check(reply, { mode });
          if (issues.length) { reply = guard.FALLBACKS[issues[0]]; notices.push({ type: 'guardia', text: 'La risposta è stata sostituita da un controllo applicativo (rispetto delle regole didattiche).' }); log.info('guard', { issues: issues.join(',') }); if (filter) emit('replace', { text: reply }); }
        }
        const san = guard.sanitizeCitations(reply, valid); reply = san.text;
        if (san.removed.length) log.warn('citazioni non valide rimosse', { n: san.removed.length });
        if (onEvent && !filter) emit('delta', { text: reply }); // provider senza streaming: il testo arriva tutto insieme, a controlli finiti
        const cited = new Set([...reply.matchAll(/\[([MCDPW]\d+)\]/g)].map((m) => m[1]));
        meta = {
          citations: found.filter((f) => cited.has(f.ref)).map(({ ref, materialId, name, version, page, uploadedBy, sourceUrl }) => ({ ref, materialId, name, version, page, uploadedBy, sourceUrl: sourceUrl || undefined })),
          consulted: found.map(({ ref, materialId, name, version, page, sourceUrl }) => ({ ref, materialId, name, version, page, sourceUrl: sourceUrl || undefined })),
          ...(webTried ? { webSearch: { query: web?.query || null, provider: web?.label || null, found: webFound } } : {}),
          webSources: (web?.results || []).map(({ ref, title, url, host, excerpt }) => ({ ref, title, url, host, read: !!excerpt, cited: cited.has(ref) })),
          projectRefs: project?.refs ? [...project.refs.entries()].filter(([k]) => cited.has(k)).map(([ref, v]) => ({ ref, ...v })) : [],
          projectConsulted: project?.refs ? [...project.refs.entries()].map(([ref, v]) => ({ ref, ...v })) : [],
        };
      }
      if (onEvent && !viaModel && reply) emit('delta', { text: reply }); // risposta deterministica (sicurezza o chiarimento), senza modello
    } catch (e) {
      refundUsage(user);
      if (e instanceof ProviderError) {
        log.warn('provider IA', { code: e.code, status: e.status });
        throw new HttpError(e.code === 'rate_limited' ? 429 : 502, 'ia_non_disponibile', friendly(e.code), { retryable: e.retryable, providerCode: e.code });
      }
      throw e;
    }

    const t = now(); const uid = uuid(); const aid = uuid();
    const aMeta = { ...meta, notices, simulated, provider, ...(interrupted ? { interrupted: true } : {}) };
    db.tx(() => {
      db.run('INSERT INTO messages (id, session_id, user_id, role, content, created_at) VALUES (?,?,?,?,?,?)', uid, sessionId, user.id, 'user', userContent, t);
      db.run('INSERT INTO messages (id, session_id, user_id, role, content, meta_json, created_at) VALUES (?,?,?,?,?,?,?)', aid, sessionId, user.id, 'assistant', reply, JSON.stringify(aMeta), new Date(Date.now() + 1).toISOString());
      db.run('UPDATE chat_sessions SET state_json = ?, updated_at = ?, title = COALESCE(title, ?), subject_id = ?, topic_id = ?, mode = ?, level = ?, detect_json = ? WHERE id = ?',
        JSON.stringify(state), t, userContent.slice(0, 60), subject.id, topic?.id || null, mode, level, JSON.stringify(detectInfo), sessionId);
    });
    // Condivisione automatica (solo con consenso esplicito e revocabile) — nessuna lettura integrale delle chat
    if (projectId && ctx.collab?.onTurnCompleted) {
      try { ctx.collab.onTurnCompleted({ user, session: s, projectId, userMessageId: uid, userText: userContent, assistantText: reply, signals }); } catch (e) { log.warn('auto-share', { err: e }); }
    }
    return {
      userMessage: { id: uid, role: 'user', content: userContent, createdAt: t },
      assistantMessage: { id: aid, role: 'assistant', content: reply, ...aMeta },
      progress: progressSummary(state), simulated, detect: detectInfo,
      session: pubSession(db.get('SELECT * FROM chat_sessions WHERE id = ?', sessionId)),
    };
  }

  return { createSession, listSessions, getSession, updateSession, deleteSession, setShareExcluded, turn, chargeUsage, refundUsage, MODES, LEVELS };
}
module.exports = { createTutor, ACTION_LABEL };
