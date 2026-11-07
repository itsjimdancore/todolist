'use client';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MINS, dueLabel, fromMin, isOverdue, timeRange, toMin, todayKey } from '@/lib/dates';
import { colorFor } from '@/lib/people';
import DuePicker from './DuePicker';
import Select from './Select';
import TaskLinks, { LinkIcon } from './TaskLinks';
import { normalizeUrl } from '@/lib/links';
import { MAX_RATING, MAX_STEPS, MAX_STEP_TEXT, clampRating, emptyStep, ratingWord, sameSteps, stepsOf } from '@/lib/steps';

export const MAX_LOCATION = 200;

// Everything about one task: title, what's going to be done, where, links, date and time, status, who added it,
// and (with write access) Archive and Delete. Used by the Calendar's side panel and the popup in a list.
// on: handlers already bound to this task: toggle, text, steps, due, schedule, removeLink, archive, remove
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
      <OverallRating key={`r-${t.id}`} task={t} canEdit={canEdit} onSave={on.rating} />
      <StepsField key={`s-${t.id}`} value={stepsOf(t)} canEdit={canEdit} onSave={on.steps} />
      {/* links added before steps had their own: still shown (and removable), but no longer added here */}
      <TaskLinks links={t.links} canEdit={canEdit} onRemove={on.removeLink} />
      <dl className="cal-panel-d">
        <dt>Date</dt>
        {/* on a day (then a time below), or sometime during a month (no time; its steps can have their own dates) */}
        <dd><DuePicker value={t.due || null} month={t.month || null} task={t} canEdit={canEdit} onChange={on.due} onMonth={on.month} /></dd>
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

const mapsUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

export function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

// The steps in a task row: one line each, what's going to be done then its location beside it
export function StepLines({ task }) {
  const steps = stepsOf(task).filter((s) => s.text || s.location);
  if (!steps.length) return null;
  return (
    <ul className="step-lines">
      {steps.map((s, i) => (
        <li key={i} className={s.done ? 'sl-done' : ''}>
          {s.done && <span className="sl-tick" aria-label="Done">✓</span>}
          {s.text && <span className="sl-t">{s.text}</span>}
          {s.location && <span className="sl-loc"><PinIcon /><span>{s.location}</span></span>}
          {s.due && <span className={!s.done && s.due < todayKey() ? 'sl-due late-txt' : 'sl-due'}>{dueLabel(s.due)}</span>}
          {s.done && s.rating > 0 && <span className="sl-rate">★ {s.rating}/{MAX_RATING}</span>}
        </li>
      ))}
    </ul>
  );
}

const MapsLink = ({ place }) => (place
  ? <a className="td-maps" href={mapsUrl(place)} target="_blank" rel="noopener noreferrer">Open in Maps ↗</a>
  : null);

let stepSeq = 0;
const withKeys = (steps) => (steps.length ? steps : [emptyStep()]).map((s) => ({ ...s, key: ++stepSeq }));

// "What's going to be done", step by step. Each step: what (a line), where (a line), Open in Maps above them on
// the right, and a link if wanted. + adds another step. Saved when you click away from a field.
function StepsField({ value, canEdit, onSave }) {
  const [steps, setSteps] = useState(() => withKeys(value));
  const [badUrl, setBadUrl] = useState(null); // key of the step whose link isn't a web address
  const saved = JSON.stringify(value);
  // changed elsewhere: show that (unless it matches what's here, so a new step still being typed stays)
  useEffect(() => { setSteps((cur) => (sameSteps(cur, value) ? cur : withKeys(value))); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canEdit) {
    if (!value.length) return null;
    return (
      <div className="steps">
        <span className="steps-h">What&apos;s going to be done</span>
        <ol className="steps-read">
          {value.map((s, i) => (
            <li key={i} className={s.done ? 'step-done' : ''}>
              {s.text && <p>{s.done && <span className="step-r-tick" aria-label="Done">✓ </span>}<span className="step-r-t">{s.text}</span></p>}
              {s.due && <p className="step-r-due"><DuePicker value={s.due} task={{ due: s.due, done: s.done }} canEdit={false} onChange={() => {}} /></p>}
              {s.location && <p className="step-r-loc"><PinIcon /><span>{s.location}</span><MapsLink place={s.location} /></p>}
              {s.done && s.rating > 0 && (
                <p className="step-r-rate"><span className="rate-bar" aria-hidden="true"><span style={{ width: `${(s.rating / MAX_RATING) * 100}%` }} /></span>
                  {ratingWord(s.rating)} · {s.rating}/{MAX_RATING}</p>
              )}
              {s.url && <a className="step-r-link" href={s.url} target="_blank" rel="noopener noreferrer"><LinkIcon /><span>{s.url}</span></a>}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  function save(next = steps) {
    const bad = next.find((s) => s.url.trim() && !normalizeUrl(s.url));
    if (bad) return setBadUrl(bad.key);
    setBadUrl(null);
    const fixed = next.map((s) => (s.url.trim() ? { ...s, url: normalizeUrl(s.url) } : s));
    if (fixed.some((s, i) => s.url !== next[i].url)) setSteps(fixed);
    if (!sameSteps(fixed, value)) onSave(fixed);
  }
  const set = (key, field) => (e) => {
    const v = field === 'rating' ? Number(e.target.value) : e.target.value;
    setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, [field]: v } : s)));
    if (field === 'url' && badUrl === key) setBadUrl(null);
  };
  // a tick or a date: saved straight away
  const change = (key, patch) => {
    const next = steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
    setSteps(next);
    save(next);
  };
  const openLink = (key) => setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, linkOpen: true } : s)));
  const remove = (key) => {
    const rest = steps.filter((s) => s.key !== key);
    const next = rest.length ? rest : withKeys([]);
    setSteps(next);
    save(next);
  };
  const enterBlurs = (e) => e.key === 'Enter' && e.currentTarget.blur();

  return (
    <div className="steps">
      <span className="steps-h">What&apos;s going to be done</span>
      {steps.map((s, i) => (
        <div className={s.done ? 'step done' : 'step'} key={s.key}>
          <div className="step-top">
            {/* tick it off once there's something written to do */}
            {s.text.trim() ? (
              <label className="step-tick">
                <input type="checkbox" checked={!!s.done} onChange={() => change(s.key, { done: !s.done })}
                  aria-label={`Step ${i + 1}: ${s.done ? 'done' : 'mark as done'}`} />
                <span>{s.done ? 'Done' : steps.length > 1 ? `Step ${i + 1}` : 'Mark done'}</span>
              </label>
            ) : <span className="step-n">{steps.length > 1 ? `Step ${i + 1}` : ''}</span>}
            <span className="step-gap" />
            <MapsLink place={s.location.trim()} />
            {(steps.length > 1 || s.text || s.location || s.url) && (
              <button type="button" className="ic step-x" onClick={() => remove(s.key)} aria-label={`Remove step ${i + 1}`}>✕</button>
            )}
          </div>
          <input type="text" className="line-in" maxLength={MAX_STEP_TEXT} value={s.text} onChange={set(s.key, 'text')}
            onBlur={() => save()} onKeyDown={enterBlurs} autoComplete="off" autoFocus={!!s.fresh}
            placeholder={i ? 'What happens next?' : "What's going to be done?"} aria-label={`Step ${i + 1}: what's going to be done`} />
          <span className="line-row">
            <PinIcon />
            <input type="text" className="line-in" maxLength={MAX_LOCATION} value={s.location} onChange={set(s.key, 'location')}
              onBlur={() => save()} onKeyDown={enterBlurs} autoComplete="off"
              placeholder="Location, e.g. Westlands, Nairobi" aria-label={`Step ${i + 1}: location`} />
          </span>
          {/* its own day (no time) */}
          {s.text.trim() && (
            <span className="step-due">
              <DuePicker value={s.due || null} task={{ due: s.due, done: s.done }} onChange={(due) => change(s.key, { due: due || '' })} />
            </span>
          )}
          {/* once it's ticked off: how was it? Saved when you let go of the slider */}
          {s.done && (
            <RatingSlider value={s.rating} onChange={set(s.key, 'rating')} onCommit={() => save()}
              ariaLabel={`Step ${i + 1}: rate the experience`} />
          )}
          {s.url || s.linkOpen ? (
            <span className="line-row">
              <LinkIcon />
              {/* not type="url": the browser would refuse a bare "example.com" */}
              <input type="text" className="line-in" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={2000}
                value={s.url} onChange={set(s.key, 'url')} onBlur={() => save()} onKeyDown={enterBlurs} autoComplete="off"
                autoFocus={!!s.linkOpen && !s.url} placeholder="Link (optional)" aria-label={`Step ${i + 1}: link`} />
              {normalizeUrl(s.url) && <a className="td-maps" href={normalizeUrl(s.url)} target="_blank" rel="noopener noreferrer">Open ↗</a>}
            </span>
          ) : (
            <button type="button" className="ic step-link-add" onClick={() => openLink(s.key)}>
              + Link <span className="opt">optional</span>
            </button>
          )}
          {badUrl === s.key && <p className="link-err" role="alert">Enter a web address, like example.com</p>}
        </div>
      ))}
      {steps.length < MAX_STEPS && (
        <button type="button" className="step-add" onClick={() => setSteps((cur) => [...cur, { ...emptyStep(), key: ++stepSeq, fresh: true }])}>
          <span aria-hidden="true">+</span> Add another
        </button>
      )}
    </div>
  );
}

// A 0-10 slider to rate an experience (0 = not rated yet). onChange gets the input's change event as it moves;
// onCommit runs when it's let go of (pointer, key or focus leaving), which is when it's saved.
// On phones a drag can end without a pointerup (it turns into a scroll) and the slider may never get focus, so
// it also saves itself a moment after the last change. (Saving twice is harmless: unchanged, nothing is sent.)
function RatingSlider({ value, onChange, onCommit, ariaLabel, title = 'Rate the experience', hint = null }) {
  const latest = useRef(onCommit);
  latest.current = onCommit; // the timer saves with this render's (up-to-date) values
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = () => { clearTimeout(timer.current); latest.current(); };
  const changed = (e) => {
    onChange(e);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), 700);
  };
  return (
    <div className="step-rate">
      <span className="step-rate-top">
        <span className="rate-title">{title}{hint && <small className="rate-hint">{hint}</small>}</span>
        <span className={value ? 'rate-val on' : 'rate-val'}>{ratingWord(value)}{value ? ` · ${value}/${MAX_RATING}` : ''}</span>
      </span>
      <input type="range" className="rate-in" min={0} max={MAX_RATING} step={1} value={value}
        style={{ '--fill': `${(value / MAX_RATING) * 100}%` }} onChange={changed}
        onPointerDown={(e) => {
          // touch: a tap anywhere on the track jumps there (iPhone's slider otherwise only moves by its handle)
          if (e.pointerType !== 'touch') return;
          const r = e.currentTarget.getBoundingClientRect();
          const half = 14; // half the handle on phones: the ends of the track are its centre at 0 and 10
          const n = Math.round(((e.clientX - r.left - half) / Math.max(1, r.width - 2 * half)) * MAX_RATING);
          const v = Math.min(MAX_RATING, Math.max(0, n));
          if (v !== value) changed({ target: { value: String(v) } });
        }}
        onPointerUp={commit} onPointerCancel={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}
        aria-label={ariaLabel} aria-valuetext={`${ratingWord(value)}, ${value} out of ${MAX_RATING}`} />
      <span className="rate-ticks" aria-hidden="true"><span>0</span><span>5</span><span>10</span></span>
    </div>
  );
}

// The whole thing, rated overall (e.g. the date as a whole, after its steps). Shows once the task or any of its
// steps is ticked off, along with the average of the steps' own ratings as a guide. Saved when let go of.
function OverallRating({ task: t, canEdit, onSave }) {
  const saved = clampRating(t.rating);
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const steps = stepsOf(t);
  const rated = steps.filter((s) => s.done && s.rating > 0);
  const avg = rated.length ? Math.round((rated.reduce((n, s) => n + s.rating, 0) / rated.length) * 10) / 10 : 0;
  const hint = rated.length > 1 ? `steps average ${avg}` : null;

  if (!canEdit) {
    if (!saved) return null;
    return (
      <p className="overall-read">
        <span className="rate-bar" aria-hidden="true"><span style={{ width: `${(saved / MAX_RATING) * 100}%` }} /></span>
        Overall: {ratingWord(saved)} · {saved}/{MAX_RATING}
      </p>
    );
  }
  if (!t.done && !saved && !steps.some((s) => s.done)) return null;
  return (
    <div className="overall-rate">
      <RatingSlider value={value} title="Overall experience" hint={hint} ariaLabel="Rate the experience overall"
        onChange={(e) => setValue(Number(e.target.value))} onCommit={() => value !== saved && onSave(value)} />
    </div>
  );
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
