'use client';
// My saved stickers (users/{uid}/stickers/{key}): the ones I starred (favourites) and the ones I sent (recents).
// They're in my account, so they follow me to every device. The key is "pack-id" for a built-in sticker and the
// image's SHA-256 for a made or received one, so the same sticker is only ever kept once (firestore.rules agrees).
// Also here: making a sticker from a photo.
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, deleteField, doc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { MAX_STICKER_B64 } from './data';
import { fb } from './firebase';
import { toDate } from './people';
import { stickerKey } from './stickerPacks';

export const MAX_SAVED = 200; // per person; past this the oldest that isn't a favourite goes
export const RECENT_N = 30;

const col = (uid) => collection(fb().db, 'users', uid, 'stickers');
const ms = (ts) => (ts ? toDate(ts).getTime() : 0);
// what a saved doc holds of the sticker itself (no hash: it's the doc's key)
const body = (s) => (s.pack ? { pack: s.pack, id: s.id } : { data: s.data, mime: s.mime });
// a saved doc back into the shape a message stores
const fromDoc = (d) => (d.pack ? { pack: d.pack, id: d.id } : { data: d.data, mime: d.mime, hash: d.key });

// live: { docs, ready (loaded once), favourites, recent, isFav(sticker) }
export function useMyStickers(uid) {
  const [docs, setDocs] = useState(null);
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(col(uid), (s) => setDocs(s.docs.map((d) => ({ key: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))), () => setDocs([]));
  }, [uid]);
  return useMemo(() => {
    if (!docs) return { docs: [], ready: false, favourites: [], recent: [], isFav: () => false };
    const favs = new Set(docs.filter((d) => d.fav).map((d) => d.key));
    const favourites = docs.filter((d) => d.fav).sort((a, b) => ms(b.favAt) - ms(a.favAt)).map((d) => ({ ...fromDoc(d), key: d.key }));
    const recent = docs.filter((d) => d.lastUsedAt).sort((a, b) => ms(b.lastUsedAt) - ms(a.lastUsedAt)).slice(0, RECENT_N)
      .map((d) => ({ ...fromDoc(d), key: d.key }));
    return { docs, ready: true, favourites, recent, isFav: (s) => favs.has(stickerKey(s)) };
  }, [docs]);
}

// I sent it: it goes to the top of my recents. docs: my saved ones now, to keep within MAX_SAVED.
export async function touchSticker(uid, s, docs = []) {
  const key = stickerKey(s);
  if (!key) return;
  await setDoc(doc(col(uid), key), { ...body(s), lastUsedAt: serverTimestamp() }, { merge: true });
  await trim(uid, docs, key);
}

// star or unstar it
export async function setFav(uid, s, on, docs = []) {
  const key = stickerKey(s);
  if (!key) return;
  await setDoc(doc(col(uid), key), { ...body(s), fav: on, favAt: on ? serverTimestamp() : deleteField() }, { merge: true });
  if (on) await trim(uid, docs, key);
}

// over the cap: the least recently used ones that aren't favourites go first
async function trim(uid, docs, justUsed) {
  const count = docs.length + (docs.some((d) => d.key === justUsed) ? 0 : 1);
  if (count <= MAX_SAVED) return;
  const spare = docs.filter((d) => !d.fav && d.key !== justUsed).sort((a, b) => ms(a.lastUsedAt) - ms(b.lastUsedAt));
  await Promise.all(spare.slice(0, count - MAX_SAVED).map((d) => deleteDoc(doc(col(uid), d.key)).catch(() => {})));
}

// SHA-256 of the image's bytes, as hex
export async function hashOf(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const blobB64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(',') + 1)); };
  fr.onerror = () => rej(fr.error || new Error('could not read the image'));
  fr.readAsDataURL(blob);
});
const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

// a photo → a picture the browser can draw (turned the right way up, as the camera took it)
export async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// draw(ctx, px) paints the sticker onto a px×px transparent canvas → a sticker { data, mime, hash }:
// 512×512 WebP (transparency kept), made smaller in steps until it fits (at most MAX_STICKER_B64 base64
// characters, about 60 KB). Browsers that can't make WebP (older Safari) get PNG, made smaller in size instead.
export async function exportSticker(draw) {
  for (const px of [512, 448, 384, 320, 256]) {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    draw(g, px);
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await toBlob(c, 'image/webp', q);
      if (!blob) break;
      if (blob.type !== 'image/webp') {
        // no WebP here: PNG, which has no quality setting, so only the size can shrink
        const b64 = await blobB64(blob);
        if (b64.length <= MAX_STICKER_B64) return { data: b64, mime: 'image/png', hash: await hashOf(b64) };
        break;
      }
      const b64 = await blobB64(blob);
      if (b64.length <= MAX_STICKER_B64) return { data: b64, mime: 'image/webp', hash: await hashOf(b64) };
    }
  }
  throw new Error("This picture can't be made small enough for a sticker. Try another one.");
}

// the square crop of img (crop: { x, y, size } in the image's own pixels) → a sticker
export const makeSticker = (img, crop) => exportSticker((g, px) => g.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, px, px));

// the whole picture fitted inside the square (nothing cut off), on a transparent background
export const fitSticker = (img) => exportSticker((g, px) => {
  const k = px / Math.max(img.width, img.height);
  const w = img.width * k;
  const h = img.height * k;
  g.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
});

// ---------- importing stickers (from WhatsApp's sticker folder on Android, or saved / copied from WhatsApp Web) ----------
const IMPORT_TYPES = /^image\/(webp|png|gif|jpeg)$/;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // a sticker is far smaller; anything bigger isn't one

// one file → a sticker. A WebP that already fits is kept byte for byte, so animated WhatsApp stickers keep moving;
// anything else is fitted into 512×512 and made small enough (an animated one keeps its first picture).
export async function stickerFromFile(file) {
  if (!IMPORT_TYPES.test(file.type || '') && !/\.(webp|png|gif|jpe?g)$/i.test(file.name || '')) throw new Error('not a picture');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('too big');
  if ((file.type === 'image/webp' || /\.webp$/i.test(file.name || '')) && file.size <= (MAX_STICKER_B64 / 4) * 3) {
    const b64 = await blobB64(file);
    const head = atob(b64.slice(0, 16));
    if (b64.length <= MAX_STICKER_B64 && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
      // only if it really is a picture this browser can show (a damaged file can still start like one)
      const ok = typeof createImageBitmap !== 'function' || await createImageBitmap(file).then((b) => { b.close?.(); return true; }, () => false);
      if (!ok) throw new Error('not a picture');
      return { data: b64, mime: 'image/webp', hash: await hashOf(b64) };
    }
  }
  const img = await loadImage(file);
  return fitSticker(img);
}

// Bring files in as favourites. Already saved ones are skipped; it stops at MAX_SAVED without removing any of mine.
// onProgress({ done, total }) · → { added, already, failed, full }
export async function importStickers(uid, files, docs = [], onProgress = () => {}) {
  const have = new Set(docs.map((d) => d.key));
  let room = MAX_SAVED - docs.length;
  const out = { added: 0, already: 0, failed: 0, full: 0 };
  let batch = writeBatch(fb().db);
  let pending = 0;
  const flush = async () => { if (pending) { await batch.commit(); batch = writeBatch(fb().db); pending = 0; } };
  for (let i = 0; i < files.length; i++) {
    onProgress({ done: i, total: files.length });
    if (room <= 0) { out.full = files.length - i; break; }
    let s;
    try { s = await stickerFromFile(files[i]); } catch { out.failed++; continue; }
    if (have.has(s.hash)) { out.already++; continue; }
    have.add(s.hash);
    batch.set(doc(col(uid), s.hash), { data: s.data, mime: s.mime, fav: true, favAt: serverTimestamp() });
    pending++;
    room--;
    out.added++;
    if (pending >= 25) await flush(); // well inside a write's size limit (25 × 80 KB)
  }
  await flush();
  onProgress({ done: files.length, total: files.length });
  return out;
}

// Stickers shared to the app from Android's share sheet: public/push-sw.js keeps the files in Cache Storage
// ('shared-stickers') and opens the chat. Taking them empties it, so they're only imported once.
export async function takeSharedStickers() {
  try {
    if (!(await caches.has('shared-stickers'))) return [];
    const cache = await caches.open('shared-stickers');
    const files = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (res) {
        const blob = await res.blob();
        files.push(new File([blob], decodeURIComponent(res.headers.get('X-Name') || 'sticker.webp'), { type: blob.type || 'image/webp' }));
      }
    }
    await caches.delete('shared-stickers');
    return files;
  } catch {
    return [];
  }
}
