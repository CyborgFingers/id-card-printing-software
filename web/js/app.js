import { makeProofSheet } from './proof.js';
import { createAdmin } from './admin.js';
import { drawCard, cardDataUrl, loadImage, assetUrl, photoGeometry, photoBox, photoSpec, PERSON_FIELDS, designFields, setCustomFields, customFields, fieldInfo, formatDate, cardLabel, openImage, photoFormat, PHOTO_ACCEPT, PHOTO_FORMATS, showsAsIs, shrinkInto, photoIssues, PHOTO_ISSUES, setLineUpFaces } from './render.js';
import { enhancePixels, photoCheck } from './enhance.js';
import { findFace } from './face.js';
import { createBuilder } from './builder.js';
import { LICENSE_TEXT, LICENSE_VERSION, SUPPORTED_PRINTERS_TEXT } from './legal.js';
import { readPeople, buildPhotoIndex, matchPhoto, photosByName, planUpdate } from './csv.js';
import { createHelp } from './helpview.js';
// (people import uses these)

// ======================================================================
// State, API and small helpers
// ======================================================================
const S = { config: {}, designs: [], clients: [], queue: { batches: [] }, printer: null, worker: {}, version: '', platform: '', dbFile: '', security: {}, simulator: false, user: null, connected: false, update: null };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n, w) => `${n} ${n === 1 ? w : ({ person: 'people' }[w] || w + 's')}`;
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const isAdmin = () => (S.user?.role || 'admin') === 'admin';   // operators manage people and print; administrators do everything
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

async function api(method, url, body, raw) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (raw) { opt.body = body; opt.headers['Content-Type'] = raw; }
    else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  }
  let r;
  try { r = await fetch(url, opt); } catch (e) { throw new Error('Cannot reach the print service.'); }
  if (r.status === 401 && !url.startsWith('/api/auth/')) { showLogin('Your session has ended. Sign in again to continue.'); throw new Error('Please sign in.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

const ICON = {
  card: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="9" r="2.6"/><path d="M8 17c.8-2 2.2-3 4-3s3.2 1 4 3"/></svg>',
  stack: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="12" height="16" rx="2"/><path d="M5 6v13a2 2 0 0 0 2 2h9"/><path d="M10 8h6M10 12h6"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  design: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  clients: '<svg viewBox="0 0 24 24"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21v-6h6v6"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>',
  template: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.6 1.7-1.6H16a5 5 0 0 0 5-5c0-4-4-7.3-9-7.3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/></svg>',
  wand: '<svg viewBox="0 0 24 24"><path d="M4 20l10-10"/><path d="M15 3v4M13 5h4M19 9v3M17.5 10.5h3M8 4v2M7 5h2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
};

// ---------- print sides ----------
const SIDES = { both: 'Dual-sided', front: 'Front only', back: 'Back only' };
const SIDES_HINT = { both: 'Front and back on the same card in one pass (needs a flipper module).', front: 'Prints the fronts. Afterwards, flip the cards and use "Print backs" on the batch in the queue.', back: 'Prints only the back. Load cards already printed on the front, flipped over.' };
function sidesSeg(id, value, hasBack) {
  return `<div class="seg" id="${id}" role="radiogroup" aria-label="Sides to print">${Object.entries(SIDES).map(([k, l]) => `<button type="button" role="radio" data-s="${k}" aria-checked="${value === k}" class="${value === k ? 'on' : ''}" ${!hasBack && k !== 'front' ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
}
function bindSeg(id, onPick) { $$(`#${id} [data-s]`).forEach(b => b.onclick = () => { $$(`#${id} [data-s]`).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); onPick(b.dataset.s); }); }
const dualCards = () => (S.config.cardSides || 'dual') === 'dual';
const defaultSides = () => !dualCards() ? 'front' : S.config.backMethod === 'manual' ? 'front' : 'both';
const printsBack = (d) => !!(d && d.back && d.back.enabled && dualCards());
const reported = (k) => !!(S.printer && S.printer.supplies && S.printer.supplies[k] && S.printer.supplies[k].percent !== null);   // ribbon / film levels this printer gives
const noFlipper = () => !!(S.printer && S.printer.supplies && S.printer.supplies.modules.flipper === false);

// ---------- supply meters (ribbon / film from the FARGO driver) ----------
function meterHtml(label, s, low, big) {
  if (!s || s.percent === null || s.percent === undefined) return '';
  const cls = s.percent <= 0 ? 'out' : s.percent <= low ? 'low' : '';
  const est = s.estimate ? `About ${s.estimate.cardsLeft.toLocaleString()} cards left` : '';
  return `<div class="meter ${cls} ${big ? 'big' : ''}"><span>${label}${big && s.part ? ` <span class="muted" style="font-weight:600">· part ${esc(s.part)}</span>` : ''}</span><b>${s.percent}%</b><span class="track"><i style="width:${Math.max(0, Math.min(100, s.percent))}%"></i></span>${est ? `<span class="est">${est}</span>` : ''}</div>`;
}
function suppliesHtml(big) {
  const sup = S.printer && S.printer.supplies; if (!sup) return '';
  return meterHtml('Ribbon', sup.ribbon, S.config.ribbonLowPercent ?? 10, big) + meterHtml('HDP film', sup.film, S.config.filmLowPercent ?? 10, big);
}

// ---------- toasts, modals, drawer ----------
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3800);
}
function modal({ title, text, body = '', actions = [], wide = false, onMount }) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const m = document.createElement('div'); m.className = `modal ${wide ? 'wide' : ''}`; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="modal-h"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}</div>${body ? `<div class="modal-b">${body}</div>` : '<div style="height:8px"></div>'}<div class="modal-f"></div>`;
  const close = () => { scrim.remove(); m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !m.dataset.locked) close(); };
  for (const a of actions) {
    const b = document.createElement('button'); b.className = `btn ${a.kind || ''}`; b.textContent = a.label; if (a.id) b.id = a.id;
    b.onclick = async () => {
      if (a.onClick) { b.disabled = true; let r; try { r = await a.onClick(m, close); } finally { b.disabled = false; } if (r === false) return; }   // no double submits
      close();
    };
    $('.modal-f', m).append(b);
  }
  scrim.onclick = () => { if (!m.dataset.locked) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, m);
  if (onMount) onMount(m, close);
  ($('.modal-f .btn.primary', m) || $('.modal-f .btn', m))?.focus();
  return { el: m, close };
}
const confirmBox = (title, text, label = 'Confirm', kind = 'primary') => new Promise(res => modal({ title, text, actions: [{ label: 'Cancel', onClick: () => res(false) }, { label, kind, onClick: () => res(true) }] }));

// ======================================================================
// Shell: nav, printer widget, banner, "now printing" strip
// ======================================================================
const VIEWS = {};
let current = null;
function parts() { return (location.hash.replace(/^#\/?/, '') || 'clients').split('?')[0].split('/').map(decodeURIComponent); }
function route() { return parts()[0]; }
function navigate() {
  if (!S.user) return;
  const p = parts();
  let r = p[0] === 'clients' && p[1] ? 'client' : p[0] === 'templates' && p[1] ? 'template' : VIEWS[p[0]] ? p[0] : 'clients';
  if (!isAdmin() && ['templates', 'template'].includes(r)) r = 'clients';
  if (current && current.leave) current.leave();
  current = VIEWS[r];
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === ({ client: 'clients', template: 'templates' }[r] || r)));
  const val = v => typeof v === 'function' ? v() : (v || '');
  $('#title').textContent = val(current.title); $('#subtitle').textContent = val(current.subtitle);
  $('#topActions').innerHTML = '';
  const page = $('#page'); page.innerHTML = '';
  $('#scroll').scrollTop = 0;
  current.mount(page, $('#topActions'));
}

function activeCounts() {
  let waiting = 0, review = 0;
  for (const b of S.queue.batches) for (const i of b.items) {
    if (['queued', 'sending', 'printing', 'attention'].includes(i.status)) waiting++;
    if (['interrupted', 'failed'].includes(i.status)) review++;
  }
  return { waiting, review };
}

function renderShell() {
  const { waiting, review } = activeCounts();
  const badge = $('#qBadge'); badge.hidden = !(waiting + review); badge.textContent = waiting + review;
  badge.style.background = review ? 'var(--err)' : '';
  // printer widget
  const p = S.printer;
  const st = !S.connected ? 'error' : !p ? '' : p.state === 'ok' ? (p.busy ? 'busy' : 'ok') : p.state;
  $('#pDot').className = `dot ${st}`;
  $('#pLabel').textContent = !S.connected ? 'Service not running' : p ? p.label : 'Checking…';
  $('#pName').textContent = S.config.simulate ? 'Simulator (no printer)' : (S.config.printerName || 'No printer selected');
  const supEl = $('#pSup'); const supHtml = S.connected ? suppliesHtml(false) : '';
  supEl.hidden = !supHtml; if (supHtml && supEl.innerHTML !== supHtml) supEl.innerHTML = supHtml;
  // banner: the most important printer problem, on every page
  if (S.user) $('#uName').textContent = S.user.username;
  $('.nav a[data-r="templates"]').hidden = !isAdmin();
  const ban = $('#banner');
  const a = !S.connected ? { level: 'error', title: 'Lost connection to the print service', detail: 'The queue is saved and continues when the program is opened again.' }
    : p && (p.alerts.find(x => x.level === 'error') || p.alerts.find(x => x.level === 'warning'));
  if (a) {
    ban.hidden = false; ban.className = `banner ${a.level}`;
    const extra = p && p.alerts.length > 1 ? ` (+${p.alerts.length - 1} more)` : '';
    ban.innerHTML = `<span class="ic" style="color:${a.level === 'error' ? 'var(--err)' : 'var(--amber)'}">${ICON.warn}</span><div><b>${esc(a.title)}${esc(extra)}</b><span>${esc(a.detail)}</span></div>
      <div class="actions">${a.code === 'not-selected' ? '<a class="btn sm" href="#/settings">Choose printer</a>' : ''}${S.connected ? '<button class="btn sm" data-act="printer">Printer details</button>' : ''}</div>`;
  } else ban.hidden = true;
  renderUpdate();
  renderNow();
}

// ---------- update available (administrators only) ----------
function renderUpdate() {
  const el = $('#update'); const u = S.update;
  const show = isAdmin() && u && (u.available || u.installing);
  el.hidden = !show; if (!show) return;
  const page = /^https:\/\//.test(u.page || '') ? u.page : '';
  el.innerHTML = u.installing
    ? `<div class="spinner"></div><div><b>Installing the update.</b><span>The program will close and reopen by itself.</span></div>`
    : `<span class="ic">${ICON.download}</span><div><b>Version ${esc(u.latest)} is available</b>${page ? `<a href="${esc(page)}" target="_blank" rel="noopener">What's new</a>` : ''}</div><div class="actions"><button class="btn sm primary" id="updNow">Update now</button></div>`;
  const b = $('#updNow'); if (b) b.onclick = () => installUpdate(b);
}
async function installUpdate(btn) {
  btn.disabled = true; btn.textContent = 'Starting…';
  try { await api('POST', '/api/update/install'); S.update = { ...S.update, installing: true }; }
  catch (e) { toast(e.message, 'err'); }
  renderUpdate();
  if (route() === 'settings') navigate();   // the Settings result line follows the banner
}

function renderNow() {
  const el = $('#now'); const w = S.worker || {};
  const { waiting } = activeCounts();
  const active = ['printing', 'attention', 'waiting'].includes(w.phase) && (w.current || waiting);
  const paused = S.queue.paused && waiting;
  if (!active && !paused) { el.hidden = true; document.body.classList.remove('has-now'); return; }
  el.hidden = false; document.body.classList.add('has-now');
  el.className = `now ${w.phase === 'attention' || w.phase === 'waiting' ? 'attention' : ''}`;
  let pct = 0, meta = '';
  const b = w.current && S.queue.batches.find(x => x.id === w.current.batchId);
  if (b) {
    const c = b.counts || {}; const done = (c.printed || 0);
    pct = Math.round((done / Math.max(1, c.total)) * 100);
    meta = `${esc(b.name)} · ${done} of ${c.total} printed${waiting > 1 ? ` · ${waiting} cards in queue` : ''}`;
  } else meta = `${plural(waiting, 'card')} waiting in the queue`;
  const msg = paused && !active ? `Queue paused: ${plural(waiting, 'card')} waiting` : (w.message || 'Working…');
  const icon = paused && !active ? `<div class="nowic">${ICON.pause}</div>` : (w.phase === 'attention' || w.phase === 'waiting') ? `<div class="nowic warn">${ICON.warn}</div>` : '<div class="spinner"></div>';
  el.innerHTML = `${icon}
    <div style="min-width:0"><div class="msg">${esc(msg)}</div><div class="meta">${meta}</div>${b ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="row">${paused ? `<button class="btn sm" data-act="resume">${ICON.play}Resume</button>` : `<button class="btn sm" data-act="pause">${ICON.pause}Pause</button>`}<a class="btn sm" href="#/queue">Open queue</a></div>`;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (t.tagName === 'A') e.preventDefault();
  if (act === 'licence') return showLicence();
  if (act === 'printers') return showTextDoc('Supported printers', SUPPORTED_PRINTERS_TEXT);
  if (act === 'notices') return showNotices();
  try {
    if (act === 'printer') openPrinterDrawer();
    if (act === 'pause') { await api('POST', '/api/queue/pause'); toast('Queue will pause after the current card'); }
    if (act === 'resume') { await api('POST', '/api/queue/resume'); toast('Printing resumed'); }
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- printer drawer ----------
let drawerOpen = null;
async function openPrinterDrawer() {
  if (drawerOpen) return;
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const d = document.createElement('aside'); d.className = 'drawer';
  const close = () => { scrim.remove(); d.remove(); drawerOpen = null; };
  scrim.onclick = close;
  document.body.append(scrim, d);
  drawerOpen = { el: d, refresh: () => paint() };
  let events = [];
  try { events = await api('GET', '/api/printer/events'); } catch (e) {}
  function paint() {
    const p = S.printer || { alerts: [], jobs: [] };
    const sim = S.config.simulate;
    d.innerHTML = `<div class="drawer-h"><span class="dot ${p.state === 'ok' ? (p.busy ? 'busy' : 'ok') : p.state}"></span><h2>${esc(p.label || 'Printer')}</h2><span class="sp"></span><button class="btn ghost sm" id="dClose" aria-label="Close">${ICON.x}</button></div>
    <div class="drawer-b">
      <dl class="kv"><dt>Printer</dt><dd>${esc(sim ? 'Simulator (no printer connected)' : S.config.printerName || 'Not selected')}</dd>
        <dt>Driver</dt><dd>${esc(p.driver || '—')}</dd><dt>Port</dt><dd>${esc(p.port || '—')}</dd>
        <dt>Last checked</dt><dd class="num">${p.ts ? new Date(p.ts).toLocaleTimeString() : '—'}</dd></dl>
      ${p.supplies ? `<div class="stack"><div class="sec-label">Supplies</div><div class="meters">${suppliesHtml(true) || '<div class="hint">The driver has not reported ribbon or film levels yet.</div>'}</div>
        <dl class="kv">${p.supplies.cardCount != null ? `<dt>Card counter</dt><dd class="num">${p.supplies.cardCount.toLocaleString()} cards printed</dd>` : ''}
          <dt>Dual-sided</dt><dd>${p.supplies.modules.flipper === true ? 'Flipper fitted' : p.supplies.modules.flipper === false ? '<span style="color:var(--amber-ink)">No flipper module reported</span>' : 'Unknown'}</dd>
          <dt>FARGO codes</dt><dd class="num">Status ${p.supplies.codes.status ?? '—'} · Printer error ${p.supplies.codes.printerError ?? '—'} · Device error ${p.supplies.codes.deviceError ?? '—'}</dd></dl></div>` : ''}
      <div class="stack sm">${p.alerts.length ? p.alerts.map(a => `<div class="alert ${a.level}"><span style="color:${a.level === 'error' ? 'var(--err)' : 'var(--amber)'};width:20px;flex:none">${ICON.warn}</span><div><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div></div>`).join('')
        : `<div class="alert ok"><span style="color:var(--ok);width:20px;flex:none">${ICON.check.replace('<svg', '<svg fill="none" stroke="currentColor" stroke-width="2.5"')}</span><div><b>${p.busy ? 'Printing' : 'Ready to print'}</b><span>No ribbon, card or connection problems reported.</span></div></div>`}</div>
      <div class="stack"><div class="sec-label">Jobs in the Windows queue</div>
        ${p.jobs.length ? `<div class="evlog">${p.jobs.map(j => `<div><time>#${j.id}</time><span><b>${esc(j.document)}</b> · ${esc(j.status || 'Queued')}</span></div>`).join('')}</div>` : '<div class="hint">No jobs waiting in Windows.</div>'}</div>
      ${sim ? `<div class="card" style="box-shadow:none"><div class="card-b stack"><div class="sec-label">Simulator</div><label class="f">Simulate a printer condition<select class="input" id="simCond">
        ${[['', 'Normal'], ['ribbon-low', 'Ribbon low'], ['ribbon-out', 'Ribbon out'], ['cards-out', 'Out of cards'], ['jam', 'Card jam'], ['door', 'Cover open'], ['offline', 'Printer offline / USB unplugged'], ['attention', 'Needs attention']].map(([v, l]) => `<option value="${v}" ${S.simCond === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div></div>` : ''}
      <div class="stack"><div class="sec-label">Recent printer events</div>
        ${events.length ? `<div class="evlog">${events.slice(0, 40).map(ev => `<div><time>${fmtDateTime(ev.ts)}</time><span>${ev.type === 'cleared' ? `<span class="muted">Cleared:</span> ${esc(ev.code)}` : `<b style="color:${ev.level === 'error' ? 'var(--err)' : 'var(--amber-ink)'}">${esc(ev.title)}</b>`}</span></div>`).join('')}</div>` : '<div class="hint">No alerts recorded yet.</div>'}</div>
      <div class="row">${!sim ? '<button class="btn" id="dPrefs">Printing preferences</button><button class="btn" id="dQueue">Windows print queue</button>' : ''}<a class="btn" href="#/settings" id="dSet">Printer settings</a></div>

    </div>`;
    $('#dClose', d).onclick = close; $('#dSet', d).onclick = close;
    $('#dPrefs', d) && ($('#dPrefs', d).onclick = () => api('POST', '/api/printer/preferences').then(() => toast('Opening printing preferences on this PC')));
    $('#dQueue', d) && ($('#dQueue', d).onclick = () => api('POST', '/api/printer/queue').then(() => toast('Opening the Windows print queue')));
    $('#simCond', d) && ($('#simCond', d).onchange = (e) => { S.simCond = e.target.value; api('POST', '/api/printer/simulate', { condition: e.target.value }); });
  }
  paint();
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
}

// ---------- alerts: desktop notification + sound ----------
let lastErrKey = ''; let lastPhase = '';
const nativeNotices = () => S.platform === 'win32' && S.config.notifications;   // the Windows program's tray icon shows them, with their own sound
function beep(kind) {
  if (!S.config.sound || nativeNotices()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'done' ? [660, 880] : [880, 660, 880];
    notes.forEach((f, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.0001, ctx.currentTime + i * .18); g.gain.exponentialRampToValueAtTime(.18, ctx.currentTime + i * .18 + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + i * .18 + .16); o.start(ctx.currentTime + i * .18); o.stop(ctx.currentTime + i * .18 + .18); });
  } catch (e) {}
}
function notify(title, body) {
  if (!S.config.notifications || S.platform === 'win32' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') { try { new Notification(title, { body, icon: '/img/mark.png', tag: 'idcard' }); } catch (e) {} }
}
function checkAlerts() {
  const errs = (S.printer?.alerts || []).filter(a => a.level === 'error').map(a => a.code).sort().join(',');
  if (errs && errs !== lastErrKey) { const a = S.printer.alerts.find(x => x.level === 'error'); notify(`Printer: ${a.title}`, a.detail); beep('alert'); }
  lastErrKey = errs;
  const ph = S.worker?.phase;
  if (lastPhase && lastPhase !== 'idle' && ph === 'idle' && /All cards printed/.test(S.worker.message || '')) { notify('Printing complete', 'All cards in the queue have been printed.'); beep('done'); toast('All cards printed', 'ok'); }
  lastPhase = ph;
}

// ---------- live connection ----------
let es = null;
function connect() {
  if (es) es.close();
  es = new EventSource('/api/events');
  es.onopen = async () => {
    if (!S.connected) { S.connected = true; await loadState(false); }
  };
  es.onerror = async () => {
    S.connected = false; renderShell();
    // Find out whether the service is down or the session ended.
    try { const r = await fetch('/api/auth/me'); if (r.status === 401) { es.close(); showLogin('Your session has ended. Sign in again to continue.'); } } catch (e) {}
  };
  es.addEventListener('printer', e => { S.printer = JSON.parse(e.data); renderShell(); checkAlerts(); drawerOpen?.refresh(); current?.onPrinter?.(); });
  es.addEventListener('worker', e => { S.worker = JSON.parse(e.data); renderShell(); checkAlerts(); current?.onQueue?.(); });
  es.addEventListener('queue', e => { S.queue = JSON.parse(e.data); renderShell(); current?.onQueue?.(); });
  es.addEventListener('config', e => { S.config = JSON.parse(e.data); setCustomFields(S.config.customFields); setLineUpFaces(S.config.alignFaces); applyBranding(brandingFromConfig(S.config)); renderShell(); current?.onConfig?.(); });
  es.addEventListener('designs', e => { S.designs = JSON.parse(e.data); current?.onDesigns?.(); });
  es.addEventListener('clients', e => { S.clients = JSON.parse(e.data); current?.onClients?.(); });
  es.addEventListener('update', e => { S.update = JSON.parse(e.data); renderUpdate(); });
}
async function loadState(remount = true) {
  const st = await api('GET', '/api/state');
  setCustomFields(st.config.customFields); setLineUpFaces(st.config.alignFaces);
  Object.assign(S, { config: st.config, designs: st.designs, clients: st.clients, queue: st.queue, printer: st.printer, worker: st.worker, version: st.version, platform: st.platform, dbFile: st.dbFile, security: st.security, simulator: !!st.simulator, user: st.user, license: st.license, update: st.update || null });
  applyBranding(st.branding);
  $('#ver').textContent = st.version;
  renderShell();
  if (remount) navigate(); else { current?.onQueue?.(); current?.onPrinter?.(); }
}


// Shared: queue a set of rendered cards as one batch.
// Printed by Settings > Print a test card when there are no templates yet: an outline and a label.
const TEST_CARD = { id: null, name: 'Test card', card: { w: 638, h: 1013, size: 'CR80', mmW: 53.98, mmH: 85.6 }, front: { background: null, bgColor: '#ffffff' }, back: { enabled: false, background: null, bgColor: '#ffffff' },
  elements: [
    { id: 'tc1', field: 'box', side: 'front', x: 24, y: 24, w: 590, h: 965, noFill: true, fill: '#00529F', radius: 28, borderWidth: 6, borderColor: '#00529F' },
    { id: 'tc2', field: 'text', side: 'front', x: 44, y: 430, w: 550, h: 90, text: 'Test card', font: 'Fira Sans', weight: 700, size: 76, minSize: 20, color: '#00529F', align: 'center', valign: 'middle', uppercase: true, letterSpacing: 2, lineHeight: 1.15, rotate: 0 },
    { id: 'tc3', field: 'text', side: 'front', x: 44, y: 530, w: 550, h: 50, text: 'ID Card Printing Software Free', font: 'Fira Sans', weight: 500, size: 30, minSize: 12, color: '#1F4D78', align: 'center', valign: 'middle', uppercase: false, letterSpacing: 0, lineHeight: 1.15, rotate: 0 }] };
async function queueCards({ name, source, client, design, people, onProgress, isCancelled, sides }) {
  const hasBack = printsBack(design);
  const b = await api('POST', '/api/queue/batches', { name, source, clientId: client ? client.id : null, designId: design.id, designName: design.name, hasBack, sides: sides || defaultSides(), expected: people.length });
  // The back is the same for everyone unless it shows personal fields.
  const backPersonal = hasBack && (design.elements || []).some(e => e.side === 'back' && e.field !== 'text');
  const scale = S.printer && S.printer.dpi >= 600 ? 2 : 1;   // 600 dpi printers get 600 dpi cards
  const sharedBack = hasBack && !backPersonal ? await cardDataUrl(design, 'back', {}, undefined, scale) : null;
  let n = 0;
  try {
    for (const p of people) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      const img = p.img || (p.url ? await loadImage(p.url) : null);
      const data = { ...p, photo: img, adj: p.adj };
      const errors = [];
      const front = await cardDataUrl(design, 'front', data, errors, scale);
      const back = hasBack ? (sharedBack || await cardDataUrl(design, 'back', data, errors, scale)) : null;
      if (errors.length) throw new Error(`${`${p.firstName} ${p.lastName}`.trim()}: the barcode can't be made from their details (${errors[0]}). Change their details or the barcode type, then print again.`);
      await api('POST', `/api/queue/batches/${b.id}/cards`, { personId: p.personId || null, firstName: p.firstName, lastName: p.lastName, front, back });
      n++; onProgress && onProgress(n, people.length, p);
    }
  } catch (e) {
    await api('DELETE', `/api/queue/batches/${b.id}`).catch(() => {});
    throw e;
  }
  await api('POST', `/api/queue/batches/${b.id}/ready`);
  return b.id;
}

// Photo adjuster used by single print and the bulk row editor.
// Drag the photo inside its box on a preview canvas; wheel to zoom.
function enablePhotoPan(canvas, getState, onChange) {
  let drag = null;
  canvas.classList.add('drag');
  canvas.addEventListener('pointerdown', e => {
    const st = getState(); if (!st.img) return;
    drag = { x: e.clientX, y: e.clientY, ox: st.adj.ox || 0, oy: st.adj.oy || 0 }; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; const st = getState(); const box = photoBox(st.design); if (!box) return;
    const k = st.design.card.w / canvas.getBoundingClientRect().width;
    const g = photoGeometry(st.img, box, st.adj);
    // The move is on top of where Line up faces put the photo (fx, fy), so it can reach each edge of the frame.
    st.adj.ox = Math.max((-g.maxX - g.fx) / box.w, Math.min((g.maxX - g.fx) / box.w, drag.ox + (e.clientX - drag.x) * k / box.w));
    st.adj.oy = Math.max((-g.maxY - g.fy) / box.h, Math.min((g.maxY - g.fy) / box.h, drag.oy + (e.clientY - drag.y) * k / box.h));
    onChange();
  });
  canvas.addEventListener('pointerup', () => drag = null);
  canvas.addEventListener('wheel', e => { const st = getState(); const box = photoBox(st.design); if (!st.img || !box) return; e.preventDefault(); const { minZoom } = photoGeometry(st.img, box, st.adj); st.adj.zoom = Math.max(minZoom, Math.min(4, (st.adj.zoom || 1) * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); onChange(true); }, { passive: false });
}

// ======================================================================
// Clients
// ======================================================================
const clientById = (id) => S.clients.find(c => c.id === id);
const clientDesigns = (cid) => { const ids = clientById(cid)?.templateIds || []; return S.designs.filter(d => ids.includes(d.id)); };
const clientDefaultDesign = (c) => (c && (clientDesigns(c.id).find(d => d.id === c.defaultDesignId) || clientDesigns(c.id)[0])) || null;
// The ID photo size a template's photo frame expects: "360 × 480 px · 30.5 × 40.6 mm · 3:4 portrait", or '' without a frame.
const photoSpecLine = (d) => { const s = d && photoSpec(d); return s ? `${s.w} × ${s.h} px · ${s.mmW} × ${s.mmH} mm · ${s.shape ? `${s.shape} ` : ''}${s.orientation}` : ''; };   // breaks only before a "· " part
// The person details a client needs: every field used by any of its templates.
const clientFields = (c) => { const ds = clientDesigns(c.id); if (!ds.length) return [...PERSON_FIELDS, ...customFields()];   // no template yet: every detail
  const f = new Set(['firstName', 'lastName']); for (const d of ds) designFields(d).forEach(x => f.add(x)); return [...PERSON_FIELDS, ...customFields()].filter(x => f.has(x)); };
const fieldLabel = (f) => fieldInfo(f).label;
// A person's value for a built-in or custom field, as shown in lists (dates as DD/MM/YYYY).
const pv = (p, f) => { const v = PERSON_FIELDS.includes(f) ? p[f] : (p.extra || {})[f]; return fieldInfo(f).type === 'date' ? formatDate(v, 'DD/MM/YYYY') : (v || ''); };
// Lost or returned cards, and expiry from the field marked as the card expiry date.
const expiryKey = () => (S.config.customFields || []).find(f => f.expiry)?.key;
function cardState(p) {
  if (p.cardStatus === 'lost') return ['err', 'Lost or stolen'];
  if (p.cardStatus === 'returned') return ['', 'Returned'];
  const k = expiryKey(), v = k && (p.extra || {})[k];
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(y, m - 1, d) - today) / 864e5);   // local calendar days
  return days < 0 ? ['err', 'Expired'] : days === 0 ? ['warn', 'Expires today'] : days <= 30 ? ['warn', `Expires in ${plural(days, 'day')}`] : null;
}
const designOptionsFor = (cid, sel) => clientDesigns(cid).map(d => `<option value="${esc(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}${clientById(cid)?.defaultDesignId === d.id ? ' (default)' : ''}</option>`).join('');
const photoUrl = (p) => p.hasPhoto ? `/api/people/${p.id}/photo?v=${encodeURIComponent(p.updatedAt || '')}` : null;
const initials = (s) => String(s || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// Photos are stored inside the encrypted database, so they are resized first to keep it compact
// (1600 px on the long side is several times what the card needs at 300 dpi). `enhance`: true always enhances
// (enhance.js enhancePixels); 'needed' only when the photo is off (enhance.js photoCheck), and `enhanced` says whether
// it was. `src` is the photo as opened, to make it again with or without Enhance. `face`: where its face is, for Line up
// faces (faceOf); left unknown while that's off in Settings, for Line up faces to find later.
async function shrinkPhoto(file, enhance = false) {
  const img = await openImage(file);
  if (!img) throw new Error(`${file.name} can't be opened as a photo`);
  const r = await photoJpeg(img, enhance);
  return { ...r, name: file.name, src: img, face: S.config.alignFaces ? await faceOf(r.img) : undefined };
}
// The face in a photo (face.js), or null when none is found. When the face finder can't start, that's shown once and
// the face is left unknown (undefined, so Line up faces tries again later) rather than stopping the photo being saved.
let faceTrouble = false;
async function faceOf(pic) {
  try { return await findFace(pic); }
  catch (e) { console.error(e); if (!faceTrouble) { faceTrouble = true; toast(e.message, 'err'); } return undefined; }
}
// The report at the end of an import, bulk update or Line up faces: who couldn't be done (`failed`, each with why, under
// `failedTitle`), and which of the people done have a photo that needs checking (render.js photoIssues; not "No photo",
// which the list showed before it started), by problem. `html` is empty when all went well; `actions` adds Show them.
function runReport(failedTitle, failed, people, design) {
  const by = {}, names = (list) => esc(list.slice(0, 12).join(', ')) + (list.length > 12 ? ` and ${list.length - 12} more` : '');
  let checking = 0;
  for (const p of people) {
    const issues = photoIssues(p, design).filter(k => k !== 'noPhoto');
    if (issues.length) checking++;
    for (const k of issues) (by[k] ??= []).push(`${p.firstName} ${p.lastName}`.trim());
  }
  const html = (failed.length ? `<p class="hint"><b>${failedTitle}</b></p><ul class="hint">${failed.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '')
    + (checking ? `<p class="hint"><b>${plural(checking, 'person')} need${checking === 1 ? 's' : ''} checking</b></p><ul class="hint">${Object.entries(by).map(([k, list]) => `<li>${PHOTO_ISSUES[k]} (${list.length}): ${names(list)}</li>`).join('')}</ul>` : '');
  const actions = checking ? [{ label: 'Show who needs checking', onClick: () => { Object.assign(peopleTab.st, { show: 'check', q: '' }); peopleTab.paint(); } }] : [];
  return { html, actions };
}
// The size and quality kept with a photo saved before they were checked, from the photo itself.
function photoFacts(im) {
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  return { w: c.width, h: c.height, poor: photoCheck(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height).poor };
}
// Finds the faces in photos saved while Line up faces was off (or before the face finder could start), one person at a time.
async function lineUpFaces(c, people, design) {
  const box = progressBox(`Lining up ${plural(people.length, 'face')}`, 'Finding faces', people.length), failed = [], saved = [];
  let found = 0;
  for (let i = 0; i < people.length && !box.stopped; i++) {
    const p = people[i];
    await box.show(i, `${p.firstName} ${p.lastName}`, `${found} found`);
    try {
      const im = new Image(); im.src = photoUrl(p); await im.decode();   // not loadImage: that keeps every photo in memory
      const face = await faceOf(im);
      if (face === undefined) break;   // the face finder can't start: already shown
      saved.push(await api('PUT', `/api/people/${p.id}`, { adj: { zoom: 1, ox: 0, oy: 0, ...(p.adj || {}), face, photo: p.adj?.photo || photoFacts(im) } }));
      if (face) found++;
    } catch (e) { failed.push(`${`${p.firstName} ${p.lastName}`.trim()}: ${e.message}`); }
  }
  box.close(); await peopleTab.reload();
  if (saved.length) toast(`Found ${found} of ${plural(saved.length, 'face')}${box.stopped ? ' (stopped early)' : ''}`, found === saved.length ? 'ok' : undefined);
  const r = runReport('Not done:', failed, saved, design);
  if (r.html) modal({ title: `Lined up ${plural(saved.length, 'face')}`, body: r.html, actions: [...r.actions, { label: 'OK', kind: 'primary' }] });
}
// `photo`: what's kept with it for the problem report (render.js photoIssues): its size and whether it's still poor.
async function photoJpeg(img, enhance) {
  const c = await keptCanvas(img), { enhanced, poor } = enhanceCanvas(c, enhance), dataUrl = c.toDataURL('image/jpeg', 0.92);
  return { dataUrl, img: await loadImage(dataUrl), enhanced, photo: { w: c.width, h: c.height, poor } };
}
// The photo at the size it's kept, on white: JPEG has no transparency, so cut-out photos get white, not black.
async function keptCanvas(img) {
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (k < 1) await shrinkInto(img, c); else g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  return c;
}
// Enhances the photo when asked (as photoJpeg's `enhance`); whether it did, and whether it's still clearly poor as kept.
function enhanceCanvas(c, enhance) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), check = photoCheck(d.data, c.width, c.height);
  if (!(enhance === true || (enhance === 'needed' && check.off))) return { enhanced: false, poor: check.poor };
  enhancePixels(d.data, c.width, c.height); g.putImageData(d, 0, 0);
  return { enhanced: true, poor: photoCheck(d.data, c.width, c.height).poor };
}

VIEWS.clients = {
  title: 'Clients', subtitle: '',
  q: '',
  mount(el, top) {
    top.innerHTML = `<button class="btn primary" id="cNew">${ICON.plus}New client</button>`;
    $('#cNew').onclick = () => clientModal();
    el.innerHTML = `<div class="stack"><div class="row"><input class="input" id="cQ" placeholder="Search clients" value="${esc(this.q)}" style="max-width:360px" aria-label="Search clients"></div><div id="cGrid"></div></div>`;
    $('#cQ').oninput = e => { this.q = e.target.value; this.paint(); };
    this.paint();
  },
  paint() {
    const g = $('#cGrid'); if (!g) return;
    const q = this.q.toLowerCase().trim();
    const list = S.clients.filter(c => !q || `${c.name} ${c.contactName} ${c.contactEmail}`.toLowerCase().includes(q));
    if (!S.clients.length) {
      g.innerHTML = `<div class="card"><div class="empty">${ICON.clients}<b>No clients yet</b><div class="row"><button class="btn primary" id="cFirst">${ICON.plus}Create your first client</button></div></div></div>`;
      $('#cFirst').onclick = () => clientModal(); return;
    }
    g.innerHTML = list.length ? `<div class="cgrid">${list.map(c => `<a class="ccard card" href="#/clients/${c.id}/people">
        <div class="ccard-h"><span class="avatar">${esc(initials(c.name))}</span><div style="min-width:0"><b>${esc(c.name)}</b><span>${esc(c.contactName || c.contactEmail || 'No contact details')}</span></div></div>
        <div class="ccard-s"><div><b class="num">${c.people.toLocaleString()}</b><span>People</span></div><div><b class="num">${c.templates}</b><span>Templates</span></div><div><b class="num">${c.printed.toLocaleString()}</b><span>Cards printed</span></div></div>
        <div class="ccard-f">${c.lastPrinted ? `Last printed ${fmtDateTime(c.lastPrinted)}` : 'Nothing printed yet'}</div></a>`).join('')}</div>`
      : `<div class="card"><div class="empty"><b>No matching clients</b></div></div>`;
  },
  onClients() { if (parts()[0] === 'clients' && !parts()[1]) this.paint(); },
};

function clientModal(existing) {
  const c = existing || {};

  modal({ title: existing ? 'Edit client' : 'New client', wide: false,
    body: `<div class="stack">
      <label class="f">Client name<input class="input" id="mName" value="${esc(c.name || '')}" autocomplete="off" placeholder="Company or organisation name"></label>
      <div class="grid2"><label class="f">Contact name<input class="input" id="mContact" value="${esc(c.contactName || '')}"></label><label class="f">Phone<input class="input" id="mPhone" value="${esc(c.contactPhone || '')}"></label></div>
      <label class="f">Email<input class="input" id="mEmail" type="email" value="${esc(c.contactEmail || '')}"></label>
      <label class="f">Notes<textarea class="input" id="mNotes" rows="3">${esc(c.notes || '')}</textarea></label>
      ${existing || !S.designs.length ? '' : `<label class="f">Card template<select class="input" id="mTpl">${S.designs.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
      <label class="check bare"><input type="checkbox" id="mCopy" checked><div><b>Make a separate copy for this client</b><span>Changes to their card won't affect other clients.</span></div></label>`}</div>`,
    actions: [{ label: 'Cancel' }, { label: existing ? 'Save' : 'Create client', kind: 'primary', onClick: async (m) => {
      const body = { name: $('#mName', m).value, contactName: $('#mContact', m).value, contactPhone: $('#mPhone', m).value, contactEmail: $('#mEmail', m).value, notes: $('#mNotes', m).value };
      if (!body.name.trim()) { toast('Enter the client\'s name', 'err'); $('#mName', m).focus(); return false; }
      try {
        if (existing) { await api('PUT', `/api/clients/${existing.id}`, body); toast('Client saved', 'ok'); }
        else { if ($('#mTpl', m)) { body.templateId = $('#mTpl', m).value; body.copyTemplate = $('#mCopy', m).checked; } const r = await api('POST', '/api/clients', body); await refreshLists(); toast(`Created ${r.name}`, 'ok'); location.hash = `#/clients/${r.id}/people`; }
      } catch (e) { toast(e.message, 'err'); return false; }
    } }],
    onMount: (m) => $('#mName', m).focus() });
}
async function refreshLists() { const st = await api('GET', '/api/state'); S.clients = st.clients; S.designs = st.designs; }

// ---------------- one client ----------------
const CLIENT_TABS = [['people', 'People'], ['templates', 'Card templates'], ['history', 'Print history'], ['details', 'Details']];
VIEWS.client = {
  title: () => clientById(parts()[1])?.name || 'Client',
  subtitle: () => { const c = clientById(parts()[1]); return c ? [c.contactName, c.contactEmail, c.contactPhone].filter(Boolean).join(' · ') || 'Client' : ''; },
  mount(el, top) {
    const [, id, tab = 'people'] = parts(); const c = clientById(id);
    if (!c) { el.innerHTML = `<div class="card"><div class="empty"><b>Client not found</b><a href="#/clients">Back to clients</a></div></div>`; return; }
    el.innerHTML = `<div class="stack"><div class="row" style="justify-content:space-between"><a class="crumb" href="#/clients">${ICON.back}All clients</a>
      <div class="seg" role="tablist">${CLIENT_TABS.filter(([k]) => k !== 'templates' || isAdmin()).map(([k, l]) => `<a role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" href="#/clients/${c.id}/${k}">${l}${k === 'people' ? ` <span class="cnt num">${c.people}</span>` : ''}</a>`).join('')}</div></div><div id="ctab"></div></div>`;
    const root = $('#ctab');
    if (tab === 'people') peopleTab.mount(root, top, c);
    else if (tab === 'templates') clientTemplatesTab(root, top, c);
    else if (tab === 'history') historyPanel(root, top, { clientId: c.id });
    else detailsTab(root, top, c);
  },
  onClients() {
    const [, id, tab = 'people'] = parts(); const c = clientById(id); if (!c) return;
    if (tab === 'people' && !peopleTab.st.importing && !peopleTab.st.updating && !document.querySelector('.modal') && !document.activeElement?.closest('#pCard .toolbar')) peopleTab.reload();   // printed counts, card status
    $('#title').textContent = c.name;
    const cnt = $('.seg .cnt'); if (cnt) cnt.textContent = c.people;
  },
  onDesigns() { if (parts()[2] === 'templates' || parts()[2] === 'people' || !parts()[2]) navigate(); },
};

function detailsTab(root, top, c) {
  top.innerHTML = '';
  root.innerHTML = `<div class="settings"><div class="card"><div class="card-h"><div><h2>Client details</h2></div></div><div class="card-b stack">
      <label class="f">Client name<input class="input" id="dtName" value="${esc(c.name)}"></label>
      <div class="grid2"><label class="f">Contact name<input class="input" id="dtContact" value="${esc(c.contactName)}"></label><label class="f">Phone<input class="input" id="dtPhone" value="${esc(c.contactPhone)}"></label></div>
      <label class="f">Email<input class="input" id="dtEmail" type="email" value="${esc(c.contactEmail)}"></label>
      <label class="f">Notes<textarea class="input" id="dtNotes" rows="4">${esc(c.notes)}</textarea></label>
      <div class="row"><button class="btn primary" id="dtSave">Save details</button></div></div></div>
    <div class="stack"><div class="card"><div class="card-h"><div><h2>Summary</h2></div></div><div class="card-b"><dl class="kv"><dt>People</dt><dd class="num">${c.people.toLocaleString()}</dd><dt>Card templates</dt><dd class="num">${c.templates}</dd><dt>Cards printed</dt><dd class="num">${c.printed.toLocaleString()}</dd><dt>Last printed</dt><dd>${c.lastPrinted ? fmtDateTime(c.lastPrinted) : '—'}</dd><dt>Created</dt><dd>${fmtDateTime(c.createdAt)}</dd></dl></div></div>
    <div class="card danger-zone"><div class="card-h"><div><h2>Delete client</h2></div></div><div class="card-b"><button class="btn danger" id="dtDel">${ICON.trash}Delete ${esc(c.name)}</button></div></div></div></div>`;
  $('#dtSave').onclick = async () => {
    try { await api('PUT', `/api/clients/${c.id}`, { name: $('#dtName').value, contactName: $('#dtContact').value, contactPhone: $('#dtPhone').value, contactEmail: $('#dtEmail').value, notes: $('#dtNotes').value }); toast('Client saved', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (!isAdmin()) $('.danger-zone', root)?.remove();
  else $('#dtDel').onclick = () => modal({ title: `Delete ${c.name}?`, text: `This permanently removes ${plural(c.people, 'person')}, their photos and ${plural(c.templates, 'card template')}. Type the client's name to confirm.`,
    body: `<input class="input" id="delName" placeholder="${esc(c.name)}" autocomplete="off">`,
    actions: [{ label: 'Cancel' }, { label: 'Delete client', kind: 'danger', onClick: async (m) => {
      try { await api('DELETE', `/api/clients/${c.id}`, { confirmName: $('#delName', m).value }); toast(`${c.name} deleted`); location.hash = '#/clients'; }
      catch (e) { toast(e.message, 'err'); return false; }
    } }] });
}

// ---------------- people ----------------
const peopleTab = {
  st: { clientId: null, rows: [], q: '', show: 'all', sel: new Set(), designId: null, sides: null, importing: null, updating: null },
  async mount(root, top, c) {
    const st = this.st;
    if (st.clientId !== c.id) Object.assign(st, { clientId: c.id, rows: [], q: '', sel: new Set(), designId: null, sides: null, importing: null, updating: null });
    if (!st.designId || !clientDesigns(c.id).some(d => d.id === st.designId)) st.designId = clientDefaultDesign(c)?.id;
    if (!st.sides) st.sides = defaultSides();
    this.root = root; this.top = top; this.client = c;
    if (st.importing) return importer.mount(root, top, c);
    if (st.updating) return updater.mount(root, top, c);
    // Downloads | bulk actions | add
    top.innerHTML = `<a class="btn" href="/api/bulk-template.csv?clientId=${c.id}" download>${ICON.download}Blank CSV template</a><a class="btn" href="/api/clients/${c.id}/people.csv" download title="Everyone in this client, with all their details (photos not included)">${ICON.download}Export people</a><span class="vr"></span>
      <button class="btn" id="pImport">${ICON.upload}Import from CSV</button><button class="btn" id="pUpdate" disabled>${ICON.retry}Bulk update</button><span class="vr"></span><button class="btn primary" id="pAdd">${ICON.plus}Add person</button>`;
    $('#pAdd').onclick = () => personModal(c, null);
    $('#pImport').onclick = () => { st.importing = { people: [], files: [], types: allTypes(), csvName: '', warning: '', enhance: !!S.config.enhancePhotos }; importer.mount(root, top, c); };
    $('#pUpdate').onclick = () => { st.updating = { rows: [], csvName: '', warning: '', files: [], types: allTypes(), enhance: !!S.config.enhancePhotos, excluded: new Set(), urls: new Map(), plan: { entries: [], unusedFiles: [] } }; updater.mount(root, top, c); };
    root.innerHTML = `<div class="card" id="pCard"><div class="empty">Loading people…</div></div>`;
    try { st.rows = await api('GET', `/api/clients/${c.id}/people`); } catch (e) { toast(e.message, 'err'); return; }
    $('#pUpdate')?.removeAttribute('disabled');   // it matches against the people just loaded
    this.paint();
  },
  async reload() { try { this.st.rows = await api('GET', `/api/clients/${this.client.id}/people`); } catch (e) {} this.paint(); },
  paint() {
    const st = this.st, c = this.client, box = $('#pCard'); if (!box) return;
    if (!st.rows.length) {
      box.innerHTML = `<div class="empty">${ICON.card}<b>No people yet</b><div class="row"><button class="btn" id="pE1">${ICON.upload}Import from CSV</button><button class="btn primary" id="pE2">${ICON.plus}Add person</button></div></div>`;
      $('#pE1').onclick = () => $('#pImport').click(); $('#pE2').onclick = () => personModal(c, null); return;
    }
    const q = st.q.toLowerCase().trim();
    const cols = clientFields(c).filter(f => !['firstName', 'lastName', 'address', 'photo'].includes(f));
    const d = S.designs.find(x => x.id === st.designId); const hasBack = printsBack(d); const noTpl = !d;
    const SHOW = { all: ['All people', () => true], check: ['Needs checking', p => photoIssues(p, d).length > 0], active: ['Active cards', p => p.cardStatus === 'active'], lost: ['Lost or stolen', p => p.cardStatus === 'lost'],
      returned: ['Returned', p => p.cardStatus === 'returned'], expiring: ['Expired or expiring', p => /Expire/.test((cardState(p) || [])[1] || '')], never: ['Never printed', p => !p.printCount] };
    const shown = (SHOW[st.show] || SHOW.all)[1];
    const list = st.rows.filter(p => shown(p) && (!q || [p.firstName, p.lastName, ...cols.map(f => pv(p, f))].join(' ').toLowerCase().includes(q)));
    for (const id of [...st.sel]) if (!st.rows.some(p => p.id === id)) st.sel.delete(id);
    // Line up faces needs each photo's face: photos saved while it was off (or before the face finder could start) are found here.
    const faceFit = !!S.config.alignFaces && !!photoBox(d), unlined = faceFit ? st.rows.filter(p => p.hasPhoto && p.adj?.face === undefined) : [];
    if (!hasBack) st.sides = 'front';
    const n = st.sel.size;
    const y = $('.tbl-wrap', box)?.scrollTop;   // repainting must not jump back to the top
    box.innerHTML = `<div class="toolbar">
        <label class="f" style="flex:1 1 200px">Search<input class="input" id="pQ" placeholder="Name${cols.length ? ', ' + esc(cols.map(f => fieldLabel(f).toLowerCase()).join(', ')) : ''}" value="${esc(st.q)}"></label>
        <label class="f" style="flex:0 1 170px">Show<select class="input" id="pShow">${Object.entries(SHOW).map(([k, [l]]) => `<option value="${k}" ${st.show === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${noTpl ? '' : `<label class="f" style="flex:1 1 180px">Card template<select class="input" id="pDesign">${designOptionsFor(c.id, st.designId)}</select></label>`}
        ${hasBack ? `<div class="f" style="flex:0 0 auto"><span>Sides</span>${sidesSeg('pSides', st.sides, hasBack)}</div>` : ''}
        <span class="sp"></span>
        ${unlined.length ? `<button class="btn" id="pFaces">${ICON.image}Line up ${plural(unlined.length, 'face')}</button>` : ''}
        ${n ? `<button class="btn danger" id="pDel">${ICON.trash}Delete ${n}</button>${noTpl ? '' : `<button class="btn" id="pProof" title="A page of these cards at actual size, to print or save as PDF for the client to check">${ICON.doc}Proof sheet</button>`}` : ''}
        ${noTpl ? (isAdmin() ? `<a class="btn primary lg" href="#/clients/${c.id}/templates">${ICON.plus}Add a card template</a>` : '<span class="chip warn">No card template yet</span>')
          : `<button class="btn primary lg" id="pPrint" ${n ? '' : 'disabled'}>${ICON.print}${n ? `Print ${plural(n, 'card')}` : 'Select people to print'}</button>`}</div>
      <div class="tbl-wrap" style="max-height:64vh"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" id="pAll" aria-label="Select all" ${list.length && list.every(p => st.sel.has(p.id)) ? 'checked' : ''}></th><th>Photo</th><th>Name</th>${cols.map(f => `<th>${esc(fieldLabel(f))}</th>`).join('')}<th>Last printed</th><th>Cards</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr data-id="${p.id}" class="${st.sel.has(p.id) ? 'sel' : ''}"><td><input type="checkbox" data-sel ${st.sel.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.firstName)} ${esc(p.lastName)}"></td>
        <td>${p.hasPhoto ? `<img class="thumb" src="${photoUrl(p)}" alt="" loading="lazy">` : `<div class="thumb noph">${esc(initials(p.firstName + ' ' + p.lastName))}</div>`}</td>
        <td><div class="nm">${esc(p.firstName)} ${esc(p.lastName)}</div>${photoIssues(p, d).map(k => `<span class="chip warn">${PHOTO_ISSUES[k]}</span>`).join(' ')}${cardState(p) ? ` <span class="chip ${cardState(p)[0]}">${cardState(p)[1]}</span>` : ''}</td>
        ${cols.map(f => `<td class="muted">${esc(pv(p, f)) || '—'}</td>`).join('')}<td class="muted num">${p.lastPrintedAt ? fmtDateTime(p.lastPrintedAt) : 'Never'}</td><td class="num muted">${p.printCount || 0}</td>
        <td><div class="acts"><button class="btn sm" data-print>${ICON.print}Print</button><button class="btn sm" data-edit>${ICON.edit}Edit</button></div></td></tr>`).join('')}</tbody></table></div>
      <div class="hint tbl-foot">${plural(st.rows.length, 'person')}${q || st.show !== 'all' ? ` · ${list.length} shown` : ''}${n ? ` · ${n} selected` : ''}</div>`;
    if (y) $('.tbl-wrap', box).scrollTop = y;
    $('#pQ').oninput = e => { st.q = e.target.value; const pos = e.target.selectionStart; this.paint(); const i = $('#pQ'); i.focus(); i.setSelectionRange(pos, pos); };
    $('#pDesign') && ($('#pDesign').onchange = e => { st.designId = e.target.value; this.paint(); });
    $('#pShow').onchange = e => { st.show = e.target.value; this.paint(); };
    $('#pFaces') && ($('#pFaces').onclick = () => lineUpFaces(c, unlined, d));
    $('#pProof') && ($('#pProof').onclick = () => proofSheet(c, st.rows.filter(p => st.sel.has(p.id)), S.designs.find(x => x.id === st.designId) || clientDefaultDesign(c), st.sides));
    if ($('#pSides')) bindSeg('pSides', s => { st.sides = s; });
    $('#pAll').onchange = e => { list.forEach(p => e.target.checked ? st.sel.add(p.id) : st.sel.delete(p.id)); this.paint(); };
    $$('tbody tr', box).forEach(tr => {
      const p = st.rows.find(x => x.id === tr.dataset.id);
      $('[data-sel]', tr).onchange = e => { e.target.checked ? st.sel.add(p.id) : st.sel.delete(p.id); this.paint(); };
      $('[data-edit]', tr).onclick = () => personModal(c, p);
      $('[data-print]', tr).onclick = () => printPeople(c, [p], { designId: st.designId, sides: st.sides });
      if (noTpl) $('[data-print]', tr).remove();
    });
    $('#pPrint') && ($('#pPrint').onclick = () => printPeople(c, st.rows.filter(p => st.sel.has(p.id)), { designId: st.designId, sides: st.sides }));
    $('#pDel') && ($('#pDel').onclick = async () => {
      if (!(await confirmBox(`Delete ${plural(n, 'person')}?`, 'Their details and photos are removed.', 'Delete', 'danger'))) return;
      try { await api('POST', '/api/people/delete', { ids: [...st.sel] }); st.sel.clear(); toast('Deleted'); this.reload(); } catch (e) { toast(e.message, 'err'); }
    });
  },
};

const proofSheet = (client, people, design, sides) => makeProofSheet({ client, people, design, sides, photoUrl }).catch(e => toast(e.message, 'err'));
// Input for a custom person field: a date picker for dates; card numbers fill themselves in when left empty.
function customInput(f, value) {
  const t = fieldInfo(f).type;
  return `<label class="f">${esc(fieldLabel(f))}<input class="input" data-cf="${f}" ${t === 'date' ? 'type="date"' : ''} value="${esc(value || '')}" ${t === 'auto' ? 'placeholder="Next number, when saved"' : ''} autocomplete="off"></label>`;
}
// Add / edit one person with a live card preview.
function personModal(c, p) {
  const tab = peopleTab.st;
  const fields = clientFields(c).filter(f => !['firstName', 'lastName'].includes(f));
  const st = { firstName: p?.firstName || '', lastName: p?.lastName || '', staffId: p?.staffId || '', position: p?.position || '', title: p?.title || '', address: p?.address || '', notes: p?.notes || '', adj: { zoom: 1, ox: 0, oy: 0, ...(p?.adj || {}) }, extra: { ...(p?.extra || {}) },
    img: null, photoData: undefined, photoName: p?.photoName || '', hasPhoto: !!p?.hasPhoto,
    src: null, fresh: false, enhance: false };   // src: the photo before Enhance; fresh: chosen now, not the saved one
  const d = S.designs.find(x => x.id === tab.designId) || clientDefaultDesign(c);
  const m = modal({ title: p ? `${p.firstName} ${p.lastName}`.trim() || 'Edit person' : 'Add person', wide: true,
    body: `<div class="pm"><div class="stack">
      <div class="grid2"><label class="f">First name<input class="input" id="eFirst" value="${esc(st.firstName)}" autocomplete="off"></label><label class="f">Last name<input class="input" id="eLast" value="${esc(st.lastName)}" autocomplete="off"></label></div>
      ${fields.length ? `<div class="grid2">${fields.map(f => f === 'address' ? `<label class="f" style="grid-column:1 / -1">Address<textarea class="input" data-pf="address" rows="2">${esc(st.address)}</textarea></label>` : !PERSON_FIELDS.includes(f) ? customInput(f, st.extra[f]) : `<label class="f">${fieldLabel(f)}<input class="input" data-pf="${f}" value="${esc(st[f])}" autocomplete="off"></label>`).join('')}</div>` : ''}
      <div class="drop" id="eDrop" tabindex="0" role="button" aria-label="Choose ID photo" ${photoSpecLine(d) ? 'aria-describedby="eSpec"' : ''}><div class="ph" id="ePh">${p?.hasPhoto ? `<img src="${photoUrl(p)}" alt="">` : ICON.image}</div><div><b id="eName">${st.hasPhoto ? esc(st.photoName || 'Photo saved') : 'Drop a photo here or click to choose'}</b>${photoSpecLine(d) ? `<span class="num" id="eSpec">At least ${photoSpecLine(d)}</span>` : ''}</div></div>
      <input type="file" id="eFile" accept="${PHOTO_ACCEPT}" hidden>
      <label class="f">Zoom<input type="range" id="eZoom" min="1" max="4" step="0.01" value="${st.adj.zoom}"></label>
      <div class="row sm"><button class="btn sm" id="eReset">${ICON.retry}Reset position</button><button class="btn sm" id="eWhole" ${st.hasPhoto ? '' : 'hidden'}>${ICON.image}Whole photo</button><button class="btn sm" id="eEnh" ${st.hasPhoto ? '' : 'hidden'}>${ICON.wand}Enhance</button><button class="btn sm danger" id="eRemove" ${st.hasPhoto ? '' : 'hidden'}>${ICON.trash}Remove photo</button></div>
      <label class="f">Notes<textarea class="input" id="eNotes" rows="2">${esc(st.notes)}</textarea></label>
      ${p ? `<div class="f"><span>Card</span><div class="row"><select class="input" id="eStatus" style="max-width:190px">${[['active', 'Active'], ['lost', 'Lost or stolen'], ['returned', 'Returned']].map(([k, l]) => `<option value="${k}" ${p.cardStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="hint">${p.printCount ? `${plural(p.printCount, 'card')} printed, last ${fmtDateTime(p.lastPrintedAt)}` : 'No card printed yet'}</span></div><div id="eHist" class="stack sm"></div></div>` : ''}</div>
      ${d ? `<div class="cardview"><span class="lbl">${esc(d.name)}</span><canvas id="eCv" style="width:${d.card.w > d.card.h ? 330 : 240}px"></canvas></div>` : ''}</div>`,
    actions: [
      ...(p ? [{ label: 'Delete', kind: 'danger', onClick: async () => { if (!(await confirmBox('Delete this person?', 'Their details and photo are removed.', 'Delete', 'danger'))) return false; await api('POST', '/api/people/delete', { ids: [p.id] }); toast('Deleted'); peopleTab.reload(); } }] : []),
      { label: 'Cancel' },
      { label: 'Save', onClick: () => save(false) },
      ...(d ? [{ label: 'Save and print', kind: 'primary', onClick: () => save(true) }] : [])] });
  const el = m.el; const cv = $('#eCv', el);
  const draw = () => cv && drawCard(cv, d, 'front', { ...st, ...st.extra, firstName: st.firstName || 'First', lastName: st.lastName || 'Last name', photo: st.img, adj: st.adj });
  // The zoom slider runs from the whole photo showing up to 4 times the template's starting size.
  const zoomRange = () => { const b = photoBox(d); const z = $('#eZoom', el); if (st.img && b) { z.min = photoGeometry(st.img, b, st.adj).minZoom.toFixed(3); z.value = st.adj.zoom; } };
  (async () => { if (p?.hasPhoto) { st.img = st.src = await loadImage(photoUrl(p)); zoomRange(); } draw(); })();
  $('#eFirst', el).oninput = e => { st.firstName = e.target.value; draw(); };
  $('#eLast', el).oninput = e => { st.lastName = e.target.value; draw(); };
  $$('[data-pf]', el).forEach(i => i.oninput = e => { st[i.dataset.pf] = e.target.value; draw(); });
  $('#eNotes', el).oninput = e => st.notes = e.target.value;
  $$('[data-cf]', el).forEach(i => i.oninput = e => { st.extra[i.dataset.cf] = e.target.value; draw(); });
  if (p) {
    const showLog = async () => {
      let rows = []; try { rows = await api('GET', `/api/people/${p.id}/history`); } catch (e) { return; }
      const box = $('#eHist', el); if (!box) return;
      box.innerHTML = rows.slice(0, 8).map(r => { const [k, l] = hChip(r.status); return `<div class="hint"><span class="num">${fmtDateTime(r.ts)}</span> <span class="chip ${k}">${l}</span> ${esc(r.note || r.batch || '')}${r.operator ? ` · ${esc(r.operator)}` : ''}</div>`; }).join('')
        + (rows.length > 8 ? `<div class="hint">${rows.length - 8} earlier in Print history</div>` : '');
    };
    showLog();
    $('#eStatus', el).onchange = async e => {
      try { const r = await api('POST', `/api/people/${p.id}/status`, { status: e.target.value }); Object.assign(p, r); toast(`Card marked ${e.target.selectedOptions[0].textContent.toLowerCase()}`, 'ok'); peopleTab.reload(); showLog(); }
      catch (err) { toast(err.message, 'err'); e.target.value = p.cardStatus; }
    };
  }
  const pick = async (f) => {
    if (!f) return;
    try { const r = await shrinkPhoto(f, st.enhance || (S.config.enhancePhotos && 'needed')); st.enhance = r.enhanced; enhLabel(); Object.assign(st, { img: r.img, src: r.src, fresh: true, photoData: r.dataUrl, photoName: r.name, hasPhoto: true, adj: { zoom: 1, ox: 0, oy: 0, face: r.face, photo: r.photo } }); $('#ePh', el).innerHTML = `<img src="${r.dataUrl}" alt="">`; $('#eName', el).textContent = r.name; zoomRange(); $('#eRemove', el).hidden = false; $('#eWhole', el).hidden = false; $('#eEnh', el).hidden = false; draw(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const drop = $('#eDrop', el);
  drop.onclick = () => $('#eFile', el).click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#eFile', el).click(); } };
  $('#eFile', el).onchange = e => pick(e.target.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); };
  $('#eZoom', el).oninput = e => { st.adj.zoom = +e.target.value; draw(); };
  $('#eReset', el).onclick = () => { st.adj = { ...st.adj, zoom: 1, ox: 0, oy: 0 }; $('#eZoom', el).value = 1; draw(); };   // keeps the face found
  $('#eWhole', el).onclick = () => { const b = photoBox(d); if (!st.img || !b) return; st.adj = { ...st.adj, zoom: photoGeometry(st.img, b, { face: st.adj.face }).minZoom, ox: 0, oy: 0 }; $('#eZoom', el).value = st.adj.zoom; draw(); };
  $('#eRemove', el).onclick = () => { Object.assign(st, { img: null, src: null, photoData: null, photoName: '', hasPhoto: false, enhance: false }); $('#ePh', el).innerHTML = ICON.image; $('#eName', el).textContent = 'Drop a photo here or click to choose'; $('#eRemove', el).hidden = true; $('#eWhole', el).hidden = true; $('#eEnh', el).hidden = true; enhLabel(); draw(); };
  // Enhance (render.js enhancePixels) makes the photo again from the one before; undone, a saved photo is left as it was.
  const enhLabel = () => { $('#eEnh', el).innerHTML = st.enhance ? `${ICON.undo}Undo enhance` : `${ICON.wand}Enhance`; };
  $('#eEnh', el).onclick = async (e) => {
    if (!st.src) return;
    e.currentTarget.disabled = true; st.enhance = !st.enhance; enhLabel();
    try {
      if (st.enhance || st.fresh) { const r = await photoJpeg(st.src, st.enhance); Object.assign(st, { img: r.img, photoData: r.dataUrl }); st.adj.photo = r.photo; }
      else { Object.assign(st, { img: st.src, photoData: undefined }); st.adj.photo = p?.adj?.photo; }   // the saved photo, as it was
      $('#ePh', el).innerHTML = `<img src="${st.photoData || photoUrl(p)}" alt="">`; draw();
    } catch (err) { toast(err.message, 'err'); }
    finally { $('#eEnh', el).disabled = false; }
  };
  if (cv) enablePhotoPan(cv, () => ({ img: st.img, adj: st.adj, design: d }), (z) => { if (z) $('#eZoom', el).value = st.adj.zoom; draw(); });   // no card preview without a template
  setTimeout(() => $('#eFirst', el).focus(), 30);
  async function save(andPrint) {
    if (!st.firstName.trim() && !st.lastName.trim()) { toast('Enter a name', 'err'); $('#eFirst', el).focus(); return false; }
    const body = { firstName: st.firstName, lastName: st.lastName, staffId: st.staffId, position: st.position, title: st.title, address: st.address, notes: st.notes, adj: st.adj, photoName: st.photoName, extra: st.extra };
    if (st.photoData !== undefined) body.photo = st.photoData; // null removes, a data URL replaces
    let saved;
    try { saved = p ? await api('PUT', `/api/people/${p.id}`, body) : await api('POST', `/api/clients/${c.id}/people`, body); }
    catch (e) { toast(e.message, 'err'); return false; }
    toast(p ? 'Saved' : `Added ${saved.firstName} ${saved.lastName}`, 'ok');
    peopleTab.reload();
    if (andPrint) { saved._img = st.img; setTimeout(() => printPeople(c, [saved], { designId: tab.designId, sides: tab.sides }), 50); }
  }
}

let printing = false;   // a double-click must not queue the same cards twice
async function printPeople(c, people, opts) {
  if (printing) return;
  printing = true;
  try { await queuePeople(c, people, opts); } finally { printing = false; }
}
// Render and queue cards for people of a client.
async function queuePeople(c, people, { designId, sides }) {
  if (!people.length) return;
  const d = S.designs.find(x => x.id === designId) || clientDefaultDesign(c);
  if (!d) { toast(`${c.name} has no card template yet`, 'err'); return; }
  if (!printsBack(d)) sides = 'front';
  const flagged = people.filter(p => cardState(p) && !/Expires/.test(cardState(p)[1]));
  if (flagged.length && sides !== 'back' && !(await confirmBox(flagged.length === 1 ? `${`${flagged[0].firstName} ${flagged[0].lastName}`.trim()}: ${cardState(flagged[0])[1].toLowerCase()}` : `${plural(flagged.length, 'card')} lost, returned or expired`,
    `${flagged.length === 1 ? 'Their card is marked' : 'Some cards in this selection are marked'} ${[...new Set(flagged.map(p => cardState(p)[1].toLowerCase()))].join(', ')}. A new card makes theirs active again.`, 'Print new card'))) return;
  if (sides === 'both' && noFlipper() && !(await confirmBox('Print dual-sided?', 'This printer reports no flipper module, so it can\'t print both sides in one pass. Use Front only, then "Print backs" in the queue after flipping the cards.', 'Print dual-sided'))) return;
  const noPhoto = people.filter(p => !p.hasPhoto && !p._img).length;
  if (noPhoto && sides !== 'back' && !(await confirmBox(`${plural(noPhoto, 'card')} without a photo`, `${noPhoto === people.length ? 'The photo area will print blank.' : `${plural(noPhoto, 'person')} in this selection ${noPhoto === 1 ? 'has' : 'have'} no photo. Their photo area will print blank.`}`, 'Print anyway'))) return;
  const sup = S.printer && S.printer.supplies;
  const short = [['ribbon', 'ribbon'], ['film', 'HDP film']].map(([k, n]) => { const s = sup && sup[k]; return s && s.estimate && s.estimate.cardsLeft < people.length ? `The ${n} has about ${s.estimate.cardsLeft} cards left (${s.percent}%).` : s && s.percent !== null && s.percent <= 0 ? `The ${n} is empty.` : ''; }).filter(Boolean);
  if (short.length && !(await confirmBox(`Enough supplies for ${plural(people.length, 'card')}?`, short.join(' '), 'Print anyway'))) return;
  const one = people.length === 1;
  let cancelled = false;
  const m = one ? null : modal({ title: `Preparing ${plural(people.length, 'card')}`, text: `${c.name} · ${d.name} · ${SIDES[sides] || 'Front only'}`, body: `<div class="stack sm"><div class="progress"><i id="pBar" style="width:0%"></i></div><div class="row"><b id="pMsg" class="num">Starting…</b><span class="sp"></span><span class="muted num" id="pPct">0%</span></div></div>`, actions: [{ label: 'Stop', kind: 'danger', onClick: () => { cancelled = true; return false; } }] });
  if (m) m.el.dataset.locked = '1';
  try {
    const list = [];
    for (const p of people) list.push({ ...(p.extra || {}), personId: p.id, firstName: p.firstName, lastName: p.lastName, staffId: p.staffId, position: p.position, title: p.title, address: p.address, adj: p.adj, img: p._img || null, url: p._img ? null : photoUrl(p) });
    const name = one ? `${people[0].firstName} ${people[0].lastName}`.trim() : `${c.name}: ${plural(people.length, 'card')}${sides === 'front' && printsBack(d) ? ' (fronts)' : sides === 'back' ? ' (backs)' : ''}`;
    await queueCards({ name, source: one ? 'single' : 'bulk', client: c, design: d, sides, people: list, isCancelled: () => cancelled,
      onProgress: (n, t, p) => { if (!m) return; $('#pBar').style.width = `${(n / t) * 100}%`; $('#pMsg').textContent = `Preparing card ${n} of ${t}: ${p.firstName} ${p.lastName}`; $('#pPct').textContent = `${Math.round((n / t) * 100)}%`; } });
    m && m.close();
    toast(one ? `Printing ${name}` : `${plural(people.length, 'card')} added to the print queue`, 'ok');
    if (!one) { peopleTab.st.sel.clear(); location.hash = '#/queue'; }
  } catch (e) { m && m.close(); toast(e.message === 'cancelled' ? 'Stopped. Nothing from this selection was queued.' : e.message, e.message === 'cancelled' ? '' : 'err'); }
}

// ---------------- shared by Import from CSV and Bulk update ----------------
// A CSV file's text: UTF-8, else Windows-1252 (Excel's plain "CSV" is ANSI).
async function csvText(f) { const bytes = await f.arrayBuffer(); try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); } }
// The photo step: Choose folder / Choose files, then a tick box per picture type with how many were found. `st.files` keeps every
// supported file chosen; only the ticked types (`st.types`, all of them to start) are matched, so a tick changes the matches at once.
// Enhance photos that need it (`st.enhance`, on to start when it's on in Settings) is applied as each photo is saved, and shown in the thumbnails.
const PHOTO_PROBLEM = { several: 'More than one photo', shared: 'Shared photo' };   // csv.js photosByName
const allTypes = () => new Set(PHOTO_FORMATS.map(f => f.key));
const tickedFiles = (st) => st.files.filter(f => st.types.has(photoFormat(f)));
const photosChosen = (st) => { const n = tickedFiles(st).length; return n === st.files.length ? `${plural(n, 'photo')} chosen` : `${n} of ${plural(st.files.length, 'photo')} ticked`; };
function photoPicker(st, primary) {
  const n = {}; for (const f of st.files) n[photoFormat(f)] = (n[photoFormat(f)] || 0) + 1;
  return `<div class="row"><button class="btn ${primary ? 'primary' : ''}" data-pick="folder">${ICON.folder}Choose folder</button><button class="btn" data-pick="files">${ICON.image}Choose files</button>
    <input type="file" data-in="folder" webkitdirectory multiple hidden><input type="file" data-in="files" accept="${PHOTO_ACCEPT}" multiple hidden></div>
    <div class="types">${PHOTO_FORMATS.map(f => `<label class="${st.files.length && !n[f.key] ? 'dim' : ''}"><input type="checkbox" data-type="${f.key}" ${st.types.has(f.key) ? 'checked' : ''}>${f.label}${st.files.length ? `<span class="num">${n[f.key] || 0}</span>` : ''}</label>`).join('')}</div>
    <div class="types"><label><input type="checkbox" data-enhance ${st.enhance ? 'checked' : ''}>Enhance photos that need it</label></div>`;
}
function bindPhotoPicker(box, st, onChange) {
  $$('[data-pick]', box).forEach(b => b.onclick = () => $(`[data-in="${b.dataset.pick}"]`, box).click());
  $$('[data-in]', box).forEach(i => i.onchange = e => {
    const imgs = [...e.target.files].filter(photoFormat);
    if (!imgs.length) { toast('No image files found there', 'err'); return; }
    const seen = new Set(st.files.map(f => f.name.toLowerCase()));
    for (const f of imgs) if (!seen.has(f.name.toLowerCase())) st.files.push(f);
    onChange();
  });
  $$('[data-type]', box).forEach(i => i.onchange = e => { st.types[e.target.checked ? 'add' : 'delete'](i.dataset.type); onChange(); });
  $('[data-enhance]', box).onchange = e => { st.enhance = e.target.checked; onChange(); };
}
// Review-table thumbnails. An <img> of a HEIC or TIFF file shows nothing, so those start as a type label and are opened
// (openImage, with its decoder) only when their row scrolls into view, once per file; the other types the window shows as they are.
// With Enhance photos that need it ticked, every thumbnail is made this way, as the photo will be kept: checked at its
// kept size, enhanced if it's off (and outlined, "Enhanced"). Thumbnails are made one at a time, so a long list never
// opens dozens of big photos at once.
const thumbs = [new WeakMap(), new WeakMap()];   // [as it is, enhance if needed]: file → Promise of { src, enhanced } (src null when it can't be opened)
let thumbLine = Promise.resolve();
async function smallThumb(file, enhance) {
  const img = await openImage(file); if (!img) return { src: null };
  const from = enhance ? await keptCanvas(img) : img, enhanced = enhance && enhanceCanvas(from, 'needed').enhanced;
  const fw = from.naturalWidth || from.width, fh = from.naturalHeight || from.height, k = Math.min(1, 96 / Math.max(fw, fh));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(fw * k)); c.height = Math.max(1, Math.round(fh * k));
  const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(from, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/jpeg', 0.8), enhanced };
}
const thumbIO = new IntersectionObserver(hits => hits.forEach(h => {
  if (!h.isIntersecting) return; thumbIO.unobserve(h.target); const f = h.target._file, enhance = 'enh' in h.target.dataset, cache = thumbs[+enhance];
  if (!cache.has(f)) cache.set(f, thumbLine = thumbLine.then(() => smallThumb(f, enhance).catch(() => ({ src: null }))));
  cache.get(f).then(t => { if (t.src && h.target.isConnected) h.target.outerHTML = `<img class="thumb${t.enhanced ? ' enh' : ''}" src="${t.src}" alt="" ${t.enhanced ? 'title="Enhanced"' : ''}>`; });
}));
const thumbHtml = (file, urlOf, enhance) => !file ? '<div class="thumb"></div>' : !enhance && showsAsIs(file) ? `<img class="thumb" src="${urlOf(file)}" alt="" loading="lazy">` : `<div class="thumb noph ty" data-lazy ${enhance ? 'data-enh' : ''}>${PHOTO_FORMATS.find(f => f.key === photoFormat(file)).label}</div>`;
const watchThumbs = (box, fileOf) => $$('[data-lazy]', box).forEach(el => { el._file = fileOf(el.closest('tr')); thumbIO.observe(el); });
// The progress window for Import from CSV and Bulk update. People are done one at a time, each named before it starts,
// so a long list works through steadily and the PC stays usable. `show(i, who, note)` before person i (from 0) lets the
// window draw it before that person's photo work starts; while the window is hidden or minimised it draws nothing and
// its timers slow to one a second, so it carries straight on. `stopped` once Stop is chosen.
const drawn = () => document.hidden ? Promise.resolve() : Promise.race([new Promise(r => requestAnimationFrame(() => setTimeout(r))), new Promise(r => setTimeout(r, 100))]);
function progressBox(title, verb, total) {
  let stopped = false;
  const m = modal({ title, body: `<div class="stack sm"><div class="progress"><i data-bar style="width:0%"></i></div><div class="row"><b data-msg class="num">Starting…</b><span class="sp"></span><span class="muted num" data-pct>0%</span></div><span class="hint num" data-note></span></div>`,
    actions: [{ label: 'Stop', kind: 'danger', onClick: () => { stopped = true; return false; } }] });
  m.el.dataset.locked = '1';
  return {
    get stopped() { return stopped; },
    async show(i, who, note = '') {
      $('[data-bar]', m.el).style.width = `${(i / total) * 100}%`; $('[data-pct]', m.el).textContent = `${Math.round((i / total) * 100)}%`;
      $('[data-msg]', m.el).textContent = `${verb} ${i + 1} of ${total}: ${who}`; $('[data-note]', m.el).textContent = note;
      await drawn();
    },
    close: () => m.close(),
  };
}
const photoNames = (file, files, fallback = '') => esc(file ? file.name : files?.length ? files.map(f => f.name).join(' · ') : fallback) || '—';

// ---------------- import people from CSV + photos into a client ----------------
const importer = {
  mount(root, top, c) {
    const im = peopleTab.st.importing; this.root = root; this.top = top; this.client = c;
    top.innerHTML = `<button class="btn" id="iCancel">${ICON.x}Cancel import</button>`;
    $('#iCancel').onclick = () => { this.release(); peopleTab.st.importing = null; peopleTab.mount(root, top, c); };
    const matched = im.people.filter(p => p.file).length;
    root.innerHTML = `<div class="stack"><div class="steps">
      <div class="card step"><span class="n">1</span><h3>Fill in the template</h3>
        <div class="code">${['First Name', 'Last Name', ...clientFields(c).filter(f => !['firstName', 'lastName'].includes(f)).map(f => ({ staffId: 'Staff ID Number', position: 'Position', title: 'Title', address: 'Address' })[f] || esc(fieldLabel(f)))].join(',')}</div>
        <a class="btn" href="/api/bulk-template.csv?clientId=${c.id}" download>${ICON.download}Download blank CSV</a></div>
      <div class="card step ${im.people.length ? 'done' : ''}"><span class="n">${im.people.length ? '✓' : '2'}</span><h3>Upload the completed CSV</h3>
        <div class="row"><button class="btn ${im.people.length ? '' : 'primary'}" id="iCsvBtn">${ICON.upload}${im.people.length ? 'Replace CSV' : 'Upload CSV'}</button><input type="file" id="iCsv" accept=".csv,text/csv" hidden></div>
        ${im.people.length ? `<span class="st">${esc(im.csvName)}: ${plural(im.people.length, 'person')}</span>` : ''}${im.warning ? `<span class="st warn">${esc(im.warning)}</span>` : ''}</div>
      <div class="card step ${im.files.length ? 'done' : ''}" id="iPhotos"><span class="n">${im.files.length ? '✓' : '3'}</span><h3>Add the ID photos</h3>
        ${photoSpecLine(S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c)) ? `<span class="hint num">At least ${photoSpecLine(S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c))}</span>` : ''}
        ${photoPicker(im, im.people.length && !im.files.length)}
        ${im.files.length ? `<span class="st ${matched < im.people.length ? 'warn' : ''}">${photosChosen(im)} · ${matched} of ${im.people.length} matched</span>` : ''}</div></div>
      <div class="card" id="iTable"></div></div>`;
    $('#iCsvBtn').onclick = () => $('#iCsv').click();
    $('#iCsv').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const { people, warning } = readPeople(await csvText(f), S.config.customFields);
      if (!people.length) { toast('No people found in that CSV', 'err'); return; }
      this.release();
      const existing = new Set(peopleTab.st.rows.map(p => `${p.firstName} ${p.lastName}`.toLowerCase().trim()));
      im.people = people.map(p => { const dup = existing.has(`${p.firstName} ${p.lastName}`.toLowerCase().trim()); return { ...p, id: uid(), include: !dup, dup }; });
      im.csvName = f.name; im.warning = warning; this.match(); this.mount(root, top, c);
    };
    bindPhotoPicker($('#iPhotos'), im, () => { this.match(); this.mount(root, top, c); });
    this.table();
  },
  match() {
    const im = peopleTab.st.importing, files = tickedFiles(im), idx = buildPhotoIndex(files);
    // A CSV's ID Photo column names the file; anyone else gets the photo named after them (csv.js photosByName). When that's
    // not clear (more than one photo, or one photo for two people) they're imported without one, to add by hand.
    const named = photosByName(files, im.people.filter(p => !p.photoFile));
    for (const p of im.people) {
      const m = p.photoFile ? { file: matchPhoto(idx, p) } : named.get(p), f = m.file || null;
      p.photoProblem = m.problem || null; p.photoFiles = m.files;
      if (f !== p.file) { if (p.url) URL.revokeObjectURL(p.url); p.file = f; p.url = f ? URL.createObjectURL(f) : null; }
    }
  },
  release() { const im = peopleTab.st.importing; if (im) for (const p of im.people) if (p.url) URL.revokeObjectURL(p.url); },
  status(p) {
    if (!p.firstName && !p.lastName) return ['err', 'Name missing'];
    if (p.dup) return ['info', 'Already in client'];
    if (p.photoProblem) return ['warn', `${PHOTO_PROBLEM[p.photoProblem]}: no photo`];
    if (!p.file) return p.photoFile ? ['err', 'Photo not found'] : ['warn', 'No photo'];
    return ['ok', 'Ready'];
  },
  table() {
    const im = peopleTab.st.importing, box = $('#iTable'); if (!box) return;
    if (!im.people.length) { box.innerHTML = `<div class="empty">${ICON.stack}<b>No list loaded yet</b></div>`; return; }
    const ok = im.people.filter(p => p.include && this.status(p)[0] !== 'err');
    const cols = clientFields(this.client).filter(f => !['firstName', 'lastName'].includes(f));
    const y = $('.tbl-wrap', box)?.scrollTop;
    box.innerHTML = `<div class="toolbar"><b>Review before importing</b><span class="sp"></span>
        <button class="btn primary lg" id="iGo" ${ok.length ? '' : 'disabled'}>${ICON.upload}Import ${plural(ok.length, 'person')}</button></div>
      <div class="tbl-wrap" style="max-height:56vh"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" id="iAll" ${im.people.every(p => p.include) ? 'checked' : ''} aria-label="Select all"></th><th>#</th><th>Photo</th><th>First name</th><th>Last name</th>${cols.map(f => `<th>${esc(fieldLabel(f))}</th>`).join('')}<th>Photo file</th><th>Status</th></tr></thead>
      <tbody>${im.people.map(p => { const [k, l] = this.status(p); const can = k !== 'err'; return `<tr data-id="${p.id}" class="${p.include && can ? 'sel' : ''}"><td><input type="checkbox" data-inc ${p.include && can ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Include"></td><td class="num muted">${p.row}</td>
        <td>${thumbHtml(p.file, () => p.url, im.enhance)}</td><td class="nm">${esc(p.firstName) || '<span class="muted">—</span>'}</td><td class="nm">${esc(p.lastName) || '<span class="muted">—</span>'}</td>
        ${cols.map(f => `<td class="muted" style="max-width:200px;white-space:pre-line">${esc(fieldInfo(f).type === 'date' ? formatDate(p[f], 'DD/MM/YYYY') : p[f]) || '—'}</td>`).join('')}
        <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${photoNames(p.file, p.photoFiles, p.photoFile)}">${photoNames(p.file, p.photoFiles, p.photoFile)}</td><td><span class="chip ${k}">${l}</span></td></tr>`; }).join('')}</tbody></table></div>`;
    if (y) $('.tbl-wrap', box).scrollTop = y;
    $('#iAll').onchange = e => { im.people.forEach(p => p.include = e.target.checked); this.table(); };
    $$('tbody tr', box).forEach(tr => { const p = im.people.find(x => x.id === tr.dataset.id); $('[data-inc]', tr).onchange = e => { p.include = e.target.checked; this.table(); }; });
    watchThumbs(box, tr => im.people.find(x => x.id === tr.dataset.id)?.file);
    $('#iGo').onclick = () => this.run(ok);
  },
  async run(list) {
    const c = this.client, enhance = peopleTab.st.importing.enhance && 'needed', added = [], failed = [];
    const box = progressBox(`Importing ${plural(list.length, 'person')}`, 'Importing', list.length); let enhanced = 0;
    for (let i = 0; i < list.length && !box.stopped; i++) {
      const p = list[i];
      await box.show(i, `${p.firstName} ${p.lastName}`, enhance ? `${plural(enhanced, 'photo')} enhanced so far` : '');
      try {
        const r = p.file ? await shrinkPhoto(p.file, enhance) : null;
        added.push(await api('POST', `/api/clients/${c.id}/people`, { firstName: p.firstName, lastName: p.lastName, staffId: p.staffId, position: p.position, title: p.title, address: p.address, photo: r?.dataUrl ?? null, photoName: r ? p.file.name : '', adj: r ? { zoom: 1, ox: 0, oy: 0, face: r.face, photo: r.photo } : undefined,
          extra: Object.fromEntries(customFields().filter(k => p[k]).map(k => [k, p[k]])) }));
        if (r?.enhanced) enhanced++;
      } catch (e) { failed.push(`${`${p.firstName} ${p.lastName}`.trim()} (row ${p.row}): ${e.message}`); }
    }
    const stop = box.stopped; box.close();
    this.release(); peopleTab.st.importing = null;
    await peopleTab.mount(this.root, this.top, c);
    // Importing the same CSV again skips everyone already added ("Already in client"), so only these are left to redo.
    const r = runReport('Not imported:', failed, added, S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c)), notes = r.html;
    if (!added.length) { if (failed.length) modal({ title: 'Nobody was imported', body: notes, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
    toast(`Imported ${plural(added.length, 'person')}${enhanced ? `, ${plural(enhanced, 'photo')} enhanced` : ''}${stop ? ' (stopped early)' : ''}`, 'ok');
    peopleTab.st.sel = new Set(added.map(p => p.id)); peopleTab.paint();
    if (!clientDefaultDesign(c)) { if (notes) modal({ title: `Imported ${plural(added.length, 'person')}`, body: notes, actions: [...r.actions, { label: 'OK', kind: 'primary' }] }); return; }
    modal({ title: `Imported ${plural(added.length, 'person')}`, text: 'Print their cards now?', body: notes,
      actions: [{ label: 'Not now' }, ...r.actions, { label: `Print ${plural(added.length, 'card')}`, kind: 'primary', onClick: () => { setTimeout(() => printPeople(c, added, { designId: peopleTab.st.designId, sides: peopleTab.st.sides }), 30); } }] });
  },
};

// ---------------- bulk update: new details and photos for the people already in a client ----------------
// Nobody is added or deleted. A CSV (First Name, Last Name and the details to change) and/or photos named after people are
// matched to the people by name (csv.js planUpdate); each person then gets one PUT of only what changes.
const updateFields = () => [...PERSON_FIELDS, ...customFields()].filter(f => !['firstName', 'lastName'].includes(f));
const UPDATE_CHIP = { noChange: ['info', 'No changes'], notFound: ['err', 'Not found'], sameName: ['warn', 'Same name twice: skipped'], twice: ['warn', 'In the CSV twice: skipped'],
  ...Object.fromEntries(Object.entries(PHOTO_PROBLEM).map(([k, l]) => [k, ['warn', `${l}: skipped`]])) };
const updater = {
  mount(root, top, c) {
    const u = peopleTab.st.updating; this.root = root; this.top = top; this.client = c;
    top.innerHTML = `<button class="btn" id="uCancel">${ICON.x}Cancel update</button>`;
    $('#uCancel').onclick = () => { this.release(); peopleTab.st.updating = null; peopleTab.mount(root, top, c); };
    const ticked = tickedFiles(u).length, matched = ticked - u.plan.unusedFiles.length;
    root.innerHTML = `<div class="stack"><div class="steps two">
      <div class="card step ${u.rows.length ? 'done' : ''}"><span class="n">${u.rows.length ? '✓' : '1'}</span><h3>Upload a CSV of changes</h3>
        <div class="row"><a class="btn" href="/api/clients/${c.id}/people.csv" download>${ICON.download}Export people</a><button class="btn ${u.rows.length ? '' : 'primary'}" id="uCsvBtn">${ICON.upload}${u.rows.length ? 'Replace CSV' : 'Upload CSV'}</button><input type="file" id="uCsv" accept=".csv,text/csv" hidden></div>
        ${u.rows.length ? `<span class="st">${esc(u.csvName)}: ${plural(u.rows.length, 'person')}</span>` : ''}${u.warning ? `<span class="st warn">${esc(u.warning)}</span>` : ''}</div>
      <div class="card step ${u.files.length ? 'done' : ''}" id="uPhotos"><span class="n">${u.files.length ? '✓' : '2'}</span><h3>Add the ID photos</h3>
        ${photoSpecLine(S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c)) ? `<span class="hint num">At least ${photoSpecLine(S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c))}</span>` : ''}
        ${photoPicker(u, u.rows.length && !u.files.length)}
        ${u.files.length ? `<span class="st ${matched < ticked ? 'warn' : ''}">${photosChosen(u)} · ${matched} matched</span>` : ''}</div></div>
      <div class="card" id="uTable"></div></div>`;
    $('#uCsvBtn').onclick = () => $('#uCsv').click();
    $('#uCsv').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const { people, warning } = readPeople(await csvText(f), S.config.customFields);
      if (!people.length) { toast('No people found in that CSV', 'err'); return; }
      u.rows = people; u.csvName = f.name; u.warning = warning; this.plan(); this.mount(root, top, c);
    };
    bindPhotoPicker($('#uPhotos'), u, () => { this.plan(); this.mount(root, top, c); });
    this.table();
  },
  plan() { const u = peopleTab.st.updating; u.plan = planUpdate(peopleTab.st.rows, u.rows, tickedFiles(u), updateFields(), (p, k) => PERSON_FIELDS.includes(k) ? p[k] : (p.extra || {})[k]); },
  // One object URL per new photo for its thumbnail, released when the screen closes.
  url(f) { const u = peopleTab.st.updating; if (!u.urls.has(f)) u.urls.set(f, URL.createObjectURL(f)); return u.urls.get(f); },
  release() { const u = peopleTab.st.updating; if (u) for (const url of u.urls.values()) URL.revokeObjectURL(url); },
  included: (e) => !e.problem && !peopleTab.st.updating.excluded.has(e.person.id),
  table() {
    const u = peopleTab.st.updating, box = $('#uTable'); if (!box) return;
    const { entries, unusedFiles } = u.plan;
    if (!entries.length && !unusedFiles.length) { box.innerHTML = `<div class="empty">${ICON.stack}<b>Nothing to review yet</b></div>`; return; }
    const ok = entries.filter(this.included), hasCsv = !!u.rows.length;   // the # column is the CSV row, so only with a CSV
    const show = (k, v) => fieldInfo(k).type === 'date' ? formatDate(v, 'DD/MM/YYYY') : (v || '');
    const changes = (e) => [...Object.entries(e.changes).map(([k, v]) => `${esc(fieldLabel(k))}: ${esc(show(k, PERSON_FIELDS.includes(k) ? e.person[k] : (e.person.extra || {})[k])) || '—'} → ${esc(show(k, v))}`), ...(e.file ? [e.person.hasPhoto ? 'Replaces photo' : 'Adds photo'] : []), ...(e.photoProblem ? [`${PHOTO_PROBLEM[e.photoProblem]}: photo left as it is`] : [])];
    const y = $('.tbl-wrap', box)?.scrollTop;
    box.innerHTML = `<div class="toolbar"><b>Review before updating</b><span class="sp"></span>
        <button class="btn primary lg" id="uGo" ${ok.length ? '' : 'disabled'}>${ICON.retry}Update ${plural(ok.length, 'person')}</button></div>
      ${entries.length ? `<div class="tbl-wrap" style="max-height:56vh"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" id="uAll" ${entries.filter(e => !e.problem).every(this.included) ? 'checked' : ''} aria-label="Select all"></th>${hasCsv ? '<th>#</th>' : ''}<th>Photo</th><th>First name</th><th>Last name</th><th>Changes</th><th>Photo file</th><th>Status</th></tr></thead>
      <tbody>${entries.map((e, i) => { const [k, l] = e.problem ? UPDATE_CHIP[e.problem] : ['ok', 'Ready'], inc = this.included(e), who = e.person || e.row; return `<tr data-i="${i}" class="${inc ? 'sel' : ''}"><td><input type="checkbox" data-inc ${inc ? 'checked' : ''} ${e.problem ? 'disabled' : ''} aria-label="Include"></td>${hasCsv ? `<td class="num muted">${e.row ? e.row.row : '—'}</td>` : ''}
        <td>${thumbHtml(e.file, f => this.url(f), u.enhance)}</td><td class="nm">${esc(who.firstName) || '<span class="muted">—</span>'}</td><td class="nm">${esc(who.lastName) || '<span class="muted">—</span>'}</td>
        <td class="muted" style="max-width:360px">${changes(e).join('<br>') || '—'}</td><td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${photoNames(e.file, e.files)}">${photoNames(e.file, e.files)}</td><td><span class="chip ${k}">${l}</span></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty"><b>No one matched</b></div>`}
      ${unusedFiles.length ? `<details class="unused"><summary>${plural(unusedFiles.length, 'photo')} not used</summary><div>${unusedFiles.map(f => esc(f.name)).join(' · ')}</div></details>` : ''}`;
    if (y) $('.tbl-wrap', box).scrollTop = y;
    $('#uAll') && ($('#uAll').onchange = e => { for (const x of entries) if (!x.problem) u.excluded[e.target.checked ? 'delete' : 'add'](x.person.id); this.table(); });
    $$('tbody tr', box).forEach(tr => { const e = entries[+tr.dataset.i]; $('[data-inc]', tr).onchange = ev => { u.excluded[ev.target.checked ? 'delete' : 'add'](e.person.id); this.table(); }; });
    watchThumbs(box, tr => entries[+tr.dataset.i].file);
    $('#uGo').onclick = () => this.run(ok);
  },
  async run(list) {
    const c = this.client, enhance = peopleTab.st.updating.enhance && 'needed', failed = [];
    const box = progressBox(`Updating ${plural(list.length, 'person')}`, 'Updating', list.length), withPhoto = []; let done = 0, enhanced = 0;
    for (let i = 0; i < list.length && !box.stopped; i++) {
      const { person: p, file, changes } = list[i];
      await box.show(i, `${p.firstName} ${p.lastName}`, enhance ? `${plural(enhanced, 'photo')} enhanced so far` : '');
      try {
        const body = {};   // only what changes; the service keeps everything else
        for (const [k, v] of Object.entries(changes)) { if (PERSON_FIELDS.includes(k)) body[k] = v; else (body.extra ??= {})[k] = v; }
        const r = file ? await shrinkPhoto(file, enhance) : null;
        if (r) Object.assign(body, { photo: r.dataUrl, photoName: file.name, adj: { zoom: 1, ox: 0, oy: 0, face: r.face, photo: r.photo } });   // a new photo starts at the template's fit
        const saved = await api('PUT', `/api/people/${p.id}`, body); done++;
        if (r) withPhoto.push(saved);
        if (r?.enhanced) enhanced++;
      } catch (e) { failed.push(`${`${p.firstName} ${p.lastName}`.trim()}: ${e.message}`); }
    }
    const stop = box.stopped; box.close();
    this.release(); peopleTab.st.updating = null;
    await peopleTab.mount(this.root, this.top, c);
    if (done) toast(`Updated ${plural(done, 'person')}${enhanced ? `, ${plural(enhanced, 'photo')} enhanced` : ''}${stop ? ' (stopped early)' : ''}`, 'ok');
    const rep = runReport('Not updated:', failed, withPhoto, S.designs.find(x => x.id === peopleTab.st.designId) || clientDefaultDesign(c));
    if (rep.html) modal({ title: done ? `Updated ${plural(done, 'person')}` : 'Nobody was updated', body: rep.html, actions: [...rep.actions, { label: 'OK', kind: 'primary' }] });
  },
};

// ======================================================================
// View: Print queue
// ======================================================================
const ITEM_CHIP = { queued: ['', 'Queued'], sending: ['live', 'Sending'], printing: ['live', 'Printing'], attention: ['warn', 'Needs attention'], printed: ['ok', 'Printed'], failed: ['err', 'Failed'], cancelled: ['', 'Cancelled'], interrupted: ['warn', 'Check output'] };
const BATCH_CHIP = { preparing: ['info', 'Preparing'], incomplete: ['warn', 'Incomplete'], queued: ['', 'Waiting'], printing: ['live', 'Printing'], 'needs-review': ['warn', 'Needs review'], done: ['ok', 'Done'], cancelled: ['', 'Cancelled'] };
const openBatches = new Set();
VIEWS.queue = {
  title: 'Print queue', subtitle: '',
  mount(el, top) {
    top.innerHTML = `<button class="btn" id="qClear">${ICON.check}Clear finished</button><span id="qPR"></span>`;
    $('#qClear').onclick = async () => { await api('POST', '/api/queue/clear-finished'); toast('Finished batches cleared'); };
    el.innerHTML = '<div class="stack" id="qRoot"></div>';
    this.paint();
  },
  onQueue() { if (route() === 'queue') this.paint(); },
  onPrinter() {},
  paint() {
    const root = $('#qRoot'); if (!root) return;
    const w = S.worker || {}; const q = S.queue;
    const all = q.batches.flatMap(b => b.items);
    const n = s => all.filter(i => s.includes(i.status)).length;
    const waiting = n(['queued']), active = n(['sending', 'printing', 'attention']), printed = n(['printed']), review = n(['failed', 'interrupted']);
    $('#qPR').innerHTML = q.paused ? `<button class="btn primary" data-act="resume">${ICON.play}Resume printing</button>` : `<button class="btn" data-act="pause">${ICON.pause}Pause</button>`;
    const phaseIcon = q.paused ? 'warning' : w.phase === 'attention' || w.phase === 'waiting' ? 'error' : active ? 'busy' : 'ok';
    const headline = q.paused ? (waiting ? `Paused with ${plural(waiting, 'card')} waiting` : 'Queue paused') : active || waiting ? (w.message || 'Working…') : 'Nothing printing';
    let html = '';
    if (q.recoveredAt || review) {
      html += `<div class="recover"><span style="color:var(--amber);width:22px;flex:none">${ICON.warn}</span><div><b>${review ? `${plural(review, 'card')} need${review === 1 ? 's' : ''} checking` : 'Recovered after a restart'}</b><span class="muted">${q.recoveredAt ? 'The program stopped while a card was printing. ' : ''}Check the printer's output tray for the cards marked "Check output" or "Failed", then choose Mark printed or Reprint for each one.${q.paused ? ' Press Resume printing to continue the rest of the queue.' : ''}</span></div></div>`;
    }
    html += `<div class="card"><div class="qhead"><div><div class="big"><span class="dot ${phaseIcon}"></span>${esc(headline)}</div><div class="sub">${S.config.simulate ? 'Simulator' : esc(S.config.printerName || 'No printer selected')} · ${dualCards() ? `Dual-sided${S.config.backMethod === 'manual' ? ', backs printed after flipping' : ''}` : 'Single-sided'}</div></div></div>
      <div class="kpis"><div class="kpi"><b>${active}</b><span>Printing now</span></div><div class="kpi"><b>${waiting}</b><span>Waiting</span></div><div class="kpi"><b>${printed}</b><span>Printed</span></div><div class="kpi"><b style="color:${review ? 'var(--err)' : ''}">${review}</b><span>Need review</span></div></div></div>`;
    if (!q.batches.length) html += `<div class="card"><div class="empty">${ICON.queue}<b>The queue is empty</b><a href="#/clients">Go to clients</a></div></div>`;
    const batches = [...q.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const b of batches) {
      const c = b.counts || { total: b.items.length };
      const isOpen = openBatches.has(b.id) || (b.status === 'printing' && !openBatches.has('x' + b.id));
      const pct = k => `${((c[k] || 0) / Math.max(1, c.total)) * 100}%`;
      const [bk, bl] = BATCH_CHIP[b.status] || ['', b.status];
      html += `<div class="card batch ${isOpen ? 'open' : ''}" data-b="${b.id}"><div class="batch-h" data-toggle>${ICON.chev}<div style="min-width:0"><div class="row sm"><h3>${esc(b.name)}</h3><span class="chip ${bk}">${bl}</span><span class="chip ${b.sides === 'both' || !b.sides ? '' : 'info'}">${b.hasBack ? SIDES[b.sides || 'both'] : 'Front only'}</span>${b.source === 'single' ? '<span class="chip">Single</span>' : ''}${b.backsBatchId ? '<span class="chip ok">Backs queued</span>' : ''}</div>
        <div class="meta">${b.clientName ? `${esc(b.clientName)} · ` : ''}${esc(b.designName)} · ${fmtDateTime(b.createdAt)} · ${c.printed || 0} of ${c.total} printed${c.failed ? ` · ${c.failed} failed` : ''}${c.interrupted ? ` · ${c.interrupted} to check` : ''}</div>
        <div class="pbar"><i class="p" style="width:${pct('printed')}"></i><i class="a" style="width:${(((c.printing || 0) + (c.sending || 0) + (c.attention || 0)) / Math.max(1, c.total)) * 100}%"></i><i class="f" style="width:${(((c.failed || 0) + (c.interrupted || 0)) / Math.max(1, c.total)) * 100}%"></i></div></div>
        <span class="num muted" style="font-weight:800">${Math.round(((c.printed || 0) / Math.max(1, c.total)) * 100)}%</span></div>
        ${b.sides === 'front' && b.hasBack && !b.backsBatchId && c.printed && !c.queued && !c.printing && !c.sending && !c.attention ? `<div class="flipnote"><span style="color:var(--brand);width:22px;flex:none">${ICON.retry}</span><div style="flex:1;min-width:0"><b>Fronts done: ${plural(c.printed, 'card')} ready for the back</b><span class="muted">Flip the cards, load them again, then print the backs.</span></div><button class="btn primary" data-ba="print-backs">${ICON.print}Print backs</button></div>` : ''}
        ${isOpen ? `<div class="batch-b"><div class="tbl-wrap" style="max-height:480px"><table class="tbl"><thead><tr><th>#</th><th>Card</th><th>Name</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>
        ${b.items.map((it, i) => { const [k, l] = ITEM_CHIP[it.status] || ['', it.status]; return `<tr data-i="${it.id}"><td class="num muted">${i + 1}</td><td><img class="thumb card" src="/api/queue/cards/${b.id}/${it.id}-${b.sides === 'back' ? 'back' : 'front'}.png" alt="" loading="lazy"></td>
          <td><div class="nm">${esc(it.firstName)} ${esc(it.lastName)}</div>${it.error ? `<div class="err-line">${esc(it.error)}</div>` : ''}</td><td><span class="chip ${k}">${l}</span>${it.attempts > 1 ? ` <span class="muted" style="font-size:12px">try ${it.attempts}</span>` : ''}</td>
          <td class="num muted">${fmtTime(it.finishedAt || it.startedAt || it.addedAt)}</td><td><div class="acts">
          ${['interrupted', 'failed'].includes(it.status) ? `<button class="btn sm" data-a="mark-printed">${ICON.check}Mark printed</button>` : ''}
          ${['interrupted', 'failed', 'cancelled', 'printed'].includes(it.status) ? `<button class="btn sm" data-a="reprint">${ICON.retry}Reprint</button>` : ''}
          ${it.status === 'queued' ? `<button class="btn sm ghost" data-a="move-top" title="Print this card next in its batch">${ICON.up}</button>` : ''}
          ${['queued', 'sending', 'printing', 'attention'].includes(it.status) ? `<button class="btn sm ghost danger" data-a="cancel" title="Cancel this card">${ICON.x}</button>` : ''}</div></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="batch-acts">${c.queued ? `<button class="btn sm" data-ba="cancel">${ICON.x}Cancel remaining ${c.queued}</button>` : ''}${(c.failed || c.cancelled || c.interrupted) ? `<button class="btn sm" data-ba="retry">${ICON.retry}Reprint failed & cancelled</button>` : ''}${b.sides === 'front' && b.hasBack && c.printed ? `<button class="btn sm" data-ba="print-backs">${ICON.print}${b.backsBatchId ? 'Print backs again' : 'Print backs'}</button>` : ''}<span class="sp"></span><button class="btn sm danger" data-ba="delete">${ICON.trash}Remove batch</button></div></div>` : ''}</div>`;
    }
    root.innerHTML = html;
    $$('[data-toggle]', root).forEach(h => h.onclick = () => {
      const id = h.closest('[data-b]').dataset.b; const el = h.closest('.batch');
      if (el.classList.contains('open')) { openBatches.delete(id); openBatches.add('x' + id); } else { openBatches.add(id); openBatches.delete('x' + id); }
      this.paint();
    });
    $$('[data-a]', root).forEach(btn => btn.onclick = async () => {
      const id = btn.closest('[data-i]').dataset.i; const a = btn.dataset.a;
      if (a === 'reprint') {
        const it = all.find(x => x.id === id);
        if (it.status === 'printed' && !(await confirmBox('Reprint this card?', `${it.firstName} ${it.lastName} was already printed. Print another copy?`, 'Reprint'))) return;
      }
      try { await api('POST', `/api/queue/items/${id}/${a}`); } catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-ba]', root).forEach(btn => btn.onclick = async () => {
      const id = btn.closest('[data-b]').dataset.b; const a = btn.dataset.ba; const b = q.batches.find(x => x.id === id);
      try {
        if (a === 'print-backs') { printBacks(b); return; }
        if (a === 'delete') { if (!(await confirmBox('Remove this batch?', `"${b.name}" will be removed from the queue.`, 'Remove', 'danger'))) return; await api('DELETE', `/api/queue/batches/${id}`); }
        else await api('POST', `/api/queue/batches/${id}/${a}`);
      } catch (e) { toast(e.message, 'err'); }
    });
  },
};

// Second pass for a front-only batch: flip the cards and print the backs.
function printBacks(b) {
  const n = b.items.filter(i => i.status === 'printed').length;
  modal({ title: `Print backs for ${plural(n, 'card')}`, text: `"${b.name}"`,
    body: `<div class="stack">
      <ol class="olist">
        <li>Take the printed cards from the output hopper, keeping them in a stack.</li>
        <li>Flip the stack and load it into the input hopper.</li>
        <li>If the first back prints upside down, turn on <b>Rotate back side 180°</b> in Settings and reprint it.</li></ol>
      <label class="check bare"><label class="switch"><input type="checkbox" id="pbRev"><i></i></label><div><b>Reverse order</b><span>If flipping the stack reversed the order of the cards.</span></div></label>
      ${n < b.items.length ? `<div class="hint">${plural(b.items.length - n, 'card')} in this batch did not print and ${b.items.length - n === 1 ? 'is' : 'are'} left out.</div>` : ''}</div>`,
    actions: [{ label: 'Cancel' }, { label: 'Print backs', kind: 'primary', onClick: async (m) => {
      try { await api('POST', `/api/queue/batches/${b.id}/print-backs`, { reverse: $('#pbRev', m).checked }); toast(`Printing ${plural(n, 'back')}`, 'ok'); }
      catch (e) { toast(e.message, 'err'); return false; }
    } }] });
}

// ======================================================================
// Card templates: library and visual builder
// ======================================================================
const builder = createBuilder({ S, api, toast, modal, confirmBox, esc, ICON, refreshLists: () => refreshLists(), $, $$, plural });
const admin = createAdmin({ S, api, toast, modal, confirmBox, esc, ICON, $, $$, fmtDateTime, showLogin, showClosed, onConfig: () => { setCustomFields(S.config.customFields); setLineUpFaces(S.config.alignFaces); } });
VIEWS.help = createHelp({ $, ICON, parts });
const thumbsDraw = (root) => $$('[data-thumb]', root).forEach(c => { const d = S.designs.find(x => x.id === c.dataset.thumb); if (d) drawCard(c, d, c.dataset.side || 'front', {}, { samples: true }); });
const fieldChips = (d) => designFields(d).map(f => `<span class="chip">${esc(fieldLabel(f))}</span>`).join(' ');

function newTemplateModal({ clientId } = {}) {
  const c = clientId ? clientById(clientId) : null;
  modal({ title: c ? `New template for ${c.name}` : 'New card template',
    body: `<div class="stack"><label class="f">Template name<input class="input" id="ntName" value="${c ? esc(c.name) + ' card' : ''}" placeholder="e.g. Contractor card"></label>
      <label class="f">Start from<select class="input" id="ntFrom"><option value="">A blank card</option>${S.designs.map(d => `<option value="${esc(d.id)}" ${c && d.id === c.defaultDesignId ? 'selected' : ''}>A copy of ${esc(d.name)}</option>`).join('')}</select></label>
      ${c ? `<label class="check bare"><input type="checkbox" id="ntDef" checked><div><b>Make it ${esc(c.name)}'s default</b></div></label>` : ''}</div>`,
    actions: [{ label: 'Cancel' }, { label: 'Create and open', kind: 'primary', onClick: async (m) => {
      try {
        const r = await api('POST', '/api/designs', { name: $('#ntName', m).value, from: $('#ntFrom', m).value || null, clientId: clientId || null, makeDefault: !!$('#ntDef', m)?.checked });
        await refreshLists(); location.hash = `#/templates/${r.id}`;
      } catch (e) { toast(e.message, 'err'); return false; }
    } }], onMount: (m) => $('#ntName', m).focus() });
}

VIEWS.templates = {
  title: 'Card templates', subtitle: '',
  mount(el, top) {
    top.innerHTML = `<button class="btn primary" id="tNew">${ICON.plus}New template</button>`;
    $('#tNew').onclick = () => newTemplateModal();
    this.el = el; this.paint();
  },
  paint() {
    const el = this.el; if (!el || !document.body.contains(el)) return;
    if (!S.designs.length) {
      el.innerHTML = `<div class="card"><div class="empty">${ICON.card}<b>No card templates yet</b><div class="row"><button class="btn primary" id="tFirst">${ICON.plus}Create your first template</button></div></div></div>`;
      $('#tFirst').onclick = () => newTemplateModal(); return;
    }
    el.innerHTML = `<div class="tgrid">${S.designs.map(d => {
      const users = S.clients.filter(c => (c.templateIds || []).includes(d.id));
      return `<a class="tcard card" href="#/templates/${d.id}"><div class="tcard-v"><canvas data-thumb="${d.id}"></canvas>${d.back?.enabled ? `<canvas data-thumb="${d.id}" data-side="back"></canvas>` : ''}</div>
        <div class="tcard-b"><b>${esc(d.name)}</b><span>${cardLabel(d.card)} · ${d.back?.enabled ? 'Front and back' : 'Front only'}</span><span>${users.length ? `Used by ${users.map(c => esc(c.name)).slice(0, 2).join(', ')}${users.length > 2 ? ` +${users.length - 2}` : ''}` : 'Not assigned'}</span>
        <div class="chips">${fieldChips(d) || '<span class="hint">No fields yet</span>'}</div></div></a>`; }).join('')}</div>`;
    thumbsDraw(el);
  },
  onDesigns() { if (parts()[0] === 'templates' && !parts()[1]) this.paint(); },
  onClients() { if (parts()[0] === 'templates' && !parts()[1]) this.paint(); },
};
VIEWS.template = {
  title: () => S.designs.find(d => d.id === parts()[1])?.name || 'Card template',
  subtitle: '',
  mount(el, top) {
    el.innerHTML = `<div class="stack"><a class="crumb" href="#/templates">${ICON.back}All card templates</a><div id="bRoot"></div></div>`;
    builder.mount($('#bRoot'), top, parts()[1]);
  },
  leave() { builder.unmount(); },
  onDesigns() { builder.onDesigns(); },
  onClients() { builder.onDesigns(); },
};

// A client's assigned templates
function clientTemplatesTab(root, top, c) {
  top.innerHTML = `<button class="btn" id="ctAssign">${ICON.clients}Choose templates</button><button class="btn primary" id="ctNew">${ICON.plus}New template</button>`;
  $('#ctNew').onclick = () => newTemplateModal({ clientId: c.id });
  $('#ctAssign').onclick = () => {
    const cur = new Set(c.templateIds || []);
    modal({ title: `Templates for ${c.name}`,
      body: `<div class="rows">${S.designs.map(d => `<label class="check"><input type="checkbox" data-d="${d.id}" ${cur.has(d.id) ? 'checked' : ''}><div><b>${esc(d.name)}</b><span>${esc(designFields(d).map(fieldLabel).join(', ')) || 'No fields'}</span></div></label>`).join('')}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async (m) => {
        const ids = $$('[data-d]', m).filter(x => x.checked).map(x => x.dataset.d);
        if (!ids.length) { toast('Choose at least one template', 'err'); return false; }
        try { await api('PUT', `/api/clients/${c.id}/templates`, { designIds: ids }); await refreshLists(); navigate(); }
        catch (e) { toast(e.message, 'err'); return false; }
      } }] });
  };
  const list = clientDesigns(c.id);
  if (!list.length) {
    root.innerHTML = `<div class="card"><div class="empty">${ICON.card}<b>No card template yet</b><div class="row">${S.designs.length ? `<button class="btn" id="ctE1">${ICON.clients}Choose templates</button>` : ''}<button class="btn primary" id="ctE2">${ICON.plus}New template</button></div></div></div>`;
    $('#ctE1') && ($('#ctE1').onclick = () => $('#ctAssign').click()); $('#ctE2').onclick = () => $('#ctNew').click(); return;
  }
  root.innerHTML = `<div class="tgrid">${list.map(d => `<div class="tcard card"><div class="tcard-v"><canvas data-thumb="${d.id}"></canvas>${d.back?.enabled ? `<canvas data-thumb="${d.id}" data-side="back"></canvas>` : ''}</div>
      <div class="tcard-b"><div class="row sm"><b>${esc(d.name)}</b>${c.defaultDesignId === d.id ? '<span class="chip info">Default</span>' : ''}</div><span>${cardLabel(d.card)} · ${d.back?.enabled ? 'Front and back' : 'Front only'}</span>
      <div class="chips">${fieldChips(d)}</div>
      <div class="row sm tcard-acts"><a class="btn sm" href="#/templates/${d.id}">${ICON.edit}Edit</a>${c.defaultDesignId !== d.id ? `<button class="btn sm" data-def="${d.id}">${ICON.star}Make default</button>` : ''}${list.length > 1 ? `<button class="btn sm ghost danger" data-rm="${d.id}">Remove</button>` : ''}</div></div></div>`).join('')}</div>`;
  thumbsDraw(root);
  $$('[data-def]', root).forEach(b => b.onclick = async () => { try { await api('PUT', `/api/clients/${c.id}`, { defaultDesignId: b.dataset.def }); await refreshLists(); navigate(); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-rm]', root).forEach(b => b.onclick = async () => { try { await api('PUT', `/api/clients/${c.id}/templates`, { designIds: (c.templateIds || []).filter(x => x !== b.dataset.rm) }); await refreshLists(); navigate(); } catch (e) { toast(e.message, 'err'); } });
}

// ======================================================================
// Print history (all clients, or one client) and logs
// ======================================================================
const hist = { tab: 'prints', q: '', status: 'all', range: 'month', from: '', to: '', clientId: '', logLevel: 'all' };
const hChip = (s) => Object.hasOwn(H_CHIP, s) ? H_CHIP[s] : ['', s];
const H_CHIP = { printed: ['ok', 'Printed'], failed: ['err', 'Failed'], cancelled: ['', 'Cancelled'], check: ['warn', 'Check output'], lost: ['err', 'Lost or stolen'], returned: ['', 'Returned'], active: ['ok', 'Active again'] };
const LVL_CHIP = { error: ['err', 'Error'], warning: ['warn', 'Warning'], info: ['', 'Info'] };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function histRange() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (hist.range === 'today') return [ymd(t), ymd(t)];
  if (hist.range === 'week') { const w = new Date(t); w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); return [ymd(w), ymd(t)]; }
  if (hist.range === 'month') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
  if (hist.range === 'custom') return [hist.from, hist.to];
  return ['', ''];
}
function histQuery(fixedClient) {
  const [from, to] = histRange();
  const p = new URLSearchParams({ q: hist.q, status: hist.status, from, to });
  const cid = fixedClient || hist.clientId; if (cid) p.set('clientId', cid);
  return p.toString();
}

// Reprint from history: a new card for that person with their current details and the same template.
async function reprint(r) {
  const c = clientById(r.clientId); if (!c) return toast('That client is no longer on this PC', 'err');
  let people; try { people = await api('GET', `/api/clients/${c.id}/people`); } catch (e) { return toast(e.message, 'err'); }
  const p = people.find(x => x.id === r.personId); if (!p) return toast(`${r.firstName} ${r.lastName} is no longer in ${c.name}`, 'err');
  printPeople(c, [p], { designId: r.designId, sides: r.sides === 'back' ? 'back' : defaultSides() });
}
function historyPanel(root, top, { clientId } = {}) {
  const fixed = clientId || ''; let lastRows = [];
  top.innerHTML = `<a class="btn" id="hCsv" href="/api/history.csv?${histQuery(fixed)}" download>${ICON.download}Export to CSV</a>`;
  root.innerHTML = `<div class="stack"><div class="card"><div class="kpis" id="hKpis">${['Printed today', 'This week', 'This month', 'All time'].map(l => `<div class="kpi"><b>—</b><span>${l}</span></div>`).join('')}</div></div>
    <div class="card"><div class="toolbar">
      <label class="f" style="flex:1 1 200px">Search<input class="input" id="hQ" placeholder="Name, batch or operator" value="${esc(hist.q)}"></label>
      ${fixed ? '' : `<label class="f" style="flex:0 1 200px">Client<select class="input" id="hC"><option value="">All clients</option>${S.clients.map(c => `<option value="${c.id}" ${hist.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`}
      <label class="f" style="flex:0 1 160px">Period<select class="input" id="hR">${[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Choose dates…']].map(([v, l]) => `<option value="${v}" ${hist.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${hist.range === 'custom' ? `<label class="f" style="flex:0 1 150px">From<input class="input" type="date" id="hFrom" value="${hist.from}"></label><label class="f" style="flex:0 1 150px">To<input class="input" type="date" id="hTo" value="${hist.to}"></label>` : ''}
      <label class="f" style="flex:0 1 150px">Result<select class="input" id="hS">${[['all', 'All results'], ['printed', 'Printed'], ['failed', 'Failed'], ['check', 'Check output'], ['cancelled', 'Cancelled']].map(([v, l]) => `<option value="${v}" ${hist.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="sp"></span><span class="hint" id="hCount"></span></div><div id="hBody"><div class="empty">Loading…</div></div></div></div>`;
  const load = async () => {
    let data; try { data = await api('GET', `/api/history?${histQuery(fixed)}&limit=2000`); } catch (e) { toast(e.message, 'err'); return; }
    const csv = $('#hCsv'); if (csv) csv.href = `/api/history.csv?${histQuery(fixed)}`;
    const { rows, total, summary } = data; lastRows = rows;
    const k = $('#hKpis'); if (k) k.innerHTML = [['today', 'Printed today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([key, l]) => `<div class="kpi"><b>${summary[key].toLocaleString()}</b><span>${l}</span></div>`).join('');
    const m = summary.matched || {};
    const cnt = $('#hCount'); if (!cnt) return;
    cnt.textContent = `${total.toLocaleString()} record${total === 1 ? '' : 's'}${m.printed ? ` · ${m.printed.toLocaleString()} printed` : ''}${m.failed ? ` · ${m.failed} failed` : ''}`;
    $('#hBody').innerHTML = rows.length ? `<div class="tbl-wrap" style="max-height:60vh"><table class="tbl"><thead><tr><th>When</th>${fixed ? '' : '<th>Client</th>'}<th>Name</th><th>Result</th><th>Batch</th><th>Template</th><th>Ribbon</th><th>By</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const [ck, cl] = hChip(r.status); return `<tr><td class="num muted" style="white-space:nowrap">${fmtDateTime(r.ts)}</td>${fixed ? '' : `<td>${r.clientId && clientById(r.clientId) ? `<a href="#/clients/${r.clientId}/people">${esc(r.clientName)}</a>` : esc(r.clientName) || '—'}</td>`}<td class="nm">${esc(r.firstName)} ${esc(r.lastName)}</td><td><span class="chip ${ck}">${cl}</span>${r.sides && r.sides !== 'both' ? ` <span class="chip info">${r.sides === 'front' ? 'Front' : 'Back'}</span>` : ''}${r.note ? `<div class="hint" style="max-width:38ch">${esc(r.note)}</div>` : ''}</td><td>${esc(r.batch)}</td><td class="muted">${esc(r.design)}</td><td class="muted num">${r.ribbon != null ? r.ribbon + '%' : '—'}</td><td class="muted">${esc(r.operator) || '—'}</td>
        <td>${r.personId && ['printed', 'failed', 'check'].includes(r.status) && clientById(r.clientId) ? `<button class="btn sm" data-rp="${+r.id}" title="Print a new card with their current details">${ICON.retry}Reprint</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>${total > rows.length ? `<div class="hint tbl-foot">Showing the latest ${rows.length.toLocaleString()} of ${total.toLocaleString()}.</div>` : ''}`
      : `<div class="empty">${ICON.history}<b>${summary.all ? 'No matching cards' : 'Nothing printed yet'}</b></div>`;
  };
  $('#hBody').onclick = (e) => { const b = e.target.closest('[data-rp]'); if (b) reprint(lastRows.find(r => r.id === +b.dataset.rp)); };
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(load, 200); };
  $('#hQ').oninput = e => { hist.q = e.target.value; later(); };
  $('#hS').onchange = e => { hist.status = e.target.value; load(); };
  $('#hC') && ($('#hC').onchange = e => { hist.clientId = e.target.value; load(); });
  $('#hR').onchange = e => { hist.range = e.target.value; if (hist.range === 'custom' && !hist.from) { hist.from = ymd(new Date(Date.now() - 30 * 864e5)); hist.to = ymd(new Date()); } historyPanel(root, top, { clientId }); };
  $('#hFrom') && ($('#hFrom').onchange = e => { hist.from = e.target.value; load(); });
  $('#hTo') && ($('#hTo').onchange = e => { hist.to = e.target.value; load(); });
  load();
}

async function logsPanel(root, top, kind) {
  top.innerHTML = '';
  const printerTab = kind === 'printer';
  root.innerHTML = `<div class="card">${printerTab ? '' : `<div class="toolbar"><label class="f" style="flex:0 1 180px">Show<select class="input" id="lL">${[['all', 'Everything'], ['warning', 'Warnings'], ['error', 'Errors']].map(([v, l]) => `<option value="${v}" ${hist.logLevel === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`}<div id="lBody"><div class="empty">Loading…</div></div></div>`;
  $('#lL') && ($('#lL').onchange = e => { hist.logLevel = e.target.value; logsPanel(root, top, kind); });
  let rows = [];
  try { rows = await api('GET', `/api/logs?kind=${kind}&level=${hist.logLevel}&limit=1500`); } catch (e) { toast(e.message, 'err'); }
  const body = $('#lBody'); if (!body) return;
  body.innerHTML = !rows.length ? `<div class="empty">${ICON.history}<b>Nothing logged yet</b></div>`
    : `<div class="tbl-wrap" style="max-height:66vh"><table class="tbl"><thead><tr><th>When</th><th>${printerTab ? 'Event' : 'Level'}</th><th>${printerTab ? 'Details' : 'Message'}</th></tr></thead><tbody>${rows.map(r => {
      if (printerTab) { const [k, l] = r.type === 'cleared' ? ['ok', 'Cleared'] : (LVL_CHIP[r.level] || ['', r.level]); return `<tr><td class="num muted" style="white-space:nowrap">${fmtDateTime(r.ts)}</td><td><span class="chip ${k}">${l}</span></td><td><b>${esc(r.title || r.code)}</b>${r.detail ? `<div class="hint">${esc(r.detail)}</div>` : ''}</td></tr>`; }
      const [k, l] = LVL_CHIP[r.level] || ['', r.level]; return `<tr><td class="num muted" style="white-space:nowrap">${fmtDateTime(r.ts)}</td><td><span class="chip ${k}">${l}</span></td><td style="word-break:break-word">${esc(r.message)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

VIEWS.history = {
  title: 'Print history', subtitle: '',
  mount(el, top) {
    el.innerHTML = `<div class="stack"><div class="seg" id="hTabs" role="tablist">${[['prints', 'Print history'], ['printer', 'Printer events'], ...(isAdmin() ? [['service', 'Service log']] : [])].map(([k, l]) => `<button type="button" role="tab" data-s="${k}" class="${hist.tab === k ? 'on' : ''}" aria-selected="${hist.tab === k}">${l}</button>`).join('')}</div><div id="hRoot"></div></div>`;
    bindSeg('hTabs', t => { hist.tab = t; this.mount(el, top); });
    if (hist.tab === 'service' && !isAdmin()) hist.tab = 'prints';
    if (hist.tab === 'prints') historyPanel($('#hRoot'), top, {}); else logsPanel($('#hRoot'), top, hist.tab);
  },
};

// ======================================================================
// View: Settings
// ======================================================================
const accountCard = (c, admin) => `        <div class="card"><div class="card-h"><div><h2>Sign-in and security</h2><p>Signed in as <b>${esc(S.user?.username || '')}</b></p></div></div><div class="card-b stack">
          <form id="acForm" class="stack" autocomplete="off">
            <label class="f">Username<input class="input" id="acUser" value="${esc(S.user?.username || '')}" autocomplete="username"></label>
            <div class="grid2"><label class="f">New password<input class="input" type="password" id="acNew" autocomplete="new-password" placeholder="At least 8 characters"></label><label class="f">Confirm new password<input class="input" type="password" id="acNew2" autocomplete="new-password"></label></div>
            <label class="f">Current password<input class="input" type="password" id="acCur" autocomplete="current-password"></label>
            <div class="row"><button class="btn primary" type="submit">${ICON.lock}Save sign-in details</button></div></form>
          <div class="divider"></div>
${admin ? `          <label class="f">Sign out after this many minutes of inactivity<input class="input" type="number" min="5" max="1440" data-c="sessionIdleMin" value="${c.sessionIdleMin ?? 120}" style="max-width:160px"></label>` : ''}
          <dl class="kv"><dt>Database</dt><dd>Encrypted · ${esc(S.security?.cipher || '')}</dd><dt>Key</dt><dd>${esc(S.security?.keyProtection || '')}</dd><dt>File</dt><dd style="font-family:Consolas,monospace;font-size:12px">${esc(S.dbFile || '')}</dd></dl></div></div>`;
// One line under "Check for updates": the error, the available version (with Update now), or that this is the latest.
const updateLine = (checked) => { const u = S.update || {}; return u.error ? esc(u.error) : u.available ? `Version ${esc(u.latest)} is available${u.installing ? ' · installing' : ' <button class="btn sm primary" id="updNow2">Update now</button>'}` : checked ? 'You have the latest version' : ''; };
const aboutCard = () => `        <div class="card"><div class="card-h"><div><h2>About</h2></div></div><div class="card-b stack">
          <div class="row"><span class="mark-lg">${document.querySelector('.brand .mark').outerHTML}</span><div><b style="font-size:16px;color:var(--brand-deep)">ID Card Printing Software Free</b><div class="hint">Version ${esc(S.version)}</div></div></div>
          ${isAdmin() ? `<div class="row"><button class="btn" id="updCheck">${ICON.retry}Check for updates</button><span class="hint" id="updRes">${updateLine(false)}</span></div>` : ''}
          <dl class="kv"><dt>Copyright</dt><dd>&copy; 2026 Josh McNabb. All rights reserved.</dd><dt>Licence</dt><dd>Free to use for the life of the software (licence version ${esc(S.license?.version || LICENSE_VERSION)})${S.license?.acceptedBy ? `, accepted by ${esc(S.license.acceptedBy)} on ${fmtDateTime(S.license.acceptedAt)}` : ''}</dd><dt>Warranty</dt><dd>None. Provided as is; see the licence.</dd></dl>
          <div class="row"><button class="btn" data-act="licence">${ICON.doc}Licence</button><button class="btn" data-act="printers">${ICON.print}Supported printers</button><button class="btn" data-act="notices">${ICON.doc}Third-party notices</button></div></div></div>`;

VIEWS.settings = {
  title: 'Settings', subtitle: '',
  async mount(el) {
    const c = S.config;
    if (!isAdmin()) { el.innerHTML = `<div class="settings"><div class="stack">${accountCard(c, false)}</div><div class="stack">${aboutCard()}</div></div>`; this.bindAccount(el); return; }
    const sw = (k, title) => `<label class="check"><label class="switch"><input type="checkbox" data-c="${k}" ${c[k] ? 'checked' : ''}><i></i></label><div><b>${title}</b></div></label>`;
    // Print adjustments (PrintTuning): key, label, left end, right end, range. Saved as numbers when the slider is released.
    // With a printer the program knows (S.printer.autoTuning) and printAuto on, Darkness, Contrast and Colour show the printer's own values, disabled.
    const ADJ = [['printDarkness', 'Darkness', 'Lighter', 'Darker'], ['printContrast', 'Contrast', 'Less', 'More'], ['printColour', 'Colour', 'Weaker', 'Stronger'], ['printOverprint', 'Overprint edges', 'None', '2 mm', 'min="0" max="2" step="0.1"']];
    const AUTO_KEY = { printDarkness: 'darkness', printContrast: 'contrast', printColour: 'colour' };
    const autoT = () => S.printer?.autoTuning;
    const autoOn = () => !!autoT() && S.config.printAuto !== false;
    const adjVal = (k) => +(S.config[k] ?? 0);
    const adjShown = (k) => autoOn() && AUTO_KEY[k] ? +(autoT()[AUTO_KEY[k]] ?? 0) : adjVal(k);
    const adjDefault = () => ADJ.every(([k]) => !adjVal(k)) && (!autoT() || autoOn());
    const fmtAdj = (k, v) => k === 'printOverprint' ? `${+v.toFixed(1)} mm` : v > 0 ? `+${v}` : `${v}`;
    const adjHtml = () => `<div class="adj" id="ptAdj"><div class="row"><b>Print adjustments</b><span class="sp"></span><button class="btn sm ghost" id="ptReset" ${adjDefault() ? 'disabled' : ''}>Reset</button></div>
          ${autoT() ? `<label class="check bare"><label class="switch"><input type="checkbox" id="ptAuto" ${autoOn() ? 'checked' : ''}><i></i></label><div><b>Automatic for ${esc(autoT().model)}</b></div></label>` : ''}
          <div class="grid2">${ADJ.map(([k, l, lo, hi, range = 'min="-50" max="50" step="1"']) => `<label class="f"><span class="val">${l}<span class="num muted" id="${k}V">${fmtAdj(k, adjShown(k))}</span></span><input type="range" id="${k}" ${range} list="ptZero" value="${adjShown(k)}" aria-label="${l}" aria-valuetext="${fmtAdj(k, adjShown(k))}" ${autoOn() && AUTO_KEY[k] ? 'disabled' : ''}><span class="ends"><span>${lo}</span><span>${hi}</span></span></label>`).join('')}</div>
          <datalist id="ptZero"><option value="0"></option></datalist></div>`;
    el.innerHTML = `<div class="settings">
      <div class="stack">
        <div class="card"><div class="card-h"><div><h2>Printer</h2></div><button class="btn sm" id="cRefresh">${ICON.retry}Refresh list</button></div><div class="card-b rows">
          <label class="f">Card printer<select class="input" id="cPrinter" ${c.simulate ? 'disabled' : ''}><option value="">Loading printers…</option></select></label>
          ${S.simulator ? sw('simulate', 'Simulator mode') : ''}
          ${c.simulate ? `<div class="grid2"><label class="f">Simulated seconds per card<input class="input" type="number" min="2" max="120" data-c="simSeconds" value="${c.simSeconds}"></label></div>` : ''}
          ${!c.simulate && S.printer && S.printer.dpi ? `<div class="hint">Print resolution ${S.printer.dpi} dpi</div>` : ''}
          ${c.simulate ? '' : adjHtml()}
          <div class="row"><button class="btn" id="cTest">${ICON.print}Print a test card</button>${!c.simulate ? `<button class="btn" id="cPrefs">Printing preferences</button><button class="btn" id="cQueue">Windows print queue</button>` : ''}</div>
        </div></div>
        <div class="card"><div class="card-h"><div><h2>Printing</h2></div></div><div class="card-b rows">
          <div class="f"><span>Card type</span>
            <div class="seg" id="cCardSides" role="radiogroup" aria-label="Card type">${[['single', 'Single-sided'], ['dual', 'Dual-sided']].map(([k, l]) => `<button type="button" role="radio" data-s="${k}" aria-checked="${(c.cardSides || 'dual') === k}" class="${(c.cardSides || 'dual') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          ${dualCards() ? `<div class="f"><span>How the back is printed</span>
            <div class="seg" id="cBackMethod" role="radiogroup" aria-label="How the back is printed">${[['auto', 'Automatically (printer flips)'], ['manual', 'Manually (flip the cards)']].map(([k, l]) => `<button type="button" role="radio" data-s="${k}" aria-checked="${c.backMethod === k}" class="${c.backMethod === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
            ${noFlipper() && c.backMethod !== 'manual' ? `<div><div class="alert warning"><span style="color:var(--amber);width:20px;flex:none">${ICON.warn}</span><div><b>This printer reports no flipper module</b><span>Without a flipper it can't print both sides in one pass. Choose "Manually (flip the cards)".</span></div></div></div>` : ''}` : ''}
          ${dualCards() ? sw('rotateBack', 'Rotate back side 180°') : ''}
          ${sw('autoStart', 'Start printing automatically')}
          ${sw('pauseOnError', 'Pause the queue on printer problems')}
          <div class="grid2"><label class="f">Pause between cards (seconds)<input class="input" type="number" min="0" max="600" data-c="delayBetweenCards" value="${c.delayBetweenCards}"></label>
          <label class="f">Flag a card as slow after (minutes)<input class="input" type="number" min="1" max="120" data-c="jobTimeoutMin" value="${c.jobTimeoutMin}"></label></div>
        </div></div>
        <div class="card"><div class="card-h"><div><h2>Photos</h2></div></div><div class="card-b rows">
          ${sw('enhancePhotos', 'Enhance photos that need it')}
          ${sw('alignFaces', 'Line up faces on every card')}
        </div></div>
        <div class="card" id="fdCard"></div>
      </div>
      <div class="stack">
        <div class="card" id="apCard"></div>
        <div class="card"><div class="card-h"><div><h2>Supplies</h2></div></div><div class="card-b stack">
          <div id="cSup" class="meters">${suppliesHtml(true) || '<span class="hint">No levels reported.</span>'}</div>
          ${reported('ribbon') || reported('film') ? `<div class="grid2">${reported('ribbon') ? `<label class="f">Warn when ribbon is at or below (%)<input class="input" type="number" min="0" max="90" data-c="ribbonLowPercent" value="${c.ribbonLowPercent ?? 10}"></label>` : ''}
          ${reported('film') ? `<label class="f">Warn when HDP film is at or below (%)<input class="input" type="number" min="0" max="90" data-c="filmLowPercent" value="${c.filmLowPercent ?? 10}"></label>` : ''}</div>` : ''}</div></div>
        <div class="card"><div class="card-h"><div><h2>Operator & alerts</h2></div></div><div class="card-b rows">
          <label class="f">Operator name<input class="input" data-c="operatorName" value="${esc(c.operatorName)}" placeholder="Shown in print history"></label>
          ${sw('notifications', 'Desktop notifications')}
          ${sw('sound', 'Alert sounds')}
          ${S.platform === 'win32' ? '' : '<div class="row"><button class="btn" id="cNotif">Allow notifications</button></div>'}
        </div></div>
${accountCard(c, true)}
        <div class="card" id="usCard"></div>
        <div class="card"><div class="card-h"><div><h2>Backup</h2></div></div><div class="card-b stack">
          <div class="row"><button class="btn" id="cBackup">${ICON.download}Download backup</button><button class="btn" id="cRestore">${ICON.upload}Restore from backup</button></div></div></div>
<div class="card" id="abCard"></div>
        <div class="card" id="svCard"></div>
        ${aboutCard()}
      </div></div>`;
    const save = async (patch) => { try { S.config = await api('PUT', '/api/config', patch); toast('Settings saved'); } catch (e) { toast(e.message, 'err'); } };
    $$('[data-c]', el).forEach(inp => inp.addEventListener('change', async () => {
      const k = inp.dataset.c; const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
      await save({ [k]: v });
      if (k === 'simulate') this.mount(el);
    }));
    const loadPrinters = async () => {
      const sel = $('#cPrinter'); if (!sel) return;
      try {
        const list = await api('GET', '/api/printers');
        const names = list.map(p => p.name);
        if (c.printerName && !names.includes(c.printerName)) names.unshift(c.printerName);
        sel.innerHTML = `<option value="">Select a printer…</option>` + names.map(n => { const p = list.find(x => x.name === n); return `<option value="${esc(n)}" ${n === S.config.printerName ? 'selected' : ''}>${esc(n)}${p ? ` (${esc(p.port)})` : ' (not found)'}${/fargo|hdp/i.test(n) ? ' ★' : ''}</option>`; }).join('');
        if (!S.config.printerName && !c.simulate) { const f = list.find(p => /fargo|hdp5000/i.test(p.name + p.driver)); if (f) { sel.value = f.name; await save({ printerName: f.name }); toast(`Found ${f.name}`, 'ok'); } }
      } catch (e) { sel.innerHTML = `<option>${esc(e.message)}</option>`; }
    };
    $('#cPrinter').onchange = e => save({ printerName: e.target.value });
    // Sliders: the readout follows the thumb (input); the value is saved on release (change), then everything is re-read from the saved config.
    // The section is redrawn (paintAdj) when Automatic is switched, on Reset, and when the printer's autoTuning appears or changes - never mid-drag.
    let adjDragging = false;
    const adjShow = (k, v) => { const inp = $(`#${k}`, el); inp.value = v; inp.setAttribute('aria-valuetext', fmtAdj(k, v)); $(`#${k}V`, el).textContent = fmtAdj(k, v); };
    const adjSync = () => { for (const [k] of ADJ) adjShow(k, adjShown(k)); $('#ptReset', el).disabled = adjDefault(); };
    const bindAdj = () => {
      if (!$('#ptAdj', el)) return;
      for (const [k] of ADJ) { const inp = $(`#${k}`, el); inp.oninput = () => { adjDragging = true; adjShow(k, +inp.value); }; inp.onchange = async () => { await save({ [k]: +inp.value }); adjDragging = false; adjSync(); }; }
      $('#ptReset', el).onclick = async () => { await save({ ...Object.fromEntries(ADJ.map(([k]) => [k, 0])), ...(autoT() ? { printAuto: true } : {}) }); paintAdj(); };
      $('#ptAuto', el) && ($('#ptAuto', el).onchange = async e => { await save({ printAuto: e.target.checked }); paintAdj(); });
    };
    const paintAdj = () => { const a = $('#ptAdj', el); if (!a) return; a.outerHTML = adjHtml(); bindAdj(); };
    bindAdj();
    let adjLast = JSON.stringify(autoT() || null);
    this.adjPrinter = () => { const now = JSON.stringify(autoT() || null); if (now === adjLast || adjDragging) return; adjLast = now; paintAdj(); };
    bindSeg('cCardSides', async v => { await save({ cardSides: v }); peopleTab.st.sides = null; this.mount(el); });
    if ($('#cBackMethod')) bindSeg('cBackMethod', async v => { await save({ backMethod: v }); peopleTab.st.sides = null; this.mount(el); });
    this.bindAccount(el);
    this.bindUpdate(el);
    appearanceCard($('#apCard', el));
    admin.fields($('#fdCard', el)); admin.users($('#usCard', el)); admin.autoBackup($('#abCard', el)); admin.service($('#svCard', el));
    $('#cRefresh').onclick = loadPrinters;
    $('#cPrefs') && ($('#cPrefs').onclick = () => api('POST', '/api/printer/preferences').then(() => toast('Opening printing preferences on this PC')));
    $('#cQueue') && ($('#cQueue').onclick = () => api('POST', '/api/printer/queue').then(() => toast('Opening the Windows print queue')));
    $('#cNotif') && ($('#cNotif').onclick = async () => { if (!('Notification' in window)) return toast('Notifications are not available on this PC', 'err'); const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications allowed' : 'Notifications were blocked', r === 'granted' ? 'ok' : 'err'); });
    $('#cTest').onclick = async () => {
      if (printing) return;
      printing = true;
      const d = S.designs[0] || TEST_CARD;
      try { await queueCards({ name: 'Test card', source: 'test', client: null, design: d, sides: printsBack(d) && S.config.backMethod !== 'manual' ? 'both' : 'front', people: [{ firstName: 'Test', lastName: 'Card', img: null, adj: {} }] }); toast('Test card sent to the queue', 'ok'); } catch (e) { toast(e.message, 'err'); } finally { printing = false; }
    };
    $('#cBackup').onclick = () => backupModal();
    $('#cRestore').onclick = () => restoreModal();
    loadPrinters();
  },
  onConfig() {},
  bindUpdate(el) {
    const bind = () => { const n = $('#updNow2', el); if (n) n.onclick = () => installUpdate(n); };
    bind();
    const b = $('#updCheck', el); if (!b) return;
    b.onclick = async () => {
      const res = $('#updRes', el); b.disabled = true; res.textContent = 'Checking…';
      try { S.update = await api('POST', '/api/update/check'); renderUpdate(); res.innerHTML = updateLine(true); bind(); }
      catch (e) { res.textContent = e.message; }
      b.disabled = false;
    };
  },
  bindAccount(el) {
    $('#acForm', el).onsubmit = async (e) => {
      e.preventDefault();
      const body = { username: $('#acUser', el).value.trim(), currentPassword: $('#acCur', el).value };
      const n1 = $('#acNew', el).value, n2 = $('#acNew2', el).value;
      if (n1 || n2) { if (n1 !== n2) { toast('The new passwords don\'t match', 'err'); return; } body.newPassword = n1; }
      if (!body.currentPassword) { toast('Enter your current password to save', 'err'); $('#acCur', el).focus(); return; }
      try { const r = await api('PUT', '/api/auth/account', body); S.user = r.user; renderShell(); toast(n1 ? 'Password changed' : 'Sign-in details saved', 'ok'); this.mount(el); }
      catch (err) { toast(err.message, 'err'); }
    };
  },
  onPrinter() { const el = $('#cSup'); if (el) { const h = suppliesHtml(true); if (h && el.innerHTML !== h) el.innerHTML = h; } this.adjPrinter?.(); },
};

// ======================================================================
// Backup and restore (password-protected)
// ======================================================================
function backupModal() {
  modal({ title: 'Download a backup', text: 'You will need this password to restore the backup.',
    body: `<div class="stack"><label class="f">Backup password<input class="input" type="password" id="bkPw" autocomplete="new-password" placeholder="At least 8 characters"></label><label class="f">Confirm backup password<input class="input" type="password" id="bkPw2" autocomplete="new-password"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Download backup', kind: 'primary', onClick: async (m) => {
      const pw = $('#bkPw', m).value;
      if (pw.length < 8) { toast('Use at least 8 characters', 'err'); return false; }
      if (pw !== $('#bkPw2', m).value) { toast('The passwords don\'t match', 'err'); return false; }
      const btn = $('.modal-f .btn.primary', m); btn.disabled = true; btn.textContent = 'Preparing…';
      try {
        const r = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        if (r.status === 401) { showLogin(); return; }
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Backup failed'); }
        const blob = await r.blob();
        const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'ID-Card-Printing-Software-Backup.idcbak';
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        toast('Backup downloaded', 'ok');
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Download backup'; return false; }
    } }] });
}
function restoreModal() {
  modal({ title: 'Restore from a backup', text: 'Everything on this PC (settings, clients, people, templates, the print queue, history and sign-in details) is replaced with the backup. You will then sign in with the details from the backup.',
    body: `<div class="stack"><label class="f">Backup file<input class="input" type="file" id="rsFile" accept=".idcbak,.db"></label><label class="f">Backup password<input class="input" type="password" id="rsPw" autocomplete="off"></label></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Replace with backup', kind: 'danger', onClick: async (m) => {
      const f = $('#rsFile', m).files[0]; const pw = $('#rsPw', m).value;
      if (!f) { toast('Choose the backup file', 'err'); return false; }
      if (!pw) { toast('Enter the backup password', 'err'); return false; }
      const btn = $('.modal-f .btn.danger', m); btn.disabled = true; btn.textContent = 'Restoring…';
      try {
        const r = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': btoa(unescape(encodeURIComponent(pw))) }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Restore failed');
        S.user = null; if (es) es.close();
        showLogin(`Backup restored: ${plural(j.clients, 'client')}, ${plural(j.people, 'person')}, ${plural(j.history, 'history record')}. Sign in with the details from the backup.`, true);
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Replace with backup'; return false; }
    } }] });
}

// ======================================================================
// Appearance (theme colours, sidebar, company logo) and legal texts
// ======================================================================
const THEMES = {
  classic: { label: 'Classic blue', primary: '#00529F' },
  ocean: { label: 'Ocean', primary: '#0A6E8A' },
  teal: { label: 'Teal', primary: '#0F766E' },
  forest: { label: 'Forest', primary: '#2F6B3A' },
  plum: { label: 'Plum', primary: '#6B2E7E' },
  crimson: { label: 'Crimson', primary: '#A3202F' },
  ember: { label: 'Ember', primary: '#B4501A' },
  graphite: { label: 'Graphite', primary: '#3B4552' },
};
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r) => '#' + r.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
const luminance = (h) => { const [r, g, b] = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
function themeVars(t) {
  let p = /^#[0-9a-f]{6}$/i.test(t?.primary || '') ? t.primary : '#00529F';
  // Keep white text on buttons readable: darken very light colours.
  while (luminance(p) > 0.28) p = mix(p, '#000000', 0.08);
  const heading = /^#[0-9a-f]{6}$/i.test(t?.heading || '') ? t.heading : mix(p, '#0F1D2C', 0.45);
  return { '--brand': p, '--brand-deep': heading, '--brand-mid': mix(p, '#ffffff', 0.28), '--brand-tint': mix(p, '#ffffff', 0.9), '--brand-tint-2': mix(p, '#ffffff', 0.955), '--brand-hover': mix(p, '#000000', 0.14) };
}
function applyBranding(b) {
  if (!b) return;
  S.branding = b;
  const vars = themeVars(b.theme);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  document.body.classList.toggle('side-brand', b.theme?.sidebar === 'brand');
  for (const [img, name] of [['#coLogo', '#coName'], ['#lgLogo', '#lgCo']]) {
    const i = $(img), n = $(name);
    if (b.logo) { i.src = b.logo; i.alt = b.companyName ? `${b.companyName} logo` : 'Company logo'; i.hidden = false; } else { i.hidden = true; i.removeAttribute('src'); }
    n.textContent = b.companyName || ''; n.hidden = !b.companyName;
  }
  for (const id of ['#ver', '#ver2']) { const v = $(id); if (v) v.textContent = b.version; }
  document.title = b.companyName ? `ID Card Printing Software Free · ${b.companyName}` : 'ID Card Printing Software Free';
}
const brandingFromConfig = (c) => ({ ...(S.branding || {}), companyName: c.companyName || '', theme: c.theme, logo: c.logoAsset ? `/api/branding/logo?v=${encodeURIComponent(c.logoAsset)}` : null });

function appearanceCard(box) {
  if (!box) return;
  const t = { ...(S.config.theme || {}) }; const b = S.branding || {};
  box.innerHTML = `<div class="card-h"><div><h2>Appearance</h2></div></div>
    <div class="card-b stack">
      <div class="f"><span>Theme</span><div class="swatches">${Object.entries(THEMES).map(([k, v]) => `<button type="button" class="swatch ${t.preset === k ? 'on' : ''}" data-preset="${k}" title="${v.label}" aria-label="${v.label}" style="--sw:${v.primary}"><i></i><span>${v.label}</span></button>`).join('')}</div></div>
      <div class="row end"><label class="f">Main colour<input type="color" class="input" id="apPrimary" value="${t.primary || '#00529F'}"></label>
        <label class="f">Heading colour<input type="color" class="input" id="apHeading" value="${t.heading || themeVars(t)['--brand-deep']}"></label>
        <button class="btn ghost" id="apAuto" ${t.heading ? '' : 'disabled'}>Automatic heading colour</button></div>
      <div class="f"><span>Sidebar</span><div class="seg" id="apSide">${[['light', 'Light'], ['brand', 'Main colour']].map(([k, l]) => `<button type="button" data-s="${k}" class="${(t.sidebar || 'light') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="divider"></div>
      <label class="f">Company name<input class="input" id="apCo" value="${esc(S.config.companyName || '')}" placeholder="e.g. Example Company"></label>
      <div class="tpl"><div class="logo-prev">${b.logo ? `<img src="${b.logo}" alt="Company logo">` : '<span class="hint">No logo</span>'}</div>
        <div class="row"><button class="btn" id="apLogo">${ICON.upload}${b.logo ? 'Change logo' : 'Upload logo'}</button>${b.logo ? '<button class="btn ghost danger" id="apLogoRm">Remove</button>' : ''}</div></div>
      <input type="file" id="apFile" accept="image/png,image/jpeg,image/webp" hidden>
    </div>`;
  const save = async (patch, msg = 'Appearance saved') => {
    try { S.config = await api('PUT', '/api/config', patch); applyBranding(brandingFromConfig(S.config)); toast(msg); appearanceCard(box); }
    catch (e) { toast(e.message, 'err'); }
  };
  $$('[data-preset]', box).forEach(btn => btn.onclick = () => save({ theme: { ...t, preset: btn.dataset.preset, primary: THEMES[btn.dataset.preset].primary, heading: '' } }));
  const live = (k, v) => applyBranding({ ...brandingFromConfig(S.config), theme: { ...t, [k]: v } });
  $('#apPrimary', box).oninput = e => live('primary', e.target.value);
  $('#apPrimary', box).onchange = e => save({ theme: { ...t, preset: 'custom', primary: e.target.value } });
  $('#apHeading', box).oninput = e => live('heading', e.target.value);
  $('#apHeading', box).onchange = e => save({ theme: { ...t, heading: e.target.value } });
  $('#apAuto', box).onclick = () => save({ theme: { ...t, heading: '' } });
  $$('#apSide [data-s]', box).forEach(btn => btn.onclick = () => save({ theme: { ...t, sidebar: btn.dataset.s } }));
  $('#apCo', box).onchange = e => save({ companyName: e.target.value });
  $('#apLogo', box).onclick = () => $('#apFile', box).click();
  $('#apFile', box).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await api('POST', '/api/branding/logo', f, f.type || 'image/png'); S.config.logoAsset = (r.logo || '').split('v=')[1] ? decodeURIComponent(r.logo.split('v=')[1]) : null; applyBranding(r); toast('Logo updated', 'ok'); appearanceCard(box); }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#apLogoRm', box) && ($('#apLogoRm', box).onclick = async () => { try { const r = await api('DELETE', '/api/branding/logo'); S.config.logoAsset = null; applyBranding(r); toast('Logo removed'); appearanceCard(box); } catch (e) { toast(e.message, 'err'); } });
}

function showTextDoc(title, text, extra = {}) {
  return modal({ title, wide: true, text: extra.text, body: `<pre class="legal">${esc(text)}</pre>`, actions: extra.actions || [{ label: 'Close', kind: 'primary' }], onMount: extra.onMount });
}
const showLicence = () => showTextDoc('Licence', LICENSE_TEXT);
async function showNotices() {
  let text = 'Loading…';
  const m = showTextDoc('Third-party notices', text);
  try { text = await (await fetch('/legal/THIRD-PARTY-NOTICES.txt')).text(); const pre = $('pre.legal', m.el); if (pre) pre.textContent = text; } catch (e) {}
}
// First sign-in, and again whenever the licence terms change.
function requireLicence() {
  return new Promise(resolve => {
    const m = showTextDoc(`Licence agreement (version ${S.license?.version || LICENSE_VERSION})`, LICENSE_TEXT, {
      text: S.license?.acceptedBy ? 'The licence terms have changed. Please read and accept the new terms to keep using ID Card Printing Software Free.' : 'Please read and accept the licence to use ID Card Printing Software Free.',
      actions: [
        { label: 'Decline and sign out', kind: 'danger', onClick: async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {} showLogin('You need to accept the licence to use this software.'); resolve(false); } },
        { label: 'I accept', kind: 'primary', onClick: async () => { try { S.license = await api('POST', '/api/license/accept'); toast('Licence accepted', 'ok'); resolve(true); } catch (e) { toast(e.message, 'err'); return false; } } },
      ] });
    m.el.dataset.locked = '1';
  });
}

// ======================================================================
// Sign in
// ======================================================================
// After Settings > Close the program: the service has stopped, so show only that (the window closes by itself).
function showClosed() {
  S.user = null; if (es) { es.close(); es = null; }
  $$('.scrim, .modal, .drawer').forEach(x => x.remove()); drawerOpen = null;
  document.body.classList.add('locked'); $('#login').hidden = true; $('#closed').hidden = false;
}
function showLogin(message, ok) {
  S.user = null; if (es) { es.close(); es = null; }
  $$('.scrim, .modal, .drawer').forEach(x => x.remove()); drawerOpen = null;
  const L = $('#login'); L.hidden = false; document.body.classList.add('locked');
  $('#lgMsg').textContent = message || ''; $('#lgMsg').className = `lg-msg ${ok ? 'ok' : message ? 'warn' : ''}`;
  $('#lgErr').textContent = '';
  setTimeout(() => ($('#lgUser').value ? $('#lgPass') : $('#lgUser')).focus(), 30);
}
// The default login (admin / admin) must choose its own password before anything else.
function requirePasswordChange() {
  return new Promise(resolve => {
    const { el } = modal({ title: 'Choose your own password', text: 'The password you signed in with is temporary. Choose your own before you continue.',
      body: `<div class="stack"><label class="f">New password<input class="input" type="password" id="npNew" autocomplete="new-password" placeholder="At least 8 characters"></label><label class="f">Confirm new password<input class="input" type="password" id="npNew2" autocomplete="new-password"></label></div>`,
      actions: [
        { label: 'Sign out', onClick: async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {} showLogin(); resolve(false); } },
        { label: 'Save password', kind: 'primary', onClick: async (m) => {
          const n1 = $('#npNew', m).value;
          if (!n1) { toast('Enter a new password', 'err'); return false; }
          if (n1 !== $('#npNew2', m).value) { toast('The new passwords don\'t match', 'err'); return false; }
          try { S.user = (await api('PUT', '/api/auth/account', { newPassword: n1 })).user; toast('Password changed', 'ok'); resolve(true); }
          catch (e) { toast(e.message, 'err'); return false; }
        } },
      ],
      onMount: m => { setTimeout(() => $('#npNew', m).focus(), 30); m.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('.modal-f .btn.primary', m).click(); }; } });
    el.dataset.locked = '1';
  });
}
async function afterLogin() {
  $('#login').hidden = true; document.body.classList.remove('locked');
  $('#lgPass').value = '';
  if (S.user.isDefaultPassword && !(await requirePasswordChange())) return;
  await loadState(); S.connected = true; connect();
  if (!S.license?.accepted) await requireLicence();
}
$('#lgForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#lgBtn'); btn.disabled = true; $('#lgErr').textContent = '';
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#lgUser').value, password: $('#lgPass').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Sign-in failed');
    S.user = j.user; await afterLogin();
  } catch (err) { $('#lgErr').textContent = err.message === 'Failed to fetch' ? 'Cannot reach the print service on this PC.' : err.message; $('#lgPass').select(); }
  finally { btn.disabled = false; }
};
$('#signOut').onclick = async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {} showLogin('You have signed out.', true); };

// ======================================================================
// Boot
// ======================================================================
window.addEventListener('hashchange', () => {
  if (builder.isDirty() && current === VIEWS.template && !(parts()[0] === 'templates' && parts()[1] === builder.current())) {
    const target = location.hash; history.replaceState(null, '', `#/templates/${builder.current()}`);
    builder.guard(() => { location.hash = target; });
    return;
  }
  navigate();
});
window.addEventListener('beforeunload', e => { if (builder.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); if (S.user) location.hash = '#/help'; } });
$('#pWidget').onclick = openPrinterDrawer;
(async () => {
  try { applyBranding(await (await fetch('/api/branding')).json()); } catch (e) {}
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) { S.user = (await r.json()).user; await afterLogin(); }
    else showLogin();
  } catch (e) { showLogin('Cannot reach the print service on this PC. Close the program and open it again.'); }
})();
