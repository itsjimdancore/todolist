// Relay details for a call (WebRTC ICE servers). Two phones on mobile data often can't reach each other directly,
// because the carrier shares one public address between many customers; the call then goes through Cloudflare's
// TURN relay. This hands out short-lived relay passwords, only to someone signed in who is in a chat.
// Needs CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN on the server (Cloudflare dashboard → Realtime → TURN).
// Without them it still answers, with STUN only: calls then connect on most Wi-Fi, but not between two carriers.
import { admin, caller as whoIs } from '@/lib/pushAdmin';

export const runtime = 'nodejs';

const STUN = { urls: ['stun:stun.cloudflare.com:3478'] };
const TTL = 6 * 3600; // seconds: longer than any call (the chat's calls are capped at 6 hours)
// Browsers block port 53, so a relay address on it only times out (Cloudflare's advice). Exactly :53, not :5349.
const PORT_53 = /:53(?:\?|$)/;

export async function POST(req) {
  const a = await admin();
  if (a.error) return Response.json({ error: a.error }, { status: 503 });
  const me = await whoIs(a, req);
  const email = (me?.email || '').toLowerCase();
  if (!email) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  // only people who have a chat to call in
  const chats = await a.db.collection('chats').where('members', 'array-contains', email).limit(1).get().catch(() => null);
  if (!chats || chats.empty) return Response.json({ error: 'Calls are for people in a chat.' }, { status: 403 });

  const keyId = (process.env.CLOUDFLARE_TURN_KEY_ID || '').trim();
  const token = (process.env.CLOUDFLARE_TURN_API_TOKEN || '').trim();
  if (!keyId || !token) return Response.json({ iceServers: [STUN], relay: false }, { headers: { 'Cache-Control': 'no-store' } });

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const iceServers = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && !PORT_53.test(u)) }))
      .filter((s) => s.urls.length);
    if (!iceServers.some((s) => s.urls.some((u) => u.startsWith('turn')))) throw new Error('no relay in the answer');
    return Response.json({ iceServers, relay: true, ttl: TTL }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // the call can still try a direct connection
    console.error('TURN credentials:', e?.message || e);
    return Response.json({ iceServers: [STUN], relay: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
