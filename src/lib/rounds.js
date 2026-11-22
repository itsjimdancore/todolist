// Rounds: every time feedback says a task was "re-done", it's unticked and gets another round, a new slot with
// its own date, end date and time (the same as the task's first date). The first round is the task's own
// due / until / start / mins; the later ones are saved on the task as `rounds`: [{ due, until, start, mins }].
import { addDays, daysBetween } from './dates';

export const MAX_ROUNDS = 20;
export const roundsOf = (t) => (Array.isArray(t?.rounds) ? t.rounds : []);

// The task as it looks in round i (0 = its first later round): the same task, with that round's date and time
export const roundView = (t, i) => {
  const r = roundsOf(t)[i] || {};
  return { ...t, due: r.due || null, until: r.until || null, start: r.start || null, mins: r.mins || null, month: null, round: i };
};

// One round changed: like a task's own date, moving its first day moves its whole run, and no day means no time
export function changeRound(t, i, patch) {
  const rounds = roundsOf(t).map((r) => ({ ...r }));
  const r = rounds[i] || {};
  const next = { ...r, ...patch };
  if ('due' in patch && !('until' in patch) && r.until && r.due && patch.due && patch.due !== r.due) {
    next.until = addDays(patch.due, Math.max(1, daysBetween(r.due, r.until)));
  }
  if (!next.due) { delete next.until; delete next.start; delete next.mins; }
  if (!next.until || next.until <= next.due) delete next.until;
  if (!next.start) { delete next.start; delete next.mins; }
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  rounds[i] = next;
  return rounds;
}

export const addRound = (t) => [...roundsOf(t), {}].slice(-MAX_ROUNDS);
export const removeRound = (t, i) => roundsOf(t).filter((_, j) => j !== i);

// The latest round that has a date, or the task itself: what's next for it
export function currentWhen(t) {
  const dated = roundsOf(t).filter((r) => r.due);
  return dated.length ? dated[dated.length - 1] : t;
}
