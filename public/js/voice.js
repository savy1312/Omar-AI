// OMAR VOICE — dettatura (speech-to-text) dei prompt e lettura ad alta voce (text-to-speech) delle risposte.
// Usa le API del browser (Web Speech). Trasparenza: in Chrome ed Edge il riconoscimento vocale viene svolto dai server
// di Google/Microsoft; la sintesi vocale usa invece le voci installate sul dispositivo. Nulla passa dal server di Omar.
import { h, toast } from './dom.js';
import { icon } from './icons.js';
import { pickMaleVoice } from './tutorial-voice.js';

const KEY = 'omar.voice';
// LETTURA AD ALTA VOCE: messa a spegne (richiesta della docente). Per riaccenderla: true.
const VOICE_OUT = false;
const load = () => { try { return { autoRead: false, rate: 0.92, calm: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { autoRead: false, rate: 0.92, calm: true }; } };

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

  // voce «calma»: maschile italiana (Diego/Giuseppe in Edge, Cosimo in Windows…), un po' più lenta e più bassa; se manca, la migliore italiana
  const anyIt = () => { const vs = synth?.getVoices?.() || []; return vs.find((v) => /^it(-|_)IT/i.test(v.lang) && /google|natural|neural|online/i.test(v.name)) || vs.find((v) => /^it/i.test(v.lang)) || null; };
  const voiceIt = () => (prefs.calm !== false ? pickMaleVoice() : null) || anyIt();
  function stopSpeaking() { try { synth?.cancel(); } catch { /* ignora */ } if (speakingBtn) { speakingBtn.classList.remove('on'); speakingBtn.setAttribute('aria-pressed', 'false'); speakingBtn = null; } }
  function speak(text, btn = null) {
    if (!synth) { toast('Questo browser non sa leggere ad alta voce.', 'bad'); return; }
    if (btn && speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();
    const chunks = speakable(text).match(/[^.!?;:]+[.!?;:]*/g) || []; if (!chunks.length) return;
    const v = voiceIt();
    if (btn) { speakingBtn = btn; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
    chunks.forEach((c, i) => { // a frasi: le voci di alcuni browser si interrompono sui testi lunghi
      const u = new SpeechSynthesisUtterance(c.trim()); u.lang = 'it-IT'; if (v) u.voice = v; u.rate = prefs.rate || 1; u.pitch = prefs.calm !== false ? 0.88 : 1;
      if (i === chunks.length - 1) u.onend = () => { if (speakingBtn === btn) stopSpeaking(); };
      synth.speak(u);
    });
  }
  function stopListening() { try { rec?.stop(); } catch { /* ignora */ } }
  // onda sonora nella Dynamic Island mentre detti: livello del microfono in 7 bande (solo nel browser, niente viene registrato)
  let wave = null;
  async function startWave() {
    window.dispatchEvent(new CustomEvent('omar:listen', { detail: { on: true } }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.7;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount); const bands = [2, 4, 7, 11, 16, 23, 32];
      wave = { stream, ac, raf: 0 };
      const tick = () => {
        if (!wave) return; an.getByteFrequencyData(buf);
        const levels = bands.map((b, i) => { const lo = i ? bands[i - 1] : 1; let m = 0; for (let k = lo; k <= b; k++) m = Math.max(m, buf[k]); return m / 255; });
        window.dispatchEvent(new CustomEvent('omar:wave', { detail: { levels } })); wave.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* senza permesso o senza microfono: la spia resta, l'onda no */ }
  }
  function stopWave() {
    if (wave) { cancelAnimationFrame(wave.raf); wave.stream.getTracks().forEach((t) => t.stop()); wave.ac.close().catch(() => {}); wave = null; }
    window.dispatchEvent(new CustomEvent('omar:listen', { detail: { on: false } }));
  }
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
      rec.onend = () => { stopWave(); btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); document.body.classList.remove('listening'); rec = null; recBtn = null; input.focus(); };
      try { rec.start(); startWave(); btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); document.body.classList.add('listening'); toast('Ti ascolto… premi di nuovo il microfono per finire.'); } catch { toast('Impossibile avviare il microfono.', 'bad'); }
    });
    return btn;
  }
  // pulsante "leggi ad alta voce" per una risposta
  // NB: la lettura ad alta voce è disattivata (richiesta della docente): nessun pulsante e nessuna lettura automatica.
  // Resta la dettatura (microfono), che è un'altra funzione.
  const speakButton = (getText) => {
    if (!synth) return null;
    if (!VOICE_OUT) return null;
    const b = h('button', { class: 'btn sm ghost speak', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Leggi ad alta voce', title: 'Leggi ad alta voce (Omar Voice)' }, icon('volume', 15));
    b.addEventListener('click', () => speak(getText(), b)); return b;
  };
  synth?.getVoices?.(); // alcune piattaforme caricano le voci in ritardo
  window.addEventListener('hashchange', () => { stopSpeaking(); stopListening(); });
  return {
    prefs, canSpeak: !!synth, canListen: !!SR, speak, stopSpeaking, micButton, speakButton, voiceName: () => voiceIt()?.name || null, hasMale: () => !!pickMaleVoice(),
    setPref(k, v) { prefs[k] = v; save(); },
    maybeAutoRead(text) { if (VOICE_OUT && prefs.autoRead && synth) speak(text); },
  };
}
