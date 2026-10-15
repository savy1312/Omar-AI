// Indicatore «sto ragionando»: tre puntini in fila che saltellano su e giù per 2 secondi, poi ruotano
// lasciando una scia per 3 secondi, poi tornano in fila a saltellare, e così via.
// È un <canvas> (nessuna libreria): usa il colore del testo (currentColor) e rispetta «riduci animazioni».
export const BOUNCE_S = 2;       // secondi di saltello in fila
export const ORBIT_S = 3;        // secondi di rotazione con la scia
const BLEND_S = 0.45;            // durata del passaggio fila ⇄ cerchio
const CYCLE_S = BOUNCE_S + ORBIT_S;
const TRAIL = 16;                // posizioni ricordate per la scia
const TRAIL_MS = 260;            // quanto a lungo resta visibile la scia

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function createThinking({ width = 46, height = 30, dot = 3.1 } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const c = document.createElement('canvas');
  c.className = 'thinking'; c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
  c.style.width = `${width}px`; c.style.height = `${height}px`; c.setAttribute('aria-hidden', 'true'); c.dataset.phase = 'bounce';
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const cx = width / 2; const cy = height / 2 + 1; const gap = 11; const amp = 5.5; const R = 8.5;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hist = [[], [], []]; let color = '#fff'; let frames = 0; let t0 = 0; let raf = 0;

  function pointFor(i, t, blend) {
    // fila: i puntini affiancati che saltellano con fase sfalsata
    const rx = cx + (i - 1) * gap; const ry = cy + Math.sin((t * Math.PI * 2) / 0.85 - i * 0.9) * amp;
    // cerchio: tre puntini a 120° che girano; la velocità sale e scende dolcemente
    const ot = Math.max(0, t - BOUNCE_S);
    const ang = -Math.PI / 2 + i * ((Math.PI * 2) / 3) + ot * Math.PI * 2 * 0.95;
    const ox = cx + Math.cos(ang) * R; const oy = cy + Math.sin(ang) * R;
    return [rx + (ox - rx) * blend, ry + (oy - ry) * blend];
  }

  function draw(now) {
    if (!c.isConnected) { raf = 0; return; }
    if (!t0) t0 = now;
    const t = ((now - t0) / 1000) % CYCLE_S;
    // 0 durante il saltello, sale a 1 all'inizio della rotazione, scende a 0 poco prima della fine
    const blend = t < BOUNCE_S ? 0 : t < BOUNCE_S + BLEND_S ? ease((t - BOUNCE_S) / BLEND_S) : t > CYCLE_S - BLEND_S ? ease((CYCLE_S - t) / BLEND_S) : 1;
    c.dataset.phase = t < BOUNCE_S ? 'bounce' : 'orbit';
    if (frames++ % 30 === 0) color = getComputedStyle(c).color || '#fff';
    g.clearRect(0, 0, width, height); g.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const [x, y] = pointFor(i, t, blend);
      const hs = hist[i]; hs.push({ x, y, at: now }); while (hs.length > TRAIL || (hs.length && now - hs[0].at > TRAIL_MS)) hs.shift();
      if (blend > 0.04) {                      // scia: copie sempre più piccole e trasparenti delle posizioni passate
        for (let k = 0; k < hs.length - 1; k++) {
          const age = (now - hs[k].at) / TRAIL_MS; const life = 1 - age;
          g.globalAlpha = Math.max(0, life) * 0.5 * blend; g.beginPath(); g.arc(hs[k].x, hs[k].y, dot * (0.35 + 0.65 * life), 0, Math.PI * 2); g.fill();
        }
      }
      g.globalAlpha = 1; g.beginPath(); g.arc(x, y, dot, 0, Math.PI * 2); g.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  function still() { // «riduci animazioni»: tre puntini fermi
    color = getComputedStyle(c).color || '#fff'; g.fillStyle = color;
    for (let i = 0; i < 3; i++) { g.globalAlpha = 0.45 + i * 0.2; g.beginPath(); g.arc(cx + (i - 1) * gap, cy, dot, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  // parte al frame successivo: il chiamante ha il tempo di inserire il canvas nella pagina; se viene rimosso, il ciclo si ferma da solo
  if (reduce) requestAnimationFrame(still); else raf = requestAnimationFrame(draw);
  return c;
}
