'use client';
// Calls, for the whole app (like useChat): runs on every page, so a call rings wherever you are and carries on
// when you move around the app. Workspace shows IncomingCall and CallScreen from this.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallSession, RING_MS, declineCall, isFresh, logMissing, markMissed, watchRinging } from './calls';
import { toDate } from './people';

const ms = (ts) => (ts ? toDate(ts).getTime() : 0);
const SHOW_END_MS = 1800; // "Call ended" stays on screen this long
const SHOW_ERROR_MS = 6000; // a reason ("The microphone is blocked…") longer

export function useCall(user, chatApi) {
  const { chatId, other, me } = chatApi;
  const [ringing, setRinging] = useState([]);
  const [state, setState] = useState(null); // the call's state (CallSession.state), or null when there's no call
  const session = useRef(null);
  const [, tick] = useState(0);
  // opened from a call's notification: { callId, answer } (Answer: straight into the call), from the address
  // (the app was closed) or from the service worker (it was open). Read before Workspace tidies the address.
  const [wanted, setWanted] = useState(() => {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    return q.get('call') ? { callId: q.get('call'), answer: q.get('answer') === '1', at: Date.now() } : null;
  });
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    const on = (e) => { if (e.data?.type === 'call' && e.data.callId) setWanted({ callId: e.data.callId, answer: !!e.data.answer, at: Date.now() }); };
    sw.addEventListener('message', on);
    return () => sw.removeEventListener('message', on);
  }, []);

  useEffect(() => (chatId && me ? watchRinging(chatId, me, setRinging) : undefined), [chatId, me]);

  // calls I made that ended while the app was closed: put them in the chat now
  useEffect(() => { if (chatId) logMissing(chatId, user).catch(() => {}); }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ringing calls: too old ones (the caller's app closed without giving up) become missed; while I'm already
  // on a call, a new one is answered "busy"; and the screen checks again when the newest one runs out.
  useEffect(() => {
    let next = Infinity;
    for (const c of ringing) {
      if (!isFresh(c)) { markMissed(chatId, c.id, user).catch(() => {}); continue; }
      const live = session.current && session.current.state.phase !== 'ended';
      if (live && session.current.id !== c.id) { declineCall(chatId, c.id, user, true).catch(() => {}); continue; }
      next = Math.min(next, ms(c.createdAt) + RING_MS - Date.now());
    }
    if (next === Infinity) return undefined;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(500, next + 500));
    return () => clearTimeout(t);
  }, [ringing, chatId, user]);

  const active = state && state.phase !== 'ended';
  const incoming = active ? null : ringing.find((c) => isFresh(c)) || null;

  // the session reports every change; once it ends, the screen closes after a moment
  const track = useCallback((s) => {
    session.current = s;
    setState(s.state);
    s.onChange = (st) => {
      if (session.current !== s) return;
      setState(st);
      if (st.phase === 'ended') {
        setTimeout(() => { if (session.current === s) { session.current = null; setState(null); } }, st.error ? SHOW_ERROR_MS : SHOW_END_MS);
      }
    };
  }, []);

  const start = useCallback((kind) => {
    if (!chatId || !other || (session.current && session.current.state.phase !== 'ended')) return;
    const s = new CallSession({ chatId, user, other, kind, role: 'caller' });
    track(s);
    s.start();
  }, [chatId, other, user, track]);

  const answer = useCallback((call) => {
    if (session.current && session.current.state.phase !== 'ended') return;
    const s = new CallSession({ chatId, user, other: call.from, kind: call.kind, role: 'callee' });
    track(s);
    s.answer(call);
  }, [chatId, user, track]);

  // Answer on the notification: answer as soon as the call shows up here (the chat takes a moment to load).
  // It gives up after 15 s: the call ended meanwhile.
  useEffect(() => {
    if (!wanted) return undefined;
    const call = ringing.find((c) => c.id === wanted.callId && isFresh(c));
    if (call) {
      setWanted(null);
      if (wanted.answer) answer(call);
      return undefined;
    }
    const t = setTimeout(() => setWanted(null), Math.max(0, wanted.at + 15000 - Date.now()));
    return () => clearTimeout(t);
  }, [wanted, ringing, answer]);

  const decline = useCallback((call) => declineCall(chatId, call.id, user).catch(() => {}), [chatId, user]);
  const hangUp = useCallback(() => session.current?.hangUp(), []);
  const dismiss = useCallback(() => { session.current = null; setState(null); }, []);

  // closing the tab or leaving the app: hang up, so their screen doesn't keep ringing or "reconnecting"
  useEffect(() => {
    const bye = () => { if (session.current && session.current.state.phase !== 'ended') session.current.hangUp(); };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  return { state, session: session.current, incoming, active: !!active, start, answer, decline, hangUp, dismiss };
}
