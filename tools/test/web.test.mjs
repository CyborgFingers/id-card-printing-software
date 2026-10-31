// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Unit tests for the screens' own logic (CSV import, card dates):   node --test tools/test/
// The service's logic is tested in C#: dotnet test desktop/tests/IdCard.Tests
import test from 'node:test';
import assert from 'node:assert/strict';

const { readPeople, isoDate, parseCSV, buildPhotoIndex, matchPhoto, photosByName, nameKey, planUpdate } = await import('../../web/js/csv.js');
const { formatDate, layoutText, photoGeometry, photoFormat, PHOTO_ACCEPT, FACE, photoIssues } = await import('../../web/js/render.js');

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

test('ID photos match by file name, path or missing extension', () => {
  const files = ['mere.jpg', 'sam-lee.png', 'aroha.jpg', 'ben_smith.jpg'].map(name => ({ name }));
  const idx = buildPhotoIndex(files);
  const m = (photoFile) => matchPhoto(idx, { photoFile, firstName: 'Ben', lastName: 'Smith' })?.name || null;
  assert.equal(m('mere.jpg'), 'mere.jpg');
  assert.equal(m('C:\\Photos\\SAM-LEE.PNG'), 'sam-lee.png');
  assert.equal(m('aroha'), 'aroha.jpg');
  assert.equal(m('missing.jpg'), null);   // a named file that isn't there never falls back to a name match
  assert.equal(m(''), null);              // no file named: photosByName matches by name
});

// photosByName: each person's photo name, or the problem ('several' or 'shared').
const named = (names, people) => { const r = photosByName(names.map(name => ({ name })), people); return (p) => { const m = r.get(p); return m.problem || m.file?.name || null; }; };

test('ID photos match the person\'s full name in any case, with or without spaces', () => {
  const john = { firstName: 'John', lastName: 'Smith', photoFile: '' };
  for (const name of ['John Smith.jpg', 'JOHN SMITH.JPG', 'john smith.png', 'johnsmith.jpg', 'JOHNSMITH.jpeg', 'JohnSmith.webp', 'john_smith.jpg', 'Smith, John.jpg'])
    assert.equal(named([name], [john])(john), name, name);
  const mere = { firstName: 'Mere', lastName: 'Tūhoe' }, dow = { firstName: 'Jane', lastName: 'Dow' }, none = { firstName: '', lastName: '' };
  const m = named(['Mere Tuhoe.jpg', '7.jpg', 'Jane Doe.png', 'jo.jpg'], [mere, dow, none]);
  assert.equal(m(mere), 'Mere Tuhoe.jpg');   // macrons don't matter
  assert.equal(m(dow), null);                // a different name never matches
  assert.equal(m(none), null);
  assert.equal(nameKey('  Ana-María  O\'Neil '), 'anamariaoneil');
});

test('ID photos match a first and last name next to each other among other words', () => {
  const jane = { firstName: 'Jane', lastName: 'Doe' }, mary = { firstName: 'Mary Jane', lastName: 'Doe' }, john = { firstName: 'John', lastName: 'Smith' };
  for (const name of ['Jane Doe ID Photo Good.jpg', 'ID photo - DOE Jane (2026).heic', 'jane_doe_final.png', 'JaneDoe ID.jpg', '0042 Jane Doe.tif'])
    assert.equal(named([name], [jane])(jane), name, name);
  for (const name of ['Jane Mary Doe.jpg', 'Janet Doe.jpg', 'Jane Doer ID.jpg', 'Jane ID Doe.jpg'])   // not next to each other, or not whole words
    assert.equal(named([name], [jane])(jane), null, name);
  assert.equal(named(['Jane Doe ID Good.jpg', 'Jane Doe.jpg'], [jane])(jane), 'Jane Doe.jpg');      // a photo named just the name wins, as before
  assert.equal(named(['Jane Doe Good.jpg', 'Jane Doe Bad.jpg'], [jane])(jane), 'several');          // which one? neither is used
  const m = named(['Mary Jane Doe.jpg'], [jane, mary]);                                             // someone else's whole name
  assert.equal(m(mary), 'Mary Jane Doe.jpg'); assert.equal(m(jane), null);
  const both = named(['Jane Doe and John Smith.jpg'], [jane, john]);                                // two names in one photo name
  assert.equal(both(jane), 'shared'); assert.equal(both(john), 'shared');
  const sam = { firstName: 'Sam', lastName: 'Lee' }, sam2 = { ...sam };
  assert.equal(named(['Sam Lee ID.jpg'], [sam, sam2])(sam2), 'shared');                             // two people with the same name
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

test('Line up faces: everyone\'s eyes the same distance apart and in the same place, whatever their photo', () => {
  const box = { x: 0, y: 0, w: 360, h: 480, fit: 'cover' }, near = (a, b) => Math.abs(a - b) < 0.5, apart = FACE.apart * 480, eyeY = FACE.eyes * 480;
  const eyes = (img, face, adj = {}) => { const g = photoGeometry(img, box, { ...adj, face }, true); return { apart: face.d * g.dw, x: g.dx + face.x * g.dw, y: g.dy + face.y * g.dh, g }; };
  const gaps = (g) => [g.dx - box.x, box.x + box.w - (g.dx + g.dw), g.dy - box.y, box.y + box.h - (g.dy + g.dh)];   // uncovered: left, right, top, bottom
  const allowed = (g) => gaps(g).every((v, i) => v <= FACE.slack * (i < 2 ? box.w : box.h) + 0.5);
  const close = eyes({ naturalWidth: 1200, naturalHeight: 1600 }, { x: 0.5, y: 0.45, d: 0.2 });
  const far = eyes({ naturalWidth: 1600, naturalHeight: 1200 }, { x: 0.4, y: 0.35, d: 0.06 });   // further away, off to one side
  const closer = eyes({ naturalWidth: 1200, naturalHeight: 1600 }, { x: 0.5, y: 0.45, d: 0.3 });   // close enough to leave gaps
  const corner = eyes({ naturalWidth: 900, naturalHeight: 1200 }, { x: 0.15, y: 0.2, d: 0.2 });   // face near the top left corner
  for (const e of [close, far]) assert.ok(near(e.apart, apart) && near(e.x, 180) && near(e.y, eyeY), JSON.stringify(e));   // room around the face: exact
  for (const e of [closer, corner]) assert.ok(near(e.x, 180) && near(e.y, eyeY) && e.apart > apart && e.apart <= apart * FACE.grow + 0.5, JSON.stringify(e));   // tight: in place, a little bigger
  assert.ok(gaps(closer.g).every(v => v <= 0.5), 'growing the face a little covers the frame');
  assert.ok(allowed(corner.g) && gaps(corner.g).some(v => v > 0), `when growing isn't enough, small gaps (filled from the photo's edges): ${gaps(corner.g).map(Math.round)}`);
  const closest = eyes({ naturalWidth: 1200, naturalHeight: 1600 }, { x: 0.5, y: 0.45, d: 0.6 });   // an extreme close-up
  assert.ok(closest.apart > apart * FACE.grow && allowed(closest.g), 'stops at the most it may leave uncovered');
  const img = { naturalWidth: 1600, naturalHeight: 1200 };
  assert.deepEqual(photoGeometry(img, box, {}, true), photoGeometry(img, box, {}, false));   // no face found: as the template says
  assert.deepEqual(photoGeometry(img, box, { face: { x: 0.4, y: 0.35, d: 0.06 } }, false), photoGeometry(img, box, {}, false));   // Line up faces off: a saved face changes nothing
  const edge = eyes(img, { x: 0.01, y: 0.5, d: 0.05 }).g;
  assert.ok(allowed(edge), 'a face at the very edge of the photo leaves at most the allowed gap');
  const zoomed = eyes(img, { x: 0.4, y: 0.35, d: 0.06 }, { zoom: 1.2 });   // the person's own zoom still works on top
  assert.ok(near(zoomed.apart, apart * 1.2) && near(zoomed.x, 180));
});

test('photo problems a person is reported for: each one found, and none for a good photo', () => {
  const frame = { field: 'photo', side: 'front', x: 0, y: 0, w: 360, h: 480, fit: 'cover' }, face = frame;
  const tpl = (e) => ({ elements: [e] }), good = { x: 0.5, y: 0.4, d: 0.12 }, size = { w: 1200, h: 1600 }, on = (p, t) => photoIssues(p, t, true);
  const person = (adj, hasPhoto = true) => ({ hasPhoto, adj: { zoom: 1, ox: 0, oy: 0, ...adj } });
  assert.deepEqual(on(person({ face: good, photo: { ...size, poor: false } }), tpl(face)), []);
  assert.deepEqual(on(person({}, false), tpl(face)), ['noPhoto']);
  assert.deepEqual(on(person({ face: null, photo: size }), tpl(face)), ['noFace']);
  assert.deepEqual(photoIssues(person({ face: null, photo: size }), tpl(frame), false), []);   // no face only matters while lining up faces
  assert.deepEqual(on(person({ face: { ...good, turned: true }, photo: size }), tpl(face)), ['turned']);
  assert.deepEqual(on(person({ face: { x: 0.5, y: 0.45, d: 0.6 }, photo: size }), tpl(face)), ['close']);   // an extreme close-up
  assert.deepEqual(on(person({ face: good, photo: { w: 150, h: 200 } }), tpl(face)), ['small']);           // shown well past its pixels
  assert.deepEqual(photoIssues(person({ photo: { w: 150, h: 200 } }), tpl(frame), false), ['small']);
  assert.deepEqual(on(person({ face: good, photo: { ...size, poor: true } }), tpl(face)), ['poor']);
  assert.deepEqual(on(person({ face: good }), tpl(face)), []);   // saved before these were checked: not counted
  assert.deepEqual(on(person({ photo: { ...size, poor: true } }), null), ['poor']);   // no template: only what's about the photo itself
});

test('a face is turned away when its eyes look much closer together than front on', async () => {
  const { faceFromPoints } = await import('../../web/js/face.js');
  const pts = (eyeGap, noseX = 500) => [{ x: 500 - eyeGap / 2, y: 400 }, { x: 500 + eyeGap / 2, y: 400 }, { x: noseX, y: 460 }, { x: 500, y: 520 }];   // eyes, nose, mouth (120 px below the eyes)
  const front = faceFromPoints(pts(108), 1000, 1000), side = faceFromPoints(pts(40), 1000, 1000);
  assert.ok(!front.turned && side.turned);
  assert.ok(!faceFromPoints(pts(108, 530), 1000, 1000).turned && faceFromPoints(pts(108, 580), 1000, 1000).turned, 'the nose well off to one side');
  assert.ok(Math.abs(front.d - 0.108) < 0.001 && Math.abs(side.d - 0.108) < 0.001, 'the same size either way: it comes from the eyes to the mouth');
  assert.deepEqual([front.x, front.y], [0.5, 0.4]);
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

test('enhance: a flat photo is stretched, colours and skin tones kept; a good one hardly changes', async () => {
  const { enhancePixels } = await import('../../web/js/enhance.js');
  const w = 40, h = 40, make = (f) => { const px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...f(i % w, Math.floor(i / w)), 255], i * 4); return px; };
  const face = (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30, at = (px, x, y) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  const dull = make((x, y) => { const v = 40 + Math.round(1.4 * (x + y)); return [v + 20, v + 10, v - 30]; });   // 10 to 169
  const out = enhancePixels(dull.slice(), w, h);
  assert.ok(Math.max(...out.filter((_, i) => i % 4 === 0)) > 240 && Math.min(...out.filter((_, i) => i % 4 === 2)) < 20);   // full range
  assert.ok(out.every((v, i) => i % 4 !== 3 || v === 255));                                                               // see-through parts kept
  const darker = make((x, y) => !face(x, y) ? [230, 230, 230] : y < 15 ? [20, 18, 15] : [95, 75, 60]);                    // a white wall, dark hair, darker skin
  const kept2 = enhancePixels(darker.slice(), w, h);
  assert.ok(Math.abs(at(kept2, 20, 25)[1] - 75) < 15, `face ${at(kept2, 20, 25)}`);                                         // not lightened to a set brightness
  const blue = make((x, y) => !face(x, y) ? [199, 210, 230] : y < 15 ? [30, 25, 20] : [181, 140, 112]), kept = enhancePixels(blue.slice(), w, h);
  const [fr, fg, fb] = at(kept, 20, 25), wall = at(kept, 2, 2);
  assert.ok(wall[2] > wall[0] + 15 && Math.abs(fr / fg - 181 / 140) < 0.1 && fb >= 100, `wall ${wall}, face ${[fr, fg, fb]}`);   // a blue backdrop stays blue, the face doesn't go orange
  const good = make((x, y) => { const v = Math.round((x + y) * 255 / 78); return [v, v, v]; });                          // black to white
  const same = enhancePixels(good.slice(), w, h);
  assert.ok(same.reduce((s, v, i) => s + Math.abs(v - good[i]), 0) / same.length < 4);
  const black = make((x) => x < 20 ? [0, 0, 0] : [3, 3, 3]), dark = enhancePixels(black.slice(), w, h);
  assert.equal(dark[0], 0); assert.ok(dark.every((v, i) => i % 4 === 3 || i % (w * 4) < 80 || v >= 1));                 // only pure black stays pure black (FARGO resin K panel)
});

test('enhance: grain is smoothed but edges stay sharp; detail in shadow is brought out but a plain wall stays plain', async () => {
  const { enhancePixels } = await import('../../web/js/enhance.js');
  const w = 64, h = 64, make = (f) => { const px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...f(i % w, Math.floor(i / w)), 255], i * 4); return px; };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const stats = (px, x0, x1, y0 = 4, y1 = 60) => { const v = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(px[(y * w + x) * 4 + 1]); const m = v.reduce((a, b) => a + b) / v.length; return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }; };
  // Grain: a dark and a light half, each with noise.
  const grainy = make((x) => { const v = (x < 32 ? 60 : 190) + (rnd() - 0.5) * 34; return [v, v, v]; }), smooth = enhancePixels(grainy.slice(), w, h);
  const snr = (px) => { const a = stats(px, 4, 26), b = stats(px, 38, 60); return (b.m - a.m) / ((a.sd + b.sd) / 2); };
  assert.ok(snr(smooth) > snr(grainy) * 1.5, `signal to noise ${snr(grainy).toFixed(1)} → ${snr(smooth).toFixed(1)}`);
  const step = stats(smooth, 38, 60).m - stats(smooth, 4, 26).m;
  assert.ok(stats(smooth, 34, 35).m - stats(smooth, 29, 30).m > step * 0.8, 'the edge stays sharp');
  // Shadow: detail (columns of 16 to 48) beside a light area and a plain wall, with black and white already in it.
  const shade = Array.from({ length: w }, () => 16 + Math.round(rnd() * 32));
  const scene = make((x, y) => { const v = x < 5 && y < 5 ? 0 : x > 58 && y > 58 ? 255 : x < 32 ? shade[x] : y < 32 ? 200 : 128; return [v, v, v]; });
  const lifted = enhancePixels(scene.slice(), w, h);
  assert.ok(stats(lifted, 6, 26, 8, 56).sd > stats(scene, 6, 26, 8, 56).sd * 1.4, `shadow detail ${stats(scene, 6, 26, 8, 56).sd.toFixed(1)} → ${stats(lifted, 6, 26, 8, 56).sd.toFixed(1)}`);
  assert.ok(stats(lifted, 40, 56, 40, 56).sd < 1, 'a plain wall stays plain');
});

test('photo check: only flat or grainy photos are off (not a darker face, and never by file size)', async () => {
  const { photoCheck } = await import('../../web/js/enhance.js');
  const w = 64, h = 64, make = (f) => { const px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...f(i % w, Math.floor(i / w)), 255], i * 4); return px; };
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const face = (x, y) => x > 16 && x < 48 && y > 12 && y < 52;
  const portrait = (wall, skin, hair) => (x, y) => !face(x, y) ? wall : y < 22 ? hair : skin;
  const good = make(portrait([235, 235, 235], [190, 150, 120], [25, 20, 15])), off = (px) => photoCheck(px, w, h).off;
  assert.equal(off(good), false);
  assert.equal(off(make(portrait([120, 118, 110], [90, 72, 60], [40, 35, 30]))), true);                             // dull or dark all over
  assert.equal(off(make((x, y) => portrait([235, 235, 235], [190, 150, 120], [25, 20, 15])(x, y).map(v => v + (rnd() - 0.5) * 30))), true);   // grainy
  assert.equal(off(make(portrait([235, 235, 235], [95, 70, 55], [20, 16, 12]))), false);                            // darker skin is not "off"
  const poor = (px) => photoCheck(px, w, h).poor;   // clearly poor, worth telling someone: more than just off
  assert.equal(poor(good), false); assert.equal(poor(make(portrait([140, 138, 130], [110, 92, 80], [70, 65, 60]))), true);
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

test('photo formats: read by file name, and offered to the file picker', () => {
  const f = (name) => photoFormat({ name });
  assert.equal(f('John Smith.HEIC'), 'heic'); assert.equal(f('a.heif'), 'heic'); assert.equal(f('scan.TIF'), 'tiff');
  assert.equal(f('x.jfif'), 'jpg'); assert.equal(f('x.jpeg'), 'jpg'); assert.equal(f('x.avif'), 'avif');
  assert.equal(f('notes.txt'), null); assert.equal(f('heic'), null); assert.equal(f('Thumbs.db'), null);
  assert.ok(PHOTO_ACCEPT.startsWith('image/*,') && PHOTO_ACCEPT.includes('.heic') && PHOTO_ACCEPT.includes('.tiff'));
});

test('bulk update: rows and photos change the people already there, by name, and never add anyone', () => {
  const people = [
    { id: 1, firstName: 'Jane', lastName: 'Doe', position: 'Driver', extra: {} },
    { id: 2, firstName: 'John', lastName: 'Smith', position: '', extra: { cf_dep: 'Ops' } },
    { id: 3, firstName: 'Sam', lastName: 'Lee', extra: {} }, { id: 4, firstName: 'Sam', lastName: 'Lee', extra: {} },
    { id: 5, firstName: 'Mere', lastName: 'Tūhoe', extra: {} },
  ];
  const value = (p, k) => k.startsWith('cf_') ? p.extra[k] : p[k];
  const fields = ['staffId', 'position', 'cf_dep'];
  const files = ['jane doe.heic', 'SAM_LEE.jpg', 'Mere Tuhoe ID photo.tif', 'Nobody Here.png'].map(name => ({ name }));
  const rows = [
    { firstName: 'JANE', lastName: 'doe', position: 'Supervisor', staffId: '', cf_dep: '' },   // blank cells stay as they are
    { firstName: 'John', lastName: 'Smith', position: '', staffId: '', cf_dep: 'Ops' },        // nothing different
    { firstName: 'Ana', lastName: 'Ngata', position: 'Clerk' },                                  // not in this client
  ];
  const { entries, unusedFiles } = planUpdate(people, rows, files, fields, value);
  const by = (id) => entries.filter(e => e.person?.id === id);
  assert.deepEqual(by(1)[0].changes, { position: 'Supervisor' }); assert.equal(by(1)[0].file.name, 'jane doe.heic'); assert.equal(by(1)[0].problem, null);
  assert.equal(by(2)[0].problem, 'noChange');
  assert.deepEqual(by(3).concat(by(4)).map(e => e.problem), ['sameName', 'sameName']);   // two Sam Lees: whose photo is it?
  assert.equal(by(5)[0].file.name, 'Mere Tuhoe ID photo.tif');
  assert.equal(entries.find(e => !e.person).problem, 'notFound');
  assert.deepEqual(unusedFiles.map(f => f.name), ['Nobody Here.png']);
  // Photos only, no CSV: the same matches.
  const photos = planUpdate(people, [], files, fields, value);
  assert.deepEqual(photos.entries.filter(e => !e.problem).map(e => e.person.id), [1, 5]);
  // The same person twice in the CSV: neither row is used.
  const twice = planUpdate(people, [rows[0], { ...rows[0], position: 'Manager' }], [], fields, value);
  assert.deepEqual(twice.entries.map(e => e.problem), ['twice', 'twice']);
  // Two photos for one person: the CSV's changes still apply, the photo is left as it is.
  const two = planUpdate(people, [rows[0]], ['Jane Doe Good.jpg', 'Jane Doe Bad.jpg', 'Mere Tuhoe new.jpg', 'Mere Tuhoe old.jpg'].map(name => ({ name })), fields, value);
  const [jane, mere] = [1, 5].map(id => two.entries.find(e => e.person?.id === id));
  assert.equal(jane.problem, null); assert.equal(jane.file, null); assert.equal(jane.photoProblem, 'several'); assert.deepEqual(jane.changes, { position: 'Supervisor' });
  assert.equal(mere.problem, 'several'); assert.deepEqual(mere.files.map(f => f.name), ['Mere Tuhoe new.jpg', 'Mere Tuhoe old.jpg']);
  assert.deepEqual(two.unusedFiles, []);   // shown against the person, not as matching nobody
});

test('the vendored pica shrinks a photo, keeping its colours where they are', async () => {
  const { createRequire } = await import('node:module');
  const pica = createRequire(import.meta.url)(new URL('../../web/js/vendor/pica/pica.min.js', import.meta.url).pathname)({ features: ['js'] });
  const w = 400, h = 200, src = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) src.set(i % w < w / 2 ? [200, 30, 30, 255] : [30, 30, 200, 255], i * 4);   // red, then blue
  const out = await pica.resizeBuffer({ src, width: w, height: h, toWidth: 100, toHeight: 50 }), at = (x, y) => [...out.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
  assert.equal(out.length, 100 * 50 * 4);
  assert.deepEqual(at(10, 25), [200, 30, 30]); assert.deepEqual(at(90, 25), [30, 30, 200]);
});

test('the vendored readers open HEIC and TIFF files', async () => {
  const { createRequire } = await import('node:module'), fs = await import('node:fs'), vm = await import('node:vm');
  const dir = new URL('../../web/js/vendor/', import.meta.url), fx = (n) => fs.readFileSync(new URL(`fixtures/${n}`, import.meta.url));
  const orange = (px) => Math.abs(px[0] - 200) < 12 && Math.abs(px[1] - 120) < 12 && Math.abs(px[2] - 61) < 12;
  const lib = createRequire(import.meta.url)(new URL('libheif/libheif.js', dir).pathname)({ locateFile: (f) => new URL(`libheif/${f}`, dir).pathname });
  const im = new lib.HeifDecoder().decode(fx('photo.heic'))[0], data = { data: new Uint8ClampedArray(48 * 32 * 4), width: 48, height: 32 };
  assert.deepEqual([im.get_width(), im.get_height()], [48, 32]);
  await new Promise((ok, no) => im.display(data, d => d ? ok() : no(new Error('display failed'))));
  assert.ok(orange(data.data), `HEIC pixel ${data.data.slice(0, 3)}`);
  const ctx = vm.createContext({ Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, Math, String, Array, Error, console });
  ctx.self = ctx;
  for (const f of ['pako_inflate.min.js', 'UTIF.js']) vm.runInContext(fs.readFileSync(new URL(`utif/${f}`, dir), 'utf8'), ctx);
  const b = fx('photo.tif'), buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length), page = ctx.UTIF.decode(buf)[0];
  ctx.UTIF.decodeImage(buf, page);
  assert.deepEqual([page.width, page.height], [48, 32]);
  assert.ok(orange(ctx.UTIF.toRGBA8(page)));
});
