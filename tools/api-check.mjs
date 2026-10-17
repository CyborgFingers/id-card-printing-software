// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// API checks for person fields, card status, people export, user roles and automatic backups,
// against a running development service (simulator). Run tools/smoke.mjs first (it sets the dev password).
//   node tools/api-check.mjs        (SMOKE_URL=http://localhost:<port> for another port)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const B = process.env.SMOKE_URL || 'http://localhost:5180';
const PASS = process.env.SMOKE_PASS || 'smoke-test-password';
function session() {
  let cookie = '';
  const raw = async (method, url, body) => {
    const r = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r;
  };
  const call = async (method, url, body) => {
    const r = await raw(method, url, body); const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`${method} ${url} -> ${r.status} ${j.error || ''}`); e.status = r.status; throw e; }
    return j;
  };
  return { raw, call };
}
const step = (s) => console.log('  ✓', s);
const refused = (p, status) => assert.rejects(p, e => e.status === status);

(async () => {
  const admin = session(); await admin.call('POST', '/api/auth/login', { username: 'admin', password: PASS });
  const hadExpiry = (await admin.call('GET', '/api/state')).config.customFields.find(f => f.expiry);   // put back at the end

  // Person fields: a date (card expiry) and an auto-numbered card number
  const exp = await admin.call('POST', '/api/fields', { label: `Expiry ${Date.now()}`, type: 'date', expiry: true });
  const num = await admin.call('POST', '/api/fields', { label: `Card no ${Date.now()}`, type: 'auto', prefix: 'C', digits: 5, next: 41 });
  await refused(admin.call('POST', '/api/fields', { label: 'Position' }), 400);
  step('person fields added; built-in names refused');

  const tpl = (await admin.call('GET', '/api/state')).designs[0] || await admin.call('POST', '/api/designs', { name: 'API check card' });
  const c = await admin.call('POST', '/api/clients', { name: `API check ${Date.now()}`, templateId: tpl.id, copyTemplate: true });
  const p1 = await admin.call('POST', `/api/clients/${c.id}/people`, { firstName: 'Ana', lastName: '=Tūhoe', extra: { [exp.key]: '2027-03-31' } });
  const p2 = await admin.call('POST', `/api/clients/${c.id}/people`, { firstName: 'Ben', lastName: 'Ngata', extra: { [num.key]: 'TYPED-1' } });
  assert.equal(p1.extra[exp.key], '2027-03-31');
  assert.equal(p1.extra[num.key], 'C00041'); assert.equal(p2.extra[num.key], 'TYPED-1');
  await refused(admin.call('POST', `/api/clients/${c.id}/people`, { firstName: 'Bad', extra: { [exp.key]: '31/03/2027' } }), 400);
  const p3 = await admin.call('POST', `/api/clients/${c.id}/people`, { firstName: 'Cam' });
  assert.equal(p3.extra[num.key], 'C00042');
  step('custom values saved, card numbers assigned in order, bad dates refused');

  // The expiry flag moves to the field just ticked, even an earlier one; existing people get numbers when edited
  const start = await admin.call('POST', '/api/fields', { label: `Start ${Date.now()}`, type: 'date' });
  await admin.call('PUT', `/api/fields/${start.key}`, { label: start.label, expiry: true });
  let defs = (await admin.call('GET', '/api/state')).config.customFields;
  assert.equal(defs.find(f => f.key === start.key).expiry, true); assert.equal(defs.find(f => f.key === exp.key).expiry, false);
  await admin.call('PUT', `/api/fields/${exp.key}`, { label: exp.label, expiry: true });
  const num2 = await admin.call('POST', '/api/fields', { label: `Badge ${Date.now()}`, type: 'auto', digits: 3, next: 7 });
  const edited = await admin.call('PUT', `/api/people/${p2.id}`, { firstName: 'Ben' });
  assert.equal(edited.extra[num2.key], '007'); assert.equal(edited.extra[num.key], 'TYPED-1');
  await admin.call('DELETE', `/api/fields/${start.key}`); await admin.call('DELETE', `/api/fields/${num2.key}`);
  step('expiry flag follows the field just edited; editing a person fills a new card number');

  // Card status and the person's card log
  const lost = await admin.call('POST', `/api/people/${p1.id}/status`, { status: 'lost', note: 'Left on the bus' });
  assert.equal(lost.cardStatus, 'lost');
  await refused(admin.call('POST', `/api/people/${p1.id}/status`, { status: 'constructor' }), 400);
  const log1 = await admin.call('GET', `/api/people/${p1.id}/history`);
  assert.equal(log1[0].status, 'lost'); assert.equal(log1[0].note, 'Left on the bus');
  step('card marked lost and logged');

  // People export: custom columns, formulas neutralised, macrons kept
  const csv = await (await admin.raw('GET', `/api/clients/${c.id}/people.csv`)).text();
  assert.ok(csv.includes(exp.label) && csv.includes('C00041') && csv.includes("'=Tūhoe") && csv.includes('Lost or stolen'), csv);
  step('people CSV export');

  // Templates: landscape card with an image, a box, a barcode and rotated text
  const st = await admin.call('GET', '/api/state');
  const d = st.designs.find(x => x.id === c.defaultDesignId);
  const saved = await admin.call('PUT', `/api/designs/${d.id}`, { ...d, card: { w: 1013, h: 638 }, elements: [
    { id: 'eimg', field: 'image', side: 'front', x: 10, y: 10, w: 200, h: 100, asset: null, fit: 'cover' },
    { id: 'ebox', field: 'box', side: 'front', x: 0, y: 560, w: 1013, h: 78, fill: '#123456', radius: 4 },
    { id: 'ebar', field: 'barcode', side: 'front', x: 700, y: 300, w: 250, h: 250, symbol: 'qrcode', source: num.key },
    { id: 'etxt', field: 'lastName', side: 'front', x: 20, y: 200, w: 80, h: 300, rotate: 270, size: 40 },
    { id: 'edat', field: exp.key, side: 'front', x: 300, y: 300, w: 300, h: 50, dateFormat: 'MMM YYYY' },
    { id: 'x"onclick=alert(1)', field: 'text', side: 'front', x: 0, y: 0, w: 50, h: 50, text: 'X' },
  ] });
  assert.deepEqual(saved.card, { w: 1013, h: 638, size: 'CR80', mmW: 85.6, mmH: 53.98 });
  assert.equal(saved.elements.length, 6);
  assert.ok(saved.elements.every(e => /^\w+$/.test(e.id)));
  assert.equal(saved.elements.find(e => e.field === 'barcode').source, num.key);
  assert.equal(saved.elements.find(e => e.field === 'lastName').rotate, 270);
  assert.equal(saved.elements.find(e => e.field === exp.key).dateFormat, 'MMM YYYY');
  step('landscape template with image, box, barcode, rotated text and date format');

  // Card sizes: CR100 portrait, a custom size (limited to 20-150 mm), unknown sizes fall back to CR80
  const cr100 = await admin.call('PUT', `/api/designs/${d.id}`, { ...saved, card: { w: 1, h: 2, size: 'CR100' } });
  assert.deepEqual(cr100.card, { w: 791, h: 1163, size: 'CR100', mmW: 67, mmH: 98.5 });
  const custom = await admin.call('PUT', `/api/designs/${d.id}`, { ...saved, card: { w: 2, h: 1, size: 'custom', mmW: 60, mmH: 400 } });
  assert.deepEqual(custom.card, { w: 1772, h: 709, size: 'custom', mmW: 150, mmH: 60 });
  const odd = await admin.call('PUT', `/api/designs/${d.id}`, { ...saved, card: { w: 1, h: 2, size: 'A4' } });
  assert.deepEqual(odd.card, { w: 638, h: 1013, size: 'CR80', mmW: 53.98, mmH: 85.6 });
  await admin.call('PUT', `/api/designs/${d.id}`, saved);
  step('card sizes: CR100, custom (limited) and unknown');

  // Users and roles
  const name = `op${Date.now() % 1e6}`;
  const op = await admin.call('POST', '/api/users', { username: name, password: 'temp-pass-1', role: 'operator' });
  assert.equal(op.mustChangePassword, true);
  const o = session(); await o.call('POST', '/api/auth/login', { username: name, password: 'temp-pass-1' });
  await refused(o.call('GET', '/api/state'), 403);                         // must choose own password first
  await o.call('PUT', '/api/auth/account', { newPassword: 'operator-pass-1' });
  await o.call('GET', '/api/state');
  await o.call('POST', `/api/clients/${c.id}/people`, { firstName: 'Op', lastName: 'Added' });
  await refused(o.call('PUT', '/api/config', { sound: false }), 403);
  await refused(o.call('PUT', `/api/designs/${d.id}`, saved), 403);
  await refused(o.call('GET', '/api/users'), 403);
  await refused(o.call('GET', '/api/logs?kind=service'), 403);
  await o.call('GET', '/api/logs?kind=printer');
  step('operator: adds people, cannot change settings, templates, users or read the service log');
  await refused(admin.call('PUT', '/api/users/1', { role: 'operator' }), 400);   // last administrator
  await admin.call('PUT', `/api/users/${op.id}`, { password: 'reset-pass-1' });
  await refused(o.call('GET', '/api/clients'), 401);                     // reset signs them out
  await admin.call('DELETE', `/api/users/${op.id}`);
  step('reset signs the user out; last admin protected; user deleted');

  // Automatic backups to a folder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idcard-autobackup-'));
  await refused(admin.call('PUT', '/api/autobackup', { enabled: true, folder: 'relative/path', password: 'backup-pass-1' }), 400);
  await admin.call('PUT', '/api/autobackup', { enabled: true, folder: dir, every: 'daily', keep: 2, password: 'backup-pass-1' });
  for (let i = 0; i < 3; i++) { const r = await admin.call('POST', '/api/autobackup/run'); assert.equal(r.ok, true, r.error); await new Promise(r => setTimeout(r, 1100)); }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.idcbak'));
  assert.equal(files.length, 2, files.join());   // keep: 2
  assert.ok(!fs.readFileSync(path.join(dir, files[0])).includes(Buffer.from('Ngata')), 'backup must be encrypted');
  const ab = await admin.call('GET', '/api/autobackup');
  assert.equal(ab.hasPassword, true); assert.equal(ab.password, undefined);
  await admin.call('PUT', '/api/autobackup', { enabled: false, folder: dir, every: 'daily', keep: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
  step('automatic backups: encrypted files written, old ones pruned, password never sent back');

  await admin.call('DELETE', `/api/fields/${exp.key}`); await admin.call('DELETE', `/api/fields/${num.key}`);
  if (hadExpiry) await admin.call('PUT', `/api/fields/${hadExpiry.key}`, { label: hadExpiry.label, expiry: true });
  console.log('\nAPI check passed.');
})().catch(e => { console.error('\nAPI check FAILED:', e.message); process.exit(1); });
