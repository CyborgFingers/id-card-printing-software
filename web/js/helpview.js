// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Help: the user guide built into the program. Topics come from help.js (generated from docs/USER-GUIDE.md).
// #/help lists the topics and searches them; #/help/<id> shows one topic with the others beside it.
import { HELP_TOPICS } from './help.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IC = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.5a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9"/><path d="M12 17h.01"/></svg>',
};

// Searching ignores case and accents ("maori" finds "Māori"). foldText keeps exactly one folded character
// per code point, so an index into the folded text is an index into cps (the original's code points).
const fold = (s) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const foldText = (cps) => cps.map(c => { const f = [...fold(c)]; return f.length && f[0].length === 1 ? f[0] : '�'; }).join('');
const words = (q) => [...new Set(fold(q).split(/\s+/).filter(Boolean))];
const TOPICS = HELP_TOPICS.map((t, i) => { const tc = [...t.title], xc = [...t.text]; return { ...t, i, tc, ft: foldText(tc), xc, fx: foldText(xc) }; });
const byId = (id) => TOPICS.find(t => t.id === id);

// [start, end) of every word in f[a, b), merged so marks never nest or overlap.
function ranges(f, ws, a, b) {
  const r = [];
  for (const w of ws) for (let i = f.indexOf(w, a); i > -1 && i < b; i = f.indexOf(w, i + 1)) r.push([i, Math.min(i + w.length, b)]);
  r.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, e] of r) { const l = out[out.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]); }
  return out;
}
// cps[a, b) as alternating plain and matched runs.
function runs(cps, f, ws, a, b, plain, hit) {
  let i = a;
  for (const [s, e] of ranges(f, ws, a, b)) { if (s > i) plain(cps.slice(i, s).join('')); hit(cps.slice(s, e).join('')); i = e; }
  if (i < b) plain(cps.slice(i, b).join(''));
}
function markHtml(cps, f, ws, a = 0, b = cps.length) { let h = ''; runs(cps, f, ws, a, b, s => { h += esc(s); }, s => { h += `<mark>${esc(s)}</mark>`; }); return h; }
// Highlights the words in an element's text nodes only (never by rewriting its HTML), then scrolls to the first.
function highlight(root, ws) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const cps = [...n.data], f = foldText(cps);
    if (!ws.some(w => f.includes(w))) continue;
    const frag = document.createDocumentFragment();
    runs(cps, f, ws, 0, cps.length, s => frag.append(s), s => { const m = document.createElement('mark'); m.textContent = s; frag.append(m); });
    n.replaceWith(frag);
  }
  // Scroll to the rarest word (the most specific: "unplugged" rather than "printer"), like the search preview.
  const text = fold(root.textContent), rare = ws.filter(w => text.includes(w)).sort((a, b) => text.split(a).length - text.split(b).length)[0];
  [...root.querySelectorAll('mark')].find(m => fold(m.textContent).includes(rare))?.scrollIntoView({ block: 'center' });
}

/** Topics where every word of q appears in the title or text; title matches first, then guide order. */
export function search(q) {
  const ws = words(q); if (!ws.length) return null;
  const inTitle = (t) => ws.filter(w => t.ft.includes(w)).length;
  const mentions = (t) => ws.reduce((n, w) => n + t.fx.split(w).length - 1, 0);   // ties: the topic that's more about it
  return TOPICS.filter(t => ws.every(w => t.ft.includes(w) || t.fx.includes(w)))
    .sort((a, b) => (inTitle(b) === ws.length) - (inTitle(a) === ws.length) || !!inTitle(b) - !!inTitle(a) || mentions(b) - mentions(a) || a.i - b.i);
}
/** A short piece of the topic's text around the first match, with the words in <mark>. */
export function snippet(t, ws) {
  // Centre on the rarest word found (usually the most specific: "unplugged" rather than "printer").
  const found = ws.map(w => [w, t.fx.split(w).length - 1]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
  if (!found.length) return esc(t.summary);   // only the title matched
  const pos = t.fx.indexOf(found[0][0]);
  let a = Math.max(0, pos - 60), b = Math.min(t.xc.length, pos + 130);
  if (a) { const sp = t.fx.indexOf(' ', a); if (sp > -1 && sp < pos) a = sp + 1; }
  if (b < t.xc.length) { const sp = t.fx.lastIndexOf(' ', b); if (sp > pos) b = sp; }
  return (a ? '… ' : '') + markHtml(t.xc, t.fx, ws, a, b) + (b < t.xc.length ? ' …' : '');
}

// The topic HTML is generated at build time from the guide (trusted); everything else goes through esc().
export function createHelp({ $, ICON, parts }) {
  let q = '', filtering = false, focusTitle = false, el;   // filtering: typing shows results in place of the open topic
  const topic = () => byId(parts()[1] || '');
  const open = (t) => { filtering = false; focusTitle = true; location.hash = `#/help/${t.id}`; };
  const clear = () => { q = ''; filtering = false; $('#helpQ', el).value = ''; paint(); };
  function onKey(e) {   // "/" focuses the search unless typing somewhere
    if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]') || $('.modal')) return;
    e.preventDefault(); const inp = $('#helpQ', el); inp.focus(); inp.select();
  }
  function paint() {
    const t = topic(), ws = words(q), live = $('#helpLive', el), body = $('#helpBody', el);
    if (ws.length && (!t || filtering)) {
      const hits = search(q);
      live.textContent = hits.length ? `${hits.length} topic${hits.length === 1 ? ' matches' : 's match'}` : 'No topics match';
      body.innerHTML = hits.length ? `<div class="card help-hits">${hits.map(h => `<a class="help-hit" href="#/help/${h.id}"><b>${markHtml(h.tc, h.ft, ws)}</b><span>${snippet(h, ws)}</span></a>`).join('')}</div>`
        : `<div class="card"><div class="empty">${IC.help}<b>No topics match “${esc(q.trim())}”</b>Check the spelling or try other words.<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="helpAll">Show all topics</button></div></div></div>`;
      $('#helpAll', body) && ($('#helpAll', body).onclick = clear);
      body.querySelectorAll('.help-hit').forEach(a => a.onclick = () => { filtering = false; focusTitle = true; });
      return;
    }
    live.textContent = '';
    if (!t) { body.innerHTML = `<div class="help-grid">${TOPICS.map(x => `<a class="card help-card" href="#/help/${x.id}"><span class="n">${x.i + 1}</span><div><b>${esc(x.title)}</b><span>${esc(x.summary)}</span></div></a>`).join('')}</div>`; return; }
    const prev = TOPICS[t.i - 1], next = TOPICS[t.i + 1];
    body.innerHTML = `<div class="help-topic"><nav class="card help-toc" aria-label="Help topics"><h2>Topics</h2>${TOPICS.map(x => `<a href="#/help/${x.id}"${x === t ? ' class="on" aria-current="page"' : ''}>${esc(x.title)}</a>`).join('')}</nav>
      <article class="card help-art"><div class="help-art-b"><a class="crumb" href="#/help">${ICON.back}All topics</a><div class="help-doc"><h2 tabindex="-1">${esc(t.title)}</h2>${t.html}</div></div>
      <nav class="help-pn" aria-label="Previous and next topic">${prev ? `<a class="btn" href="#/help/${prev.id}">${ICON.back}<span><small>Previous</small>${esc(prev.title)}</span></a>` : '<span></span>'}${next ? `<a class="btn" href="#/help/${next.id}"><span><small>Next</small>${esc(next.title)}</span>${ICON.chev}</a>` : ''}</nav></article></div>`;
    if (focusTitle) { focusTitle = false; $('.help-doc h2', body).focus({ preventScroll: true }); }
    if (ws.length) highlight($('.help-doc', body), ws);
  }
  return {
    title: 'Help', subtitle: () => topic() ? '' : 'Step-by-step help for every part of the program.',
    mount(root) {
      el = root;
      if (parts()[1] && !topic()) history.replaceState(null, '', '#/help');   // an unknown topic: Help home
      el.innerHTML = `<div class="help"><div class="help-search"><span class="ic">${IC.search}</span><input class="input" type="search" id="helpQ" placeholder="Search the guide" aria-label="Search the guide" autocomplete="off" spellcheck="false" value="${esc(q)}"></div><p class="help-live" id="helpLive" aria-live="polite"></p><div id="helpBody"></div></div>`;
      const inp = $('#helpQ', el);
      inp.oninput = () => { q = inp.value; filtering = !!q.trim(); paint(); };
      inp.onkeydown = e => { if (e.key === 'Escape') clear(); else if (e.key === 'Enter') { const hits = search(q); if (hits?.length) open(hits[0]); } };
      document.addEventListener('keydown', onKey);
      paint();
    },
    leave() { document.removeEventListener('keydown', onKey); },
  };
}
