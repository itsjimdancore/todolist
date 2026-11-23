'use client';
// Loading indicators: the spinning LoaderIcon for buttons, and the ring loader (four rings spinning at
// different speeds) with a title and an optional line under it. The rings are drawn in CSS (globals.css)
// and tinted with currentColor, which is the app's --accent.
import { useEffect, useState } from 'react';
import { LoaderIcon } from 'lucide-react';

// Pass aria-hidden when text beside it already says what's happening (e.g. "Saving…" in a button)
export function Spinner({ className = '', size = 16, label = 'Loading', ...props }) {
  const a11y = props['aria-hidden'] ? {} : { role: 'status', 'aria-label': label };
  return <LoaderIcon {...a11y} width={size} height={size} className={`spinner ${className}`} {...props} />;
}

const RINGS = ['outer', 'primary', 'counter', 'accent'];

// variant: 'page' (fills and centres in the screen or the main pane), 'block' (inside a card or list),
// 'inline' (a small ring and the text on one line)
export default function Loading({ text = 'Loading', hint, variant = 'block', className = '' }) {
  return (
    <div className={`loading ${variant} ${className}`} role="status" aria-live="polite">
      <div className="loader-rings" aria-hidden="true">
        {RINGS.map((id) => <span key={id} className={`loader-ring ${id}`} />)}
      </div>
      <div className="loader-text">
        <span className="loader-title">{text}</span>
        {hint && variant !== 'inline' && <span className="loader-hint">{hint}</span>}
      </div>
    </div>
  );
}

// The startup splash: the page loader over the whole screen while the app loads behind it
export const SPLASH_MIN_MS = 5000; // shown for at least this long after the page starts loading
export const SPLASH_MAX_MS = 15000; // and never longer than this, even if something is still loading
export const SPLASH_FADE_MS = 400;

export function Splash({ hint, fading = false }) {
  return (
    <div className={fading ? 'splash fading' : 'splash'}>
      <Loading variant="page" text="Loading" hint={hint} />
    </div>
  );
}

// 'on' until `ready` and SPLASH_MIN_MS have passed since the page began loading (performance.now(), so the
// sign-in check counts too), or SPLASH_MAX_MS whatever happens; then 'fading', then 'off'
export function useSplash(ready) {
  const [phase, setPhase] = useState('on');
  useEffect(() => {
    if (phase !== 'on') return;
    const until = ready ? SPLASH_MIN_MS : SPLASH_MAX_MS;
    const t = setTimeout(() => setPhase('fading'), Math.max(0, until - performance.now()));
    return () => clearTimeout(t);
  }, [ready, phase]);
  useEffect(() => {
    if (phase !== 'fading') return;
    const t = setTimeout(() => setPhase('off'), SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  return phase;
}
