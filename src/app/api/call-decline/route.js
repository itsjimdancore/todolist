// "Decline" on a call's device notification (public/push-sw.js), with the app closed. The notification carries the
// chat's pass (lib/replyToken.js) in place of a sign-in; it only lets the person it was for decline a call that is
// ringing for them, in that chat. Their other devices stop ringing too.
import { admin } from '@/lib/pushAdmin';
import { deliverCallEnd } from '@/lib/pushSend';
import { readReplyToken } from '@/lib/replyToken';

export const runtime = 'nodejs';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }
  const pass = readReplyToken(body?.token);
  const callId = typeof body?.callId === 'string' && body.callId.length < 200 ? body.callId : '';
  if (!pass?.chatId || !callId) return Response.json({ error: 'Not a call pass.' }, { status: 401 });

  const a = await admin();
  if (a.error) return Response.json({ error: a.error }, { status: 503 });

  const chat = await a.db.collection('chats').doc(pass.chatId).get().catch(() => null);
  if (!chat?.exists || !(chat.data().members || []).includes(pass.email)) return Response.json({ error: 'No such chat.' }, { status: 404 });
  const ref = chat.ref.collection('calls').doc(callId);
  const call = await a.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.to !== pass.email || d.status !== 'ringing') return null;
    tx.update(ref, { status: 'declined', endedAt: a.FieldValue.serverTimestamp(), endedBy: pass.email, endPushedAt: a.FieldValue.serverTimestamp() });
    return d;
  }).catch(() => null);
  if (!call) return Response.json({ error: 'This call has already ended.' }, { status: 409 });

  // the same person's other devices: stop ringing there too
  const origin = new URL(req.url).origin;
  await deliverCallEnd(a, { chatId: pass.chatId, callId, to: pass.email, kind: call.kind, fromName: chat.data().names?.[call.from] || '' }, origin);
  return Response.json({ ok: true });
}
