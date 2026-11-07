'use client';
import { useState } from 'react';
import { deleteTask, moveTask, updateTask } from '@/lib/data';
import { dueLabel, isOverdue, monthLabel, timeRange } from '@/lib/dates';
import { friendlyError } from '@/lib/firebase';
import { canWrite } from '@/lib/permissions';
import Select from './Select';
import { PinIcon } from './TaskDetails';
import { useToast } from './Toast';

// My List: tasks added (from the Calendar) without a list. Each can be ticked off, put in a list, or deleted.
// list: the Unplaced list · tasks: its tasks · lists: lists a task can be placed in
export default function Unplaced({ list, tasks, lists, user }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(null);
  const open = (tasks || []).filter((t) => !t.archived)
    .sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999') || (a.start || '').localeCompare(b.start || ''));
  if (!list || !open.length) return null;
  const targets = lists.filter((l) => canWrite(l.role) && !l.archived);
  const run = (p, ok) => p.then(() => ok && toast(ok)).catch((e) => toast(`Not saved: ${friendlyError(e)}`, 'err'));

  return (
    <section className="unplaced" aria-labelledby="unplaced-h">
      <div className="unplaced-h">
        <h2 id="unplaced-h">Unplaced <span className="count">{open.length}</span></h2>
        <p>Added from the Calendar without a list. Put each one in a list when you&apos;re ready.</p>
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
                  <span className={isOverdue(t) ? 'late-txt' : ''}>{dueLabel(t.due)}{t.start ? `, ${timeRange(t.start, t.mins)}` : ''}</span>
                ) : t.month ? <span className={isOverdue(t) ? 'late-txt' : ''}>{monthLabel(t.month)}</span> : 'No date'}
                {t.location && <span className="up-loc"><PinIcon />{t.location}</span>}
              </span>
            </div>
            <div className="up-acts">
              {targets.length > 0 && (
                <Select className="up-place" value={null} label={`Put “${t.text}” in a list`} placement="bottom end"
                  placeholder="Place in a list" onChange={(id) => {
                    const to = targets.find((l) => l.id === id);
                    if (to) run(moveTask(list, t, to, user), `Moved to “${to.title}”`);
                  }}
                  options={targets.map((l) => ({ value: l.id, label: l.title }))} />
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
          </li>
        ))}
      </ul>
    </section>
  );
}
