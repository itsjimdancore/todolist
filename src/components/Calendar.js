'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addTask, addTaskLink, createList, deleteTask, isUnplaced, removeTaskLink, updateTask, watchTasks } from '@/lib/data';
import { stepsPatch } from '@/lib/steps';
import {
  DEFAULT_MINS, addDays, dueLabel, fromKey, fromMin, hourLabel, isOverdue, longDay, monthDays,
  monthTitle, snap, time12, timeRange, toKey, toMin, todayKey, weekday,
} from '@/lib/dates';
import { friendlyError } from '@/lib/firebase';
import { useHolidayCountries, useHolidayCountry, useHolidays } from '@/lib/holidays';
import { canWrite } from '@/lib/permissions';
import { colorFor, initials, toDate } from '@/lib/people';
import { ShareCalendarButton, ShareCalendarDialog, SharedCalendarsBar } from './CalendarShare';
import DaySheet from './DaySheet';
import DuePicker from './DuePicker';
import Loading, { Spinner } from './Loading';
import Select, { inDropdown } from './Select';
import TaskDetails, { TimeFields } from './TaskDetails';
import { useToast } from './Toast';

const HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;
const HOUR_PX = 48;
const SCROLL_TO_HOUR = 7.5; // the week grid opens scrolled to about 7:30
const SORTS = { manual: 'Manual', title: 'Title', open: 'Open first' };

// Live tasks of every list given, as { listId: tasks[] }. Used for the calendar and the sidebar's count.
export function useAllTasks(lists) {
  const [byList, setByList] = useState({});
  const key = lists.map((l) => l.id).join();
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    setByList((prev) => Object.fromEntries(ids.filter((id) => id in prev).map((id) => [id, prev[id]])));
    const stops = ids.map((id) =>
      watchTasks(id, (tasks) => setByList((p) => ({ ...p, [id]: tasks })), () => setByList((p) => ({ ...p, [id]: [] }))));
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return byList;
}

// Open (not archived) tasks, each with its list: [{ t, l }]
export function taskEntries(lists, byList) {
  return lists.flatMap((l) => (byList[l.id] || []).filter((t) => !t.archived).map((t) => ({ t, l })));
}

// How many open tasks are due today or overdue (the sidebar badge)
export const dueNowCount = (entries) =>
  entries.filter(({ t }) => t.due && !t.done && t.due <= todayKey()).length;

// Phones and small tablets get dots + a day list (month) and a 3-day week
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

const sameMonth = (key, [y, m]) => fromKey(key).getFullYear() === y && fromKey(key).getMonth() === m;
const monthOf = (key) => [fromKey(key).getFullYear(), fromKey(key).getMonth()];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const typing = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], .sel, [role="listbox"]');

// Where the pointer is: a time column in Week view (day + minute), a day box, or the all-day row
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const col = el?.closest('[data-col]');
  if (col) {
    const r = col.getBoundingClientRect();
    return { day: col.dataset.col, min: clamp(((y - r.top) / HOUR_PX) * 60, 0, 1439) };
  }
  const cell = el?.closest('[data-day]');
  return cell ? { day: cell.dataset.day, min: null, allDay: cell.dataset.allday === 'true' } : null;
}
const minuteIn = (colEl, y) => clamp(((y - colEl.getBoundingClientRect().top) / HOUR_PX) * 60, 0, 1440);

// lists: my lists, plus (calOwner set) the lists of calendars shared with me
// shares: who I've shared my calendar with · withMe: calendars shared with me ([{ share, lists }])
export default function Calendar({ lists, byList, user, onOpen, shares = null, withMe = [], contacts = [] }) {
  const toast = useToast();
  const narrow = useNarrow();
  const today = todayKey();
  const [view, setView] = useState('month'); // 'month' | 'week' | 'year' (12 months) | 'years' (pick a year)
  const [cursor, setCursor] = useState(today); // the focused / selected day
  const [ym, setYm] = useState(() => monthOf(today)); // the month on screen
  const [country, setCountry] = useHolidayCountry();
  const holidays = useHolidays(ym[0], country);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(() => new Set()); // list ids filtered out
  const [sort, setSort] = useState('manual');
  const [pop, setPop] = useState(null); // { day, rect } — the "+N more" / Enter popover
  const [panel, setPanel] = useState(null); // { listId, taskId } — the task panel
  const [tray, setTray] = useState(false); // the "No date" tray
  const [quick, setQuick] = useState(null); // { day, start, mins, rect } — the quick-create popover
  const [creating, setCreating] = useState(null); // initial values for the "Add to calendar" dialog (scheduling a task you have)
  const [sheet, setSheet] = useState(null); // { day, init? }: the day sheet (what's on that day, and adding to it)
  const [preview, setPreviewState] = useState(null); // while dragging: { kind, entry?, day, start, mins, x, y }
  const previewRef = useRef(null);
  const setPreview = (p) => { previewRef.current = p; setPreviewState(p); };
  const grid = useRef(null);
  const searchRef = useRef(null);
  const focusNext = useRef(false);
  const drag = useRef(null);
  const justDragged = useRef(false);

  // ---- what's on screen
  const order = new Map(lists.map((l, i) => [l.id, i]));
  const q = query.trim().toLowerCase();
  const [hiddenOwners, setHiddenOwners] = useState(() => new Set()); // shared calendars switched off
  const [sharing, setSharing] = useState(false); // the Share calendar window
  const [toolsOpen, setToolsOpen] = useState(false); // phones: Filter, Sort and No date are folded away until tapped
  const narrowed = hidden.size > 0 || sort !== 'manual'; // a filter or sort is on (shown on the folded button)
  const visibleLists = lists.filter((l) => !hidden.has(l.id) && !(l.calOwnerUid && hiddenOwners.has(l.calOwnerUid)));
  const entries = taskEntries(visibleLists, byList).filter((e) => !q || e.t.text.toLowerCase().includes(q));
  const manual = (a, b) => order.get(a.l.id) - order.get(b.l.id) || toDate(a.t.createdAt) - toDate(b.t.createdAt);
  const sorter = { manual, title: (a, b) => a.t.text.localeCompare(b.t.text), open: (a, b) => a.t.done - b.t.done || manual(a, b) }[sort];
  // in a day: all-day tasks first, then by time
  const inDay = (a, b) => !!a.t.start - !!b.t.start || (a.t.start || '').localeCompare(b.t.start || '') || sorter(a, b);
  const byDay = new Map();
  for (const e of entries) if (e.t.due) byDay.set(e.t.due, [...(byDay.get(e.t.due) || []), e]);
  for (const items of byDay.values()) items.sort(inDay);
  const undated = entries.filter((e) => !e.t.due && !e.t.done).sort(sorter);
  const canAdd = !!user; // a new task can always go into a new list of your own (or stay unplaced)
  const writable = lists.filter((l) => canWrite(l.role));
  const placeable = writable.filter((l) => !isUnplaced(l)); // the Unplaced list isn't offered as a list to pick
  const openDay = (day, init = null) => {
    setPop(null); setQuick(null); setPanel(null); setTray(false);
    setCursor(day); setYm(monthOf(day)); setSheet({ day, init });
  };
  const loading = visibleLists.some((l) => !(l.id in byList));

  // ---- changes
  const run = (promise, okMsg) =>
    promise.then(() => okMsg && toast(okMsg)).catch((err) => toast(`Not saved: ${friendlyError(err)}`, 'err'));
  const when = (due, start, mins) => (due ? `${dueLabel(due).toLowerCase()}${start ? `, ${timeRange(start, mins)}` : ''}` : '');
  const actions = {
    toggle: ({ t, l }) => run(updateTask(l, t, user, { done: !t.done })),
    // just the day (keeps the time); no day = no time either
    due: ({ t, l }, due) => t.due !== due &&
      run(updateTask(l, t, user, due ? { due } : { due: null, start: null, mins: null }), due ? `Due ${when(due, t.start, t.mins)}` : 'Due date removed'),
    // day + time together; start null = all day
    schedule: ({ t, l }, due, start, mins) => {
      const patch = { due, start: start || null, mins: start ? mins || DEFAULT_MINS : null };
      if (t.due === patch.due && (t.start || null) === patch.start && (t.mins || null) === patch.mins) return;
      run(updateTask(l, t, user, patch), `Moved to ${when(due, patch.start, patch.mins)}`);
    },
    notes: ({ t, l }, notes) => (t.notes || '') !== notes && run(updateTask(l, t, user, { notes }), 'Notes saved'),
    location: ({ t, l }, location) => (t.location || '') !== location && run(updateTask(l, t, user, { location }), location ? 'Location saved' : 'Location removed'),
    steps: ({ t, l }, steps) => run(updateTask(l, t, user, stepsPatch(steps)), 'Saved'),
    text: ({ t, l }, text) => text !== t.text && run(updateTask(l, t, user, { text }), 'Task renamed'),
    archive: ({ t, l }) => run(updateTask(l, t, user, { archived: !t.archived }), t.archived ? 'Task restored' : 'Task archived'),
    remove: ({ t, l }) => run(deleteTask(l, t, user), 'Task deleted'),
    addLink: ({ t, l }, link) => run(addTaskLink(l, t, user, link), 'Link added'),
    removeLink: ({ t, l }, link) => run(removeTaskLink(l, t, user, link), 'Link removed'),
    open: ({ t, l }) => { setPop(null); setTray(false); setQuick(null); setPanel({ listId: l.id, taskId: t.id }); },
    openList: (l) => onOpen(l.id),
  };
  const latest = useRef(actions);
  latest.current = actions;

  // ---- dragging: move a task (day, and time in Week view), stretch its length, or drag out a new time range
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.started = true;
      const base = { kind: d.kind, entry: d.entry, x: e.clientX, y: e.clientY };
      if (d.kind === 'create') {
        const a = d.startMin;
        const b = snap(minuteIn(d.colEl, e.clientY));
        const s = Math.min(a, b);
        setPreview({ ...base, day: d.day, start: s, mins: Math.max(15, Math.max(a, b) - s) });
      } else if (d.kind === 'resize') {
        const end = snap(minuteIn(d.colEl, e.clientY));
        setPreview({ ...base, day: d.entry.t.due, start: d.startMin, mins: clamp(end - d.startMin, 15, 1440 - d.startMin) });
      } else {
        const at = targetAt(e.clientX, e.clientY);
        const mins = d.entry.t.mins || DEFAULT_MINS;
        if (at?.min != null) setPreview({ ...base, day: at.day, start: clamp(snap(at.min - d.offset), 0, 1440 - 15), mins });
        else setPreview({ ...base, day: at?.day || null, start: null, allDay: at?.allDay, mins });
      }
    };
    const up = (e) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.kind === 'create') {
        setPreview(null);
        if (!d.started) {
          // a click on the time grid: that half hour, for an hour
          const s = Math.min(Math.floor(minuteIn(d.colEl, d.y) / 30) * 30, 1440 - 30);
          return d.onPick({ day: d.day, start: s, mins: DEFAULT_MINS });
        }
        const a = d.startMin;
        const b = snap(minuteIn(d.colEl, e.clientY));
        const s = Math.min(a, b);
        return d.onPick({ day: d.day, start: s, mins: Math.max(15, Math.max(a, b) - s) });
      }
      if (!d.started) return;
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      const p = previewRef.current;
      setPreview(null);
      if (!p?.day) return;
      const { t } = d.entry;
      if (d.kind === 'resize') latest.current.schedule(d.entry, t.due, t.start, p.mins);
      else if (p.start != null) latest.current.schedule(d.entry, p.day, fromMin(p.start), p.mins);
      // a day box keeps the time (Month view); the all-day row removes it (Week view)
      else latest.current.schedule(d.entry, p.day, p.allDay ? null : t.start, t.mins);
    };
    const cancel = () => { drag.current = null; setPreview(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  // a task chip, block or "No date" row: press and drag to move, click to open
  const dragProps = (entry, extra = {}) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || !canWrite(entry.l.role) || e.target.closest('.wk-resize')) return;
      let offset = 0;
      const colEl = e.currentTarget.closest('[data-col]');
      if (colEl && entry.t.start) offset = minuteIn(colEl, e.clientY) - toMin(entry.t.start);
      drag.current = { kind: 'move', entry, x: e.clientX, y: e.clientY, started: false, offset, ...extra };
    },
    onClick: (e) => { e.stopPropagation(); if (!justDragged.current) actions.open(entry); },
  });
  const resizeDown = (entry) => (e) => {
    if (e.button !== 0 || !canWrite(entry.l.role)) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = { kind: 'resize', entry, x: e.clientX, y: e.clientY, started: false,
      colEl: e.currentTarget.closest('[data-col]'), startMin: toMin(entry.t.start) };
  };
  // press on an empty part of a time column: click = that half hour, drag = a range
  const createDown = (day) => (e) => {
    if (e.button !== 0 || !canAdd || e.target.closest('.wk-block')) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    const colEl = e.currentTarget;
    drag.current = {
      kind: 'create', day, colEl, x: e.clientX, y: e.clientY, started: false,
      startMin: snap(minuteIn(colEl, e.clientY), 15),
      onPick: ({ day: d, start, mins }) => {
        setCursor(d);
        const r = colEl.getBoundingClientRect();
        setQuick({ day: d, start: fromMin(start), mins, rect: { left: r.left, right: r.right, top: r.top + (start / 60) * HOUR_PX, bottom: r.top + (start / 60) * HOUR_PX + 40 } });
      },
    };
  };

  // ---- moving around
  const step = view === 'week' ? (narrow ? 3 : 7) : 0;
  function shift(dir) {
    if (view === 'year' || view === 'years') {
      setYm(([yr, mo]) => [yr + dir * (view === 'year' ? 1 : 12), mo]);
    } else if (view === 'month') {
      const d = new Date(ym[0], ym[1] + dir, 1);
      setYm([d.getFullYear(), d.getMonth()]);
      setCursor(toKey(d));
    } else {
      const next = addDays(cursor, dir * step);
      setCursor(next);
      setYm(monthOf(next));
    }
  }
  function goToday() {
    setCursor(today);
    setYm(monthOf(today));
  }
  // Year and years views: pick a month (today, or the 1st), a day, or a year
  function pickMonth(mo) {
    const yr = ym[0];
    setYm([yr, mo]);
    if (!sameMonth(cursor, [yr, mo])) setCursor(sameMonth(today, [yr, mo]) ? today : toKey(new Date(yr, mo, 1)));
    setView('month');
  }
  function pickDay(key) {
    setCursor(key);
    setYm(monthOf(key));
    setView('month');
  }
  function pickYear(yr) {
    setYm(([, mo]) => [yr, mo]);
    setView('year');
  }
  function moveCursor(next) {
    focusNext.current = true;
    setCursor(next);
    if (view === 'month' ? !sameMonth(next, ym) : true) setYm(monthOf(next));
  }
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    grid.current?.querySelector(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, ym, view]);

  // Arrow keys move between days, Enter opens the day
  function onGridKey(e) {
    if (typing(e.target)) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: view === 'month' ? -7 : -1, ArrowDown: view === 'month' ? 7 : 1 }[e.key];
    if (delta) {
      e.preventDefault();
      moveCursor(addDays(cursor, delta));
    } else if (e.key === 'Enter' && e.target.dataset.day) {
      e.preventDefault();
      openDay(cursor);
    }
  }

  // Shortcuts, like Google Calendar: C create · M month · W week · Y year · T today · / search · J / K next / previous
  const keys = useRef(null);
  keys.current = { shift, goToday, cursor, canAdd, busy: !!(creating || quick || panel || pop || tray || sheet), openDay };
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || k.busy) return;
      const key = e.key.toLowerCase();
      if (key === 'c' && k.canAdd) k.openDay(k.cursor, { due: k.cursor });
      else if (key === 'm') setView('month');
      else if (key === 'w') setView('week');
      else if (key === 'y') setView('year');
      else if (key === '/') searchRef.current?.focus();
      else if (key === 't') { focusNext.current = true; k.goToday(); }
      else if (key === 'j' || key === 'n') k.shift(1);
      else if (key === 'k' || key === 'p') k.shift(-1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Clicking a day (anywhere but on a task): in Month view it's picked, and its activities are listed beside
  // (or under) the month, with Open (the day's popup) and + Add; in Week view the day's popup opens
  const dayClick = (key) => (e) => {
    if (e.target.closest('button, input, select, form')) return;
    if (view === 'month') { setCursor(key); setPanel(null); return; }
    openDay(key);
  };

  // ---- the days on screen
  const [y, m] = ym;
  const weekStart = narrow ? cursor : addDays(cursor, -weekday(fromKey(cursor)));
  const weekDays = Array.from({ length: narrow ? 3 : 7 }, (_, i) => addDays(weekStart, i));
  const yearsStart = y - (((y % 12) + 12) % 12); // 12 years a page: 2016–2027, 2028–2039…
  const title = {
    month: () => monthTitle(y, m),
    week: () => rangeTitle(weekDays[0], weekDays[weekDays.length - 1]),
    year: () => String(y),
    years: () => `${yearsStart} – ${yearsStart + 11}`,
  }[view]();
  // Clicking the title zooms out: month or week → the year's months → a page of years
  const zoomOut = { month: 'year', week: 'year', year: 'years' }[view];
  const unit = { month: 'month', week: 'week', year: 'year', years: '12 years' }[view];
  const panelEntry = panel && (() => {
    const l = lists.find((x) => x.id === panel.listId);
    const t = (byList[panel.listId] || []).find((x) => x.id === panel.taskId);
    return l && t ? { t, l } : null;
  })();
  const dropDay = preview?.kind === 'move' && preview.start == null ? preview.day : null;

  const cellProps = (key, items, extra = {}) => ({
    'data-day': key,
    role: 'gridcell',
    tabIndex: key === cursor ? 0 : -1,
    'aria-selected': key === cursor,
    'aria-label': `${fromKey(key).toDateString()}${holidays.byDay.has(key) ? `, ${holidays.byDay.get(key).name}` : ''}${items.length ? `, ${items.length} task${items.length > 1 ? 's' : ''}` : ''}`,
    onClick: dayClick(key),
    onFocus: () => setCursor(key),
    ...extra,
  });

  const dayChips = (key, items, max = MAX_CHIPS) => (
    <>
      {items.slice(0, max).map((e) => <Chip key={`${e.l.id}/${e.t.id}`} entry={e} today={today} {...dragProps(e)} />)}
      {items.length > max && (
        <button type="button" className="cal-more"
          onClick={(ev) => { ev.stopPropagation(); setPop({ day: key, rect: ev.currentTarget.closest('[data-day]').getBoundingClientRect() }); }}>
          +{items.length - max} more
        </button>
      )}
    </>
  );

  return (
    <div className={['cal-wrap', preview?.kind && 'dragging', toolsOpen && 'tools-open'].filter(Boolean).join(' ')}>
      <header className="bar">
        <div className="bar-left">
          <h1>Calendar</h1>
          <div className="meta">Tasks with a due date, from every list you can open{withMe.length ? ' and every calendar shared with you' : ''}</div>
        </div>
        <div className="bar-right">
          <ShareCalendarButton user={user} shares={shares} contacts={contacts} onOpen={() => setSharing(true)} />
        </div>
      </header>

      <SharedCalendarsBar user={user} withMe={withMe} hiddenOwners={hiddenOwners} setHiddenOwners={setHiddenOwners} />
      {sharing && <ShareCalendarDialog user={user} shares={shares || []} contacts={contacts} onClose={() => setSharing(false)} />}

      {/* Toolbar: Search · Filter · Sort · No date · + New task */}
      <div className="cal-toolbar">
        <div className={q ? 'cal-search has-q' : 'cal-search'} role="search"
          onMouseDown={(e) => { if (!e.target.closest('input, button')) { e.preventDefault(); searchRef.current?.focus(); } }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks"
            aria-label="Search tasks" autoComplete="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
          {q ? (
            <>
              <span className="cal-search-n" aria-live="polite">{entries.length} found</span>
              <button type="button" className="cal-search-x" onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                aria-label="Clear search" title="Clear (Esc)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </>
          ) : (
            <kbd className="cal-search-k" title="Press / to search">/</kbd>
          )}
        </div>
        {/* phones: Filter, Sort and No date fold away behind this (closed by default) */}
        <button type="button" className={toolsOpen || narrowed ? 'btn cal-tools-toggle on' : 'btn cal-tools-toggle'}
          onClick={() => setToolsOpen((o) => !o)} aria-expanded={toolsOpen}
          aria-label={toolsOpen ? 'Hide filter, sort and no date' : 'Show filter, sort and no date'} title="Filter, sort, no date">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          {undated.length > 0 && !toolsOpen && <span className="cal-count">{undated.length}</span>}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={toolsOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
        </button>
        <FilterMenu lists={lists} hidden={hidden} setHidden={setHidden} />
        <Select className="cal-sort" value={sort} onChange={setSort} label="Sort tasks" prefix="Sort:"
          options={Object.entries(SORTS).map(([k, label]) => ({ value: k, label }))} />
        <button type="button" className={tray ? 'btn cal-nodate on' : 'btn cal-nodate'} onClick={() => { setPanel(null); setTray((o) => !o); }}
          aria-expanded={tray}>
          No date<span className="cal-count">{undated.length}</span>
        </button>
        {canAdd && (
          <button className="btn primary cal-new" type="button" onClick={() => openDay(cursor, { due: cursor })}
            title="New task (C)">+ New task</button>
        )}
      </div>

      {/* Header bar: Today ‹ › title · [Month | Week] */}
      <div className="cal-hbar">
        <div className="cal-hbar-l">
          <button className="btn cal-today" type="button" onClick={goToday} title="Today (T)">Today</button>
          <button className="btn sq" type="button" onClick={() => shift(-1)} title="Previous (K)"
            aria-label={`Previous ${unit}`}>‹</button>
          <button className="btn sq" type="button" onClick={() => shift(1)} title="Next (J)"
            aria-label={`Next ${unit}`}>›</button>
          <h2 aria-live="polite">
            {zoomOut ? (
              <button type="button" className="cal-title" onClick={() => setView(zoomOut)}
                title={zoomOut === 'year' ? 'See every month of the year' : 'Pick another year'}>
                {title}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
            ) : title}
          </h2>
        </div>
        <div className="seg" role="tablist" aria-label="Calendar view">
          {[['month', 'Month', 'M'], ['week', 'Week', 'W'], ['year', 'Year', 'Y']].map(([k, label, key]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k || (k === 'year' && view === 'years')}
              className={view === k || (k === 'year' && view === 'years') ? 'on' : ''}
              title={`${label} (${key})`} onClick={() => { setView(k); setYm(monthOf(cursor)); }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="page-body">
      {view === 'month' ? (
        <div className="cal-split">
        <section className="cal-month" aria-label={title}>
          <div className="cal-heads" aria-hidden="true">{HEADS.map((h) => <span key={h}>{h}</span>)}</div>
          <div className="cal-grid" role="grid" aria-label={title} ref={grid} onKeyDown={onGridKey}>
            {chunk(monthDays(y, m).map(toKey), 7).map((week) => (
              <div className="cal-row" role="row" key={week[0]}>
                {week.map((key) => {
                  const items = byDay.get(key) || [];
                  const hol = holidays.byDay.get(key);
                  const cls = ['cal-day', !sameMonth(key, ym) && 'out', key === today && 'today', key === cursor && 'sel', hol && 'holiday',
                    dropDay === key && 'drop', quick?.day === key && quick.start == null && 'pending'].filter(Boolean).join(' ');
                  return (
                    <div key={key} className={cls} {...cellProps(key, items)}>
                      <div className="cal-day-h">
                        <span className="cal-num">{fromKey(key).getDate()}</span>
                        {hol && <span className="cal-hol" title={`Public holiday: ${hol.name}`}>{hol.name}</span>}
                      </div>
                      <div className="cal-chips">
                        {quick?.day === key && quick.start == null && <span className="chip ghost-chip">(No title)</span>}
                        {dayChips(key, items)}
                      </div>
                      <span className="cal-dots" aria-hidden="true">
                        {[...new Set(items.map((e) => e.l.id))].slice(0, 4).map((id) => <i key={id} style={{ background: colorFor(id) }} />)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <DayAgenda day={cursor} today={today} items={byDay.get(cursor) || []} holiday={holidays.byDay.get(cursor)} loading={loading}
          actions={actions} canAdd={canAdd} onOpen={() => openDay(cursor)} onAdd={() => openDay(cursor, { due: cursor })} />
        </div>
      ) : view === 'week' ? (
        <WeekView days={weekDays} today={today} byDay={byDay} holidays={holidays.byDay} preview={preview} dropDay={dropDay} quick={quick}
          grid={grid} onKey={onGridKey} cellProps={cellProps} dayChips={dayChips}
          dragProps={dragProps} resizeDown={resizeDown} createDown={createDown} canAdd={canAdd} />
      ) : view === 'year' ? (
        <YearView year={y} today={today} cursor={cursor} byDay={byDay} holidays={holidays} country={country}
          setCountry={setCountry} onPickMonth={pickMonth} onPickDay={pickDay} />
      ) : (
        <YearsView start={yearsStart} current={fromKey(today).getFullYear()} selected={y} byDay={byDay} onPick={pickYear} />
      )}

      </div>

      {quick && (
        <QuickCreate key={`${quick.day}-${quick.start}`} quick={quick} lists={placeable} user={user}
          onClose={() => setQuick(null)}
          onMore={(init) => { setQuick(null); if (init.tab === 'existing') setCreating(init); else openDay(init.due, init); }} />
      )}
      {pop && (
        <DayPopover day={pop.day} rect={pop.rect} items={byDay.get(pop.day) || []} actions={actions}
          onAdd={canAdd ? () => openDay(pop.day, { due: pop.day }) : null}
          onClose={() => setPop(null)} />
      )}
      {panelEntry && <TaskPanel entry={panelEntry} actions={actions} onClose={() => setPanel(null)} />}
      {tray && (
        <NoDateTray lists={visibleLists} items={undated} actions={actions} dragProps={dragProps} onClose={() => setTray(false)} />
      )}
      {creating && (
        <AddTaskDialog lists={placeable} byList={byList} init={creating} user={user}
          onClose={() => setCreating(null)} />
      )}
      {sheet && (
        <DaySheet key={sheet.day} day={sheet.day} items={byDay.get(sheet.day) || []} holiday={holidays.byDay.get(sheet.day)}
          lists={writable} user={user} actions={actions} init={sheet.init} panelOpen={!!panelEntry}
          onDay={(d) => { setCursor(d); setYm(monthOf(d)); setSheet({ day: d, init: null }); }}
          onExisting={(due) => { setSheet(null); setCreating({ due, tab: 'existing' }); }}
          onClose={() => setSheet(null)} />
      )}
      {preview?.kind === 'move' && preview.start == null && (
        <div className="cal-ghost" style={{ left: preview.x + 10, top: preview.y + 10 }} aria-hidden="true">
          <i style={{ background: colorFor(preview.entry.l.id) }} />{preview.entry.t.text}
        </div>
      )}
    </div>
  );
}

// The picked day's activities, listed beside the month (under it on phones and tablets): each with its list,
// time and date. Open shows the day in a popup (a numbered table, and adding to it); + Add goes straight to the form.
function DayAgenda({ day, today, items, holiday, loading, actions, canAdd, onOpen, onAdd }) {
  return (
    <section className="cal-agenda" aria-label={longDay(day)}>
      <div className="cal-agenda-h">
        <h3>{day === today ? `Today · ${longDay(day)}` : longDay(day)}</h3>
        <div className="cal-agenda-acts">
          <button type="button" className="btn small" onClick={onOpen} title="See this day in a popup">Open</button>
          {canAdd && <button type="button" className="btn small primary" onClick={onAdd}>+ Add</button>}
        </div>
      </div>
      {holiday && <p className="cal-hol-line">🎉 Public holiday: {holiday.name}</p>}
      {items.length ? (
        <ul className="cal-rows">
          {items.map((e) => <TaskRow key={`${e.l.id}/${e.t.id}`} entry={e} actions={actions} />)}
        </ul>
      ) : loading ? (
        <Loading hint="Getting your tasks" />
      ) : (
        <div className="cal-agenda-empty">
          <p>Nothing planned on this day.</p>
          {canAdd && <button type="button" className="btn primary" onClick={onAdd}>+ Add an activity</button>}
        </div>
      )}
    </section>
  );
}

function chunk(arr, n) {
  return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
}

function rangeTitle(a, b) {
  const da = fromKey(a);
  const db = fromKey(b);
  const left = da.toLocaleDateString('en-GB', { day: 'numeric', ...(da.getMonth() !== db.getMonth() && { month: 'short' }) });
  return `${left} – ${db.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// One task in a day: time (if any), list colour (or a green check when done), title, initials of who added it
function Chip({ entry, today, ...props }) {
  const { t, l } = entry;
  const late = !t.done && t.due < today;
  const by = t.createdByName || 'Someone';
  return (
    <button type="button" className={['chip', t.done && 'done', late && 'late', canWrite(l.role) && 'can-drag'].filter(Boolean).join(' ')}
      title={`${t.start ? `${timeRange(t.start, t.mins)} · ` : ''}${t.text} · ${l.title}${late ? ' · overdue' : ''}`} {...props}>
      {t.done ? (
        <svg className="chip-ok" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="Done"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <i className="chip-bar" style={{ background: colorFor(l.id) }} aria-hidden="true" />
      )}
      {t.start && <span className="chip-time">{time12(t.start)}</span>}
      <span className="chip-t">{t.text}</span>
      <span className="chip-av" style={{ background: colorFor(by) }} title={`Added by ${by}`}>{initials(by)}</span>
    </button>
  );
}

// Side by side when timed tasks overlap: each gets a lane within its overlapping group
function layoutDay(items) {
  const evs = items
    .map((e) => ({ e, s: toMin(e.t.start), en: toMin(e.t.start) + (e.t.mins || DEFAULT_MINS) }))
    .sort((a, b) => a.s - b.s || b.en - a.en);
  const out = [];
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const ends = [];
    for (const ev of group) {
      let lane = ends.findIndex((end) => end <= ev.s);
      if (lane < 0) { lane = ends.length; ends.push(ev.en); } else ends[lane] = ev.en;
      ev.lane = lane;
    }
    for (const ev of group) ev.lanes = ends.length;
    out.push(...group);
    group = [];
    groupEnd = -1;
  };
  for (const ev of evs) {
    if (group.length && ev.s >= groupEnd) flush();
    group.push(ev);
    groupEnd = Math.max(groupEnd, ev.en);
  }
  if (group.length) flush();
  return out;
}

function WeekView({ days, today, byDay, holidays, preview, dropDay, quick, grid, onKey, cellProps, dayChips, dragProps, resizeDown, createDown, canAdd }) {
  const [now, setNow] = useState(() => new Date());
  const body = useRef(null);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // open scrolled to the morning
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, []);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };
  const blockStyle = (start, mins, lane = 0, lanes = 1) => ({
    top: (start / 60) * HOUR_PX,
    height: Math.max(20, (mins / 60) * HOUR_PX - 2),
    left: `calc(${(lane / lanes) * 100}% + 2px)`,
    width: `calc(${100 / lanes}% - 4px)`,
  });

  return (
    <section className="wk" aria-label="Week">
      <div className="wk-head" style={cols} aria-hidden="true">
        <span />
        {days.map((k) => {
          const d = fromKey(k);
          const hol = holidays.get(k);
          return (
            <span key={k} className={k === today ? 'today' : ''}>
              {HEADS[weekday(d)]} <b>{d.getDate()}</b>
              {hol && <em className="wk-hol" title={`Public holiday: ${hol.name}`}>{hol.name}</em>}
            </span>
          );
        })}
      </div>
      <div className="wk-allday" style={cols} role="grid" aria-label="All-day tasks" ref={grid} onKeyDown={onKey}>
        <span className="wk-gutter-l">All day</span>
        {days.map((k) => {
          const items = (byDay.get(k) || []).filter((e) => !e.t.start);
          const cls = ['wk-cell', dropDay === k && 'drop', quick?.day === k && quick.start == null && 'pending'].filter(Boolean).join(' ');
          return (
            <div key={k} className={cls} {...cellProps(k, items, { 'data-allday': 'true' })}>
              {quick?.day === k && quick.start == null && <span className="chip ghost-chip">(No title)</span>}
              {dayChips(k, items, 4)}
            </div>
          );
        })}
      </div>
      <div className="wk-body" style={cols} ref={body}>
        <div className="wk-gutter" aria-hidden="true">
          {hours.map((h) => <span key={h} style={{ height: HOUR_PX }}>{h ? hourLabel(h) : ''}</span>)}
        </div>
        {days.map((k) => {
          const timed = (byDay.get(k) || []).filter((e) => e.t.start);
          const moving = preview?.entry && preview.kind !== 'create' ? preview.entry : null;
          return (
            <div key={k} className={canAdd ? 'wk-col can-add' : 'wk-col'} data-col={k} style={{ height: 24 * HOUR_PX }}
              onPointerDown={createDown(k)} aria-label={`${longDay(k)}, time grid`}>
              {hours.map((h) => <div key={h} className="wk-hour" style={{ height: HOUR_PX }} aria-hidden="true" />)}
              {layoutDay(timed).map(({ e, s, lane, lanes }) => {
                const isMoving = moving && moving.t.id === e.t.id && moving.l.id === e.l.id;
                return (
                  <button key={`${e.l.id}/${e.t.id}`} type="button"
                    className={['wk-block', e.t.done && 'done', isOverdue(e.t) && 'late', isMoving && 'moving', canWrite(e.l.role) && 'can-drag'].filter(Boolean).join(' ')}
                    style={{ ...blockStyle(s, e.t.mins || DEFAULT_MINS, lane, lanes), '--c': colorFor(e.l.id) }}
                    title={`${timeRange(e.t.start, e.t.mins)} · ${e.t.text} · ${e.l.title}`} {...dragProps(e)}>
                    <span className="wk-block-t">{e.t.text}</span>
                    <span className="wk-block-time">{timeRange(e.t.start, e.t.mins)}</span>
                    {canWrite(e.l.role) && <span className="wk-resize" onPointerDown={resizeDown(e)} aria-hidden="true" />}
                  </button>
                );
              })}
              {/* where a drag will land, or the range being drawn */}
              {preview?.day === k && preview.start != null && (
                <div className="wk-block ghost" style={{ ...blockStyle(preview.start, preview.mins), '--c': preview.entry ? colorFor(preview.entry.l.id) : 'var(--accent)' }}
                  aria-hidden="true">
                  <span className="wk-block-t">{preview.entry ? preview.entry.t.text : '(No title)'}</span>
                  <span className="wk-block-time">{timeRange(fromMin(preview.start), preview.mins)}</span>
                </div>
              )}
              {/* the slot the quick-create popover is for */}
              {quick?.day === k && quick.start != null && !preview && (
                <div className="wk-block ghost" style={{ ...blockStyle(toMin(quick.start), quick.mins), '--c': 'var(--accent)' }} aria-hidden="true">
                  <span className="wk-block-t">(No title)</span>
                  <span className="wk-block-time">{timeRange(quick.start, quick.mins)}</span>
                </div>
              )}
              {k === today && <div className="wk-now" style={{ top: nowTop }} aria-label="Now" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The 12 months of a year (click a month or a day to open it), with that year's public holidays beside them
function YearView({ year, today, cursor, byDay, holidays, country, setCountry, onPickMonth, onPickDay }) {
  const countries = useHolidayCountries();
  const next = holidays.list.find((h) => h.date >= today); // the next one coming up, if it's in this year
  const fmt = (key, opts) => fromKey(key).toLocaleDateString('en-GB', opts);

  return (
    <div className="yr">
      <section className="yr-grid" aria-label={`Months of ${year}`}>
        {Array.from({ length: 12 }, (_, mo) => (
          <MiniMonth key={mo} year={year} month={mo} today={today} cursor={cursor} byDay={byDay} holidays={holidays.byDay}
            onPickMonth={onPickMonth} onPickDay={onPickDay} />
        ))}
      </section>

      <aside className="yr-hols" aria-label={`Public holidays in ${year}`}>
        <div className="yr-hols-h">
          <h3>Public holidays in {year}</h3>
          <Select className="block" value={country} onChange={setCountry} label="Country" placement="bottom end"
            options={(countries.length ? countries : [{ countryCode: country, name: country }])
              .map((c) => ({ value: c.countryCode, label: c.name, hint: c.countryCode }))} />
        </div>
        {holidays.status === 'loading' && <Loading hint={`Public holidays for ${year}`} />}
        {holidays.status === 'error' && <p className="cal-empty">Couldn&apos;t load the holidays. Check your connection and try again.</p>}
        {holidays.status === 'ok' && !holidays.list.length && <p className="cal-empty">No public holidays listed for {year}.</p>}
        {holidays.list.length > 0 && (
          <ul className="yr-hol-list">
            {holidays.list.map((h) => {
              const cls = ['yr-hol', h.date < today && 'past', h === next && 'next'].filter(Boolean).join(' ');
              return (
                <li key={h.date}>
                  <button type="button" className={cls} onClick={() => onPickDay(h.date)}>
                    <span className="yr-hol-d">
                      <b>{fromKey(h.date).getDate()}</b>{fmt(h.date, { month: 'short' })}
                    </span>
                    <span className="yr-hol-b">
                      <span className="yr-hol-n">{h.name}</span>
                      <span className="yr-hol-m">
                        {fmt(h.date, { weekday: 'long' })}
                        {h.localName && h.localName !== h.name && ` · ${h.localName}`}
                        {h.date === today ? ' · today' : h === next ? ' · next' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="cal-hint">Holidays from Nager.Date. Some dates (like Eid) are only announced close to the day and may be missing.</p>
      </aside>
    </div>
  );
}

function MiniMonth({ year, month, today, cursor, byDay, holidays, onPickMonth, onPickDay }) {
  const days = monthDays(year, month);
  const name = new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long' });
  const inMonth = days.filter((d) => d.getMonth() === month).map(toKey);
  const open = inMonth.reduce((n, key) => n + (byDay.get(key) || []).filter((e) => !e.t.done).length, 0);
  const isNow = sameMonth(today, [year, month]);

  return (
    <div className={isNow ? 'mm now' : 'mm'}>
      <button type="button" className="mm-h" onClick={() => onPickMonth(month)} aria-label={`Open ${name} ${year}`}>
        <b>{name}</b>
        {open > 0 && <span className="mm-c">{open} open</span>}
      </button>
      <div className="mm-heads" aria-hidden="true">{HEADS.map((h) => <span key={h}>{h[0]}</span>)}</div>
      <div className="mm-days">
        {days.map((d) => {
          const key = toKey(d);
          if (d.getMonth() !== month) return <span key={key} className="mm-d out" aria-hidden="true" />;
          const hol = holidays.get(key);
          const n = (byDay.get(key) || []).length;
          const cls = ['mm-d', weekday(d) >= 5 && 'wkend', key === today && 'today', key === cursor && 'sel', hol && 'holiday'].filter(Boolean).join(' ');
          const label = [longDay(key), hol && `public holiday: ${hol.name}`, n && `${n} task${n > 1 ? 's' : ''}`].filter(Boolean).join(', ');
          return (
            <button key={key} type="button" className={cls} title={label} aria-label={label} onClick={() => onPickDay(key)}>
              {d.getDate()}
              {n > 0 && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A page of 12 years: pick one to see its months
function YearsView({ start, current, selected, byDay, onPick }) {
  const tasksIn = (yr) => {
    let n = 0;
    for (const [key, items] of byDay) if (key.startsWith(`${yr}-`)) n += items.length;
    return n;
  };
  return (
    <section className="yrs" aria-label={`Years ${start} to ${start + 11}`}>
      {Array.from({ length: 12 }, (_, i) => start + i).map((yr) => {
        const n = tasksIn(yr);
        return (
          <button key={yr} type="button" className={['yrs-y', yr === current && 'now', yr === selected && 'sel'].filter(Boolean).join(' ')}
            onClick={() => onPick(yr)} aria-current={yr === current ? 'date' : undefined}>
            <b>{yr}</b>
            <span>{n ? `${n} task${n > 1 ? 's' : ''}` : yr === current ? 'This year' : ''}</span>
          </button>
        );
      })}
    </section>
  );
}

// Which list a new task goes into: one you can write to, or a new list made on save
const NEW_LIST = '__new';
function useListChoice(lists, init = {}) {
  const [listId, setListId] = useState(
    init.listId === NEW_LIST || lists.some((l) => l.id === init.listId) ? init.listId : lists[0]?.id || NEW_LIST);
  const [newName, setNewName] = useState(init.newName || '');
  const made = useRef(null); // { name, id }: the list already made, if saving the task then failed (so a retry doesn't make a second one)
  const isNew = listId === NEW_LIST;
  const name = newName.trim();
  return {
    listId, setListId, newName, setNewName, isNew,
    problem: () => (isNew && !name ? 'Give the new list a name.' : null),
    title: isNew ? name : lists.find((l) => l.id === listId)?.title,
    // the list's id, creating it first if it's new
    resolve: async (user) => {
      if (!isNew) return listId;
      if (made.current?.name !== name) made.current = { name, id: await createList(user, name) };
      return made.current.id;
    },
  };
}

function ListPicker({ lists, choice, idPrefix, compact }) {
  return (
    <div className={compact ? 'list-pick compact' : 'list-pick'}>
      <Select id={`${idPrefix}-list`} className="block" value={choice.listId} onChange={choice.setListId} label="List"
        prefix={choice.isNew ? null : <i className="sel-dot" style={{ background: colorFor(choice.listId) }} />}
        options={[
          ...lists.map((l) => ({ value: l.id, label: l.title })),
          { value: NEW_LIST, label: '＋ New list…', divider: lists.length > 0 },
        ]} />
      {choice.isNew && (
        <input id={`${idPrefix}-new-list`} autoFocus={lists.length > 0} maxLength={120} value={choice.newName}
          onChange={(e) => choice.setNewName(e.target.value)} placeholder="Name the new list, e.g. Moving house"
          aria-label="New list name" autoComplete="off" />
      )}
    </div>
  );
}

// Google-style quick create next to what you clicked: title, time, list, Save — or "More options"
function QuickCreate({ quick, lists, user, onClose, onMore }) {
  const toast = useToast();
  const box = useRef(null);
  const [text, setText] = useState('');
  const choice = useListChoice(lists);
  const [time, setTime] = useState({ start: quick.start, mins: quick.mins });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useClickAway(box, true, onClose);

  const W = 340;
  const r = quick.rect;
  const roomRight = window.innerWidth - r.right - 12 >= W;
  const left = roomRight ? r.right + 8 : Math.max(8, r.left - W - 8 >= 8 ? r.left - W - 8 : window.innerWidth - W - 8);
  const top = clamp(r.top, 8, window.innerHeight - 380);
  const more = (tab) => onMore({ due: quick.day, start: time.start, mins: time.mins, text, listId: choice.listId, newName: choice.newName, tab });

  async function save(e) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return setErr('Add a title first.');
    if (choice.problem()) return setErr(choice.problem());
    setBusy(true);
    try {
      const listId = await choice.resolve(user);
      await addTask(lists.find((l) => l.id === listId) || { id: listId }, user, v, quick.day, '', time.start ? time : null);
      toast(`Added${choice.isNew ? ` to the new list “${choice.title}”` : ''} for ${dueLabel(quick.day).toLowerCase()}${time.start ? `, ${timeRange(time.start, time.mins)}` : ''}`);
      onClose();
    } catch (er) {
      setErr(friendlyError(er));
      setBusy(false);
    }
  }

  return (
    <form className="qc" ref={box} role="dialog" aria-label={`New task on ${longDay(quick.day)}`} style={{ left, top, width: W }} onSubmit={save}>
      <div className="qc-h">
        <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <input className="qc-title" autoFocus value={text} onChange={(e) => { setText(e.target.value); setErr(''); }}
        placeholder="Add title" maxLength={500} aria-label="Title" />
      <div className="qc-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <div className="qc-when">
          <b>{longDay(quick.day)}</b>
          <TimeFields start={time.start} mins={time.mins} onChange={setTime} idPrefix="qc" />
        </div>
      </div>
      <div className="qc-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
        <ListPicker lists={lists} choice={choice} idPrefix="qc" compact />
      </div>
      {lists.length > 0 && (
        <button type="button" className="link qc-existing" onClick={() => more('existing')}>Schedule an existing task instead</button>
      )}
      {err && <p className="note err" role="alert">{err}</p>}
      <div className="qc-f">
        <button type="button" className="btn" onClick={() => more('new')}>More options</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner aria-hidden="true" />Saving…</> : 'Save'}</button>
      </div>
    </form>
  );
}

function FilterMenu({ lists, hidden, setHidden }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useClickAway(box, open, () => setOpen(false));
  const toggle = (id) => setHidden((h) => {
    const next = new Set(h);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="cal-filter" ref={box}>
      <button type="button" className={hidden.size ? 'btn on' : 'btn'} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>
        Filter{hidden.size > 0 && <span className="cal-count">{lists.length - hidden.size}/{lists.length}</span>}
      </button>
      {open && (
        <div className="cal-menu" role="group" aria-label="Lists to show">
          {lists.map((l) => (
            <label key={l.id} className="cal-menu-i">
              <input type="checkbox" checked={!hidden.has(l.id)} onChange={() => toggle(l.id)} />
              <i style={{ background: colorFor(l.id) }} />{l.title}{l.calOwner && <em className="cal-owner"> · {l.calOwner}</em>}
            </label>
          ))}
          {hidden.size > 0 && <button type="button" className="link" onClick={() => setHidden(new Set())}>Show all lists</button>}
        </div>
      )}
    </div>
  );
}

function useClickAway(ref, active, onAway) {
  const cb = useRef(onAway);
  cb.current = onAway;
  useEffect(() => {
    if (!active) return;
    // a drop-down's options sit outside the popover; picking one, or Escape to close it, keeps the popover open
    const down = (e) => ref.current && !ref.current.contains(e.target) && !inDropdown(e.target) && cb.current();
    const key = (e) => e.key === 'Escape' && !inDropdown(e.target) && cb.current();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [ref, active]);
}

// "+2 more" (or Enter on a day): everything due that day
function DayPopover({ day, rect, items, actions, onAdd, onClose }) {
  const box = useRef(null);
  useClickAway(box, true, onClose);
  const W = 320;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - 420));
  return (
    <div className="cal-pop" ref={box} role="dialog" aria-label={longDay(day)} style={{ left, top, width: W }}>
      <div className="cal-pop-h">
        <b>{longDay(day)}</b>
        <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {items.length ? (
        <ul className="cal-rows">{items.map((e) => <TaskRow key={`${e.l.id}/${e.t.id}`} entry={e} actions={actions} picker={false} />)}</ul>
      ) : (
        <p className="cal-empty">Nothing due on this day.</p>
      )}
      {onAdd && <button type="button" className="btn block" onClick={onAdd}>+ New task on this day</button>}
    </div>
  );
}

function TaskRow({ entry, actions, picker = true }) {
  const { t, l } = entry;
  const write = canWrite(l.role);
  return (
    <li className={t.done ? 'cal-r done' : 'cal-r'}>
      <input type="checkbox" checked={t.done} disabled={!write} onChange={() => actions.toggle(entry)}
        aria-label={`Mark “${t.text}” ${t.done ? 'not done' : 'done'}`} />
      <div className="cal-r-b">
        <button type="button" className="cal-r-t" onClick={() => actions.open(entry)}>{t.text}</button>
        <span className="cal-r-m">
          <i style={{ background: colorFor(l.id) }} />{l.title}{l.calOwner && ` · ${l.calOwner}`}
          {t.start && <em className="cal-r-time"> · {timeRange(t.start, t.mins)}</em>}
        </span>
      </div>
      {picker && <DuePicker value={t.due || null} task={t} canEdit={write} onChange={(due) => actions.due(entry, due)} compact />}
    </li>
  );
}

// Side panel for one task (a sheet from the bottom on phones)
function TaskPanel({ entry, actions, onClose }) {
  const { t, l } = entry;
  const box = useRef(null);
  useClickAway(box, true, onClose);
  const on = {
    toggle: () => actions.toggle(entry),
    text: (text) => actions.text(entry, text),
    notes: (notes) => actions.notes(entry, notes),
    location: (location) => actions.location(entry, location),
    steps: (steps) => actions.steps(entry, steps),
    due: (due) => actions.due(entry, due),
    schedule: (due, start, mins) => actions.schedule(entry, due, start, mins),
    addLink: (link) => actions.addLink(entry, link),
    removeLink: (link) => actions.removeLink(entry, link),
    archive: () => { onClose(); actions.archive(entry); },
    remove: () => { onClose(); actions.remove(entry); },
  };
  return (
    <aside className="cal-panel" ref={box} role="dialog" aria-label={t.text}>
      <TaskDetails task={t} list={l} write={canWrite(l.role)} on={on} onClose={onClose}
        footer={l.calOwner ? <p className="cal-hint">On {l.calOwner}&apos;s calendar, shared with you.</p>
          : isUnplaced(l) ? <p className="cal-hint">Not in a list yet. Put it in one from Unplaced on My List.</p>
          : <button type="button" className="btn block" onClick={() => actions.openList(l)}>Open “{l.title}”</button>} />
    </aside>
  );
}

// Tasks with no due date, by list: drag one onto a day (or a time in Week view), or pick a date
function NoDateTray({ lists, items, actions, dragProps, onClose }) {
  const groups = lists.map((l) => ({ l, items: items.filter((e) => e.l.id === l.id) })).filter((g) => g.items.length);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <aside className="cal-panel cal-tray" aria-label="Tasks with no due date">
      <div className="cal-panel-h">
        <b>No due date</b>
        <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="cal-hint">Drag a task onto a day, or onto a time in Week view. Or pick a date.</p>
      {groups.length === 0 && <p className="cal-empty">Every open task has a date.</p>}
      {groups.map(({ l, items: its }) => (
        <section key={l.id} className="cal-tray-g">
          <h4><i style={{ background: colorFor(l.id) }} />{l.title}<span>{its.length}</span></h4>
          <ul className="cal-rows">
            {its.map((e) => (
              <li key={e.t.id} className="cal-r tray">
                <button type="button" className={canWrite(l.role) ? 'cal-r-t grab' : 'cal-r-t'} {...dragProps(e)}>{e.t.text}</button>
                <DuePicker value={null} task={e.t} canEdit={canWrite(l.role)} onChange={(due) => actions.due(e, due)} compact />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

// The full "Add to calendar" dialog (+ New task, C, "More options"): schedule a task you already have, or write a new one
function AddTaskDialog({ lists, byList, init, user, onClose }) {
  const toast = useToast();
  const open = taskEntries(lists, byList).filter((e) => !e.t.done);
  const [tab, setTab] = useState(init.tab || (open.length && !init.text ? 'existing' : 'new'));
  const [due, setDue] = useState(init.due || null);
  const [time, setTime] = useState({ start: init.start || null, mins: init.mins || DEFAULT_MINS });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // existing
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(true);
  const [picked, setPicked] = useState(null); // 'listId/taskId'
  // new
  const choice = useListChoice(lists, init);
  const [text, setText] = useState(init.text || '');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !inDropdown(e.target) && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const myCount = open.filter((e) => e.t.createdBy === user.uid).length;
  const choices = open
    .filter((e) => (!mine || e.t.createdBy === user.uid) && (!term || e.t.text.toLowerCase().includes(term)))
    // no date first, then soonest, then A–Z
    .sort((a, b) => !!a.t.due - !!b.t.due || (a.t.due || '').localeCompare(b.t.due || '') || a.t.text.localeCompare(b.t.text));
  const chosen = open.find((e) => `${e.l.id}/${e.t.id}` === picked);
  const start = due ? time.start : null;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (tab === 'existing') {
      if (!chosen) return setErr('Pick a task to schedule.');
      if (!due) return setErr('Pick a date to schedule it for.');
      setBusy(true);
      try {
        await updateTask(chosen.l, chosen.t, user, { due, start, mins: start ? time.mins : null });
        toast(`“${chosen.t.text}” scheduled for ${dueLabel(due).toLowerCase()}${start ? `, ${timeRange(start, time.mins)}` : ''}`);
        onClose();
      } catch (er) {
        setErr(friendlyError(er));
        setBusy(false);
      }
      return;
    }
    const v = text.trim();
    if (!v) return setErr('Write the task first.');
    if (choice.problem()) return setErr(choice.problem());
    setBusy(true);
    try {
      const listId = await choice.resolve(user);
      await addTask(lists.find((l) => l.id === listId) || { id: listId }, user, v, due, notes.trim(), start ? { start, mins: time.mins } : null);
      toast(`Added to ${choice.isNew ? 'the new list ' : ''}“${choice.title}”${due ? `, due ${dueLabel(due).toLowerCase()}` : ''}`);
      onClose();
    } catch (er) {
      setErr(friendlyError(er));
      setBusy(false);
    }
  }

  const go = (t) => { setTab(t); setErr(''); };
  const action = tab === 'existing'
    ? (chosen?.t.due ? 'Move' : 'Schedule') + (due ? ` to ${dueLabel(due)}` : '')
    : 'Add task';

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal small-modal cal-add" role="dialog" aria-modal="true" aria-labelledby="add-task-title" onSubmit={submit}>
        <div className="m-h">
          <div>
            <h2 id="add-task-title">Add to calendar</h2>
            {due && <div className="cal-add-day">{longDay(due)}{start ? ` · ${timeRange(start, time.mins)}` : ''}</div>}
          </div>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-b">
          <div className="seg cal-add-tabs" role="tablist" aria-label="Task">
            <button type="button" role="tab" aria-selected={tab === 'existing'} className={tab === 'existing' ? 'on' : ''}
              onClick={() => go('existing')}>Existing task</button>
            <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'on' : ''}
              onClick={() => go('new')}>New task</button>
          </div>

          {tab === 'existing' ? (
            <>
              <div className="cal-pick-tools">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your tasks"
                  aria-label="Search tasks" autoFocus />
                <div className="seg small" role="group" aria-label="Whose tasks">
                  <button type="button" className={mine ? 'on' : ''} aria-pressed={mine} onClick={() => setMine(true)}>Added by me</button>
                  <button type="button" className={!mine ? 'on' : ''} aria-pressed={!mine} onClick={() => setMine(false)}>All tasks</button>
                </div>
              </div>
              {choices.length ? (
                <ul className="cal-pick" role="radiogroup" aria-label="Tasks">
                  {choices.map((c) => {
                    const id = `${c.l.id}/${c.t.id}`;
                    return (
                      <li key={id}>
                        <label className={picked === id ? 'cal-pick-r on' : 'cal-pick-r'}>
                          <input type="radio" name="existing-task" checked={picked === id} onChange={() => { setPicked(id); setErr(''); }} />
                          <span className="cal-r-b">
                            <span className="cal-pick-t">{c.t.text}</span>
                            <span className="cal-r-m">
                              <i style={{ background: colorFor(c.l.id) }} />{c.l.title}
                              {' · '}{c.t.due ? <em className={isOverdue(c.t) ? 'late-txt' : ''}>{dueLabel(c.t.due)}{c.t.start ? ` ${time12(c.t.start)}` : ''}</em> : 'No date'}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="cal-empty">
                  {term ? 'No tasks match that search.' : mine ? "You haven't added any open tasks yet." : 'No open tasks.'}
                  {mine && !term && myCount === 0 && open.length > 0 && (
                    <> <button type="button" className="link" onClick={() => setMine(false)}>Show all tasks</button></>
                  )}
                  {' '}<button type="button" className="link" onClick={() => go('new')}>Write a new one</button>
                </p>
              )}
            </>
          ) : (
            <>
              <label className="field">
                <span>Task</span>
                <input id="cal-task-text" autoFocus maxLength={500} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }}
                  placeholder="What needs doing?" autoComplete="off" />
              </label>
              <label className="field">
                <span>What&apos;s going to be done <em className="opt">optional</em></span>
                <textarea id="cal-task-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Details, steps, links…" />
              </label>
              <div className="field">
                <label htmlFor="cal-task-list">List</label>
                <ListPicker lists={lists} choice={choice} idPrefix="cal-task" />
                {choice.isNew && <span className="list-pick-note">A new list of your own is made when you add the task. You can share it later.</span>}
              </div>
            </>
          )}

          <div className="field">
            <span>Date</span>
            <div><DuePicker value={due} onChange={(d) => { setDue(d); setErr(''); }} /></div>
          </div>
          {due && (
            <div className="field">
              <span>Time</span>
              <TimeFields start={time.start} mins={time.mins} onChange={setTime} idPrefix="dlg" />
            </div>
          )}
          {err && <p className="note err" role="alert">{err}</p>}
        </div>
        <div className="m-f end">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? <><Spinner aria-hidden="true" />Saving…</> : action}</button>
        </div>
      </form>
    </div>
  );
}
