'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_MESSAGE, deleteMessage, editMessage, emailOf, markChatRead, sendMessage, setTyping, startChat, watchPerson,
} from '@/lib/data';
import { friendlyError } from '@/lib/firebase';
import { EMAIL_RE, roleLabel } from '@/lib/permissions';
import { Avatar, colorFor, displayName, toDate } from '@/lib/people';
import BackLink from './BackLink';
import EmojiPicker from './EmojiPicker';
import Loading, { Spinner } from './Loading';
import { useToast } from './Toast';

const EDIT_MINS = 180; // your own messages can be edited for 3 hours, read (blue ✓✓) or not; firestore.rules agrees
const TYPING_MS = 6000; // "typing…" shows while their last keystroke is this recent
const GROUP_MS = 5 * 60 * 1000; // messages this close together from one person form a group (one tail)

const ms = (ts) => (ts ? toDate(ts).getTime() : 0);
const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Today / Yesterday / Monday (this week) / 30 October 2026
export function dayLabel(d, now = new Date()) {
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// "online", "last seen today at 9:41 PM", "last seen yesterday at …", "last seen 30 October 2026"
function seenLabel(p) {
  if (!p) return '';
  const at = p.lastSeen ? toDate(p.lastSeen) : null;
  if (p.online !== false && at && Date.now() - at.getTime() < 6 * 60 * 1000) return 'online';
  if (!at) return '';
  const day = dayLabel(at);
  if (day === 'Today') return `last seen today at ${clock(at)}`;
  if (day === 'Yesterday') return `last seen yesterday at ${clock(at)}`;
  return `last seen ${day}${/\d{4}$/.test(day) ? '' : ` at ${clock(at)}`}`;
}

// WhatsApp's list time: 9:41 PM today, Yesterday, the weekday this week, else 30/10/2026
function listTime(ts) {
  if (!ts) return '';
  const d = toDate(ts);
  const day = dayLabel(d);
  if (day === 'Today') return clock(d);
  if (day === 'Yesterday' || !/\d/.test(day)) return day;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Only emoji (a few): shown big, like WhatsApp
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;
const bigEmoji = (t) => EMOJI_ONLY.test(t) && !/\d|#|\*/.test(t) && [...t.replace(/\s|‍|️/g, '')].length <= 6;

// ---- search: messages whose text contains q (any case); the text split around each match
export const matchesOf = (messages, q) => {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return (messages || []).filter((m) => !m.deleted && m.text.toLowerCase().includes(t));
};
export function splitMatch(text, q) {
  const t = q.trim().toLowerCase();
  if (!t) return [{ s: text }];
  const out = [];
  const low = text.toLowerCase();
  let i = 0;
  for (let at = low.indexOf(t); at >= 0; at = low.indexOf(t, i)) {
    if (at > i) out.push({ s: text.slice(i, at) });
    out.push({ s: text.slice(at, at + t.length), hit: true });
    i = at + t.length;
  }
  if (i < text.length) out.push({ s: text.slice(i) });
  return out;
}
function Hl({ text, q }) {
  return splitMatch(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : p.s));
}

// Web addresses in a message become links (http/https only)
const URL_RE = /\b(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
function Linked({ text }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,!?)\]]+$/, '');
    if (m.index > last) out.push(text.slice(last, m.index));
    const href = url.startsWith('http') ? url : `https://${url}`;
    out.push(<a key={m.index} href={href} target="_blank" rel="noopener noreferrer">{url}</a>);
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const Ic = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  dots: <><circle cx="12" cy="5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="19" r="1.6" fill="currentColor" /></>,
  newChat: <><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z" /><path d="M12 8.5v7M8.5 12h7" /></>,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
};
const Svg = ({ name, size = 20, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Ic[name]}</svg>
);

// A small ⋮ menu
function DotsMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => !box.current?.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span className="wa-menu" ref={box}>
      <button type="button" className="wa-ic" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Svg name="dots" /></button>
      {open && (
        <span className="wa-menu-pop" role="menu">
          {items.filter(Boolean).map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

// The Chat page, like WhatsApp:
//   computers: the Chats list on the left, the open conversation on the right (a welcome panel until one is opened)
//   phones: the Chats list, then the conversation as the next page (‹ or the phone's Back returns to the list)
// lists: my lists and letters (for "Lists you share" in Contact info) · onOpenList(id): open one of them
export default function Chat({ api, user, contacts, back, lists = [], onOpenList }) {
  const toast = useToast();
  const fromNote = () => new URLSearchParams(window.location.search).get('chat') === '1'; // opened from a notification
  const [inConv, setInConv] = useState(fromNote); // phones: the conversation page is showing
  const [selected, setSelected] = useState(fromNote); // computers: the conversation is open on the right
  const [info, setInfo] = useState(false); // Contact info
  const [jumpTo, setJumpTo] = useState(null); // a message to scroll to once the conversation is open
  const [person, setPerson] = useState(null);
  const { other } = api;
  useEffect(() => (other ? watchPerson(other, setPerson) : undefined), [other]);

  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // phones: the conversation is a step in the history, so Back returns to the list
  useEffect(() => {
    const onPop = () => { setInConv(!!window.history.state?.chatConv); setInfo(false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = (messageId = null) => {
    setJumpTo(messageId);
    if (wide) { setSelected(true); return; }
    if (inConv) return;
    const st = window.history.state || {};
    window.history.pushState({ ...st, depth: (st.depth || 0) + 1, chatConv: true }, '', window.location.href);
    setInConv(true);
  };
  const closeConv = () => {
    setInfo(false);
    if (window.history.state?.chatConv) window.history.back();
    else setInConv(false);
  };

  if (api.chat === undefined) return <div className="chat-page"><Loading variant="page" hint="Opening your chat" /></div>;
  if (!api.chat) return <StartChat user={user} contacts={contacts} back={back} />;

  const name = api.chat.names?.[other] || person?.displayName || (other || '').split('@')[0];
  const markRead = () => (api.unread ? markChatRead(api.chatId, user).then(() => toast('Marked as read')).catch(() => {}) : toast('No unread messages', 'info'));
  const listEl = (
    <ChatList api={api} user={user} person={person} name={name} active={wide && selected}
      onOpen={open} onMarkRead={markRead} onInfo={() => { open(); setInfo(true); }}
      onNewChat={() => toast(`This is your private chat with ${name}. Only two people can chat here.`, 'info')} />
  );
  const conv = (showBack) => (
    <Conversation key="conv" api={api} user={user} person={person} name={name} showBack={showBack}
      back={{ label: 'Chats', onClick: closeConv }} jumpTo={jumpTo} onJumped={() => setJumpTo(null)}
      onInfo={() => setInfo(true)} />
  );
  const infoEl = (
    <ContactInfo name={name} other={other} person={person} lists={lists} onClose={() => setInfo(false)}
      onOpenList={onOpenList} />
  );

  if (wide) {
    return (
      <div className={info && selected ? 'chat-page chat-shell wide with-info' : 'chat-page chat-shell wide'}>
        {listEl}
        {selected ? conv(false) : <ChatWelcome name={name} />}
        {selected && info && infoEl}
      </div>
    );
  }
  return (
    <div className="chat-page chat-shell">
      {!inConv ? listEl : info ? infoEl : conv(true)}
    </div>
  );
}

// Computers, before a chat is opened
function ChatWelcome({ name }) {
  return (
    <section className="chat-welcome">
      <span className="chat-welcome-ic" aria-hidden="true"><ChatIcon size={56} /></span>
      <h2>Your private chat</h2>
      <p>Pick the chat on the left to start talking with {name}.</p>
      <p className="chat-welcome-lock"><Svg name="lock" size={14} /> Only you and {name} can read it. Nobody else can ever join.</p>
    </section>
  );
}

// The Chats list: header, search, All / Unread, the chat, and messages matching the search
function ChatList({ api, user, person, name, active, onOpen, onMarkRead, onInfo, onNewChat }) {
  const { chat, other, me, unread, messages, hasMore, loadMore } = api;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const last = chat.last;
  const mine = last?.from === me;
  const typing = ms(chat.typing?.[other]) > Date.now() - TYPING_MS;
  const theirRead = ms(chat.readAt?.[other]);
  const theirDelivered = Math.max(theirRead, ms(chat.deliveredAt?.[other]));
  const state = mine ? tickState({ createdAt: last.at }, theirDelivered, theirRead) : null;
  const term = q.trim().toLowerCase();
  const showChat = (!term || name.toLowerCase().includes(term) || (other || '').includes(term)) && (filter === 'all' || unread > 0);
  const hits = term ? matchesOf(messages, q).reverse() : [];

  return (
    <aside className="chat-list" aria-label="Chats">
      <header className="chat-list-h">
        <h1>Chats</h1>
        <span className="wa-icons">
          <button type="button" className="wa-ic" onClick={onNewChat} aria-label="New chat" title="New chat"><Svg name="newChat" /></button>
          <DotsMenu label="Menu" items={[
            { label: 'Mark as read', onClick: onMarkRead },
            { label: 'Contact info', onClick: onInfo },
          ]} />
        </span>
      </header>
      <div className="wa-search">
        <Svg name="search" size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start a new chat"
          aria-label="Search chats and messages" autoComplete="off" onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
        {q && <button type="button" className="wa-ic small" onClick={() => setQ('')} aria-label="Clear search"><Svg name="close" size={16} /></button>}
      </div>
      <div className="wa-chips" role="tablist" aria-label="Show">
        {[['all', 'All'], ['unread', 'Unread']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'wa-chip on' : 'wa-chip'} onClick={() => setFilter(k)}>
            {label}{k === 'unread' && unread > 0 ? ` ${unread}` : ''}
          </button>
        ))}
      </div>

      <div className="chat-list-body">
        {term && <h3 className="wa-sec">Chats</h3>}
        {showChat ? (
          <ul className="chat-rows">
            <li>
              <button type="button" className={active ? 'chat-item on' : 'chat-item'} onClick={() => onOpen()}
                aria-label={`Chat with ${name}${unread ? `, ${unread} unread` : ''}`}>
                <Avatar person={{ email: other, displayName: name, photoURL: person?.photoURL || '' }} size={48} title={false} />
                <span className="chat-item-b">
                  <span className="chat-item-name"><Hl text={name} q={q} /></span>
                  <span className={typing ? 'chat-item-last typing' : 'chat-item-last'}>
                    {typing ? 'typing…' : last ? (
                      <>
                        {mine && <Ticks state={state} />}
                        <span className="chat-item-txt">{last.text || '🚫 This message was deleted'}</span>
                      </>
                    ) : <span className="chat-item-txt">Say hi 👋</span>}
                  </span>
                </span>
                <span className="chat-item-side">
                  <span className={unread ? 'chat-item-time unread' : 'chat-item-time'}>{listTime(last?.at || chat.createdAt)}</span>
                  {unread > 0 ? <span className="chat-item-count">{unread > 99 ? '99+' : unread}</span> : <span className="chat-item-count none" aria-hidden="true" />}
                </span>
              </button>
            </li>
          </ul>
        ) : (
          <p className="wa-empty">{filter === 'unread' && !term ? 'No unread chats' : 'No chats match'}</p>
        )}

        {term && (
          <>
            <h3 className="wa-sec">Messages</h3>
            {hits.length ? (
              <ul className="wa-hits">
                {hits.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="wa-hit" onClick={() => onOpen(m.id)}>
                      <span className="wa-hit-top"><b>{m.from === me ? 'You' : name}</b><span>{listTime(m.createdAt)}</span></span>
                      <span className="wa-hit-t">
                        {m.from === me && <Ticks state={tickState(m, theirDelivered, theirRead)} />}
                        <span><Hl text={m.text} q={q} /></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="wa-empty">No messages found{messages === null ? ' yet' : ''}</p>}
            {hasMore && <button type="button" className="link wa-older" onClick={loadMore}>Search older messages</button>}
          </>
        )}
      </div>
      <p className="chat-list-note"><Svg name="lock" size={12} /> Your private chat. Only the two of you can read it.</p>
    </aside>
  );
}

// Contact info: who they are, and the lists and love letters you share
function ContactInfo({ name, other, person, lists, onClose, onOpenList }) {
  const shared = lists.filter((l) => l.ownerEmail === other || (l.memberEmails || []).includes(other));
  const letters = shared.filter((l) => l.kind === 'letter');
  const todo = shared.filter((l) => l.kind !== 'letter');
  const row = (l) => {
    const access = l.role === 'owner' ? `Yours · ${name} can ${roleLabel(l.roles?.[other]).toLowerCase()}`
      : l.role === 'partner' ? `${name}'s · you can change everything, as partners`
      : `${name}'s · you can ${roleLabel(l.role).toLowerCase()}`;
    return (
      <li key={l.id}>
        <button type="button" className="ci-row" onClick={() => onOpenList?.(l.id)}>
          <i style={{ background: colorFor(l.id) }} aria-hidden="true" />
          <span className="ci-row-b"><b>{l.title}{l.archived ? ' (archived)' : ''}</b><span>{access}</span></span>
        </button>
      </li>
    );
  };
  return (
    <aside className="chat-info" aria-label="Contact info">
      <header className="chat-info-h">
        <button type="button" className="wa-ic" onClick={onClose} aria-label="Close contact info"><Svg name="close" /></button>
        <b>Contact info</b>
      </header>
      <div className="chat-info-body">
        <section className="ci-card">
          <Avatar person={{ email: other, displayName: name, photoURL: person?.photoURL || '' }} size={120} title={false} />
          <h2>{name}</h2>
          <p className="ci-em">{other}</p>
          <p className="ci-seen">{seenLabel(person) || 'Not active here yet'}</p>
        </section>
        <section className="ci-card ci-lock"><Svg name="lock" size={16} /> Private chat. Only you two can read it, and nobody else can join.</section>
        <section className="ci-card">
          <h3>Lists you share <span>{todo.length}</span></h3>
          {todo.length ? <ul className="ci-rows">{todo.map(row)}</ul> : <p className="ci-none">No shared to-do lists yet.</p>}
        </section>
        <section className="ci-card">
          <h3>Love letters <span>{letters.length}</span></h3>
          {letters.length ? <ul className="ci-rows">{letters.map(row)}</ul> : <p className="ci-none">No love letters between you yet.</p>}
        </section>
      </div>
    </aside>
  );
}

function StartChat({ user, contacts, back }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function start(e) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setErr("That isn't a valid email address.");
    if (v === emailOf(user)) return setErr("That's your own email. Use the other person's.");
    setBusy(true);
    try {
      await startChat(user, v);
      toast('Chat started');
    } catch (er) {
      setErr(friendlyError(er));
      setBusy(false);
    }
  }
  return (
    <div className="chat-page chat-start">
      <div className="chat-start-top"><BackLink back={back} /></div>
      <form className="chat-start-card" onSubmit={start}>
        <span className="chat-start-ic" aria-hidden="true"><ChatIcon size={30} /></span>
        <h1>Your private chat</h1>
        <p>A chat for just the two of you. Nobody else can ever join it or read it.</p>
        <label className="field">
          <span>Their email</span>
          <input type="email" inputMode="email" autoComplete="email" list="chat-contacts" autoFocus value={email}
            onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="name@example.com" />
          <datalist id="chat-contacts">{contacts.map((c) => <option key={c.email} value={c.email}>{displayName(c)}</option>)}</datalist>
        </label>
        {err && <p className="note err" role="alert">{err}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? <><Spinner aria-hidden="true" />Starting…</> : 'Start chatting'}</button>
        <p className="chat-start-note">They&apos;ll see it under Chat when they sign in with that email.</p>
      </form>
    </div>
  );
}

function Conversation({ api, user, person, name, showBack, back, jumpTo, onJumped, onInfo }) {
  const toast = useToast();
  const { chat, chatId, other, me, messages, hasMore, loadMore } = api;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);
  const typing = ms(chat.typing?.[other]) > Date.now() - TYPING_MS;
  // ✓✓ blue once they've read up to a message, ✓✓ grey once it reached their device (app open, or the notification)
  const theirRead = ms(chat.readAt?.[other]);
  const theirDelivered = Math.max(theirRead, ms(chat.deliveredAt?.[other]));

  // composer
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null); // the message being answered
  const [editing, setEditing] = useState(null); // my message being edited
  const [menu, setMenu] = useState(null); // { id, x, y }
  const [confirmDel, setConfirmDel] = useState(null);
  const [sending, setSending] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const input = useRef(null);
  const lastTyping = useRef(0);
  const coarse = useRef(false);
  useEffect(() => { coarse.current = window.matchMedia('(pointer: coarse)').matches; }, []);

  // search in the chat
  const [finding, setFinding] = useState(false);
  const [fq, setFq] = useState('');
  const [fi, setFi] = useState(0);
  const found = useMemo(() => matchesOf(messages, fq), [messages, fq]);

  // ---- scrolling: stay at the newest unless reading back; "↓ N new" while reading back
  const scroller = useRef(null);
  const atBottom = useRef(true);
  const [newCount, setNewCount] = useState(0);
  const prevLast = useRef(null);
  const keepFrom = useRef(null); // loading earlier messages: keep the view where it was
  const toBottom = (smooth) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewCount(0);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    if (keepFrom.current != null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.id === prevLast.current) return;
    const first = prevLast.current === null;
    prevLast.current = last.id;
    if (first || atBottom.current || last.from === me) toBottom(!first);
    else if (last.from !== me) setNewCount((n) => n + 1);
  }, [messages, me]);
  const onScroll = () => {
    const el = scroller.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newCount) setNewCount(0);
  };
  const earlier = () => { keepFrom.current = scroller.current.scrollHeight - scroller.current.scrollTop; loadMore(); };

  // ---- read: while the conversation is on screen
  const unreadNow = api.unread;
  useEffect(() => {
    if (!unreadNow) return undefined;
    const mark = () => document.visibilityState === 'visible' && markChatRead(chatId, user).catch(() => {});
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [unreadNow, chatId, user]);

  const jump = (id, quiet) => {
    const el = document.getElementById(`m-${id}`);
    if (!el) { if (!quiet) toast('That message is further back. Load earlier messages to see it.', 'info'); return false; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('cm-flash');
    setTimeout(() => el.classList.remove('cm-flash'), 1200);
    return true;
  };
  // opened from a search result: go to that message
  useEffect(() => {
    if (!jumpTo || !messages) return undefined;
    const t = setTimeout(() => { jump(jumpTo); onJumped(); }, 120);
    return () => clearTimeout(t);
  }, [jumpTo, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  // search: newest match first, ↑ goes further back
  useEffect(() => { setFi(0); }, [fq]);
  useEffect(() => {
    if (finding && found.length) jump(found[found.length - 1 - fi].id, true);
  }, [fi, found.length, finding]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d) => found.length && setFi((i) => (i + d + found.length) % found.length);
  const closeFind = () => { setFinding(false); setFq(''); };

  // ---- typing…
  function onType(v) {
    setText(v);
    const now = Date.now();
    if (v.trim() && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      setTyping(chatId, user, true).catch(() => {});
    } else if (!v.trim() && lastTyping.current) {
      lastTyping.current = 0;
      setTyping(chatId, user, false).catch(() => {});
    }
  }
  // an emoji from the picker, where the cursor is
  function insert(e) {
    const el = input.current;
    const a = el ? el.selectionStart : text.length;
    const b = el ? el.selectionEnd : text.length;
    const next = text.slice(0, a) + e + text.slice(b);
    onType(next);
    requestAnimationFrame(() => {
      if (!el) return;
      if (!coarse.current) el.focus();
      el.setSelectionRange(a + e.length, a + e.length);
    });
  }

  async function submit(e) {
    e?.preventDefault();
    const v = text.trim();
    if (!v || sending) return;
    if (v.length > MAX_MESSAGE) return toast(`Messages can be up to ${MAX_MESSAGE} characters.`, 'err');
    setSending(true);
    setEmoji(false);
    try {
      if (editing) {
        if (Date.now() - ms(editing.createdAt) >= EDIT_MINS * 60000) { setEditing(null); setText(''); return toast("This message can't be edited any more. Messages can be edited for 3 hours.", 'err'); }
        if (v !== editing.text) await editMessage(chatId, editing.id, v);
        setEditing(null);
      } else {
        const r = reply ? { id: reply.id, text: reply.text.slice(0, 300), from: reply.from } : null;
        setText('');
        setReply(null);
        lastTyping.current = 0;
        await sendMessage(chatId, user, v, r);
      }
      setText('');
    } catch (er) {
      setText(v);
      toast(`Not sent: ${friendlyError(er)}`, 'err');
    }
    setSending(false);
    input.current?.focus();
  }

  const startReply = (m) => { setEditing(null); setReply(m); setMenu(null); input.current?.focus(); };
  const startEdit = (m) => { setReply(null); setEditing(m); setText(m.text); setMenu(null); setTimeout(() => input.current?.focus(), 0); };
  const cancelBar = () => { if (editing) setText(''); setEditing(null); setReply(null); };
  const copy = (m) => { navigator.clipboard?.writeText(m.text).then(() => toast('Copied')).catch(() => {}); setMenu(null); };
  const remove = async (m) => {
    setConfirmDel(null);
    setMenu(null);
    try { await deleteMessage(chatId, m.id); } catch (er) { toast(friendlyError(er), 'err'); }
  };

  // close the message menu on click elsewhere / Esc
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.msg-menu')) setMenu(null); };
    const key = (e) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [menu]);

  // day separators and groups
  const rows = useMemo(() => {
    const out = [];
    let prev = null;
    for (const m of messages || []) {
      const d = toDate(m.createdAt);
      if (!prev || dayKey(toDate(prev.createdAt)) !== dayKey(d)) out.push({ day: dayLabel(d), key: `d-${m.id}` });
      const first = !prev || prev.from !== m.from || ms(m.createdAt) - ms(prev.createdAt) > GROUP_MS
        || dayKey(toDate(prev.createdAt)) !== dayKey(d);
      out.push({ m, first, key: m.id });
      prev = m;
    }
    return out;
  }, [messages]);

  const status = typing ? 'typing…' : seenLabel(person);
  const menuMsg = menu && (messages || []).find((x) => x.id === menu.id);
  const current = finding && found.length ? found[found.length - 1 - fi].id : null;
  const empty = !text.trim() && !editing;

  return (
    <div className="chat-conv">
      <header className="chat-h">
        {showBack && (
          <button type="button" className="wa-ic" onClick={back.onClick} aria-label="Back to Chats" title="Chats"><Svg name="back" /></button>
        )}
        <button type="button" className="chat-h-who" onClick={onInfo} title="Contact info">
          <Avatar person={{ email: other, displayName: name, photoURL: person?.photoURL || '' }} size={40} title={false} />
          <span className="chat-h-b">
            <b>{name}</b>
            <span className={typing ? 'chat-status typing' : 'chat-status'}>{status || 'tap here for contact info'}</span>
          </span>
        </button>
        <span className="wa-icons">
          <button type="button" className={finding ? 'wa-ic on' : 'wa-ic'} onClick={() => (finding ? closeFind() : setFinding(true))}
            aria-label="Search messages" title="Search messages"><Svg name="search" /></button>
          <DotsMenu label="Chat menu" items={[
            { label: 'Contact info', onClick: onInfo },
            { label: 'Search messages', onClick: () => setFinding(true) },
          ]} />
        </span>
      </header>

      {finding && (
        <div className="chat-find">
          <Svg name="search" size={16} />
          <input autoFocus value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Search messages" aria-label="Search messages"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowUp') { e.preventDefault(); step(1); }
              if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
              if (e.key === 'Escape') closeFind();
            }} />
          <span className="chat-find-n" aria-live="polite">{fq.trim() ? (found.length ? `${fi + 1} of ${found.length}` : 'No results') : ''}</span>
          <button type="button" className="wa-ic small" onClick={() => step(1)} disabled={!found.length} aria-label="Older match"><Svg name="up" size={18} /></button>
          <button type="button" className="wa-ic small" onClick={() => step(-1)} disabled={!found.length} aria-label="Newer match"><Svg name="down" size={18} /></button>
          <button type="button" className="wa-ic small" onClick={closeFind} aria-label="Close search"><Svg name="close" size={18} /></button>
        </div>
      )}

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat-inner">
          {hasMore && <button type="button" className="chat-earlier" onClick={earlier}>Load earlier messages</button>}
          <p className="chat-e2e"><Svg name="lock" size={12} /> Only you and {name} can read this chat. Nobody else can join it.</p>
          {messages === null ? <Loading hint="Getting your messages" /> : messages.length === 0 && (
            <p className="chat-empty">Say hi to {name} 👋</p>
          )}
          {rows.map((r) => (r.day ? (
            <div key={r.key} className="chat-day"><span>{r.day}</span></div>
          ) : (
            <Bubble key={r.key} m={r.m} first={r.first} mine={r.m.from === me} name={name} me={me}
              tick={tickState(r.m, theirDelivered, theirRead)} q={finding ? fq : ''} current={current === r.m.id}
              onMenu={(x, y) => setMenu({ id: r.m.id, x, y })} onReply={() => startReply(r.m)} onJump={jump} />
          )))}
          {typing && <div className="cm cm-theirs cm-first"><div className="cm-b cm-typing" aria-label={`${name} is typing`}><i /><i /><i /></div></div>}
        </div>
      </div>

      {newCount > 0 && (
        <button type="button" className="chat-new" onClick={() => toBottom(true)}>↓ {newCount} new message{newCount > 1 ? 's' : ''}</button>
      )}

      {menuMsg && (
        <div className="msg-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}>
          {!menuMsg.deleted && <button type="button" role="menuitem" onClick={() => startReply(menuMsg)}>Reply</button>}
          {!menuMsg.deleted && <button type="button" role="menuitem" onClick={() => copy(menuMsg)}>Copy</button>}
          {menuMsg.from === me && !menuMsg.deleted && Date.now() - ms(menuMsg.createdAt) < EDIT_MINS * 60000 && (
            <button type="button" role="menuitem" onClick={() => startEdit(menuMsg)}>Edit</button>
          )}
          {menuMsg.from === me && !menuMsg.deleted && (confirmDel === menuMsg.id ? (
            <button type="button" role="menuitem" className="danger" onClick={() => remove(menuMsg)}>Tap again to delete for everyone</button>
          ) : (
            <button type="button" role="menuitem" className="danger" onClick={() => setConfirmDel(menuMsg.id)}>Delete for everyone</button>
          ))}
        </div>
      )}

      <form className="chat-compose" onSubmit={submit}>
        {emoji && <EmojiPicker onPick={insert} onClose={() => setEmoji(false)} />}
        {(reply || editing) && (
          <div className="chat-bar">
            <div className="chat-bar-b">
              <b>{editing ? 'Edit message' : reply.from === me ? 'You' : name}</b>
              <span>{(editing || reply).text}</span>
            </div>
            <button type="button" className="ic" onClick={cancelBar} aria-label="Cancel">✕</button>
          </div>
        )}
        <div className="chat-row">
          <div className="chat-pill">
            <button type="button" className={emoji ? 'wa-ic on' : 'wa-ic'} onClick={() => setEmoji((o) => !o)}
              aria-label={emoji ? 'Close emoji' : 'Emoji'} aria-expanded={emoji} title="Emoji"><Svg name="smile" size={22} /></button>
            <textarea ref={input} className="chat-in" rows={1} value={text} maxLength={MAX_MESSAGE} placeholder="Type a message"
              aria-label="Message" enterKeyHint={coarse.current ? 'enter' : 'send'}
              onChange={(e) => onType(e.target.value)}
              onBlur={() => { if (lastTyping.current) { lastTyping.current = 0; setTyping(chatId, user, false).catch(() => {}); } }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !coarse.current) { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { if (emoji) setEmoji(false); else if (reply || editing) cancelBar(); }
              }} />
          </div>
          {empty ? (
            <button type="button" className="chat-send" onClick={() => toast("Voice notes aren't available yet. Type a message instead.", 'info')}
              aria-label="Voice note (not available yet)" title="Voice notes aren't available yet"><Svg name="mic" size={22} /></button>
          ) : (
            <button type="submit" className="chat-send" disabled={sending} aria-label={editing ? 'Save' : 'Send'}>
              {editing ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// One message. Long-press (phones) or the ⌄ (computers) for Reply / Copy / Edit / Delete; swipe right to reply.
// q: the in-chat search (matches highlighted) · current: the match being shown
function Bubble({ m, first, mine, name, me, tick, q, current, onMenu, onReply, onJump }) {
  const d = toDate(m.createdAt);
  const press = useRef(null);
  const [dx, setDx] = useState(0);
  const big = !m.deleted && !q && bigEmoji(m.text);
  const hit = q && !m.deleted && m.text.toLowerCase().includes(q.trim().toLowerCase()) && q.trim();

  const down = (e) => {
    if (e.target.closest('a, button')) return;
    const start = { x: e.clientX, y: e.clientY, t: null, swiping: false };
    if (e.pointerType !== 'mouse') start.t = setTimeout(() => { navigator.vibrate?.(15); onMenu(e.clientX, e.clientY); press.current = null; }, 480);
    press.current = start;
  };
  const move = (e) => {
    const p = press.current;
    if (!p) return;
    const mx = e.clientX - p.x;
    if (Math.abs(e.clientY - p.y) > 12 || Math.abs(mx) > 8) clearTimeout(p.t);
    if (e.pointerType !== 'mouse' && mx > 10 && Math.abs(e.clientY - p.y) < 30) { p.swiping = true; setDx(Math.min(mx, 80)); }
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (p) clearTimeout(p.t);
    if (p?.swiping && dx > 55 && !m.deleted) onReply();
    setDx(0);
  };

  return (
    <div id={`m-${m.id}`} className={['cm', mine ? 'cm-mine' : 'cm-theirs', first && 'cm-first', current && 'cm-current'].filter(Boolean).join(' ')}>
      <div className={['cm-b', big && 'cm-big', m.deleted && 'cm-deleted'].filter(Boolean).join(' ')}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
        {m.reply && !m.deleted && (
          <button type="button" className="cm-quote" onClick={() => onJump(m.reply.id)}>
            <b>{m.reply.from === me ? 'You' : name}</b>
            <span>{m.reply.text}</span>
          </button>
        )}
        {m.deleted ? (
          <span className="cm-t">🚫 {mine ? 'You deleted this message' : 'This message was deleted'}</span>
        ) : (
          <span className="cm-t">{hit ? <Hl text={m.text} q={q} /> : <Linked text={m.text} />}</span>
        )}
        <span className="cm-meta">
          {m.editedAt && !m.deleted && <em>edited</em>}
          {clock(d)}
          {mine && !m.deleted && <Ticks state={tick} />}
        </span>
        {!m.deleted && (
          <button type="button" className="cm-more" aria-label="Message options"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left, r.bottom + 4); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// Like WhatsApp: 🕓 sending (not on the server yet) · ✓ sent · ✓✓ delivered (grey) · ✓✓ read (blue)
export function tickState(m, deliveredAt, readAt) {
  if (m.pending) return 'pending';
  const at = ms(m.createdAt);
  if (readAt >= at) return 'read';
  if (deliveredAt >= at) return 'delivered';
  return 'sent';
}
const TICK_LABEL = { pending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

function Ticks({ state }) {
  return (
    <span className={`cm-ticks ${state}`} title={TICK_LABEL[state]} aria-label={TICK_LABEL[state]}>
      {state === 'pending' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      ) : (
        <svg width="17" height="11" viewBox="0 0 17 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 6l3 3 6.5-8" />
          {state !== 'sent' && <path d="M7 8.6l.9.9 6.5-8" />}
        </svg>
      )}
    </span>
  );
}

export function ChatIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
    </svg>
  );
}
