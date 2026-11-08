'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_REMINDER_IDS, addComment, dismissActivity, dismissInvite, dismissLog, markActivitySeen, markInviteSeen, markLogSeen, saveReminderState, watchReminderState,
} from '@/lib/data';
import { addDays, dueLabel, fromKey, time12, timeRange, todayKey } from '@/lib/dates';
import { friendlyError } from '@/lib/firebase';
import { canComment, roleLabel } from '@/lib/permissions';
import { ACT, didText, isComment, notifyCopy, who } from '@/lib/activityText';
import { Avatar, colorFor, shownName, toDate } from '@/lib/people';
import { useToast } from './Toast';
import { PushPrompt } from './DevicePush';
import NotifySettings from './NotifySettings';
import { UpdateCard, useUpdate } from './UpdateBanner';

const PANEL_MAX = 8;
// "Stop reminding" for one task at one date (saved with the read / cleared reminders)
const stopKey = (listId, t) => `stop:${listId}/${t.id}:${t.due}`;

// ---------------------------------------------------------------------------
// Everything that's a notification, newest first:
//  • share    — someone shared a list with me (stored in Firestore, read state syncs across devices)
//  • mine     — what I did myself ("You created …", "You added a song …"), from my own log; counts as new too
//  • partner-add — someone added me as their partner (lib/partner.js): read state kept like reminders'
//  • partner  — what my partner did (their own log), in its own tab: never new, never in the bell, so a change
//               they made to my list isn't shown twice
//  • activity — someone else did something on a list or letter I'm on: a comment, a task added / done /
//               changed / deleted, a rename, someone joining or leaving… (also stored in Firestore; see ACT)
//  • due      — one of my open tasks is due today
//  • overdue  — an open task is past its date: comes back new every day until "Stop reminding"
// Reminders are worked out from the tasks; their read / cleared state is saved to my account, so every device agrees.
// ---------------------------------------------------------------------------
export function useNotifications({ invites, activity = [], log = [], me = null, user = null, lists, tasksByList, uid, openListId = null,
  partnerLog = [], partner = null, partnerAdded = null }) {
  const toast = useToast();
  const [local, setLocal] = useState({ read: [], gone: [] });
  useEffect(() => watchReminderState(uid, (saved) => {
    if (saved) return setLocal({ read: saved.read || [], gone: saved.gone || [] });
    // nothing on the account yet: bring over what this browser kept before reminders synced, once
    const oldKey = `notifications:${uid}`;
    let old = null;
    try { old = JSON.parse(localStorage.getItem(oldKey)); } catch {}
    if (old && (old.read?.length || old.gone?.length)) {
      const next = { read: (old.read || []).slice(-MAX_REMINDER_IDS), gone: (old.gone || []).slice(-MAX_REMINDER_IDS) };
      setLocal(next);
      saveReminderState(uid, next).then(() => { try { localStorage.removeItem(oldKey); } catch {} }).catch(() => {});
    } else {
      setLocal({ read: [], gone: [] });
    }
  }), [uid]);
  // shows straight away; the account copy (and every other device) follows a moment later
  const saveLocal = (fn) => {
    const next = fn(local);
    const capped = { read: next.read.slice(-MAX_REMINDER_IDS), gone: next.gone.slice(-MAX_REMINDER_IDS) };
    setLocal(capped);
    saveReminderState(uid, capped).catch(fail);
  };

  const today = todayKey();
  const items = useMemo(() => {
    const read = new Set(local.read);
    const gone = new Set(local.gone);
    const byId = new Map((lists || []).map((l) => [l.id, l]));
    const out = [];

    for (const inv of invites) {
      const list = byId.get(inv.listId);
      if (!list) continue; // deleted, or my access was removed
      out.push({
        id: `share:${inv.id}`, kind: 'share', inviteId: inv.id, read: !!inv.seen, at: toDate(inv.createdAt),
        listId: list.id, listTitle: list.title, role: list.role, letter: list.kind === 'letter',
        from: { email: inv.fromEmail, displayName: shownName(inv.fromName, inv.fromEmail) },
      });
    }

    for (const a of activity) {
      const act = ACT[a.kind];
      const list = byId.get(a.listId);
      // gone (deleted, or I'm no longer on it): only the notifications that say so still show
      if (!act || (!list && !act.gone)) continue;
      out.push({
        id: `act:${a.id}`, kind: a.kind, activityId: a.id, read: !!a.seen, at: toDate(a.createdAt),
        listId: a.listId, listTitle: list?.title || a.listTitle, role: list?.role, gone: !list,
        letter: list ? list.kind === 'letter' : !!a.letter, text: a.text || '', detail: a.detail || '',
        from: { email: a.fromEmail, displayName: shownName(a.fromName, a.fromEmail) },
      });
    }

    // my own activity: always shown (even when the list has gone since), music too
    for (const a of log) {
      const act = ACT[a.kind];
      if (!act) continue;
      const list = a.listId ? byId.get(a.listId) : null;
      out.push({
        id: `log:${a.id}`, kind: a.kind, logId: a.id, self: true, read: !!a.seen, at: toDate(a.createdAt),
        music: act.group === 'music', listId: a.listId || null, listTitle: list?.title || a.listTitle || '', role: list?.role,
        gone: !act.noList && !list, letter: list ? list.kind === 'letter' : !!a.letter,
        text: a.text || '', detail: a.detail || '', target: a.target || '',
        from: me || { email: '' },
      });
    }

    // someone added me as their partner: everything of theirs is mine to see now
    if (partnerAdded) {
      const id = `partner-add:${partnerAdded.uid}:${partnerAdded.at.getTime()}`;
      if (!gone.has(id)) {
        out.push({ id, kind: 'partner-add', read: read.has(id), at: partnerAdded.at, partnerPage: true, both: partnerAdded.both,
          from: { email: partnerAdded.email, displayName: partnerAdded.displayName } });
      }
    }

    for (const list of lists || []) {
      if (list.archived) continue;
      for (const t of tasksByList[list.id] || []) {
        if (t.done || t.archived || !t.due || t.due > today) continue;
        if (t.due === today) {
          // due today: one reminder, arriving at the start of the day (or at its start time)
          const id = `due:${list.id}/${t.id}:${t.due}`;
          if (gone.has(id)) continue;
          const at = fromKey(t.due);
          if (t.start) at.setHours(...t.start.split(':').map(Number));
          out.push({ id, kind: 'due', read: read.has(id), at, listId: list.id, listTitle: list.title, role: list.role, task: t });
          continue;
        }
        // overdue: a fresh, unread reminder every day it stays overdue (removing or reading today's only lasts
        // for today), until I say "Stop reminding" for this task and date. A new date starts reminders again.
        const stop = stopKey(list.id, t);
        if (gone.has(stop)) continue;
        const id = `overdue:${list.id}/${t.id}:${t.due}@${today}`;
        if (gone.has(id)) continue;
        out.push({
          id, kind: 'overdue', stopId: stop, read: read.has(id), at: fromKey(today),
          listId: list.id, listTitle: list.title, role: list.role, task: t,
        });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }, [invites, activity, log, me, lists, tasksByList, local, today, partnerAdded]);

  // my partner's activity, read-only (it's theirs to mark or remove)
  const partnerItems = useMemo(() => {
    if (!partner) return [];
    const byId = new Map((lists || []).map((l) => [l.id, l]));
    const out = [];
    for (const a of partnerLog) {
      const act = ACT[a.kind];
      if (!act) continue;
      const list = a.listId ? byId.get(a.listId) : null;
      out.push({
        id: `partner:${a.id}`, kind: a.kind, partner: true, read: true, at: toDate(a.createdAt),
        music: act.group === 'music', listId: a.listId || null, listTitle: list?.title || a.listTitle || '', role: list?.role,
        gone: !act.noList && !list, letter: list ? list.kind === 'letter' : !!a.letter,
        text: a.text || '', detail: a.detail || '', target: a.target || '',
        from: partner,
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [partnerLog, partner, lists]);

  // A share or a comment that arrives while the app is open also pops a toast
  // (not for comments on the list I'm looking at: I can see those already)
  const known = useRef(null);
  useEffect(() => {
    if (!lists) return; // wait for the lists, or every notification would look new on load
    // (not my own: I just did it, and already got a "Comment sent" / "Task deleted" message)
    const live = items.filter((n) => !n.self && (n.kind === 'share' || ACT[n.kind]));
    if (known.current) {
      const fresh = live.filter((n) => !n.read && !known.current.has(n.id) && !(n.kind !== 'share' && n.listId === openListId));
      if (fresh.length === 1) {
        const c = notifyCopy(fresh[0]);
        if (c) toast({ title: c.title, description: c.body, kind: 'info' });
      } else if (fresh.length > 1) {
        toast({ title: `${fresh.length} new notifications`, description: 'Open the bell to see them.', kind: 'info' });
      }
    }
    known.current = new Set(live.map((n) => n.id));
  }, [items, lists, toast, openListId]);

  const fail = (err) => toast(`Couldn't update the notification: ${friendlyError(err)}`, 'err');
  const setRead = (n, on) => {
    if (n.read === on) return;
    if (n.kind === 'share') markInviteSeen(n.inviteId, on).catch(fail);
    else if (n.activityId) markActivitySeen(n.activityId, on).catch(fail);
    else if (n.logId) markLogSeen(uid, n.logId, on).catch(fail);
    else saveLocal((p) => ({ ...p, read: on ? [...new Set([...p.read, n.id])] : p.read.filter((x) => x !== n.id) }));
  };
  const dismiss = (n) => {
    if (n.kind === 'share') dismissInvite(n.inviteId).catch(fail);
    else if (n.activityId) dismissActivity(n.activityId).catch(fail);
    else if (n.logId) dismissLog(uid, n.logId).catch(fail);
    else saveLocal((p) => ({ read: p.read.filter((x) => x !== n.id), gone: [...new Set([...p.gone, n.id])] }));
  };
  // a comment notification: can I answer it from here? (someone else's comment, on a list I can still comment on)
  const canReply = (n) => !!user && !n.self && !n.partner && !n.gone && (n.kind === 'comment' || n.kind === 'comment-edit')
    && canComment((lists || []).find((l) => l.id === n.listId)?.role);
  // ...and answer it: posts a comment on that list (everyone on it is told, as usual) and marks this one read
  const reply = async (n, text) => {
    const list = (lists || []).find((l) => l.id === n.listId);
    if (!list || !canComment(list.role)) throw new Error("You can't comment on this list any more.");
    await addComment(list, user, text);
    setRead(n, true);
    toast(`Reply sent to “${list.title}”`);
  };

  // overdue: stop the daily reminder for this task (until its date changes), with Undo
  const stopReminding = (n) => {
    if (!n.stopId) return;
    saveLocal((p) => ({ read: p.read.filter((x) => x !== n.id), gone: [...new Set([...p.gone, n.stopId])] }));
    toast({
      title: 'Reminders stopped',
      description: `“${n.task.text}” won't be reminded again. Changing its date starts them again.`,
      action: { label: 'Undo', onClick: () => saveLocal((p) => ({ ...p, gone: p.gone.filter((x) => x !== n.stopId) })) },
    });
  };

  // opening the app with overdue tasks: say so once a day on this device, as well as in the bell
  const overdueNow = items.filter((n) => n.kind === 'overdue' && !n.read).length;
  useEffect(() => {
    if (!lists || !overdueNow) return;
    const key = `overdue-nudge:${uid}`;
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {}
    toast({
      title: `${overdueNow} task${overdueNow > 1 ? 's are' : ' is'} overdue`,
      description: 'Open the bell to see them, or stop the reminder for any of them.',
      kind: 'info',
    });
  }, [lists, overdueNow, uid, today, toast]);

  const markAllRead = () => {
    const unread = items.filter((n) => !n.read);
    const writes = [
      ...unread.filter((n) => n.kind === 'share').map((n) => markInviteSeen(n.inviteId, true)),
      ...unread.filter((n) => n.activityId).map((n) => markActivitySeen(n.activityId, true)),
      ...unread.filter((n) => n.logId).map((n) => markLogSeen(uid, n.logId, true)),
    ];
    const ids = unread.filter((n) => REMINDER.has(n.kind)).map((n) => n.id);
    if (ids.length) {
      const next = { ...local, read: [...new Set([...local.read, ...ids])].slice(-MAX_REMINDER_IDS) };
      setLocal(next);
      writes.push(saveReminderState(uid, next));
    }
    // one message however many didn't go through
    Promise.allSettled(writes).then((r) => {
      const failed = r.filter((x) => x.status === 'rejected');
      if (failed.length) toast(`Couldn't mark ${failed.length} notification${failed.length > 1 ? 's' : ''} as read: ${friendlyError(failed[0].reason)}`, 'err');
    });
  };

  return { items, unread: items.filter((n) => !n.read).length, setRead, dismiss, stopReminding, canReply, reply, markAllRead, partnerItems, partner };
}

// ---------------------------------------------------------------------------
// How one notification reads
// ---------------------------------------------------------------------------
const KIND = {
  share: { label: 'Shared with you', cta: 'Open list' },
  'partner-add': { label: 'Partner', cta: 'Open Partner' },
  due: { label: 'Due today', cta: 'Open task' },
  overdue: { label: 'Overdue', cta: 'Open task' },
};

const isUpdate = (n) => !!ACT[n.kind] && !isComment(n);
const REMINDER = new Set(['due', 'overdue']);
const labelOf = (n) => (ACT[n.kind] || KIND[n.kind]).label;
const ctaOf = (n) =>
  n.music ? 'Open music' : n.gone ? null : isComment(n) ? 'Open comments' : ACT[n.kind] || n.kind === 'share' ? (n.letter ? 'Open letter' : 'Open list') : KIND[n.kind].cta;

function Headline({ n }) {
  if (n.kind === 'partner-add') {
    return <><b>{n.from.displayName || n.from.email}</b> added you as their partner. You can see and change all their lists, letters and music{n.both ? '' : '. Add them back to share yours'}</>;
  }
  if (n.kind === 'share') {
    if (n.letter) return <><b>{n.from.displayName || n.from.email}</b> sent you a love letter, <b>“{n.listTitle}”</b></>;
    return <><b>{n.from.displayName || n.from.email}</b> shared <b>“{n.listTitle}”</b> with you</>;
  }
  if (ACT[n.kind]) {
    if (ACT[n.kind].noList) return <><b>{who(n)}</b> {didText(n)}</>;
    return <><b>{who(n)}</b> {didText(n)} {n.letter && n.kind !== 'list-create' ? 'the love letter ' : ''}<b>“{n.listTitle}”</b></>;
  }
  if (n.kind === 'due') {
    return <><b>“{n.task.text}”</b> is due today{n.task.start ? ` at ${time12(n.task.start)}` : ''}</>;
  }
  const days = Math.round((fromKey(todayKey()) - fromKey(n.task.due)) / 86_400_000);
  return <><b>“{n.task.text}”</b> is overdue by {days} day{days > 1 ? 's' : ''}</>;
}

function KindIcon({ n, size = 36 }) {
  if (n.kind === 'share' || n.kind === 'partner-add' || ACT[n.kind]) {
    return (
      <span className={`nt-ic k-${n.kind === 'share' ? 'share' : isComment(n) ? 'comment' : n.music ? 'music' : 'update'}`} style={{ width: size, height: size }}>
        <Avatar person={n.from} size={size} />
        <span className="nt-ic-mini" aria-hidden="true">
          {n.kind === 'share' || n.kind === 'partner-add' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" /></svg>
          ) : isComment(n) ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>
          ) : n.music ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          ) : n.kind === 'task-done' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          )}
        </span>
      </span>
    );
  }
  return (
    <span className={`nt-ic k-${n.kind}`} style={{ width: size, height: size }} aria-hidden="true">
      {n.kind === 'due' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
      )}
    </span>
  );
}

const ago = (d) => {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return 'later today';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const fullTime = (d) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Today / Yesterday / This week / Earlier
function groupByDay(items) {
  const t = todayKey();
  const label = (d) => {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (k >= t) return 'Today';
    if (k === addDays(t, -1)) return 'Yesterday';
    if (k > addDays(t, -7)) return 'This week';
    return 'Earlier';
  };
  const groups = [];
  for (const n of items) {
    const g = label(n.at);
    if (groups.at(-1)?.label !== g) groups.push({ label: g, items: [] });
    groups.at(-1).items.push(n);
  }
  return groups;
}

// Replying to a comment from its notification, the way a chat app's notification does it:
//  • under the notification, two quiet actions: "Reply" and "Mark as read"
//  • Reply quotes the comment (who wrote it, and what), with a rounded box under it and a round send button
//  • Enter sends (Shift+Enter is a new line); Esc, or clicking away with nothing typed, puts it back
//  • once sent, "You: …" shows under the quote with a tick, like a sent message
// Clicks and keys stay inside: the row itself opens the list.
function QuickReply({ n, api, compact }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(null); // what I replied, shown under the quote
  if (!api.canReply(n)) return null;
  const name = n.from.displayName || n.from.email;
  const stop = (e) => e.stopPropagation();
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 110)}px`; } };
  const close = () => { setOpen(false); setText(''); setErr(''); };

  async function send(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr('');
    try {
      await api.reply(n, t);
      setSent(t); setText(''); setOpen(false);
    } catch (x) {
      setErr(friendlyError(x));
    }
    setBusy(false);
  }

  const cls = compact ? ' compact' : '';
  const replied = sent && (
    <p className={`nt-sent${cls}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12.5 6.5 17 15 8M9.5 17 18 8.5M14 17l8-8.5" /></svg>
      <span><b>You:</b> {sent}</span>
    </p>
  );

  if (!open) {
    return (
      <div className={`nt-qr${cls}`} onClick={stop} onKeyDown={stop}>
        {replied}
        <div className="nt-qr-acts">
          <button type="button" className="nt-qr-a" onClick={() => setOpen(true)}>{sent ? 'Reply again' : 'Reply'}</button>
          {!n.read && <button type="button" className="nt-qr-a" onClick={() => api.setRead(n, true)}>Mark as read</button>}
        </div>
      </div>
    );
  }
  return (
    <form className={`nt-qr open${cls}`} onSubmit={send} onClick={stop} onMouseDown={stop} onKeyDown={stop}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !text.trim() && !busy) close(); }}>
      {/* the comment being answered */}
      <blockquote className="nt-quote">
        <b>{name}</b>
        <span>{n.text || 'Comment'}</span>
      </blockquote>
      {replied}
      <div className="nt-qr-in">
        <textarea autoFocus rows={1} maxLength={2000} value={text} placeholder="Reply" aria-label={`Reply to ${name}`}
          enterKeyHint="send" ref={grow}
          onChange={(e) => { setText(e.target.value); grow(e.target); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
          }} />
        <button type="submit" className="nt-qr-send" disabled={!text.trim() || busy} aria-label={busy ? 'Sending' : 'Send reply'} title="Send">
          {busy ? <span className="nt-qr-spin" aria-hidden="true" /> : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21.9 12 3.4 3.6 3.3 10l13 2-13 2z" /></svg>
          )}
        </button>
      </div>
      {err && <span className="nt-reply-err" role="alert">{err}</span>}
    </form>
  );
}

// small icon buttons that appear on a row
function RowActions({ n, api }) {
  if (n.partner) return null; // my partner's activity: theirs to mark or remove
  return (
    <div className="nt-acts">
      {n.stopId && (
        <button type="button" className="nt-act" onClick={(e) => { e.stopPropagation(); api.stopReminding(n); }}
          title="Stop reminding me" aria-label="Stop reminding me about this task">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.7 3.6A6 6 0 0 1 18 8c0 3.2.8 5.4 1.6 6.8M17 17H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" /></svg>
        </button>
      )}
      <button type="button" className="nt-act" onClick={(e) => { e.stopPropagation(); api.setRead(n, !n.read); }}
        title={n.read ? 'Mark as unread' : 'Mark as read'} aria-label={n.read ? 'Mark as unread' : 'Mark as read'}>
        {n.read ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </button>
      <button type="button" className="nt-act" onClick={(e) => { e.stopPropagation(); api.dismiss(n); }}
        title="Remove" aria-label="Remove notification">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bell and its drop-down panel
// ---------------------------------------------------------------------------
export default function Notifications({ api, user, onOpen, onViewAll }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const box = useRef(null);
  const { items } = api;
  const upd = useUpdate();
  const unread = api.unread + (upd.ready ? 1 : 0); // a waiting update counts as one more
  const shown = (tab === 'unread' ? items.filter((n) => !n.read) : items).slice(0, PANEL_MAX);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (n) => { api.setRead(n, true); if (n.partnerPage) onOpen(null, { partner: true }); else if (n.music) onOpen(null); else if (!n.gone) onOpen(n.listId, { comments: isComment(n) }); setOpen(false); };

  return (
    <div className="notif" ref={box}>
      <button className={open ? 'bell on' : 'bell'} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="np" role="dialog" aria-label="Notifications">
          <div className="np-h">
            <div className="np-title">
              <h2>Notifications</h2>
              {unread > 0 && <span className="np-count">{unread} new</span>}
            </div>
            <button type="button" className="link small" onClick={api.markAllRead} disabled={!api.unread}>Mark all as read</button>
          </div>
          <div className="np-tabs" role="tablist">
            {[['all', 'All', items.length], ['unread', 'Unread', api.unread]].map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}<span>{n}</span>
              </button>
            ))}
          </div>

          <div className="np-body">
            <UpdateCard compact />
            {shown.length === 0 ? (
              <Empty unreadOnly={tab === 'unread'} compact />
            ) : (
              groupByDay(shown).map((g) => (
                <section key={g.label}>
                  <h3 className="np-g">{g.label}</h3>
                  {g.items.map((n) => (
                    <div key={n.id} className={n.read ? 'np-row' : 'np-row unread'} role="button" tabIndex={0}
                      onClick={() => go(n)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go(n))}>
                      <KindIcon n={n} />
                      <div className="np-row-b">
                        <p className="np-row-t"><Headline n={n} /></p>
                        <p className="np-row-m">
                          <span className={`nt-kind k-${n.kind}`}>{labelOf(n)}</span>
                          <span className="nt-dot" aria-hidden="true">·</span>
                          <time dateTime={n.at.toISOString()} title={fullTime(n.at)}>{ago(n.at)}</time>
                        </p>
                        <QuickReply n={n} api={api} compact />
                      </div>
                      {!n.read && <span className="np-unread" aria-label="Unread" />}
                      <RowActions n={n} api={api} />
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>

          <PushPrompt user={user} ready={items.some((n) => !n.self && (n.kind === 'share' || isComment(n)))} />
          <button type="button" className="np-f" onClick={() => { setOpen(false); onViewAll(); }}>
            View all notifications
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function Empty({ unreadOnly, filtered, compact }) {
  return (
    <div className={compact ? 'nt-empty compact' : 'nt-empty'}>
      <span className="nt-empty-ic" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      </span>
      <b>{unreadOnly ? "You're all caught up" : filtered ? 'Nothing here' : 'No notifications yet'}</b>
      <span>
        {unreadOnly
          ? 'There are no unread notifications.'
          : filtered
            ? 'Nothing matches this filter.'
            : 'When someone shares a list with you, changes something on one, or a task is due, it shows up here.'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The full Notifications page
// ---------------------------------------------------------------------------
const FILTERS = {
  all: { label: 'All', test: () => true },
  unread: { label: 'Unread', test: (n) => !n.read },
  share: { label: 'Shared with you', test: (n) => n.kind === 'share' || n.kind === 'partner-add' },
  updates: { label: 'Updates', test: isUpdate },
  comments: { label: 'Comments', test: isComment },
  reminders: { label: 'Reminders', test: (n) => REMINDER.has(n.kind) },
  mine: { label: 'My activity', test: (n) => !!n.self },
};

export function NotificationsPage({ api, user, onOpen }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const { items, unread, partnerItems = [], partner } = api;
  const q = query.trim().toLowerCase();
  const text = (n) => `${n.listTitle} ${n.task?.text || ''} ${n.text || ''} ${n.detail || ''} ${n.from?.displayName || ''} ${n.from?.email || ''}`.toLowerCase();
  // with a partner: a tab of everything they did (their own activity, read-only)
  const filters = partner
    ? { ...FILTERS, partner: { label: `${(partner.displayName || partner.email).split(/[\s@]/)[0]}'s activity`, test: () => true } }
    : FILTERS;
  const tab = filters[filter] ? filter : 'all';
  const source = tab === 'partner' ? partnerItems : items;
  const shown = source.filter((n) => filters[tab].test(n) && (!q || text(n).includes(q)));
  const count = (k) => (k === 'partner' ? partnerItems.length : items.filter(filters[k].test).length);
  const stats = [
    { label: 'Unread', value: unread, tone: 'accent' },
    { label: 'Updates', value: count('updates') + count('comments'), tone: '' },
    { label: 'Due today', value: items.filter((n) => n.kind === 'due').length, tone: 'warn' },
    { label: 'Overdue', value: items.filter((n) => n.kind === 'overdue').length, tone: 'danger' },
  ];
  const go = (n) => { api.setRead(n, true); if (n.partnerPage) onOpen(null, { partner: true }); else if (n.music) onOpen(null); else if (!n.gone) onOpen(n.listId, { comments: isComment(n) }); };

  return (
    <div className="ntp">
      <header className="bar">
        <div className="bar-left">
          <h1>Notifications</h1>
          <div className="meta">{unread ? `${unread} unread` : 'All caught up'} · shares, changes, comments and task reminders</div>
        </div>
        <div className="bar-right">
          <button className="btn" type="button" onClick={() => setSettings(true)} title="Notification settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
            <span>Settings</span>
          </button>
          <button className="btn" type="button" onClick={api.markAllRead} disabled={!unread}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16" /></svg>
            <span className="ntp-mark-l">Mark all as read</span><span className="ntp-mark-s">Read all</span>
          </button>
        </div>
      </header>

      <div className="ntp-stats">
        {stats.map((s) => (
          <div key={s.label} className={`ntp-stat ${s.tone}`}>
            <span>{s.label}</span>
            <b>{s.value}</b>
          </div>
        ))}
      </div>

      <div className="ntp-tools">
        <div className="ntp-filters" role="tablist" aria-label="Filter notifications">
          {Object.entries(filters).map(([k, f]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {f.label}<span>{count(k)}</span>
            </button>
          ))}
        </div>
        <div className="cal-search ntp-search" role="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications" aria-label="Search notifications" />
        </div>
      </div>

      <div className="page-body">
      <div className="ntp-list">
        <UpdateCard />
        {shown.length === 0 ? (
          <Empty unreadOnly={tab === 'unread' && !q} filtered={tab !== 'all' || !!q} />
        ) : (
          groupByDay(shown).map((g) => (
            <section key={g.label} className="ntp-group" aria-label={g.label}>
              <h2 className="ntp-g">{g.label}<span>{g.items.length}</span></h2>
              <ul>
                {g.items.map((n) => (
                  <li key={n.id} className={n.read ? 'ntp-row' : 'ntp-row unread'}>
                    {!n.read && <span className="ntp-bar" aria-hidden="true" />}
                    <KindIcon n={n} size={42} />
                    <div className="ntp-row-b">
                      <div className="ntp-row-top">
                        <span className={`nt-kind k-${n.kind}`}>{labelOf(n)}</span>
                        <time dateTime={n.at.toISOString()} title={fullTime(n.at)}>{ago(n.at)}</time>
                        {!n.read && <span className="ntp-new">New</span>}
                      </div>
                      <p className="ntp-row-t"><Headline n={n} /></p>
                      <Details n={n} />
                      <QuickReply n={n} api={api} />
                    </div>
                    <div className="ntp-row-side">
                      {ctaOf(n) && <button type="button" className="btn small-btn" onClick={() => go(n)}>{ctaOf(n)}</button>}
                      {n.stopId && <button type="button" className="btn small-btn nt-stop" onClick={() => api.stopReminding(n)}>Stop reminding</button>}
                      <RowActions n={n} api={api} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      </div>
      {settings && <NotifySettings user={user} onClose={() => setSettings(false)} />}
    </div>
  );
}

// The detail line under a notification on the page
function Details({ n }) {
  if (n.kind === 'partner-add') {
    return <div className="ntp-d"><span className="ntp-d-extra">from {n.from.email}</span><span className="ntp-d-extra">{fullTime(n.at)}</span></div>;
  }
  const list = n.listId ? (
    <span className="ntp-list-chip"><i style={{ background: colorFor(n.listId) }} />{n.listTitle}</span>
  ) : null;
  if (n.kind === 'share') {
    return (
      <div className="ntp-d">
        {list}
        {n.role && <span className={`pill ${n.role}`}>{roleLabel(n.role)}</span>}
        <span className="ntp-d-extra">from {n.from.email}</span>
        <span className="ntp-d-extra">{fullTime(n.at)}</span>
      </div>
    );
  }
  if (ACT[n.kind]) {
    return (
      <div className="ntp-d">
        {ACT[n.kind].noList ? null : n.gone ? <span className="ntp-list-chip nt-gone">{n.listTitle}</span> : list}
        {isComment(n) && n.text && <span className={n.kind === 'comment-delete' ? 'ntp-notes nt-gone' : 'ntp-notes'} title={n.text}>“{n.text}”</span>}
        <span className="ntp-d-extra">{fullTime(n.at)}</span>
      </div>
    );
  }
  const t = n.task;
  return (
    <div className="ntp-d">
      {list}
      <span className={n.kind === 'overdue' ? 'late-txt' : ''}>Due {dueLabel(t.due).toLowerCase()}{t.start ? `, ${timeRange(t.start, t.mins)}` : ''}</span>
      {t.createdByName && <span className="ntp-d-extra">added by {shownName(t.createdByName, t.createdBy)}</span>}
      {t.notes && <span className="ntp-notes" title={t.notes}>{t.notes}</span>}
    </div>
  );
}
