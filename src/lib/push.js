// Device notifications: turning them on and off for this browser / phone.
// Call these only in the browser. enablePush must run from a click (browsers only ask for
// permission in answer to something the person did).
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { fb } from './firebase';
import { removePushToken, savePushToken } from './data';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
const STORE = 'pushToken'; // this device's token, so we can refresh or remove it

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const stored = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
const remember = (t) => { try { t ? localStorage.setItem(STORE, t) : localStorage.removeItem(STORE); } catch {} };

// Who turned them on on this device. It's each person's own setting, so it stays as they left it
// through signing out and back in, closing the app or the browser, until they switch it themselves.
// null = never recorded (from before this was kept), anything else is a list of uids.
const ON_FOR = 'pushOnFor';
function onFor() {
  try { const v = JSON.parse(localStorage.getItem(ON_FOR)); return Array.isArray(v) ? v : null; } catch { return null; }
}
function setOnFor(uid, on) {
  const list = (onFor() || []).filter((u) => u !== uid);
  if (on) list.push(uid);
  try { localStorage.setItem(ON_FOR, JSON.stringify(list)); } catch {}
  return list;
}

// A short name for this device, shown nowhere yet but handy when looking at the data
function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIOS() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

// 'on' | 'off' | 'blocked' | 'unsupported' | 'ios-needs-home-screen' | 'not-set-up'
export async function pushState(user) {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return isIOS() && !installed() ? 'ios-needs-home-screen' : 'unsupported';
  }
  if (!(await isSupported().catch(() => false))) return isIOS() && !installed() ? 'ios-needs-home-screen' : 'unsupported';
  if (!VAPID_KEY) return 'not-set-up';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  // The browser's own push subscription: it survives closing the app or the browser and signing out,
  // and is only dropped when the last person who turned them on here turns them off (or site data is cleared)
  if (!stored() && !(await subscribed())) return 'off';
  if (!user) return 'on';
  const list = onFor();
  if (list === null) { setOnFor(user.uid, true); return 'on'; } // turned on before this was kept: it was theirs
  return list.includes(user.uid) ? 'on' : 'off';
}

// Whether the notification helper on this device still holds a push subscription
async function subscribed() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return !!(reg && (await reg.pushManager.getSubscription()));
  } catch {
    return false;
  }
}

async function token() {
  const reg = await navigator.serviceWorker.register('/push-sw.js', { updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(fb().app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
}

// What went wrong while turning them on, in words (shown in the toast)
function why(step, e) {
  const code = e?.code || '';
  if (code.includes('permission-blocked') || code.includes('permission-default')) return 'Notifications are blocked for this site in the browser settings.';
  if (code.includes('failed-service-worker-registration')) return "The browser wouldn't start the app's notification helper. Reload the page and try again.";
  if (code.includes('token-subscribe-failed') || code.includes('token-unsubscribe-failed')) return 'Firebase refused this device (check the VAPID key and that the Firebase Cloud Messaging API is enabled).';
  if (code === 'permission-denied') return "Couldn't save this device to your account (Firestore rules).";
  return `Couldn't ${step}${code ? ` (${code})` : ''}. Try again, or try another browser.`;
}

// Ask, then save this device's token. Returns the new state; throws an Error saying why it failed.
export async function enablePush(user) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  let t;
  try { t = await token(); } catch (e) { throw new Error(why('get a notification address for this device', e)); }
  if (!t) throw new Error(why('get a notification address for this device'));
  const old = stored();
  if (old && old !== t) await removePushToken(old).catch(() => {});
  try { await savePushToken(user, t, deviceName()); } catch (e) { throw new Error(why('save this device', e)); }
  remember(t);
  setOnFor(user.uid, true);
  return 'on';
}

// "Send a test notification": to every device turned on for my account. Returns how many got it.
export async function sendTestPush(user) {
  const res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `The server couldn't send it (${res.status}).`);
  return body.sent;
}

// This device's token, if it has one (looked up again if the saved copy went missing)
async function currentToken() {
  return stored() || ((await subscribed()) ? await token().catch(() => null) : null);
}

// The switch, turned off by this person. The device stays subscribed while someone else who uses it
// still has them on (they just won't get this person's), and is unsubscribed once nobody does.
export async function disablePush(user) {
  const left = user ? setOnFor(user.uid, false) : [];
  const t = await currentToken();
  if (!t) return 'off'; // never turned on here
  await removePushToken(t).catch(() => {});
  if (left.length) return 'off';
  remember(null);
  try { await deleteToken(getMessaging(fb().app)); } catch {}
  // and drop the browser's subscription itself, so it reads as off next time the app opens
  try { await (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.unsubscribe(); } catch {}
  return 'off';
}

// Signing out: this device stops getting my notifications while nobody's signed in (and the next person
// on it never gets mine), but my setting stays on; signing in again picks it straight back up (refreshPush)
export async function pausePush() {
  const t = await currentToken();
  if (t) await removePushToken(t).catch(() => {});
}

// When the app opens or someone signs in with notifications on for them here: save this device to their
// account again (after signing out, or if the token changed, which happens now and then)
export async function refreshPush(user) {
  if ((await pushState(user)) !== 'on') return;
  const t = await token().catch(() => null);
  if (!t) return;
  const old = stored();
  if (old && old !== t) await removePushToken(old).catch(() => {});
  await savePushToken(user, t, deviceName()).catch(() => {});
  remember(t);
}
