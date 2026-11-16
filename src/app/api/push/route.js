// Sends device notifications (phone notification bar, Windows / Mac notification centre).
// The app calls this right after saving a change that wrote notifications (activity/{id}, invites/{id}).
// It only pushes notifications the caller just created themselves, each one once, to the devices of
// the person it's for. Needs FIREBASE_SERVICE_ACCOUNT (the service-account JSON) set on the server.
import { admin, caller as whoIs } from '@/lib/pushAdmin';
import { deliver, deliverCall, deliverCallEnd, deliverChat } from '@/lib/pushSend';

export const runtime = 'nodejs';

const MAX_IDS = 50;
const FRESH_MS = 2 * 60 * 1000; // only notifications made in the last 2 minutes

const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x && x.length < 1500) : []);

export async function POST(req) {
  const a = await admin();
  if (a.error) return Response.json({ error: a.error }, { status: 503 });

  // who's asking
  const caller = await whoIs(a, req);
  if (!caller) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const myEmail = (caller.email || '').toLowerCase();
  if (!myEmail) return Response.json({ error: 'Sign in with an email address.' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }
  const wanted = [
    ...ids(body.activity).map((id) => ['activity', id]),
    ...ids(body.invites).map((id) => ['invites', id]),
  ].slice(0, MAX_IDS);

  // Claim each notification in a transaction (mark it pushed) so it's only ever sent once
  const claimed = [];
  for (const [col, id] of wanted) {
    const ref = a.db.collection(col).doc(id);
    const doc = await a.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = snap.data();
      const made = d.createdAt?.toMillis?.() ?? 0;
      if (d.fromEmail !== myEmail || d.pushedAt || Date.now() - made > FRESH_MS) return null;
      tx.update(ref, { pushedAt: a.FieldValue.serverTimestamp() });
      return d;
    }).catch(() => null);
    if (doc) claimed.push({ col, id, doc });
  }

  // clicking it opens the app where it was used (the live site, or localhost while trying it out)
  const origin = new URL(req.url).origin;
  let sent = await deliver(a, claimed, origin, myEmail);

  // a chat message I just sent: to the other person in the chat, once
  const chatId = typeof body.chat?.chatId === 'string' ? body.chat.chatId : '';
  const messageId = typeof body.chat?.messageId === 'string' ? body.chat.messageId : '';
  if (chatId && messageId && chatId.length < 600 && messageId.length < 200) {
    const chat = await a.db.collection('chats').doc(chatId).get().catch(() => null);
    const members = chat?.exists ? chat.data().members || [] : [];
    if (members.includes(myEmail)) {
      const ref = a.db.collection('chats').doc(chatId).collection('messages').doc(messageId);
      const m = await a.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const d = snap.data();
        const made = d.createdAt?.toMillis?.() ?? 0;
        if (d.from !== myEmail || d.pushedAt || d.deleted || Date.now() - made > FRESH_MS) return null;
        tx.update(ref, { pushedAt: a.FieldValue.serverTimestamp() });
        return d;
      }).catch(() => null);
      const to = members.find((e) => e !== myEmail);
      if (m && to) sent += await deliverChat(a, { chatId, to, fromName: chat.data().names?.[myEmail] || caller.name || myEmail.split('@')[0], text: m.audio ? '🎤 Voice message' : m.sticker ? '🖼️ Sticker' : m.text }, origin);
    }
  }

  // a call I just started (body.call), or one that stopped ringing (body.callEnd): to the person called, once each
  for (const [key, field] of [['call', 'ringPushedAt'], ['callEnd', 'endPushedAt']]) {
    const cChat = typeof body[key]?.chatId === 'string' ? body[key].chatId : '';
    const callId = typeof body[key]?.callId === 'string' ? body[key].callId : '';
    if (!cChat || !callId || cChat.length >= 600 || callId.length >= 200) continue;
    const chat = await a.db.collection('chats').doc(cChat).get().catch(() => null);
    if (!chat?.exists || !(chat.data().members || []).includes(myEmail)) continue;
    const ref = a.db.collection('chats').doc(cChat).collection('calls').doc(callId);
    const call = await a.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = snap.data();
      if (d[field]) return null;
      if (key === 'call') {
        // only the caller, while it rings, within the first minute
        const made = d.createdAt?.toMillis?.() ?? 0;
        if (d.from !== myEmail || d.status !== 'ringing' || Date.now() - made > 60 * 1000) return null;
      } else if (d.status === 'ringing' || !d.ringPushedAt) {
        return null; // still ringing, or it never rang on their devices
      }
      tx.update(ref, { [field]: a.FieldValue.serverTimestamp() });
      return d;
    }).catch(() => null);
    if (!call) continue;
    const info = { chatId: cChat, callId, to: call.to, kind: call.kind, fromName: chat.data().names?.[call.from] || call.from.split('@')[0] };
    sent += key === 'call' ? await deliverCall(a, info, origin) : await deliverCallEnd(a, { ...info, missed: call.status === 'missed' }, origin);
  }

  return Response.json({ sent });
}
