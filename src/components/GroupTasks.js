'use client';
import { useEffect, useState } from 'react';

const NEW = '__new__';

// Group a task into another list: one of mine (from My List), or a new list made here. The task moves there and
// remembers the list it came from, so "Ungroup" in its ⋯ menu sends it back.
// task: the task whose menu this was opened from; list: the list it's in now; lists: the other lists it can go to.
// onGroup(toList | null, newTitle) resolves true once saved.
// onUngroup: when the task is grouped here from another list, sends it back there (ungroupTo: that list's name)
export default function GroupTasks({ task, list, lists, onGroup, onUngroup = null, ungroupTo = '', onClose }) {
  const [to, setTo] = useState(() => lists[0]?.id || NEW);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toList = to === NEW ? null : lists.find((l) => l.id === to) || null;
  const ok = toList || title.trim();

  async function submit(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    if (await onGroup(toList, title.trim())) onClose(); else setBusy(false);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="group-title" onSubmit={submit}>
        <div className="m-h">
          <h2 id="group-title">Group “{task.text}”</h2>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-b">
          <div>
            <label className="sec-l" htmlFor="group-list">List</label>
            <select id="group-list" value={toList ? to : NEW} onChange={(e) => setTo(e.target.value)}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              <option value={NEW}>+ A new list…</option>
            </select>
            {!toList && (
              <input className="grp-new" autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Name the new list, e.g. Weekend plans" aria-label="New list's name" />
            )}
          </div>
          <p className="muted small">
            Group: it moves from “{list.title}” to {toList ? `“${toList.title}”` : 'the new list'}.{' '}
            Ungroup: it comes out of “{list.title}”{ungroupTo === 'Unplaced' ? ' into Unplaced on My List, to put in a list later' : ungroupTo ? `, back to “${ungroupTo}”` : ''}.
          </p>
        </div>
        <div className="m-f">
          {/* ungroup: only for a task that was grouped into this list */}
          <button className="btn" type="button" disabled={!onUngroup || busy}
            onClick={() => { onUngroup(); onClose(); }}
            title={ungroupTo === 'Unplaced' ? `Take it out of “${list.title}”, into Unplaced on My List` : `Send it back to “${ungroupTo}”`}>
            ⇱ Ungroup{ungroupTo === 'Unplaced' ? ' (out of this list)' : ungroupTo ? ` (back to ${ungroupTo})` : ''}
          </button>
          <span className="grp-gap" />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy || !ok}>
            {busy ? 'Grouping…' : toList ? 'Group' : 'Create list and group'}
          </button>
        </div>
      </form>
    </div>
  );
}
