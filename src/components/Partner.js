'use client';
import { useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import { emailOf, nameOf } from '@/lib/data';
import { EMAIL_RE } from '@/lib/permissions';
import { addPartner, removePartner, stopSeeing } from '@/lib/partner';
import { appUrl } from '@/lib/appUrl';
import { Avatar, displayName } from '@/lib/people';
import { useToast } from './Toast';

const WHAT = 'every list and love letter (to see and change), Unplaced tasks, the calendar, music and activity';

// An email to let them know, opened in their mail app (Gmail etc.), the same way list sharing offers it
const mailTo = (to, from) => `mailto:${to}?subject=${encodeURIComponent(`${from} added you as their partner`)}&body=${encodeURIComponent(
  `I added you as my partner on our shared to-do app, so you can see and change everything of mine: lists, love letters, the calendar and music.\n\nOpen it here: ${appUrl('/?view=partner')}\n\nSign in with this email address, then tap "Add back" to share yours with me too.`,
)}`;

// The Partner page. Works like sharing a list: add your partner by email and they see and change everything of yours
// straight away. They add you back (one tap) to share theirs. api: usePartner(user). contacts: people to pick from.
export default function Partner({ user, api, contacts = [] }) {
  const toast = useToast();
  const me = emailOf(user);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false); // removing asks once more
  const { added, partner, both, others, loading } = api;
  const name = (p) => displayName({ email: p.email, displayName: p.name });
  const first = (p) => name(p).split(' ')[0];

  const run = async (work, ok) => {
    setBusy(true);
    try { await work(); if (ok) toast(ok); return true; } catch (e) { toast(friendlyError(e), 'err'); return false; } finally { setBusy(false); setSure(false); }
  };
  async function add(e) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setErr('Enter an email address, like name@example.com');
    if (v === me) return setErr("That's your own email.");
    if (await run(() => addPartner(user, v), `${v} can now see and change everything of yours`)) setEmail('');
  }

  return (
    <div className="board-wrap partner-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>Partner</h1>
          <div className="meta">Like sharing a list, but everything: {WHAT}.</div>
        </div>
      </header>

      <div className="page-body partner-body">
        {loading ? null : both ? (
          // we've each added the other
          <section className="partner-card linked">
            <Avatar person={{ email: partner.email, displayName: partner.name }} size={52} />
            <div className="partner-t">
              <b>{name(partner)}</b>
              <span>{partner.email}</span>
              <p>You&apos;re partners. You each see and change {WHAT}. Only the owner of a list or letter can delete, rename or share it.</p>
            </div>
            <div className="partner-b">
              {sure ? (
                <>
                  <button type="button" className="btn td-del on" disabled={busy}
                    onClick={() => run(() => removePartner(user, partner), 'No longer partners. Your things are private again.')}>
                    Stop sharing both ways
                  </button>
                  <button type="button" className="btn" onClick={() => setSure(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setSure(true)}>Remove partner</button>
              )}
            </div>
          </section>
        ) : (
          <>
            {partner && (
              // they added me; I haven't added them back
              <section className="partner-card linked">
                <Avatar person={{ email: partner.email, displayName: partner.name }} size={52} />
                <div className="partner-t">
                  <b>{name(partner)} added you as their partner</b>
                  <span>{partner.email}</span>
                  <p>You can see and change everything of {first(partner)}&apos;s now. Add {first(partner)} back to share yours too.</p>
                </div>
                <div className="partner-b">
                  <button type="button" className="btn primary" disabled={busy}
                    onClick={() => run(() => addPartner(user, partner.email), `You and ${first(partner)} are partners now`)}>
                    Add {first(partner)} back
                  </button>
                  <button type="button" className="btn" disabled={busy}
                    onClick={() => run(() => stopSeeing(partner.uid), `You no longer see ${first(partner)}'s things`)}>
                    Remove
                  </button>
                </div>
              </section>
            )}

            {added ? (
              // I added someone; they haven't added me back (yet)
              <section className="partner-card">
                <p>
                  <b>{added}</b> can see and change everything of yours.
                  {' '}Their things show here once they add you back.
                </p>
                <div className="partner-b">
                  <a className="btn primary" href={mailTo(added, nameOf(user))}>Email them</a>
                  {sure ? (
                    <>
                      <button type="button" className="btn td-del on" disabled={busy}
                        onClick={() => run(() => removePartner(user), `${added} no longer sees your things`)}>Stop sharing</button>
                      <button type="button" className="btn" onClick={() => setSure(false)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="btn" onClick={() => setSure(true)}>Stop sharing</button>
                  )}
                </div>
              </section>
            ) : (
              <section className="partner-card">
                <h2 className="music-h2">Add your partner</h2>
                <p className="muted">
                  They see and change {WHAT} straight away, like a list you share with them. One partner at a time.
                </p>
                <form className="partner-f" onSubmit={add}>
                  <input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} list="partner-contacts" value={email}
                    onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="Their email address" aria-label="Partner's email" autoComplete="off" />
                  <datalist id="partner-contacts">
                    {contacts.map((c) => <option key={c.email} value={c.email}>{displayName(c)}</option>)}
                  </datalist>
                  <button type="submit" className="btn primary" disabled={!email.trim() || busy}>Add partner</button>
                </form>
                {err && <p className="link-err" role="alert">{err}</p>}
                <p className="partner-note">They&apos;ll see it in their notifications when they open the app. You can also email them after adding.</p>
              </section>
            )}
          </>
        )}

        {others.length > 0 && (
          <section className="partner-sec" aria-labelledby="partner-others">
            <h2 id="partner-others" className="music-h2">Also added you <span className="count">{others.length}</span></h2>
            <ul className="partner-reqs">
              {others.map((r) => (
                <li key={r.uid} className="partner-req">
                  <Avatar person={{ email: r.email, displayName: r.name }} size={40} />
                  <div className="partner-t">
                    <b>{name(r)}</b>
                    <span>{r.email} · added you as their partner</span>
                  </div>
                  <div className="partner-b">
                    <button type="button" className="btn" disabled={busy}
                      onClick={() => run(() => addPartner(user, r.email), `${first(r)} is your partner now`)}>Make my partner</button>
                    <button type="button" className="btn" disabled={busy}
                      onClick={() => run(() => stopSeeing(r.uid), 'Removed')}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
