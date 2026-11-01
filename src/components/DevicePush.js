'use client';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState } from '@/lib/push';
import { useToast } from './Toast';

const DISMISS = 'pushPromptNotNow'; // when "Not now" was pressed; asked again after 14 days
const NOT_NOW_MS = 14 * 24 * 3600 * 1000;
export const BLOCKED_HELP = 'Notifications are blocked for this site. To allow them, click the padlock in the address bar → Notifications → Allow, then reload.';

export function usePush(user) {
  const toast = useToast();
  const [state, setState] = useState(null); // null while checking
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState(user).then(setState); }, [user]);

  async function run(fn, ok) {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
      if (next === 'on' && ok) toast(ok);
      if (next === 'blocked') toast({ title: 'Notifications are blocked', description: BLOCKED_HELP.replace(/^[^.]*\. /, ''), kind: 'err' });
    } catch (e) {
      toast(e?.message || "Couldn't turn device notifications on here. Try again, or try another browser.", 'err');
      setState(await pushState(user));
    }
    setBusy(false);
  }
  return {
    state,
    busy,
    on: () => run(() => enablePush(user), 'Device notifications are on for this device'),
    off: () => run(async () => { await disablePush(user); toast('Device notifications are off for this device'); return 'off'; }),
  };
}

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" />
  </svg>
);

// A small banner offering device notifications. Never on page load by itself: only once there's been a
// list shared with me or a comment (ready), and the browser is only asked from the Turn on click.
// "Not now" hides it for 14 days.
export function PushPrompt({ user, ready = true }) {
  const { state, busy, on } = usePush(user);
  const [hidden, setHidden] = useState(() => {
    try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < NOT_NOW_MS; } catch { return false; }
  });
  if (!ready || hidden || state !== 'off') return null;
  const notNow = () => { setHidden(true); try { localStorage.setItem(DISMISS, String(Date.now())); } catch {} };
  return (
    <div className="push-prompt" role="region" aria-label="Desktop alerts">
      <BellIcon />
      <span>Get a desktop alert when someone comments or shares a list with you.</span>
      <button type="button" className="btn primary push-on" onClick={on} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
      <button type="button" className="btn push-later" onClick={notNow}>Not now</button>
    </div>
  );
}
