// Server only: sends device notifications for notification docs that have just been created and claimed
// (activity/{id} or invites/{id}). Used by /api/push (after a change in the app) and /api/reply (after a reply
// typed into a notification). Each person's Notification settings, rate limit and dead-device clean-up apply.
import { createHash } from 'node:crypto';
import { notifyGroup, pushMessage, wantsPush } from '@/lib/activityText';
import { DEAD_TOKEN } from '@/lib/pushAdmin';
import { makeReplyToken } from '@/lib/replyToken';

const RATE_MS = 10 * 1000; // at most one device notification per sender, per list, per person every 10 seconds

// a: admin(); items: [{ col, id, doc }]; origin: where the links should open; senderEmail: who caused them
export async function deliver(a, items, origin, senderEmail) {
  let sent = 0;
  // each person's Notification settings (users/{uid}.notify), read once
  const prefs = new Map();
  const prefsOf = async (uid) => {
    if (!prefs.has(uid)) prefs.set(uid, await a.db.collection('users').doc(uid).get().then((s) => s.data()?.notify || {}).catch(() => ({})));
    return prefs.get(uid);
  };
  for (const { col, id, doc } of items) {
    const kind = col === 'invites' ? 'share' : doc.kind;
    const msg = pushMessage(doc, kind);
    if (!msg) continue;
    const tokens = await a.db.collection('pushTokens').where('email', '==', doc.to).get();
    if (tokens.empty) continue;
    // only the devices of people who still want this kind of notification
    const wanted = [];
    for (const t of tokens.docs) if (wantsPush(await prefsOf(t.data().uid), kind)) wanted.push(t.id);
    if (!wanted.length) continue;
    // rate limit (pushRate/* is only used here: the rules give the app no access to it)
    const rateRef = a.db.collection('pushRate').doc(createHash('sha1').update(`${senderEmail}|${doc.listId}|${doc.to}`).digest('hex'));
    const allowed = await a.db.runTransaction(async (tx) => {
      const r = await tx.get(rateRef);
      if (r.exists && Date.now() - (r.data().at || 0) < RATE_MS) return false;
      tx.set(rateRef, { at: Date.now() });
      return true;
    }).catch(() => true);
    if (!allowed) continue;
    const group = notifyGroup(kind);
    // a new or edited comment can be answered: a Reply button (with a text box where the system has one), and
    // tapping it opens the list on its comments with the box ready. The pass lets a reply typed into the
    // notification itself be posted by /api/reply.
    const canReply = kind === 'comment' || kind === 'comment-edit';
    const replyToken = canReply ? makeReplyToken({ email: doc.to, listId: doc.listId, activityId: id }) : null;
    const res = await a.messaging.sendEachForMulticast({
      tokens: wanted,
      // repeated ones of the same type on one list replace each other; only comments alert again
      data: {
        title: msg.title, body: msg.body, link: `${origin}/?list=${doc.listId}${canReply ? '&reply=1' : ''}`,
        tag: `list-${doc.listId}-${group}`, renotify: group === 'comments' ? '1' : '', reply: canReply ? '1' : '',
        ...(replyToken ? { replyToken, replyUrl: `${origin}/api/reply`, replyTo: (doc.fromName || doc.fromEmail || '').slice(0, 60) } : {}),
      },
      webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } },
    }).catch(() => null);
    if (!res) continue;
    sent += res.successCount;
    // forget devices that have gone away (app uninstalled, permission withdrawn…)
    await Promise.all(res.responses.map((r, i) =>
      !r.success && DEAD_TOKEN.has(r.error?.code) ? a.db.collection('pushTokens').doc(wanted[i]).delete().catch(() => {}) : null));
  }
  return sent;
}
