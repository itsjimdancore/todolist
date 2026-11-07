'use client';
import { useEffect, useRef, useState } from 'react';
import { dueLabel, fromKey, isOverdue, monthDays, monthKeyOf, monthLabel, monthTitle, quickDates, thisMonthKey, toKey, todayKey } from '@/lib/dates';

const HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function CalIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

// The due-date pill on a task. Opens quick picks + a small month; read-only roles just see the date.
// compact: an icon-only button (next to "Add a task") until a date is picked.
// month / onMonth (optional): the task can instead happen sometime during a month ('YYYY-MM', no time); with
// onMonth the picker has two choices at the top, On a day and During a month.
// label: what the empty button says (a step's date is "Due date" too, but could say something else)
export default function DuePicker({ value, onChange, task, canEdit = true, compact = false, time = null,
  month = null, onMonth = null, label: what = 'Due date' }) {
  const [open, setOpen] = useState(null); // where the picker sits on screen while open
  const box = useRef(null);
  const btn = useRef(null);
  const overdue = task ? isOverdue(task) : false;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDown = (e) => box.current && !box.current.contains(e.target) && close();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // close just the picker, not the dialog or panel it's in
      close();
    };
    // it's placed against the window, so it can't follow its button once something scrolls
    const onScroll = (e) => !box.current?.contains(e.target) && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Placed against the window (not its container), so a scrolling dialog, panel or tray can't cut it off:
  // under the button, or above it when there's no room below
  function toggle() {
    if (open) return setOpen(null);
    const r = btn.current.getBoundingClientRect();
    const W = 280;
    const H = 440;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const below = r.bottom + 6;
    const top = below + H <= window.innerHeight - 8 ? below : Math.max(8, r.top - H - 6);
    setOpen({ left, top });
  }

  const set = value || month;
  const cls = ['due', set ? 'set' : 'empty', overdue && 'late', task?.done && 'done', compact && !set && 'icon-only']
    .filter(Boolean).join(' ');
  const late = overdue ? 'Overdue · ' : '';
  const label = value ? `${late}${dueLabel(value)}${time ? ` · ${time}` : ''}`
    : month ? `${late}${monthLabel(month).includes('month') ? monthLabel(month) : `During ${monthLabel(month)}`}`
    : compact ? '' : what;

  if (!canEdit) return set ? <span className={cls}><CalIcon size={12} />{label}</span> : null;

  const pick = (key) => { onChange(key); setOpen(null); };
  const pickMonth = (key) => { onMonth(key); setOpen(null); };

  return (
    <div className="due-wrap" ref={box}>
      <button type="button" ref={btn} className={cls} onClick={toggle} aria-expanded={!!open} aria-haspopup="dialog"
        aria-label={set ? `${label}. Change the date` : `Add a ${what.toLowerCase()}`} title={set ? 'Change the date' : `Add a ${what.toLowerCase()}`}>
        <CalIcon size={set || compact ? 13 : 12} />{label}
      </button>
      {open && <Popover value={value} onPick={pick} at={open} month={month} onMonth={onMonth ? pickMonth : null} />}
    </div>
  );
}

function Popover({ value, onPick, at, month, onMonth }) {
  const [mode, setMode] = useState(month && !value ? 'month' : 'day');
  const start = value ? fromKey(value) : month ? fromKey(`${month}-01`) : new Date();
  const [ym, setYm] = useState([start.getFullYear(), start.getMonth()]);
  const [y, m] = ym;
  const today = todayKey();
  const shift = (n) => setYm(([yy, mm]) => [new Date(yy, mm + n, 1).getFullYear(), new Date(yy, mm + n, 1).getMonth()]);

  return (
    <div className="due-pop" role="dialog" aria-label="Due date" style={{ left: at.left, top: at.top }}>
      {onMonth && (
        <div className="due-modes" role="tablist" aria-label="When it happens">
          <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
            On a day<small>with a time</small>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'month'} className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
            During a month<small>no set day</small>
          </button>
        </div>
      )}
      {mode === 'month' ? <MonthGrid year={y} value={month} onPick={onMonth} shiftYear={(n) => shift(12 * n)} /> : (<>
      {quickDates().map((q) => (
        <button key={q.label} type="button" className={value === q.key ? 'due-q on' : 'due-q'} onClick={() => onPick(q.key)}>
          {q.label}<small>{fromKey(q.key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</small>
        </button>
      ))}
      <div className="due-sep" />
      <div className="due-mh">
        <b>{monthTitle(y, m)}</b>
        <button type="button" className="ic" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <button type="button" className="ic" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="due-grid">
        {HEADS.map((h, i) => <span key={i} className="due-wd">{h}</span>)}
        {monthDays(y, m).map((d) => {
          const k = toKey(d);
          const cls = ['due-d', d.getMonth() !== m && 'out', k === today && 'today', k === value && 'on'].filter(Boolean).join(' ');
          return (
            <button key={k} type="button" className={cls} onClick={() => onPick(k)} aria-label={d.toDateString()}
              aria-pressed={k === value}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      </>)}
      {(value || month) && (
        <button type="button" className="due-clear" onClick={() => (value ? onPick(null) : onMonth(null))}>Remove date</button>
      )}
    </div>
  );
}

// During a month: the twelve months of a year to pick from, with arrows for the year
function MonthGrid({ year, value, onPick, shiftYear }) {
  const now = thisMonthKey();
  const name = (m, opts) => new Date(year, m, 1).toLocaleDateString('en-GB', opts);
  return (
    <>
      <div className="due-mh">
        <b>{year}</b>
        <button type="button" className="ic" onClick={() => shiftYear(-1)} aria-label="Previous year">‹</button>
        <button type="button" className="ic" onClick={() => shiftYear(1)} aria-label="Next year">›</button>
      </div>
      <div className="due-months">
        {Array.from({ length: 12 }, (_, m) => {
          const k = monthKeyOf(year, m);
          const cls = ['due-m', k === now && 'today', k === value && 'on', k < now && 'past'].filter(Boolean).join(' ');
          return (
            <button key={k} type="button" className={cls} onClick={() => onPick(k)} aria-pressed={k === value}
              aria-label={name(m, { month: 'long', year: 'numeric' })}>
              {name(m, { month: 'short' })}
            </button>
          );
        })}
      </div>
    </>
  );
}
