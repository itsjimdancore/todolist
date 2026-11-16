'use client';
// Drawing a sticker being made (StickerEditor): the photo (cut out or not), its white outline, the pen strokes,
// then the text and emoji on top. Everything is kept in one 512×512 space, so the same drawing makes both the
// on-screen preview and the sticker that is sent (exportSticker in ./stickers).
//   state = {
//     base: canvas | null              the photo, already shrunk; transparent where it was cut out
//     frame: { cx, cy, scale }         where the photo sits: its middle, and 512-space pixels per photo pixel
//     outline: bool                    a white edge around a cut-out photo, like WhatsApp
//     strokes: [{ color, width, pts: [[x, y], …] }]
//     items: [{ id, kind: 'text' | 'emoji', text, color, font, x, y, size, rot }]
//   }
export const SIZE = 512;
export const OUTLINE = 10; // the white edge, in 512-space pixels

export const FONTS = {
  bold: { label: 'Bold', css: "800 {s}px 'Arial Rounded MT Bold', 'Nunito', 'Segoe UI', system-ui, sans-serif" },
  serif: { label: 'Serif', css: "700 {s}px Lora, Georgia, serif" },
  hand: { label: 'Hand', css: "700 {s}px 'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive" },
};
export const COLORS = ['#ffffff', '#111111', '#f15c6d', '#f0b45a', '#4fc2b0', '#7c5cc4'];
const EMOJI_FONT = "{s}px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

export const fontFor = (item) => (item.kind === 'emoji' ? EMOJI_FONT : (FONTS[item.font] || FONTS.bold).css).replace('{s}', Math.round(item.size));

// the photo's silhouette in white (for the outline): the same shape, every visible pixel white
const silhouettes = new WeakMap();
function silhouette(base) {
  let s = silhouettes.get(base);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = base.width;
  s.height = base.height;
  const g = s.getContext('2d');
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, s.width, s.height);
  silhouettes.set(base, s);
  return s;
}

// an item's box (for picking it up with a finger): half width / height around its middle, before rotation
const measurer = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
export function itemBox(item) {
  measurer.font = fontFor(item);
  const lines = String(item.text).split('\n');
  const w = Math.max(...lines.map((l) => measurer.measureText(l).width));
  return { hw: w / 2 + 8, hh: (item.size * 1.15 * lines.length) / 2 + 6 };
}

// is the 512-space point on this item? (its rotated box)
export function hits(item, x, y) {
  const { hw, hh } = itemBox(item);
  const dx = x - item.x;
  const dy = y - item.y;
  const c = Math.cos(-item.rot);
  const s = Math.sin(-item.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

// draw the sticker onto g, px pixels square (the background stays transparent)
export function drawSticker(g, px, state) {
  g.save();
  g.clearRect(0, 0, px, px);
  g.scale(px / SIZE, px / SIZE);
  const { base, frame } = state;
  if (base) {
    const w = base.width * frame.scale;
    const h = base.height * frame.scale;
    const x = frame.cx - w / 2;
    const y = frame.cy - h / 2;
    if (state.outline) {
      const sil = silhouette(base);
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        g.drawImage(sil, x + Math.cos(a) * OUTLINE, y + Math.sin(a) * OUTLINE, w, h);
      }
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, x, y, w, h);
  }
  for (const st of state.strokes) {
    if (!st.pts.length) continue;
    g.strokeStyle = st.color;
    g.lineWidth = st.width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(st.pts[0][0], st.pts[0][1]);
    if (st.pts.length === 1) g.lineTo(st.pts[0][0] + 0.01, st.pts[0][1]);
    for (let i = 1; i < st.pts.length; i++) g.lineTo(st.pts[i][0], st.pts[i][1]);
    g.stroke();
  }
  for (const it of state.items) {
    g.save();
    g.translate(it.x, it.y);
    g.rotate(it.rot);
    g.font = fontFor(it);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = String(it.text).split('\n');
    const lh = it.size * 1.15;
    lines.forEach((line, i) => {
      const ly = (i - (lines.length - 1) / 2) * lh;
      if (it.kind === 'text') {
        // an edge in the opposite shade, so it reads on any picture (and on a transparent sticker)
        g.lineWidth = Math.max(4, it.size * 0.16);
        g.lineJoin = 'round';
        g.strokeStyle = it.color === '#ffffff' ? '#111111' : '#ffffff';
        g.strokeText(line, 0, ly);
        g.fillStyle = it.color;
      }
      g.fillText(line, 0, ly);
    });
    g.restore();
  }
  g.restore();
}

// the box (in the photo's own pixels) holding everything visible after a cutout, or null if nothing is
export function visibleBounds(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (d[(y * w + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// a frame showing the whole of `box` (photo pixels) inside the sticker, with room for the outline
export function frameFor(base, box = { x: 0, y: 0, w: base.width, h: base.height }, margin = 28) {
  const scale = (SIZE - margin * 2) / Math.max(box.w, box.h);
  return {
    cx: SIZE / 2 - (box.x + box.w / 2 - base.width / 2) * scale,
    cy: SIZE / 2 - (box.y + box.h / 2 - base.height / 2) * scale,
    scale,
  };
}
