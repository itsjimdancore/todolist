'use client';
// Partners, like sharing a list: adding someone as my partner shares everything I own with them at once — every
// list and letter (to see and change), Unplaced tasks, music and activity. Their things come to me when they add me
// back (one tap on their Partner page). partners/{uid} names that person's partner, one at a time
// (firestore.rules: isPartner). Only the owner can still delete, rename, archive or share a list.
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { fb } from './firebase';
import { emailOf, nameOf, setPartnerForNotify } from './data';
import { toDate } from './people';

const db = () => fb().db;
const ref = (uid) => doc(db(), 'partners', uid);

// Add someone as my partner: they see everything of mine straight away. Replaces anyone I added before.
export const addPartner = (user, partnerEmail) => setDoc(ref(user.uid), {
  email: emailOf(user), name: nameOf(user).slice(0, 120), partnerEmail: partnerEmail.trim().toLowerCase(), createdAt: serverTimestamp(),
});
// Stop sharing mine; with: also stop seeing theirs (removes the one they wrote naming me), so it's off both ways
export function removePartner(user, also = null) {
  const b = writeBatch(db());
  b.delete(ref(user.uid));
  if (also) b.delete(ref(also.uid));
  return b.commit();
}
// Stop seeing someone's things (removes theirs naming me)
export const stopSeeing = (uid) => deleteDoc(ref(uid));

// added: the email I share mine with (or null). sharers: everyone sharing theirs with me ([{ uid, email, name, at }]).
// partner: whose things I see — the one I added, if they've added me too, else whoever added me most recently.
// both: we've each added the other. others: anyone else sharing with me (shown so I can remove them).
export function usePartner(user) {
  const email = emailOf(user);
  const [mine, setMine] = useState(undefined); // undefined = loading
  const [incoming, setIncoming] = useState([]);
  useEffect(() => onSnapshot(ref(user.uid), (s) => setMine(s.exists() ? s.data() : null), () => setMine(null)), [user.uid]);
  useEffect(() => onSnapshot(
    query(collection(db(), 'partners'), where('partnerEmail', '==', email)),
    (s) => setIncoming(s.docs
      .map((d) => ({ uid: d.id, email: d.data().email, name: d.data().name || '', at: toDate(d.data({ serverTimestamps: 'estimate' }).createdAt) }))
      .sort((a, b) => b.at - a.at)),
    () => setIncoming([]),
  ), [email]);

  const state = useMemo(() => {
    const added = mine?.partnerEmail || null;
    const partner = (added && incoming.find((p) => p.email === added)) || incoming[0] || null;
    return {
      loading: mine === undefined,
      added,
      addedName: mine?.partnerEmail === partner?.email ? partner?.name : '',
      partner,
      both: !!partner && partner.email === added,
      others: incoming.filter((p) => p !== partner),
    };
  }, [mine, incoming]);

  // changes to my lists also go to the person I share with
  useEffect(() => { setPartnerForNotify(state.added); }, [state.added]);
  return state;
}
