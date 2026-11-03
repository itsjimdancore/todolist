// Sends device notifications (phone notification bar, Windows / Mac notification centre).
// The app calls this right after saving a change that wrote notifications (activity/{id}, invites/{id}).
// It only pushes notifications the caller just created themselves, each one once, to the devices of
// the person it's for. Needs FIREBASE_SERVICE_ACCOUNT (the service-account JSON) set on the server.
import { createHash } from 'node:crypto';
import { notifyGroup, pushMessage, wantsPush } from '@/lib/activityText';
import { admin, caller as whoIs, DEAD_TOKEN } from '@/lib/pushAdmin';

export const runtime = 'nodejs';

const MAX_IDS = 50;
const FRESH_MS = 2 * 60 * 1000; // only notifications made in the last 2 minutes
const RATE_MS = 10 * 1000; // at most one device notification per sender, per list, per person every 10 seconds

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
    if (doc) claimed.push({ col, doc });
  }

  // clicking it opens the app where it was used (the live site, or localhost while trying it out)
  const origin = new URL(req.url).origin;
  let sent = 0;
  // each person's Notification settings (users/{uid}.notify), read once per request
  const prefs = new Map();
  const prefsOf = async (uid) => {
    if (!prefs.has(uid)) prefs.set(uid, await a.db.collection('users').doc(uid).get().then((s) => s.data()?.notify || {}).catch(() => ({})));
    return prefs.get(uid);
  };
  for (const { col, doc } of claimed) {
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
    const rateRef = a.db.collection('pushRate').doc(createHash('sha1').update(`${myEmail}|${doc.listId}|${doc.to}`).digest('hex'));
    const allowed = await a.db.runTransaction(async (tx) => {
      const r = await tx.get(rateRef);
      if (r.exists && Date.now() - (r.data().at || 0) < RATE_MS) return false;
      tx.set(rateRef, { at: Date.now() });
      return true;
    }).catch(() => true);
    if (!allowed) continue;
    const list = wanted;
    const group = notifyGroup(kind);
    // a new or edited comment can be answered: it gets a Reply button, and opens on the comments with the box ready
    const canReply = kind === 'comment' || kind === 'comment-edit';
    const res = await a.messaging.sendEachForMulticast({
      tokens: list,
      // repeated ones of the same type on one list replace each other; only comments alert again
      data: {
        title: msg.title, body: msg.body, link: `${origin}/?list=${doc.listId}${canReply ? '&reply=1' : ''}`,
        tag: `list-${doc.listId}-${group}`, renotify: group === 'comments' ? '1' : '', reply: canReply ? '1' : '',
      },
      webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } },
    }).catch(() => null);
    if (!res) continue;
    sent += res.successCount;
    // forget devices that have gone away (app uninstalled, permission withdrawn…)
    await Promise.all(res.responses.map((r, i) =>
      !r.success && DEAD_TOKEN.has(r.error?.code) ? a.db.collection('pushTokens').doc(list[i]).delete().catch(() => {}) : null));
  }

  return Response.json({ sent });
}
