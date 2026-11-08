'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import { renameList, saveLetterBody, watchComments } from '@/lib/data';
import { PERMISSIONS, canComment, canWrite, roleLabel } from '@/lib/permissions';
import { displayName, shownName, timeAgo } from '@/lib/people';
import PeopleStack from './PeopleStack';
import BackLink from './BackLink';
import { useToast } from './Toast';
import Comments from './Comments';
import { unreadCount, useCommentsSeen } from '@/lib/useCommentsSeen';
import ShareModal from './ShareModal';
import { BurntPaper } from './Letters';

const MAX_BODY = 20000;

// One love letter: the letter on burnt paper, and the comment thread beside it.
// Works like a list (same access levels), but it's shared with one person at most.
export default function LetterView({ list, role, user, contacts, back, focusComments = null, onLeave, onDelete, onArchive, menu }) {
  const toast = useToast();
  const write = canWrite(role);
  const comment = canComment(role);
  const isOwner = role === 'owner';

  const [comments, setComments] = useState([]);
  const [pane, setPane] = useState('letter'); // phones show the Letter or Comments, one at a time
  // opened from a comment notification: show the comments (the phone tab too), with the box ready to reply
  useEffect(() => { if (focusComments && comment) setPane('comments'); }, [focusComments, comment]);
  const [shareOpen, setShareOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(list.title);

  useEffect(() => setTitle(list.title), [list.title]);

  const members = useMemo(
    () => Object.entries(list.roles || {}).map(([email, permission]) => ({ email, permission })),
    [list.roles],
  );
  const recipient = members[0] || null;
  const named = Object.fromEntries(contacts.map((c) => [c.email, c]));

  // ---- tell the owner when the person it's for leaves while they're looking at it
  const left = useMemo(() => list.leftEmails || [], [list.leftEmails]);
  const prevLeft = useRef(left);
  useEffect(() => {
    if (isOwner) left.filter((e) => !prevLeft.current.includes(e)).forEach((e) => toast(`${e} left “${list.title}”`));
    prevLeft.current = left;
  }, [left, isOwner, list.title, toast]);

  // ---- live comments, only for roles that can see them
  useEffect(() => {
    if (!comment) return setComments([]);
    return watchComments(list.id, setComments, () => setComments([]));
  }, [list.id, comment]);
  const seenComments = useCommentsSeen(list.id, user.uid);
  const unread = unreadCount(comments, user.uid, seenComments.seen);

  async function saveTitle(e) {
    e?.preventDefault();
    const t = title.trim();
    setRenaming(false);
    if (!t || t === list.title) return setTitle(list.title);
    renameList(list, user, t).catch((err) => toast(`Not saved: ${friendlyError(err)}`, 'err'));
  }

  const owner = { email: list.ownerEmail, displayName: list.ownerName };
  const toPerson = recipient ? named[recipient.email] || { email: recipient.email } : null;

  return (
    <div className="list-wrap letter-wrap">
      <header className="bar lv-bar">
        <div className="bar-left">
          <BackLink back={back} />
          {renaming ? (
            <form onSubmit={saveTitle} className="rename">
              <input id="list-title" autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} />
            </form>
          ) : (
            <h1 onDoubleClick={() => isOwner && setRenaming(true)} title={isOwner ? 'Double-click to edit the title' : undefined}>{list.title}</h1>
          )}
          <div className="meta">
            {isOwner
              ? toPerson ? `A love letter to ${displayName(toPerson)}` : 'A love letter · not sent to anyone yet'
              : `A love letter from ${shownName(list.ownerName, list.ownerEmail) || list.ownerEmail}`}
            {isOwner && left.length > 0 && !recipient && ` · ${left[0]} left`}
          </div>
        </div>
        <div className="bar-right">
          <PeopleStack people={toPerson ? [owner, toPerson] : [owner]} me={user} />
          {isOwner ? (
            <>
              <button className="btn lv-rename" type="button" onClick={() => setRenaming(true)}>Edit title</button>
              <button className="btn primary" type="button" onClick={() => setShareOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg>
                {recipient ? 'Recipient' : 'Send'}
              </button>
            </>
          ) : role === 'partner' ? null : (
            <button className="btn" type="button" onClick={() => onLeave(list)}>Leave letter</button>
          )}
          {menu}
        </div>
      </header>

      {list.archived && (
        <div className="banner archived-banner">
          <span>This letter is archived. It&apos;s kept just as it is, out of the way.</span>
          {isOwner && <button className="btn" type="button" onClick={() => onArchive(list)}>Unarchive</button>}
        </div>
      )}

      {!isOwner && (
        <div className="banner">
          {role === 'partner' ? (
            <>Your partner <b>{shownName(list.ownerName, list.ownerEmail) || list.ownerEmail}</b>&apos;s letter. You can write in it; only they can delete it or choose who it&apos;s for.</>
          ) : (
            <>You have <b>{roleLabel(role)}</b> access. {letterDesc(role)}</>
          )}
        </div>
      )}

      {/* phones: the Letter and Comments as two tabs */}
      {comment && (
        <div className="seg lv-tabs" role="tablist" aria-label="Letter sections">
          <button type="button" role="tab" aria-selected={pane === 'letter'} className={pane === 'letter' ? 'on' : ''} onClick={() => setPane('letter')}>
            Letter
          </button>
          <button type="button" role="tab" aria-selected={pane === 'comments'} className={pane === 'comments' ? 'on' : ''} onClick={() => setPane('comments')}>
            Comments <span>{comments.length}</span>{unread > 0 && <i className="lv-dot" aria-label={`${unread} new`} />}
          </button>
        </div>
      )}

      <div className="page-body">
      <div className={`${comment ? 'grid' : 'grid solo'} show-${pane === 'letter' ? 'tasks' : 'comments'}`}>
        <section className="lv-tasks letter-sheet">
          <BurntPaper seed={list.id} tilt={false} className="letter-paper">
            <h2 className="letter-title">{list.title}</h2>
            <LetterBody key={list.id} list={list} user={user} canEdit={write && !list.archived} />
            <p className="letter-sign">— {'Your Adam 🥰' || list.ownerName || list.ownerEmail}</p>
          </BurntPaper>
        </section>

        {comment && (
          <Comments
            focus={focusComments}
            list={list}
            comments={comments}
            user={user}
            isOwner={isOwner}
            seen={seenComments.seen}
            seenReady={seenComments.ready}
            onSeen={seenComments.markSeen}
            hint={isOwner && !(recipient && canComment(recipient.permission))
              ? 'Only you can see this thread until you send the letter with Comment only or Read & write access.' : null}
          />
        )}
      </div>

      {isOwner && (
        <div className="danger-zone">
          <button className="ic del" type="button" onClick={() => onDelete(list)}>Delete this letter…</button>
        </div>
      )}
      </div>

      {shareOpen && (
        <ShareModal list={list} members={members} contacts={contacts} user={user} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

// What each access level means on a letter
function letterDesc(role) {
  return {
    read: 'You can read this letter.',
    comment: 'You can read this letter and reply in the comments.',
    write: 'You can read and write in this letter.',
    readwrite: 'You can write in this letter and reply in the comments.',
  }[role] || PERMISSIONS[role]?.desc || '';
}

// The words of the letter. Saved a moment after you stop typing (and when you click away).
// While you're typing, the other person's changes don't overwrite yours.
function LetterBody({ list, user, canEdit }) {
  const toast = useToast();
  const told = useRef(false);
  const [text, setText] = useState(list.body || '');
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  const [savedAt, setSavedAt] = useState(null);
  const typing = useRef(false);
  const timer = useRef(null);
  const latest = useRef(text);
  latest.current = text;

  // someone else's edit arrives: show it, unless I'm in the middle of writing
  useEffect(() => {
    if (!typing.current) setText(list.body || '');
  }, [list.body]);

  function save() {
    clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    typing.current = false;
    if (v === (list.body || '')) return;
    setStatus('saving');
    // the other person hears about it once per visit, not on every autosave
    const tell = !told.current;
    told.current = true;
    saveLetterBody(list, user, v, tell)
      .then(() => { setStatus('saved'); setSavedAt(new Date()); })
      .catch((err) => { if (tell) told.current = false; setStatus('error'); toast(`Not saved: ${friendlyError(err)}`, 'err'); });
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  // leaving the letter with unsaved words: save them on the way out
  useEffect(() => () => { if (timer.current) saveRef.current(); }, []);

  // keep "Saved · just now" fresh
  const [, tick] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [savedAt]);

  if (!canEdit) {
    return list.body
      ? <div className="letter-body read">{list.body}</div>
      : <p className="letter-body read empty">Nothing written yet.</p>;
  }

  return (
    <>
      <textarea
        id="letter-body"
        className="letter-body"
        value={text}
        maxLength={MAX_BODY}
        placeholder="My dearest…"
        aria-label="Your letter"
        onChange={(e) => {
          setText(e.target.value);
          typing.current = true;
          setStatus(null);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => saveRef.current(), 800);
        }}
        onBlur={() => saveRef.current()}
      />
      <div className="letter-status" aria-live="polite">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && savedAt && `Saved · ${timeAgo(savedAt)}`}
        {status === 'error' && 'Not saved'}
        {text.length > MAX_BODY - 1000 && <span> · {MAX_BODY - text.length} characters left</span>}
      </div>
    </>
  );
}
