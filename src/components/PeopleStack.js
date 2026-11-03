'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emailOf, nameOf, watchPerson } from '@/lib/data';
import { Avatar, displayName, lastSeenLabel, toDate } from '@/lib/people';

// The overlapping avatars of everyone on a list. Hover them (or tap, on a phone) and they spread apart;
// hover or tap one and a card shows their photo, name, email and when they were last active.
// A click/tap keeps the card open until you click/tap anywhere else (or press Esc).
// people: [{ email, displayName? }], me: the signed-in Firebase user
export default function PeopleStack({ people, me, max = 6 }) {
  const [open, setOpen] = useState(false); // spread out
  const [shown, setShown] = useState(null); // the email whose card is showing
  const [pinned, setPinned] = useState(false); // opened by a click/tap, so it stays
  const [cards, setCards] = useState({}); // email -> people/{email} (null if they haven't been here since)
  const [wanted, setWanted] = useState(false); // only fetch the cards once someone looks
  const [, tick] = useState(0);
  const box = useRef(null);
  const myEmail = emailOf(me);

  const close = () => { setOpen(false); setShown(null); setPinned(false); };

  // fetch everyone's card the first time the group is opened, then keep them live
  const emails = people.map((p) => p.email).filter(Boolean).join('|');
  useEffect(() => { if (open) setWanted(true); }, [open]);
  useEffect(() => {
    if (!wanted || !emails) return undefined;
    const offs = emails.split('|').filter((e) => e !== myEmail)
      .map((e) => watchPerson(e, (d) => setCards((c) => ({ ...c, [e]: d }))));
    return () => offs.forEach((off) => off());
  }, [wanted, emails, myEmail]);

  // click/tap anywhere else, or Esc, closes it
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // keep "Active 3 min ago" current while a card is up
  useEffect(() => {
    if (!shown) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [shown]);

  // what we know about each person: their own card first, then the name the list has for them
  const full = useMemo(() => people.map((p) => {
    if (p.email === myEmail) return { ...p, displayName: nameOf(me), photoURL: me.photoURL || '', isMe: true };
    const c = cards[p.email];
    return { ...p, displayName: c?.displayName || p.displayName, photoURL: c?.photoURL || '', lastSeen: c?.lastSeen,
      online: c?.online !== false, known: p.email in cards }; // cards saved before "online" existed count as online
  }), [people, cards, me, myEmail]);

  const visible = open ? full : full.slice(0, max);
  const extra = full.length - visible.length;
  const card = shown && full.find((p) => p.email === shown);
  const mouse = (e) => e.pointerType === 'mouse';

  function pick(p) {
    if (pinned && shown === p.email) return close();
    setOpen(true); setShown(p.email); setPinned(true);
  }

  return (
    <div
      ref={box}
      className={open ? 'avatars ppl open' : 'avatars ppl'}
      onPointerEnter={(e) => mouse(e) && setOpen(true)}
      onPointerLeave={(e) => { if (mouse(e) && !pinned) { setOpen(false); setShown(null); } }}
    >
      {visible.map((p) => (
        <button key={p.email} type="button" className={shown === p.email ? 'ppl-av on' : 'ppl-av'}
          aria-label={`${displayName(p)}${p.isMe ? ' (you)' : ''}`} aria-expanded={shown === p.email}
          onPointerEnter={(e) => mouse(e) && !pinned && setShown(p.email)}
          onFocus={() => !pinned && (setOpen(true), setShown(p.email))}
          onClick={() => pick(p)}>
          <Avatar person={p} size={30} title={false} />
        </button>
      ))}
      {extra > 0 && (
        <button type="button" className="ppl-av" aria-label={`Show all ${full.length} people`} onClick={() => setOpen(true)}>
          <span className="av av-more">+{extra}</span>
        </button>
      )}

      {card && (
        <div className="ppl-card" role="status">
          <Avatar person={card} size={44} title={false} />
          <div className="ppl-card-b">
            <b>{displayName(card)}{card.isMe && <span className="ppl-you"> (you)</span>}</b>
            <span className="ppl-em">{card.email}</span>
            <Seen p={card} />
          </div>
        </div>
      )}
    </div>
  );
}

function Seen({ p }) {
  if (!p.isMe && !p.known) return <span className="ppl-seen">…</span>;
  const label = p.isMe ? 'Active now' : lastSeenLabel(p.lastSeen, p.online);
  const on = label === 'Active now';
  return (
    <span className="ppl-seen" title={p.lastSeen ? toDate(p.lastSeen).toLocaleString() : undefined}>
      <i className={on ? 'on' : ''} aria-hidden="true" />{label}
    </span>
  );
}
