// Server only: Firebase Admin for sending device notifications (/api/push, /api/push/test).
// Needs FIREBASE_SERVICE_ACCOUNT: the whole service-account JSON file, pasted as one value.
// firebase-admin is loaded on first use (not imported at the top), so if it can't load on the server
// the routes still answer with a message saying why, instead of a bare 500.

let ready = null; // { auth, db, messaging, FieldValue } once set up
let setupError = null;

// { auth, db, messaging, FieldValue }, or { error } saying what's wrong on the server
export async function admin() {
  if (ready) return ready;
  if (setupError) return { error: setupError };

  let mods;
  try {
    const [app, auth, firestore, messaging] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/auth'),
      import('firebase-admin/firestore'),
      import('firebase-admin/messaging'),
    ]);
    mods = { app, auth, firestore, messaging };
  } catch (e) {
    // not cached: a later request might load fine
    return { error: `The server couldn't load Firebase Admin (${e?.message || e}). It needs Node 22 or newer (running ${process.version}).` };
  }

  if (!mods.app.getApps().length) {
    let raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (!raw) return { error: 'Device notifications are not set up on the server (FIREBASE_SERVICE_ACCOUNT is empty).' };
    // pasted with quotes around it
    if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"') && !raw.startsWith('"{'))) raw = raw.slice(1, -1);
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      setupError = 'FIREBASE_SERVICE_ACCOUNT on the server is not valid JSON. Paste the whole downloaded key file as its value.';
      return { error: setupError };
    }
    // the key's line breaks often arrive as the two characters "\n"
    if (typeof json.private_key === 'string') json.private_key = json.private_key.replace(/\\n/g, '\n');
    try {
      mods.app.initializeApp({ credential: mods.app.cert(json) });
    } catch (e) {
      setupError = `FIREBASE_SERVICE_ACCOUNT on the server isn't a usable service-account key (${e.code || e.message}).`;
      return { error: setupError };
    }
  }

  try {
    ready = {
      auth: mods.auth.getAuth(),
      db: mods.firestore.getFirestore(),
      messaging: mods.messaging.getMessaging(),
      FieldValue: mods.firestore.FieldValue,
      FieldPath: mods.firestore.FieldPath,
    };
  } catch (e) {
    return { error: `Firebase Admin couldn't start (${e.code || e.message}).` };
  }
  return ready;
}

export const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

// Who's calling, from "Authorization: Bearer <Firebase ID token>"; null if not signed in
export async function caller(a, req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  try {
    return await a.auth.verifyIdToken(bearer);
  } catch {
    return null;
  }
}
