'use client';
// Cutting the subject out of a photo (the background removed), like WhatsApp's sticker maker. It runs on the
// phone, in a background worker (./cutout.worker.js), with BRIA's RMBG-1.4 model through Transformers.js.
// The photo never leaves the phone; only the model is downloaded, from Hugging Face, the first time (about 45 MB),
// then the browser keeps it. RMBG-1.4 is free for non-commercial use (BRIA's licence), which this private app is.
export const MODEL = 'briaai/RMBG-1.4';
export const MODEL_MB = 45;
const MODEL_FILE = 'RMBG-1.4/resolve/main/onnx/model_quantized.onnx';

let worker = null;
let seq = 0;
const waiting = new Map(); // id → { resolve, reject, onProgress }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./cutout.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, type } = e.data;
    const w = waiting.get(id);
    if (!w) return;
    if (type === 'progress') w.onProgress?.(e.data);
    else if (type === 'done') { waiting.delete(id); w.resolve(e.data); }
    else if (type === 'error') {
      waiting.delete(id);
      console.warn('Cutout failed:', e.data.detail); // the technical reason, for whoever is debugging
      w.reject(new Error(e.data.message || 'The cutout failed.'));
    }
  };
  worker.onerror = () => {
    waiting.forEach((w) => w.reject(new Error("The cutout tool couldn't start on this device.")));
    waiting.clear();
    worker = null;
  };
  return worker;
}

// Is the model already on this device? (Transformers.js keeps downloads in Cache Storage)
export async function cutoutDownloaded() {
  try {
    const names = await caches.keys();
    for (const n of names) {
      const keys = await (await caches.open(n)).keys();
      if (keys.some((r) => r.url.includes(MODEL_FILE))) return true;
    }
  } catch { /* no Cache Storage: treat as not downloaded */ }
  return false;
}

// photo: a canvas (already shrunk) → the same size canvas with the background made transparent.
// onProgress({ phase: 'download', loaded, total } | { phase: 'cutting' })
export async function cutOut(photo, onProgress) {
  const blob = await new Promise((res) => photo.toBlob(res, 'image/png'));
  if (!blob) throw new Error("Couldn't read the photo.");
  const id = ++seq;
  const result = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, blob });
  });
  // the mask (one byte per pixel, at the photo's size) becomes the photo's transparency
  const { mask, width, height } = result;
  const out = document.createElement('canvas');
  out.width = photo.width;
  out.height = photo.height;
  const g = out.getContext('2d');
  g.drawImage(photo, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height);
  if (width !== out.width || height !== out.height) throw new Error('The cutout came back the wrong size.');
  for (let i = 0; i < mask.length; i++) img.data[i * 4 + 3] = Math.min(img.data[i * 4 + 3], mask[i]);
  g.putImageData(img, 0, 0);
  return out;
}
