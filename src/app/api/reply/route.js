// A reply typed straight into a comment's device notification (Windows, Android, ChromeOS… wherever the system
// shows a text box on it), sent by the notification code (public/push-sw.js) without opening the app.
// It carries the notification's reply pass (lib/replyToken.js) instead of a sign-in. This checks the pass,
// checks the person can still comment on that list, and then does exactly what the app does when you comment:
// the comment, your own "You commented" log entry, a notification for everyone else on the list who can see
// comments (sent to their devices too), and the notification you answered marked as read.
import { createHash } from 'node:crypto';
import { admin } from '@/lib/pushAdmin';
import { deliver, deliverChat } from '@/lib/pushSend';
import { readReplyToken } from '@/lib/replyToken';

export const runtime = 'nodejs';

const MAX = 2000; // same as a comment in the app
const RATE_MS = 3000; // one reply every 3 seconds per person per list

const canComment = (role) => role === 'owner' || role === 'comment' || role === 'readwrite';
const seesComments = (permission) => permission === 'comment' || permission === 'readwrite';
const fail = (error, status) => Response.json({ error }, { status });

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return fail('Bad request.', 400); }

  const pass = readReplyToken(body?.token);
  if (!pass) return fail('This reply link has expired. Open the app to reply.', 401);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX) : '';
  if (!text) return fail('Type a reply first.', 400);

  const a = await admin();
  if (a.error) return fail(a.error, 503);

  // a reply to a chat message: posted in the private chat, as if typed in the app
  if (pass.chatId) return replyInChat(a, pass, text.slice(0, 4000), new URL(req.url).origin);

  // still allowed to comment on this list?
  const listRef = a.db.collection('lists').doc(pass.listId);
  const listSnap = await listRef.get().catch(() => null);
  if (!listSnap?.exists) return fail('That list is gone.', 404);
  const list = listSnap.data();
  const roles = list.roles || {};
  const role = list.ownerEmail === pass.email ? 'owner' : roles[pass.email] || null;
  if (!canComment(role)) return fail("You can't comment on this list any more.", 403);

  // who's replying: their account, as the app knows it
  const who = await a.auth.getUserByEmail(pass.email).catch(() => null);
  if (!who) return fail('Sign in to the app again, then reply.', 403);
  const profile = await a.db.collection('users').doc(who.uid).get().then((s) => s.data() || {}).catch(() => ({}));
  const name = (profile.name || profile.displayName || who.displayName || pass.email.split('@')[0]).slice(0, 120);

  // not too fast (replyRate/* is only used here: the rules give the app no access to it)
  const rateRef = a.db.collection('replyRate').doc(createHash('sha1').update(`${pass.email}|${pass.listId}`).digest('hex'));
  const allowed = await a.db.runTransaction(async (tx) => {
    const r = await tx.get(rateRef);
    if (r.exists && Date.now() - (r.data().at || 0) < RATE_MS) return false;
    tx.set(rateRef, { at: Date.now() });
    return true;
  }).catch(() => true);
  if (!allowed) return fail('Wait a moment before replying again.', 429);

  const now = a.FieldValue.serverTimestamp();
  const listTitle = String(list.title || '').slice(0, 120);
  const letter = list.kind === 'letter';
  const b = a.db.batch();

  // the comment, the same as one written in the app
  b.set(listRef.collection('comments').doc(), { text, userId: who.uid, userName: name, userEmail: pass.email, createdAt: now });

  // "You commented on …" in my own notifications
  b.set(a.db.collection('users').doc(who.uid).collection('log').doc(), {
    kind: 'comment', text: text.slice(0, 200), detail: '', target: '', listId: pass.listId, listTitle, letter, seen: false, createdAt: now,
  });

  // everyone else who can see the comments; marked as pushed, since this sends them itself below
  const to = new Set([list.ownerEmail, ...Object.keys(roles).filter((e) => seesComments(roles[e]))].filter((e) => e && e !== pass.email));
  const items = [];
  for (const email of to) {
    const ref = a.db.collection('activity').doc();
    const doc = {
      to: email, listId: pass.listId, listTitle, ...(letter ? { letter: true } : {}), kind: 'comment',
      text: text.slice(0, 200), detail: '', fromName: name, fromEmail: pass.email, seen: false, createdAt: now, pushedAt: now,
    };
    b.set(ref, doc);
    items.push({ col: 'activity', id: ref.id, doc });
  }

  // the notification I answered: read now
  if (pass.activityId) {
    const mine = await a.db.collection('activity').doc(pass.activityId).get().catch(() => null);
    if (mine?.exists && mine.data().to === pass.email) b.update(mine.ref, { seen: true });
  }

  try {
    await b.commit();
  } catch (e) {
    return fail(`Couldn't send your reply (${e.code || e.message}).`, 500);
  }

  await deliver(a, items, new URL(req.url).origin, pass.email).catch(() => 0);
  return Response.json({ ok: true, listTitle });
}

// The pass is for a chat: the person must still be one of its two members
async function replyInChat(a, pass, text, origin) {
  const chatRef = a.db.collection('chats').doc(pass.chatId);
  const chat = await chatRef.get().catch(() => null);
  const members = chat?.exists ? chat.data().members || [] : [];
  if (!members.includes(pass.email)) return fail('That chat is gone.', 404);
  const who = await a.auth.getUserByEmail(pass.email).catch(() => null);
  if (!who) return fail('Sign in to the app again, then reply.', 403);
  const profile = await a.db.collection('users').doc(who.uid).get().then((s) => s.data() || {}).catch(() => ({}));
  const name = (profile.name || profile.displayName || who.displayName || pass.email.split('@')[0]).slice(0, 120);

  const rateRef = a.db.collection('replyRate').doc(createHash('sha1').update(`${pass.email}|chat|${pass.chatId}`).digest('hex'));
  const allowed = await a.db.runTransaction(async (tx) => {
    const r = await tx.get(rateRef);
    if (r.exists && Date.now() - (r.data().at || 0) < RATE_MS) return false;
    tx.set(rateRef, { at: Date.now() });
    return true;
  }).catch(() => true);
  if (!allowed) return fail('Wait a moment before replying again.', 429);

  const now = a.FieldValue.serverTimestamp();
  const msgRef = chatRef.collection('messages').doc();
  const b = a.db.batch();
  b.set(msgRef, { from: pass.email, text, createdAt: now, pushedAt: now });
  b.update(chatRef, 'last', { text: text.slice(0, 200), from: pass.email, at: now },
    new a.FieldPath('readAt', pass.email), now, new a.FieldPath('names', pass.email), name);
  try {
    await b.commit();
  } catch (e) {
    return fail(`Couldn't send your reply (${e.code || e.message}).`, 500);
  }
  const to = members.find((e) => e !== pass.email);
  if (to) await deliverChat(a, { chatId: pass.chatId, to, fromName: name, text }, origin).catch(() => 0);
  return Response.json({ ok: true });
}
