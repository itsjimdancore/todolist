'use client';
import { useEffect, useRef, useState } from 'react';
import { emailOf, markCalendarSeen, shareCalendar, unshareCalendar } from '@/lib/data';
import { friendlyError } from '@/lib/firebase';
import { EMAIL_RE } from '@/lib/permissions';
import { Avatar, displayName } from '@/lib/people';
import { Spinner } from './Loading';
import PeopleStack from './PeopleStack';
import { useToast } from './Toast';

const PeopleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5" />
  </svg>
);

// The "Share calendar" button for the Calendar's header: who it's shared with (the same avatars as on a list:
// hover or tap for name, email and last active), and the window to add or remove people.
export function ShareCalendarButton({ user, shares, contacts, onOpen }) {
  const people = (shares || []).map((s) => ({ email: s.to, displayName: contacts.find((c) => c.email === s.to)?.displayName }));
  return (
    <div className="cal-share-btn">
      {people.length > 0 && <PeopleStack people={people} me={user} max={4} />}
      <button type="button" className="btn" onClick={onOpen}>
        <PeopleIcon />Share calendar
      </button>
    </div>
  );
}

// The strip at the top of the Calendar: who can see mine, and the calendars shared with me (each can be
// shown or hidden, or removed from my Calendar)
export function SharedCalendarsBar({ user, shares, withMe, hiddenOwners, setHiddenOwners, onShare }) {
  const toast = useToast();
  // a calendar newly shared with me: it's been seen once it's shown here
  const unseen = withMe.filter((c) => !c.share.seen).map((c) => c.share.ownerUid).join();
  // keep "New" on them for this visit, after they're marked as seen
  const fresh = useRef(new Set());
  if (unseen) unseen.split(',').forEach((uid) => fresh.current.add(uid));
  useEffect(() => {
    if (unseen) unseen.split(',').forEach((uid) => markCalendarSeen(uid, emailOf(user)).catch(() => {}));
  }, [unseen, user]);
  if (!(shares || []).length && !withMe.length) return null;
  const toggle = (uid) => setHiddenOwners((h) => {
    const next = new Set(h);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const remove = (c) => unshareCalendar(c.share.ownerUid, emailOf(user))
    .then(() => toast(`${c.share.ownerName || c.share.ownerEmail}'s calendar removed`))
    .catch((e) => toast(friendlyError(e), 'err'));
  const names = (shares || []).map((s) => s.to);

  return (
    <div className="cal-shared">
      {names.length > 0 && (
        <div className="cal-shared-i mine">
          <span className="cal-shared-ic"><PeopleIcon /></span>
          <span className="cal-shared-t">
            Your calendar is shared with <b>{names.length === 1 ? names[0] : `${names.length} people`}</b>.
            {' '}They can see every month and year, and add, change and tick off what&apos;s on it.
          </span>
          <button type="button" className="link" onClick={onShare}>Manage</button>
        </div>
      )}
      {withMe.map((c) => {
        const name = c.share.ownerName || c.share.ownerEmail;
        const shown = !hiddenOwners.has(c.share.ownerUid);
        return (
          <div key={c.share.id} className={fresh.current.has(c.share.ownerUid) ? 'cal-shared-i new' : 'cal-shared-i'}>
            <PeopleStack people={[{ email: c.share.ownerEmail, displayName: c.share.ownerName }]} me={user} />
            <span className="cal-shared-t">
              {fresh.current.has(c.share.ownerUid) && <span className="cal-shared-new">New</span>}
              <b>{name}</b> shared their calendar with you. You can see and change anything on it.
            </span>
            <label className="chk cal-shared-show">
              <input type="checkbox" checked={shown} onChange={() => toggle(c.share.ownerUid)} />Show
            </label>
            <button type="button" className="link danger-link" onClick={() => remove(c)}>Remove</button>
          </div>
        );
      })}
    </div>
  );
}

// Add people by email (several at once, separated by commas or spaces), see who has it, stop sharing with someone
export function ShareCalendarDialog({ user, shares, contacts, onClose }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [removing, setRemoving] = useState(null);
  const input = useRef(null);
  const me = emailOf(user);
  const has = new Set(shares.map((s) => s.to));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function add(e) {
    e.preventDefault();
    setErr('');
    const emails = [...new Set(text.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return setErr('Type an email address.');
    const bad = emails.find((v) => !EMAIL_RE.test(v));
    if (bad) return setErr(`“${bad}” isn't a valid email address.`);
    if (emails.includes(me)) return setErr("That's you. It's already your calendar.");
    const fresh = emails.filter((v) => !has.has(v));
    if (!fresh.length) return setErr('They can already see your calendar.');
    setBusy(true);
    try {
      await shareCalendar(user, fresh);
      toast(`Calendar shared with ${fresh.length === 1 ? fresh[0] : `${fresh.length} people`}`);
      setText('');
      input.current?.focus();
    } catch (er) {
      setErr(friendlyError(er));
    }
    setBusy(false);
  }

  async function remove(email) {
    setRemoving(email);
    try {
      await unshareCalendar(user.uid, email);
      toast(`${email} can no longer see your calendar`);
    } catch (er) {
      toast(friendlyError(er), 'err');
    }
    setRemoving(null);
  }

  const suggest = contacts.filter((c) => !has.has(c.email));

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small-modal cshare" role="dialog" aria-modal="true" aria-labelledby="cshare-title">
        <div className="m-h">
          <div>
            <h2 id="cshare-title">Share your calendar</h2>
            <p className="cshare-sub">They&apos;ll see everything on it, for any month or year, and can add, change and tick off activities.</p>
          </div>
          <button className="ic" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className="m-b" onSubmit={add}>
          <div className="field">
            <label htmlFor="cshare-email">Email</label>
            <div className="cshare-row">
              <input id="cshare-email" ref={input} autoFocus type="text" inputMode="email" autoComplete="email" list="cshare-contacts"
                value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} placeholder="name@example.com, another@example.com" />
              <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner aria-hidden="true" />Sharing…</> : 'Share'}</button>
            </div>
            <datalist id="cshare-contacts">{suggest.map((c) => <option key={c.email} value={c.email}>{displayName(c)}</option>)}</datalist>
          </div>
          {err && <p className="note err" role="alert">{err}</p>}

          <div className="cshare-list">
            <h3>People who can see it</h3>
            {shares.length ? (
              <ul>
                {shares.map((s) => {
                  const c = contacts.find((x) => x.email === s.to);
                  const person = { email: s.to, displayName: c?.displayName };
                  return (
                    <li key={s.id}>
                      <Avatar person={person} size={32} />
                      <span className="cshare-who">
                        <b>{c?.displayName || s.to.split('@')[0]}</b>
                        <span>{s.to}{s.seen ? '' : ' · not opened yet'}</span>
                      </span>
                      <span className="pill readwrite">Can edit</span>
                      <button type="button" className="btn small td-del" onClick={() => remove(s.to)} disabled={removing === s.to}>
                        {removing === s.to ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="cal-empty">Only you can see your calendar.</p>
            )}
          </div>
        </form>
        <div className="m-f end">
          <button className="btn" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
