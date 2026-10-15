'use strict';
// Finestra scorrevole in memoria. Con più istanze del server serve uno store condiviso (limite documentato).
class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  _prune(key, t) { const a = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs); this.hits.set(key, a); return a; }
  count(key, t = Date.now()) { return this._prune(key, t).length; }
  allow(key, t = Date.now()) { const a = this._prune(key, t); if (a.length >= this.max) return false; a.push(t); return true; }
  check(key, t = Date.now()) { return this._prune(key, t).length < this.max; }
  hit(key, t = Date.now()) { const a = this._prune(key, t); a.push(t); }
  retryAfterSec(key, t = Date.now()) { const a = this._prune(key, t); return a.length ? Math.max(1, Math.ceil((a[0] + this.windowMs - t) / 1000)) : 0; }
  reset(key) { this.hits.delete(key); }
  sweep() { const t = Date.now(); for (const k of [...this.hits.keys()]) if (!this._prune(k, t).length) this.hits.delete(k); }
}
module.exports = { RateLimiter };
