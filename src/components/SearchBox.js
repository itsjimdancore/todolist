'use client';
import { useEffect, useRef } from 'react';

// Lower-cased, trimmed search text ('' = not searching), and a case-insensitive "does this text contain it"
export const norm = (query) => query.trim().toLowerCase();
export const has = (text, q) => !!text && String(text).toLowerCase().includes(q);

// A page's search box (the same look as the Calendar's): "/" jumps to it, Esc clears it, and while
// something is typed it shows how many things match and a ✕ to clear.
export default function SearchBox({ value, onChange, placeholder = 'Search', found = null, className = '', shortcut = true }) {
  const input = useRef(null);
  const q = norm(value);

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="dialog"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  return (
    <div className={['cal-search', q && 'has-q', className].filter(Boolean).join(' ')} role="search"
      onMouseDown={(e) => { if (!e.target.closest('input, button')) { e.preventDefault(); input.current?.focus(); } }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} autoComplete="off" spellCheck={false}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          if (value) { e.stopPropagation(); onChange(''); } else input.current?.blur();
        }} />
      {q ? (
        <>
          {found !== null && <span className="cal-search-n" aria-live="polite">{found} found</span>}
          <button type="button" className="cal-search-x" onClick={() => { onChange(''); input.current?.focus(); }}
            aria-label="Clear search" title="Clear (Esc)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </>
      ) : shortcut ? (
        <kbd className="cal-search-k" title="Press / to search">/</kbd>
      ) : null}
    </div>
  );
}
