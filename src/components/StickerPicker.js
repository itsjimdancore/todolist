'use client';
import { useEffect, useRef, useState } from 'react';
import { PACKS, stickerLabel, stickerSrc } from '@/lib/stickerPacks';
import { loadImage, makeSticker } from '@/lib/stickers';

// The Stickers side of the chat's emoji panel. Tabs along the top: ★ Favourites, 🕘 Recent, one per pack, ＋ Create.
// Tapping a sticker sends it straight away, like WhatsApp. In Favourites, long-press (or right-click) one to
// remove it. mine: useMyStickers() · onSend(sticker) · onFav(sticker, on) · onMade(sticker): send a new one
export default function StickerPicker({ mine, onSend, onFav, onMade }) {
  const { favourites = [], recent = [] } = mine || {};
  const tabs = [
    ...(favourites.length ? [{ id: 'fav', name: 'Favourites', icon: '★' }] : []),
    ...(recent.length ? [{ id: 'recent', name: 'Recent', icon: '🕘' }] : []),
    ...PACKS.map((p) => ({ id: `pack:${p.id}`, name: p.name, img: stickerSrc({ pack: p.id, id: p.icon }) })),
    { id: 'make', name: 'Make a sticker from a photo', icon: '＋' },
  ];
  const [tab, setTab] = useState(null); // null: Recent if there are some, else the first pack
  const shown = tabs.find((t) => t.id === tab) || tabs.find((t) => t.id === (recent.length ? 'recent' : `pack:${PACKS[0].id}`));

  const list = shown.id === 'fav' ? favourites : shown.id === 'recent' ? recent
    : shown.id.startsWith('pack:') ? PACKS.find((p) => `pack:${p.id}` === shown.id).stickers : [];

  return (
    <>
      <div className="emo-tabs stk-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={shown.id === t.id} title={t.name} aria-label={t.name}
            className={shown.id === t.id ? 'emo-tab on' : 'emo-tab'} onClick={() => setTab(t.id)}>
            {t.img ? <img src={t.img} alt="" width={26} height={26} draggable={false} /> : <span className={t.id === 'fav' ? 'stk-star' : ''}>{t.icon}</span>}
          </button>
        ))}
      </div>
      {shown.id === 'make' ? (
        <Maker onSend={onMade} onDone={() => setTab(null)} />
      ) : (
        <>
          <p className="emo-h">{shown.name}{shown.id === 'fav' && <span className="stk-hint"> · press and hold to remove</span>}</p>
          <div className="stk-grid">
            {list.map((s) => (
              <StickerButton key={s.key || `${s.pack}-${s.id}`} s={s} onSend={onSend}
                onHold={shown.id === 'fav' ? () => onFav(s, false) : null} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function StickerButton({ s, onSend, onHold }) {
  const t = useRef(null);
  const held = useRef(false);
  const label = stickerLabel(s);
  const start = (e) => {
    if (!onHold || e.pointerType === 'mouse') return;
    held.current = false;
    t.current = setTimeout(() => { held.current = true; navigator.vibrate?.(15); onHold(); }, 500);
  };
  const stop = () => clearTimeout(t.current);
  return (
    <button type="button" className="stk" title={label} aria-label={`Send sticker: ${label}`}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={(e) => { if (onHold) { e.preventDefault(); onHold(); } }}
      onClick={() => { if (held.current) { held.current = false; return; } onSend(s); }}>
      <img src={stickerSrc(s)} alt="" loading="lazy" draggable={false} />
    </button>
  );
}

// ＋ Create: pick a photo, drag it and zoom to choose the square, then send it (it's also kept in Favourites).
const BOX = 220; // the crop square on screen, in CSS pixels
function Maker({ onSend, onDone }) {
  const file = useRef(null);
  const canvas = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 }); // the picture's top-left inside the square, CSS pixels
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const drag = useRef(null);

  const w = img?.width || 1;
  const h = img?.height || 1;
  const scale = (BOX / Math.min(w, h)) * zoom; // CSS pixels per image pixel
  const clamp = (o) => ({ x: Math.min(0, Math.max(BOX - w * scale, o.x)), y: Math.min(0, Math.max(BOX - h * scale, o.y)) });

  async function pick(f) {
    setErr('');
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Pick a picture.'); return; }
    setBusy('Opening…');
    try {
      const im = await loadImage(f);
      const s = BOX / Math.min(im.width, im.height);
      setImg(im);
      setZoom(1);
      setOff({ x: (BOX - im.width * s) / 2, y: (BOX - im.height * s) / 2 }); // centred
    } catch {
      setErr("This picture can't be opened here. Try another one.");
    }
    setBusy('');
  }

  // keep the square filled when zooming, around its middle
  function zoomTo(z) {
    const s0 = scale;
    const s1 = (BOX / Math.min(w, h)) * z;
    const mid = BOX / 2;
    setOff(clamp({ x: mid - ((mid - off.x) / s0) * s1, y: mid - ((mid - off.y) / s0) * s1 }));
    setZoom(z);
  }
  // clamp again once the new zoom is in (clamp uses the current scale)
  useEffect(() => { setOff((o) => clamp(o)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [zoom, img]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = BOX * dpr;
    c.height = BOX * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, BOX, BOX);
    g.drawImage(img, off.x, off.y, w * scale, h * scale);
  }, [img, off, scale, w, h]);

  async function send() {
    setBusy('Making the sticker…');
    setErr('');
    try {
      const s = await makeSticker(img, { x: -off.x / scale, y: -off.y / scale, size: BOX / scale });
      await onSend(s);
      setImg(null);
      onDone();
    } catch (e) {
      setErr(e.message || 'Something went wrong.');
    }
    setBusy('');
  }

  return (
    <div className="stk-make">
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {!img ? (
        <div className="stk-make-start">
          <p>Make a sticker from one of your photos. It's sent as a square picture and kept in your Favourites.</p>
          <button type="button" className="stk-btn primary" onClick={() => file.current?.click()} disabled={!!busy}>{busy || 'Choose a photo'}</button>
        </div>
      ) : (
        <>
          <p className="emo-h">Drag to move it, and zoom to fit the square</p>
          <canvas ref={canvas} className="stk-crop" style={{ width: BOX, height: BOX }} aria-label="The part of the photo that becomes the sticker"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, o: off }; }}
            onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.o.x + e.clientX - d.x, y: d.o.y + e.clientY - d.y })); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
          <input type="range" className="stk-zoom" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" />
          <div className="stk-make-row">
            <button type="button" className="stk-btn" onClick={() => file.current?.click()} disabled={!!busy}>Another photo</button>
            <button type="button" className="stk-btn primary" onClick={send} disabled={!!busy}>{busy || 'Send sticker'}</button>
          </div>
        </>
      )}
      {err && <p className="stk-err" role="alert">{err}</p>}
    </div>
  );
}
