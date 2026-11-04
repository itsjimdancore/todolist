'use client';
import { useEffect, useRef, useState } from 'react';
import { addTask, createList, ensureUnplaced, isUnplaced, nameOf, unplacedId, UNPLACED_TITLE } from '@/lib/data';
import { DEFAULT_MINS, dueLabel, fromKey, isOverdue, timeRange, todayKey } from '@/lib/dates';
import { friendlyError } from '@/lib/firebase';
import { hostOf, linkLabel, normalizeUrl } from '@/lib/links';
import { canWrite } from '@/lib/permissions';
import { colorFor, initials } from '@/lib/people';
import DuePicker from './DuePicker';
import { Spinner } from './Loading';
import Select, { inDropdown } from './Select';
import { MAX_LOCATION, PinIcon, StepLines, TimeFields } from './TaskDetails';
import { useToast } from './Toast';

const NONE = '__none'; // no list: the task stays in Unplaced (on My List)
const NEW_LIST = '__new';

const dateLong = (key) => fromKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateShort = (key) => fromKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// whose it is too, for a list on a calendar shared with me
const listName = (l) => `${isUnplaced(l) ? UNPLACED_TITLE : l.title}${l.calOwner ? ` · ${l.calOwner}'s calendar` : ''}`;

// Clicking a day on the Calendar: everything happening that day, as a numbered table
// (#, Task: title · what's going to be done · location, Link, Date + time, Added by, Status), and a form to add
// something to it. An empty day shows that it's empty, with an Add button in the middle.
// items: [{ t, l }] on that day · lists: lists a task can be added to · actions: the Calendar's task actions
export default function DaySheet({ day, items, holiday, lists, user, actions, init, panelOpen, onDay, onExisting, onClose }) {
  const [adding, setAdding] = useState(() => !!init);
  const [confirm, setConfirm] = useState(null); // 'listId/taskId' waiting for "Delete?"
  const today = todayKey();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || panelOpen || inDropdown(e.target) || e.defaultPrevented) return;
      if (confirm) setConfirm(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, panelOpen, confirm]);

  const count = items.length ? `${items.length} ${items.length === 1 ? 'activity' : 'activities'}` : 'No activities yet';

  return (
    <div className="scrim ds-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ds" role="dialog" aria-modal="true" aria-labelledby="ds-title">
        <div className="m-h ds-h">
          <div className="ds-h-b">
            <h2 id="ds-title">{dateLong(day)}</h2>
            <div className="ds-sub">
              {day === today ? 'Today · ' : ''}{adding ? 'Add an activity' : count}
              {holiday && <span className="ds-hol">🎉 {holiday.name}</span>}
            </div>
          </div>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {adding ? (
          <AddForm key={day} day={day} init={init} lists={lists} user={user}
            onExisting={onExisting}
            onCancel={() => setAdding(false)}
            cancelLabel="Back to the day"
            onSaved={(due) => {
              if (!due) return onClose();
              setAdding(false);
              if (due !== day) onDay(due);
            }} />
        ) : (
          <>
            <div className="m-b ds-b">
              {items.length === 0 ? (
                <div className="ds-empty">
                  <span className="ds-empty-ic" aria-hidden="true">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
                    </svg>
                  </span>
                  <h3>Nothing planned{day === today ? ' today' : ' on this day'}</h3>
                  <p>Add what&apos;s happening: a task, a plan, an outing. You can put it in a list or leave it unplaced.</p>
                  <button type="button" className="btn primary ds-empty-add" onClick={() => setAdding(true)} autoFocus>+ Add an activity</button>
                </div>
              ) : (
              <>
              <div className="ds-tools">
                <p className="ds-hint">Click a task to see everything about it and change it.</p>
                <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Add an activity</button>
              </div>
              <ol className="ds-table" aria-label={`Activities on ${dateLong(day)}`}>
                <li className="ds-tr ds-th" aria-hidden="true">
                  <span>#</span><span>Task</span><span>Link</span><span>Date &amp; time</span><span>Added by</span><span>Status</span><span />
                </li>
                {items.map((e, i) => (
                  <Row key={`${e.l.id}/${e.t.id}`} n={i + 1} entry={e} actions={actions}
                    confirming={confirm === `${e.l.id}/${e.t.id}`} setConfirm={setConfirm} />
                ))}
              </ol>
              </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ n, entry, actions, confirming, setConfirm }) {
  const { t, l } = entry;
  const write = canWrite(l.role);
  const by = t.createdByName || 'Someone';
  const late = isOverdue(t);
  const status = t.done ? 'done' : late ? 'late' : 'open';
  const statusLabel = { done: 'Done', late: 'Overdue', open: 'Open' }[status];
  const id = `${l.id}/${t.id}`;
  return (
    <li className={t.done ? 'ds-tr done' : 'ds-tr'}>
      <span className="ds-n" aria-label={`Number ${n}`}>{n}</span>
      <div className="ds-task">
        <button type="button" className="ds-title" onClick={() => actions.open(entry)}>{t.text}</button>
        <StepLines task={t} />
        <span className="ds-list"><i style={{ background: colorFor(l.id) }} />{listName(l)}</span>
      </div>
      <div className="ds-cell ds-links" data-label="Link">
        {(t.links || []).length ? (
          t.links.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" title={a.url}>{linkLabel(a) || hostOf(a.url)} ↗</a>
          ))
        ) : <span className="ds-none">—</span>}
      </div>
      <div className="ds-cell ds-when" data-label="Date & time">
        <span>{t.due ? dateShort(t.due) : 'No date'}</span>
        <span className="ds-time">{t.due ? (t.start ? timeRange(t.start, t.mins) : 'All day') : ''}</span>
      </div>
      <div className="ds-cell ds-by" data-label="Added by">
        <span className="chip-av" style={{ background: colorFor(by) }} aria-hidden="true">{initials(by)}</span>
        <span>{by}</span>
      </div>
      <div className="ds-cell" data-label="Status">
        <button type="button" className={`ds-status ${status}`} disabled={!write} onClick={() => actions.toggle(entry)}
          title={write ? (t.done ? 'Mark as not done' : 'Mark as done') : undefined}>
          {statusLabel}
        </button>
      </div>
      <div className="ds-acts">
        {write && (confirming ? (
          <>
            <button type="button" className="btn small td-del on" onClick={() => { setConfirm(null); actions.remove(entry); }}>Delete</button>
            <button type="button" className="btn small" onClick={() => setConfirm(null)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className="ic ds-ic" onClick={() => actions.archive(entry)} aria-label={`Archive “${t.text}”`} title="Archive">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
              </svg>
            </button>
            <button type="button" className="ic ds-ic danger" onClick={() => setConfirm(id)} aria-label={`Delete “${t.text}”`} title="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6" />
              </svg>
            </button>
          </>
        ))}
      </div>
    </li>
  );
}

// The new activity: title, what's going to be done, location, link, date, time (All day, or From – To with AM / PM),
// status, added by (you), and which list it goes in: none (it stays in Unplaced on My List), one of yours,
// or a new list made as it's saved.
function AddForm({ day, init, lists, user, onSaved, onCancel, cancelLabel, onExisting }) {
  const toast = useToast();
  const placeable = lists.filter((l) => !isUnplaced(l));
  const hasUnplaced = lists.some((l) => l.id === unplacedId(user.uid));
  const [text, setText] = useState(init?.text || '');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [due, setDue] = useState(init?.due || day);
  const [time, setTime] = useState({ start: init?.start || null, mins: init?.mins || DEFAULT_MINS });
  const [done, setDone] = useState(false);
  const [listId, setListId] = useState(() => (placeable.some((l) => l.id === init?.listId) || init?.listId === NEW_LIST ? init.listId : NONE));
  const [newName, setNewName] = useState(init?.newName || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const made = useRef(null); // a new list already made, if saving the task then failed (so a retry doesn't make another)

  async function save(e) {
    e.preventDefault();
    setErr('');
    const v = text.replace(/\s+/g, ' ').trim();
    if (!v) return setErr('Give it a title first.');
    const url = link.trim() ? normalizeUrl(link) : null;
    if (link.trim() && !url) return setErr("That link doesn't look like a web address, e.g. example.com/page");
    const name = newName.trim();
    if (listId === NEW_LIST && !name) return setErr('Name the new list, or pick “No list”.');
    setBusy(true);
    try {
      let list;
      if (listId === NONE) {
        const id = await ensureUnplaced(user, hasUnplaced);
        list = lists.find((l) => l.id === id) || { id, title: UNPLACED_TITLE, roles: {} };
      } else if (listId === NEW_LIST) {
        if (made.current?.name !== name) made.current = { name, id: await createList(user, name) };
        list = { id: made.current.id, title: name, roles: {} };
      } else {
        list = placeable.find((l) => l.id === listId);
      }
      const start = due ? time.start : null;
      await addTask(list, user, v, due, notes.trim(), start ? { start, mins: time.mins } : null, {
        location: location.trim(), links: url ? [{ url, title: '' }] : [], done,
      });
      const where = listId === NONE ? 'Unplaced (on My List)' : listId === NEW_LIST ? `the new list “${name}”` : `“${list.title}”`;
      toast(`Added to ${where}${due ? `, ${dueLabel(due).toLowerCase()}${start ? `, ${timeRange(start, time.mins)}` : ''}` : ''}`);
      onSaved(due);
    } catch (er) {
      setErr(friendlyError(er));
      setBusy(false);
    }
  }

  const listOptions = [
    { value: NONE, label: 'No list: keep it in Unplaced' },
    ...placeable.map((l) => ({ value: l.id, label: l.calOwner ? `${l.title} · ${l.calOwner}` : l.title, divider: false })),
    { value: NEW_LIST, label: '＋ Create a new list…', divider: true },
  ];

  return (
    <form className="ds-form" onSubmit={save}>
      <div className="m-b ds-b">
        <label className="field">
          <span>Title</span>
          <input autoFocus maxLength={500} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }}
            placeholder="What's happening? e.g. Dinner at Sana" autoComplete="off" />
        </label>
        <label className="field">
          <span>What&apos;s going to be done <em className="opt">optional</em></span>
          <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details, steps…" />
        </label>
        <div className="ds-2">
          <label className="field td-loc">
            <span>Location <em className="opt">optional</em></span>
            <span className="td-loc-in">
              <PinIcon />
              <input maxLength={MAX_LOCATION} value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="off"
                placeholder="Where? e.g. Westlands, Nairobi" />
            </span>
          </label>
          <label className="field">
            <span>Link <em className="opt">optional</em></span>
            <input type="url" inputMode="url" value={link} onChange={(e) => { setLink(e.target.value); setErr(''); }} autoComplete="off"
              placeholder="example.com/menu" />
          </label>
        </div>
        <div className="ds-2">
          <div className="field">
            <span>Date</span>
            <div><DuePicker value={due} onChange={(d) => { setDue(d); setErr(''); }} /></div>
          </div>
          <div className="field">
            <span>Status</span>
            <div className="seg ds-seg" role="group" aria-label="Status">
              <button type="button" className={done ? '' : 'on'} aria-pressed={!done} onClick={() => setDone(false)}>Open</button>
              <button type="button" className={done ? 'on' : ''} aria-pressed={done} onClick={() => setDone(true)}>Done</button>
            </div>
          </div>
        </div>
        {due && (
          <div className="field">
            <span>Time</span>
            <TimeFields start={time.start} mins={time.mins} onChange={setTime} idPrefix="ds" />
          </div>
        )}
        <div className="ds-2">
          <div className="field">
            <label htmlFor="ds-list">List <em className="opt">optional</em></label>
            <Select id="ds-list" className="block" value={listId} onChange={(v) => { setListId(v); setErr(''); }} label="List"
              prefix={listId === NONE || listId === NEW_LIST ? null : <i className="sel-dot" style={{ background: colorFor(listId) }} />}
              options={listOptions} />
            {listId === NEW_LIST && (
              <input autoFocus maxLength={120} value={newName} onChange={(e) => { setNewName(e.target.value); setErr(''); }}
                placeholder="Name the new list, e.g. Weekend plans" aria-label="New list name" autoComplete="off" />
            )}
            <span className="list-pick-note">
              {listId === NONE ? 'It stays in Unplaced on My List until you put it in a list.'
                : listId === NEW_LIST ? 'The list is made when you save. You can share it later.' : ''}
            </span>
          </div>
          <div className="field">
            <span>Added by</span>
            <span className="ds-me">
              <span className="chip-av" style={{ background: colorFor(nameOf(user)) }} aria-hidden="true">{initials(nameOf(user))}</span>
              You · {nameOf(user)}
            </span>
          </div>
        </div>
        {onExisting && placeable.length > 0 && (
          <button type="button" className="link ds-existing" onClick={() => onExisting(due)}>Or schedule a task you already have</button>
        )}
        {err && <p className="note err" role="alert">{err}</p>}
      </div>
      <div className="m-f end">
        <button className="btn" type="button" onClick={onCancel}>{cancelLabel}</button>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? <><Spinner aria-hidden="true" />Saving…</> : 'Save'}</button>
      </div>
    </form>
  );
}
