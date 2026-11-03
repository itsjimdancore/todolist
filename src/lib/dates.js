// Due dates are whole days, stored as 'YYYY-MM-DD' strings in local time,
// so a task due "27 Oct" is due on 27 Oct wherever you open the app.

const pad = (n) => String(n).padStart(2, '0');

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// Monday-first weekday: 0 = Mon … 6 = Sun
export const weekday = (d) => (d.getDay() + 6) % 7;

// Quick picks in the date picker
export function quickDates() {
  const t = todayKey();
  const wd = weekday(fromKey(t));
  return [
    { label: 'Today', key: t },
    { label: 'Tomorrow', key: addDays(t, 1) },
    { label: 'This weekend', key: wd >= 5 ? t : addDays(t, 5 - wd) }, // Saturday (or today if it's the weekend)
    { label: 'Next week', key: addDays(t, 7 - wd) }, // next Monday
  ];
}

// "Today", "Tomorrow", "Yesterday", "Thu 22 Oct", or "Thu 22 Oct 2027" outside this year
export function dueLabel(key) {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, 1)) return 'Tomorrow';
  if (key === addDays(t, -1)) return 'Yesterday';
  const d = fromKey(key);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

export const isOverdue = (task) => !!task.due && !task.done && task.due < todayKey();

// How a list orders its tasks, so setting a date moves the task into place by itself:
// open tasks with a date first, soonest first (so overdue ones are on top); on the same day, all-day ones and
// then by start time; then open tasks with no date; finished tasks last. Ties keep their order (newest first).
export function byDue(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  if (!a.due !== !b.due) return a.due ? -1 : 1;
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if ((a.start || '') !== (b.start || '')) return (a.start || '') < (b.start || '') ? -1 : 1;
  return 0;
}

// Every day shown in a month grid: Monday of the first week → Sunday of the last
export function monthDays(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - weekday(first));
  const last = new Date(year, month + 1, 0);
  const count = weekday(first) + last.getDate() + (6 - weekday(last));
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export const monthTitle = (year, month) => new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// ---- times of day: 'HH:MM' strings, lengths in minutes
export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (n) => (n >= 1440 ? '24:00' : `${pad(Math.floor(n / 60))}:${pad(n % 60)}`);
export const snap = (n, step = 15) => Math.round(n / step) * step;
export const DEFAULT_MINS = 60;
export const TIMES = Array.from({ length: 96 }, (_, i) => fromMin(i * 15)); // 00:00 … 23:45
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480];
export const durLabel = (m) => (m < 60 ? `${m} min` : `${m / 60} h`);
// Times are shown the same way everywhere: 12-hour with AM / PM ('9:30 AM'). Minutes past midnight → label;
// 1440 (the end of the day) is '12:00 AM' too.
export const minLabel = (n) => {
  const m = ((n % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`;
};
// 'HH:MM' → '9:30 AM'
export const time12 = (hhmm) => (hhmm ? minLabel(toMin(hhmm)) : '');
// '9:00 AM – 10:30 AM'
export const timeRange = (start, mins = DEFAULT_MINS) =>
  start ? `${time12(start)} – ${minLabel(Math.min(toMin(start) + mins, 1440))}` : '';
// '9 AM' (the week view's hour lines)
export const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export const longDay = (key) => fromKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
