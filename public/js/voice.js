// OMAR VOICE — dettatura (speech-to-text) dei prompt e lettura ad alta voce (text-to-speech) delle risposte.
// Usa le API del browser (Web Speech). Trasparenza: in Chrome ed Edge il riconoscimento vocale viene svolto dai server
// di Google/Microsoft; la sintesi vocale usa invece le voci installate sul dispositivo. Nulla passa dal server di Omar.
import { h, toast } from './dom.js';
import { icon } from './icons.js';

const KEY = 'omar.voice';
const load = () => { try { return { autoRead: false, rate: 1, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { autoRead: false, rate: 1 }; } };

// testo "pulito" da leggere: niente markdown, formule rese a parole semplici, niente riferimenti [M1]
export function speakable(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' (c’è un blocco di codice: lo trovi sullo schermo) ')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => ` ${f} `).replace(/\$([^$\n]+)\$/g, (_, f) => ` ${f} `)
    .replace(/\\cdot/g, ' per ').replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, ' $1 fratto $2 ').replace(/\\sqrt\{([^}]*)\}/g, ' radice di $1 ').replace(/\^2\b/g, ' al quadrato ').replace(/\^3\b/g, ' al cubo ').replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\[[MCDPW]\d+\]/g, '').replace(/[*_#>`|]/g, ' ').replace(/^\s*[-•]\s+/gm, '. ').replace(/[{}]/g, ' ')
    .replace(/N·m/g, 'newton metro').replace(/\bkN\b/g, 'kilonewton').replace(/\bMPa\b/g, 'megapascal').replace(/\bmm\b/g, 'millimetri').replace(/\brpm\b/gi, 'giri al minuto')
    .replace(/\s+/g, ' ').trim();
}

export function createVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const prefs = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignora */ } };
  let rec = null; let recBtn = null; let speakingBtn = null;

  const voiceIt = () => { const vs = synth?.getVoices?.() || []; return vs.find((v) => /^it(-|_)IT/i.test(v.lang) && /google|natural|neural|online/i.test(v.name)) || vs.find((v) => /^it/i.test(v.lang)) || null; };
  function stopSpeaking() { try { synth?.cancel(); } catch { /* ignora */ } if (speakingBtn) { speakingBtn.classList.remove('on'); speakingBtn.setAttribute('aria-pressed', 'false'); speakingBtn = null; } }
  function speak(text, btn = null) {
    if (!synth) { toast('Questo browser non sa leggere ad alta voce.', 'bad'); return; }
    if (btn && speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();
    const chunks = speakable(text).match(/[^.!?;:]+[.!?;:]*/g) || []; if (!chunks.length) return;
    const v = voiceIt();
    if (btn) { speakingBtn = btn; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
    chunks.forEach((c, i) => { // a frasi: le voci di alcuni browser si interrompono sui testi lunghi
      const u = new SpeechSynthesisUtterance(c.trim()); u.lang = 'it-IT'; if (v) u.voice = v; u.rate = prefs.rate || 1;
      if (i === chunks.length - 1) u.onend = () => { if (speakingBtn === btn) stopSpeaking(); };
      synth.speak(u);
    });
  }
  function stopListening() { try { rec?.stop(); } catch { /* ignora */ } }
  // pulsante microfono per un campo di testo: detta, poi il testo si inserisce nel campo (non viene inviato da solo)
  function micButton(getInput) {
    const btn = h('button', { class: 'cbtn cmic', type: 'button', 'aria-pressed': 'false', 'aria-label': SR ? 'Detta con la voce' : 'Dettatura non disponibile in questo browser', title: SR ? 'Detta con la voce (Omar Voice)' : 'Dettatura non disponibile in questo browser' }, icon('mic', 18));
    if (!SR) btn.classList.add('off');
    btn.addEventListener('click', () => {
      if (!SR) { toast('La dettatura vocale non è supportata da questo browser: prova Chrome o Edge.', 'bad'); return; }
      if (rec && recBtn === btn) { stopListening(); return; }
      stopListening(); stopSpeaking();
      const input = getInput(); if (!input) return;
      const base = input.value ? `${input.value.replace(/\s+$/, '')} ` : '';
      rec = new SR(); rec.lang = 'it-IT'; rec.interimResults = true; rec.continuous = true; recBtn = btn;
      let finalTxt = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalTxt += r[0].transcript; else interim += r[0].transcript; }
        input.value = (base + finalTxt + interim).replace(/\s+/g, ' ').replace(/^\s/, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Per dettare serve il permesso di usare il microfono.', 'bad'); else if (e.error === 'network') toast('Il riconoscimento vocale non è raggiungibile (serve internet).', 'bad'); else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Dettatura interrotta.', 'bad'); };
      rec.onend = () => { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); document.body.classList.remove('listening'); rec = null; recBtn = null; input.focus(); };
      try { rec.start(); btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); document.body.classList.add('listening'); toast('Ti ascolto… premi di nuovo il microfono per finire.'); } catch { toast('Impossibile avviare il microfono.', 'bad'); }
    });
    return btn;
  }
  // pulsante "leggi ad alta voce" per una risposta
  const speakButton = (getText) => {
    if (!synth) return null;
    const b = h('button', { class: 'btn sm ghost speak', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Leggi ad alta voce', title: 'Leggi ad alta voce (Omar Voice)' }, icon('volume', 15));
    b.addEventListener('click', () => speak(getText(), b)); return b;
  };
  synth?.getVoices?.(); // alcune piattaforme caricano le voci in ritardo
  window.addEventListener('hashchange', () => { stopSpeaking(); stopListening(); });
  return {
    prefs, canSpeak: !!synth, canListen: !!SR, speak, stopSpeaking, micButton, speakButton,
    setPref(k, v) { prefs[k] = v; save(); },
    maybeAutoRead(text) { if (prefs.autoRead && synth) speak(text); },
  };
}
