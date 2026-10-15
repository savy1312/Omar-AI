'use strict';
const crypto = require('node:crypto');
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
const jparse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const STOP = new Set('il lo la i gli le un uno una di a da in con su per tra fra e o ma che chi cui non si come più del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle mi ti ci vi ho hai ha è sono sei siamo questo questa questi queste quello quella quindi anche cosa cos perché quale quali quanto quando dove mio mia miei mie tuo tua suo sua fare fatto può posso devo vorrei voglio dammi dimmi spiegami'.split(' '));
function keywords(text, max = 12) {
  const words = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || [];
  const out = []; for (const w of words) if (!STOP.has(w) && !out.includes(w)) out.push(w);
  return out.slice(0, max);
}
// Rimuove dati personali evidenti (email, telefono) dai testi condivisi automaticamente.
function scrubPII(t) {
  return String(t).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email rimossa]').replace(/(?<!\d)(\+?\d[\d\s().-]{8,}\d)(?!\d)/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[numero rimosso]' : m));
}
module.exports = { now, uuid, sha256, hmac, jparse, clamp, keywords, scrubPII };
