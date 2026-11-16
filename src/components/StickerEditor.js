'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onMobileData } from '@/lib/calls';
import { MODEL_MB, cutOut, cutoutDownloaded } from '@/lib/cutout';
import { COLORS, FONTS, SIZE, drawSticker, frameFor, hits, itemBox, visibleBounds } from '@/lib/stickerCanvas';
import { exportSticker, loadImage } from '@/lib/stickers';
import EmojiPicker from './EmojiPicker';

const MAX_PHOTO = 1024; // the photo is shrunk to this (longest side) before editing: plenty for a 512 sticker
const PENS = [6, 16];
let nextId = 1;

// Making a sticker, like WhatsApp: the photo, then ✂ Cut out (background removed, white outline),
// T Text, 😀 Emoji, ✏ Draw; drag things to move them, pinch (or scroll) to resize and turn them; ↶ Undo.
// file: the photo picked · onSend(sticker) · onClose()
export default function StickerEditor({ file, onSend, onClose }) {
  const [st, setSt] = useState(null);
  const history = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [mode, setMode] = useState('move'); // 'move' | 'draw'
  const [sel, setSel] = useState(null); // the text / emoji picked up last
  const [sheet, setSheet] = useState(null); // 'text' | 'emoji' | 'ask-cutout'
  const [draft, setDraft] = useState({ text: '', color: COLORS[0], font: 'bold', id: null });
  const [pen, setPen] = useState({ color: COLORS[0], width: PENS[0] });
  const [busy, setBusy] = useState(''); // 'cutout' | 'send'
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const cutCache = useRef(null);
  const stage = useRef(null);
  const [px, setPx] = useState(320); // the preview's size on screen (CSS pixels)

  // ---- the photo, shrunk, fitted whole into the square
  useEffect(() => {
    let live = true;
    loadImage(file).then((img) => {
      const k = Math.min(1, MAX_PHOTO / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (live) setSt({ original: c, base: c, cut: false, frame: frameFor(c, undefined, 0), outline: false, strokes: [], items: [] });
    }).catch(() => live && setErr("This photo can't be opened here. Try another one."));
    return () => { live = false; };
  }, [file]);

  // the preview fills the space between the bars
  useLayoutEffect(() => {
    const fit = () => setPx(Math.max(220, Math.min(window.innerWidth - 24, window.innerHeight - 250, 460)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // ---- draw the preview (and a dashed box round whatever is picked up)
  useEffect(() => {
    const c = stage.current;
    if (!c || !st) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(px * dpr);
    c.height = Math.round(px * dpr);
    const g = c.getContext('2d');
    drawSticker(g, c.width, st);
    const it = st.items.find((i) => i.id === sel);
    if (it && mode === 'move') {
      const { hw, hh } = itemBox(it);
      const k = c.width / SIZE;
      g.save();
      g.scale(k, k);
      g.translate(it.x, it.y);
      g.rotate(it.rot);
      g.setLineDash([8, 6]);
      g.lineWidth = 2 / k * dpr;
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.strokeRect(-hw, -hh, hw * 2, hh * 2);
      g.restore();
    }
  }, [st, px, sel, mode]);

  // ---- changes, with undo
  const change = (fn) => setSt((s) => { history.current.push(s); setCanUndo(true); return fn(s); });
  const undo = () => {
    const prev = history.current.pop();
    if (prev) setSt(prev);
    setCanUndo(history.current.length > 0);
  };

  // ---- fingers on the picture: drag, pinch, draw
  const ptrs = useRef(new Map());
  const gesture = useRef(null);
  const toSpace = (e) => {
    const r = stage.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const pairInfo = () => {
    const [a, b] = [...ptrs.current.values()];
    return { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
  };
  // start (or restart, when a second finger lands) a move of the item or the photo
  const begin = (s, target) => {
    const one = [...ptrs.current.values()][0];
    gesture.current = {
      target, moved: false, before: s,
      start: target === 'base' ? { ...s.frame } : { ...s.items.find((i) => i.id === target) },
      p0: one, pair: ptrs.current.size === 2 ? pairInfo() : null,
    };
  };
  const onDown = (e) => {
    if (!st || busy) return;
    if (sheet === 'emoji') setSheet(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer already went away */ }
    const p = toSpace(e);
    ptrs.current.set(e.pointerId, p);
    if (mode === 'draw') {
      if (ptrs.current.size === 1) change((s) => ({ ...s, strokes: [...s.strokes, { color: pen.color, width: pen.width, pts: [p] }] }));
      return;
    }
    if (ptrs.current.size === 1) {
      const hit = [...st.items].reverse().find((it) => hits(it, p[0], p[1]));
      setSel(hit ? hit.id : null);
      begin(st, hit ? hit.id : 'base');
    } else if (ptrs.current.size === 2 && gesture.current) {
      begin(st, gesture.current.target);
      gesture.current.before = gesture.current.moved ? st : gesture.current.before;
    }
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const p = toSpace(e);
    ptrs.current.set(e.pointerId, p);
    if (mode === 'draw') {
      if (ptrs.current.size === 1) {
        setSt((s) => {
          const strokes = s.strokes.slice();
          const last = strokes[strokes.length - 1];
          strokes[strokes.length - 1] = { ...last, pts: [...last.pts, p] };
          return { ...s, strokes };
        });
      }
      return;
    }
    const gst = gesture.current;
    if (!gst) return;
    let dx;
    let dy;
    let k = 1;
    let turn = 0;
    if (ptrs.current.size >= 2 && gst.pair) {
      const now = pairInfo();
      k = now.d / gst.pair.d;
      turn = now.ang - gst.pair.ang;
      dx = now.mx - gst.pair.mx;
      dy = now.my - gst.pair.my;
    } else {
      dx = p[0] - gst.p0[0];
      dy = p[1] - gst.p0[1];
    }
    if (!gst.moved && Math.hypot(dx, dy) < 2 && Math.abs(k - 1) < 0.01) return;
    if (!gst.moved) { gst.moved = true; history.current.push(gst.before); setCanUndo(true); }
    setSt((s) => applyMove(s, gst, dx, dy, k, turn));
  };
  const onUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (mode === 'draw') return;
    if (ptrs.current.size === 1 && gesture.current) {
      // one finger left after a pinch: carry on dragging from here
      const moved = gesture.current.moved;
      setSt((s) => { begin(s, gesture.current.target); gesture.current.moved = moved; return s; });
    } else if (!ptrs.current.size) {
      gesture.current = null;
    }
  };
  // scroll wheel (computers): resize what's under the pointer
  const onWheel = (e) => {
    if (!st || mode === 'draw') return;
    const p = toSpace(e);
    const hit = [...st.items].reverse().find((it) => hits(it, p[0], p[1]));
    const k = Math.exp(-e.deltaY * 0.0015);
    change((s) => applyMove(s, { target: hit ? hit.id : 'base', start: hit ? { ...hit } : { ...s.frame } }, 0, 0, k, 0));
  };
  // double-tap text to change it
  const onDouble = (e) => {
    const p = toSpace(e);
    const hit = [...(st?.items || [])].reverse().find((it) => it.kind === 'text' && hits(it, p[0], p[1]));
    if (hit) { setDraft({ text: hit.text, color: hit.color, font: hit.font, id: hit.id }); setSheet('text'); }
  };

  // ---- text and emoji
  const openText = () => { setMode('move'); setDraft({ text: '', color: draft.color, font: draft.font, id: null }); setSheet('text'); };
  const saveText = () => {
    const text = draft.text.trim();
    setSheet(null);
    if (draft.id) {
      change((s) => ({ ...s, items: text ? s.items.map((i) => (i.id === draft.id ? { ...i, text, color: draft.color, font: draft.font } : i)) : s.items.filter((i) => i.id !== draft.id) }));
      return;
    }
    if (!text) return;
    const id = nextId++;
    change((s) => ({ ...s, items: [...s.items, { id, kind: 'text', text, color: draft.color, font: draft.font, x: SIZE / 2, y: SIZE * 0.82, size: 64, rot: 0 }] }));
    setSel(id);
  };
  const addEmoji = (emoji) => {
    setSheet(null);
    setMode('move');
    const id = nextId++;
    change((s) => ({ ...s, items: [...s.items, { id, kind: 'emoji', text: emoji, x: SIZE * 0.75, y: SIZE * 0.25, size: 110, rot: 0 }] }));
    setSel(id);
  };
  const removeSel = () => { change((s) => ({ ...s, items: s.items.filter((i) => i.id !== sel) })); setSel(null); };

  // ---- ✂ cut out (again: put the background back)
  async function cutout(confirmed = false) {
    setErr('');
    setMode('move');
    if (st.cut) {
      change((s) => ({ ...s, base: s.original, cut: false, outline: false, frame: s.frameBeforeCut || s.frame }));
      return;
    }
    if (!cutCache.current && !confirmed && !(await cutoutDownloaded())) { setSheet('ask-cutout'); return; }
    setSheet(null);
    setBusy('cutout');
    setProgress(null);
    try {
      const cut = cutCache.current || await cutOut(st.original, setProgress);
      const box = visibleBounds(cut);
      if (!box) throw new Error("Couldn't find anything to cut out in this photo.");
      cutCache.current = cut;
      change((s) => ({ ...s, base: cut, cut: true, outline: true, frameBeforeCut: s.frame, frame: frameFor(cut, box) }));
    } catch (e) {
      setErr(e.message || "The cutout didn't work on this photo.");
    }
    setBusy('');
  }

  async function send() {
    if (!st || busy) return;
    setBusy('send');
    setErr('');
    setSel(null);
    try {
      const sticker = await exportSticker((g, size) => drawSticker(g, size, st));
      await onSend(sticker);
    } catch (e) {
      setErr(e.message || "The sticker couldn't be sent.");
      setBusy('');
    }
  }

  // Esc: close what's open, else the editor (and not the emoji panel behind it)
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (sheet) setSheet(null);
    else if (mode === 'draw') setMode('move');
    else onClose();
  };

  const mb = progress?.total ? `${(progress.loaded / 1048576).toFixed(0)} of ${(progress.total / 1048576).toFixed(0)} MB` : '';
  return (
    <div className="se" role="dialog" aria-modal="true" aria-label="Make a sticker" onKeyDown={onKey} tabIndex={-1}>
      <div className="se-top">
        <button type="button" className="se-ic" onClick={onClose} aria-label="Close" title="Close">✕</button>
        <span className="se-title">{mode === 'draw' ? 'Draw' : 'Make a sticker'}</span>
        {sel && mode === 'move' && <button type="button" className="se-ic" onClick={removeSel} aria-label="Remove the selected text or emoji" title="Remove">🗑</button>}
        <button type="button" className="se-ic" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">↶</button>
      </div>

      <div className="se-mid">
        {st ? (
          <canvas ref={stage} className={mode === 'draw' ? 'se-stage drawing' : 'se-stage'} style={{ width: px, height: px }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onDoubleClick={onDouble}
            aria-label="The sticker. Drag to move things, pinch to resize and turn them." />
        ) : !err && <p className="se-wait">Opening the photo…</p>}
        {busy === 'cutout' && (
          <div className="se-busy" role="status">
            {progress?.phase === 'download' ? (
              <>
                <p>Downloading the cutout tool{mb ? ` · ${mb}` : '…'}</p>
                <div className="se-bar"><i style={{ width: `${progress.total ? (progress.loaded / progress.total) * 100 : 5}%` }} /></div>
                <small>First time only. After this it works straight away, even offline.</small>
              </>
            ) : <p>Cutting out…</p>}
          </div>
        )}
        {err && <p className="se-err" role="alert">{err}</p>}
      </div>

      {mode === 'draw' ? (
        <div className="se-tools">
          {COLORS.map((c) => (
            <button key={c} type="button" className={pen.color === c ? 'se-sw on' : 'se-sw'} style={{ background: c }} onClick={() => setPen((p) => ({ ...p, color: c }))} aria-label={`Pen colour ${c}`} />
          ))}
          {PENS.map((w) => (
            <button key={w} type="button" className={pen.width === w ? 'se-pen on' : 'se-pen'} onClick={() => setPen((p) => ({ ...p, width: w }))} aria-label={w === PENS[0] ? 'Thin pen' : 'Thick pen'}>
              <i style={{ width: w / 1.6 + 4, height: w / 1.6 + 4 }} />
            </button>
          ))}
          <button type="button" className="se-done" onClick={() => setMode('move')}>Done</button>
        </div>
      ) : (
        <div className="se-tools">
          <Tool icon="✂" label={st?.cut ? 'Undo cutout' : 'Cut out'} on={st?.cut} onClick={() => cutout()} disabled={!st || !!busy} />
          {st?.cut && <Tool icon="◯" label="Outline" on={st.outline} onClick={() => change((s) => ({ ...s, outline: !s.outline }))} />}
          <Tool icon="T" label="Text" onClick={openText} disabled={!st || !!busy} />
          <Tool icon="😀" label="Emoji" onClick={() => setSheet((x) => (x === 'emoji' ? null : 'emoji'))} disabled={!st || !!busy} />
          <Tool icon="✏" label="Draw" onClick={() => { setSel(null); setMode('draw'); }} disabled={!st || !!busy} />
          <button type="button" className="se-send" onClick={send} disabled={!st || !!busy}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
        </div>
      )}

      {sheet === 'text' && (
        <div className="se-sheet se-text">
          <textarea autoFocus rows={2} maxLength={80} value={draft.text} placeholder="Type something"
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            style={{ color: draft.color, font: (FONTS[draft.font] || FONTS.bold).css.replace('{s}', 28) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveText(); } }} />
          <div className="se-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={draft.color === c ? 'se-sw on' : 'se-sw'} style={{ background: c }} onClick={() => setDraft((d) => ({ ...d, color: c }))} aria-label={`Text colour ${c}`} />
            ))}
          </div>
          <div className="se-row">
            {Object.entries(FONTS).map(([k, f]) => (
              <button key={k} type="button" className={draft.font === k ? 'se-font on' : 'se-font'} style={{ font: f.css.replace('{s}', 15) }} onClick={() => setDraft((d) => ({ ...d, font: k }))}>{f.label}</button>
            ))}
            <button type="button" className="se-done" onClick={saveText}>Done</button>
          </div>
        </div>
      )}
      {sheet === 'emoji' && (
        <div className="se-emo"><EmojiPicker onPick={addEmoji} onClose={() => setSheet(null)} /></div>
      )}
      {sheet === 'ask-cutout' && (
        <div className="se-sheet se-ask" role="alertdialog" aria-label="Download the cutout tool">
          <p><b>Cut out the background?</b></p>
          <p>The first time, this downloads the cutout tool ({MODEL_MB} MB). Your photo stays on your phone.</p>
          {onMobileData() && <p className="se-warn">You&apos;re on mobile data. Wi-Fi may be better for this.</p>}
          <div className="se-row">
            <button type="button" className="se-font" onClick={() => setSheet(null)}>Not now</button>
            <button type="button" className="se-done" onClick={() => cutout(true)}>Download</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tool({ icon, label, on, onClick, disabled }) {
  return (
    <button type="button" className={on ? 'se-tool on' : 'se-tool'} onClick={onClick} disabled={disabled} aria-pressed={on || undefined}>
      <span aria-hidden="true">{icon}</span>{label}
    </button>
  );
}

// a drag (dx, dy), a pinch (k: size ratio) and a turn, applied to the item or the photo the gesture started on
function applyMove(s, g, dx, dy, k, turn) {
  if (g.target === 'base') {
    const f = g.start;
    return { ...s, frame: { cx: f.cx + dx, cy: f.cy + dy, scale: Math.max(0.02, f.scale * k) } };
  }
  const o = g.start;
  return {
    ...s,
    items: s.items.map((i) => (i.id === g.target
      ? { ...i, x: o.x + dx, y: o.y + dy, size: Math.max(14, Math.min(400, o.size * k)), rot: o.rot + turn }
      : i)),
  };
}
