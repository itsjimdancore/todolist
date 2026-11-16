'use client';
// Voice and video calls between the chat's two members, straight from browser to browser (WebRTC).
// Firestore only carries the setup: chats/{chatId}/calls/{callId} holds the offer and answer, and the two
// sub-collections callerCandidates / calleeCandidates the network routes each side finds. firestore.rules has
// the steps: ringing → accepted → ended, or ringing → declined | busy | missed. The relay details come from
// /api/turn. CallSession below runs one call; the call screens (CallScreen, IncomingCall) show it.
import {
  FieldPath, addDoc, collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { emailOf, nameOf } from './data';
import { fb } from './firebase';
import { toDate } from './people';

export const RING_MS = 45 * 1000; // unanswered this long: missed (firestore.rules lets either side mark it then)
const ANSWER_WINDOW_MS = 60 * 1000; // firestore.rules refuses an answer later than this
const RESTART_AFTER_MS = 3000; // a dropped connection gets this long to come back by itself before a restart
const GIVE_UP_MS = 25 * 1000; // still not back after this long: the call ends
const CONNECT_MS = 20 * 1000; // answered but never connected after this long: the networks can't reach each other
export const NO_CONNECT = "Couldn't connect the call. Calls work best when at least one of you is on Wi-Fi.";

// On mobile data? Only Chrome on Android can tell; elsewhere this is false (unknown).
export const onMobileData = () => typeof navigator !== 'undefined' && navigator.connection?.type === 'cellular';
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
const VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 24 } };
const VIDEO_BITRATE = 500_000; // about 4 MB a minute
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

const db = () => fb().db;
const callsCol = (chatId) => collection(db(), 'chats', chatId, 'calls');
const callRef = (chatId, id) => doc(db(), 'chats', chatId, 'calls', id);
const msgsCol = (chatId) => collection(db(), 'chats', chatId, 'messages');
const ms = (ts) => (ts ? toDate(ts).getTime() : 0);
const pad = (n) => String(n).padStart(2, '0');
export const callClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

// ---------- words ----------
const KIND = { voice: 'Voice call', video: 'Video call' };
// the line in the chat, for the person reading it: the caller sees "Voice call · No answer",
// the person called "Missed voice call". c: the message's call map, mine: I made the call
export function callText(c, mine) {
  const kind = KIND[c.kind] || 'Call';
  if (c.status === 'ended') return c.duration > 0 ? `${kind} · ${callClock(c.duration)}` : kind;
  if (c.status === 'failed') return `${kind} · Couldn't connect`;
  if (mine) return `${kind} · ${c.status === 'declined' ? 'Declined' : c.status === 'busy' ? 'Busy' : 'No answer'}`;
  return c.status === 'declined' ? `Declined ${kind.toLowerCase()}` : `Missed ${kind.toLowerCase()}`;
}
// the chat list's preview, the same for both
export function callPreview(c) {
  const icon = c.kind === 'video' ? '📹' : '📞';
  return c.status === 'ended' || c.status === 'failed' ? `${icon} ${KIND[c.kind]}` : `${icon} Missed ${KIND[c.kind].toLowerCase()}`;
}

// ---------- relay details ----------
let iceCache = null; // { servers, until }
export async function iceServers() {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const token = await fb().auth.currentUser?.getIdToken();
    const res = await fetch('/api/turn', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok || !Array.isArray(body.iceServers) || !body.iceServers.length) throw new Error(body.error || 'no relay');
    // reused for a while, well inside the passwords' lifetime
    iceCache = { servers: body.iceServers, until: Date.now() + (body.relay ? Math.min(body.ttl || 3600, 3600) * 500 : 5 * 60 * 1000) };
    return body.iceServers;
  } catch {
    return STUN_ONLY;
  }
}

// ---------- the call document ----------
// calls ringing for me in this chat (live), newest first
export function watchRinging(chatId, email, onData) {
  return onSnapshot(query(callsCol(chatId), where('to', '==', email), where('status', '==', 'ringing')),
    (s) => onData(s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt))),
    () => onData([]));
}
// still answerable (the caller may have closed the app without giving up)
export const isFresh = (call) => Date.now() - ms(call.createdAt) < RING_MS;

// Device notifications (/api/push): 'call' rings the other person's phone or computer, even with the app closed;
// 'callEnd' takes that ringing notification away again (or leaves "Missed voice call" in its place)
export function pushCall(chatId, callId, kind = 'call') {
  const me = fb().auth.currentUser;
  if (!me) return;
  me.getIdToken()
    .then((token) => fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ [kind]: { chatId, callId } }),
      keepalive: true,
    }))
    .catch(() => {});
}

const finishFields = (status, me) => ({ status, endedAt: serverTimestamp(), endedBy: me });
export const declineCall = (chatId, callId, user, busy = false) =>
  updateDoc(callRef(chatId, callId), finishFields(busy ? 'busy' : 'declined', emailOf(user))).then(() => pushCall(chatId, callId, 'callEnd'));
export const markMissed = (chatId, callId, user) =>
  updateDoc(callRef(chatId, callId), finishFields('missed', emailOf(user))).then(() => pushCall(chatId, callId, 'callEnd'));

// The caller puts the finished call in the chat ("Voice call · 4:12", "Missed video call"), once
export async function logCall(chatId, user, call, duration = 0) {
  const me = emailOf(user);
  const c = { callId: call.id, kind: call.kind, status: call.status, duration: Math.min(21600, Math.max(0, Math.round(duration))) };
  const b = writeBatch(db());
  b.set(doc(msgsCol(chatId)), { from: me, text: '', call: c, createdAt: serverTimestamp() });
  b.update(doc(db(), 'chats', chatId),
    'last', { text: callPreview(c), from: me, at: serverTimestamp() },
    new FieldPath('readAt', me), serverTimestamp(),
    new FieldPath('names', me), nameOf(user).slice(0, 120));
  b.update(callRef(chatId, call.id), { logged: true });
  await b.commit();
}

// my calls that ended without a line in the chat (the app was closed before it could add one)
export async function logMissing(chatId, user) {
  const s = await getDocs(query(callsCol(chatId), where('from', '==', emailOf(user)), where('status', 'in', ['missed', 'declined', 'busy', 'ended'])));
  for (const d of s.docs) {
    const call = { id: d.id, ...d.data() };
    if (call.logged) continue;
    const secs = call.status === 'ended' && call.answeredAt && call.endedAt ? (ms(call.endedAt) - ms(call.answeredAt)) / 1000 : 0;
    await logCall(chatId, user, call, secs).catch(() => {});
  }
}

// a route found: plain fields only (Firestore refuses undefined)
const candidateDoc = (c) => {
  const j = c.toJSON();
  return {
    candidate: j.candidate || '', sdpMid: j.sdpMid ?? null, sdpMLineIndex: j.sdpMLineIndex ?? null,
    usernameFragment: j.usernameFragment ?? null, createdAt: serverTimestamp(),
  };
};

// Why the microphone or camera couldn't start, in words
export function mediaError(e, kind) {
  const what = kind === 'video' ? 'camera and microphone' : 'microphone';
  if (!navigator.mediaDevices?.getUserMedia) return "Calls aren't supported in this browser.";
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
    return `The ${what} ${kind === 'video' ? 'are' : 'is'} blocked. Allow ${kind === 'video' ? 'them' : 'it'} for this site in your browser's settings, then try again.`;
  }
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return `No ${what} found on this device.`;
  if (e?.name === 'NotReadableError') return `Another app is using the ${what}. Close it and try again.`;
  return `Couldn't start the ${what}.`;
}

// ---------- one call ----------
// state.phase: 'starting' | 'ringing' (calling them) | 'connecting' | 'connected' | 'reconnecting' | 'ended'
// state.end: why it ended: 'hung-up' | 'ended' (they hung up) | 'declined' | 'busy' | 'missed' | 'failed' | 'error'
export class CallSession {
  constructor({ chatId, user, other, kind, role, onChange }) {
    Object.assign(this, { chatId, user, other, kind, role, onChange });
    this.me = emailOf(user);
    this.id = null;
    this.call = null; // the call document, as last seen
    this.pc = null;
    this.local = null;
    this.remote = new MediaStream();
    this.unsubs = [];
    this.timers = [];
    this.pendingRemote = []; // routes from them that arrived before their description
    this.pendingLocal = []; // my routes found before the call document exists
    this.docReady = false;
    this.connectedAt = 0;
    this.state = { phase: 'starting', end: null, error: '', muted: false, cameraOn: kind === 'video', facing: 'user', connectedAt: 0, relay: false };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange?.(this.state, this);
  }

  async media() {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: this.kind === 'video' ? { ...VIDEO, facingMode: 'user' } : false });
    this.set({});
  }

  async connect() {
    const servers = await iceServers();
    this.set({ relay: servers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))) });
    const pc = new RTCPeerConnection({ iceServers: servers });
    this.pc = pc;
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local));
    pc.ontrack = (e) => {
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      this.set({});
    };
    const mine = this.role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const d = candidateDoc(e.candidate);
      if (this.docReady) addDoc(collection(callRef(this.chatId, this.id), mine), d).catch(() => {});
      else this.pendingLocal.push(d);
    };
    pc.onconnectionstatechange = () => this.onConnection();
  }

  flushLocal() {
    this.docReady = true;
    const mine = this.role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    this.pendingLocal.splice(0).forEach((d) => addDoc(collection(callRef(this.chatId, this.id), mine), d).catch(() => {}));
  }

  // their routes, as they find them
  watchRemoteCandidates() {
    const theirs = this.role === 'caller' ? 'calleeCandidates' : 'callerCandidates';
    this.unsubs.push(onSnapshot(collection(callRef(this.chatId, this.id), theirs), (s) => {
      s.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const c = ch.doc.data();
        const init = { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment ?? undefined };
        if (this.pc?.remoteDescription) this.pc.addIceCandidate(init).catch(() => {});
        else this.pendingRemote.push(init);
      });
    }));
  }

  flushRemote() {
    this.pendingRemote.splice(0).forEach((c) => this.pc.addIceCandidate(c).catch(() => {}));
  }

  // answered, but the two networks may not be able to reach each other (no relay): give it CONNECT_MS
  armConnectTimer() {
    if (this.connectTimer) return;
    this.connectTimer = setTimeout(() => {
      if (!this.connectedAt && this.state.phase !== 'ended') { this.set({ error: NO_CONNECT }); this.hangUp('failed'); }
    }, CONNECT_MS);
    this.timers.push(this.connectTimer);
  }

  // video: modest quality, so a call doesn't eat mobile data
  capVideo() {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const p = sender.getParameters();
    if (!p.encodings?.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = VIDEO_BITRATE;
    p.encodings[0].maxFramerate = 24;
    sender.setParameters(p).catch(() => {});
  }

  // ---- I call them
  async start() {
    try {
      await this.media();
    } catch (e) {
      this.set({ phase: 'ended', end: 'error', error: mediaError(e, this.kind) });
      return this;
    }
    try {
      this.id = doc(callsCol(this.chatId)).id;
      await this.connect();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await setDoc(callRef(this.chatId, this.id), {
        from: this.me, to: this.other, kind: this.kind, status: 'ringing',
        offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp(),
      });
      this.flushLocal();
      pushCall(this.chatId, this.id, 'call'); // ring their phone or computer, even with the app closed
      this.capVideo();
      this.set({ phase: 'ringing' });
      this.watchRemoteCandidates();
      this.watchCall();
      // nobody answers: missed
      this.timers.push(setTimeout(() => {
        if (this.call?.status === 'ringing' || (!this.call && this.state.phase === 'ringing')) this.hangUp('missed');
      }, RING_MS));
    } catch (e) {
      this.set({ phase: 'ended', end: 'error', error: "The call couldn't start. Check your connection and try again." });
      this.cleanup();
    }
    return this;
  }

  // ---- they call me: call is the ringing call document
  async answer(call) {
    this.id = call.id;
    this.call = call;
    if (Date.now() - ms(call.createdAt) > ANSWER_WINDOW_MS) {
      this.set({ phase: 'ended', end: 'missed', error: 'This call has ended.' });
      return this;
    }
    try {
      await this.media();
    } catch (e) {
      this.set({ phase: 'ended', end: 'error', error: mediaError(e, this.kind) });
      // tell them, so their screen doesn't keep ringing
      declineCall(this.chatId, this.id, this.user).catch(() => {});
      return this;
    }
    try {
      this.set({ phase: 'connecting' });
      await this.connect();
      this.docReady = true;
      this.watchRemoteCandidates();
      await this.pc.setRemoteDescription(call.offer);
      this.lastOffer = call.offer.sdp;
      this.flushRemote();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await updateDoc(callRef(this.chatId, this.id), { status: 'accepted', answer: { type: answer.type, sdp: answer.sdp }, answeredAt: serverTimestamp() });
      pushCall(this.chatId, this.id, 'callEnd'); // my other devices stop ringing
      this.capVideo();
      this.armConnectTimer();
      this.watchCall();
    } catch (e) {
      this.set({ phase: 'ended', end: 'error', error: 'This call has ended, or couldn\'t be answered.' });
      this.cleanup();
    }
    return this;
  }

  watchCall() {
    this.unsubs.push(onSnapshot(callRef(this.chatId, this.id), async (s) => {
      if (!s.exists()) return;
      const c = { id: s.id, ...s.data({ serverTimestamps: 'estimate' }) };
      this.call = c;
      if (['declined', 'busy', 'missed', 'ended'].includes(c.status)) {
        if (this.state.phase !== 'ended') this.finish(c.endedBy === this.me ? 'hung-up' : c.status);
        return;
      }
      try {
        if (this.role === 'caller' && c.answer && c.answer.sdp !== this.lastAnswer && this.pc?.signalingState === 'have-local-offer') {
          this.lastAnswer = c.answer.sdp;
          await this.pc.setRemoteDescription(c.answer);
          this.flushRemote();
          if (this.state.phase === 'ringing') this.set({ phase: 'connecting' });
          this.armConnectTimer();
        }
        // a new offer while connected: the caller is restarting the connection
        if (this.role === 'callee' && c.status === 'accepted' && c.offer.sdp !== this.lastOffer && this.pc?.signalingState === 'stable') {
          this.lastOffer = c.offer.sdp;
          await this.pc.setRemoteDescription(c.offer);
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          await updateDoc(callRef(this.chatId, this.id), { answer: { type: answer.type, sdp: answer.sdp } });
        }
      } catch { /* the next snapshot or the restart timer tries again */ }
    }));
  }

  onConnection() {
    const st = this.pc?.connectionState;
    if (!st || this.state.phase === 'ended') return;
    if (st === 'connected') {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      if (!this.connectedAt) this.connectedAt = Date.now();
      this.set({ phase: 'connected', connectedAt: this.connectedAt });
    } else if (st === 'disconnected' || st === 'failed') {
      if (!this.connectedAt) { if (st === 'failed') { this.set({ error: NO_CONNECT }); this.hangUp('failed'); } return; }
      this.set({ phase: 'reconnecting' });
      // the caller restarts the routes if it doesn't come back by itself
      if (this.role === 'caller') this.timers.push(setTimeout(() => this.restart(), st === 'failed' ? 0 : RESTART_AFTER_MS));
      this.timers.push(setTimeout(() => { if (this.pc?.connectionState !== 'connected') this.hangUp('failed'); }, GIVE_UP_MS));
    }
  }

  async restart() {
    if (!this.pc || this.pc.connectionState === 'connected' || this.state.phase === 'ended') return;
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      await updateDoc(callRef(this.chatId, this.id), { offer: { type: offer.type, sdp: offer.sdp } });
    } catch { /* gives up at GIVE_UP_MS */ }
  }

  // ---- controls
  setMuted(muted) {
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.set({ muted });
  }

  setCamera(on) {
    this.local?.getVideoTracks().forEach((t) => { t.enabled = on; });
    this.set({ cameraOn: on });
  }

  // front ↔ back camera (phones)
  async switchCamera() {
    const facing = this.state.facing === 'user' ? 'environment' : 'user';
    const old = this.local?.getVideoTracks()[0];
    if (!old) return;
    try {
      old.stop(); // some phones can't open both cameras at once
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: { exact: facing } } });
      const track = s.getVideoTracks()[0];
      track.enabled = this.state.cameraOn;
      await this.pc?.getSenders().find((x) => x.track?.kind === 'video' || x.track === old)?.replaceTrack(track);
      this.local.removeTrack(old);
      this.local.addTrack(track);
      this.set({ facing });
    } catch {
      // only one camera, or it wouldn't switch: back to the one we had
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: this.state.facing } });
        const track = s.getVideoTracks()[0];
        await this.pc?.getSenders().find((x) => x.track === old || x.track?.kind === 'video')?.replaceTrack(track);
        this.local.removeTrack(old);
        this.local.addTrack(track);
        this.set({});
      } catch { /* the call carries on without video */ }
    }
  }

  // I end it: before they answer it's missed (caller) or declined (callee); after, ended
  async hangUp(why = 'hung-up') {
    if (this.state.phase === 'ended') return;
    const status = this.call?.status;
    try {
      if (this.id && (status === 'ringing' || (!status && this.role === 'caller'))) {
        await updateDoc(callRef(this.chatId, this.id), finishFields(this.role === 'caller' ? 'missed' : 'declined', this.me));
        pushCall(this.chatId, this.id, 'callEnd');
      } else if (this.id && status === 'accepted') {
        await updateDoc(callRef(this.chatId, this.id), finishFields('ended', this.me));
      }
    } catch { /* it ends here either way; the other side's connection drops */ }
    this.finish(why);
  }

  async finish(end) {
    if (this.state.phase === 'ended') return;
    const secs = this.connectedAt ? (Date.now() - this.connectedAt) / 1000 : 0;
    this.set({ phase: 'ended', end });
    this.cleanup();
    if (this.role !== 'caller' || !this.id) return;
    // the caller puts it in the chat, then clears the routes (they hold IP addresses)
    // declined / busy / missed as they said; otherwise an answered call ended, and one never answered was missed
    const answered = !!(this.connectedAt || this.call?.answer);
    const status = ['declined', 'busy', 'missed'].includes(end) ? end
      : end === 'failed' && !this.connectedAt && answered ? 'failed' : answered ? 'ended' : 'missed';
    try {
      if (end === 'failed' && this.call?.status === 'accepted') await updateDoc(callRef(this.chatId, this.id), finishFields('ended', this.me)).catch(() => {});
      await logCall(this.chatId, this.user, { id: this.id, kind: this.kind, status }, secs);
    } catch { /* logMissing adds it the next time the chat opens */ }
    for (const side of ['callerCandidates', 'calleeCandidates']) {
      getDocs(collection(callRef(this.chatId, this.id), side))
        .then((s) => { const b = writeBatch(db()); s.docs.forEach((d) => b.delete(d.ref)); return s.size ? b.commit() : null; })
        .catch(() => {});
    }
  }

  cleanup() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.unsubs.splice(0).forEach((u) => u());
    this.local?.getTracks().forEach((t) => t.stop());
    try { this.pc?.close(); } catch { /* already closed */ }
  }
}
