'use client';
import { useCallback, useEffect, useState } from 'react';

// When I last read a list's comments, kept in this browser (per person, per list).
// It drives the "New · n" line in the thread and the dot on the phone's Comments tab.
// Nothing stored yet (first visit, private window) means "nothing is new", never "everything is new".
const keyOf = (uid, listId) => `seen:comments:${uid}:${listId}`;

export const commentMs = (c) => (c?.createdAt && typeof c.createdAt.toMillis === 'function' ? c.createdAt.toMillis() : null);

export function useCommentsSeen(listId, uid) {
  const [state, setState] = useState({ key: null, seen: null });
  const key = keyOf(uid, listId);

  useEffect(() => {
    let v = null;
    try {
      const raw = localStorage.getItem(key);
      v = raw ? Number(raw) || null : null;
    } catch {
      /* storage unavailable: treat everything as read */
    }
    setState({ key, seen: v });
  }, [key]);

  const markSeen = useCallback((ms) => {
    setState((s) => {
      if (s.key !== key || (s.seen && s.seen >= ms)) return s;
      try { localStorage.setItem(key, String(ms)); } catch { /* not kept */ }
      return { key, seen: ms };
    });
  }, [key]);

  const ready = state.key === key;
  return { seen: ready ? state.seen : null, ready, markSeen };
}

// Comments by other people that arrived after I last read the thread
export function unreadCount(comments, uid, seen) {
  if (!seen) return 0;
  return comments.filter((c) => c.userId !== uid && (commentMs(c) || 0) > seen).length;
}
