'use client';
// Partners: two people who share everything with each other — every list and letter (to see and change), music and
// activity. partners/{uid} is who that person wants as their partner (one at a time); once each has named the other,
// they're linked (firestore.rules: isPartner). Only the owner can still delete, rename, archive or share a list.
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { fb } from './firebase';
import { emailOf, nameOf, setPartnerForNotify } from './data';

const db = () => fb().db;
const ref = (uid) => doc(db(), 'partners', uid);

// Name someone as my partner (asks them, or accepts their request). Replaces anyone I named before;
// previous (the partner I'm linked with now) has theirs removed too, so they aren't left asking.
export function askPartner(user, partnerEmail, previous = null) {
  const b = writeBatch(db());
  b.set(ref(user.uid), {
    email: emailOf(user), name: nameOf(user).slice(0, 120), partnerEmail: partnerEmail.trim().toLowerCase(), createdAt: serverTimestamp(),
  });
  if (previous && previous.email !== partnerEmail) b.delete(ref(previous.uid));
  return b.commit();
}
// Take back my request, or unlink: removes mine and (partner given) theirs too, so neither side is left asking
export function unlinkPartner(user, partner = null) {
  const b = writeBatch(db());
  b.delete(ref(user.uid));
  if (partner) b.delete(ref(partner.uid));
  return b.commit();
}
// Say no to someone's request (removes theirs)
export const declinePartner = (uid) => deleteDoc(ref(uid));

// mine: who I named ({ partnerEmail } or null). incoming: everyone who named me ([{ uid, email, name }]).
// partner: linked ({ uid, email, name }) when one of them is the one I named. requests: the others.
// outgoing: the email I named while they haven't named me back yet.
export function usePartner(user) {
  const email = emailOf(user);
  const [mine, setMine] = useState(undefined); // undefined = loading
  const [incoming, setIncoming] = useState([]);
  useEffect(() => onSnapshot(ref(user.uid), (s) => setMine(s.exists() ? s.data() : null), () => setMine(null)), [user.uid]);
  useEffect(() => onSnapshot(
    query(collection(db(), 'partners'), where('partnerEmail', '==', email)),
    (s) => setIncoming(s.docs.map((d) => ({ uid: d.id, email: d.data().email, name: d.data().name || '' }))),
    () => setIncoming([]),
  ), [email]);

  const state = useMemo(() => {
    const named = mine?.partnerEmail || null;
    const partner = (named && incoming.find((p) => p.email === named)) || null;
    return {
      loading: mine === undefined,
      partner,
      outgoing: named && !partner ? named : null,
      requests: incoming.filter((p) => p.email !== named),
    };
  }, [mine, incoming]);

  // changes to my lists also go to my partner's notifications
  useEffect(() => { setPartnerForNotify(state.partner?.email || null); }, [state.partner]);
  return state;
}
