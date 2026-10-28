// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Card renderer: draws one side of a card at print resolution (300 dpi pixels in the card's own
// orientation, e.g. CR80 638 x 1013 portrait or 1013 x 638 landscape) from a template's background
// and its placed elements.
import * as bwipjs from './vendor/bwip-js.mjs';

// Card sizes a template can print on: [short mm, long mm, short px, long px] at 300 dpi.
// CR80 keeps the 638 x 1013 px every earlier template used; the others are Math.round(mm / 25.4 * 300).
export const CARD_SIZES = { CR80: [53.98, 85.6, 638, 1013], CR79: [52.1, 83.9, 615, 991], CR100: [67, 98.5, 791, 1163] };
export const CUSTOM_MM = { min: 20, max: 150 };
const px = (mm) => Math.round(mm / 25.4 * 300);
const clampMm = (v) => Math.round(Math.max(CUSTOM_MM.min, Math.min(CUSTOM_MM.max, Number(v) || CUSTOM_MM.min)) * 10) / 10;
// Builds design.card = { w, h, size, mmW, mmH } (w/h in px, landscape when w > h) the same way the service does.
export function cardFor({ size = 'CR80', mmW, mmH, landscape = false }) {
  let s, l;
  if (CARD_SIZES[size]) [s, l] = CARD_SIZES[size];
  else { size = 'custom'; const a = clampMm(mmW), b = clampMm(mmH); s = Math.min(a, b); l = Math.max(a, b); }
  const [sp, lp] = CARD_SIZES[size] ? CARD_SIZES[size].slice(2) : [px(s), px(l)];
  return landscape ? { w: lp, h: sp, size, mmW: l, mmH: s } : { w: sp, h: lp, size, mmW: s, mmH: l };
}
// Reads a template's card (older templates have only { w, h }: treated as CR80).
export function cardInfo(card) {
  const c = card || {}; const landscape = (c.w || 638) > (c.h || 1013);
  const size = CARD_SIZES[c.size] || c.size === 'custom' ? c.size : 'CR80';
  const full = size === 'custom' && c.mmW && c.mmH ? { w: c.w, h: c.h, size, mmW: c.mmW, mmH: c.mmH } : cardFor({ size, mmW: c.mmW, mmH: c.mmH, landscape });
  return { ...full, landscape };
}
const mm = (v) => String(Math.round(v * 10) / 10);
export const cardLabel = (card) => { const c = cardInfo(card); return `${c.size === 'custom' ? 'Custom' : c.size} · ${c.landscape ? 'Landscape' : 'Portrait'}`; };
export const cardDims = (card) => { const c = cardInfo(card); return `${mm(c.mmW)} × ${mm(c.mmH)} mm · ${c.w} × ${c.h} px`; };

const imgCache = new Map();
/** A picture chosen for a template (background or logo) in a form the service keeps (PNG, JPG or WebP), at most
 *  maxSide pixels: anything this window can open works, such as GIF, BMP or SVG, and transparency is kept. */
export async function templateImage(file, maxSide = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error(`${file.name} can't be opened${/\.hei[cf]$/i.test(file.name) ? ': iPhone photos (HEIC) need saving as JPG first' : ''}. Choose a PNG, JPG or WebP picture.`);
    const iw = img.naturalWidth || 1200, ih = img.naturalHeight || 1200;   // an SVG without a size
    const k = Math.min(1, maxSide / Math.max(iw, ih));
    if (k === 1 && img.naturalWidth && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { blob: file, type: file.type, w: iw, h: ih };
    const c = document.createElement('canvas'); c.width = Math.round(iw * k); c.height = Math.round(ih * k);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    return { blob: await new Promise(r => c.toBlob(r, type, 0.92)), type, w: c.width, h: c.height };
  } finally { imgCache.delete(url); URL.revokeObjectURL(url); }
}
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => { imgCache.delete(src); resolve(null); };
    im.src = src;
  });
  imgCache.set(src, p);
  if (imgCache.size > 200) imgCache.delete(imgCache.keys().next().value);   // ponytail: drop the oldest; big imports would otherwise keep every photo
  return p;
}
export const assetUrl = (name) => name ? `/assets/${encodeURIComponent(name)}` : null;

export const FONTS = ['Fira Sans', 'Manrope', 'Montserrat', 'Roboto', 'Open Sans', 'Oswald', 'Calibri', 'Arial', 'Segoe UI', 'Verdana'];

// What a template can place on a card: person details, fixed text and design elements. "sample" is what the builder shows.
export const FIELDS = {
  photo: { label: 'Photo', kind: 'photo' },
  firstName: { label: 'First name', kind: 'text', sample: 'Alex', size: 64 },
  lastName: { label: 'Last name', kind: 'text', sample: 'Sample', size: 64 },
  staffId: { label: 'Staff ID number', kind: 'text', sample: 'ID-1042', size: 34 },
  position: { label: 'Position', kind: 'text', sample: 'Team Member', size: 34 },
  title: { label: 'Title', kind: 'text', sample: 'Mr', size: 34 },
  address: { label: 'Address', kind: 'multiline', sample: '12 Example Street\nThorndon, Wellington 6011', size: 28 },
  text: { label: 'Text', kind: 'text', sample: 'STAFF', size: 40 },
  image: { label: 'Logo or image', kind: 'image' },
  box: { label: 'Shape', kind: 'box' },
  barcode: { label: 'Barcode or QR code', kind: 'barcode' },
};
export const PERSON_FIELDS = ['firstName', 'lastName', 'staffId', 'position', 'title', 'address'];

// Person fields added in Settings (Department, Expiry date, Card number...), in settings order.
let CUSTOM = {};
const isoDate = (d) => d.toISOString().slice(0, 10);
export function setCustomFields(list) {
  const later = new Date(); later.setFullYear(later.getFullYear() + 3);
  CUSTOM = Object.fromEntries((list || []).map(f => [f.key, { label: f.label, kind: 'text', type: f.type, expiry: !!f.expiry, size: 34,
    sample: f.type === 'date' ? isoDate(f.expiry ? later : new Date()) : f.type === 'auto' ? `${f.prefix || ''}${'1'.padStart(f.digits || 4, '0')}` : f.label }]));
}
export const customFields = () => Object.keys(CUSTOM);
export const fieldInfo = (k) => FIELDS[k] || CUSTOM[k] || { label: 'Removed field', kind: 'text', sample: '' };
export const isPersonField = (k) => PERSON_FIELDS.includes(k) || k in CUSTOM;
// The person details a template needs (barcodes count their data field).
export const designFields = (d) => [...new Set((d?.elements || []).map(e => e.field === 'barcode' ? e.source : e.field).filter(k => k === 'photo' || isPersonField(k)))];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DATE_FORMATS = ['DD/MM/YYYY', 'D MMM YYYY', 'MMM YYYY', 'MM/YY', 'YYYY-MM-DD'];
// Dates are stored as YYYY-MM-DD and shown on the card in the element's format.
export function formatDate(iso, fmt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
  const [, y, mo, d] = m, mon = MONTHS[+mo - 1];
  return { 'D MMM YYYY': `${+d} ${mon} ${y}`, 'MMM YYYY': `${mon} ${y}`, 'MM/YY': `${mo}/${y.slice(2)}`, 'YYYY-MM-DD': iso }[fmt] || `${d}/${mo}/${y}`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Geometry used both for drawing and for drag-to-pan limits. The template's photo box either fills its frame
// (fit 'cover', trimming the edges) or shows the whole photo ('contain'); a person's zoom goes from the whole
// photo (minZoom) up to 4 times that starting size. A photo bigger than the frame moves until an edge meets the
// frame; a smaller one moves anywhere inside it. A zoom within 3% of filling the frame or of the whole photo snaps to
// it, so a photo that almost fills the frame never leaves a thin gap down one side.
export function photoGeometry(img, box, adj = {}) {
  const fill = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight), whole = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const base = box.fit === 'contain' ? whole : fill, minZoom = whole / base, fillZoom = fill / base;
  const asked = Math.max(minZoom, Math.min(4, adj.zoom || 1));
  const near = [fillZoom, minZoom].sort((a, b) => Math.abs(asked - a) - Math.abs(asked - b))[0];
  const zoom = Math.abs(asked / near - 1) < 0.03 ? near : asked;
  const scale = base * zoom;
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const maxX = Math.abs(dw - box.w) / 2, maxY = Math.abs(dh - box.h) / 2;
  const ox = Math.max(-maxX, Math.min(maxX, (adj.ox || 0) * box.w));
  const oy = Math.max(-maxY, Math.min(maxY, (adj.oy || 0) * box.h));
  return { dx: box.x + (box.w - dw) / 2 + ox, dy: box.y + (box.h - dh) / 2 + oy, dw, dh, maxX, maxY, minZoom };
}
// A picture's Darkness, Contrast and Colour (-50 to 50, 0 = as it is): the template's background, logos and ID photos.
// Shown on screen and printed, unlike Settings > Print adjustments, which only change printing. Darkness scales the
// picture towards black (or white), Contrast is an S curve that never clips, Colour changes saturation. Only pixels
// that were pure black end up pure black: HID FARGO printers can print pure black with the resin K panel, which
// would look blotchy in a photo's shadows.
export function toneLut(darkness = 0, contrast = 0) {
  const k = darkness / 100, spread = 1 + contrast / 100, lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = k >= 0 ? v * (1 - k) : v + (1 - v) * -k;
    v = v < 0.5 ? 0.5 * (2 * v) ** spread : 1 - 0.5 * (2 * (1 - v)) ** spread;
    lut[i] = i ? Math.max(1, Math.round(v * 255)) : 0;
  }
  return lut;
}
export function tonePixels(px, darkness = 0, contrast = 0, colour = 0) {
  const lut = toneLut(darkness, contrast), strength = 1 + colour / 100;
  for (let i = 0; i < px.length; i += 4) {
    const r = lut[px[i]], g = lut[px[i + 1]], b = lut[px[i + 2]], grey = 0.299 * r + 0.587 * g + 0.114 * b;
    px[i] = grey + (r - grey) * strength; px[i + 1] = grey + (g - grey) * strength; px[i + 2] = grey + (b - grey) * strength;
  }
  return px;
}
// The picture with its tone applied (a canvas the same size), or the picture itself. The last few are kept, so a
// background or logo is toned once for a whole batch; each person's photo is toned as their card is drawn.
const tonedCache = [];   // ponytail: 8 most recent, as a full-size canvas each; a batch never holds every photo
function toned(img, darkness = 0, contrast = 0, colour = 0) {
  if (!(darkness || contrast || colour)) return img;
  const key = `${darkness},${contrast},${colour}`, at = tonedCache.findIndex(t => t.img === img && t.key === key);
  if (at >= 0) { const [hit] = tonedCache.splice(at, 1); tonedCache.unshift(hit); return hit.canvas; }   // most recently used first
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height); tonePixels(data.data, darkness, contrast, colour); g.putImageData(data, 0, 0);
  tonedCache.unshift({ img, key, canvas: c }); tonedCache.length = Math.min(tonedCache.length, 8);
  return c;
}
// The first photo box on the front (used for drag-to-position in the person editor).
export const photoBox = (design) => (design?.elements || []).find(e => e.field === 'photo' && e.side === 'front') || null;

// The photo a template expects: its photo frame in pixels (template pixels are the printed pixels, 300 dpi), in mm,
// and its shape when it's a usual one (3:4...), so people can take or crop photos to fit. Null when it has no photo.
const SHAPES = [[1, 1], [3, 4], [4, 5], [2, 3], [5, 7], [7, 9]];
export function photoSpec(design) {
  const b = photoBox(design); if (!b) return null;
  const card = cardInfo(design.card), w = Math.round(b.w), h = Math.round(b.h), perPx = card.mmW / card.w;   // older templates have no mm sizes
  const r = w / h, s = SHAPES.find(([a, c]) => Math.abs(r / (a / c) - 1) < 0.02 || Math.abs(r / (c / a) - 1) < 0.02);
  const shape = s ? (s[0] === s[1] ? '1:1' : w < h ? `${s[0]}:${s[1]}` : `${s[1]}:${s[0]}`) : null;
  return { w, h, mmW: Math.round(w * perPx * 10) / 10, mmH: Math.round(h * perPx * 10) / 10, shape, orientation: w === h ? 'square' : w < h ? 'portrait' : 'landscape' };
}

function drawPlaceholder(ctx, b) {
  ctx.save();
  ctx.fillStyle = '#D5DEE8';
  const cx = b.x + b.w / 2, s = Math.min(b.w, b.h);
  ctx.beginPath(); ctx.arc(cx, b.y + b.h * 0.40, s * 0.20, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, b.y + b.h * 0.98, s * 0.42, b.h * 0.34, 0, Math.PI, 0); ctx.fill();
  ctx.restore();
}

const fontOf = (e, size) => `${e.weight || 500} ${size}px "${e.font || 'Fira Sans'}", sans-serif`;
function wrapLines(ctx, text, width) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    // Words, and a word too long for the line split after its hyphens (Smith-Jones), joined back without a space.
    const toks = para.split(/\s+/).filter(Boolean).flatMap(w => (ctx.measureText(w).width > width ? w.split(/(?<=-)/) : [w]).map((t, i) => ({ t, sp: i === 0 })));
    if (!toks.length) { out.push(''); continue; }
    let line = toks[0].t;
    for (const k of toks.slice(1)) { const t = line + (k.sp ? ' ' : '') + k.t; if (ctx.measureText(t).width <= width) line = t; else { out.push(line); line = k.t; } }
    out.push(line);
  }
  return out;
}
// Lay out a text field so it always stays inside its box: shrink from its size to its smallest size, then let a
// long line wrap if the box has room, then keep shrinking. top is where the first line's capitals start.
export function layoutText(ctx, e, value) {
  let wrap = e.field === 'address' || /\n/.test(value);
  let size = e.size || 40; const min = Math.min(e.minSize || 12, size);
  for (;;) {
    ctx.font = fontOf(e, size); ctx.letterSpacing = `${e.letterSpacing || 0}px`;
    const cap = ctx.measureText('H').actualBoundingBoxAscent || size * 0.7, lh = size * (e.lineHeight || 1.15);
    const lines = wrap ? wrapLines(ctx, value, e.w) : [value];
    const m = lines.map(l => ctx.measureText(l));
    // Macrons over capitals reach above the capitals, and descenders (g, y) below the last line.
    const asc = Math.max(cap, m[0].actualBoundingBoxAscent || 0), desc = m[m.length - 1].actualBoundingBoxDescent || 0;
    const block = cap + (lines.length - 1) * lh;
    if ((Math.max(...m.map(x => x.width)) <= e.w && asc + block - cap + desc <= e.h) || size <= 4) {
      let top = e.valign === 'top' ? e.y + asc - cap : e.valign === 'bottom' ? e.y + e.h - block - desc : e.y + (e.h - block) / 2;   // capitals line up across names
      top = Math.max(e.y + asc - cap, Math.min(top, e.y + e.h - block - desc));
      return { size, lines, cap, lh, top };
    }
    if (size <= min && !wrap && /[\s-]/.test(value.trim())) { wrap = true; continue; }   // a long name: two lines before going smaller
    size = size > min ? Math.max(min, size - 1) : size - 0.5;
  }
}

// Turns the context so a rotated element can be drawn as an upright box centred on (0, 0).
function turn(ctx, e) {
  const sideways = e.rotate === 90 || e.rotate === 270;
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2); ctx.rotate((e.rotate || 0) * Math.PI / 180);
  const w = sideways ? e.h : e.w, h = sideways ? e.w : e.h;
  return { ...e, x: -w / 2, y: -h / 2, w, h };
}

function drawText(ctx, e, value) {
  if (!value) return;
  if (e.uppercase) value = value.toLocaleUpperCase();
  ctx.save();
  const b = turn(ctx, e);
  const { lines, cap, lh, top } = layoutText(ctx, b, value);
  const x = b.align === 'left' ? b.x : b.align === 'right' ? b.x + b.w : b.x + b.w / 2;
  ctx.beginPath(); ctx.rect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); ctx.clip();
  ctx.fillStyle = e.color || '#111111'; ctx.textAlign = e.align || 'center'; ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, x, top + cap + i * lh));
  ctx.restore();
  ctx.letterSpacing = '0px';
}

async function drawImageEl(ctx, e, opts) {
  const im = await loadImage(assetUrl(e.asset));
  ctx.save(); ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
  if (im) {
    const k = (e.fit === 'cover' ? Math.max : Math.min)(e.w / im.naturalWidth, e.h / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(toned(im, e.darkness, e.contrast, e.colour), e.x + (e.w - w) / 2, e.y + (e.h - h) / 2, w, h);
  } else if (opts.placeholder !== false) { ctx.fillStyle = '#e9eef4'; ctx.fillRect(e.x, e.y, e.w, e.h); }
  ctx.restore();
}

function drawBox(ctx, e) {
  if (!e.noFill) { ctx.save(); roundRect(ctx, e.x, e.y, e.w, e.h, e.radius); ctx.fillStyle = e.fill || '#00529F'; ctx.fill(); ctx.restore(); }
  if (e.borderWidth > 0) { ctx.lineWidth = e.borderWidth; ctx.strokeStyle = e.borderColor || '#00529F'; roundRect(ctx, e.x + e.borderWidth / 2, e.y + e.borderWidth / 2, e.w - e.borderWidth, e.h - e.borderWidth, e.radius); ctx.stroke(); }
}

const SYMBOLS = {
  qrcode: { label: 'QR code', square: true }, datamatrix: { label: 'Data Matrix', square: true }, pdf417: { label: 'PDF417' },
  code128: { label: 'Code 128', linear: true }, code39: { label: 'Code 39', linear: true },
};
export const BARCODE_TYPES = Object.entries(SYMBOLS).map(([k, v]) => [k, v.label]);
export function barcodeValue(e, data, opts = {}) {
  if (e.source === 'text') return e.text || '';
  return fieldValue({ field: e.source }, data, opts);
}
// Draws the barcode to fit its box: square codes stay square, the others stretch. Returns an error message if the data can't be encoded.
export function drawBarcode(ctx, e, value) {
  if (!value) return null;
  const t = SYMBOLS[e.symbol] || SYMBOLS.qrcode;
  const c = document.createElement('canvas');
  try {
    bwipjs.toCanvas(c, { bcid: e.symbol in SYMBOLS ? e.symbol : 'qrcode', text: e.symbol === 'code39' ? value.toUpperCase() : value, scale: 4,
      barcolor: (e.color || '#000000').slice(1), includetext: !!(e.showText && t.linear), textxalign: 'center', ...(t.linear ? { height: 12 } : {}) });
  } catch (err) { return String(err.message || err).replace(/^[\w.#]+:\s*/, ''); }   // drop bwip-js's internal error code
  ctx.save();
  const b = turn(ctx, e);
  ctx.imageSmoothingEnabled = false;   // crisp bars
  if (t.square) { const s = Math.min(b.w, b.h); ctx.drawImage(c, -s / 2, -s / 2, s, s); }
  else ctx.drawImage(c, b.x, b.y, b.w, b.h);
  ctx.restore();
  return null;
}

function drawPhoto(ctx, e, data, opts) {
  ctx.save();
  roundRect(ctx, e.x, e.y, e.w, e.h, e.radius); ctx.clip();
  ctx.fillStyle = e.bgColor || '#e9eef4'; ctx.fillRect(e.x, e.y, e.w, e.h);
  if (data.photo) {
    const g = photoGeometry(data.photo, e, data.adj);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(toned(data.photo, e.darkness, e.contrast, e.colour), g.dx, g.dy, g.dw, g.dh);
  } else if (opts.placeholder !== false) drawPlaceholder(ctx, e);
  ctx.restore();
  if (e.borderWidth > 0) { ctx.lineWidth = e.borderWidth; ctx.strokeStyle = e.borderColor || '#00529F'; roundRect(ctx, e.x + e.borderWidth / 2, e.y + e.borderWidth / 2, e.w - e.borderWidth, e.h - e.borderWidth, e.radius); ctx.stroke(); }
}

export function fieldValue(e, data, opts = {}) {
  if (e.field === 'text') return e.text || '';
  if (!Object.hasOwn(FIELDS, e.field) && !Object.hasOwn(CUSTOM, e.field)) return '';   // the field was deleted in Settings
  const info = fieldInfo(e.field), v = data[e.field];
  const value = v != null && String(v).trim() !== '' ? String(v) : opts.samples ? (info.sample || '') : '';
  return info.type === 'date' ? formatDate(value, e.dateFormat) : value;
}

async function ensureFonts(design, side) {
  const seen = new Set();
  for (const e of design.elements || []) {
    if (e.side !== side || ['photo', 'image', 'box', 'barcode'].includes(e.field)) continue;
    const k = `${e.weight} ${e.font}`; if (seen.has(k)) continue; seen.add(k);
    try { await document.fonts.load(`${e.weight || 500} 40px "${e.font || 'Fira Sans'}"`, 'AZaz09āĀ'); } catch (x) {}   // ā loads the extended-Latin file (Māori macrons)
  }
}

/**
 * Draw one side of a card.
 * data: { firstName, lastName, staffId, position, title, address, <custom field keys>, photo: HTMLImageElement|null, adj }
 * opts: { samples: fill empty fields with sample text, placeholder: draw a silhouette when there is no photo,
 *         hide: element id to leave out (the builder draws a selection over it),
 *         errors: an array that collects barcodes that can't be made from the person's data,
 *         scale: 2 draws at 600 dpi for 600 dpi printers; templates stay in 300 dpi pixels }
 */
export async function drawCard(canvas, design, side, data = {}, opts = {}) {
  const { w, h } = design.card || { w: 638, h: 1013 };
  const k = opts.scale || 1;
  if (canvas.width !== w * k) canvas.width = w * k;
  if (canvas.height !== h * k) canvas.height = h * k;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const s = side === 'back' ? design.back : design.front;
  const bg = await loadImage(assetUrl(s && s.background));
  await ensureFonts(design, side);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = (s && s.bgColor) || '#ffffff'; ctx.fillRect(0, 0, w, h);
  if (bg) {   // fills the card; a picture of another shape is trimmed at the edges, never squashed
    const f = Math.max(w / bg.naturalWidth, h / bg.naturalHeight), bw = bg.naturalWidth * f, bh = bg.naturalHeight * f;
    ctx.save(); ctx.globalAlpha = s.bgOpacity ?? 1; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(toned(bg, s.bgDarkness, s.bgContrast, s.bgColour), (w - bw) / 2, (h - bh) / 2, bw, bh); ctx.restore();
  }
  for (const e of design.elements || []) {   // in list order: later elements are drawn on top
    if (e.side !== side) continue;
    ctx.save(); ctx.globalAlpha = e.opacity ?? 1;
    if (e.field === 'photo') drawPhoto(ctx, e, data, opts);
    else if (e.field === 'image') await drawImageEl(ctx, e, opts);
    else if (e.field === 'box') drawBox(ctx, e);
    else if (e.field === 'barcode') { const err = drawBarcode(ctx, e, barcodeValue(e, data, opts)); if (err && opts.errors) opts.errors.push(err); }
    else drawText(ctx, e, fieldValue(e, data, opts));
    ctx.restore();
  }
  ctx.restore();
  return canvas;
}

export async function cardDataUrl(design, side, data, errors, scale = 1) {
  const c = document.createElement('canvas');
  await drawCard(c, design, side, data, { placeholder: false, errors, scale });
  return c.toDataURL('image/png');
}
