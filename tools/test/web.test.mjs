// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Unit tests for the screens' own logic (CSV import, card dates):   node --test tools/test/
// The service's logic is tested in C#: dotnet test desktop/tests/IdCard.Tests
import test from 'node:test';
import assert from 'node:assert/strict';

const { readPeople, isoDate, parseCSV, buildPhotoIndex, matchPhoto, nameKey } = await import('../../web/js/csv.js');
const { formatDate, layoutText, photoGeometry } = await import('../../web/js/render.js');

test('CSV: NZ day-first dates and custom columns', () => {
  assert.equal(isoDate('31/03/2027'), '2027-03-31');
  assert.equal(isoDate('1-4-27'), '2027-04-01');
  assert.equal(isoDate('2027-03-31'), '2027-03-31');
  assert.equal(isoDate('next year'), 'next year');
  const custom = [{ key: 'cf_exp', label: 'Expiry date', type: 'date' }, { key: 'cf_dep', label: 'Department', type: 'text' }];
  const { people } = readPeople('First Name,Last Name,Expiry Date,Department\nMere,Tūhoe,31/03/2028,Kaitiaki\n', custom);
  assert.equal(people[0].cf_exp, '2028-03-31'); assert.equal(people[0].cf_dep, 'Kaitiaki'); assert.equal(people[0].lastName, 'Tūhoe');
  assert.deepEqual(parseCSV('a,b\n12" Pipe Rd,x\n'), [['a', 'b'], ['12" Pipe Rd', 'x']]);
});

test('CSV: a people export imports straight back', () => {
  const exported = '\ufeffFirst Name,Last Name,Staff ID Number,Position,Title,Address,Card Status,Notes,ID Photo,Times Printed,Last Printed\r\n'
    + "Lena,'=SUM(1+1),KH-006,Volunteer,Ms,,Active,,,0,\r\n"
    + 'Aroha,Ngata,KH-003,"Manager, Ward 4",Ms,,Active,,aroha.jpg,0,\r\n'
    + 'Mere,Tūhoe,KH-001,Kaiāwhina,Ms,"12 Example Street, Thorndon",Active,,mere.jpg,0,\r\n';
  const { people, warning } = readPeople(exported);
  assert.equal(warning, '');
  assert.deepEqual(people.map(p => [p.firstName, p.lastName, p.staffId, p.position, p.address, p.photoFile]), [
    ['Lena', '=SUM(1+1)', 'KH-006', 'Volunteer', '', ''],
    ['Aroha', 'Ngata', 'KH-003', 'Manager, Ward 4', '', 'aroha.jpg'],
    ['Mere', 'Tūhoe', 'KH-001', 'Kaiāwhina', '12 Example Street, Thorndon', 'mere.jpg']]);
});

test('ID photos match by file name, path, missing extension or the person\'s name', () => {
  const files = ['mere.jpg', 'sam-lee.png', 'aroha.jpg', 'ben_smith.jpg'].map(name => ({ name }));
  const idx = buildPhotoIndex(files);
  const m = (photoFile, firstName = 'X', lastName = 'Y') => matchPhoto(idx, { photoFile, firstName, lastName })?.name || null;
  assert.equal(m('mere.jpg'), 'mere.jpg');
  assert.equal(m('C:\\Photos\\SAM-LEE.PNG'), 'sam-lee.png');
  assert.equal(m('aroha'), 'aroha.jpg');
  assert.equal(m('', 'Ben', 'Smith'), 'ben_smith.jpg');
  assert.equal(m('missing.jpg', 'Mere', 'X'), null);   // a named file that isn't there never falls back to a name match
});

test('ID photos match the person\'s full name in any case, with or without spaces', () => {
  const john = { firstName: 'John', lastName: 'Smith', photoFile: '' };
  for (const name of ['John Smith.jpg', 'JOHN SMITH.JPG', 'john smith.png', 'johnsmith.jpg', 'JOHNSMITH.jpeg', 'JohnSmith.webp', 'john_smith.jpg', 'Smith, John.jpg'])
    assert.equal(matchPhoto(buildPhotoIndex([{ name }]), john)?.name, name, name);
  const idx = buildPhotoIndex(['Mere Tuhoe.jpg', '7.jpg', 'Jane Doe.png', 'jo.jpg'].map(name => ({ name })));
  assert.equal(matchPhoto(idx, { firstName: 'Mere', lastName: 'Tūhoe', photoFile: '' })?.name, 'Mere Tuhoe.jpg');   // macrons don't matter
  assert.equal(matchPhoto(idx, { firstName: 'Jane', lastName: 'Dow', photoFile: '' }), null);   // a different name never matches
  assert.equal(matchPhoto(idx, { firstName: '', lastName: '', photoFile: '' }), null);
  assert.equal(matchPhoto(idx, { firstName: 'Jane', lastName: 'Doe', photoFile: '7.jpg' })?.name, '7.jpg');          // a named ID Photo still wins
  assert.equal(nameKey('  Ana-María  O\'Neil '), 'anamariaoneil');
});

test('Help topics are built from the current user guide', async () => {
  const fs = await import('node:fs');
  const { buildTopics, render, GUIDE, OUT } = await import('../gen-help.mjs');
  const topics = buildTopics(fs.readFileSync(GUIDE, 'utf8'));   // throws on a link to a missing topic or a topic without a summary
  assert.ok(topics.length >= 15 && topics.every(t => t.summary && t.html && t.text));
  assert.equal(fs.readFileSync(OUT, 'utf8'), render(topics), 'docs/USER-GUIDE.md changed: run node tools/gen-help.mjs');
  assert.ok(!/<(script|img|iframe)/i.test(topics.map(t => t.html).join('')));
});

test('text always fits its box: shrink, then wrap a long name (also after a hyphen), then shrink further', () => {
  // A stand-in canvas: each character is half the font size wide; capitals 0.7 and descenders 0.2 of it.
  const ctx = { font: '', letterSpacing: '', measureText(t) { const s = +this.font.match(/([\d.]+)px/)[1]; return { width: t.length * s / 2, actualBoundingBoxAscent: s * 0.7, actualBoundingBoxDescent: s * 0.2 }; } };
  const box = { field: 'lastName', x: 10, y: 20, w: 300, h: 120, size: 60, minSize: 40, valign: 'middle' };
  const check = (value) => {
    const r = layoutText(ctx, box, value); ctx.font = `500 ${r.size}px x`;
    assert.ok(r.lines.every(l => ctx.measureText(l).width <= box.w), `${value} is too wide`);
    assert.ok(r.top >= box.y && r.top + r.cap + (r.lines.length - 1) * r.lh + r.size * 0.2 <= box.y + box.h, `${value} leaves its box`);
    return [r.size, r.lines];
  };
  assert.deepEqual(check('Ng'), [60, ['Ng']]);
  assert.deepEqual(check('Sampleton-Placeholderson'), [40, ['Sampleton-', 'Placeholderson']]);
  assert.deepEqual(check('Jane Sample-Placeholderson'), [40, ['Jane Sample-', 'Placeholderson']]);
  const [size, lines] = check('Supercalifragilisticexpialidocious');   // nowhere to break: smaller than the smallest size, but inside the box
  assert.ok(size < 40 && lines.length === 1);
});

test('ID photos fill the frame or show whole, and zoom out to the whole photo', () => {
  const img = { naturalWidth: 1600, naturalHeight: 1200 }, box = { x: 0, y: 0, w: 360, h: 480 };   // a landscape photo, a portrait frame
  const fill = photoGeometry(img, box, {});
  assert.deepEqual([fill.dw, fill.dh], [640, 480]);   // fills the frame: the sides are trimmed
  assert.equal(fill.minZoom, 0.5625);
  const out = photoGeometry(img, box, { zoom: 0.1, oy: 1 });   // zoomed further out than possible, and moved down
  assert.deepEqual([out.dw, out.dh, out.dx, out.dy], [360, 270, 0, 210]);   // the whole photo, resting on the bottom of the frame
  const whole = photoGeometry(img, { ...box, fit: 'contain' }, {});
  assert.deepEqual([whole.dw, whole.dh, whole.minZoom], [360, 270, 1]);   // the template shows whole photos by default
  assert.deepEqual([photoGeometry(img, box, { zoom: 9 }).dw], [2560]);   // at most 4 times
  // The zoom slider can stop just short of filling the frame (0.992): it snaps to fill, so dragging leaves no gap.
  const near = photoGeometry(img, box, { zoom: 0.992, oy: -1 });   // dragged up as far as it goes
  assert.deepEqual([near.dh, near.dy, near.maxY], [480, 0, 0]);    // still covers the frame top to bottom
  const nearWhole = photoGeometry(img, { ...box, fit: 'contain' }, { zoom: 1.02 });
  assert.deepEqual([nearWhole.dw, nearWhole.dh], [360, 270]);   // and close to the whole photo, to the whole photo
  assert.equal(Math.round(photoGeometry(img, box, { zoom: 0.9 }).dw), 576);   // further out stays where it was put
});

test('card dates in each format', () => {
  assert.equal(formatDate('2027-03-31', 'DD/MM/YYYY'), '31/03/2027');
  assert.equal(formatDate('2027-03-31', 'D MMM YYYY'), '31 Mar 2027');
  assert.equal(formatDate('2027-03-01', 'MMM YYYY'), 'Mar 2027');
  assert.equal(formatDate('2027-03-31', 'MM/YY'), '03/27');
  assert.equal(formatDate('2027-03-31'), '31/03/2027');
  assert.equal(formatDate('not a date', 'MM/YY'), 'not a date');
});

test('Help search ignores case and accents, needs every word, ranks title matches first', async () => {
  const { search, snippet } = await import('../../web/js/helpview.js');
  const { HELP_TOPICS } = await import('../../web/js/help.js');
  const t0 = HELP_TOPICS[0], word = t0.title.split(' ').find(w => w.length > 4);
  const ids = (q) => search(q).map(t => t.id);
  assert.equal(search('  '), null);
  assert.equal(ids(word.toUpperCase())[0], t0.id);                                                           // a title match ranks first
  assert.deepEqual(ids(word.replace(/[aeiou]/g, c => ({ a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' }[c]))), ids(word));   // "maori" finds "Māori" and the reverse
  assert.deepEqual(ids('màōrí'), ids('maori'));
  assert.deepEqual(ids(`${word} zzqxv`), []);                                                                // every word must appear
  const sw = t0.summary.split(' ').find(w => /^[a-z]{5,}$/i.test(w));
  assert.match(snippet(search(sw).find(t => t.id === t0.id), [sw.toLowerCase()]), new RegExp(`<mark>${sw}</mark>`, 'i'));
});

test('picture tone: darker, no clipping, and only pure black stays pure black (FARGO resin K panel)', async () => {
  const { toneLut, tonePixels } = await import('../../web/js/render.js');
  const lut = toneLut(50, 50);
  assert.equal(lut[0], 0); assert.ok([...lut].slice(1).every(v => v >= 1));                 // dark shadows never turn pure black
  assert.ok([...lut].every((v, i) => i === 0 || v >= lut[i - 1]));                           // no tones swap places
  assert.ok(toneLut(30, 0)[200] < 200 && toneLut(-30, 0)[200] > 200);                        // darker and lighter
  assert.ok(toneLut(0, 50)[255] === 255 && toneLut(0, 50)[40] > 0);                          // contrast doesn't clip
  const px = tonePixels(new Uint8ClampedArray([200, 120, 60, 255, 0, 0, 0, 255]), 0, 0, 30);
  assert.ok(px[0] - px[2] > 140 && px[3] === 255 && px[4] + px[5] + px[6] === 0);           // stronger colour, black stays black
});

test('the photo size a template expects: pixels, mm and a usual shape', async () => {
  const { photoSpec } = await import('../../web/js/render.js');
  const card = { w: 638, h: 1013, mmW: 53.98, mmH: 85.6 };
  const d = (w, h, side = 'front') => ({ card, elements: [{ field: 'firstName', side: 'front', w: 500, h: 80 }, { field: 'photo', side, x: 0, y: 0, w, h }] });
  assert.deepEqual(photoSpec(d(360, 480)), { w: 360, h: 480, mmW: 30.5, mmH: 40.6, shape: '3:4', orientation: 'portrait' });
  assert.equal(photoSpec(d(400, 300)).shape, '4:3');
  assert.equal(photoSpec(d(300, 300)).orientation, 'square');
  assert.equal(photoSpec(d(357, 431)).shape, null);   // no usual shape: just the size
  assert.equal(photoSpec(d(360, 480, 'back')), null);   // only the front's photo is a person's ID photo
});

test('the photo size works for older templates whose card has no mm sizes', async () => {
  const { photoSpec } = await import('../../web/js/render.js');
  const s = photoSpec({ card: { w: 638, h: 1013 }, elements: [{ field: 'photo', side: 'front', w: 360, h: 480 }] });
  assert.deepEqual([s.mmW, s.mmH, s.shape], [30.5, 40.6, '3:4']);
});
