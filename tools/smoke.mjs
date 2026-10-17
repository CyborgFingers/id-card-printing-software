// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Quick end-to-end check against a running dev service (simulator mode):
//   dotnet desktop/src/IdCard.DevHost/bin/Debug/net10.0/IdCard.DevHost.dll   (in one terminal, see CLAUDE.md)
//   node tools/smoke.mjs                                                    (in another)
// Signs in (on a fresh dev database: with admin / admin, checks the API stays locked until the
// default password is changed, then sets SMOKE_PASS), accepts the licence, creates a client and
// a person, prints one card through the simulator and checks it reaches the print history.
const B = process.env.SMOKE_URL || 'http://localhost:5180';
const USER = process.env.SMOKE_USER || 'admin';
const PASS = process.env.SMOKE_PASS || 'smoke-test-password';
let cookie = '';
async function call(method, url, body) {
  const r = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${j.error || ''}`);
  return j;
}
const step = (s) => console.log('  ✓', s);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const login = (password) => call('POST', '/api/auth/login', { username: USER, password });
  if (!(await login(PASS).catch(() => null))) {
    const me = await login('admin');
    if (!me.user.isDefaultPassword) throw new Error('Sign-in failed with SMOKE_PASS and with the default password');
    await call('GET', '/api/state').then(() => { throw new Error('API usable before the default password was changed'); }, e => { if (!/ 403 /.test(e.message)) throw e; });
    await call('PUT', '/api/auth/account', { newPassword: PASS }); step('default password changed');
    const fresh = await call('GET', '/api/state');   // a new install starts blank
    if (fresh.designs.length || fresh.clients.length) throw new Error(`A new install should be empty, but has ${fresh.designs.length} template(s) and ${fresh.clients.length} client(s)`);
    step('new install is blank: no templates, no clients');
  }
  step('signed in');
  await call('POST', '/api/license/accept'); step('licence accepted');
  await call('PUT', '/api/config', { simulate: true, simSeconds: 2 }); step('simulator on');
  const name = `Smoke test ${Date.now()}`;
  // A new install has no templates: make one if needed.
  const tpl = (await call('GET', '/api/state')).designs[0] || await call('POST', '/api/designs', { name: 'Smoke test card' });
  const c = await call('POST', '/api/clients', { name, templateId: tpl.id, copyTemplate: true }); step(`client created: ${c.name}`);
  const p = await call('POST', `/api/clients/${c.id}/people`, { firstName: 'Smoke', lastName: 'Test', staffId: 'S-1' }); step('person added');
  const st = await call('GET', '/api/state');
  const d = st.designs.find(x => x.id === c.defaultDesignId);
  const b = await call('POST', '/api/queue/batches', { name: 'Smoke batch', clientId: c.id, designId: d.id, designName: d.name, hasBack: false, sides: 'front' });
  await call('POST', `/api/queue/batches/${b.id}/cards`, { personId: p.id, firstName: 'Smoke', lastName: 'Test', front: PNG });
  await call('POST', `/api/queue/batches/${b.id}/ready`); step('card queued');
  if ((await call('GET', '/api/state')).queue.paused) await call('POST', '/api/queue/resume');
  for (let i = 0; i < 40; i++) {
    const h = await call('GET', `/api/history?clientId=${c.id}`);
    if (h.rows.some(r => r.status === 'printed')) { step('card printed and in history'); console.log('\nSmoke test passed.'); return; }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Card did not print within 40 seconds');
})().catch(e => { console.error('\nSmoke test FAILED:', e.message); process.exit(1); });
