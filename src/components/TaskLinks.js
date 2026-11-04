'use client';
import { useState } from 'react';
import { MAX_LINKS, hostOf, linkLabel, normalizeUrl } from '@/lib/links';

export function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

// The links on a task, as chips that open in a new tab. Write roles get a ✕ to remove each one.
export function LinkChips({ links = [], canEdit, onRemove }) {
  if (!links.length) return null;
  return (
    <ul className="link-chips">
      {links.map((l) => (
        <li key={l.url + l.title} className="link-chip">
          <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>
            <LinkIcon /><span>{linkLabel(l)}</span>
          </a>
          {canEdit && (
            <button type="button" className="link-x" onClick={() => onRemove(l)} aria-label={`Remove link ${linkLabel(l)}`}>✕</button>
          )}
        </li>
      ))}
    </ul>
  );
}

// The "add a link" form, while adding (or a note once the task is full)
export function AddLink({ links = [], onAdd, setAdding }) {
  if (links.length >= MAX_LINKS) return <p className="link-err">A task can have up to {MAX_LINKS} links.</p>;
  return (
    <LinkForm onAdd={(link) => { onAdd(link); setAdding(false); }} onCancel={() => setAdding(false)}
      taken={links.map((l) => l.url)} />
  );
}

// Chips, then the add form below them (the calendar panel).
// adding / setAdding: whether the "add a link" form is open.
// addButton: show a "+ Add link" button of its own (the calendar panel has no Link button).
export default function TaskLinks({ links = [], canEdit, onAdd, onRemove, adding, setAdding, addButton = false }) {
  const full = links.length >= MAX_LINKS;
  if (!links.length && !adding && !(canEdit && addButton)) return null;

  return (
    <div className="task-links">
      <LinkChips links={links} canEdit={canEdit} onRemove={onRemove} />
      {canEdit && adding && <AddLink links={links} onAdd={onAdd} setAdding={setAdding} />}
      {canEdit && addButton && !adding && !full && (
        <button type="button" className="ic link-add" onClick={() => setAdding(true)}>+ Add link</button>
      )}
    </div>
  );
}

function LinkForm({ onAdd, onCancel, taken }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');

  function submit(e) {
    e.preventDefault();
    const href = normalizeUrl(url);
    if (!href) return setErr('Enter a web address, like example.com');
    if (taken.includes(href)) return setErr('This task already has that link.');
    onAdd({ url: href, title: title.trim().slice(0, 120) });
  }

  const key = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // close just the form, not the panel it's in
    onCancel();
  };

  return (
    <form className="link-form" onSubmit={submit} onKeyDown={key}>
      {/* not type="url": the browser would refuse a bare "example.com" */}
      <input autoFocus inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="Paste a link" value={url} maxLength={2000}
        onChange={(e) => { setUrl(e.target.value); setErr(''); }} aria-label="Link address" autoComplete="off" />
      <input placeholder={url && normalizeUrl(url) ? `Name (optional): ${hostOf(normalizeUrl(url))}` : 'Name (optional)'}
        value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Link name" autoComplete="off" />
      <div className="link-form-b">
        <button className="btn primary" type="submit" disabled={!url.trim()}>Add link</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {err && <p className="link-err" role="alert">{err}</p>}
    </form>
  );
}
