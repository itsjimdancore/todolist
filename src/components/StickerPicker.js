'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { PACKS, stickerLabel, stickerSrc } from '@/lib/stickerPacks';

// the editor (and the cutout tool it can download) only loads when someone makes a sticker
const StickerEditor = dynamic(() => import('./StickerEditor'), { ssr: false });

// The Stickers side of the chat's emoji panel. Tabs along the top: ★ Favourites, 🕘 Recent, one per pack, ＋ Create.
// Tapping a sticker sends it straight away, like WhatsApp. In Favourites, long-press (or right-click) one to
// remove it. mine: useMyStickers() · onSend(sticker) · onFav(sticker, on) · onMade(sticker): send a new one ·
// onImport(files): bring stickers in (from WhatsApp) · importing: { done, total } while that runs
export default function StickerPicker({ mine, onSend, onFav, onMade, onImport, importing }) {
  const { favourites = [], recent = [] } = mine || {};
  const tabs = [
    ...(favourites.length ? [{ id: 'fav', name: 'Favourites', icon: '★' }] : []),
    ...(recent.length ? [{ id: 'recent', name: 'Recent', icon: '🕘' }] : []),
    ...PACKS.map((p) => ({ id: `pack:${p.id}`, name: p.name, img: stickerSrc({ pack: p.id, id: p.icon }) })),
    { id: 'make', name: 'Make or import stickers', icon: '＋' },
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
        <Maker onMade={onMade} onImport={onImport} importing={importing} onDone={() => setTab(null)} />
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

// ＋: make a sticker from a photo (the editor, like WhatsApp's), or bring stickers in from WhatsApp:
// pick the files, paste a copied sticker, or drop files here.
function Maker({ onMade, onImport, importing, onDone }) {
  const photo = useRef(null);
  const many = useRef(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);

  // a sticker copied in WhatsApp Web (right-click → Copy image) and pasted while this is open
  useEffect(() => {
    const paste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      onImport?.(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [onImport]);

  const dropped = (e) => {
    e.preventDefault();
    setDrag(false);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/') || /\.webp$/i.test(f.name));
    if (files.length) onImport?.(files);
  };

  return (
    <div className={drag ? 'stk-make drag' : 'stk-make'} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)} onDrop={dropped}>
      <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f); }} />
      <input ref={many} type="file" accept="image/webp,image/png,image/gif,image/jpeg,.webp" multiple hidden
        onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) onImport?.(fs); }} />
      <div className="stk-make-start">
        <button type="button" className="stk-btn primary" onClick={() => photo.current?.click()}>Create a sticker</button>
        <p>From one of your photos: cut out the background, add text, emoji or drawing, like WhatsApp.</p>
        <button type="button" className="stk-btn" onClick={() => many.current?.click()} disabled={!!importing}>
          {importing ? `Importing ${Math.min(importing.done + 1, importing.total)} of ${importing.total}…` : 'Import stickers'}
        </button>
        <details className="stk-how">
          <summary>How to bring your WhatsApp stickers</summary>
          <p><b>Android:</b> tap Import stickers, then in Files open <i>Android › media › com.whatsapp › WhatsApp › Media ›
            WhatsApp Stickers</i> and select the ones you want (WhatsApp keeps every sticker you&apos;ve sent or received there).</p>
          <p><b>Computer:</b> in WhatsApp Web, right-click a sticker › <i>Copy image</i>, then paste it here (Ctrl+V). Or
            <i> Save image as…</i> and drop the files on this panel.</p>
          <p><b>iPhone:</b> do it from a computer as above. Your stickers are kept in your account, so they appear on your iPhone too.</p>
        </details>
      </div>
      {file && typeof document !== 'undefined' && createPortal(
        <StickerEditor file={file} onClose={() => setFile(null)}
          onSend={async (s) => { await onMade(s); setFile(null); onDone(); }} />,
        document.body,
      )}
    </div>
  );
}
