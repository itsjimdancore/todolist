'use client';
import { useEffect, useRef, useState } from 'react';

// The ⋮ menu on a list. Only the owner can rename, archive or delete; members can leave (a partner has nothing to leave).
export default function ListMenu({ list, favorite, actions }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const isOwner = list.role === 'owner';

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (label, fn, cls = '') => (
    <button type="button" role="menuitem" className={`menu-i ${cls}`}
      onClick={(e) => { e.stopPropagation(); setOpen(false); fn(list); }}>
      {label}
    </button>
  );

  return (
    <div className="menu" ref={box} onClick={(e) => e.stopPropagation()}>
      <button className="dots" type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Options for ${list.title}`}>
        ⋮
      </button>
      {open && (
        <div className="menu-p" role="menu">
          {isOwner && item(list.kind === 'letter' ? '✎ Edit title' : '✎ Edit name', actions.rename)}
          {item(favorite ? '★ Remove from favourites' : '☆ Add to favourites', actions.favorite)}
          {item('👥 See members', actions.members)}
          {isOwner && item(list.archived ? '↩ Unarchive' : '🗄 Archive', actions.archive)}
          {isOwner
            ? item('🗑 Delete', actions.remove, 'danger')
            // my partner's: nothing to leave (it's theirs, shared with me because we're partners)
            : list.role !== 'partner' && item(list.kind === 'letter' ? '⎋ Leave letter' : '⎋ Leave list', actions.leave, 'danger')}
        </div>
      )}
    </div>
  );
}
