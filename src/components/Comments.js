'use client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Copy, Ellipsis, Heart, MessageCircle, Pencil, Reply, Trash2 } from 'lucide-react';
import { friendlyError } from '@/lib/firebase';
import { addComment, deleteComment, editComment, emailOf, likeComment } from '@/lib/data';
import { Avatar, toDate } from '@/lib/people';
import { useDraft } from '@/lib/useDraft';
import { commentMs } from '@/lib/useCommentsSeen';
import { useToast } from './Toast';

const MAX = 2000;
const GROUP_MS = 5 * 60 * 1000; // one person's comments this close together share a name and avatar
const QUICK = ['Any update?', 'Done ✓', 'Need help with this'];

// A hardware keyboard and a mouse: Enter sends. On touch screens Enter is a new line and the button sends.
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function dayLabel(d) {
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}
const clock = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
// Instagram-style short times: now, 5m, 2h, 3d, then the date
function ago(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
}
const EMOJI = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];
// The list page narrower than this shows Tasks | Comments as tabs (globals.css, @container lv) and the comments
// switch to the phone layout: a flat list like Instagram's instead of chat bubbles
const COMPACT_BELOW = 720;
const firstName = (c) => (c.userName || c.userEmail || 'Someone').split(/[\s@]/)[0];

// @mentions stand out in the text
function Text({ text }) {
  const parts = text.split(/(@[\p{L}\p{N}._-]+)/u);
  return parts.map((p, i) => (i % 2 ? <span key={i} className="c-mention">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}

export default function Comments({ list, comments, user, isOwner, hint, seen = null, seenReady = true, onSeen }) {
  const listId = list.id;
  const toast = useToast();
  const [text, setText] = useDraft(`draft:comment:${listId}`);
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const [editing, setEditing] = useState(null); // the id of my comment being edited (one at a time)
  const [draft, setDraft] = useState('');
  const [editW, setEditW] = useState(0); // the bubble's width when editing began
  const [confirmDel, setConfirmDel] = useState(null); // the id waiting for a second tap on Delete
  const [sheet, setSheet] = useState(null); // the comment whose actions are open as a bottom sheet (touch)
  const [since, setSince] = useState(null); // "last read" as it was when I opened this list; the New line sits after it
  const me = emailOf(user);

  // phone-sized page: Instagram-style list. Measured on the list page, the same box the tabs go by.
  const rootRef = useRef(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const host = rootRef.current?.closest('.list-wrap') || rootRef.current;
    if (!host) return;
    const check = () => setCompact(host.clientWidth > 0 && host.clientWidth < COMPACT_BELOW);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // take the "last read" time once per list, so the New line doesn't jump while I'm reading
  useEffect(() => { setSince(null); }, [listId]);
  useEffect(() => { if (seenReady) setSince((s) => s ?? seen ?? 0); }, [seenReady, seen, listId]);

  // stick to the bottom as comments arrive (after layout, and again once the New line is in)
  const hasSince = since !== null;
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const f = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(f);
  }, [comments.length, hasSince]);

  // and when the thread comes into view (a hidden tab has no height to scroll while it's hidden)
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) el.scrollTop = el.scrollHeight; });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // While the thread is on screen (not behind the Tasks tab), everything in it counts as read
  const newest = useMemo(() => comments.reduce((m, c) => Math.max(m, commentMs(c) || 0), 0), [comments]);
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !onSeen || !newest) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) onSeen(newest); });
    io.observe(el);
    return () => io.disconnect();
  }, [newest, onSeen]);

  // the write box grows with what's typed, up to about six lines
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }, [text]);

  // the second tap on Delete has to come soon
  useEffect(() => {
    if (!confirmDel) return;
    const t = setTimeout(() => setConfirmDel(null), 4000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  // the same people notify() in lib/data.js writes to
  const listeners = useMemo(() => {
    const roles = list.roles || {};
    const fromEmail = (e) => { const n = e.split('@')[0]; return n.charAt(0).toUpperCase() + n.slice(1); };
    return [
      ...(list.ownerEmail && list.ownerEmail !== me ? [list.ownerName || fromEmail(list.ownerEmail)] : []),
      ...Object.keys(roles).filter((e) => e !== me && (roles[e] === 'comment' || roles[e] === 'readwrite')).map(fromEmail),
    ];
  }, [list.roles, list.ownerEmail, list.ownerName, me]);
  const names = listeners.length <= 2 ? listeners.join(' and ') : `${listeners.length} people`;
  const whoHears = () => (listeners.length ? `${names} notified` : 'only you can see it');

  // ---- the thread, with day dividers, the New line, and runs of one person grouped
  const rows = useMemo(() => {
    let firstNew = -1;
    if (since) firstNew = comments.findIndex((c) => c.userId !== user.uid && (commentMs(c) || 0) > since);
    const newCount = firstNew < 0 ? 0 : comments.slice(firstNew).filter((c) => c.userId !== user.uid).length;
    return comments.map((c, i) => {
      const d = toDate(c.createdAt);
      const prev = comments[i - 1];
      const pd = prev && toDate(prev.createdAt);
      const showDay = !prev || dayKey(pd) !== dayKey(d);
      const showNew = i === firstNew;
      const cont = !!prev && !showDay && !showNew && prev.userId === c.userId && d - pd < GROUP_MS;
      return { c, d, showDay, showNew, newCount, cont, mine: c.userId === user.uid };
    });
  }, [comments, since, user.uid]);

  function send(e) {
    e?.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    setSince(Number.MAX_SAFE_INTEGER); // replying clears the New line
    addComment(list, user, v)
      .then(() => toast(`Comment sent · ${whoHears()}`))
      .catch((err) => {
        setText(v);
        toast(`Comment not sent: ${friendlyError(err)}`, 'err');
      });
  }

  function startEdit(c) {
    // keep the bubble the width it is now, so editing doesn't make it jump (a little wider if it's tiny)
    const b = threadRef.current?.querySelector(`[data-cid="${c.id}"] .bubble`);
    setEditW(b ? Math.ceil(b.getBoundingClientRect().width) : 0);
    setSheet(null);
    setEditing(c.id);
    setDraft(c.text);
  }

  // Unchanged or emptied: just close (Delete is how a comment goes away). If it's refused, reopen with my words.
  function saveEdit(c) {
    const v = draft.trim();
    setEditing(null);
    if (!v || v === c.text) return;
    editComment(list, c.id, user, v)
      .then(() => toast(`Comment updated · ${whoHears()}`))
      .catch((err) => {
        setEditing(c.id);
        setDraft(v);
        toast(`Comment not saved: ${friendlyError(err)}`, 'err');
      });
  }

  // first tap arms it, second deletes
  function remove(c) {
    if (confirmDel !== c.id) return setConfirmDel(c.id);
    setConfirmDel(null);
    setSheet(null);
    deleteComment(list, c, user)
      .then(() => toast('Comment deleted'))
      .catch((err) => toast(friendlyError(err), 'err'));
  }

  // ♥ a comment (or take it back). force=true is the double-tap: it only ever likes.
  const [pop, setPop] = useState(null); // the heart that just got liked, for its little bounce
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(null), 450);
    return () => clearTimeout(t);
  }, [pop]);
  const likedByMe = (c) => (c.likes || []).includes(user.uid);
  function toggleLike(c, force) {
    const was = likedByMe(c);
    const on = force ?? !was;
    if (on === was) return;
    if (on) { setPop(c.id); navigator.vibrate?.(6); }
    likeComment(list, c, user, on).catch((err) => toast(`Couldn't ${on ? 'like' : 'unlike'} that: ${friendlyError(err)}`, 'err'));
  }
  // "Liked by you and 2 others" for the heart's tooltip / screen readers
  function likedBy(c) {
    const n = (c.likes || []).length;
    if (!n) return 'Like';
    const mine = likedByMe(c);
    const others = n - (mine ? 1 : 0);
    if (mine) return others ? `Liked by you and ${others} other${others > 1 ? 's' : ''}` : 'Liked by you';
    return `${n} like${n > 1 ? 's' : ''}`;
  }

  function copy(c) {
    setSheet(null);
    Promise.resolve(navigator.clipboard?.writeText(c.text))
      .then(() => toast('Comment copied'))
      .catch(() => toast("Couldn't copy that comment", 'err'));
  }

  function reply(c) {
    setSheet(null);
    const tag = `@${firstName(c)} `;
    setText(text.startsWith(tag) ? text : tag + text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function pickQuick(q) {
    setText(q);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // the emoji row: put it where the cursor is
  function addEmoji(em) {
    const el = inputRef.current;
    const at = el && document.activeElement === el ? el.selectionStart : text.length;
    const next = (text.slice(0, at) + em + text.slice(at)).slice(0, MAX);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + em.length, at + em.length);
    });
  }

  // touch: press and hold a comment for its actions
  const press = useRef(null);
  const holdStart = (c) => (e) => {
    if (e.pointerType !== 'touch' || editing === c.id) return;
    const { clientX: x, clientY: y } = e;
    press.current = { x, y, t: setTimeout(() => { press.current = null; setConfirmDel(null); setSheet(c); navigator.vibrate?.(8); }, 450) };
  };
  const holdMove = (e) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.t); press.current = null; }
  };
  const holdEnd = () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } };

  const left = MAX - text.length;
  const canDelete = (c) => c.userId === user.uid || isOwner;
  const openSheet = (c) => { setConfirmDel(null); setSheet(c); };
  const pressProps = (c) => ({
    onPointerDown: holdStart(c),
    onPointerMove: holdMove,
    onPointerUp: holdEnd,
    onPointerCancel: holdEnd,
    onContextMenu: (e) => { if (window.matchMedia?.('(hover: none)').matches) e.preventDefault(); },
  });

  // Editing my own comment: the comment stays as it looks, its text just becomes editable, with Cancel / Save under it.
  // The box grows with the text like the comment does (field-sizing where supported, by hand elsewhere).
  const grow = (el) => {
    if (!el || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  const editField = (c, className) => (
    <textarea
      className={`c-edit-tx ${className}`}
      ref={grow}
      autoFocus
      rows={1}
      value={draft}
      maxLength={MAX}
      aria-label="Edit your comment"
      onFocus={(e) => {
        e.target.setSelectionRange(e.target.value.length, e.target.value.length);
        e.target.closest('.c, .ig')?.scrollIntoView({ block: 'nearest' }); // Save and Cancel in view too
      }}
      onChange={(e) => { setDraft(e.target.value); grow(e.target); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); saveEdit(c); }
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } // close just the editor, not the panel it's in
      }}
    />
  );
  const editActions = (c, className) => (
    <div className={`c-edit-b ${className}`}>
      <span className="c-edit-keys">Esc to cancel · Enter to save</span>
      <button type="button" className="c-edit-cancel" onClick={() => setEditing(null)}>Cancel</button>
      <button type="button" className="c-edit-save" onClick={() => saveEdit(c)} disabled={!draft.trim()}>Save</button>
    </div>
  );

  // Phones: one comment like Instagram's. [avatar] name · 2h / the text / Reply · Edit · ⋯
  const igRow = ({ c, d, showNew, newCount, mine }) => (
    <Fragment key={c.id}>
      {showNew && <div className="c-new" role="separator">New · {newCount}</div>}
      <div
        data-cid={c.id}
        className={`ig${mine ? ' mine' : ''}${editing === c.id ? ' is-editing' : ''}`}
        {...(editing === c.id ? {} : { ...pressProps(c), onDoubleClick: (e) => { e.preventDefault(); toggleLike(c, true); } })}
      >
        <Avatar person={{ email: c.userEmail, displayName: c.userName }} size={34} />
        <div className="ig-body">
          <div className="ig-top">
            <b className="ig-name">{mine ? 'You' : c.userName || c.userEmail}</b>
            <time dateTime={d.toISOString()} title={d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}>
              {c.createdAt ? ago(d) : 'Posting…'}
            </time>
          </div>
          {editing === c.id ? (
            <>
              {editField(c, 'ig-tx')}
              {editActions(c, 'ig-acts')}
            </>
          ) : (
            <>
              <p className="ig-tx"><Text text={c.text} /></p>
              <div className="ig-acts">
                {c.editedAt && <span className="ig-edited" title={`Edited ${toDate(c.editedAt).toLocaleString()}`}>Edited</span>}
                {!mine && <button type="button" onClick={() => reply(c)}>Reply</button>}
                {mine && <button type="button" onClick={() => startEdit(c)}>Edit</button>}
                <button type="button" className="ig-more" aria-label="More actions" onClick={() => openSheet(c)}><Ellipsis size={16} /></button>
              </div>
            </>
          )}
        </div>
        <LikeButton c={c} liked={likedByMe(c)} pop={pop === c.id} label={likedBy(c)} onClick={() => toggleLike(c)} className="ig-heart" />
      </div>
    </Fragment>
  );

  // Phones: the emoji row, then [my avatar] [Add a comment…  Post]
  const firstListener = listeners.length === 1 ? listeners[0] : null;
  const igForm = (
    <form className="c-form ig-form" onSubmit={send}>
      <div className="ig-emoji" aria-label="Add an emoji">
        {EMOJI.map((em) => <button key={em} type="button" onClick={() => addEmoji(em)} aria-label={`Add ${em}`}>{em}</button>)}
      </div>
      <div className="ig-compose">
        <Avatar person={{ email: me, displayName: user.displayName }} size={34} />
        <div className="ig-input">
          <textarea
            id="comment-text"
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX}
            aria-label="Write a comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); send(); } }}
            placeholder={firstListener ? `Add a comment for ${firstListener}…` : 'Add a comment…'}
          />
          <button className="ig-post" type="submit" disabled={!text.trim()}>Post</button>
        </div>
      </div>
      {left < 200 && <div className="c-foot"><span className={`c-left${left < 50 ? ' low' : ''}`}>{left} left</span></div>}
    </form>
  );

  return (
    <aside className={`panel comments${compact ? ' is-compact' : ''}`} aria-label="Comments" ref={rootRef}>
      <div className="panel-h">
        <h2>Comments</h2>
        <span className="count">{comments.length}</span>
      </div>
      {hint && <div className="hint">{hint}</div>}

      <div className="thread" ref={threadRef}>
        {comments.length === 0 && (
          <div className="c-empty">
            <span className="c-empty-ic" aria-hidden="true"><MessageCircle size={24} /></span>
            <b>No comments yet</b>
            <p>
              Ask a question or leave an update
              {listeners.length ? ` — ${names} will get a notification.` : '. Only you can see it for now.'}
            </p>
            <div className="c-quick">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => pickQuick(q)}>{q}</button>)}
            </div>
          </div>
        )}

        {rows.map((row) => {
          if (compact) return igRow(row);
          const { c, d, showDay, showNew, newCount, cont, mine } = row;
          const full = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
          return (
            <Fragment key={c.id}>
              {showDay && <div className="c-day" role="separator"><span>{dayLabel(d)}</span></div>}
              {showNew && <div className="c-new" role="separator">New · {newCount}</div>}
              <div data-cid={c.id} className={`c${mine ? ' mine' : ''}${cont ? ' cont' : ''}${editing === c.id ? ' is-editing' : ''}`}>
                {!mine && (cont ? <span className="c-sp" /> : <Avatar person={{ email: c.userEmail, displayName: c.userName }} size={28} />)}
                <div className="c-col">
                  {(!cont || c.editedAt) && (
                    <div className="nm">
                      {!cont && !mine && <b>{c.userName || c.userEmail}</b>}
                      {!cont && <time className="tm" dateTime={d.toISOString()} title={full}>{c.createdAt ? clock(d) : 'sending…'}</time>}
                      {c.editedAt && (
                        <span className="tm c-edited" title={`Edited ${toDate(c.editedAt).toLocaleString()}`}>{cont ? 'edited' : '· edited'}</span>
                      )}
                    </div>
                  )}

                  {editing === c.id ? (
                    <>
                      <div className="bubble is-edit" style={{ width: `min(100%, ${Math.max(editW, 240)}px)` }}>
                        {editField(c, 'tx')}
                      </div>
                      {editActions(c, 'c-edit-under')}
                    </>
                  ) : (
                    <div className="bubble" title={cont ? full : undefined} {...pressProps(c)}>
                      <div className="tx"><Text text={c.text} /></div>
                      {/* mouse and keyboard: a small toolbar on hover or focus */}
                      <div className="c-tools" role="toolbar" aria-label="Comment actions">
                        <button type="button" className={`like${likedByMe(c) ? ' on' : ''}`} onClick={() => toggleLike(c)}
                          aria-pressed={likedByMe(c)} aria-label={likedByMe(c) ? 'Unlike' : 'Like'} title={likedByMe(c) ? 'Unlike' : 'Like'}>
                          <Heart size={14} fill={likedByMe(c) ? 'currentColor' : 'none'} />
                        </button>
                        {!mine && <button type="button" onClick={() => reply(c)} aria-label="Reply" title="Reply"><Reply size={14} /></button>}
                        <button type="button" onClick={() => copy(c)} aria-label="Copy text" title="Copy"><Copy size={14} /></button>
                        {mine && <button type="button" onClick={() => startEdit(c)} aria-label="Edit comment" title="Edit"><Pencil size={14} /></button>}
                        {canDelete(c) && (
                          <button type="button" className={`del${confirmDel === c.id ? ' on' : ''}`} onClick={() => remove(c)}
                            aria-label={confirmDel === c.id ? 'Confirm delete' : 'Delete comment'} title="Delete">
                            <Trash2 size={14} />{confirmDel === c.id && <span>Delete?</span>}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {/* a little ♥ count under the bubble once someone has liked it */}
                  {(c.likes || []).length > 0 && (
                    <LikeButton c={c} liked={likedByMe(c)} pop={pop === c.id} label={likedBy(c)} onClick={() => toggleLike(c)} className="c-likes" />
                  )}
                </div>
                {editing !== c.id && (
                  <button className="c-more" type="button" aria-label="Comment actions" onClick={() => openSheet(c)}>
                    <Ellipsis size={18} />
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {compact ? igForm : <form className="c-form" onSubmit={send}>
        {!hint && listeners.length > 0 && (
          <div className="c-notify"><i aria-hidden="true" />{names} will be notified</div>
        )}
        <div className="c-box">
          <textarea
            id="comment-text"
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX}
            aria-label="Write a comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); send(); } }}
            placeholder="Write a comment…"
          />
          <button className="c-send" type="submit" disabled={!text.trim()} aria-label="Send comment">
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
        <div className="c-foot">
          <span className="c-keys">Enter to send · Shift+Enter for a new line</span>
          {left < 200 && <span className={`c-left${left < 50 ? ' low' : ''}`}>{left} left</span>}
        </div>
      </form>}

      {sheet && <ActionSheet c={sheet} mine={sheet.userId === user.uid} canDelete={canDelete(sheet)} confirm={confirmDel === sheet.id}
        onReply={() => reply(sheet)} onCopy={() => copy(sheet)} onEdit={() => startEdit(sheet)} onDelete={() => remove(sheet)}
        onClose={() => { setSheet(null); setConfirmDel(null); }} />}
    </aside>
  );
}

// Touch: a comment's actions in a sheet up from the bottom, with big rows to tap
function ActionSheet({ c, mine, canDelete, confirm, onReply, onCopy, onEdit, onDelete, onClose }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  // once on open: focus the first action, Escape closes, and focus goes back where it was
  useEffect(() => {
    const back = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); back?.focus?.({ preventScroll: true }); };
  }, []);

  return createPortal(
    <div className="c-sheet-scrim" onClick={onClose}>
      <div className="c-sheet" role="dialog" aria-modal="true" aria-label="Comment actions" ref={ref} onClick={(e) => e.stopPropagation()}>
        <span className="c-sheet-grab" aria-hidden="true" />
        <p className="c-sheet-q">{c.text}</p>
        {!mine && <button type="button" onClick={onReply}><Reply size={20} />Reply</button>}
        <button type="button" onClick={onCopy}><Copy size={20} />Copy text</button>
        {mine && <button type="button" onClick={onEdit}><Pencil size={20} />Edit</button>}
        {canDelete && (
          <button type="button" className="del" onClick={onDelete}>
            <Trash2 size={20} />{confirm ? 'Tap again to delete' : 'Delete comment'}
          </button>
        )}
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}

// The ♥ with its count: on the right of each comment on phones (like Instagram), under the bubble otherwise
function LikeButton({ c, liked, pop, label, onClick, className }) {
  const n = (c.likes || []).length;
  return (
    <button type="button" className={`${className}${liked ? ' on' : ''}${pop ? ' pop' : ''}`} onClick={onClick}
      aria-pressed={liked} aria-label={liked ? `Unlike. ${label}` : `Like. ${label}`} title={label}>
      <Heart size={className === 'ig-heart' ? 15 : 12} strokeWidth={2} fill={liked ? 'currentColor' : 'none'} />
      {n > 0 && <span>{n}</span>}
    </button>
  );
}
