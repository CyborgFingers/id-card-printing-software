// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Finds the face in an ID photo, for Line up faces (render.js photoGeometry), with MediaPipe's face detector
// (js/vendor/mediapipe: offline, its usage logging to Google switched off), loaded the first time it's needed.
// It only finds where the eyes are; it never changes the photo.

const vendor = new URL('./vendor/mediapipe/', import.meta.url).href;
let detector = null;
const load = () => detector ??= import(vendor + 'vision_bundle.mjs')
  .then(({ FaceDetector }) => FaceDetector.createFromOptions({ wasmLoaderPath: vendor + 'vision_wasm_internal.js', wasmBinaryPath: vendor + 'vision_wasm_internal.wasm' },
    { baseOptions: { modelAssetPath: vendor + 'blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'IMAGE' }))
  .catch((e) => { detector = null; throw new Error(`The face finder could not start (${e.message || e}). Close the program and open it again.`); });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const biggest = (faces) => faces.filter(f => f.keypoints?.length >= 4).reduce((big, f) => !big || f.boundingBox.width * f.boundingBox.height > big.boundingBox.width * big.boundingBox.height ? f : big, null);
// Front on, the eyes are about 0.9 times as far apart as the point between them is from the mouth. A turned head brings
// the eyes closer, a tipped one the mouth, so the larger of the two is the face's size.
const EYES_TO_MOUTH = 0.9;

// One look at a picture (w x h): its biggest face, confirmed by looking again at a square around it, which the face then
// fills (the finder looks at a small copy of the picture, so a face that's small in it gets rough eye positions, and
// something that only looks like a face from afar isn't found again). Its points in the picture's pixels, and how sure
// the second look was; null when there's no face or it isn't confirmed.
function look(det, pic, w, h) {
  const f = biggest(det.detect(pic).detections);
  if (!f) return null;
  const b = f.boundingBox, side = Math.min(w, h, Math.max(b.width, b.height) * 2.2);
  const x0 = Math.min(Math.max(0, b.originX + b.width / 2 - side / 2), w - side), y0 = Math.min(Math.max(0, b.originY + b.height / 2 - side / 2), h - side);
  const crop = canvas(384, 384); crop.getContext('2d').drawImage(pic, x0, y0, side, side, 0, 0, 384, 384);
  const near = biggest(det.detect(crop).detections);
  return near && { score: near.categories[0].score, k: near.keypoints.map(p => ({ x: x0 + p.x * side, y: y0 + p.y * side })) };
}

/** A face from the finder's points (in the photo's pixels, w x h): { x, y, d }, the point between the eyes as parts of
 *  the photo's width and height, and the face's size as a part of its width (how far apart the eyes are, front on).
 *  `turned` when it isn't front on: the eyes less than 0.75 as far apart as front on, or the nose off to one side by
 *  more than 0.6 of the eyes' spacing (set so it catches the turned ones that can't be lined up, and a few
 *  three-quarter views that could, but no front-on face). */
export function faceFromPoints(k, w, h) {
  const [r, l, nose, mouth] = k, ex = (r.x + l.x) / 2, ey = (r.y + l.y) / 2;   // eyes, nose, mouth
  const eyes = Math.hypot(r.x - l.x, r.y - l.y), front = EYES_TO_MOUTH * Math.hypot(mouth.x - ex, mouth.y - ey);
  const aside = eyes ? Math.abs((nose.x - ex) * (l.x - r.x) + (nose.y - ey) * (l.y - r.y)) / (eyes * eyes) : 1;   // along the eye line, so a tilted head doesn't count
  return { x: ex / w, y: ey / h, d: Math.max(eyes, front) / w, ...((eyes < 0.75 * front || aside > 0.6) && { turned: true }) };
}

/** The face in a photo (an image or canvas), as faceFromPoints. The biggest face when there's more than one (the
 *  person at the front); null when none is found. */
export async function findFace(pic) {
  const det = await load(), w = pic.naturalWidth || pic.width, h = pic.naturalHeight || pic.height;
  // A face that nearly fills the photo is easier to find with a margin round it, so it's also looked for in a copy:
  // the photo smaller, in the middle of a canvas 1.8 times its size whose sides carry on its edge colours.
  const k = Math.min(1, 1024 / (1.8 * Math.max(w, h))), mw = Math.round(1.8 * w * k), mh = Math.round(1.8 * h * k), sw = w * k, sh = h * k;
  const m = canvas(mw, mh), mg = m.getContext('2d'), ox = (mw - sw) / 2, oy = (mh - sh) / 2;
  mg.drawImage(pic, 0, 0, 1, h, 0, 0, mw / 2, mh); mg.drawImage(pic, w - 1, 0, 1, h, mw / 2, 0, mw / 2, mh); mg.drawImage(pic, ox, oy, sw, sh);
  const plain = look(det, pic, w, h), margin = look(det, m, mw, mh);
  if (margin) margin.k = margin.k.map(p => ({ x: (p.x - ox) / k, y: (p.y - oy) / k }));
  const best = [plain, margin].filter(Boolean).sort((a, b) => b.score - a.score)[0];
  return best ? faceFromPoints(best.k, w, h) : null;
}
