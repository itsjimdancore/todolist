'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { fb, friendlyError } from '@/lib/firebase';
import {
  archiveList,
  createLetter,
  createList,
  deleteList,
  emailOf,
  getLastListId,
  leaveList,
  markActivitySeen,
  markInviteSeen,
  renameList,
  saveLastListId,
  saveListOrder,
  savePresence,
  saveProfile,
  setFavorite,
  watchFavorites,
  watchActivity,
  watchLog,
  watchInvites,
  watchListOrder,
  watchOwnedLists,
  watchSharedLists,
  watchMusic,
  watchSpotify,
} from '@/lib/data';
import { roleLabel } from '@/lib/permissions';
import { pausePush, refreshPush } from '@/lib/push';
import { Avatar, colorFor, displayName, toDate } from '@/lib/people';
import Board from './Board';
import Calendar, { dueNowCount, taskEntries, useAllTasks } from './Calendar';
import Emblem from './Emblem';
import ListDialog from './ListDialogs';
import ListMenu from './ListMenu';
import Notifications, { NotificationsPage, useNotifications } from './Notifications';
import ListView from './ListView';
import Letters from './Letters';
import LetterView from './LetterView';
import Loading from './Loading';
import Music from './Music';
import MusicPlayer from './MusicPlayer';
import { ToastProvider, useToast } from './Toast';
import { UpdateProvider } from './UpdateBanner';

export default function Workspace(props) {
  return (
    <ToastProvider>
      <UpdateProvider>
        <WorkspaceInner {...props} />
      </UpdateProvider>
    </ToastProvider>
  );
}

// Signing in lands on "My List" (the board), unless a shared link (?list=…) points at one list
function initialView() {
  const q = new URLSearchParams(window.location.search);
  if (['calendar', 'notifications', 'letters', 'music'].includes(q.get('view'))) return q.get('view');
  return q.get('view') === 'board' || !q.get('list') ? 'board' : 'list';
}

function WorkspaceInner({ user }) {
  const toast = useToast();
  const email = emailOf(user);
  const [owned, setOwned] = useState(null); // null = loading
  const [shared, setShared] = useState(null); // null = loading
  const [invites, setInvites] = useState([]);
  const [activity, setActivity] = useState([]); // "X commented on …"
  const [favList, setFavList] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState(initialView);
  const [dialog, setDialog] = useState(null); // { kind: 'rename' | 'members' | 'delete' | 'leave', id }
  const [creating, setCreating] = useState(false); // false | 'list' | 'letter'
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const restored = useRef(false);
  const goingAway = useRef(null); // list I'm deleting or leaving on purpose, so it doesn't count as "access removed"
  const menuBtn = useRef(null);
  const closeBtn = useRef(null);
  // Desktop sidebar collapsed to icons, remembered on this device (Workspace only renders in the browser, after sign-in)
  const [rail, setRail] = useState(() => {
    try { return localStorage.getItem('sidebar') === 'rail'; } catch { return false; }
  });
  function toggleRail() {
    setRail((r) => {
      try { localStorage.setItem('sidebar', r ? 'full' : 'rail'); } catch {}
      return !r;
    });
  }

  // ---- phone drawer: focus starts on its ✕; Escape closes it and hands focus back to the ☰ button
  useEffect(() => {
    if (!menuOpen) return;
    closeBtn.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuBtn.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // ---- save my profile once per sign-in
  useEffect(() => {
    saveProfile(user).catch(() => {});
  }, [user]);

  // ---- "last active" for the people I share with: on opening the app, on coming back to it, every 5 minutes
  //      while it's on screen, and once more when I leave it (switch tab, close it, lock the phone), so the time
  //      people see is when I actually stopped. Signing out saves it too (onSignOut).
  useEffect(() => {
    let last = 0;
    let wasOnline = null;
    const save = (online) => {
      // going online or offline always saves; staying online saves at most every 5 minutes
      if (online === wasOnline && Date.now() - last < 5 * 60 * 1000 - 1000) return;
      last = Date.now();
      wasOnline = online;
      savePresence(user, online).catch(() => {});
    };
    const onVis = () => save(document.visibilityState === 'visible');
    const onLeave = () => save(false);
    onVis();
    const every = setInterval(() => document.visibilityState === 'visible' && save(true), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onLeave);
    return () => {
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [user]);

  // ---- device notifications: if they're on for this device, keep its token current
  useEffect(() => {
    refreshPush(user).catch(() => {});
  }, [user]);

  // ---- live list of everything I own
  useEffect(
    () => watchOwnedLists(user.uid, setOwned, (e) => { setOwned([]); toast(friendlyError(e), 'err'); }),
    [user.uid, toast],
  );

  // ---- live list of everything shared with me
  useEffect(
    () => watchSharedLists(email, setShared, (e) => { setShared([]); toast(friendlyError(e), 'err'); }),
    [email, toast],
  );

  // ---- live notifications: "X shared a list with you"
  useEffect(() => watchInvites(email, setInvites, () => setInvites([])), [email]);

  // ---- live notifications: someone wrote, edited or deleted a comment on one of my lists or letters
  useEffect(() => watchActivity(email, setActivity, () => setActivity([])), [email]);

  // ---- my own activity ("You created …", "You added a song …"), shown with the rest
  const [log, setLog] = useState([]);
  useEffect(() => watchLog(user.uid, setLog), [user.uid]);
  const me = useMemo(() => ({ email, displayName: user.displayName }), [email, user.displayName]);

  // ---- my favourite lists (stored on my profile, so they follow me to any device)
  useEffect(() => watchFavorites(user.uid, setFavList), [user.uid]);
  const favorites = useMemo(() => new Set(favList), [favList]);

  // ---- the order I dragged my lists into (also on my profile)
  const [order, setOrder] = useState([]);
  useEffect(() => watchListOrder(user.uid, setOrder), [user.uid]);
  const rank = useMemo(() => new Map(order.map((id, i) => [id, i])), [order]);

  // ---- what the sidebar player is playing, and the songs I kept on the Music page (both on my profile)
  const [nowPlaying, setNowPlaying] = useState(null); // null = loading, '' = nothing
  useEffect(() => watchSpotify(user.uid, setNowPlaying), [user.uid]);
  const [music, setMusic] = useState([]);
  useEffect(() => watchMusic(user.uid, setMusic), [user.uid]);

  const lists = useMemo(() => {
    // wait for both, so "where I left off" can be a list someone shared with me
    if (owned === null || shared === null) return null;
    const all = [
      ...owned.map((l) => ({ ...l, role: 'owner' })),
      ...shared.map((l) => ({ ...l, role: l.roles?.[email] })).filter((l) => l.role),
    ];
    return all.sort((a, b) => toDate(b.updatedAt) - toDate(a.updatedAt));
  }, [owned, shared, email]);

  // ---- first load: pick the list from the link, else the one I had open last
  useEffect(() => {
    if (lists === null || restored.current) return;
    restored.current = true;
    (async () => {
      const fromUrl = new URLSearchParams(window.location.search).get('list');
      const last = await getLastListId(user.uid).catch(() => null);
      const pick =
        lists.find((l) => l.id === fromUrl)?.id || lists.find((l) => l.id === last)?.id || lists.find((l) => l.kind !== 'letter')?.id || null;
      if (fromUrl && !lists.some((l) => l.id === fromUrl)) {
        toast("That list isn't shared with this account. Sign in with the email it was sent to.", 'err');
        setView('board');
      }
      setActiveId(pick);
    })();
  }, [lists, user.uid, toast]);

  // ---- opening a shared list (from the link, a notification or the sidebar) marks its notification as read,
  // once per visit, so "Mark as unread" while the list is open sticks
  const seenFor = useRef(null);
  useEffect(() => {
    if (view !== 'list') { seenFor.current = null; return; }
    if (seenFor.current === activeId) return;
    const inv = invites.find((i) => i.listId === activeId && !i.seen);
    if (!inv) return;
    seenFor.current = activeId;
    markInviteSeen(inv.id).catch(() => {});
  }, [invites, activeId, view]);

  // ---- comment notifications for the list I have open: I'm already looking at it, so they count as read.
  // Each one only once, so "Mark as unread" sticks.
  const autoSeen = useRef(new Set());
  useEffect(() => {
    if (view !== 'list' || !activeId) return;
    for (const a of activity) {
      if (a.listId !== activeId || a.seen || autoSeen.current.has(a.id)) continue;
      autoSeen.current.add(a.id);
      markActivitySeen(a.id).catch(() => {});
    }
  }, [activity, activeId, view]);

  // ---- remember the open list and view in the address bar, and the list in the database
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set('list', activeId);
    if (['board', 'calendar', 'notifications', 'letters', 'music'].includes(view)) url.searchParams.set('view', view);
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
    if (activeId) saveLastListId(user.uid, activeId).catch(() => {});
  }, [activeId, view, user.uid]);

  // ---- if the open list disappears (deleted, or my access was removed), move on.
  // A letter that disappears goes back to the Love letters page rather than into some to-do list.
  const activeWasLetter = useRef(false);
  useEffect(() => {
    if (!lists || !activeId || !restored.current) return;
    const now = lists.find((l) => l.id === activeId);
    if (now) { activeWasLetter.current = now.kind === 'letter'; return; }
    const letter = activeWasLetter.current;
    if (goingAway.current !== activeId) toast(`You no longer have access to that ${letter ? 'letter' : 'list'}.`);
    if (letter && view === 'list') setView('letters');
    setActiveId(lists.find((l) => l.kind !== 'letter')?.id ?? null);
  }, [lists, activeId, toast, view]);

  // Step off the list first, so its tasks and comments stop listening before it goes away
  async function stepAway(list, work, okMsg, failMsg) {
    goingAway.current = list.id;
    const wasActive = activeId === list.id;
    const wasView = view;
    if (wasActive && list.kind === 'letter' && view === 'list') setView('letters');
    if (wasActive) setActiveId(lists.find((l) => l.id !== list.id && l.kind !== 'letter')?.id ?? null);
    try {
      await work();
      toast(okMsg);
    } catch (err) {
      goingAway.current = null;
      if (wasActive) { setActiveId(list.id); setView(wasView); }
      toast(`${failMsg}: ${friendlyError(err)}`, 'err');
    }
  }

  const onLeave = (list) =>
    stepAway(list, () => leaveList(list, user), `You left “${list.title}”`, "Couldn't leave the list");
  const onDelete = (list) =>
    stepAway(list, () => deleteList(list, user), `“${list.title}” deleted`, "Couldn't delete the list");

  const report = (promise, okMsg) =>
    promise.then(() => okMsg && toast(okMsg)).catch((e) => toast(`Not saved: ${friendlyError(e)}`, 'err'));

  // What the ⋮ menu on a list can do
  const actions = {
    rename: (l) => setDialog({ kind: 'rename', id: l.id }),
    favorite: (l) => {
      const on = !favorites.has(l.id);
      report(setFavorite(user.uid, l.id, on), on ? `“${l.title}” added to favourites` : 'Removed from favourites');
    },
    members: (l) => setDialog({ kind: 'members', id: l.id }),
    archive: (l) => report(archiveList(l, user, !l.archived), l.archived ? `“${l.title}” is back in your lists` : `“${l.title}” archived`),
    remove: (l) => setDialog({ kind: 'delete', id: l.id }),
    leave: (l) => setDialog({ kind: 'leave', id: l.id }),
  };

  // From the "+" on My List: create, then go straight to the new list. Returns a problem to show, or nothing.
  async function onCreate(title) {
    try {
      const letter = creating === 'letter';
      const id = await (letter ? createLetter : createList)(user, title);
      pick(id);
      toast(letter ? `“${title}” started. Write from the heart.` : `“${title}” created. Add your first task.`);
      return null;
    } catch (err) {
      return friendlyError(err);
    }
  }

  // Clear ?list= and ?view= so the next person to sign in here starts on My List
  // This device stops getting my notifications until I sign in again (so the next person on it doesn't get mine),
  // but my Device notifications setting stays as I left it
  async function onSignOut() {
    window.history.replaceState(null, '', window.location.pathname);
    await pausePush().catch(() => {});
    // the moment I signed out is my "last active" (must be saved while still signed in)
    await savePresence(user, false).catch(() => {});
    signOut(fb().auth);
  }

  const active = lists?.find((l) => l.id === activeId) || null;
  const dialogList = dialog && lists?.find((l) => l.id === dialog.id);
  // My own drag order once I've set one (new lists go after it), else favourites first; most recently changed breaks ties
  const arrange = (arr) =>
    order.length
      ? [...arr].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || 0)
      : [...arr].sort((a, b) => favorites.has(b.id) - favorites.has(a.id));
  // Love letters live on their own page; every to-do view (My List, Calendar, the sidebar) leaves them out
  const todoLists = useMemo(() => (lists || []).filter((l) => l.kind !== 'letter'), [lists]);
  const letters = useMemo(() => (lists || []).filter((l) => l.kind === 'letter'), [lists]);
  const arranged = arrange(todoLists);
  // Tasks of every open list, live: the calendar shows them, the sidebar counts what's due
  const openLists = arranged.filter((l) => !l.archived);
  // every list's tasks (archived too, so My List can search them); the calendar only uses the open lists'
  const allTasks = useAllTasks(arranged);
  const dueNow = dueNowCount(taskEntries(openLists, allTasks));
  // Shares + due / overdue reminders, for the bell and the Notifications page
  const notif = useNotifications({ invites, activity, log, me, lists, tasksByList: allTasks, uid: user.uid, openListId: view === 'list' ? activeId : null });
  const showNotifications = () => { setView('notifications'); setMenuOpen(false); };
  const mine = arranged.filter((l) => l.role === 'owner' && !l.archived);
  const others = arranged.filter((l) => l.role !== 'owner' && !l.archived);
  // From dragging on My List: the cards I moved, then everything else in its current place
  const onReorder = (ids) => {
    const moved = new Set(ids);
    report(saveListOrder(user.uid, [...ids, ...arranged.map((l) => l.id).filter((id) => !moved.has(id))]));
  };
  const archived = todoLists.filter((l) => l.archived);
  const pick = (id) => { setActiveId(id); setView('list'); setMenuOpen(false); };
  // a notification: its list, or (null) the Music page for music ones
  const openNote = (id) => (id ? pick(id) : (setView('music'), setMenuOpen(false)));
  const group = { activeId: view === 'list' ? activeId : null, onPick: pick, favorites, actions };

  // Everyone I've shared with or who has shared with me: the contacts in the share window
  const contacts = useMemo(() => {
    const m = new Map();
    for (const l of lists || []) {
      if (l.ownerEmail && l.ownerEmail !== email) m.set(l.ownerEmail, { email: l.ownerEmail, displayName: l.ownerName });
      for (const e of l.memberEmails || []) if (e !== email && !m.has(e)) m.set(e, { email: e });
    }
    return [...m.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [lists, email]);

  return (
    <div className={rail ? 'shell rail' : 'shell'}>
      <aside className={menuOpen ? 'side open' : 'side'}>
        <div className="side-top">
          <button ref={menuBtn} className="burger only-mobile" type="button" onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen} aria-controls="side-body" aria-label="Open menu">
            <span aria-hidden="true" />
          </button>
          <div className="brand"><Emblem size={28} /><span className="brand-name">Shared To-Do</span></div>
          <Notifications api={notif} user={user} onOpen={openNote} onViewAll={showNotifications} />
          <button className="side-btn collapse only-desktop" type="button" onClick={toggleRail}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name="sidebar" />
          </button>
        </div>

        <div className="side-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

        <div className="side-body" id="side-body">
          <div className="drawer-head">
            <div className="brand"><Emblem size={26} /><span className="brand-name">Shared To-Do</span></div>
            <button ref={closeBtn} className="side-btn" type="button" onClick={() => { setMenuOpen(false); menuBtn.current?.focus(); }}
              aria-label="Close menu">
              <Icon name="close" />
            </button>
          </div>

          {/* only this middle part scrolls, so the header and my account card always stay on screen */}
          <div className="side-scroll">
            <button type="button" className="new-list" title="New list"
              onClick={() => { setView('board'); setCreating('list'); setMenuOpen(false); }}>
              <Icon name="plus" /><span className="lbl">New list</span>
            </button>

            <nav className="group" aria-label="Main">
              <button type="button" className={view === 'board' ? 'nav-i on' : 'nav-i'} title="My List"
                aria-current={view === 'board' ? 'page' : undefined}
                onClick={() => { setView('board'); setMenuOpen(false); }}>
                <Icon name="grid" /><span className="lbl">My List</span>
                <span className="count">{todoLists.filter((l) => !l.archived).length}</span>
              </button>
              <button type="button" className={view === 'calendar' ? 'nav-i on' : 'nav-i'} title="Calendar"
                aria-current={view === 'calendar' ? 'page' : undefined}
                onClick={() => { setView('calendar'); setMenuOpen(false); }}>
                <Icon name="calendar" /><span className="lbl">Calendar</span>
                {dueNow > 0 && (
                  <span className="due-badge" title={`${dueNow} task${dueNow > 1 ? 's' : ''} due today or overdue`}
                    aria-label={`${dueNow} due today or overdue`}>{dueNow}</span>
                )}
              </button>
              <button type="button" className={view === 'letters' ? 'nav-i on' : 'nav-i'} title="Love letters"
                aria-current={view === 'letters' ? 'page' : undefined}
                onClick={() => { setView('letters'); setMenuOpen(false); }}>
                <Icon name="heart" /><span className="lbl">Love letters</span>
                {letters.length > 0 && <span className="count">{letters.filter((l) => !l.archived).length}</span>}
              </button>
              <button type="button" className={view === 'music' ? 'nav-i on' : 'nav-i'} title="Music"
                aria-current={view === 'music' ? 'page' : undefined}
                onClick={() => { setView('music'); setMenuOpen(false); }}>
                <Icon name="music" /><span className="lbl">Music</span>
                {music.length > 0 && <span className="count">{music.length}</span>}
              </button>
              <button type="button" className={view === 'notifications' ? 'nav-i on' : 'nav-i'} title="Notifications"
                aria-current={view === 'notifications' ? 'page' : undefined} onClick={showNotifications}>
                <Icon name="bell" /><span className="lbl">Notifications</span>
                {notif.unread > 0 && <span className="count unread-count" aria-label={`${notif.unread} unread`}>{notif.unread}</span>}
              </button>
            </nav>

            <ListGroup title="Owned by me" lists={mine} {...group}
              empty={lists === null ? <Loading variant="inline" /> : 'Press “New list” to create your first one.'} />
            <ListGroup title="Shared with me" lists={others} {...group}
              empty={lists === null ? '' : 'Lists people share with you appear here.'} />

            {archived.length > 0 && (
              <div className="group">
                <button className="nav-i" type="button" title="Archived" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
                  <Icon name="archive" /><span className="lbl">Archived</span>
                  <span className="count">{archived.length}</span>
                </button>
                {showArchived && <ListGroup lists={archived} {...group} />}
              </div>
            )}
          </div>

          <MusicPlayer user={user} link={nowPlaying} music={music} onOpenMusic={() => { setView('music'); setMenuOpen(false); }}
            icon={<Icon name="music" />} />

          <div className="me">
            <Avatar person={{ email, displayName: user.displayName }} size={32} />
            <div className="me-txt">
              <div className="me-name">{user.displayName || email.split('@')[0]}</div>
              <div className="me-email">{user.email}</div>
            </div>
            <button className="side-btn signout" type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
              <Icon name="logout" /><span className="signout-lbl">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {lists === null ? (
          <Loading variant="page" hint="Getting your lists ready" />
        ) : view === 'notifications' ? (
          <NotificationsPage api={notif} user={user} onOpen={openNote} />
        ) : view === 'calendar' ? (
          <Calendar lists={openLists} byList={allTasks} user={user} onOpen={pick} />
        ) : view === 'music' ? (
          <Music user={user} music={music} nowPlaying={nowPlaying || ''} />
        ) : view === 'letters' ? (
          <Letters letters={letters} contacts={contacts} favorites={favorites} actions={actions} onOpen={pick}
            onNew={() => setCreating('letter')} />
        ) : view === 'board' ? (
          <Board lists={arranged} tasksByList={allTasks} favorites={favorites} actions={actions} onOpen={pick} onNew={() => setCreating('list')}
            onReorder={onReorder} />
        ) : active?.kind === 'letter' ? (
          <LetterView key={active.id} list={active} role={active.role} user={user} contacts={contacts}
            onLeave={actions.leave} onDelete={actions.remove} onArchive={actions.archive}
            menu={<ListMenu list={active} favorite={favorites.has(active.id)} actions={actions} />} />
        ) : active ? (
          <ListView key={active.id} list={active} role={active.role} user={user} contacts={contacts}
            onLeave={actions.leave} onDelete={actions.remove} onArchive={actions.archive}
            menu={<ListMenu list={active} favorite={favorites.has(active.id)} actions={actions} />} />
        ) : (
          <div className="center">
            <div className="card narrow">
              <h2>No lists yet</h2>
              <p className="muted">
                Create your first list from My List. When someone shares a list with {user.email}, it shows up under
                “Shared with me”.
              </p>
              <button className="btn primary" type="button" onClick={() => { setView('board'); setCreating('list'); }}>
                + New list
              </button>
            </div>
          </div>
        )}
      </main>

      {creating && (
        <ListDialog dialog={{ kind: 'create', letter: creating === 'letter' }} contacts={contacts} onCreate={onCreate}
          onClose={() => setCreating(false)} />
      )}

      {dialogList && (
        <ListDialog dialog={{ kind: dialog.kind, list: dialogList }} contacts={contacts}
          onRename={(l, t) => report(renameList(l, user, t), 'Name saved')}
          onDelete={onDelete} onLeave={onLeave} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function ListGroup({ title, lists, activeId, onPick, favorites, actions, empty }) {
  const [open, setOpen] = useState(true);
  return (
    <nav className="group" aria-label={title}>
      {title && (
        <button type="button" className="sec-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="chevron" /><span>{title}</span>
          {lists.length > 0 && <span className="count">{lists.length}</span>}
        </button>
      )}
      {open && lists.length === 0 && empty && <div className="side-empty">{empty}</div>}
      {open && lists.map((l) => (
        <div key={l.id} className={l.id === activeId ? 'list-item on' : 'list-item'}>
          <button type="button" className="list-link" title={l.title} onClick={() => onPick(l.id)}
            aria-current={l.id === activeId ? 'page' : undefined}>
            <span className="li-mark" style={{ background: colorFor(l.id) }} aria-hidden="true">
              {(l.title || '?').trim()[0]?.toUpperCase()}
            </span>
            <span className="ll-title">{l.title}</span>
            {favorites.has(l.id) && <span className="star" aria-label="Favourite">★</span>}
            {l.role !== 'owner' && <span className={`pill ${l.role}`}>{roleLabel(l.role)}</span>}
          </button>
          <ListMenu list={l} favorite={favorites.has(l.id)} actions={actions} />
        </div>
      ))}
    </nav>
  );
}

// Small line icons for the sidebar
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 10l-2 2 2 2" /></>,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  heart: <path d="M12 20s-7-4.4-9-8.8C1.6 8 3.6 4.5 7 4.5c2 0 3.4 1.1 5 2.8 1.6-1.7 3-2.8 5-2.8 3.4 0 5.4 3.5 4 6.7C19 15.6 12 20 12 20z" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
};

function Icon({ name }) {
  return (
    <svg className={`icon i-${name}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
