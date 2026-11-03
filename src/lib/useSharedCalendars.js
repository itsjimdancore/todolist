'use client';
import { useEffect, useState } from 'react';
import { watchCalendarLists, watchCalendarsSharedWithMe, watchMyCalendarShares } from './data';

// Who I've shared my calendar with: [{ id, to, createdAt… }] (null while loading)
export function useMyCalendarShares(uid) {
  const [shares, setShares] = useState(null);
  useEffect(() => watchMyCalendarShares(uid, setShares, () => setShares([])), [uid]);
  return shares;
}

// Calendars other people shared with me, each with their to-do lists (live):
// [{ share: { ownerUid, ownerEmail, ownerName, seen… }, lists: [...] }]
export function useCalendarsSharedWithMe(email) {
  const [shares, setShares] = useState([]);
  const [listsBy, setListsBy] = useState({}); // ownerUid → lists
  useEffect(() => watchCalendarsSharedWithMe(email, setShares, () => setShares([])), [email]);
  const key = shares.map((s) => s.ownerUid).sort().join();
  useEffect(() => {
    const uids = key ? key.split(',') : [];
    setListsBy((prev) => Object.fromEntries(uids.filter((u) => u in prev).map((u) => [u, prev[u]])));
    const offs = uids.map((u) => watchCalendarLists(u, (ls) => setListsBy((p) => ({ ...p, [u]: ls })), () => setListsBy((p) => ({ ...p, [u]: [] }))));
    return () => offs.forEach((off) => off());
  }, [key]);
  return shares.map((share) => ({ share, lists: listsBy[share.ownerUid] || [] }));
}
