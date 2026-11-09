'use client';
import { useEffect, useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import { MAX_NAME, emailOf, nameOf } from '@/lib/data';
import { EMAIL_RE } from '@/lib/permissions';
import { addPartner, removePartner, stopSeeing } from '@/lib/partner';
import { appUrl } from '@/lib/appUrl';
import { Avatar, displayName } from '@/lib/people';
import { useToast } from './Toast';

// What a partner sees and changes, shown as a checklist beside the partner card (below it on narrow screens)
const SHARED = ['Lists', 'Love letters', 'Unplaced tasks', 'Calendar', 'Music', 'Activity'];

// An email to let them know, opened in their mail app (Gmail etc.), the same way list sharing offers it
const mailTo = (to, from) => `mailto:${to}?subject=${encodeURIComponent(`${from} added you as their partner`)}&body=${encodeURIComponent(
  `I added you as my partner on our shared to-do app, so you can see and change everything of mine: lists, love letters, the calendar and music.\n\nOpen it here: ${appUrl('/?view=partner')}\n\nSign in with this email address, then tap "Add back" to share yours with me too.`,
)}`;

// "Not now" on the prompt below, remembered on this device per person and per time they added me
const promptKey = (p) => `partner-prompt:${p.uid}:${p.at?.getTime?.() || 0}`;
const wasDismissed = (p) => { try { return localStorage.getItem(promptKey(p)) === 'later'; } catch { return false; } };

// Pops up when someone has added me as their partner and I haven't shared mine back: one tap shares everything
// of mine with them too (their things are already mine to see). "Not now" leaves it on the Partner page.
export function PartnerPrompt({ user, api }) {
  const toast = useToast();
  const { partner, both, added, loading } = api;
  const [hidden, setHidden] = useState(null); // promptKey of the one I've just answered
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!partner || both) return undefined;
    const onKey = (e) => e.key === 'Escape' && later();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  if (loading || !partner || both || hidden === promptKey(partner) || wasDismissed(partner)) return null;

  const who = displayName({ email: partner.email, displayName: partner.name });
  const first = who.split(' ')[0];
  function later() {
    try { localStorage.setItem(promptKey(partner), 'later'); } catch {}
    setHidden(promptKey(partner));
  }
  async function share() {
    setBusy(true);
    try {
      await addPartner(user, partner.email);
      setHidden(promptKey(partner));
      toast(`You and ${first} are partners now. You each see everything.`);
    } catch (e) {
      toast(friendlyError(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div className="modal small-modal partner-prompt" role="dialog" aria-modal="true" aria-labelledby="pp-title">
        <div className="m-h">
          <h2 id="pp-title">{who} added you as their partner</h2>
          <button className="ic" type="button" onClick={later} aria-label="Not now">✕</button>
        </div>
        <div className="m-b">
          <div className="pp-who">
            <Avatar person={{ email: partner.email, displayName: partner.name }} size={48} />
            <span>{partner.email}</span>
          </div>
          <p>You can now see and change everything of {first}&apos;s: lists, love letters, the calendar, music and activity.</p>
          <p><b>Share yours with {first} too</b>, so {first} sees your lists, letters, music and activity?</p>
          {added && added !== partner.email && (
            <p className="muted">This stops sharing yours with {added} (one partner at a time).</p>
          )}
        </div>
        <div className="m-f end">
          <button className="btn" type="button" onClick={later}>Not now</button>
          <button className="btn primary" type="button" onClick={share} disabled={busy} autoFocus>
            {busy ? 'Sharing…' : 'Yes, share mine'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The Partner page. Works like sharing a list: add your partner by email and they see and change everything of yours
// straight away. They add you back (one tap) to share theirs. api: usePartner(user). contacts: people to pick from.
// Wide: the partner card, nicknames and requests on the left, "What you share" on the right, removing at the bottom.
// Narrow: the same, one under the other.
export default function Partner({ user, api, contacts = [], nick = null }) {
  const toast = useToast();
  const me = emailOf(user);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(''); // which removal is asking once more: 'both' | 'added'
  const { added, partner, both, others, loading } = api;
  const name = (p) => displayName({ email: p.email, displayName: p.name });
  const first = (p) => (p === partner && nick?.mine) || name(p).split(' ')[0];
  const mePerson = { email: me, displayName: nameOf(user), photoURL: user.photoURL };
  const partnerSub = partner && `${nick?.mine ? `${partner.name || partner.email} · ` : ''}${partner.email}`;

  const run = async (work, ok) => {
    setBusy(true);
    try { await work(); if (ok) toast(ok); return true; } catch (e) { toast(friendlyError(e), 'err'); return false; } finally { setBusy(false); setSure(''); }
  };
  async function add(e) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setErr('Enter an email address, like name@example.com');
    if (v === me) return setErr("That's your own email.");
    if (await run(() => addPartner(user, v), `${v} can now see and change everything of yours`)) setEmail('');
  }

  // who sees what, said once, under the checklist
  const sharedNote = both ? `You and ${first(partner)} each see and change these.`
    : partner && added ? `You see and change ${first(partner)}'s. ${added} sees and changes yours.`
      : partner ? `You see and change ${first(partner)}'s. Add ${first(partner)} back to share yours too.`
        : added ? `${added} sees and changes yours.`
          : 'Your partner sees and changes these straight away.';

  // the ways out, kept apart from everything else at the bottom
  const removals = [];
  if (both) {
    removals.push(
      <Removal key="both" text={`Stop being partners with ${first(partner)}. Your things go private again, and you stop seeing theirs.`}
        label="Remove partner" confirm="Stop sharing both ways" asking={sure === 'both'} busy={busy}
        onAsk={() => setSure('both')} onCancel={() => setSure('')}
        onConfirm={() => run(() => removePartner(user, partner), 'No longer partners. Your things are private again.')} />,
    );
  } else {
    if (added) {
      removals.push(
        <Removal key="added" text={`Stop sharing your things with ${added}.`}
          label="Stop sharing" confirm="Yes, stop sharing" asking={sure === 'added'} busy={busy}
          onAsk={() => setSure('added')} onCancel={() => setSure('')}
          onConfirm={() => run(() => removePartner(user), `${added} no longer sees your things`)} />,
      );
    }
    if (partner) {
      removals.push(
        <Removal key="theirs" text={`Stop seeing ${first(partner)}'s things. ${first(partner)} can add you again later.`}
          label="Remove" busy={busy}
          onConfirm={() => run(() => stopSeeing(partner.uid), `You no longer see ${first(partner)}'s things`)} />,
      );
    }
  }

  return (
    <div className="board-wrap partner-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>Partner</h1>
          <div className="meta">Share everything with one person, like sharing a list.</div>
        </div>
      </header>

      <div className="page-body partner-body">
        {loading ? null : (
          <div className="partner-grid">
            <div className="partner-main">
              {both ? (
                <Hero me={mePerson} partner={partner} state="both" pill="Partners" title={name(partner)} sub={partnerSub} />
              ) : (
                <>
                  {partner && (
                    <Hero me={mePerson} partner={partner} state="theirs" pill="Added you" title={`${name(partner)} added you`} sub={partnerSub}
                      text={`You can see and change ${first(partner)}'s things. Add ${first(partner)} back to share yours too.`}>
                      <button type="button" className="btn primary" disabled={busy}
                        onClick={() => run(() => addPartner(user, partner.email), `You and ${first(partner)} are partners now`)}>
                        Add {first(partner)} back
                      </button>
                    </Hero>
                  )}

                  {added ? (
                    <Hero me={mePerson} partner={{ email: added }} state="waiting" pill="Waiting" title={added}
                      text="They can see and change your things. Theirs show here once they add you back.">
                      <a className="btn primary" href={mailTo(added, nameOf(user))}>Email them</a>
                    </Hero>
                  ) : (
                    <section className="partner-card partner-add">
                      <h2 className="music-h2">Add your partner</h2>
                      <p className="muted">Enter their email address. One partner at a time.</p>
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

              {partner && nick && <Nicknames nick={nick} partner={partner} />}

              {others.length > 0 && (
                <section className="partner-sec" aria-labelledby="partner-others">
                  <h2 id="partner-others" className="music-h2">Also added you <span className="count">{others.length}</span></h2>
                  <ul className="partner-reqs">
                    {others.map((r) => (
                      <li key={r.uid} className="partner-req">
                        <Avatar person={{ email: r.email, displayName: r.name }} size={40} />
                        <div className="partner-t">
                          <b>{name(r)}</b>
                          <span>{r.email}</span>
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

            <aside className="partner-card partner-side" aria-labelledby="partner-shared">
              <h2 id="partner-shared" className="music-h2">What you share</h2>
              <ul className="partner-list">
                {SHARED.map((s) => <li key={s}><span className="partner-tick" aria-hidden="true">✓</span>{s}</li>)}
              </ul>
              <p className="partner-note">{sharedNote}</p>
              <p className="partner-note">Only the owner of a list or letter can delete, rename or share it.</p>
            </aside>

            {removals.length > 0 && (
              <section className="partner-danger" aria-label="Stop sharing">
                {removals}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The card at the top: me and them side by side, where things stand, and what to do next
function Hero({ me, partner, state, pill, title, sub, text, children }) {
  return (
    <section className={`partner-card partner-hero is-${state}`}>
      <div className="ph-avs" aria-hidden="true">
        <Avatar person={me} size={44} title={false} />
        <span className="ph-link">{state === 'both' ? '⇄' : state === 'theirs' ? '←' : '→'}</span>
        <Avatar person={{ email: partner.email, displayName: partner.name }} size={44} title={false} />
      </div>
      <div className="partner-t">
        <div className="ph-top">
          <b>{title}</b>
          <span className={`ph-pill is-${state}`}>{pill}</span>
        </div>
        {sub && <span>{sub}</span>}
        {text && <p>{text}</p>}
      </div>
      {children && <div className="partner-b">{children}</div>}
    </section>
  );
}

// One way out, at the bottom of the page. With `confirm` it asks once more before doing it.
function Removal({ text, label, confirm, asking, busy, onAsk, onCancel, onConfirm }) {
  return (
    <div className="partner-rm">
      <p>{text}</p>
      <div className="partner-b">
        {asking ? (
          <>
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn td-del on" disabled={busy} onClick={onConfirm}>{confirm}</button>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={confirm ? onAsk : onConfirm}>{label}</button>
        )}
      </div>
    </div>
  );
}

// What I call my partner (they can see it), and what they call me. Saved on blur or Enter; empty removes it.
function Nicknames({ nick, partner }) {
  const toast = useToast();
  const real = partner.name || partner.email.split('@')[0];
  const [v, setV] = useState(nick.mine);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(nick.mine); }, [nick.mine]);
  async function save(e) {
    e?.preventDefault();
    const next = v.replace(/\s+/g, ' ').trim();
    if (next === nick.mine || busy) return;
    setBusy(true);
    try {
      await nick.save(next);
      toast(next ? `Saved ${real} as ${next}` : `Nickname removed. ${real} shows by their name again.`);
    } catch (er) {
      setV(nick.mine);
      toast(`Nickname not saved: ${friendlyError(er)}`, 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="partner-card partner-nick" aria-labelledby="partner-nicks">
      <h2 id="partner-nicks" className="music-h2">Nicknames</h2>
      <form className="partner-nick-row" onSubmit={save}>
        <label htmlFor="partner-nick">You call {real}</label>
        <div className="partner-nick-v">
          <input id="partner-nick" value={v} maxLength={MAX_NAME} placeholder={`e.g. Sunshine (empty shows ${real})`} autoComplete="off"
            onChange={(e) => setV(e.target.value)} onBlur={() => save()}
            onKeyDown={(e) => { if (e.key === 'Escape') setV(nick.mine); }} />
          <span className="partner-nick-note">{real} can see what you&apos;ve saved them as.</span>
        </div>
      </form>
      <div className="partner-nick-row">
        <span className="partner-nick-k">{real} calls you</span>
        <div className="partner-nick-v">
          {nick.theirs ? <b className="partner-nick-theirs">{nick.theirs} 💛</b> : <span className="muted">No nickname yet</span>}
        </div>
      </div>
    </section>
  );
}
