// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Administrator cards in Settings: person fields, users, automatic backups and closing the program.
// Everything user-supplied is escaped with esc() before it goes into HTML.
export function createAdmin(ctx) {
  const { S, api, toast, modal, confirmBox, esc, ICON, $, $$, fmtDateTime, showLogin, showClosed } = ctx;
  const TYPES = { text: 'Text', date: 'Date', auto: 'Number that counts up' };
  const PRESETS = [{ label: 'Department', type: 'text' }, { label: 'Expiry date', type: 'date', expiry: true }, { label: 'Card number', type: 'auto', digits: 5, next: 1 }];

  // ---------- person fields ----------
  function fields(card) {
    const list = S.config.customFields || [];
    const have = new Set(list.map(f => f.label.toLowerCase()));
    const missing = PRESETS.filter(p => !have.has(p.label.toLowerCase()));
    card.innerHTML = `<div class="card-h"><div><h2>Person fields</h2></div><button class="btn sm" id="fdAdd">${ICON.plus}Add field</button></div>
      <div class="card-b stack">${list.length ? list.map(f => `<div class="row" style="gap:8px;align-items:center"><b style="flex:1">${esc(f.label)}</b>
          <span class="chip">${TYPES[f.type]}${f.type === 'auto' ? `: next ${esc(f.prefix || '')}${String(f.next).padStart(f.digits, '0')}` : ''}</span>${f.expiry ? '<span class="chip info">Card expiry</span>' : ''}
          <button class="btn sm" data-fe="${esc(f.key)}">${ICON.edit}Edit</button><button class="btn sm ghost danger" data-fx="${esc(f.key)}" aria-label="Delete ${esc(f.label)}">${ICON.trash}</button></div>`).join('')
        : '<span class="hint">No extra fields yet.</span>'}
        ${missing.length ? `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="hint">Quick add:</span>${missing.map(p => `<button class="btn sm" data-fp="${PRESETS.indexOf(p)}">${esc(p.label)}</button>`).join('')}</div>` : ''}</div>`;
    const reload = () => fields(card);
    $('#fdAdd', card).onclick = () => fieldModal(null, reload);
    $$('[data-fe]', card).forEach(b => b.onclick = () => fieldModal(list.find(f => f.key === b.dataset.fe), reload));
    $$('[data-fp]', card).forEach(b => b.onclick = async () => { try { await api('POST', '/api/fields', PRESETS[+b.dataset.fp]); await refreshConfig(); reload(); toast('Field added', 'ok'); } catch (e) { toast(e.message, 'err'); } });
    $$('[data-fx]', card).forEach(b => b.onclick = async () => {
      const f = list.find(x => x.key === b.dataset.fx);
      if (!(await confirmBox(`Delete "${f.label}"?`, 'People\'s values for it are no longer shown, and card templates that show it leave that space blank.', 'Delete', 'danger'))) return;
      try { await api('DELETE', `/api/fields/${f.key}`); await refreshConfig(); reload(); toast('Field deleted'); } catch (e) { toast(e.message, 'err'); }
    });
  }
  function fieldModal(f, done) {
    const type = f ? f.type : 'text';
    modal({ title: f ? `Edit "${f.label}"` : 'Add a person field',
      body: `<div class="stack" style="gap:12px"><label class="f">Name<input class="input" id="fmLabel" value="${esc(f?.label || '')}" placeholder="e.g. Department"></label>
        <label class="f">Type<select class="input" id="fmType" ${f ? 'disabled' : ''}>${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div id="fmAuto" class="grid2"><label class="f">Prefix<input class="input" id="fmPrefix" value="${esc(f?.prefix || '')}" placeholder="e.g. C"></label><label class="f">Digits<input class="input" type="number" min="1" max="9" id="fmDigits" value="${+(f?.digits || 5)}"></label>
          <label class="f">Next number<input class="input" type="number" min="1" id="fmNext" value="${+(f?.next || 1)}"></label></div>
        <label class="check" id="fmExp" style="border:0;padding:0"><label class="switch"><input type="checkbox" id="fmExpiry" ${f?.expiry ? 'checked' : ''}><i></i></label><div><b>This is the card expiry date</b></div></label></div>`,
      onMount: (m) => { const sync = () => { const t = $('#fmType', m).value; $('#fmAuto', m).hidden = t !== 'auto'; $('#fmExp', m).hidden = t !== 'date'; }; $('#fmType', m).onchange = sync; sync(); setTimeout(() => $('#fmLabel', m).focus(), 30); },
      actions: [{ label: 'Cancel' }, { label: f ? 'Save' : 'Add field', kind: 'primary', onClick: async (m) => {
        const body = { label: $('#fmLabel', m).value, type: $('#fmType', m).value, prefix: $('#fmPrefix', m).value, digits: +$('#fmDigits', m).value, next: +$('#fmNext', m).value, expiry: $('#fmExpiry', m).checked };
        try { await api(f ? 'PUT' : 'POST', f ? `/api/fields/${f.key}` : '/api/fields', body); await refreshConfig(); done(); toast(f ? 'Field saved' : 'Field added', 'ok'); }
        catch (e) { toast(e.message, 'err'); return false; }
      } }] });
  }
  async function refreshConfig() { const st = await api('GET', '/api/state'); S.config = st.config; ctx.onConfig(); }

  // ---------- users ----------
  async function users(card) {
    let list = [];
    try { list = await api('GET', '/api/users'); } catch (e) { card.innerHTML = `<div class="card-b"><span class="hint">${esc(e.message)}</span></div>`; return; }
    card.innerHTML = `<div class="card-h"><div><h2>Users</h2></div><button class="btn sm" id="usAdd">${ICON.plus}Add user</button></div>
      <div class="card-b stack" style="gap:8px">${list.map(u => `<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:140px"><b>${esc(u.username)}</b>${u.username === S.user.username ? ' <span class="chip info">You</span>' : ''}${u.mustChangePassword ? ' <span class="chip warn">Must choose a password</span>' : ''}
          <div class="hint">${u.lastLoginAt ? `Last signed in ${esc(fmtDateTime(u.lastLoginAt))}` : 'Not signed in yet'}</div></div>
          <select class="input" data-ur="${+u.id}" style="max-width:160px" aria-label="Role for ${esc(u.username)}"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option><option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Operator</option></select>
          <button class="btn sm" data-up="${+u.id}">Reset password</button>${u.username === S.user.username ? '' : `<button class="btn sm ghost danger" data-ux="${+u.id}" aria-label="Delete ${esc(u.username)}">${ICON.trash}</button>`}</div>`).join('')}</div>`;
    const reload = () => users(card);
    const byId = (id) => list.find(u => u.id === +id);
    $('#usAdd', card).onclick = () => modal({ title: 'Add a user',
      body: `<div class="stack" style="gap:12px"><label class="f">Username<input class="input" id="uaName" autocomplete="off"></label>
        <label class="f">Role<select class="input" id="uaRole"><option value="operator">Operator: add people and print</option><option value="admin">Administrator: everything</option></select></label>
        <label class="f">Temporary password<input class="input" id="uaPw" autocomplete="new-password" placeholder="At least 8 characters"></label></div>`,
      onMount: (m) => setTimeout(() => $('#uaName', m).focus(), 30),
      actions: [{ label: 'Cancel' }, { label: 'Add user', kind: 'primary', onClick: async (m) => {
        try { await api('POST', '/api/users', { username: $('#uaName', m).value, role: $('#uaRole', m).value, password: $('#uaPw', m).value }); reload(); toast('User added', 'ok'); }
        catch (e) { toast(e.message, 'err'); return false; }
      } }] });
    $$('[data-ur]', card).forEach(sel => sel.onchange = async () => {
      try { await api('PUT', `/api/users/${sel.dataset.ur}`, { role: sel.value }); toast('Role changed', 'ok'); if (byId(sel.dataset.ur).username === S.user.username) location.reload(); }
      catch (e) { toast(e.message, 'err'); reload(); }
    });
    $$('[data-up]', card).forEach(b => b.onclick = () => { const u = byId(b.dataset.up); modal({ title: `Reset ${u.username}'s password`, text: 'They are signed out and choose a new password when they next sign in.',
      body: `<label class="f">Temporary password<input class="input" id="urPw" autocomplete="new-password" placeholder="At least 8 characters"></label>`,
      onMount: (m) => setTimeout(() => $('#urPw', m).focus(), 30),
      actions: [{ label: 'Cancel' }, { label: 'Reset password', kind: 'primary', onClick: async (m) => {
        try { await api('PUT', `/api/users/${u.id}`, { password: $('#urPw', m).value }); toast('Password reset', 'ok'); if (u.username === S.user.username) showLogin('Sign in with the temporary password.'); else reload(); }
        catch (e) { toast(e.message, 'err'); return false; }
      } }] }); });
    $$('[data-ux]', card).forEach(b => b.onclick = async () => {
      const u = byId(b.dataset.ux);
      if (!(await confirmBox(`Delete ${u.username}?`, 'They can no longer sign in. Their name stays in the print history.', 'Delete', 'danger'))) return;
      try { await api('DELETE', `/api/users/${u.id}`); reload(); toast('User deleted'); } catch (e) { toast(e.message, 'err'); }
    });
  }

  // ---------- automatic backups ----------
  async function autoBackup(card) {
    let a; try { a = await api('GET', '/api/autobackup'); } catch (e) { card.innerHTML = ''; return; }
    const last = a.last ? (a.last.ok ? `Last backup ${esc(fmtDateTime(a.last.at))}: ${esc(a.last.file)}` : `<span style="color:var(--err)">Last attempt ${esc(fmtDateTime(a.last.at))} failed: ${esc(a.last.error)}</span>`) : 'No automatic backup yet.';
    card.innerHTML = `<div class="card-h"><div><h2>Automatic backups</h2></div></div><div class="card-b stack">
      <label class="check" style="border:0;padding:0"><label class="switch"><input type="checkbox" id="abOn" ${a.enabled ? 'checked' : ''}><i></i></label><div><b>Back up automatically</b><span>${last}</span></div></label>
      <label class="f">Folder<input class="input" id="abDir" value="${esc(a.folder)}" placeholder="e.g. D:\\ID card backups or \\\\server\\share\\ID cards"></label>
      <div class="grid2"><label class="f">How often<select class="input" id="abEvery"><option value="daily" ${a.every === 'daily' ? 'selected' : ''}>Every day</option><option value="weekly" ${a.every === 'weekly' ? 'selected' : ''}>Every week</option></select></label>
        <label class="f">Keep the newest<input class="input" type="number" min="1" max="365" id="abKeep" value="${+a.keep}"></label></div>
      <div class="grid2"><label class="f">${a.hasPassword ? 'New backup password' : 'Backup password'}<input class="input" type="password" id="abPw" autocomplete="new-password" placeholder="${a.hasPassword ? 'Leave blank to keep the current one' : 'At least 8 characters'}"></label>
        <label class="f">Confirm password<input class="input" type="password" id="abPw2" autocomplete="new-password"></label></div>
      <div class="row"><button class="btn primary" id="abSave">Save</button><button class="btn" id="abNow" ${a.hasPassword && a.folder ? '' : 'disabled'}>${ICON.download}Back up now</button></div></div>`;
    $('#abSave', card).onclick = async () => {
      const pw = $('#abPw', card).value;
      if (pw !== $('#abPw2', card).value) return toast('The passwords don\'t match', 'err');
      const body = { enabled: $('#abOn', card).checked, folder: $('#abDir', card).value.trim(), every: $('#abEvery', card).value, keep: +$('#abKeep', card).value, ...(pw ? { password: pw } : {}) };
      try { await api('PUT', '/api/autobackup', body); toast('Automatic backups saved', 'ok'); autoBackup(card); } catch (e) { toast(e.message, 'err'); }
    };
    $('#abNow', card).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api('POST', '/api/autobackup/run'); toast(r.ok ? 'Backup saved' : `Backup failed: ${r.error}`, r.ok ? 'ok' : 'err'); } catch (err) { toast(err.message, 'err'); }
      autoBackup(card);
    };
  }

  // ---------- closing the program (the tray icon has no Exit item, so this is the only way to close it) ----------
  function service(card) {
    card.innerHTML = `<div class="card-h"><div><h2>Program</h2></div></div><div class="card-b stack">
      <div class="row"><button class="btn danger" id="svStop">Close the program</button></div></div>`;
    $('#svStop', card).onclick = async () => {
      const busy = S.worker && S.worker.current;
      if (!(await confirmBox('Close the program?', `${busy ? 'A card is printing right now. ' : ''}Printing stops until the program is opened again.`, 'Close', 'danger'))) return;
      try { await api('POST', '/api/service/stop'); } catch (e) { return toast(e.message, 'err'); }
      showClosed();
    };
  }

  return { fields, users, autoBackup, service };
}
