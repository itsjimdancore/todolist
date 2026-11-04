'use client';
import { useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import { emailOf } from '@/lib/data';
import { EMAIL_RE } from '@/lib/permissions';
import { askPartner, declinePartner, unlinkPartner } from '@/lib/partner';
import { Avatar, displayName } from '@/lib/people';
import { useToast } from './Toast';

const WHAT = 'every list and love letter (to see and change), Unplaced tasks, the calendar, music and activity';

// The Partner page: link up with one person so you each see and change everything the other has.
// api: usePartner(user). contacts: people I already share with, to pick from.
export default function Partner({ user, api, contacts = [] }) {
  const toast = useToast();
  const me = emailOf(user);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false); // unlink asks once more
  const { partner, outgoing, requests, loading } = api;

  const run = async (work, ok) => {
    setBusy(true);
    try { await work(); if (ok) toast(ok); } catch (e) { toast(friendlyError(e), 'err'); } finally { setBusy(false); setSure(false); }
  };
  function ask(e) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setErr('Enter an email address, like name@example.com');
    if (v === me) return setErr("That's your own email.");
    // they already asked me: this accepts it
    const theirs = requests.find((r) => r.email === v);
    run(() => askPartner(user, v), theirs ? `You and ${theirs.name || v} are partners now` : `Request sent to ${v}`).then(() => setEmail(''));
  }
  const name = (p) => displayName({ email: p.email, displayName: p.name });

  return (
    <div className="board-wrap partner-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>Partner</h1>
          <div className="meta">Two people sharing everything: {WHAT}.</div>
        </div>
      </header>

      <div className="page-body partner-body">
        {loading ? null : partner ? (
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
                  <button type="button" className="btn td-del on" disabled={busy} onClick={() => run(() => unlinkPartner(user, partner), 'Unlinked. Your things are private again.')}>
                    Unlink for both of us
                  </button>
                  <button type="button" className="btn" onClick={() => setSure(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setSure(true)}>Unlink</button>
              )}
            </div>
          </section>
        ) : (
          <section className="partner-card">
            <h2 className="music-h2">Add your partner</h2>
            <p className="muted">
              Once they accept, you each see and change {WHAT}, straight away and from then on. One partner at a time.
            </p>
            {outgoing && (
              <p className="partner-wait" role="status">
                Waiting for <b>{outgoing}</b> to accept.{' '}
                <button type="button" className="ic link-add" disabled={busy} onClick={() => run(() => unlinkPartner(user), 'Request cancelled')}>Cancel request</button>
              </p>
            )}
            <form className="partner-f" onSubmit={ask}>
              <input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} list="partner-contacts" value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="Their email address" aria-label="Partner's email" autoComplete="off" />
              <datalist id="partner-contacts">
                {contacts.map((c) => <option key={c.email} value={c.email}>{displayName(c)}</option>)}
              </datalist>
              <button type="submit" className="btn primary" disabled={!email.trim() || busy}>{outgoing ? 'Ask instead' : 'Send request'}</button>
            </form>
            {err && <p className="link-err" role="alert">{err}</p>}
          </section>
        )}

        {requests.length > 0 && (
          <section className="partner-sec" aria-labelledby="partner-req">
            <h2 id="partner-req" className="music-h2">Requests <span className="count">{requests.length}</span></h2>
            <ul className="partner-reqs">
              {requests.map((r) => (
                <li key={r.uid} className="partner-req">
                  <Avatar person={{ email: r.email, displayName: r.name }} size={40} />
                  <div className="partner-t">
                    <b>{name(r)}</b> wants to be your partner
                    <span>{r.email}{partner ? ` · accepting unlinks you from ${name(partner)}` : ''}</span>
                  </div>
                  <div className="partner-b">
                    <button type="button" className="btn primary" disabled={busy}
                      onClick={() => run(() => askPartner(user, r.email, partner), `You and ${name(r)} are partners now`)}>Accept</button>
                    <button type="button" className="btn" disabled={busy}
                      onClick={() => run(() => declinePartner(r.uid), 'Request declined')}>Decline</button>
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
