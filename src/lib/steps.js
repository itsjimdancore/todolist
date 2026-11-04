// "What's going to be done", step by step: each step is { text, location, url } (url optional).
// Saved on the task as `steps`, with `notes` (every step's text, one per line) and `location` (the first step's
// place) kept alongside, so the list view, search and the day sheet keep showing them.
export const MAX_STEPS = 20;
export const MAX_STEP_TEXT = 500;

export const emptyStep = () => ({ text: '', location: '', url: '' });

// The task's steps; an older task with just notes / a location becomes one step
export function stepsOf(t) {
  if (Array.isArray(t.steps) && t.steps.length) return t.steps.map((s) => ({ ...emptyStep(), ...s }));
  if (t.notes || t.location) return [{ text: t.notes || '', location: t.location || '', url: '' }];
  return [];
}

// Trimmed, with empty steps left out
export const cleanSteps = (steps) => steps
  .map((s) => ({ text: (s.text || '').trim(), location: (s.location || '').trim(), url: (s.url || '').trim() }))
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
