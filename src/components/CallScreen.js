'use client';
import { useEffect, useRef, useState } from 'react';
import { callClock, onMobileData } from '@/lib/calls';
import { watchPerson } from '@/lib/data';
import { Avatar } from '@/lib/people';

const ICONS = {
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" /></>,
  end: <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.2 2.6-3.6-1.5.3-2.6a12 12 0 0 0-7 0l.3 2.6-3.6 1.5z" fill="currentColor" stroke="none" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></>,
  videoOff: <><path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1M9 5h5a2 2 0 0 1 2 2v3l6-3v10M3 3l18 18" /></>,
  flip: <><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" /><path d="m7 11 3-3 3 3M17 13l-3 3-3-3" /></>,
  speaker: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
};
export function CallIcon({ name, size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
  );
}

// A tone made in the browser (no sound file). 'ring': two soft beeps, twice, every 3 seconds, and a vibration
// (incoming); 'back': one long low tone every 3 seconds (the caller hears it while it rings). Browsers only allow
// sound once the page has been tapped, so it can be silent right after the app opens.
export function useTone(on, pattern = 'ring') {
  useEffect(() => {
    if (!on) return undefined;
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return undefined; }
    const beep = (at, freq, len, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.02);
      g.gain.setValueAtTime(vol, at + len - 0.05);
      g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + len + 0.02);
    };
    const play = () => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t = ctx.currentTime + 0.05;
      if (pattern === 'ring') {
        [0, 0.5].forEach((d) => { beep(t + d, 880, 0.35, 0.12); beep(t + d, 1320, 0.35, 0.05); });
        navigator.vibrate?.([400, 200, 400]);
      } else {
        beep(t, 425, 1.2, 0.06);
      }
    };
    play();
    const id = setInterval(play, 3000);
    return () => { clearInterval(id); navigator.vibrate?.(0); ctx.close().catch(() => {}); };
  }, [on, pattern]);
}

const END_TEXT = {
  'hung-up': 'Call ended', ended: 'Call ended', declined: 'Call declined', missed: 'No answer', failed: 'Call dropped', error: "Call couldn't start",
};

// The call, full screen: their video (or their photo, for a voice call), mine small in a corner I can drag,
// and the buttons along the bottom.
export default function CallScreen({ state, session, name, other, onHangUp, onDismiss }) {
  const [person, setPerson] = useState(null);
  useEffect(() => (other ? watchPerson(other, setPerson) : undefined), [other]);
  const video = session?.kind === 'video';
  const remoteEl = useRef(null);
  const localEl = useRef(null);
  const [, tick] = useState(0);
  const { phase, end, error, muted, cameraOn, facing, connectedAt } = state;

  // their sound and picture; mine (muted: I don't need to hear myself)
  const remoteTracks = session?.remote.getTracks().length || 0;
  const hasRemoteVideo = video && !!session?.remote.getVideoTracks().length;
  useEffect(() => {
    const el = remoteEl.current;
    if (el && session && el.srcObject !== session.remote) el.srcObject = session.remote;
    el?.play?.().catch(() => {});
  }, [session, remoteTracks, hasRemoteVideo]);
  const localVideoTrack = session?.local?.getVideoTracks()[0];
  useEffect(() => {
    const el = localEl.current;
    if (el && session?.local) { el.srcObject = session.local; el.play?.().catch(() => {}); }
  }, [session, localVideoTrack]);

  // the timer
  useEffect(() => {
    if (phase !== 'connected') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // the caller hears ringing until they answer
  useTone(phase === 'ringing', 'back');

  // switch camera only when there is more than one; speaker choice only where the browser can pick one
  const [cams, setCams] = useState(0);
  const [outputs, setOutputs] = useState([]);
  const [output, setOutput] = useState(0);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((d) => {
      setCams(d.filter((x) => x.kind === 'videoinput').length);
      if (typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) setOutputs(d.filter((x) => x.kind === 'audiooutput' && x.deviceId !== 'communications'));
    }).catch(() => {});
  }, [phase === 'connected']); // eslint-disable-line react-hooks/exhaustive-deps
  const nextOutput = () => {
    if (!outputs.length || !remoteEl.current?.setSinkId) return;
    const i = (output + 1) % outputs.length;
    remoteEl.current.setSinkId(outputs[i].deviceId).then(() => setOutput(i)).catch(() => {});
  };

  // my picture: a small window I can drag to any corner
  const [pip, setPip] = useState({ right: 16, top: 16 });
  const drag = useRef(null);
  const onPipDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, p: pip };
  };
  const onPipMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const right = Math.max(8, Math.min(window.innerWidth - 120, d.p.right - (e.clientX - d.x)));
    const top = Math.max(8, Math.min(window.innerHeight - 220, d.p.top + (e.clientY - d.y)));
    setPip({ right, top });
  };
  // let go: it snaps to the nearest side, top or bottom
  const onPipUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setPip((p) => ({
      right: p.right > window.innerWidth / 2 - 60 ? window.innerWidth - 136 : 16,
      top: p.top > window.innerHeight / 2 - 110 ? window.innerHeight - 330 : 16,
    }));
  };

  const caller = session?.role === 'caller';
  const status = phase === 'ended' ? (end === 'busy' ? `${name} is on another call` : END_TEXT[end] || 'Call ended')
    : phase === 'starting' ? (caller ? 'Calling…' : 'Connecting…')
      : phase === 'ringing' ? 'Ringing…'
        : phase === 'connecting' ? 'Connecting…'
          : phase === 'reconnecting' ? 'Reconnecting…'
            : callClock((Date.now() - connectedAt) / 1000);
  const showVideo = hasRemoteVideo && (phase === 'connected' || phase === 'reconnecting');

  return (
    <div className={['call', showVideo && 'call-has-video'].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={`Call with ${name}`}>
      {video ? (
        <video ref={remoteEl} className="call-remote" autoPlay playsInline style={{ visibility: showVideo ? 'visible' : 'hidden' }} />
      ) : (
        <audio ref={remoteEl} autoPlay />
      )}

      <div className="call-top">
        {!showVideo && (
          <div className={phase === 'ringing' ? 'call-pulse' : ''}>
            <Avatar person={{ email: other, displayName: name, photoURL: person?.photoURL || '' }} size={112} title={false} />
          </div>
        )}
        <h2>{name}</h2>
        <p className="call-status" aria-live="polite">{status}</p>
        {error && <p className="call-error" role="alert">{error}</p>}
        {!error && onMobileData() && phase !== 'connected' && phase !== 'ended' && (
          <p className="call-note">You&apos;re on mobile data. If the call doesn&apos;t connect, try Wi-Fi.</p>
        )}
      </div>

      {video && session?.local && phase !== 'ended' && (
        <video ref={localEl} className={['call-local', facing === 'user' && 'mirror', !cameraOn && 'off'].filter(Boolean).join(' ')}
          style={{ right: pip.right, top: pip.top }} autoPlay playsInline muted
          onPointerDown={onPipDown} onPointerMove={onPipMove} onPointerUp={onPipUp} onPointerCancel={onPipUp} />
      )}

      {phase === 'ended' ? (
        <div className="call-btns">
          {error && <button type="button" className="call-close" onClick={onDismiss}>Close</button>}
        </div>
      ) : (
        <div className="call-btns">
          <button type="button" className={muted ? 'call-btn on' : 'call-btn'} onClick={() => session.setMuted(!muted)}
            aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
            <CallIcon name={muted ? 'micOff' : 'mic'} />
          </button>
          {video && (
            <button type="button" className={!cameraOn ? 'call-btn on' : 'call-btn'} onClick={() => session.setCamera(!cameraOn)}
              aria-pressed={!cameraOn} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} title={cameraOn ? 'Camera off' : 'Camera on'}>
              <CallIcon name={cameraOn ? 'video' : 'videoOff'} />
            </button>
          )}
          {video && cams > 1 && (
            <button type="button" className="call-btn" onClick={() => session.switchCamera()} aria-label="Switch camera" title="Switch camera">
              <CallIcon name="flip" />
            </button>
          )}
          {outputs.length > 1 && (
            <button type="button" className="call-btn" onClick={nextOutput} aria-label={`Sound: ${outputs[output]?.label || 'default'}. Change`}
              title={outputs[output]?.label || 'Speaker'}>
              <CallIcon name="speaker" />
            </button>
          )}
          <button type="button" className="call-btn end" onClick={onHangUp} aria-label="End call" title="End call"><CallIcon name="end" /></button>
        </div>
      )}
    </div>
  );
}
