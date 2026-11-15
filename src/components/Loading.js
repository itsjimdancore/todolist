'use client';
// Loading indicators: the spinning LoaderIcon for buttons, and the ring loader (four rings spinning at
// different speeds) with a title and an optional line under it. The rings are drawn in CSS (globals.css)
// and tinted with currentColor, which is the app's --accent.
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
