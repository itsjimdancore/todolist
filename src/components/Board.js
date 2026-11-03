'use client';
import { useEffect, useRef, useState } from 'react';
import { linkLabel } from '@/lib/links';
import { roleLabel } from '@/lib/permissions';
import { Avatar, colorFor, timeAgo } from '@/lib/people';
import ListMenu from './ListMenu';
import Loading from './Loading';

const TABS = {
  active: { label: 'All lists', empty: '' },
  favorites: { label: 'Favourites', empty: 'Star a list from its ⋮ menu to see it here.' },
  archived: { label: 'Archived', empty: 'Nothing archived.' },
};

// Move one id to a new position in a list of ids
function move(ids, id, to) {
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

// Search: list names, and the text, notes and links of the tasks inside them
const has = (text, q) => !!text && text.toLowerCase().includes(q);
const linkHit = (t, q) => (t.links || []).find((l) => has(l.title, q) || has(l.url, q));
function searchLists(lists, tasksByList, q) {
  const out = [];
  for (const l of lists) {
    const tasks = (tasksByList[l.id] || [])
      .filter((t) => !t.archived && (has(t.text, q) || has(t.notes, q) || linkHit(t, q)))
      .sort((a, b) => a.done - b.done || has(b.text, q) - has(a.text, q)); // open first, then title matches before notes and link matches
    if (has(l.title, q) || tasks.length) out.push({ list: l, titleHit: has(l.title, q), tasks });
  }
  // name matches first, then the most matching tasks
  return out.sort((a, b) => b.titleHit - a.titleHit || b.tasks.length - a.tasks.length);
}

// The matching part of a text, highlighted
export function Hl({ text = '', q }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

// Every list I can open, as cards in a 3-column grid. On "All lists" the cards can be dragged into my own order.
// top: shown above the cards on All lists (the Unplaced tasks)
export default function Board({ lists, tasksByList, favorites, actions, onOpen, onNew, onReorder, top = null }) {
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const results = q ? searchLists(lists, tasksByList, q) : null;
  const [drag, setDrag] = useState(null); // { id, ids } while dragging; { id: null, ids } after a drop, until the saved order shows up
  const cards = useRef(new Map()); // list id → its card element, to find which card the pointer is over
  const keyMoved = useRef(null); // card moved with the arrow keys, to keep focus on its handle
  const pick = {
    active: (l) => !l.archived,
    favorites: (l) => !l.archived && favorites.has(l.id),
    archived: (l) => l.archived,
  };
  const count = (k) => lists.filter(pick[k]).length;
  const shown = lists.filter(pick[tab]); // already in my order
  const shownIds = shown.map((l) => l.id);
  const shownKey = shownIds.join();
  const canDrag = !q && tab === 'active' && shown.length > 1;

  // While dragging (and just after a drop) show the dragged order
  const byId = new Map(shown.map((l) => [l.id, l]));
  const visible = drag && tab === 'active' ? drag.ids.filter((id) => byId.has(id)).map((id) => byId.get(id)) : shown;

  // The saved order arrived (or the lists changed): stop showing the local copy
  useEffect(() => {
    setDrag((d) => (d && !d.id ? null : d));
    const id = keyMoved.current;
    keyMoved.current = null;
    if (id) cards.current.get(id)?.querySelector('.grip')?.focus();
  }, [shownKey]);

  function startDrag(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, ids: shownIds });
  }

  function dragOver(e) {
    if (!drag?.id) return;
    // scroll the page when dragging near the top or bottom edge (long lists, phones)
    // (the main view scrolls on its own on desktop; on phones the page itself scrolls)
    const main = document.querySelector('.main');
    const scroller = main && getComputedStyle(main).overflowY === 'auto' ? main : window;
    if (e.clientY < 70) scroller.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 70) scroller.scrollBy(0, 14);
    for (const [id, el] of cards.current) {
      if (id === drag.id) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        setDrag((d) => ({ ...d, ids: move(d.ids, d.id, d.ids.indexOf(id)) }));
        break;
      }
    }
  }

  function endDrag() {
    if (!drag?.id) return;
    if (drag.ids.join() === shownKey) return setDrag(null);
    onReorder(drag.ids);
    setDrag({ id: null, ids: drag.ids });
  }

  // Arrow keys on a handle move that card one place
  function keyMove(e, id) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const to = shownIds.indexOf(id) + step;
    if (to < 0 || to >= shownIds.length) return;
    keyMoved.current = id;
    onReorder(move(shownIds, id, to));
  }

  const grip = (id) => ({
    onPointerDown: (e) => startDrag(e, id),
    onPointerMove: dragOver,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: (e) => keyMove(e, id),
  });

  return (
    <div className="board-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>My List</h1>
          <div className="meta">
            Every list you own or that&apos;s shared with you{canDrag && ' · drag ⠿ to arrange them'}
          </div>
        </div>
        <div className="bar-right">
          <button className="btn primary" type="button" onClick={onNew}>+ New list</button>
        </div>
      </header>

      <div className="board-tools">
        <BoardSearch query={query} setQuery={setQuery} q={q} results={results} onOpen={onOpen} />
        {!q && (
          <div className="tabs board-tabs" role="tablist">
            {Object.entries(TABS).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
                {t.label} <span className="count">{count(k)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="page-body">
      {q ? (
        <>
          <div className="board-results" aria-live="polite">
            {results.length
              ? <>{results.length} list{results.length > 1 ? 's' : ''} · {results.reduce((n, r) => n + r.tasks.length, 0)} matching task{results.reduce((n, r) => n + r.tasks.length, 0) === 1 ? '' : 's'} for <b>“{query.trim()}”</b></>
              : <>Nothing matches <b>“{query.trim()}”</b></>}
            <button type="button" className="link" onClick={() => setQuery('')}>Clear search</button>
          </div>
          {results.length > 0 && (
            <div className="board">
              {results.map((r) => (
                <BoardCard key={r.list.id} list={r.list} tasks={tasksByList[r.list.id]} favorite={favorites.has(r.list.id)} actions={actions}
                  onOpen={onOpen} match={r} q={q} cardRef={() => {}} />
              ))}
            </div>
          )}
        </>
      ) : shown.length === 0 && tab !== 'active' ? (
        <div className="muted board-empty">{TABS[tab].empty}</div>
      ) : (
        <>
        {tab === 'active' && top}
        <div className={drag?.id ? 'board is-dragging' : 'board'}>
          {visible.map((l) => (
            <BoardCard key={l.id} list={l} tasks={tasksByList[l.id]} favorite={favorites.has(l.id)} actions={actions} onOpen={onOpen}
              dragging={drag?.id === l.id} grip={canDrag ? grip(l.id) : null}
              cardRef={(el) => (el ? cards.current.set(l.id, el) : cards.current.delete(l.id))} />
          ))}
          {/* New list comes after my lists */}
          {tab === 'active' && (
            <button className="bcard add" type="button" onClick={onNew}>
              <span className="plus-big" aria-hidden="true">+</span>
              {shown.length ? 'New list' : 'Create your first list'}
            </button>
          )}
        </div>
        </>
      )}
      </div>
    </div>
  );
}

function BoardCard({ list, tasks = null, favorite, actions, onOpen, dragging, grip, cardRef, match, q }) {
  const open = (tasks || []).filter((t) => !t.archived);
  const done = open.filter((t) => t.done).length;
  const pct = open.length ? Math.round((done / open.length) * 100) : 0;
  const people = [{ email: list.ownerEmail, displayName: list.ownerName }, ...(list.memberEmails || []).map((email) => ({ email }))];

  // A click anywhere on the card opens the list. The drag handle and ⋮ menu keep their own clicks,
  // and so does selecting text on the card.
  function openFromCard(e) {
    if (e.target.closest('button, a, input, .menu')) return;
    if (window.getSelection()?.toString()) return;
    onOpen(list.id);
  }

  return (
    <article ref={cardRef} onClick={openFromCard}
      className={['bcard', list.archived && 'archived', dragging && 'dragging'].filter(Boolean).join(' ')}>
      <div className="bcard-h">
        {grip && (
          <button className="grip" type="button" title="Drag to reorder" aria-label={`Move “${list.title}” (arrow keys)`} {...grip}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="5" r="1.8" /><circle cx="15" cy="5" r="1.8" />
              <circle cx="9" cy="12" r="1.8" /><circle cx="15" cy="12" r="1.8" />
              <circle cx="9" cy="19" r="1.8" /><circle cx="15" cy="19" r="1.8" />
            </svg>
          </button>
        )}
        <button className="bcard-title" type="button" onClick={() => onOpen(list.id)}>
          {favorite && <span className="star" aria-label="Favourite">★</span>}
          <Hl text={list.title} q={q} />
        </button>
        <ListMenu list={list} favorite={favorite} actions={actions} />
      </div>

      <div className="bcard-meta">
        {list.role === 'owner' ? 'Owned by you' : `By ${list.ownerName || list.ownerEmail}`}
        {list.role !== 'owner' && <span className={`pill ${list.role}`}>{roleLabel(list.role)}</span>}
        {list.archived && <span className="pill read">Archived</span>}
      </div>

      <div className="progress" aria-label={`${done} of ${open.length} done`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="small muted">{tasks === null ? <Loading variant="inline" /> : `${done}/${open.length} done`}</div>

      {match?.tasks.length ? (
        // searching: the tasks that match, instead of the first few open ones
        <ul className="bcard-tasks hits">
          {match.tasks.slice(0, 4).map((t) => (
            <li key={t.id} className={t.done ? 'done' : ''}>
              <Hl text={t.text} q={q} />
              {!has(t.text, q) && has(t.notes, q) && <span className="hit-note">in notes: <Hl text={t.notes} q={q} /></span>}
              {!has(t.text, q) && !has(t.notes, q) && linkHit(t, q) && (
                <span className="hit-note">in links: <Hl text={linkLabel(linkHit(t, q))} q={q} /></span>
              )}
            </li>
          ))}
          {match.tasks.length > 4 && <li className="muted">+{match.tasks.length - 4} more matching</li>}
        </ul>
      ) : (
        <ul className="bcard-tasks">
          {open.filter((t) => !t.done).slice(0, 3).map((t) => <li key={t.id}>{t.text}</li>)}
          {tasks && open.length === done && <li className="muted">{open.length ? 'All done 🎉' : 'No tasks yet'}</li>}
        </ul>
      )}

      <div className="bcard-f">
        <div className="avatars">{people.slice(0, 5).map((p) => <Avatar key={p.email} person={p} size={26} />)}</div>
        <span className="small muted">{timeAgo(list.updatedAt)}</span>
      </div>
    </article>
  );
}

// The search box, with suggestions under it: matching lists, then matching tasks. Enter or a click opens the list.
function BoardSearch({ query, setQuery, q, results, onOpen }) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const listHits = (results || []).filter((r) => r.titleHit).slice(0, 4).map((r) => ({ key: `l:${r.list.id}`, list: r.list, count: r.tasks.length }));
  const taskHits = (results || []).flatMap((r) => r.tasks.map((t) => ({ key: `t:${r.list.id}/${t.id}`, list: r.list, task: t }))).slice(0, 6);
  const items = [...listHits, ...taskHits];
  const open = focused && !!q;

  useEffect(() => setActive(0), [q]);
  // "/" jumps to the search box
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (item) => { setFocused(false); input.current?.blur(); onOpen(item.list.id); };
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (query) { e.stopPropagation(); setQuery(''); } else input.current?.blur();
    } else if (open && items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (open && e.key === 'Enter' && items[active]) {
      e.preventDefault();
      go(items[active]);
    }
  }

  const row = (item, i) => (
    <li key={item.key} id={`bs-${i}`} role="option" aria-selected={i === active} className={i === active ? 'bs-i on' : 'bs-i'}
      onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(item); }}>
      <span className="bs-ic" style={item.task ? undefined : { background: colorFor(item.list.id) }} aria-hidden="true">
        {item.task
          ? <span className={item.task.done ? 'bs-box done' : 'bs-box'} />
          : (item.list.title || '?').trim()[0]?.toUpperCase()}
      </span>
      <span className="bs-b">
        <span className={item.task?.done ? 'bs-t done' : 'bs-t'}><Hl text={item.task ? item.task.text : item.list.title} q={q} /></span>
        <span className="bs-m">
          {item.task ? (
            <>
              <i style={{ background: colorFor(item.list.id) }} />{item.list.title}
              {!has(item.task.text, q) && (has(item.task.notes, q) ? ' · in notes' : ' · in links')}
              {item.task.done && ' · done'}
            </>
          ) : (
            <>{item.list.role === 'owner' ? 'Your list' : `Shared by ${item.list.ownerName || item.list.ownerEmail}`}{item.list.archived ? ' · archived' : ''}</>
          )}
        </span>
      </span>
      <span className="bs-go" aria-hidden="true">↵</span>
    </li>
  );

  return (
    <div className="bsearch">
      <div className={q ? 'cal-search has-q' : 'cal-search'} role="search"
        onMouseDown={(e) => { if (!e.target.closest('input, button')) { e.preventDefault(); input.current?.focus(); } }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder="Search lists and tasks" aria-label="Search lists and tasks" autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={open} aria-controls="board-suggest" aria-activedescendant={open && items.length ? `bs-${active}` : undefined} />
        {q ? (
          <button type="button" className="cal-search-x" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Clear search" title="Clear (Esc)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        ) : (
          <kbd className="cal-search-k" title="Press / to search">/</kbd>
        )}
      </div>

      {open && (
        <div className="bs-pop" id="board-suggest" role="listbox" aria-label="Suggestions">
          {items.length === 0 ? (
            <p className="bs-empty">No list or task matches “{query.trim()}”.</p>
          ) : (
            <>
              {listHits.length > 0 && <div className="bs-h">Lists</div>}
              <ul>{listHits.map((it, i) => row(it, i))}</ul>
              {taskHits.length > 0 && <div className="bs-h">Tasks</div>}
              <ul>{taskHits.map((it, i) => row(it, listHits.length + i))}</ul>
              <div className="bs-f"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to clear</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
