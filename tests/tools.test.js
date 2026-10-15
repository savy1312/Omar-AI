'use strict';
// Quick Tools (logica pura, senza browser): convertitore di unità, calcolatrice senza eval, basi numeriche, formattatori; testo per Omar Voice.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('convertitore di unità: grandezze tecniche e temperatura', async () => {
  const { convert } = await load('tools.js');
  close(convert('pressione', 6, 'bar', 'MPa'), 0.6);
  close(convert('pressione', 1, 'MPa', 'N/mm²'), 1);
  close(convert('coppia', 12, 'N·m', 'N·mm'), 12000);
  close(convert('potenza', 1, 'CV', 'kW'), 0.73549875);
  close(convert('angolare', 1450, 'giri/min', 'rad/s'), 1450 * 2 * Math.PI / 60);
  close(convert('lunghezza', 1, 'in', 'mm'), 25.4);
  close(convert('temperatura', 100, '°C', '°F'), 212);
  close(convert('temperatura', 0, 'K', '°C'), -273.15);
  assert.ok(Number.isNaN(convert('boh', 1, 'a', 'b')));
});

test('calcolatrice: precedenze, funzioni, gradi/radianti, errori chiari, niente eval', async () => {
  const { evaluate } = await load('tools.js');
  close(evaluate('2+3*4'), 14); close(evaluate('(2+3)*4'), 20); close(evaluate('2^3^2'), 512); close(evaluate('-2^2'), -4);
  close(evaluate('sqrt(16)+sin(30)'), 4.5); close(evaluate('sin(pi/2)', { deg: false }), 1); close(evaluate('2pi'), 2 * Math.PI);
  close(evaluate('3(4+1)'), 15); close(evaluate('1,5*2'), 3); close(evaluate('5!'), 120); close(evaluate('50%'), 0.5); close(evaluate('1e3/4'), 250);
  close(evaluate('ans*2', { ans: 21 }), 42); close(evaluate('g'), 9.80665); close(evaluate('log(1000)'), 3); close(evaluate('asin(1)'), 90);
  assert.throws(() => evaluate('2+'), /incompleta/); assert.throws(() => evaluate('(2+3'), /parentesi/); assert.throws(() => evaluate('alert(1)'), /Non conosco/);
  assert.throws(() => evaluate('constructor'), /Non conosco/); assert.throws(() => evaluate(''), /espressione/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tools.js'), 'utf8');
  assert.doesNotMatch(src, /\beval\s*\(|new Function/, 'la calcolatrice non usa eval');
});

test('basi numeriche: conversioni, complemento a due e controlli di input', async () => {
  const { parseBase, toBases } = await load('tools.js');
  assert.equal(parseBase('FF', 16), 255n); assert.equal(parseBase('0b1010', 2), 10n); assert.equal(parseBase('-12', 10), -12n);
  assert.ok(Number.isNaN(parseBase('12', 2))); assert.equal(parseBase('', 10), null);
  let r = toBases(255n, 8); assert.equal(r.hex, 'FF'); assert.equal(r.bin, '1111 1111'); assert.equal(r.oct, '377'); assert.equal(r.overflow, false);
  r = toBases(-1n, 16, true); assert.equal(r.dec, '-1'); assert.equal(r.hex, 'FFFF');
  r = toBases(300n, 8); assert.equal(r.overflow, true); assert.equal(r.dec, '44');
  r = toBases(128n, 8, true); assert.equal(r.overflow, true); assert.equal(r.dec, '-128');
});

test('formattatori: JSON con posizione dell\'errore e riordino dell\'indentazione', async () => {
  const { formatJson, formatCode } = await load('tools.js');
  assert.equal(formatJson('{"a":1,"b":[1,2]}').text, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(formatJson('{ "a" : 1 }', { minify: true }).text, '{"a":1}');
  const bad = formatJson('{"a":1,}'); assert.equal(bad.ok, false); assert.match(bad.error, /JSON non valido/);
  assert.equal(formatCode('void setup(){\nint a=1;\nif(a){\nb();\n}\n}'), 'void setup(){\n  int a=1;\n  if(a){\n    b();\n  }\n}\n');
  assert.equal(formatCode('def f():\n\treturn 1   \n', 'python'), 'def f():\n    return 1\n');
});

test('Omar Voice: il testo letto ad alta voce è pulito (niente markdown, formule rese a parole)', async () => {
  const { speakable } = await load('voice.js');
  const t = speakable('La **coppia** vale $C = \\frac{P}{\\omega}$ [M1].\n- 12 N·m\n```js\nx()\n```');
  assert.doesNotMatch(t, /[*$\\[\]`]/); assert.match(t, /P fratto/); assert.match(t, /newton metro/); assert.match(t, /blocco di codice/);
});
