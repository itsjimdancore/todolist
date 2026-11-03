'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_MINS, fromMin, isOverdue, timeRange, toMin } from '@/lib/dates';
import { colorFor } from '@/lib/people';
import DuePicker from './DuePicker';
import Select from './Select';
import TaskLinks from './TaskLinks';

export const MAX_LOCATION = 200;

// Everything about one task: title, what's going to be done, where, links, date and time, status, who added it,
// and (with write access) Archive and Delete. Used by the Calendar's side panel and the popup in a list.
// on: handlers already bound to this task: toggle, text, notes, location, due, schedule, addLink, removeLink, archive, remove
export default function TaskDetails({ task: t, list: l, write, on, onClose, footer = null }) {
  const canEdit = write && !t.archived;
  return (
    <>
      <div className="cal-panel-h">
        <span className="cal-r-m"><i style={{ background: colorFor(l.id) }} />{l.title}</span>
        <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className={t.done ? 'cal-panel-t done' : 'cal-panel-t'}>
        <input type="checkbox" checked={t.done} disabled={!write} onChange={on.toggle} aria-label="Done" />
        <TitleField key={t.id} value={t.text} canEdit={canEdit} onSave={on.text} />
      </div>
      <NotesField key={`n-${t.id}`} value={t.notes || ''} canEdit={canEdit} onSave={on.notes} />
      <LocationField key={`l-${t.id}`} value={t.location || ''} canEdit={canEdit} onSave={on.location} />
      <PanelLinks key={`links-${t.id}`} links={t.links} canEdit={canEdit} onAdd={on.addLink} onRemove={on.removeLink} />
      <dl className="cal-panel-d">
        <dt>Date</dt>
        <dd><DuePicker value={t.due || null} task={t} canEdit={canEdit} onChange={on.due} /></dd>
        {t.due && (
          <>
            <dt>Time</dt>
            <dd>
              {canEdit ? (
                <TimeFields start={t.start || null} mins={t.mins || DEFAULT_MINS} idPrefix={`td-${t.id}`}
                  onChange={({ start, mins }) => on.schedule(t.due, start, mins)} />
              ) : t.start ? timeRange(t.start, t.mins) : 'All day'}
            </dd>
          </>
        )}
        <dt>Status</dt>
        <dd>{t.archived ? 'Archived' : t.done ? 'Done' : isOverdue(t) ? <span className="late-txt">Overdue</span> : 'Open'}</dd>
        <dt>Added by</dt>
        <dd>{t.createdByName || 'Someone'}</dd>
      </dl>
      {!write && <p className="cal-hint">You can view this task but not change it.</p>}
      {write && <TaskActions archived={!!t.archived} onArchive={on.archive} onDelete={on.remove} />}
      {footer}
    </>
  );
}

// The task's wording: click it (write access) and the title itself becomes editable where it sits, looking the
// same, with the cursor at the end, like editing a comment. No buttons: Enter (or the phone keyboard's Done) saves,
// clicking or tapping anywhere outside it saves and closes, Esc puts it back.
function TitleField({ value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  if (!canEdit) return <span>{value}</span>;
  function save() {
    const v = text.replace(/\s+/g, ' ').trim();
    setEditing(false);
    if (v && v !== value) onSave(v);
    else setText(value);
  }
  // grows with the text (field-sizing where supported, by hand elsewhere)
  const grow = (el) => {
    if (!el || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  return editing ? (
    <textarea className="td-title td-title-edit" ref={grow} autoFocus rows={1} maxLength={500} value={text}
      enterKeyHint="done" aria-label="Task" spellCheck
      onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
      onChange={(e) => { setText(e.target.value.replace(/\n/g, ' ')); grow(e.target); }}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } // blur runs save
        if (e.key === 'Escape') { e.stopPropagation(); setText(value); setEditing(false); }
      }} />
  ) : (
    <button type="button" className="td-title" onClick={() => setEditing(true)} title="Click to edit">{value}</button>
  );
}

// "What's going to be done": saved when you click away
function NotesField({ value, canEdit, onSave }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (!canEdit) return value ? <p className="cal-notes-read">{value}</p> : null;
  return (
    <label className="field cal-notes">
      <span>What&apos;s going to be done</span>
      <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onSave(text.trim())} placeholder="Details, steps, links…" />
    </label>
  );
}

const mapsUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

export function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

// Where it happens: saved when you click away, with a link to see it on a map
function LocationField({ value, canEdit, onSave }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const maps = value && (
    <a className="td-maps" href={mapsUrl(value)} target="_blank" rel="noopener noreferrer">Open in Maps ↗</a>
  );
  if (!canEdit) {
    return value ? <p className="td-loc-read"><PinIcon /><span>{value}</span>{maps}</p> : null;
  }
  return (
    <label className="field td-loc">
      <span className="field-top"><span>Location</span>{maps}</span>
      <span className="td-loc-in">
        <PinIcon />
        <input maxLength={MAX_LOCATION} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          onBlur={() => text.trim() !== value && onSave(text.trim())}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="Where is it? e.g. Westlands, Nairobi" />
      </span>
    </label>
  );
}

// Links on the task; the add form closes when another task opens (keyed by task)
function PanelLinks({ links, canEdit, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  return <TaskLinks links={links} canEdit={canEdit} adding={adding} setAdding={setAdding} addButton onAdd={onAdd} onRemove={onRemove} />;
}

// Archive / Restore and Delete (asks once more before deleting)
function TaskActions({ archived, onArchive, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="td-acts">
      {confirm ? (
        <>
          <button type="button" className="btn td-del on" onClick={onDelete}><TrashIcon />Confirm delete</button>
          <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
        </>
      ) : (
        <>
          <button type="button" className="btn td-arch" onClick={onArchive}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
            </svg>
            {archived ? 'Restore' : 'Archive'}
          </button>
          <button type="button" className="btn td-del" onClick={() => setConfirm(true)}><TrashIcon />Delete</button>
        </>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

// The time on a task, the same everywhere it's set: All day, or From and To, each a clock time with AM / PM.
// Saved as start 'HH:MM' + length in minutes. Changing From keeps the length; a To before From is held
// (and pointed out) until it's fixed, so a broken time is never saved.
export function TimeFields({ start, mins, onChange, idPrefix }) {
  const allDay = !start;
  const from = start ? toMin(start) : 9 * 60;
  const to = Math.min(from + (mins || DEFAULT_MINS), 1440);
  const [badTo, setBadTo] = useState(null);
  useEffect(() => setBadTo(null), [start, mins]);
  const emit = (f, t) => onChange({ start: fromMin(f), mins: t - f });
  const setFrom = (f) => {
    const t = Math.min(f + (to - from), 1440);
    emit(f, t > f ? t : Math.min(f + DEFAULT_MINS, 1440));
  };
  const setTo = (v) => {
    const t = v === 0 ? 1440 : v; // 12:00 AM as an end time = midnight, the end of the day
    if (t > from) { setBadTo(null); emit(from, t); } else setBadTo(t);
  };
  return (
    <div className="time-fields">
      <label className="chk">
        <input type="checkbox" checked={allDay}
          onChange={(e) => onChange(e.target.checked ? { start: null, mins } : { start: '09:00', mins: mins || DEFAULT_MINS })} />
        All day
      </label>
      {!allDay && (
        <div className="tf-range">
          <span className="tf-l">From</span>
          <ClockInput value={from} onChange={setFrom} id={`${idPrefix}-from`} label="From" />
          <span className="tf-l">To</span>
          <ClockInput value={badTo ?? to} onChange={setTo} id={`${idPrefix}-to`} label="To" invalid={badTo != null} />
        </div>
      )}
      {!allDay && badTo != null && <p className="note err tf-err" role="alert">The To time has to be after the From time.</p>}
    </div>
  );
}

const pad2 = (n) => String(n).padStart(2, '0');
const CLOCK = Array.from({ length: 48 }, (_, i) => i * 15); // 12:00, 12:15 … 11:45 (minutes into the half day)
const clockLabel = (c) => `${Math.floor(c / 60) || 12}:${pad2(c % 60)}`;

// One time of day: the clock time, then AM | PM. value: minutes after midnight (1440 shows as 12:00 AM).
function ClockInput({ value, onChange, id, label, invalid }) {
  const v = value % 1440;
  const pm = v >= 720;
  const clock = v % 720;
  const opts = CLOCK.includes(clock) ? CLOCK : [...CLOCK, clock].sort((a, b) => a - b);
  return (
    <span className={invalid ? 'clock bad' : 'clock'} role="group" aria-label={`${label} time`}>
      <Select id={id} className="time-sel" value={clock} onChange={(c) => onChange(c + (pm ? 720 : 0))} label={`${label} time`}
        options={opts.map((c) => ({ value: c, label: clockLabel(c) }))} />
      <span className="seg ampm" role="group" aria-label={`${label}: AM or PM`}>
        <button type="button" className={pm ? '' : 'on'} aria-pressed={!pm} onClick={() => onChange(clock)}>AM</button>
        <button type="button" className={pm ? 'on' : ''} aria-pressed={pm} onClick={() => onChange(clock + 720)}>PM</button>
      </span>
    </span>
  );
}
