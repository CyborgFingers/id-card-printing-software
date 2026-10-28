// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Visual card template builder: pick a background per side, tick fields, drag them onto the
// card, then move, resize and style them. Everything is drawn by the same renderer used for printing.
import { drawCard, drawBarcode, barcodeValue, assetUrl, FONTS, templateImage, fieldInfo, customFields, isPersonField, BARCODE_TYPES, DATE_FORMATS, formatDate, CARD_SIZES, CUSTOM_MM, cardFor, cardInfo, cardLabel, cardDims, photoSpec } from './render.js';

const SNAP = 7;           // card pixels
const TICKABLE = ['photo', 'firstName', 'lastName', 'staffId', 'position', 'title', 'address'];
const DESIGN_KINDS = ['text', 'image', 'box', 'barcode'];   // can be placed more than once; not person details
const ADDABLE = [['text', 'Add text'], ['image', 'Add logo or image'], ['box', 'Add shape'], ['barcode', 'Add barcode or QR code']];
const IC = {
  ch: '<svg viewBox="0 0 24 24"><path d="M12 2v20"/><rect x="5" y="6" width="14" height="5" rx="1"/><rect x="7" y="14" width="10" height="5" rx="1"/></svg>',
  cv: '<svg viewBox="0 0 24 24"><path d="M2 12h20"/><rect x="6" y="5" width="5" height="14" rx="1"/><rect x="14" y="7" width="5" height="10" rx="1"/></svg>',
  cc: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/></svg>',
  top: '<svg viewBox="0 0 24 24"><path d="M5 4h14"/><path d="M12 20V8"/><path d="M7 13l5-5 5 5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
  bottom: '<svg viewBox="0 0 24 24"><path d="M5 20h14"/><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/></svg>',
};
// Stacking order buttons: [direction for arrange(), label, icon, tooltip]; the first two raise, the last two lower.
const ARRANGE = [['top', 'To front', 'top', 'Bring to front (Ctrl+Shift+])'], ['1', 'Forward', 'up', 'Bring forward (Ctrl+])'], ['-1', 'Backward', 'down', 'Send backward (Ctrl+[)'], ['bottom', 'To back', 'bottom', 'Send to back (Ctrl+Shift+[)']];
const WEIGHTS = { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold' };
// A picture's Darkness, Contrast and Colour (-50..50): [label, left end, right end], and the keys on a side / on an element.
const TONE = [['Darkness', 'Lighter', 'Darker'], ['Contrast', 'Less', 'More'], ['Colour', 'Weaker', 'Stronger']];
const BG_TONE = ['bgDarkness', 'bgContrast', 'bgColour'], EL_TONE = ['darkness', 'contrast', 'colour'];
const signed = (v) => v > 0 ? `+${v}` : `${v}`;

export function createBuilder(ctx) {
  const { S, api, toast, modal, confirmBox, esc, ICON, refreshLists, $, $$, plural } = ctx;
  const B = { id: null, draft: null, saved: '', side: 'front', sel: null, undo: [], redo: [], pending: null, scale: 0.6, samples: true, el: null, top: null, keyHandler: null, raf: 0 };
  const CARD = { get w() { return B.draft?.card?.w || 638; }, get h() { return B.draft?.card?.h || 1013; } };   // portrait or landscape
  const landscape = () => CARD.w > CARD.h;
  const label = (e) => fieldInfo(e.field).label;
  const uid = () => 'e' + Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const snap = () => JSON.stringify(B.draft);
  const dirty = () => B.draft && snap() !== B.saved;
  const els = () => B.draft.elements.filter(e => e.side === B.side);
  const selEl = () => B.draft.elements.find(e => e.id === B.sel) || null;
  const ticked = () => new Set([...(B.draft.fields || []), ...B.draft.elements.map(e => e.field)].filter(f => f === 'photo' || isPersonField(f)));

  // ---------- undo ----------
  function begin() { if (B.pending === null) B.pending = snap(); }
  function end() {
    if (B.pending !== null && B.pending !== snap()) { B.undo.push(B.pending); if (B.undo.length > 100) B.undo.shift(); B.redo = []; }
    B.pending = null; paintBar();
  }
  function change(fn) { begin(); fn(); end(); refresh(); }
  function undo() { if (!B.undo.length) return; B.redo.push(snap()); B.draft = JSON.parse(B.undo.pop()); if (!selEl()) B.sel = null; refresh(true); }
  function redo() { if (!B.redo.length) return; B.undo.push(snap()); B.draft = JSON.parse(B.redo.pop()); if (!selEl()) B.sel = null; refresh(true); }

  // ---------- new elements ----------
  function newElement(field, cx, cy) {
    const f = fieldInfo(field);
    const at = (w, h, extra) => ({ id: uid(), field, side: B.side, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, ...extra });
    if (field === 'photo') return at(360, 480, { radius: 0, borderWidth: 0, borderColor: '#00529F', bgColor: '#e9eef4' });
    if (field === 'image') return at(240, 120, { asset: null, fit: 'contain' });
    if (field === 'box') return { ...at(CARD.w, 90, { fill: '#00529F', noFill: false, radius: 0, borderWidth: 0, borderColor: '#00529F' }), x: 0 };
    if (field === 'barcode') { const src = customFields().find(k => fieldInfo(k).type === 'auto') || 'staffId'; return at(220, 220, { symbol: 'qrcode', source: src, text: '', color: '#000000', showText: false, rotate: 0 }); }
    const size = f.size || 40, w = field === 'address' ? 480 : 520, h = field === 'address' ? Math.round(size * 3.6) : Math.round(size * 1.1);
    return { id: uid(), field, side: B.side, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, font: 'Fira Sans', weight: ['firstName', 'lastName'].includes(field) ? 500 : 400, size, minSize: Math.min(14, size), color: '#111111', align: field === 'address' ? 'left' : 'center', valign: 'middle', uppercase: ['firstName', 'lastName'].includes(field), letterSpacing: 0, lineHeight: 1.2, rotate: 0, text: field === 'text' ? 'STAFF' : undefined, dateFormat: f.type === 'date' ? 'DD/MM/YYYY' : undefined };
  }
  function place(field, cx = CARD.w / 2, cy = CARD.h / 2) {
    const have = !DESIGN_KINDS.includes(field) && els().find(e => e.field === field);
    if (have) { B.sel = have.id; refresh(); return; }
    const e = newElement(field, cx, cy);
    clamp(e);
    change(() => { B.draft.elements.push(e); B.draft.fields = [...ticked()]; B.sel = e.id; });
  }
  function clamp(e) {
    e.w = Math.max(16, Math.min(CARD.w, Math.round(e.w))); e.h = Math.max(16, Math.min(CARD.h, Math.round(e.h)));
    e.x = Math.max(0, Math.min(CARD.w - e.w, Math.round(e.x))); e.y = Math.max(0, Math.min(CARD.h - e.h, Math.round(e.y)));
  }
  // An opacity slider (lo–100 %) for obj[k], stored as 0.05–1; the key is dropped again at 100 % (solid, the default).
  // Live while dragging, one undo step per drag.
  const fade = (id, lbl, v, lo) => { const p = Math.round((v ?? 1) * 100); return `<label class="f"><span style="display:flex;justify-content:space-between">${lbl}<span class="num muted" id="${id}V">${p}%</span></span><input type="range" id="${id}" min="${lo}" max="100" value="${p}" aria-label="${lbl}"></label>`; };
  function bindFade(id, obj, k) {
    const inp = $(`#${id}`); if (!inp) return;
    inp.oninput = () => { begin(); const p = +inp.value; if (p >= 100) delete obj[k]; else obj[k] = p / 100; $(`#${id}V`).textContent = `${p}%`; render(); };
    inp.onchange = () => { end(); refresh(); };
  }
  // Tone sliders for a picture (obj[keys[i]], a number kept only when not 0), optionally under a heading row with the Reset.
  // Live while dragging, one undo step per drag; `${id}R` puts all three back to 0 in one step.
  const toneReset = (id, obj, keys) => `<button class="btn sm ghost" id="${id}R" ${keys.some(k => obj[k]) ? '' : 'disabled'}>Reset</button>`;
  const tone = (id, obj, keys, title) => `<div class="tone">${title ? `<div class="val"><b>${title}</b>${toneReset(id, obj, keys)}</div>` : ''}${TONE.map(([l, lo, hi], i) => { const v = obj[keys[i]] || 0; return `<label class="f"><span class="val">${l}<span class="num muted" id="${id}${i}V">${signed(v)}</span></span><input type="range" id="${id}${i}" min="-50" max="50" step="1" list="${id}Z" value="${v}" aria-label="${l}" aria-valuetext="${signed(v)}"><span class="ends"><span>${lo}</span><span>${hi}</span></span></label>`; }).join('')}<datalist id="${id}Z"><option value="0"></option></datalist></div>`;
  function bindTone(id, obj, keys) {
    keys.forEach((k, i) => {
      const inp = $(`#${id}${i}`); if (!inp) return;
      inp.oninput = () => { begin(); const v = +inp.value; if (v) obj[k] = v; else delete obj[k]; inp.setAttribute('aria-valuetext', signed(v)); $(`#${id}${i}V`).textContent = signed(v); render(); };
      inp.onchange = () => { end(); refresh(); };
    });
    const r = $(`#${id}R`); if (r) r.onclick = () => change(() => keys.forEach(k => delete obj[k]));
  }

  // ---------- page ----------
  function mount(root, top, id) {
    const d = S.designs.find(x => x.id === id);
    if (!d) { root.innerHTML = `<div class="card"><div class="empty"><b>Template not found</b><a href="#/templates">Back to card templates</a></div></div>`; return; }
    if (B.id !== id || !B.draft) { B.id = id; B.draft = clone(d); B.draft.fields = B.draft.fields || []; B.saved = snap(); B.side = 'front'; B.sel = null; B.undo = []; B.redo = []; }
    B.el = root; B.top = top;
    top.innerHTML = `<div class="row" id="bBar"></div>`;
    root.innerHTML = `<div class="bld">
      <aside class="card bld-panel" id="bLeft"></aside>
      <section class="bld-stage">
        <div class="bld-tools"><div class="seg" id="bSide" role="radiogroup" aria-label="Card side"></div><div class="row bld-align" id="bAlign"></div><span class="sp"></span>
          <button class="btn sm ghost" id="bUndo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button><button class="btn sm ghost" id="bRedo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICON.redo}</button>
          <label class="check" style="border:0;padding:0;align-items:center;gap:8px"><label class="switch"><input type="checkbox" id="bSamples" ${B.samples ? 'checked' : ''}><i></i></label><span>Sample text</span></label></div>
        <div class="bld-wrap" id="bWrap"><div class="bld-card" id="bCard"><canvas id="bCv"></canvas><div class="bld-ovl" id="bOvl" tabindex="0" aria-label="Card layout. Arrow keys move the selected field."></div><i class="guide gv" hidden></i><i class="guide gh" hidden></i></div></div>
      </section>
      <aside class="card bld-panel" id="bRight"></aside></div>`;
    $('#bSamples').onchange = e => { B.samples = e.target.checked; render(); };
    $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
    sizeStage();
    bindStage();
    refresh(true);
    if (B.keyHandler) document.removeEventListener('keydown', B.keyHandler);
    B.keyHandler = onKey; document.addEventListener('keydown', B.keyHandler);
    window.removeEventListener('resize', sizeStage); window.addEventListener('resize', sizeStage);
  }
  function unmount() { if (B.keyHandler) document.removeEventListener('keydown', B.keyHandler); B.keyHandler = null; window.removeEventListener('resize', sizeStage); }

  function sizeStage() {
    const wrap = $('#bWrap'); if (!wrap) return;
    const avail = Math.max(240, Math.min(wrap.clientWidth - 32, (window.innerHeight - 290) * CARD.w / CARD.h, landscape() ? 640 : 420));
    B.scale = avail / CARD.w;
    const card = $('#bCard'); card.style.width = `${Math.round(CARD.w * B.scale)}px`; card.style.height = `${Math.round(CARD.h * B.scale)}px`;
    paintOverlay();
  }

  function refresh(full) {
    if (!B.el || !document.body.contains(B.el)) return;
    paintBar(); paintSide(); paintLeft(); paintRight(); paintAlign(); paintOverlay(); render();
  }
  // The ID photo size the front's photo frame expects ("360 × 480 px · 30.5 × 40.6 mm · 3:4 portrait"), kept live while the frame is resized.
  const specLine = (s) => s ? `${s.w} × ${s.h} px · ${s.mmW} × ${s.mmH} mm · ${s.shape ? `${s.shape} ` : ''}${s.orientation}` : '';   // breaks only before a "· " part
  function paintSpec() { const el = $('#bSpec'); if (el) el.textContent = `At least ${specLine(photoSpec(B.draft))}`; }
  function render() {
    paintSpec();
    cancelAnimationFrame(B.raf);
    B.raf = requestAnimationFrame(() => { const cv = $('#bCv'); if (cv) drawCard(cv, B.draft, B.side, {}, { samples: B.samples, placeholder: true }); });
  }

  // ---------- top bar ----------
  function paintBar() {
    const bar = $('#bBar'); if (!bar) return;
    const users = S.clients.filter(c => (c.templateIds || []).includes(B.id));
    bar.innerHTML = `${dirty() ? '<span class="dirty">Unsaved changes</span>' : '<span class="chip ok">Saved</span>'}
      <button class="btn" id="bAssign">${ICON.clients}${users.length ? `Used by ${plural(users.length, 'client')}` : 'Assign to clients'}</button>
      <button class="btn" id="bDup">${ICON.copy}Duplicate</button><button class="btn danger" id="bDel" aria-label="Delete template">${ICON.trash}</button>
      <button class="btn primary" id="bSave" ${dirty() ? '' : 'disabled'}>Save template</button>`;
    const u = $('#bUndo'), r = $('#bRedo'); if (u) u.disabled = !B.undo.length; if (r) r.disabled = !B.redo.length;
    $('#bSave').onclick = save; $('#bAssign').onclick = assign; $('#bDup').onclick = duplicate; $('#bDel').onclick = remove;
  }
  async function save() {   // true when saved
    if (!B.draft.name.trim()) { toast('Give the template a name', 'err'); return false; }
    try { const r = await api('PUT', `/api/designs/${B.id}`, B.draft); B.draft = clone(r); B.draft.fields = B.draft.fields || []; B.saved = snap(); await refreshLists(); toast(`Saved "${r.name}"`, 'ok'); refresh(); return true; }
    catch (e) { toast(e.message, 'err'); return false; }
  }
  function assign() {
    const cur = new Set(S.clients.filter(c => (c.templateIds || []).includes(B.id)).map(c => c.id));
    modal({ title: 'Assign to clients',
      body: S.clients.length ? `<div class="stack" style="gap:0">${S.clients.map(c => `<label class="check"><input type="checkbox" data-c="${c.id}" ${cur.has(c.id) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)"><div><b>${esc(c.name)}</b><span>${plural((c.templateIds || []).length, 'template')}${c.defaultDesignId === B.id ? ' · this is their default' : ''}</span></div></label>`).join('')}</div>` : '<p class="hint">No clients yet.</p>',
      actions: [{ label: 'Cancel' }, ...(S.clients.length ? [{ label: 'Save', kind: 'primary', onClick: async (m) => {
        const ids = $$('[data-c]', m).filter(x => x.checked).map(x => x.dataset.c);
        try { await api('PUT', `/api/designs/${B.id}/clients`, { clientIds: ids }); await refreshLists(); toast('Assignments saved', 'ok'); paintBar(); paintRight(); }
        catch (e) { toast(e.message, 'err'); return false; }
      } }] : [])] });
  }
  async function duplicate() {
    try { if (dirty() && !(await save())) return; const r = await api('POST', '/api/designs', { from: B.id }); await refreshLists(); toast(`Created "${r.name}"`, 'ok'); B.draft = null; location.hash = `#/templates/${r.id}`; }
    catch (e) { toast(e.message, 'err'); }
  }
  async function remove() {
    if (!(await confirmBox('Delete this template?', `"${B.draft.name}" will be removed.`, 'Delete', 'danger'))) return;
    try { await api('DELETE', `/api/designs/${B.id}`); B.saved = snap(); await refreshLists(); toast('Template deleted'); B.draft = null; location.hash = '#/templates'; }
    catch (e) { toast(e.message, 'err'); }
  }

  // ---------- left panel: name, side, background, fields ----------
  function paintSide() {
    const seg = $('#bSide'); if (!seg) return;
    seg.innerHTML = [['front', 'Front'], ['back', 'Back']].map(([k, l]) => `<button type="button" role="radio" data-s="${k}" class="${B.side === k ? 'on' : ''}" aria-checked="${B.side === k}">${l}${k === 'back' && !B.draft.back.enabled ? ' (off)' : ''}</button>`).join('');
    $$('[data-s]', seg).forEach(b => b.onclick = () => { B.side = b.dataset.s; B.sel = null; refresh(); });
  }
  function paintLeft() {
    const L = $('#bLeft'); if (!L) return;
    const side = B.draft[B.side]; const t = ticked();
    const placed = (f) => B.draft.elements.filter(e => e.field === f).map(e => e.side);
    const backOff = B.side === 'back' && !B.draft.back.enabled;
    const card = cardInfo(B.draft.card);
    const tk = 73 / Math.max(CARD.w, CARD.h);   // background thumbnail in the card's own proportions
    L.innerHTML = `<div class="fieldset"><label class="f">Template name<input class="input" id="bName" value="${esc(B.draft.name)}"></label>
        <div class="f"><span>Card size</span><div class="seg sm" id="bSize">${[...Object.keys(CARD_SIZES), 'custom'].map(k => `<button type="button" data-size="${k}" class="${card.size === k ? 'on' : ''}">${k === 'custom' ? 'Custom' : k}</button>`).join('')}</div></div>
        ${card.size === 'custom' ? `<div class="grid2"><label class="f">Width (mm)<input class="input sm num" type="number" id="bMmW" min="${CUSTOM_MM.min}" max="${CUSTOM_MM.max}" step="0.1" value="${card.mmW}"></label><label class="f">Height (mm)<input class="input sm num" type="number" id="bMmH" min="${CUSTOM_MM.min}" max="${CUSTOM_MM.max}" step="0.1" value="${card.mmH}"></label></div>` : ''}
        <div class="f"><span>Card orientation</span><div class="seg sm" id="bOrient">${[['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([k, l]) => `<button type="button" data-o="${k}" class="${(k === 'landscape') === landscape() ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <span class="hint num">${cardDims(B.draft.card)}</span></div>
      <div class="fieldset"><h3>${B.side === 'front' ? 'Front' : 'Back'} background</h3>
        ${B.side === 'back' ? `<label class="check" style="border:0;padding:0"><label class="switch"><input type="checkbox" id="bBackOn" ${B.draft.back.enabled ? 'checked' : ''}><i></i></label><div><b>Print a back</b></div></label>` : ''}
        ${backOff ? '' : `<div class="tpl"><div class="tthumb" style="background-image:url('${assetUrl(side.background) || ''}');width:${Math.round(CARD.w * tk)}px;height:${Math.round(CARD.h * tk)}px"></div><div class="row" style="gap:6px"><button class="btn sm" id="bUp">${ICON.upload}${side.background ? 'Change' : 'Choose'} image</button>${side.background ? '<button class="btn sm ghost danger" id="bClr">Remove</button>' : ''}</div></div>
        <label class="f" style="flex-direction:row;align-items:center;gap:10px">Background colour<input type="color" class="input" id="bBg" value="${side.bgColor || '#ffffff'}"></label>
        ${side.background ? fade('bBgOp', 'Image opacity', side.bgOpacity, 0) + tone('bBgT', side, BG_TONE, 'Adjustments') : ''}`}
        <input type="file" id="bFile" accept="image/*" hidden></div>
      <div class="fieldset"><h3>Fields</h3>
        <div class="flist">${[...TICKABLE, ...customFields()].map(f => { const on = t.has(f); const sides = placed(f); const here = sides.includes(B.side);
          return `<div class="fld ${on ? 'on' : ''}"><label><input type="checkbox" data-tick="${f}" ${on ? 'checked' : ''}><span>${esc(fieldInfo(f).label)}</span></label>
            ${on ? (here ? `<button class="fchip placed" data-pick="${f}" title="Select on card">${ICON.check}On ${B.side}</button>` : `<button class="fchip" draggable="true" data-drag="${f}" title="Drag onto the card, or click to place it in the middle" ${backOff ? 'disabled' : ''}>${ICON.grip}Drag onto card</button>`) : ''}</div>`; }).join('')}
        </div></div>
      <div class="fieldset"><h3>Design</h3><div class="flist">${ADDABLE.map(([k, l]) => `<div class="fld on"><span style="padding-left:2px">${fieldInfo(k).label === 'Text' ? 'Fixed text' : fieldInfo(k).label}</span><button class="fchip" draggable="true" data-drag="${k}" title="Drag onto the card, or click to add" ${backOff ? 'disabled' : ''}>${ICON.grip}${l}</button></div>`).join('')}</div></div>`;
    // Size and orientation: set design.card the way the service does, keep every element on the card, resize the stage.
    const setCard = (patch) => {
      const next = cardFor({ ...card, ...patch });
      if (next.w === CARD.w && next.h === CARD.h && next.size === card.size) return;
      change(() => { B.draft.card = next; B.draft.elements.forEach(clamp); });
      sizeStage();
    };
    $$('[data-size]', L).forEach(b => b.onclick = () => setCard({ size: b.dataset.size }));
    $$('[data-o]', L).forEach(b => b.onclick = () => setCard({ landscape: b.dataset.o === 'landscape' }));
    $('#bMmW') && ($('#bMmW').onchange = e => setCard({ mmW: e.target.value, landscape: +e.target.value > card.mmH }));
    $('#bMmH') && ($('#bMmH').onchange = e => setCard({ mmH: e.target.value, landscape: card.mmW > +e.target.value }));
    const name = $('#bName');
    name.oninput = e => { begin(); B.draft.name = e.target.value; paintBar(); };
    name.onchange = () => end();
    $('#bBackOn') && ($('#bBackOn').onchange = e => change(() => { B.draft.back.enabled = e.target.checked; }));
    $('#bUp') && ($('#bUp').onclick = () => $('#bFile').click());
    $('#bClr') && ($('#bClr').onclick = () => change(() => { B.draft[B.side].background = null; }));
    $('#bBg') && ($('#bBg').oninput = e => { begin(); B.draft[B.side].bgColor = e.target.value; render(); });
    $('#bBg') && ($('#bBg').onchange = () => { end(); refresh(); });
    bindFade('bBgOp', side, 'bgOpacity');
    bindTone('bBgT', side, BG_TONE);
    $('#bFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const im = await templateImage(f);
        const r = await api('POST', '/api/assets', im.blob, im.type);
        change(() => { B.draft[B.side].background = r.name; });
        toast(Math.abs(im.w / im.h - CARD.w / CARD.h) > 0.03 ? `Background set. The picture is a different shape from the card, so its edges are trimmed to fill it. Save the template to keep it.` : 'Background set. Save the template to keep it.', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      e.target.value = '';   // choosing the same file again still works
    };
    $$('[data-tick]', L).forEach(cb => cb.onchange = () => {
      const f = cb.dataset.tick;
      if (cb.checked) change(() => { B.draft.fields = [...new Set([...(B.draft.fields || []), f])]; });
      else change(() => { B.draft.elements = B.draft.elements.filter(e => e.field !== f); B.draft.fields = (B.draft.fields || []).filter(x => x !== f); if (!selEl()) B.sel = null; });
    });
    $$('[data-pick]', L).forEach(b => b.onclick = () => { const e = els().find(x => x.field === b.dataset.pick); if (e) { B.sel = e.id; refresh(); } });
    $$('[data-drag]', L).forEach(chip => {
      chip.onclick = () => place(chip.dataset.drag);
      chip.ondragstart = (ev) => { ev.dataTransfer.setData('text/x-idcard-field', chip.dataset.drag); ev.dataTransfer.effectAllowed = 'copy'; $('#bCard').classList.add('dropping'); };
      chip.ondragend = () => $('#bCard')?.classList.remove('dropping');
    });
  }

  // ---------- right panel: selected field ----------
  function paintRight() {
    const R = $('#bRight'); if (!R) return;
    const e = selEl();
    if (!e) {
      const users = S.clients.filter(c => (c.templateIds || []).includes(B.id));
      const onSide = els().reverse();   // top-most first, as they stack on the card
      const sub = (x) => x.field === 'text' ? esc(x.text || '') : x.field === 'barcode' ? `${BARCODE_TYPES.find(t => t[0] === x.symbol)?.[1] || ''} · ${x.source === 'text' ? 'fixed text' : esc(fieldInfo(x.source).label)}` : `${x.w} × ${x.h} px`;
      R.innerHTML = `<div class="fieldset"><h3>On the ${B.side}${onSide.length > 1 ? ' <small class="muted">top to bottom</small>' : ''}</h3>${onSide.length ? `<div class="stack" style="gap:6px">${onSide.map(x => `<button class="ditem" data-sel="${esc(x.id)}" style="padding:8px 10px"><span class="fdot ${x.field === 'photo' ? 'ph' : ''}"></span><div style="min-width:0"><b>${esc(label(x))}</b><span>${sub(x)}</span></div></button>`).join('')}</div>` : '<span class="hint">Nothing on this side yet.</span>'}</div>
        <div class="fieldset"><h3>Used by</h3>${users.length ? users.map(c => `<a class="chip info" href="#/clients/${c.id}/people" style="text-decoration:none">${esc(c.name)}${c.defaultDesignId === B.id ? ' · default' : ''}</a>`).join(' ') : '<span class="hint">Not assigned yet.</span>'}
          <button class="btn sm" id="bAssign2" style="align-self:flex-start">${ICON.clients}Assign to clients</button></div>
        <div class="fieldset"><h3>Card</h3><span class="hint num">${cardLabel(B.draft.card)} · ${cardDims(B.draft.card)}</span></div>`;
      $$('[data-sel]', R).forEach(b => b.onclick = () => { B.sel = b.dataset.sel; refresh(); });
      $('#bAssign2').onclick = assign;
      return;
    }
    const kind = ['photo', 'image', 'box', 'barcode'].includes(e.field) ? e.field : 'text';
    const order = els(), at = order.indexOf(e);   // its place in this side's stacking order (last = on top)
    const num = (k, lbl, attrs = '') => `<label class="f">${lbl}<input class="input sm num" type="number" data-k="${k}" value="${e[k] ?? 0}" ${attrs}></label>`;
    const seg = (k, opts) => `<div class="seg sm" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(e[k] ?? '') === String(v) ? 'on' : ''}" title="${l}">${l}</button>`).join('')}</div>`;
    const colour = (k, lbl) => `<label class="f" style="flex-direction:row;align-items:center;gap:8px">${lbl}<input type="color" class="input" data-k="${k}" data-str value="${e[k] || '#000000'}"></label>`;
    const toggle = (k, lbl) => `<label class="check" style="border:0;padding:0;align-items:center;gap:8px"><label class="switch"><input type="checkbox" data-k="${k}" data-bool ${e[k] ? 'checked' : ''}><i></i></label><span>${lbl}</span></label>`;
    const rotation = `<div class="f"><span>Rotation</span>${seg('rotate', [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']])}</div>`;
    const info = fieldInfo(e.field);
    const sources = [...new Set(['staffId', ...[...ticked()].filter(k => k !== 'photo'), ...customFields()])].map(k => [k, fieldInfo(k).label]);
    const panels = {
      photo: `<div class="fieldset"><h3>Photos</h3><div class="seg sm" data-seg="fit">${[['cover', 'Fill the frame'], ['contain', 'Whole photo']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(e.fit || 'cover') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          ${e.side === 'front' ? `<span class="hint num" id="bSpec">At least ${specLine(photoSpec(B.draft))}</span>` : ''}</div>
        <div class="fieldset"><h3>Style</h3><div class="grid2">${num('radius', 'Corner radius', 'min="0"')}${num('borderWidth', 'Border', 'min="0"')}</div>
          <div class="row">${colour('borderColor', 'Border')}${colour('bgColor', 'Empty')}</div>
          <button class="btn sm" id="b34" style="align-self:flex-start">Make 3:4 portrait</button></div>`,
      image: `<div class="fieldset"><h3>Image</h3><div class="row" style="gap:6px"><button class="btn sm" id="bImg">${ICON.upload}${e.asset ? 'Change' : 'Choose'} image</button></div>
          <div class="f"><span>Fit</span>${seg('fit', [['contain', 'Fit inside'], ['cover', 'Fill box']])}</div>
          <input type="file" id="bImgFile" accept="image/*" hidden></div>`,
      box: `<div class="fieldset"><h3>Shape</h3><div class="row" style="gap:10px">${colour('fill', 'Fill')}${toggle('noFill', 'No fill')}</div>
          <div class="grid2">${num('radius', 'Corner radius', 'min="0"')}${num('borderWidth', 'Border', 'min="0"')}</div><div class="row">${colour('borderColor', 'Border')}</div></div>`,
      barcode: `<div class="fieldset"><h3>Barcode</h3>
          <label class="f">Type<select class="input sm" data-k="symbol" data-str>${BARCODE_TYPES.map(([k, l]) => `<option value="${k}" ${e.symbol === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">Data<select class="input sm" data-k="source" data-str>${sources.map(([k, l]) => `<option value="${k}" ${e.source === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="text" ${e.source === 'text' ? 'selected' : ''}>Fixed text</option></select></label>
          ${e.source === 'text' ? `<label class="f">Text<input class="input sm" data-k="text" data-str value="${esc(e.text || '')}"></label>` : ''}
          <div class="row" style="gap:10px">${colour('color', 'Colour')}${['code128', 'code39'].includes(e.symbol) ? toggle('showText', 'Show the text') : ''}</div>
          ${rotation}<span class="hint" id="bBcErr"></span></div>`,
      text: `${e.field === 'text' ? `<div class="fieldset"><label class="f">Text<input class="input sm" data-k="text" data-str value="${esc(e.text || '')}"></label></div>` : ''}
        <div class="fieldset"><h3>Text</h3>
          <div class="grid2"><label class="f">Font<select class="input sm" data-k="font" data-str>${FONTS.map(f => `<option ${e.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
            <label class="f">Weight<select class="input sm" data-k="weight">${Object.entries(WEIGHTS).map(([w, l]) => `<option value="${w}" ${+e.weight === +w ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
          <div class="grid2">${num('size', 'Size', 'min="6" max="300"')}${num('minSize', 'Smallest', 'min="6" max="300"')}</div>
          ${info.type === 'date' ? `<label class="f">Date format<select class="input sm" data-k="dateFormat" data-str>${DATE_FORMATS.map(f => `<option value="${f}" ${(e.dateFormat || 'DD/MM/YYYY') === f ? 'selected' : ''}>${formatDate(info.sample, f)}</option>`).join('')}</select></label>` : ''}
          <div class="row" style="gap:10px">${colour('color', 'Colour')}${toggle('uppercase', 'CAPITALS')}</div>
          <div class="f"><span>Align</span>${seg('align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}</div>
          <div class="f"><span>Vertical</span>${seg('valign', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']])}</div>
          ${rotation}
          <div class="grid2">${num('letterSpacing', 'Letter spacing', 'step="0.5"')}${e.field === 'address' ? num('lineHeight', 'Line spacing', 'step="0.05" min="0.8" max="3"') : '<span></span>'}</div></div>`,
    };
    R.innerHTML = `<div class="fieldset"><h3><span class="fdot ${kind === 'photo' ? 'ph' : ''}"></span>${esc(label(e))}<span class="sp"></span><button class="btn sm ghost danger" id="bRm" title="Remove from card">${ICON.trash}</button></h3></div>
      ${panels[kind]}
      <div class="fieldset"><h3>Position and size <small class="muted">px</small></h3><div class="grid2">${num('x', 'X')}${num('y', 'Y')}${num('w', 'Width', 'min="16"')}${num('h', 'Height', 'min="16"')}</div>
        <div class="stack" style="gap:6px"><button class="btn sm" id="bCx" style="justify-content:flex-start">${IC.ch}Centre horizontally</button><button class="btn sm" id="bCy" style="justify-content:flex-start">${IC.cv}Centre vertically</button>
          <div class="row" style="gap:6px"><button class="btn sm" id="bCc">${IC.cc}Centre on card</button><button class="btn sm" id="bFw">Full width</button></div></div></div>
      <div class="fieldset"><h3>Arrange</h3><div class="grid2" style="gap:6px">${ARRANGE.map(([d, l, ic, tip], i) => `<button class="btn sm" data-arr="${d}" title="${tip}" style="justify-content:flex-start" ${(i < 2 ? at === order.length - 1 : at === 0) ? 'disabled' : ''}>${IC[ic]}${l}</button>`).join('')}</div>
        ${fade('bOp', 'Opacity', e.opacity, 5)}</div>
      ${['photo', 'image'].includes(kind) ? `<div class="fieldset"><h3>Adjustments<span class="sp"></span>${toneReset('bT', e, EL_TONE)}</h3>${tone('bT', e, EL_TONE)}</div>` : ''}`;
    $$('[data-arr]', R).forEach(b => b.onclick = () => arrange(b.dataset.arr));
    bindFade('bOp', e, 'opacity');
    bindTone('bT', e, EL_TONE);
    $('#bRm').onclick = () => removeSel();
    $('#bCx').onclick = () => centre('h');
    $('#bCy').onclick = () => centre('v');
    $('#bCc').onclick = () => centre('both');
    $('#bFw').onclick = () => change(() => { e.x = e.field === 'box' ? 0 : 40; e.w = CARD.w - 2 * e.x; });
    $('#b34') && ($('#b34').onclick = () => change(() => { const cx = e.x + e.w / 2; e.h = Math.round(e.w * 4 / 3); e.x = Math.round(cx - e.w / 2); clamp(e); }));
    $('#bImg') && ($('#bImg').onclick = () => $('#bImgFile').click());
    $('#bImgFile') && ($('#bImgFile').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try { const im = await templateImage(f); const r = await api('POST', '/api/assets', im.blob, im.type); change(() => { e.asset = r.name; }); } catch (err) { toast(err.message, 'err'); }
      ev.target.value = '';
    });
    if (kind === 'barcode') {   // say so when the sample can't be encoded (e.g. letters in a numeric-only code)
      const err = drawBarcode(document.createElement('canvas').getContext('2d'), e, barcodeValue(e, {}, { samples: true }));
      if (err) $('#bBcErr').textContent = `This sample can't be shown as ${BARCODE_TYPES.find(t => t[0] === e.symbol)?.[1]}: ${err}`;
    }
    $$('[data-k]', R).forEach(inp => {
      const k = inp.dataset.k;
      const read = () => inp.hasAttribute('data-bool') ? inp.checked : inp.hasAttribute('data-str') ? inp.value : Number(inp.value);
      const apply = () => { const v = read(); if (typeof v === 'number' && !Number.isFinite(v)) return; begin(); e[k] = v; if (['x', 'y', 'w', 'h'].includes(k)) { const keep = { ...e }; clamp(e); if (keep[k] !== e[k] && document.activeElement !== inp) inp.value = e[k]; } paintOverlay(); render(); };
      if (inp.type === 'checkbox' || inp.tagName === 'SELECT') inp.onchange = () => { apply(); end(); if (['source', 'symbol'].includes(k)) paintRight(); };
      else { inp.oninput = apply; inp.onchange = () => { end(); paintRight(); }; }
    });
    $$('[data-seg]', R).forEach(sg => $$('[data-v]', sg).forEach(b => b.onclick = () => change(() => { const v = b.dataset.v; e[sg.dataset.seg] = /^\d+$/.test(v) ? +v : v; })));
  }
  // Centre the selected field on the card (horizontally, vertically or both).
  function centre(dir) {
    const e = selEl(); if (!e) return;
    change(() => {
      if (dir !== 'v') e.x = Math.round((CARD.w - e.w) / 2);
      if (dir !== 'h') e.y = Math.round((CARD.h - e.h) / 2);
    });
    toast(dir === 'h' ? 'Centred horizontally' : dir === 'v' ? 'Centred vertically' : 'Centred on the card');
  }
  // Move the selected element within its side's stacking order: 'top' | 'bottom' | '1' (forward) | '-1' (backward).
  // Elements are drawn in list order, so this refills this side's slots in B.draft.elements; the other side keeps its order.
  function arrange(dir) {
    const e = selEl(); if (!e) return;
    const same = els(), i = same.indexOf(e), j = dir === 'top' ? same.length - 1 : dir === 'bottom' ? 0 : i + +dir;
    if (j === i || j < 0 || j >= same.length) return;
    same.splice(i, 1); same.splice(j, 0, e);
    let k = 0;
    change(() => { B.draft.elements = B.draft.elements.map(x => x.side === B.side ? same[k++] : x); });
  }
  function paintAlign() {
    const box = $('#bAlign'); if (!box) return;
    const e = selEl();
    box.innerHTML = e ? `<span class="hint" style="margin-right:2px">${esc(label(e))}:</span>
      <button class="btn sm" data-c="h" title="Centre horizontally on the card">${IC.ch}Centre horizontally</button>
      <button class="btn sm" data-c="v" title="Centre vertically on the card">${IC.cv}Centre vertically</button>
      <button class="btn sm" data-c="both" title="Centre on the card">${IC.cc}Both</button>` : '';
    $$('[data-c]', box).forEach(b => b.onclick = () => centre(b.dataset.c));
  }
  function removeSel() {
    const e = selEl(); if (!e) return;
    change(() => { B.draft.elements = B.draft.elements.filter(x => x.id !== e.id); B.sel = null; });
  }

  // ---------- overlay: move, resize, drop ----------
  function paintOverlay() {
    const ovl = $('#bOvl'); if (!ovl || !B.draft) return;
    const s = B.scale;
    ovl.innerHTML = els().map(e => `<div class="bel ${e.field === 'photo' ? 'ph' : ''} ${e.id === B.sel ? 'sel' : ''}" data-id="${esc(e.id)}" style="left:${e.x * s}px;top:${e.y * s}px;width:${e.w * s}px;height:${e.h * s}px">
      <span class="btag">${esc(label(e))}</span>${e.id === B.sel ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<i class="hd ${h}" data-h="${h}"></i>`).join('') : ''}</div>`).join('');
  }
  function bindStage() {
    const ovl = $('#bOvl'), card = $('#bCard');
    let drag = null;
    const toCard = (ev) => { const r = card.getBoundingClientRect(); return { x: (ev.clientX - r.left) / B.scale, y: (ev.clientY - r.top) / B.scale }; };
    ovl.addEventListener('pointerdown', (ev) => {
      ovl.focus({ preventScroll: true });
      const elDiv = ev.target.closest('.bel');
      if (!elDiv) { if (B.sel) { B.sel = null; paintOverlay(); paintRight(); paintAlign(); } return; }
      const e = B.draft.elements.find(x => x.id === elDiv.dataset.id); if (!e) return;
      if (B.sel !== e.id) { B.sel = e.id; paintOverlay(); paintRight(); paintAlign(); }
      const h = ev.target.dataset.h || null;
      drag = { e, h, start: toCard(ev), o: { x: e.x, y: e.y, w: e.w, h: e.h }, before: snap(), moved: false };
      ovl.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    ovl.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const p = toCard(ev); const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      drag.moved = true;
      const e = drag.e, o = drag.o, free = ev.altKey;
      let g = { v: null, h: null };
      if (!drag.h) {
        e.x = o.x + dx; e.y = o.y + dy;
        if (!free) g = snapMove(e);
      } else {
        let { x, y, w, h } = o; const H = drag.h;
        if (H.includes('e')) w = o.w + dx;
        if (H.includes('s')) h = o.h + dy;
        if (H.includes('w')) { x = o.x + dx; w = o.w - dx; }
        if (H.includes('n')) { y = o.y + dy; h = o.h - dy; }
        if (ev.shiftKey && H.length === 2) { const r = o.w / o.h; if (w / h > r) w = h * r; else h = w / r; if (H.includes('w')) x = o.x + o.w - w; if (H.includes('n')) y = o.y + o.h - h; }
        if (w < 16) { if (H.includes('w')) x -= 16 - w; w = 16; }
        if (h < 16) { if (H.includes('n')) y -= 16 - h; h = 16; }
        Object.assign(e, { x, y, w, h });
        if (!free) g = snapResize(e, H);
      }
      e.x = Math.round(e.x); e.y = Math.round(e.y); e.w = Math.round(e.w); e.h = Math.round(e.h);
      showGuides(g);
      const d = ovl.querySelector(`[data-id="${e.id}"]`);
      if (d) Object.assign(d.style, { left: `${e.x * B.scale}px`, top: `${e.y * B.scale}px`, width: `${e.w * B.scale}px`, height: `${e.h * B.scale}px` });
      render();
    });
    const finish = () => {
      if (!drag) return;
      const d = drag; drag = null; showGuides({});
      if (d.moved) { clamp(d.e); if (d.before !== snap()) { B.undo.push(d.before); B.redo = []; } refresh(); }
    };
    ovl.addEventListener('pointerup', finish); ovl.addEventListener('pointercancel', finish);
    card.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.types].includes('text/x-idcard-field')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    card.addEventListener('drop', (ev) => {
      const f = ev.dataTransfer.getData('text/x-idcard-field'); if (!f) return;
      ev.preventDefault(); card.classList.remove('dropping');
      if (B.side === 'back' && !B.draft.back.enabled) { toast('Turn on "Print a back" first', 'err'); return; }
      const p = toCard(ev); place(f, p.x, p.y);
    });
  }
  // Snap a moving box's edges and centre to the card centre/edges/safe margin and other fields.
  function targets(skip) {
    const xs = [0, 20, CARD.w / 2, CARD.w - 20, CARD.w], ys = [0, 20, CARD.h / 2, CARD.h - 20, CARD.h];
    for (const o of els()) if (o.id !== skip) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
    return { xs, ys };
  }
  function best(vals, cands) {
    let b = null;
    for (const [k, v] of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= SNAP / Math.max(B.scale, 0.3) * 0.6 && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, at: c, k }; }
    return b;
  }
  function snapMove(e) {
    const t = targets(e.id);
    const bx = best([['l', e.x], ['c', e.x + e.w / 2], ['r', e.x + e.w]], t.xs);
    const by = best([['t', e.y], ['m', e.y + e.h / 2], ['b', e.y + e.h]], t.ys);
    if (bx) e.x += bx.d; if (by) e.y += by.d;
    return { v: bx && bx.at, h: by && by.at };
  }
  function snapResize(e, H) {
    const t = targets(e.id); const g = { v: null, h: null };
    if (H.includes('e')) { const b = best([['r', e.x + e.w]], t.xs); if (b) { e.w += b.d; g.v = b.at; } }
    if (H.includes('w')) { const b = best([['l', e.x]], t.xs); if (b) { e.x += b.d; e.w -= b.d; g.v = b.at; } }
    if (H.includes('s')) { const b = best([['b', e.y + e.h]], t.ys); if (b) { e.h += b.d; g.h = b.at; } }
    if (H.includes('n')) { const b = best([['t', e.y]], t.ys); if (b) { e.y += b.d; e.h -= b.d; g.h = b.at; } }
    return g;
  }
  function showGuides(g) {
    const gv = $('#bCard .gv'), gh = $('#bCard .gh'); if (!gv) return;
    gv.hidden = g.v == null; gh.hidden = g.h == null;
    if (g.v != null) gv.style.left = `${g.v * B.scale}px`;
    if (g.h != null) gh.style.top = `${g.h * B.scale}px`;
  }
  function onKey(ev) {
    if (!B.el || !document.body.contains(B.el)) return;
    if ($('.modal')) return;
    const t = ev.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty()) save(); return; }
    if (typing) return;
    if (mod && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
    if (mod && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); return; }
    const e = selEl(); if (!e) return;
    if (mod && (ev.code === 'BracketRight' || ev.code === 'BracketLeft')) { ev.preventDefault(); arrange(ev.code === 'BracketRight' ? (ev.shiftKey ? 'top' : '1') : (ev.shiftKey ? 'bottom' : '-1')); return; }   // code: with Shift the key reads } / {
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSel(); return; }
    if (ev.key === 'Escape') { B.sel = null; refresh(); return; }
    const step = ev.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (mv) { ev.preventDefault(); change(() => { e.x += mv[0]; e.y += mv[1]; clamp(e); }); }
  }

  function guard(fn) {
    if (!dirty()) return fn();
    modal({ title: 'Discard unsaved changes?', text: `Your changes to the "${B.draft.name}" template have not been saved.`,
      actions: [{ label: 'Keep editing' }, { label: 'Save', onClick: async () => { await save(); if (!dirty()) fn(); } }, { label: 'Discard changes', kind: 'danger', onClick: () => { B.draft = null; B.id = null; fn(); } }] });
  }
  function onDesigns() { if (B.id && !dirty() && B.el && document.body.contains(B.el)) { const d = S.designs.find(x => x.id === B.id); if (d) { B.draft = clone(d); B.draft.fields = B.draft.fields || []; B.saved = snap(); refresh(); } } }

  return { mount, unmount, guard, isDirty: dirty, onDesigns, current: () => B.id };
}
