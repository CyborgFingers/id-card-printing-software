// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Proof sheet: the chosen people's cards at actual size on one page, to print or save as PDF
// (from the print dialog) and send to the client to check before printing.
import { drawCard, loadImage, cardInfo, cardDims } from './render.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function makeProofSheet({ client, people, design, sides, photoUrl }) {
  const win = window.open('about:blank', '_blank');   // opened during the click, so pop-up blockers allow it
  if (!win) throw new Error('The proof sheet could not be opened.');
  try {
    const card = cardInfo(design.card);
    const w = `${card.mmW}mm`, h = `${card.mmH}mm`;
    const backs = design.back?.enabled && sides !== 'front';
    const canvas = document.createElement('canvas');
    const side = async (name, data) => { await drawCard(canvas, design, name, data, { placeholder: false }); return canvas.toDataURL('image/jpeg', 0.9); };
    const cards = [];
    for (const p of people) {
      const data = { ...(p.extra || {}), ...p, photo: p.hasPhoto ? await loadImage(photoUrl(p)) : null, adj: p.adj };
      cards.push({ name: `${p.firstName} ${p.lastName}`.trim(), front: await side('front', data), back: backs ? await side('back', data) : null });
    }
    const img = (src, label) => `<figure><img src="${src}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>`;
    const html = `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><title>Card proofs - ${esc(client.name)}</title><style>
      body { font: 13px/1.4 "Segoe UI", Arial, sans-serif; color: #1a2330; margin: 24px; background: #fff; }
      h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 16px; color: #555; }
      .cards { display: flex; flex-wrap: wrap; gap: 8mm 6mm; }
      .card { display: flex; gap: 3mm; break-inside: avoid; }
      figure { margin: 0; } figcaption { font-size: 11px; color: #555; margin-top: 2px; max-width: ${w}; }
      img { width: ${w}; height: ${h}; display: block; border-radius: 3mm; outline: 0.2mm solid #c8ced6; }
      button { font: inherit; padding: 6px 14px; margin-bottom: 16px; cursor: pointer; }
      @media print { body { margin: 0; } button { display: none; } @page { margin: 12mm; } }
    </style></head><body>
      <button onclick="print()">Print or save as PDF</button>
      <h1>Card proofs: ${esc(client.name)}</h1>
      <p>${esc(design.name)} · ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} · ${new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}. Actual size: ${card.size === 'custom' ? 'custom' : card.size}, ${esc(cardDims(design.card).split(' · ')[0])}.</p>
      <div class="cards">${cards.map(c => `<div class="card">${img(c.front, c.back ? `${c.name} (front)` : c.name)}${c.back ? img(c.back, `${c.name} (back)`) : ''}</div>`).join('')}</div>
    </body></html>`;
    win.location = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  } catch (e) { win.close(); throw e; }
}
