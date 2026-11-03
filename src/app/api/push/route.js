// Sends device notifications (phone notification bar, Windows / Mac notification centre).
// The app calls this right after saving a change that wrote notifications (activity/{id}, invites/{id}).
// It only pushes notifications the caller just created themselves, each one once, to the devices of
// the person it's for. Needs FIREBASE_SERVICE_ACCOUNT (the service-account JSON) set on the server.
import { admin, caller as whoIs } from '@/lib/pushAdmin';
import { deliver } from '@/lib/pushSend';

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
  const sent = await deliver(a, claimed, new URL(req.url).origin, myEmail);

  return Response.json({ sent });
}
