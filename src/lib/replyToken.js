// Server only. The "reply pass" a comment's device notification carries, so a reply typed straight into the
// notification (Windows, Android, ChromeOS… where the system shows a text box) can be posted without opening
// the app. The notification's code can't use the person's sign-in, so the pass stands in for it — narrowly:
//   • for one person (the email the notification was for), on one list, answering one notification
//   • for 7 days
//   • signed with a server-only secret, so it can't be made up or changed
// /api/reply still checks, when it's used, that the person can comment on that list right now.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const DAYS = 7;

// REPLY_SECRET if it's set, otherwise derived from the service-account key (already a server-only secret)
function secret() {
  const own = (process.env.REPLY_SECRET || '').trim();
  const base = own || (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!base) return null;
  return createHash('sha256').update(`shared-todo-reply-v1|${base}`).digest();
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body, key) => createHmac('sha256', key).update(body).digest();

// { email, listId, activityId } (a comment) or { email, chatId } (a chat message) → "body.signature", or null if the server has no secret
export function makeReplyToken({ email, listId = '', activityId = '', chatId = '' }) {
  const key = secret();
  if (!key) return null;
  const body = b64(JSON.stringify({ e: email, l: listId || '', a: activityId || '', ...(chatId ? { c: chatId } : {}), x: Date.now() + DAYS * 86400000 }));
  return `${body}.${b64(sign(body, key))}`;
}

// → { email, listId, activityId, chatId } if the pass is genuine and not expired, else null
export function readReplyToken(token) {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = sign(body, key);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.e !== 'string' || typeof p.l !== 'string' || !(p.x > Date.now())) return null;
  return { email: p.e, listId: p.l, activityId: typeof p.a === 'string' ? p.a : '', chatId: typeof p.c === 'string' ? p.c : '' };
}
