// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Enhance for ID photos (enhancePixels), and whether a photo needs it. Pure functions on RGBA pixels, so they also run in tests.

// The mean of each pixel's (2r + 1)² square (the edges repeat), across then down, for one colour of a picture. Down is
// worked a row at a time (running sums for every column), which is several times faster than column by column.
function boxMean(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), sums = new Float32Array(w), k = 2 * r + 1;
  const cx = (x) => Math.min(w - 1, Math.max(0, x)), row = (y) => Math.min(h - 1, Math.max(0, y)) * w;
  for (let y = 0; y < h; y++) { const o = y * w; let s = 0; for (let t = -r; t <= r; t++) s += src[o + cx(t)]; for (let x = 0; x < w; x++) { tmp[o + x] = s / k; s += src[o + cx(x + r + 1)] - src[o + cx(x - r)]; } }
  for (let t = -r; t <= r; t++) { const o = row(t); for (let x = 0; x < w; x++) sums[x] += tmp[o + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, add = row(y + r + 1), drop = row(y - r);
    for (let x = 0; x < w; x++) { out[o + x] = sums[x] / k; sums[x] += tmp[add + x] - tmp[drop + x]; }
  }
  return out;
}
const brightness = (rgb) => Float32Array.from(rgb[0], (r, i) => 0.299 * r + 0.587 * rgb[1][i] + 0.114 * rgb[2][i]);
// How grainy a picture is, as a standard deviation: how much its brightness `y` varies within small squares (radius r)
// in the plainest fifth of it, such as an ID photo's backdrop, where only grain makes it vary. Areas that are black or
// white (clipped) show no grain, so they aren't counted.
function grain(y, w, h, r) {
  const n = w * h, m = boxMean(y, w, h, r), sq = boxMean(y.map(v => v * v), w, h, r), bins = new Uint32Array(257);   // in quarters, up to 64
  let count = 0;
  for (let i = 0; i < n; i++) if (m[i] > 5 && m[i] < 250) { bins[Math.min(256, Math.round(Math.sqrt(Math.max(0, sq[i] - m[i] * m[i])) * 4))]++; count++; }
  let s = 0; for (let b = 0; b < 257; b++) if ((s += bins[b]) > count / 5) return b / 4;
  return 0;
}
// Smooths one colour but keeps its edges (He's guided filter, guided by the picture itself): where it varies about as
// much as the grain (eps) it becomes its average; where it varies far more (an edge, an eye) it stays as it is.
function smoothGrain(p, w, h, r, eps) {
  const mean = boxMean(p, w, h, r), sq = boxMean(p.map(v => v * v), w, h, r);
  const a = mean.map((m, i) => { const v = sq[i] - m * m; return v / (v + eps); }), b = mean.map((m, i) => m - a[i] * m);
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  for (let i = 0; i < p.length; i++) p[i] = ma[i] * p[i] + mb[i];
}
// Local contrast (CLAHE): each of 8 × 8 tiles gets its own levels from its own histogram, clipped at twice the average
// so a plain area isn't stretched, blended between tiles. Used at half strength, on brightness: the same change goes on
// red, green and blue, so colours stay as they are. The change is worked out from the brightness with grain and fine
// texture smoothed away (as smoothGrain, `eps`), so shading and features are lifted but grain isn't stretched.
function localContrast(rgb, w, h, eps) {
  const T = 8, n = w * h, Y = new Uint8ClampedArray(n), maps = [], base = brightness(rgb);
  smoothGrain(base, w, h, Math.max(1, Math.round(Math.max(w, h) / 400)), eps);
  for (let i = 0; i < n; i++) Y[i] = base[i];
  for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
    const hist = new Float32Array(256); let count = 0, excess = 0;
    for (let y = Math.floor(ty * h / T); y < Math.floor((ty + 1) * h / T); y++) for (let x = Math.floor(tx * w / T); x < Math.floor((tx + 1) * w / T); x++) { hist[Y[y * w + x]]++; count++; }
    const clip = 2 * count / 256;
    for (let v = 0; v < 256; v++) if (hist[v] > clip) { excess += hist[v] - clip; hist[v] = clip; }
    const map = new Float32Array(256); let s = 0;
    for (let v = 0; v < 256; v++) { s += hist[v] + excess / 256; map[v] = count ? s / count * 255 : v; }
    maps.push(map);
  }
  const near = (pos, size) => { const f = Math.min(T - 1, Math.max(0, (pos + 0.5) * T / size - 0.5)), a = Math.floor(f); return [a, Math.min(T - 1, a + 1), f - a]; };
  for (let y = 0; y < h; y++) {
    const [y0, y1, dy] = near(y, h);
    for (let x = 0; x < w; x++) {
      const [x0, x1, dx] = near(x, w), i = y * w + x, v = Y[i], m = (t, u) => maps[t * T + u][v];
      const d = ((1 - dy) * ((1 - dx) * m(y0, x0) + dx * m(y0, x1)) + dy * ((1 - dx) * m(y1, x0) + dx * m(y1, x1)) - v) / 2;
      rgb[0][i] += d; rgb[1][i] += d; rgb[2][i] += d;
    }
  }
}
// A photo's levels: its darkest and lightest 0.5% (of any colour) are `range` apart, and `level(v)` (0 to 1) sets them
// to black and white (never stretching more than three times).
function levelsOf(px, w, h) {
  const hist = [0, 1, 2].map(() => new Uint32Array(256)), n = w * h;
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) hist[c][px[i + c]]++;
  const at = (hs, count) => { let s = 0; for (let v = 0; v < 255; v++) if ((s += hs[v]) > count) return v; return 255; };
  const lo = Math.min(...hist.map(hs => at(hs, n * 0.005))), range = Math.max(...hist.map(hs => at(hs, n * 0.995))) - lo, span = Math.max(range, 85);
  return { range, level: (v) => Math.min(1, Math.max(0, (v - lo) / span)) };
}
const grainRadius = (w, h) => Math.max(1, Math.round(Math.max(w, h) / 400));
// Whether a photo is off, so worth enhancing, measured on the photo as it's kept, as Enhance would see it. It's off when:
//  flat    its darkest and lightest parts are less than 170 of 255 apart (Enhance would stretch it more than 1.5
//          times): dull, washed out or too dark all over;
//  grainy  its grain, once its levels are set, is over 3 of 255.
// A dark face alone doesn't count, as a face in shadow looks just like darker skin, nor does a photo that's only soft
// (Enhance's light sharpen can't fix blur). The file's size says nothing about any of these: it mostly follows the
// photo's pixel count and how much it was compressed. `poor`: clearly so (less than 150 apart, or grain over 5), worth
// telling someone about rather than just enhancing.
export function photoCheck(px, w, h) {
  const { range, level } = levelsOf(px, w, h);
  const y = Float32Array.from({ length: w * h }, (_, j) => (0.299 * level(px[j * 4]) + 0.587 * level(px[j * 4 + 1]) + 0.114 * level(px[j * 4 + 2])) * 255);
  const noise = grain(y, w, h, Math.max(2, grainRadius(w, h)));
  return { range, grain: noise, off: range < 170 || noise > 3, poor: range < 150 || noise > 5 };
}
// Enhance an ID photo using only what's in it (nothing is made up, as AI "restoring" would), in this order:
//  1. the darkest and lightest 0.5% become black and white (never stretched more than three times);
//  2. grain (brought up by step 1) is smoothed, only as much as the photo's own grain and keeping edges: a clean photo
//     is left as it is;
//  3. detail in shadows and light areas is brought out (local contrast);
//  4. a light sharpen of what stands out from the grain.
// No step moves colours (a light blue backdrop looks just like a blue cast, and taking the "cast" out turns the face
// orange), and no face is lightened to a set brightness (a face in shadow looks just like darker skin, which must stay
// as it is). As for tone, only pure black stays pure black (FARGO resin K panel). Changes `px` (RGBA) and returns it.
export function enhancePixels(px, w, h) {
  const n = w * h, { level } = levelsOf(px, w, h), rgb = [0, 1, 2].map(c => Float32Array.from({ length: n }, (_, j) => level(px[j * 4 + c]) * 255));
  const r = grainRadius(w, h), noise = grain(brightness(rgb), w, h, Math.max(2, r));
  if (noise > 2) for (const p of rgb) smoothGrain(p, w, h, r, (2 * noise) ** 2);
  localContrast(rgb, w, h, Math.max(16, (2 * noise) ** 2));
  // Sharpen (unsharp mask): each pixel pushed half-way further from the average around it, unless it differs from it by
  // no more than the grain.
  const sr = Math.max(1, Math.round(Math.max(w, h) / 800)), least = Math.max(2, noise);
  for (const p of rgb) { const blur = boxMean(p, w, h, sr); for (let j = 0; j < n; j++) { const d = p[j] - blur[j]; if (Math.abs(d) > least) p[j] += 0.5 * d; } }
  for (let j = 0; j < n; j++) for (let c = 0; c < 3; c++) { const i = j * 4 + c; px[i] = px[i] ? Math.max(1, rgb[c][j]) : 0; }
  return px;
}
