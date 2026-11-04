// How a notification reads, in plain text. Shared by the bell / Notifications page (in the browser)
// and the push sender (/api/push, on the server), so both always say the same thing.
import { dueLabel } from './dates';
import { roleLabel } from './permissions';

const quote = (t) => `“${t}”`;
const dueText = (d) => { const [day, time] = d.split(' '); return `${dueLabel(day).toLowerCase()}${time ? ` at ${time}` : ''}`; };

// Activity on a list or letter: its tag, and what the person did (read as "<who> <did> “<list>”").
// text: the task or comment it's about; detail: the extra bit (old name, a date, someone's email, an access level).
// gone: still shown after the list is gone (that's what it's telling you)
// mine: how it reads in my own activity, where "your" would be wrong ("You changed amani@…'s access …")
// noList: not about a list (music), so it reads "<who> <did>" with nothing after it
const PLAYED = {
  next: (t) => `skipped to ${t}`,
  previous: (t) => `went back to ${t}`,
  auto: (t) => `moved on to ${t} automatically`,
};
export const ACT = {
  'list-create': { label: 'Created', did: (n) => (n.letter ? 'started the love letter' : 'created') },
  comment: { label: 'New comment', group: 'comments', did: () => 'commented on' },
  'comment-edit': { label: 'Comment edited', group: 'comments', did: () => 'edited a comment on' },
  'comment-delete': { label: 'Comment deleted', group: 'comments', did: () => 'deleted a comment on' },
  'task-add': { label: 'Task added', did: (n) => `added ${quote(n.text)}${n.detail ? `, due ${dueText(n.detail)},` : ''} to` },
  'task-edit': { label: 'Task changed', did: (n) => `renamed ${quote(n.detail)} to ${quote(n.text)} in` },
  'task-done': { label: 'Task done', did: (n) => `completed ${quote(n.text)} in` },
  'task-undone': { label: 'Task reopened', did: (n) => `reopened ${quote(n.text)} in` },
  'task-due': { label: 'Date changed', did: (n) => (n.detail ? `set ${quote(n.text)} for ${dueText(n.detail)} in` : `removed the date from ${quote(n.text)} in`) },
  'task-notes': { label: 'Details changed', did: (n) => `updated the details of ${quote(n.text)} in` },
  'task-archive': { label: 'Task archived', did: (n) => `archived ${quote(n.text)} in` },
  'task-restore': { label: 'Task restored', did: (n) => `restored ${quote(n.text)} in` },
  'task-delete': { label: 'Task deleted', did: (n) => `deleted ${quote(n.text)} from` },
  'task-link': { label: 'Link added', did: (n) => `added a link to ${quote(n.text)} in` },
  'task-unlink': { label: 'Link removed', did: (n) => `removed a link from ${quote(n.text)} in` },
  'letter-edit': { label: 'Letter edited', did: () => 'wrote in' },
  'list-rename': { label: 'Renamed', did: (n) => `renamed ${quote(n.detail)} to` },
  'list-archive': { label: 'Archived', did: () => 'archived' },
  'list-unarchive': { label: 'Unarchived', did: () => 'unarchived' },
  'list-delete': { label: 'Deleted', gone: true, did: () => 'deleted' },
  'member-added': { label: 'New member', did: (n) => `gave ${n.detail} access to` },
  'member-removed': { label: 'Member removed', did: (n) => `removed ${n.detail} from` },
  'access-changed': {
    label: 'Your access',
    did: (n) => `changed your access to ${roleLabel(n.detail).toLowerCase()} on`,
    mine: (n) => `changed ${n.target}'s access to ${roleLabel(n.detail).toLowerCase()} on`,
  },
  'access-removed': { label: 'Access removed', gone: true, did: () => 'removed you from' },
  'member-left': { label: 'Member left', did: () => 'left' },
  'music-add': { label: 'Song added', group: 'music', noList: true, did: (n) => `added ${quote(n.text)} to ${n.partner ? 'their music' : 'My music'}` },
  'music-remove': { label: 'Song removed', group: 'music', noList: true, did: (n) => `removed ${quote(n.text)} from ${n.partner ? 'their music' : 'My music'}` },
  'music-play': {
    label: 'Now playing', group: 'music', noList: true,
    did: (n) => (PLAYED[n.detail] || ((t) => `started playing ${t}`))(quote(n.text)),
  },
  'music-stop': { label: 'Player closed', group: 'music', noList: true, did: () => 'closed the music player' },
};

// What the person did, worded for whose activity it is
// (my partner's own activity reads like mine does, just with their name: "changed amani@…'s access", not "your")
export const didText = (n) => (((n.self || n.partner) && ACT[n.kind].mine) || ACT[n.kind].did)(n);

export const isComment = (n) => ACT[n.kind]?.group === 'comments';
export const who = (n) => (n.self ? 'You' : n.from.displayName || n.from.email);
export const where = (n) => (n.letter ? `the love letter “${n.listTitle}”` : `“${n.listTitle}”`);
// What device notifications can be turned on or off for (Notification settings). All on until changed.
export const NOTIFY_GROUPS = [
  { key: 'chat', label: 'Chat messages', hint: 'New messages in your private chat' },
  { key: 'share', label: 'Shared with me', hint: 'A list or love letter is shared with you' },
  { key: 'tasks', label: 'Tasks', hint: 'Added, done, renamed, dates, details, links, archived or deleted' },
  { key: 'comments', label: 'Comments', hint: 'New, edited or deleted comments' },
  { key: 'members', label: 'People & access', hint: 'Someone joins or leaves, or your access changes' },
  { key: 'lists', label: 'List & letter changes', hint: 'Created, renamed, archived, deleted, or written in' },
  { key: 'music', label: 'Music', hint: 'Songs added, removed or played' },
];
export function notifyGroup(kind) {
  if (kind === 'share') return 'share';
  if (kind === 'chat') return 'chat';
  if (isComment({ kind })) return 'comments';
  if (kind.startsWith('task-')) return 'tasks';
  if (kind.startsWith('member-') || kind.startsWith('access-')) return 'members';
  if (kind.startsWith('music-')) return 'music';
  return 'lists';
}
// prefs: users/{uid}.notify, e.g. { comments: false }
export const wantsPush = (prefs, kind) => (prefs || {})[notifyGroup(kind)] !== false;

// ---- how a notification reads on the device (and in the in-app toast) ----
// The person's first name, then what happened. Title under 50 characters, body under 120, no emoji.
const fit = (s, max) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
export const firstName = (from) => (from?.displayName || from?.email || 'Someone').split(/[\s@]/)[0] || 'Someone';

// n: { kind, listTitle, letter, text, detail, role (a share's access level), from: { displayName, email } }
export function notifyCopy(n) {
  const kind = n.kind;
  if (kind !== 'share' && !ACT[kind]) return null;
  const name = firstName(n.from);
  const list = n.listTitle || 'a list';
  let title;
  let body;
  if (kind === 'share') {
    title = n.letter ? `${name} sent you a love letter` : `${name} shared a list with you`;
    body = n.role ? `${list} · ${roleLabel(n.role)}` : list;
  } else if (kind === 'access-changed') {
    title = 'Your access changed';
    body = `${list} · ${roleLabel(n.detail)}`;
  } else if (kind === 'access-removed') {
    title = 'Access removed';
    body = `You no longer have access to ${list}`;
  } else if ((kind === 'comment' || kind === 'comment-edit') && n.text) {
    title = `Comment on ${list}`;
    body = `${name}: ${n.text}`;
  } else {
    // the list is the title, so "completed “Pack boxes” in" reads as "completed “Pack boxes”"
    title = ACT[kind].noList ? 'My music' : list;
    body = `${name} ${ACT[kind].did(n).replace(/ (to|in|on|from)$/, '')}`;
  }
  return { title: fit(title, 50), body: fit(body, 120) };
}

// doc: an activity/{id} or invites/{id} document as stored in Firestore (the push sender, on the server)
export function pushMessage(doc, kind = doc.kind || 'share') {
  return notifyCopy({
    kind, listTitle: doc.listTitle, letter: !!doc.letter, text: doc.text || '', detail: doc.detail || '',
    role: doc.permission || '', from: { email: doc.fromEmail, displayName: doc.fromName },
  });
}
