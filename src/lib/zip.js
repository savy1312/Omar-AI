'use strict';
// Lettore ZIP minimale (senza dipendenze) per i formati che sono archivi ZIP: Word/Excel/PowerPoint (.docx .xlsx .pptx),
// OpenDocument (.odt .ods .odp), .3mf, .fcstd e i normali .zip. Solo lettura, metodi "stored" e "deflate".
// Protezioni: niente ZIP64 né file cifrati, tetti su numero di voci e dimensione decompressa (contro le "zip bomb").
const zlib = require('node:zlib');

const MAX_ENTRIES = 5000;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

function openZip(buf, { maxTotal = 120 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('archivio non valido');
  // fine della "central directory": firma 0x06054b50 negli ultimi 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('archivio ZIP non valido');
  const count = buf.readUInt16LE(eocd + 10); const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('archivio ZIP64 non supportato');
  if (count > MAX_ENTRIES) throw new Error('archivio con troppi file');
  const entries = []; let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8); const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28); const xl = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    entries.push({ name, method, csize, usize, local, encrypted: !!(flags & 1), dir: name.endsWith('/') });
    p += 46 + nl + xl + cl;
  }
  let total = 0;
  const read = (e) => {
    if (typeof e === 'string') e = entries.find((x) => x.name === e);
    if (!e || e.dir || e.encrypted) return null;
    if (e.usize > MAX_ENTRY_BYTES) throw new Error('file nell’archivio troppo grande');
    if (buf.readUInt32LE(e.local) !== 0x04034b50) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) out = Buffer.from(raw);
    else if (e.method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, Math.max(1024, e.usize * 1.1 + 1024)) });
    else return null;
    total += out.length; if (total > maxTotal) throw new Error('archivio troppo grande una volta decompresso');
    return out;
  };
  const text = (name) => { const b = read(name); return b ? b.toString('utf8') : null; };
  return { entries: entries.filter((e) => !e.dir), read, text, has: (n) => entries.some((e) => e.name === n) };
}
const isZip = (buf) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
module.exports = { openZip, isZip };
