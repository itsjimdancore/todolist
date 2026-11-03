// A chat message's device notification reached the person's phone or computer (sent by public/push-sw.js when it
// shows the notification, even with the app closed). Like WhatsApp, that's "delivered": the sender sees grey
// double ticks. The notification carries the chat's reply pass (lib/replyToken.js) in place of a sign-in;
// it only lets this record that it arrived, for that person, in that chat.
import { admin } from '@/lib/pushAdmin';
import { readReplyToken } from '@/lib/replyToken';

export const runtime = 'nodejs';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }
  const pass = readReplyToken(body?.token);
  if (!pass?.chatId) return Response.json({ error: 'Not a chat pass.' }, { status: 401 });

  const a = await admin();
  if (a.error) return Response.json({ error: a.error }, { status: 503 });

  const ref = a.db.collection('chats').doc(pass.chatId);
  const chat = await ref.get().catch(() => null);
  if (!chat?.exists || !(chat.data().members || []).includes(pass.email)) return Response.json({ error: 'No such chat.' }, { status: 404 });
  await ref.update(new a.FieldPath('deliveredAt', pass.email), a.FieldValue.serverTimestamp()).catch(() => {});
  return Response.json({ ok: true });
}
