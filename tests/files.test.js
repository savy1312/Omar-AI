'use strict';
// Lettura di QUALSIASI file: Office, OpenDocument, CSV, RTF, HTML, SVG, codice, G-code, CAD (DXF, STEP, STL, OBJ), ZIP,
// immagini e PDF scansionati tramite il modello "vista" (qui simulato), allegati in chat che il tutor usa e cita.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { boot, fakeProvider, form, until } = require('./helpers');
const { classify, extractText } = require('../src/materials/extract');

// piccolo scrittore ZIP per costruire .docx/.xlsx/.pptx/.odt/.zip di prova
function zip(files) {
  const locals = []; const central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const comp = zlib.deflateRawSync(data); const crc = zlib.crc32(data); const nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const read = async (name, buf, opts) => { const f = classify(name, buf, opts); assert.ok(f.ok, f.reason); const r = await extractText(f, buf, opts); return { f, text: r.pages.join('\n---\n'), r }; };

test('Office e OpenDocument: Word (titoli, tabelle), Excel (fogli, formule), PowerPoint (diapositive e note), ODT', async () => {
  let { text, f } = await read('relazione.docx', zip({ 'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Calcolo dell’albero</w:t></w:r></w:p><w:p><w:r><w:t>Il momento torcente vale 12 N·m &amp; il diametro 20 mm.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Materiale</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C40</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' }));
  assert.equal(f.capability, 'ia_testo'); assert.match(text, /# Calcolo dell’albero/); assert.match(text, /12 N·m & il diametro 20 mm/); assert.match(text, /Materiale \| C40/);
  ({ text } = await read('dati.xlsx', zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Prove" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Carico [N]</t></si><si><t>Allungamento</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>500</v></c><c r="B2"><f>A2/1000</f><v>0.5</v></c></row></sheetData></worksheet>' })));
  assert.match(text, /Foglio «Prove» \(1 formule/); assert.match(text, /Carico \[N\] \| Allungamento/); assert.match(text, /2: 500 \| 0\.5 \(=A2\/1000\)/);
  ({ text } = await read('lezione.pptx', zip({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Sequenza A+ B+</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Elettropneumatica</a:t></a:r></a:p></p:sld>', 'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:t>Spiegare le valvole 5/2</a:t></a:p></p:notes>' })));
  assert.match(text, /Diapositiva 1\nElettropneumatica\nNote del relatore: Spiegare le valvole 5\/2[\s\S]*Diapositiva 2\nSequenza A\+ B\+/);
  ({ text } = await read('appunti.odt', zip({ 'content.xml': '<office:document-content><office:body><text:h>Tolleranze</text:h><text:p>Foro<text:s/>base H7</text:p></office:body></office:document-content>' })));
  assert.match(text, /Tolleranze\nForo base H7/);
  assert.equal(classify('finto.docx', Buffer.from('non sono uno zip')).ok, false);
});

test('testi, dati e codice: CSV, RTF, HTML, SVG, sorgenti, G-code; formati sconosciuti testuali letti, binari archiviati, eseguibili rifiutati', async () => {
  let { text } = await read('misure.csv', Buffer.from('prova;forza;spostamento\n1;100;0,2\n2;200;0,41\n'));
  assert.match(text, /separatore «;»/); assert.match(text, /3: 2 \| 200 \| 0,41/);
  ({ text } = await read('nota.rtf', Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Velocit\\\'e0 di taglio\\par 120 m/min}')));
  assert.match(text, /Velocità di taglio\n120 m\/min/);
  ({ text } = await read('pagina.html', Buffer.from('<html><head><title>Cuscinetti</title><script>alert(1)</script></head><body><main><h1>Scelta</h1><p>Carico dinamico C</p></main></body></html>')));
  assert.match(text, /Cuscinetti/); assert.match(text, /Carico dinamico C/); assert.doesNotMatch(text, /alert/);
  ({ text } = await read('schema.svg', Buffer.from('<svg><title>Schema</title><rect/><text x="1">K1</text><text>S0 arresto</text></svg>')));
  assert.match(text, /1 rect/); assert.match(text, /S0 arresto/);
  ({ text } = await read('nastro.scl', Buffer.from('IF "Start" AND NOT "Stop" THEN "Motore" := TRUE; END_IF;')));
  assert.match(text, /"Motore" := TRUE/);
  ({ text } = await read('flangia.nc', Buffer.from('%\n(SGROSSATURA FLANGIA)\nG21 G90\nT1 M6\nS1200 M3\nG0 X0 Y0 Z5\nG1 Z-2 F150\nG1 X40 Y0\nG2 X40 Y40 I0 J20\nG1 X0 Y40\nM30\n')));
  assert.match(text, /Programma G-code/); assert.match(text, /3 lineari \(G1\), 1 circolari/); assert.match(text, /Utensili: T1/); assert.match(text, /SGROSSATURA FLANGIA/); assert.match(text, /40,00 × 40,00 × 7,000/);
  const unk = classify('dati.xyz', Buffer.from('valore=12\nunità=mm')); assert.equal(unk.capability, 'ia_testo');
  const bin = classify('macchina.abc', Buffer.from([0, 1, 2, 3, 255, 0])); assert.equal(bin.capability, 'solo_archivio');
  assert.equal(classify('virus.exe', Buffer.from('MZ')).ok, false); assert.equal(classify('setup.dat', Buffer.from('MZ\x90\x00')).ok, false);
  assert.match(classify('pezzo.sldprt', Buffer.from([0, 1])).hint, /STEP, STL, DXF/);
});

test('CAD: DXF (unità, quote, testi, layer), STEP (parti, unità, ingombro), STL binario e ASCII (ingombro, volume), OBJ', async () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', '120', '20', '80', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'CONTORNO', '10', '0', '20', '0', '11', '120', '21', '0', '0', 'CIRCLE', '8', 'FORI', '10', '30', '20', '40', '40', '5',
    '0', 'DIMENSION', '8', 'QUOTE', '1', '<>', '42', '120', '0', 'TEXT', '8', 'TESTI', '1', 'Materiale: S235 - Rugosità Ra 3,2', '0', 'MTEXT', '8', 'TESTI', '1', 'Smussi non quotati\\P1x45°', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  let { text } = await read('piastra.dxf', Buffer.from(dxf));
  assert.match(text, /unità: mm/); assert.match(text, /120,00 × 80,00 mm/); assert.match(text, /Quote[^\n]*Ø10,00 \(cerchio\); 120,00/); assert.match(text, /Materiale: S235/); assert.match(text, /Smussi non quotati 1x45°/); assert.match(text, /CONTORNO, FORI, QUOTE, TESTI/);
  const step = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('albero di trasmissione'),'2;1');\nFILE_NAME('albero.step','2026-10-01',('Elia'),('ITI Omar'),'','SolidWorks 2024','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=PRODUCT('ALBERO','Albero motore','',(#2));\n#3=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n#10=CARTESIAN_POINT('',(0.,0.,0.));\n#11=CARTESIAN_POINT('',(250.,20.,20.));\n#12=CYLINDRICAL_SURFACE('',#10,10.);\nENDSEC;\nEND-ISO-10303-21;";
  ({ text } = await read('albero.step', Buffer.from(step)));
  assert.match(text, /albero di trasmissione/); assert.match(text, /autore Elia/); assert.match(text, /creato con SolidWorks 2024/); assert.match(text, /millimetri/); assert.match(text, /ALBERO — Albero motore/); assert.match(text, /250,00 × 20,00 × 20,00 mm/); assert.match(text, /1 CYLINDRICAL_SURFACE/);
  // cubo 10×10×10 come STL binario (12 triangoli)
  const V = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const stl = Buffer.alloc(84 + F.length * 50); stl.write('cubo prova', 0); stl.writeUInt32LE(F.length, 80);
  F.forEach((f, i) => f.forEach((vi, k) => V[vi].forEach((c, j) => stl.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  ({ text } = await read('cubo.stl', stl));
  assert.match(text, /«cubo prova»/); assert.match(text, /12 triangoli/); assert.match(text, /10,00 × 10,00 × 10,00/); assert.match(text, /Volume racchiuso: 1000,0/); assert.match(text, /Superficie: 600,00/);
  const ascii = `solid tri\n${F.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((vi) => `vertex ${V[vi].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid`;
  ({ text } = await read('cubo_ascii.stl', Buffer.from(ascii))); assert.match(text, /Volume racchiuso: 1000,0/);
  ({ text } = await read('pezzo.obj', Buffer.from(`o Staffa\n${V.map((v) => `v ${v.join(' ')}`).join('\n')}\n${F.map((f) => `f ${f.map((x) => x + 1).join(' ')}`).join('\n')}\n`)));
  assert.match(text, /Staffa/); assert.match(text, /Volume racchiuso: 1000,0/);
});

test('ZIP ("cartella compressa"): elenco del contenuto e lettura dei file supportati al suo interno; difese contro archivi malevoli', async () => {
  const z = zip({ 'progetto/relazione.txt': 'Il riduttore ha rapporto 1:5.', 'progetto/dati.csv': 'a;b\n1;2', 'progetto/foto.png': 'x', '__MACOSX/._x': 'y' });
  const { text, r } = await read('progetto.zip', z);
  assert.match(text, /Archivio ZIP con 3 file/); assert.match(text, /File «progetto\/relazione\.txt»\nIl riduttore ha rapporto 1:5/); assert.match(text, /File «progetto\/dati\.csv»/); assert.doesNotMatch(text, /MACOSX/); assert.match(r.note, /1 non letti/);
  // "zip bomb": dimensione dichiarata enorme → si rifiuta senza decomprimere
  const bomb = zip({ 'a.txt': 'x'.repeat(1000) }); bomb.writeUInt32LE(900 * 1048576, bomb.readUInt32LE(bomb.length - 22 + 16) + 24);
  const rb = await extractText(classify('bomba.zip', bomb), bomb);
  assert.match(rb.note, /1 non letti/); assert.doesNotMatch(rb.pages.join(''), /xxxx/);
  const { openZip } = require('../src/lib/zip'); assert.throws(() => openZip(bomb).read('a.txt'), /troppo grande/);
});

// provider finto con "vista": restituisce una descrizione e registra cosa ha ricevuto
function visionProvider() {
  const p = fakeProvider();
  p.visionCalls = [];
  p.visionModel = async () => 'vista-test';
  p.vision = async ({ image, mime }) => { p.visionCalls.push({ size: image.length, mime }); return { text: 'TIPO: esercizio scritto a mano.\nTESTO: Calcolare la reazione vincolare R_A di una trave lunga 2 m con carico F = 500 N in mezzeria.\nCONTENUTO: schema con appoggio e carrello.', model: 'vista-test' }; };
  return p;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);

test('immagini con il modello vista: descritte e trascritte, citabili; allegate in chat, il tutor aspetta la lettura e le usa', async () => {
  const provider = visionProvider();
  const t = await boot({ provider }); const u = await t.user('Gaia');
  await t.ctx.vision.model();
  const s = (await u.api('POST', '/api/sessions', {})).body.session;
  const up = await u.api('POST', '/api/materials', form({ visibility: 'personale', sessionId: s.id }, { name: 'esercizio.png', type: 'image/png', data: PNG }));
  assert.equal(up.status, 201); assert.equal(up.body.material.capability, 'ia_testo');
  // la domanda parte subito: il server aspetta che l'immagine sia letta
  const r = await u.api('POST', `/api/sessions/${s.id}/messages`, { text: 'Mi aiuti con questo esercizio della foto?' });
  assert.equal(r.status, 200);
  const call = provider.tutorCalls().at(-1);
  assert.match(call.messages.at(-1).content, /Calcolare la reazione vincolare R_A/); assert.match(call.messages.at(-1).content, /fatta dal modello IA vista-test/);
  assert.match(call.system, /ha allegato a questa chat: «esercizio\.png»/); assert.match(call.system, /trascrizione automatica/);
  assert.equal(provider.visionCalls[0].mime, 'image/png');
  const m = (await u.api('GET', `/api/materials/${up.body.material.materialId}`)).body.material;
  assert.equal(m.status, 'pronto'); assert.match(m.capabilityLabel, /descritta e trascritta/);
  const att = (await u.api('GET', `/api/sessions/${s.id}/attachments`)).body.attachments; assert.equal(att.length, 1);
  assert.equal((await u.api('DELETE', `/api/sessions/${s.id}/materials/${m.materialId}`)).status, 200);
  assert.equal((await u.api('GET', `/api/sessions/${s.id}/attachments`)).body.attachments.length, 0);
  const info = (await t.anon('GET', '/api/info')).body; assert.equal(info.capabilities.imageAnalysis, true); assert.equal(info.capabilities.visionModel, 'vista-test');
  await t.close();
});

test('senza modello vista l\'immagine resta visibile; installato il modello, «Rileggi» la fa leggere; allegati non letti dichiarati al tutor', async () => {
  const provider = visionProvider(); const vm = provider.visionModel; provider.visionModel = async () => null;
  const t = await boot({ provider }); const u = await t.user('Ugo'); await t.ctx.vision.model();
  const s = (await u.api('POST', '/api/sessions', {})).body.session;
  const up = (await u.api('POST', '/api/materials', form({ visibility: 'personale', sessionId: s.id }, { name: 'foto.png', type: 'image/png', data: PNG }))).body.material;
  assert.equal(up.capability, 'visualizzabile');
  await until(async () => (await u.api('GET', `/api/materials/${up.materialId}`)).body.material.status === 'non_supportato');
  await u.api('POST', `/api/sessions/${s.id}/messages`, { text: 'Cosa c’è nella foto?' });
  assert.match(provider.tutorCalls().at(-1).system, /NON sono stati letti: «foto\.png»/);
  provider.visionModel = vm; await t.ctx.vision.model();
  const re = await u.api('POST', `/api/materials/${up.materialId}/reprocess`);
  assert.equal(re.status, 200); assert.equal(re.body.material.capability, 'ia_testo');
  await until(async () => (await u.api('GET', `/api/materials/${up.materialId}`)).body.material.status === 'pronto');
  const v = await t.user('Vera'); assert.equal((await v.api('POST', `/api/materials/${up.materialId}/reprocess`)).status, 404);
  await t.close();
});

test('PDF scansionato (solo immagini JPEG): le pagine vengono lette dal modello vista', async () => {
  const provider = visionProvider(); const t = await boot({ provider }); const u = await t.user('Ivo'); await t.ctx.vision.model();
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30000, 0x41), Buffer.from([0xff, 0xd9])]);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>', null, null];
  const content = 'q 595 0 0 842 0 0 cm /Im1 Do Q';
  let out = Buffer.from('%PDF-1.4\n', 'latin1'); const offs = [];
  const push = (b) => { out = Buffer.concat([out, typeof b === 'string' ? Buffer.from(b, 'latin1') : b]); };
  objs.forEach((o, i) => {
    offs.push(out.length);
    if (i === 3) push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    else if (i === 4) { push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n'); }
    else push(`${i + 1} 0 obj\n${o}\nendobj\n`);
  });
  const xref = out.length; push(`xref\n0 6\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const up = (await u.api('POST', '/api/materials', form({ visibility: 'personale' }, { name: 'scansione.pdf', type: 'application/pdf', data: out }))).body.material;
  await until(async () => ['pronto', 'fallito'].includes((await u.api('GET', `/api/materials/${up.materialId}`)).body.material.status), 8000);
  const m = (await u.api('GET', `/api/materials/${up.materialId}`)).body.material;
  assert.equal(m.status, 'pronto', m.error); assert.match(m.error, /PDF scansionato: 1 pagine trascritte/);
  assert.equal(provider.visionCalls.length, 1); assert.equal(provider.visionCalls[0].mime, 'image/jpeg');
  assert.ok(t.ctx.materials.search(u.user, 'reazione vincolare trave', {}).length >= 1);
  await t.close();
});

test('Word e foglio Excel caricati davvero: indicizzati e citati dal tutor', async () => {
  const t = await boot(); const u = await t.user('Lea');
  const s = (await u.api('POST', '/api/sessions', {})).body.session;
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Il cilindro pneumatico a doppio effetto ha alesaggio 40 mm e corsa 200 mm.</w:t></w:r></w:p></w:body></w:document>' });
  const up = await u.api('POST', '/api/materials', form({ visibility: 'personale', sessionId: s.id }, { name: 'cilindro.docx', type: 'application/octet-stream', data: docx }));
  assert.equal(up.status, 201);
  await u.api('POST', `/api/sessions/${s.id}/messages`, { text: 'Riassumimi il documento allegato' });
  assert.match(provider_last(t), /alesaggio 40 mm e corsa 200 mm/);
  await t.close();
});
const provider_last = (t) => t.provider.tutorCalls().at(-1).messages.at(-1).content;
