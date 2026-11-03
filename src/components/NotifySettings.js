'use client';
import { useEffect, useRef, useState } from 'react';
import { NOTIFY_GROUPS } from '@/lib/activityText';
import { saveNotifyPref, watchNotifyPrefs } from '@/lib/data';
import { friendlyError } from '@/lib/firebase';
import { sendTestPush } from '@/lib/push';
import { BLOCKED_HELP, usePush } from './DevicePush';
import { useToast } from './Toast';

// "Also while I'm using the app": kept where the service worker can read it (it decides what to show)
const PREF = '/__prefs/while-open';
async function readWhileOpen() {
  try {
    const r = await (await caches.open('todo-prefs')).match(PREF);
    return !!r && (await r.text()) === '1';
  } catch {
    return false;
  }
}
async function saveWhileOpen(on) {
  try { await (await caches.open('todo-prefs')).put(PREF, new Response(on ? '1' : '0')); } catch {}
}

function Switch({ on, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={on ? 'sw on' : 'sw'} disabled={disabled}
      onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

// tapping anywhere on the row flips its switch (easier on a phone than hitting the switch itself)
function Row({ title, hint, children }) {
  return (
    <div className="ns-row can-tap" onClick={(e) => {
      if (!e.target.closest('button, a, input')) e.currentTarget.querySelector('.sw:not(:disabled)')?.click();
    }}>
      <div className="ns-t"><b>{title}</b>{hint && <span>{hint}</span>}</div>
      {children}
    </div>
  );
}

const NOTES = {
  'ios-needs-home-screen': 'On iPhone and iPad, tap Share → Add to Home Screen, then open the app from there to turn these on.',
  blocked: BLOCKED_HELP,
  unsupported: "This browser can't show device notifications. Try Chrome, Edge, Firefox or Safari.",
  'not-set-up': "Device notifications aren't set up for this app yet.",
};

// Notification settings: device notifications on or off for this device, when they show, and what about
export default function NotifySettings({ user, onClose }) {
  const toast = useToast();
  const push = usePush(user);
  const [prefs, setPrefs] = useState(null);
  const [whileOpen, setWhileOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const box = useRef(null);

  useEffect(() => watchNotifyPrefs(user.uid, setPrefs), [user.uid]);
  useEffect(() => { readWhileOpen().then(setWhileOpen); }, []);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    box.current?.focus();
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const deviceOn = push.state === 'on';
  const canToggle = push.state === 'on' || push.state === 'off';
  const note = NOTES[push.state];

  async function test() {
    setTesting(true);
    try {
      const sent = await sendTestPush(user);
      toast(`Test sent to ${sent} device${sent === 1 ? '' : 's'}. Check your notification bar.`);
    } catch (e) {
      toast(e.message, 'err');
    }
    setTesting(false);
  }

  const setGroup = (key, on) => {
    setPrefs((p) => ({ ...p, [key]: on }));
    saveNotifyPref(user.uid, key, on).catch((e) => toast(`Not saved: ${friendlyError(e)}`, 'err'));
  };

  return (
    <div className="scrim ns-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ns-modal" role="dialog" aria-modal="true" aria-labelledby="ns-h" ref={box} tabIndex={-1}>
        <div className="m-h">
          <h2 id="ns-h">Notification settings</h2>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-b">
          <section className="ns-sec">
            <h3>This device</h3>
            <Row title="Device notifications"
              hint="Show them in the notification bar on this phone or computer, in the browser or the installed app, even when it's closed.">
              <Switch on={deviceOn} disabled={!canToggle || push.busy} label="Device notifications on this device"
                onChange={(v) => (v ? push.on() : push.off())} />
            </Row>
            {note && <p className="push-note">{note}</p>}
            {deviceOn && (
              <div className="ns-test">
                <button type="button" className="btn" onClick={test} disabled={testing}>{testing ? 'Sending…' : 'Send a test notification'}</button>
                <span>Notifications come from other people&apos;s changes, never your own, so this is the way to try it yourself.</span>
              </div>
            )}
            <Row title="Also while I'm using the app" hint="Normally a pop-up inside the app is enough while you're looking at it.">
              <Switch on={whileOpen} disabled={!deviceOn} label="Also while I'm using the app"
                onChange={(v) => { setWhileOpen(v); saveWhileOpen(v); }} />
            </Row>
          </section>

          <section className="ns-sec">
            <h3>Notify me about</h3>
            <p className="ns-sub">For every device you&apos;ve turned on. Everything still shows here on the Notifications page.</p>
            {NOTIFY_GROUPS.map((g) => (
              <Row key={g.key} title={g.label} hint={g.hint}>
                <Switch on={prefs ? prefs[g.key] !== false : true} disabled={!prefs} label={g.label} onChange={(v) => setGroup(g.key, v)} />
              </Row>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
