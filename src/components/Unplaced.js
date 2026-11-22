'use client';
import { useState } from 'react';
import { createList, deleteTask, moveTask, updateTask } from '@/lib/data';
import { isOverdue, monthLabel, rangeLabel, timeRange } from '@/lib/dates';
import { friendlyError } from '@/lib/firebase';
import { canWrite } from '@/lib/permissions';
import Feedback from './Feedback';
import Select from './Select';
import { PinIcon } from './TaskDetails';
import { useToast } from './Toast';

const NEW = '__new__';

// My List: tasks added (from the Calendar) without a list. Each can be ticked off, put in a list (one of mine, or a
// new one named right there), or deleted.
// list: the Unplaced list · tasks: its tasks · lists: lists a task can be placed in
export default function Unplaced({ list, tasks, lists, user }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(null);
  const [naming, setNaming] = useState(null); // the task being put in a new list: its id
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fbOpen, setFbOpen] = useState(null); // the task whose feedback is showing: its id
  const open = (tasks || []).filter((t) => !t.archived)
    .sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999') || (a.start || '').localeCompare(b.start || ''));
  if (!list || !open.length) return null;
  const targets = lists.filter((l) => canWrite(l.role) && !l.archived);
  const run = (p, ok) => p.then(() => ok && toast(ok)).catch((e) => toast(`Not saved: ${friendlyError(e)}`, 'err'));

  // make the list, then move the task into it
  async function toNewList(e, t) {
    e.preventDefault();
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const id = await createList(user, title);
      await moveTask(list, t, { id, title, ownerId: user.uid, ownerEmail: (user.email || '').toLowerCase(), roles: {} }, user);
      toast(`Moved to the new list “${title}”`);
      setNaming(null); setName('');
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'err');
    }
    setBusy(false);
  }

  return (
    <section className="unplaced" aria-labelledby="unplaced-h">
      <div className="unplaced-h">
        <h2 id="unplaced-h">Unplaced <span className="count">{open.length}</span></h2>
        <p>Added from the Calendar without a list, or ungrouped out of one. Put each one in a list when you&apos;re ready.</p>
      </div>
      <ul className="unplaced-rows">
        {open.map((t) => (
          <li key={t.id} className={t.done ? 'up-r done' : 'up-r'}>
            <input type="checkbox" checked={t.done} onChange={() => run(updateTask(list, t, user, { done: !t.done }))}
              aria-label={`Mark “${t.text}” ${t.done ? 'not done' : 'done'}`} />
            <div className="up-b">
              <span className="up-t">{t.text}</span>
              <span className="up-m">
                {t.due ? (
                  <span className={isOverdue(t) ? 'late-txt' : ''}>{rangeLabel(t.due, t.until)}{t.start ? `, ${timeRange(t.start, t.mins)}` : ''}</span>
                ) : t.month ? <span className={isOverdue(t) ? 'late-txt' : ''}>{monthLabel(t.month)}</span> : 'No date'}
                {t.location && <span className="up-loc"><PinIcon />{t.location}</span>}
              </span>
              {/* feedback stays with a task wherever it is, Unplaced too */}
              <button type="button" className={fbOpen === t.id ? 't-fb-btn on' : 't-fb-btn'} aria-expanded={fbOpen === t.id}
                onClick={() => setFbOpen(fbOpen === t.id ? null : t.id)}>💬 Feedback</button>
            </div>
            <div className="up-acts">
              {naming === t.id ? (
                <form className="up-new" onSubmit={(e) => toNewList(e, t)}>
                  <input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
                    placeholder="New list's name" aria-label={`Name the new list for “${t.text}”`} />
                  <button type="submit" className="btn small primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</button>
                  <button type="button" className="btn small" onClick={() => setNaming(null)}>Cancel</button>
                </form>
              ) : (
                <Select className="up-place" value={null} label={`Put “${t.text}” in a list`} placement="bottom end"
                  placeholder="Place in a list" onChange={(id) => {
                    if (id === NEW) { setName(''); setNaming(t.id); return; }
                    const to = targets.find((l) => l.id === id);
                    if (to) run(moveTask(list, t, to, user), `Moved to “${to.title}”`);
                  }}
                  options={[
                    ...targets.map((l) => ({ value: l.id, label: l.title })),
                    { value: NEW, label: '+ A new list…', divider: targets.length > 0 },
                  ]} />
              )}
              {confirm === t.id ? (
                <>
                  <button type="button" className="btn small td-del on" onClick={() => { setConfirm(null); run(deleteTask(list, t, user), 'Task deleted'); }}>Delete</button>
                  <button type="button" className="btn small" onClick={() => setConfirm(null)}>Keep</button>
                </>
              ) : (
                <button type="button" className="ic ds-ic danger" onClick={() => setConfirm(t.id)} aria-label={`Delete “${t.text}”`} title="Delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
            {fbOpen === t.id && <div className="t-fb up-fb"><Feedback list={list} task={t} user={user} isOwner lists={lists} canFile /></div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
