'use client';
// My saved stickers (users/{uid}/stickers/{key}): the ones I starred (favourites) and the ones I sent (recents).
// They're in my account, so they follow me to every device. The key is "pack-id" for a built-in sticker and the
// image's SHA-256 for a made or received one, so the same sticker is only ever kept once (firestore.rules agrees).
// Also here: making a sticker from a photo.
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, deleteField, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
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

// live: { favourites, recent, isFav(sticker) }
export function useMyStickers(uid) {
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(col(uid), (s) => setDocs(s.docs.map((d) => ({ key: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))), () => setDocs([]));
  }, [uid]);
  return useMemo(() => {
    const favs = new Set(docs.filter((d) => d.fav).map((d) => d.key));
    const favourites = docs.filter((d) => d.fav).sort((a, b) => ms(b.favAt) - ms(a.favAt)).map((d) => ({ ...fromDoc(d), key: d.key }));
    const recent = docs.filter((d) => d.lastUsedAt).sort((a, b) => ms(b.lastUsedAt) - ms(a.lastUsedAt)).slice(0, RECENT_N)
      .map((d) => ({ ...fromDoc(d), key: d.key }));
    return { docs, favourites, recent, isFav: (s) => favs.has(stickerKey(s)) };
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

// The square crop of img (crop: { x, y, size } in the image's own pixels) → a sticker { data, mime, hash }:
// 512×512 WebP, made smaller in steps until it fits (at most MAX_STICKER_B64 base64 characters, about 60 KB).
// Browsers that can't make WebP (older Safari) get PNG, made smaller in size instead.
export async function makeSticker(img, crop) {
  for (const px of [512, 448, 384, 320, 256]) {
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, px, px);
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
