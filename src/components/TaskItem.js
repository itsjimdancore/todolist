'use client';
import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '@/lib/people';
import DuePicker from './DuePicker';
import { AddLink, LinkChips } from './TaskLinks';
import { StepLines } from './TaskDetails';

export default function TaskItem({ task, write, me, onOpen, onToggle, onEdit, onDue, onArchive, onDelete, onAddLink, onRemoveLink }) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false); // the "add a link" form under the task
  const [text, setText] = useState(task.text);

  function save() {
    const v = text.trim();
    setEditing(false);
    if (v && v !== task.text) onEdit(v);
    else setText(task.text);
  }
  const startEdit = () => { setText(task.text); setEditing(true); };

  const by = task.createdBy === me ? 'you' : (task.createdByName || 'someone').split(/[\s@]/)[0];
  const edited =
    task.updatedBy && task.updatedBy !== task.createdBy
      ? ` · last changed by ${task.updatedBy === me ? 'you' : task.updatedByName || 'someone'}`
      : '';

  return (
    <li className={['task', task.done && 'done'].filter(Boolean).join(' ')}>
      <input type="checkbox" checked={task.done} disabled={!write} onChange={onToggle} aria-label="Mark complete" />
      <div className="t">
        {editing ? (
          <input
            id={`edit-${task.id}`}
            autoFocus
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setText(task.text); setEditing(false); }
            }}
          />
        ) : (
          // links sit on the same line as the task, wrapping after it when there's no room
          <span className="t-line">
            <button type="button" className="t-open" onClick={onOpen} title="Open the task's details">{task.text}</button>
            <LinkChips links={task.links} canEdit={write && !task.archived} onRemove={onRemoveLink} />
          </span>
        )}
        {!editing && <StepLines task={task} />}
        {!editing && linking && write && !task.archived && (
          <div className="task-links"><AddLink links={task.links} onAdd={onAddLink} setAdding={setLinking} /></div>
        )}
      </div>
      <DuePicker value={task.due || null} task={task} canEdit={write && !task.archived} onChange={onDue} time={task.start || null} />
      <span className="by" title={`Updated ${timeAgo(task.updatedAt)}${edited}`}>{by}</span>
      {write && (
        <TaskMenu task={task} onEdit={startEdit} onOpen={onOpen} onLink={() => setLinking(true)} onArchive={onArchive} onDelete={onDelete} />
      )}
    </li>
  );
}

// The ⋯ on a task opens the same kind of menu as a list's ⋮ (phones and desktop)
function TaskMenu({ task, onEdit, onOpen, onLink, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const box = useRef(null);

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
  useEffect(() => { if (!open) setConfirm(false); }, [open]);

  const item = (label, fn, cls = '') => (
    <button type="button" role="menuitem" className={`menu-i ${cls}`} onClick={() => { setOpen(false); fn(); }}>{label}</button>
  );

  return (
    <div className="menu task-menu" ref={box}>
      <button className="task-more" type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Options for ${task.text}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <div className="menu-p" role="menu">
          {item('🔍 Open details', onOpen)}
          {!task.archived && item('✎ Edit task', onEdit)}
          {!task.archived && item('🔗 Add link', onLink)}
          {item(task.archived ? '↩ Restore' : '🗄 Archive', onArchive)}
          {confirm
            ? item('🗑 Confirm delete', onDelete, 'danger')
            : <button type="button" role="menuitem" className="menu-i danger" onClick={() => setConfirm(true)}>🗑 Delete</button>}
        </div>
      )}
    </div>
  );
}
