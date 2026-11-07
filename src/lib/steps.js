// "What's going to be done", step by step: each step is { text, location, url, due, done, rating }.
// url and due are optional (due: a whole day, 'YYYY-MM-DD', see lib/dates.js); done: ticked off; rating: how the
// experience was once it's done, 1-10, or 0 for not rated yet.
// Saved on the task as `steps`, with `notes` (every step's text, one per line) and `location` (the first step's
// place) kept alongside, so the list view, search and the day sheet keep showing them.
export const MAX_STEPS = 20;
export const MAX_STEP_TEXT = 500;
export const MAX_RATING = 10;

export const emptyStep = () => ({ text: '', location: '', url: '', due: '', done: false, rating: 0 });

// A rating kept to a whole number from 0 (not rated) to 10 (a few early ones were out of 100)
export function clampRating(r) {
  const n = Math.round(Number(r) || 0);
  return Math.min(MAX_RATING, Math.max(0, n > MAX_RATING ? Math.round(n / 10) : n));
}

// A word for a rating
export const ratingWord = (r) => (!r ? 'Not rated yet' : r <= 2 ? 'Bad' : r <= 4 ? 'Poor' : r <= 6 ? 'Okay' : r <= 8 ? 'Good' : r === 9 ? 'Great' : 'Loved it');

// The task's steps; an older task with just notes / a location becomes one step
export function stepsOf(t) {
  if (Array.isArray(t.steps) && t.steps.length) return t.steps.map((s) => ({ ...emptyStep(), ...s, rating: clampRating(s.rating) }));
  if (t.notes || t.location) return [{ ...emptyStep(), text: t.notes || '', location: t.location || '' }];
  return [];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Trimmed, with empty steps left out
export const cleanSteps = (steps) => steps
  .map((s) => ({
    text: (s.text || '').trim(),
    location: (s.location || '').trim(),
    url: (s.url || '').trim(),
    due: DAY.test(s.due || '') ? s.due : '',
    done: !!s.done,
    rating: clampRating(s.rating), // shown once it's done; kept if it's unticked by mistake
  }))
  .filter((s) => s.text || s.location || s.url)
  .slice(0, MAX_STEPS);

// The fields to save for these steps
export function stepsPatch(steps) {
  const clean = cleanSteps(steps);
  return {
    steps: clean,
    notes: clean.map((s) => s.text).filter(Boolean).join('\n').slice(0, 2000),
    location: (clean.find((s) => s.location)?.location || '').slice(0, 200),
  };
}

export const sameSteps = (a, b) => JSON.stringify(cleanSteps(a)) === JSON.stringify(cleanSteps(b));
