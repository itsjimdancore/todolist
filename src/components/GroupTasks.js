'use client';
import { useEffect, useState } from 'react';
import { groupedCount } from '@/lib/data';
import { MAX_STEPS } from '@/lib/steps';

const NEW = '__new__';

// Group tasks: the chosen tasks become the steps of one task, either one already in the list or a new one
// (when the task to group them under isn't there anymore, e.g. after it was ungrouped). Ungrouping a step
// later (⇱ in the task's details, or "Ungroup steps" in its menu) gives each one back as a task.
// start: the task whose menu this was opened from; tasks: the list's open tasks.
// onGroup(tasks, into, newTitle) resolves when saved.
export default function GroupTasks({ start, tasks, onGroup, onClose }) {
  const [picked, setPicked] = useState(() => new Set([start.id]));
  // put them in a task that has steps already if there is one, otherwise a new task
  const [into, setInto] = useState(() => tasks.find((t) => t.id !== start.id && t.steps?.length)?.id || NEW);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = tasks.filter((t) => picked.has(t.id));
  const target = into === NEW ? null : tasks.find((t) => t.id === into) || null;
  const targets = tasks.filter((t) => !picked.has(t.id));
  const count = groupedCount(chosen, target);
  const tooMany = count > MAX_STEPS;
  const ok = chosen.length > 0 && !tooMany && (target || title.trim());

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (next.has(into)) setInto(NEW); // a task can't be grouped into itself
    setPicked(next);
  };

  async function submit(e) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const done = await onGroup(chosen, target, title.trim());
    if (done) onClose(); else setBusy(false);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="group-title" onSubmit={submit}>
        <div className="m-h">
          <h2 id="group-title">Group tasks</h2>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-b">
          <fieldset className="grp-set">
            <legend className="sec-l">Tasks to group</legend>
            <ul className="grp-list">
              {tasks.map((t) => (
                <li key={t.id}>
                  <label className="grp-row">
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                    <span className="grp-t">{t.text}</span>
                    {t.steps?.length > 0 && <span className="muted small">{t.steps.length} step{t.steps.length === 1 ? '' : 's'}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div>
            <label className="sec-l" htmlFor="group-into">Put them in</label>
            <select id="group-into" value={into} onChange={(e) => setInto(e.target.value)}>
              <option value={NEW}>A new task…</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.text}</option>)}
            </select>
            {into === NEW && (
              <input className="grp-new" autoFocus maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Name the new task, e.g. Saturday date" aria-label="New task's name" />
            )}
          </div>

          <p className={tooMany ? 'err' : 'muted small'}>
            {tooMany
              ? `That would make ${count} steps; a task can hold up to ${MAX_STEPS}. Pick fewer tasks.`
              : `Each task becomes a step (its own steps come along after it). Ungroup any step later to make it a task again.`}
          </p>
        </div>
        <div className="m-f end">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy || !ok}>
            {busy ? 'Grouping…' : `Group ${chosen.length || ''} task${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  );
}
