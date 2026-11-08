'use client';
import { useId } from 'react';
import { displayName, nickOf, timeAgo } from '@/lib/people';
import ListMenu from './ListMenu';

// A small number from a letter's id, so each letter keeps the same burn and tilt every time
function hashOf(id = '') {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// An old love letter with burnt edges. The paper layer behind the words is pushed out of shape by
// SVG noise, so its edge is ragged instead of straight; the scorch is layered inset shadows (globals.css).
export function BurntPaper({ seed = '', tilt = true, className = '', children, ...rest }) {
  const id = `burnt${useId().replace(/:/g, '')}`;
  const h = hashOf(seed);
  const deg = tilt ? ((h % 21) - 10) / 10 : 0; // -1° … 1°
  return (
    <div className={`paper ${className}`} style={{ '--tilt': `${deg}deg` }} {...rest}>
      <svg className="paper-defs" aria-hidden="true" focusable="false">
        <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed={h % 997} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="paper-edge" style={{ filter: `url(#${id})` }} aria-hidden="true" />
      <div className="paper-in">{children}</div>
    </div>
  );
}

export function WaxSeal() {
  return (
    <span className="seal" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg>
    </span>
  );
}

// The first line of a letter, for its card
const firstLine = (body) => (body || '').split('\n').map((s) => s.trim()).find(Boolean) || '';

// The Love Letters page: the ones I wrote, and the ones written to me
export default function Letters({ letters, contacts, favorites, actions, onOpen, onNew, me = '' }) {
  const named = Object.fromEntries(contacts.map((c) => [c.email, c]));
  const nameFor = (email) => displayName(named[email] || { email });
  const open = letters.filter((l) => !l.archived);
  const mine = open.filter((l) => l.role === 'owner');
  // my partner's letters (lib/partner.js) are theirs, not written to me, unless they're for me
  const isForMe = (l) => l.role !== 'owner' && (l.role !== 'partner' || (l.memberEmails || []).includes(me));
  const forMe = open.filter(isForMe);
  const partners = open.filter((l) => l.role === 'partner' && !isForMe(l));
  const partnerName = partners[0] ? nickOf(partners[0].ownerEmail) || (partners[0].ownerName || partners[0].ownerEmail).split(' ')[0] : '';
  const archived = letters.filter((l) => l.archived);

  const card = (l) => {
    const to = l.memberEmails?.[0];
    const who = l.role === 'owner' || (l.role === 'partner' && !isForMe(l))
      ? (to ? `To ${nameFor(to)}` : 'Not sent yet')
      : `From ${nickOf(l.ownerEmail) || l.ownerName || l.ownerEmail}`;
    const preview = firstLine(l.body);
    return (
      <BurntPaper key={l.id} seed={l.id} className="letter-card" role="button" tabIndex={0}
        onClick={() => onOpen(l.id)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(l.id))}
        aria-label={`${l.title}, ${who}`}>
        {isForMe(l) && <WaxSeal />}
        <div className="letter-card-h">
          <h3>{l.title}</h3>
          {favorites.has(l.id) && <span className="star" aria-label="Favourite">★</span>}
          <ListMenu list={l} favorite={favorites.has(l.id)} actions={actions} />
        </div>
        <p className={preview ? 'letter-card-p' : 'letter-card-p empty'}>{preview || 'Nothing written yet…'}</p>
        <div className="letter-card-f">
          <span>{who}</span>
          <span>{timeAgo(l.updatedAt)}</span>
        </div>
      </BurntPaper>
    );
  };

  return (
    <div className="board-wrap letters-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>Love letters</h1>
          <div className="meta">Each letter is for one person only. Nobody else can see it.</div>
        </div>
        <div className="bar-right">
          <button className="btn primary" type="button" onClick={onNew}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New letter
          </button>
        </div>
      </header>

      <div className="page-body">
      <section className="letters-sec" aria-label="Written by you">
        <h2 className="letters-h">Written by you <span className="count">{mine.length}</span></h2>
        <div className="letters">
          {mine.map(card)}
          <button type="button" className="letter-new" onClick={onNew}>
            <span aria-hidden="true">+</span>
            {mine.length ? 'Write another letter' : 'Write your first love letter'}
          </button>
        </div>
      </section>

      <section className="letters-sec" aria-label="For you">
        <h2 className="letters-h">For you <span className="count">{forMe.length}</span></h2>
        {forMe.length ? <div className="letters">{forMe.map(card)}</div> : (
          <p className="muted letters-empty">Letters written to you appear here.</p>
        )}
      </section>

      {partners.length > 0 && (
        <section className="letters-sec" aria-label={`${partnerName}'s letters`}>
          <h2 className="letters-h">{partnerName}&apos;s letters <span className="count">{partners.length}</span></h2>
          <div className="letters">{partners.map(card)}</div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="letters-sec" aria-label="Archived letters">
          <h2 className="letters-h">Archived <span className="count">{archived.length}</span></h2>
          <div className="letters">{archived.map(card)}</div>
        </section>
      )}
      </div>
    </div>
  );
}
