'use client';
import { useEffect, useState } from 'react';
import { MAX_FEEDBACK, addFeedback, deleteFeedback, watchFeedback } from '@/lib/data';
import { friendlyError } from '@/lib/firebase';
import { Avatar, shownName, timeAgo } from '@/lib/people';
import { ratingWord } from '@/lib/steps';
import { RatingSlider } from './TaskDetails';
import { useToast } from './Toast';

// Feedback on a task, opened from its "Feedback" button: everyone who can comment on the list can rate the
// experience (1-10) and/or say how it was, and reply to each other's feedback. Your own can be deleted, and the
// list's owner can delete any. Newest conversation last, replies under the feedback they answer.
export default function Feedback({ list, task, user, isOwner }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // the feedback being answered: its id
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(
    () => watchFeedback(list.id, task.id, setItems, (e) => { setItems([]); toast(friendlyError(e), 'err'); }),
    [list.id, task.id, toast],
  );

  const all = items || [];
  const top = all.filter((f) => !f.replyTo);
  const repliesTo = (id) => all.filter((f) => f.replyTo === id);
  const rated = top.filter((f) => f.rating > 0);
  const avg = rated.length ? rated.reduce((n, f) => n + f.rating, 0) / rated.length : 0;

  async function post(e, fields, done) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await addFeedback(list, task, user, fields);
      done();
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'err');
    }
    setBusy(false);
  }
  const remove = (f) => deleteFeedback(list, task, f)
    .then(() => toast(f.replyTo ? 'Reply deleted' : 'Feedback deleted'))
    .catch((err) => toast(`Not deleted: ${friendlyError(err)}`, 'err'));

  const entry = (f) => {
    const mine = f.userId === user.uid;
    return (
      <div className="fb-e">
        <Avatar person={{ email: f.userEmail, displayName: f.userName }} size={f.replyTo ? 22 : 28} />
        <div className="fb-b">
          <div className="fb-who">
            <b>{mine ? 'You' : shownName(f.userName, f.userEmail) || f.userEmail}</b>
            <span className="muted">{timeAgo(f.createdAt)}</span>
            {f.rating > 0 && <span className="fb-rate" title={ratingWord(f.rating)}>★ {f.rating}/10 · {ratingWord(f.rating)}</span>}
          </div>
          {f.text && <p className="fb-t">{f.text}</p>}
          <div className="fb-acts">
            {!f.replyTo && (
              <button type="button" className="link" onClick={() => { setReplyTo(replyTo === f.id ? null : f.id); setReply(''); }}>Reply</button>
            )}
            {(mine || isOwner) && <button type="button" className="link danger" onClick={() => remove(f)}>Delete</button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fb" aria-label={`Feedback on ${task.text}`}>
      <div className="fb-h">
        <b>Feedback</b>
        {rated.length > 0 && (
          <span className="fb-avg">★ {Math.round(avg * 10) / 10}/10 from {rated.length} rating{rated.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {items === null ? <p className="muted small">Loading…</p> : top.length === 0 ? (
        <p className="muted small">No feedback yet. Rate the experience or say how it went.</p>
      ) : (
        <ul className="fb-list">
          {top.map((f) => (
            <li key={f.id}>
              {entry(f)}
              {(repliesTo(f.id).length > 0 || replyTo === f.id) && (
                <ul className="fb-replies">
                  {repliesTo(f.id).map((r) => <li key={r.id}>{entry(r)}</li>)}
                  {replyTo === f.id && (
                    <li>
                      <form className="fb-reply" onSubmit={(e) => post(e, { text: reply, replyTo: f.id }, () => { setReply(''); setReplyTo(null); })}>
                        <input autoFocus maxLength={MAX_FEEDBACK} value={reply} onChange={(e) => setReply(e.target.value)}
                          onKeyDown={(e) => e.key === 'Escape' && setReplyTo(null)}
                          placeholder={`Reply to ${f.userId === user.uid ? 'yourself' : (shownName(f.userName, f.userEmail) || 'them').split(' ')[0]}…`}
                          aria-label="Your reply" />
                        <button type="submit" className="btn small primary" disabled={busy || !reply.trim()}>Reply</button>
                      </form>
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="fb-new" onSubmit={(e) => post(e, { text, rating }, () => { setText(''); setRating(0); })}>
        <RatingSlider value={rating} onChange={(e) => setRating(Number(e.target.value))} onCommit={() => {}}
          ariaLabel="Rate the experience" hint="optional" />
        <textarea rows={2} maxLength={MAX_FEEDBACK} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="How was it? (optional if you've rated it)" aria-label="Your feedback" />
        <div className="fb-new-f">
          <button type="submit" className="btn small primary" disabled={busy || (!text.trim() && !rating)}>
            {busy ? 'Posting…' : 'Post feedback'}
          </button>
        </div>
      </form>
    </div>
  );
}
