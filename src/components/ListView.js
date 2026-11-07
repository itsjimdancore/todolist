'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import {
  addTaskLink,
  deleteTask,
  removeTaskLink,
  renameList,
  updateTask,
  watchComments,
  watchTasks,
} from '@/lib/data';
import { PERMISSIONS, canComment, canWrite, roleLabel } from '@/lib/permissions';
import PeopleStack from './PeopleStack';
import BackLink from './BackLink';
import { byDue, dueLabel, monthLabel } from '@/lib/dates';
import { stepsPatch } from '@/lib/steps';
import { useToast } from './Toast';
import AddTask from './AddTask';
import TaskItem from './TaskItem';
import Comments from './Comments';
import { unreadCount, useCommentsSeen } from '@/lib/useCommentsSeen';
import ShareModal from './ShareModal';
import Loading from './Loading';
import TaskDetails from './TaskDetails';
import { inDropdown } from './Select';

export default function ListView({ list, role, user, contacts, back, focusComments = null, onLeave, onDelete, onArchive, menu }) {
  const toast = useToast();
  const write = canWrite(role);
  const comment = canComment(role);
  const isOwner = role === 'owner';

  const [tasks, setTasks] = useState(null);
  const [comments, setComments] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [pane, setPane] = useState('tasks'); // phones show Tasks or Comments, one at a time
  // opened from a comment notification: show the comments (the phone tab too), with the box ready to reply
  useEffect(() => { if (focusComments && comment) setPane('comments'); }, [focusComments, comment]);
  const [shareOpen, setShareOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [openId, setOpenId] = useState(null); // the task whose details popup is open

  useEffect(() => setTitle(list.title), [list.title]);

  // People with access come straight from the list document, so they update live
  const members = useMemo(
    () => Object.entries(list.roles || {}).map(([email, permission]) => ({ email, permission })).sort((a, b) => a.email.localeCompare(b.email)),
    [list.roles],
  );

  // ---- tell the owner when someone leaves while they're looking at the list
  const left = useMemo(() => list.leftEmails || [], [list.leftEmails]);
  const prevLeft = useRef(left);
  useEffect(() => {
    if (isOwner) left.filter((e) => !prevLeft.current.includes(e)).forEach((e) => toast(`${e} left “${list.title}”`));
    prevLeft.current = left;
  }, [left, isOwner, list.title, toast]);

  // ---- live tasks
  useEffect(
    () => watchTasks(list.id, setTasks, (e) => { setTasks([]); toast(friendlyError(e), 'err'); }),
    [list.id, toast],
  );

  // ---- live comments, only for roles that can see them
  useEffect(() => {
    if (!comment) return setComments([]);
    return watchComments(list.id, setComments, () => setComments([]));
  }, [list.id, comment]);
  const seenComments = useCommentsSeen(list.id, user.uid);
  const unread = unreadCount(comments, user.uid, seenComments.seen);

  // Firestore shows changes on screen immediately and syncs them in the background.
  // If the database refuses a change, it's undone automatically and we show why.
  const run = (promise, okMsg) =>
    promise.then(() => okMsg && toast(okMsg)).catch((e) => toast(`Not saved: ${friendlyError(e)}`, 'err'));


  async function saveTitle(e) {
    e?.preventDefault();
    const t = title.trim();
    setRenaming(false);
    if (!t || t === list.title) return setTitle(list.title);
    run(renameList(list, user, t));
  }

  const ownerPerson = { email: list.ownerEmail, displayName: list.ownerName };
  // sorted by due date (see byDue): setting or changing a date moves the task into place
  const active = (tasks || []).filter((t) => !t.archived).sort(byDue);
  const archived = (tasks || []).filter((t) => t.archived);
  const someoneCanComment = members.some((m) => canComment(m.permission));
  const named = Object.fromEntries((contacts || []).map((c) => [c.email, c]));
  const everyone = [ownerPerson, ...members.map((m) => ({ email: m.email, displayName: named[m.email]?.displayName }))];

  const taskProps = (t) => ({
    task: t,
    write,
    me: user.uid,
    onOpen: () => setOpenId(t.id),
    onToggle: () => run(updateTask(list, t, user, { done: !t.done })),
    onEdit: (text) => run(updateTask(list, t, user, { text })),
    // removing the date also removes its time
    onDue: (due) => run(updateTask(list, t, user, due ? { due, month: null } : { due: null, start: null, mins: null }),
      due ? `Due ${dueLabel(due).toLowerCase()}` : 'Due date removed'),
    // sometime during a month instead of on a day: no day, no time
    onMonth: (month) => run(updateTask(list, t, user, month ? { month, due: null, start: null, mins: null } : { month: null }),
      month ? `During ${monthLabel(month).toLowerCase()}` : 'Date removed'),
    // with Undo, which puts it straight back
    onArchive: () => run(updateTask(list, t, user, { archived: !t.archived }), {
      title: t.archived ? 'Task restored' : 'Task archived',
      description: `“${t.text}”`,
      action: { label: 'Undo', onClick: () => run(updateTask(list, t, user, { archived: !!t.archived })) },
    }),
    onDelete: () => run(deleteTask(list, t, user), 'Task deleted'),
    onAddLink: (link) => run(addTaskLink(list, t, user, link), 'Link added'),
    onRemoveLink: (link) => run(removeTaskLink(list, t, user, link), 'Link removed'),
  });

  // the popup follows the live task, and goes away if the task is deleted
  const openTask = openId ? (tasks || []).find((t) => t.id === openId) : null;
  const detailsOn = (t) => {
    const p = taskProps(t);
    return {
      toggle: p.onToggle,
      text: (text) => text !== t.text && run(updateTask(list, t, user, { text }), 'Task renamed'),
      notes: (notes) => (t.notes || '') !== notes && run(updateTask(list, t, user, { notes }), 'Notes saved'),
      location: (location) => (t.location || '') !== location &&
        run(updateTask(list, t, user, { location }), location ? 'Location saved' : 'Location removed'),
      steps: (steps) => run(updateTask(list, t, user, stepsPatch(steps)), 'Saved'),
      due: p.onDue,
      month: p.onMonth,
      schedule: (due, start, mins) => {
        const patch = { due, start: start || null, mins: start ? mins : null };
        if ((t.start || null) === patch.start && (t.mins || null) === patch.mins) return;
        run(updateTask(list, t, user, patch), start ? 'Time saved' : 'Set to all day');
      },
      addLink: p.onAddLink,
      removeLink: p.onRemoveLink,
      archive: p.onArchive,
      remove: () => { setOpenId(null); p.onDelete(); },
    };
  };

  return (
    <div className="list-wrap">
      <header className="bar lv-bar">
        <div className="bar-left">
          <BackLink back={back} />
          {renaming ? (
            <form onSubmit={saveTitle} className="rename">
              <input id="list-title" autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} />
            </form>
          ) : (
            <h1 onDoubleClick={() => isOwner && setRenaming(true)} title={isOwner ? 'Double-click to rename' : undefined}>{list.title}</h1>
          )}
          <div className="meta">
            {isOwner ? 'Owned by you' : `Owned by ${list.ownerName || list.ownerEmail}`} ·{' '}
            {members.length ? `shared with ${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'not shared yet'}
            {isOwner && left.length > 0 && ` · ${left.length} left`}
          </div>
        </div>
        <div className="bar-right">
          <PeopleStack people={everyone} me={user} />
          {isOwner ? (
            <>
              {/* on phones Rename lives in the ⋮ menu ("Edit name") */}
              <button className="btn lv-rename" type="button" onClick={() => setRenaming(true)}>Rename</button>
              <button className="btn primary" type="button" onClick={() => setShareOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" /></svg>
                Share
              </button>
            </>
          ) : role === 'partner' ? null : (
            <button className="btn" type="button" onClick={() => onLeave(list)}>Leave list</button>
          )}
          {menu}
        </div>
      </header>

      {list.archived && (
        <div className="banner archived-banner">
          <span>This list is archived. It&apos;s kept with everything in it, just out of the way.</span>
          {isOwner && <button className="btn" type="button" onClick={() => onArchive(list)}>Unarchive</button>}
        </div>
      )}

      {!isOwner && (
        <div className="banner">
          {role === 'partner' ? (
            <>Your partner <b>{list.ownerName || list.ownerEmail}</b>&apos;s list. You can change everything in it; only they can delete, rename or share it.</>
          ) : (
            <>You have <b>{roleLabel(role)}</b> access. {PERMISSIONS[role]?.desc}</>
          )}
        </div>
      )}

      {/* phones: Tasks and Comments as two tabs instead of one long page */}
      {comment && (
        <div className="seg lv-tabs" role="tablist" aria-label="List sections">
          <button type="button" role="tab" aria-selected={pane === 'tasks'} className={pane === 'tasks' ? 'on' : ''} onClick={() => setPane('tasks')}>
            Tasks <span>{tasks ? `${active.filter((t) => t.done).length}/${active.length}` : '…'}</span>
          </button>
          <button type="button" role="tab" aria-selected={pane === 'comments'} className={pane === 'comments' ? 'on' : ''} onClick={() => setPane('comments')}>
            Comments <span>{comments.length}</span>{unread > 0 && <i className="lv-dot" aria-label={`${unread} new`} />}
          </button>
        </div>
      )}

      <div className="page-body">
      <div className={`${comment ? 'grid' : 'grid solo'} show-${pane}`}>
        <section className="panel lv-tasks">
          {/* the heading and "Add a task" stay pinned while the tasks scroll under them */}
          <div className="lv-tasks-top">
            <div className="panel-h">
              <h2>Tasks</h2>
              <span className="count">{tasks ? `${active.filter((t) => t.done).length}/${active.length} done` : ''}</span>
            </div>

            {write && (
              <AddTask list={list} user={user} />
            )}
          </div>

          <ul className="tasks">
            {tasks === null && <li className="empty"><Loading hint="Getting your tasks" /></li>}
            {tasks && active.length === 0 && <li className="empty">No open tasks.{write ? ' Add one above.' : ''}</li>}
            {active.map((t) => <TaskItem key={t.id} {...taskProps(t)} />)}
          </ul>

          <button className="arch-toggle" type="button" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
            {showArchived ? '▾' : '▸'} Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="tasks">
              {archived.length === 0 && <li className="empty">Nothing archived.</li>}
              {archived.map((t) => <TaskItem key={t.id} {...taskProps(t)} />)}
            </ul>
          )}
        </section>

        {comment && (
          <Comments
            focus={focusComments}
            list={list}
            comments={comments}
            user={user}
            isOwner={isOwner}
            seen={seenComments.seen}
            seenReady={seenComments.ready}
            onSeen={seenComments.markSeen}
            hint={isOwner && !someoneCanComment ? 'Only you can see this thread until you share with Comment only or Read & write access.' : null}
          />
        )}
      </div>

      {isOwner && (
        <div className="danger-zone">
          <button className="ic del" type="button" onClick={() => onDelete(list)}>Delete this list…</button>
        </div>
      )}
      </div>

      {openTask && (
        <TaskModal task={openTask} list={list} write={write} on={detailsOn(openTask)} onClose={() => setOpenId(null)} />
      )}

      {shareOpen && (
        <ShareModal list={list} members={members} contacts={contacts} user={user} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

// A task's details as a popup over the list (a sheet from the bottom on phones)
function TaskModal({ task, list, write, on, onClose }) {
  // leave the field being typed in first, so its text saves (fields save when you click away)
  const close = useRef(null);
  close.current = () => { document.activeElement?.blur?.(); onClose(); };
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !inDropdown(e.target) && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="scrim task-scrim" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-label={task.text}>
        <TaskDetails task={task} list={list} write={write} on={on} onClose={() => close.current()} />
      </div>
    </div>
  );
}
