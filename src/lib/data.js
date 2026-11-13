// Every read and write the app makes to Firestore lives in this file.
import {
  FieldPath,
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { fb } from './firebase';

const db = () => fb().db;
const listRef = (id) => doc(db(), 'lists', id);
const tasksCol = (id) => collection(db(), 'lists', id, 'tasks');
const commentsCol = (id) => collection(db(), 'lists', id, 'comments');
const roleField = (email) => new FieldPath('roles', email);

export const emailOf = (user) => (user.email || '').toLowerCase();
// The name I chose in the app (users/{uid}.name), kept apart from the sign-in account's name. Workspace loads it
// (watchMyName → setChosenName); until then, or when it's empty, the account's name is used.
export const MAX_NAME = 60;
let chosen = { uid: null, name: '' };
export function setChosenName(uid, name) { chosen = { uid, name: name || '' }; }
export const nameOf = (user) => (chosen.uid === user.uid && chosen.name) || user.displayName || (user.email || '').split('@')[0];
const tidyName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

export function watchMyName(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().name || '' : ''), () => onData(''));
}

// The nickname someone saved their partner under: users/{uid}.nick = { email, name } (or null). Mine, or my
// partner's (they can read mine, I can read theirs: see isPartner in firestore.rules) to show "Alex saved you as …".
export function watchNick(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData((s.exists() && s.data().nick) || null), () => onData(null));
}
// empty name: no nickname
export function saveNick(user, email, name) {
  const v = tidyName(name);
  return setDoc(doc(db(), 'users', user.uid),
    { nick: v ? { email: email.toLowerCase(), name: v } : deleteField(), updatedAt: serverTimestamp() }, { merge: true });
}

// Empty: back to the sign-in account's name. Then the card others see (people/{email}) follows straight away.
export async function saveMyName(user, name) {
  const v = tidyName(name);
  await setDoc(doc(db(), 'users', user.uid), { name: v || deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  setChosenName(user.uid, v);
  await savePresence(user).catch(() => {});
  return v;
}

// ---------- profile + "where I left off" ----------
export async function saveProfile(user) {
  await setDoc(
    doc(db(), 'users', user.uid),
    { email: emailOf(user), displayName: nameOf(user), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ---------- people/{email}: my name, photo and when I was last here, for the people I share lists with ----------
// (users/{uid} stays private; this small card is all anyone else can see, and only if they know my email)
export function savePresence(user, online = true) {
  const email = emailOf(user);
  if (!email) return Promise.resolve();
  return setDoc(doc(db(), 'people', email), {
    email,
    displayName: nameOf(user).slice(0, 120),
    photoURL: (user.photoURL || '').slice(0, 1000),
    online: !!online, // false once I leave the app or sign out
    lastSeen: serverTimestamp(),
  });
}

// one person's card, live; null if they haven't opened the app since this was added
export function watchPerson(email, onData) {
  return onSnapshot(doc(db(), 'people', email), (s) => onData(s.exists() ? s.data() : null), () => onData(null));
}

export async function getLastListId(uid) {
  const snap = await getDoc(doc(db(), 'users', uid));
  return snap.exists() ? snap.data().lastListId || null : null;
}

export function saveLastListId(uid, listId) {
  return setDoc(doc(db(), 'users', uid), { lastListId: listId, updatedAt: serverTimestamp() }, { merge: true });
}

// Favourites are personal, so they live on my profile rather than on the list
export function watchFavorites(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().favorites || [] : []), () => onData([]));
}

export const setFavorite = (uid, listId, on) =>
  setDoc(
    doc(db(), 'users', uid),
    { favorites: on ? arrayUnion(listId) : arrayRemove(listId), updatedAt: serverTimestamp() },
    { merge: true },
  );

// The order I dragged my lists into on My List (also personal, so also on my profile)
export function watchListOrder(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().listOrder || [] : []), () => onData([]));
}

export const saveListOrder = (uid, ids) =>
  setDoc(doc(db(), 'users', uid), { listOrder: ids.slice(0, 500), updatedAt: serverTimestamp() }, { merge: true });

// The Spotify link in my sidebar player, i.e. what's playing (on my profile, so it follows me to any device). '' = none.
export function watchSpotify(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().spotify || '' : ''), () => onData(''));
}

export const saveSpotify = (uid, url) =>
  setDoc(doc(db(), 'users', uid), { spotify: url, updatedAt: serverTimestamp() }, { merge: true });

// The songs I kept on the Music page: [{ type, id, title, image, addedAt }], newest first
// Due / overdue reminders I've marked read or removed, so every device agrees: { read: [ids], gone: [ids] }.
// null when nothing's been saved to the account yet.
export const MAX_REMINDER_IDS = 300;
export function watchReminderState(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().reminders || null : null), () => onData(null));
}
export const saveReminderState = (uid, { read, gone }) =>
  setDoc(doc(db(), 'users', uid), {
    reminders: { read: read.slice(-MAX_REMINDER_IDS), gone: gone.slice(-MAX_REMINDER_IDS) },
    updatedAt: serverTimestamp(),
  }, { merge: true });

// Which kinds of device notifications I want (Notification settings): { tasks: false, … }; missing = on
export function watchNotifyPrefs(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().notify || {} : {}), () => onData({}));
}
export const saveNotifyPref = (uid, key, on) =>
  setDoc(doc(db(), 'users', uid), { notify: { [key]: !!on }, updatedAt: serverTimestamp() }, { merge: true });

export function watchMusic(uid, onData) {
  return onSnapshot(doc(db(), 'users', uid), (s) => onData(s.exists() ? s.data().music || [] : []), () => onData([]));
}

export const saveMusic = (uid, items) =>
  setDoc(doc(db(), 'users', uid), { music: items.slice(0, 100), updatedAt: serverTimestamp() }, { merge: true });

// The same changes, each also noted in my activity ("You added “Song” to My music")
const songName = (item) => [item.title, item.artist].filter(Boolean).join(' · ');

export function addSong(user, music, item) {
  const b = writeBatch(db());
  b.set(doc(db(), 'users', user.uid), { music: [item, ...music].slice(0, 100), updatedAt: serverTimestamp() }, { merge: true });
  logSelf(b, user, 'music-add', { text: songName(item) });
  return b.commit();
}

export function removeSong(user, music, item, same) {
  const b = writeBatch(db());
  b.set(doc(db(), 'users', user.uid), { music: music.filter((m) => !same(m, item)), updatedAt: serverTimestamp() }, { merge: true });
  logSelf(b, user, 'music-remove', { text: songName(item) });
  return b.commit();
}

// how: 'pick' (chose it), 'next', 'previous', or 'auto' (the song before ended)
export function playSong(user, item, link, how = 'pick') {
  const b = writeBatch(db());
  b.set(doc(db(), 'users', user.uid), { spotify: link, updatedAt: serverTimestamp() }, { merge: true });
  logSelf(b, user, 'music-play', { text: songName(item), detail: how });
  return b.commit();
}

export function stopMusic(user) {
  const b = writeBatch(db());
  b.set(doc(db(), 'users', user.uid), { spotify: '', updatedAt: serverTimestamp() }, { merge: true });
  logSelf(b, user, 'music-stop');
  return b.commit();
}

// ---------- lists ----------
const withId = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));

// Lists I own (live)
export function watchOwnedLists(uid, onData, onError) {
  return onSnapshot(query(collection(db(), 'lists'), where('ownerId', '==', uid)), (s) => onData(withId(s)), onError);
}

// Every list and letter my partner owns (live; firestore.rules lets me once we're linked)
export function watchPartnerLists(partnerUid, onData, onError) {
  return onSnapshot(query(collection(db(), 'lists'), where('ownerId', '==', partnerUid)), (s) => onData(withId(s)), onError);
}

// Lists shared with my email (live)
export function watchSharedLists(email, onData, onError) {
  return onSnapshot(
    query(collection(db(), 'lists'), where('memberEmails', 'array-contains', email)),
    (s) => onData(withId(s)),
    onError,
  );
}

// kind: 'list' (to-do) or 'letter' (a love letter: a written body, shared with one person at most)
export async function createList(user, title, kind = 'list') {
  const ref = doc(collection(db(), 'lists'));
  const b = writeBatch(db());
  b.set(ref, {
    title,
    kind,
    ...(kind === 'letter' ? { body: '' } : {}),
    ownerId: user.uid,
    ownerEmail: emailOf(user),
    ownerName: nameOf(user),
    roles: {},
    memberEmails: [],
    leftEmails: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logSelf(b, user, 'list-create', { list: { id: ref.id, title, kind } });
  await b.commit();
  return ref.id;
}

export const createLetter = (user, title) => createList(user, title, 'letter');

// "Unplaced": where a task goes when it's added (from the Calendar) without picking a list. It's an ordinary
// list of my own, never shared, with a fixed id, so the app can tell it apart. My List shows its tasks in their
// own section (from there they can be placed in a list); the sidebar and the list cards leave it out.
export const UNPLACED_TITLE = 'Unplaced';
export const unplacedId = (uid) => `unplaced-${uid}`;
export const isUnplaced = (list) => !!list?.id?.startsWith('unplaced-');

// The Unplaced list's id, making it the first time it's needed. exists: it's already among my lists.
export async function ensureUnplaced(user, exists) {
  const id = unplacedId(user.uid);
  if (exists) return id;
  await setDoc(listRef(id), {
    title: UNPLACED_TITLE,
    kind: 'list',
    ownerId: user.uid,
    ownerEmail: emailOf(user),
    ownerName: nameOf(user),
    roles: {},
    memberEmails: [],
    leftEmails: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

// The owner, and Write / Read & write recipients, can change what the letter says.
// tell: let the other person know (the letter view does this once per visit, not on every autosave)
export function saveLetterBody(list, user, body, tell = false) {
  const b = writeBatch(db());
  b.update(listRef(list.id), { body, updatedAt: serverTimestamp() });
  if (tell) notify(b, list, user, 'letter-edit');
  return send(b);
}

export function renameList(list, user, title) {
  const b = writeBatch(db());
  b.update(listRef(list.id), { title, updatedAt: serverTimestamp() });
  notify(b, { ...list, title }, user, 'list-rename', { detail: list.title });
  return send(b);
}

// Archived lists move to their own section for everyone; nothing is deleted
export function archiveList(list, user, archived) {
  const b = writeBatch(db());
  b.update(listRef(list.id), { archived });
  notify(b, list, user, archived ? 'list-archive' : 'list-unarchive');
  return send(b);
}

// Firestore doesn't delete sub-collections automatically, so remove tasks and comments first.
// Everyone on it is told in the same batch that removes the list itself.
export async function deleteList(list, user) {
  const id = list.id;
  const [tasks, comments] = await Promise.all([getDocs(tasksCol(id)), getDocs(commentsCol(id))]);
  const refs = [...tasks.docs, ...comments.docs].map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(db());
    refs.slice(i, i + 450).forEach((r) => b.delete(r));
    await b.commit();
  }
  const b = writeBatch(db());
  b.delete(listRef(id));
  notify(b, list, user, 'list-delete');
  await send(b);
}

// ---------- sharing ----------
// One notification per person per list, so sharing again just refreshes it
const inviteRef = (listId, email) => doc(db(), 'invites', `${listId}_${encodeURIComponent(email)}`);

// Add several people at once, and leave each of them a notification
export function shareList(list, emails, permission, inviter) {
  const b = writeBatch(db());
  const args = [];
  emails.forEach((e) => args.push(roleField(e), permission));
  // sharing again with someone who left takes them off the "left the list" section
  args.push('memberEmails', arrayUnion(...emails), 'leftEmails', arrayRemove(...emails), 'updatedAt', serverTimestamp());
  b.update(listRef(list.id), ...args);
  // the people already on it hear who joined (the new people get their own "shared with you")
  notify(b, list, inviter, 'member-added', { detail: emails.join(', '), skip: emails });
  emails.forEach((to) => pushLater(b, 'invites', inviteRef(list.id, to).id));
  emails.forEach((to) =>
    b.set(inviteRef(list.id, to), {
      to,
      listId: list.id,
      listTitle: list.title,
      fromName: nameOf(inviter),
      fromEmail: emailOf(inviter),
      permission,
      seen: false,
      createdAt: serverTimestamp(),
    }),
  );
  return send(b);
}

// The owner changing someone's access: they're told
export function changeAccess(list, user, email, permission) {
  const b = writeBatch(db());
  b.update(listRef(list.id), roleField(email), permission);
  notify(b, list, user, 'access-changed', { detail: permission, only: [email] });
  return send(b);
}

// The owner removing someone. Clears their "shared with you"; they're told, and so is everyone else.
export function removeAccess(list, user, email) {
  const b = writeBatch(db());
  b.update(listRef(list.id), roleField(email), deleteField(), 'memberEmails', arrayRemove(email));
  b.delete(inviteRef(list.id, email));
  notify(b, list, user, 'access-removed', { only: [email], log: false });
  notify(b, list, user, 'member-removed', { detail: email, skip: [email] });
  return send(b);
}

// A member removing themselves. The owner sees they left until sharing with them again.
export function leaveList(list, user) {
  const email = emailOf(user);
  const b = writeBatch(db());
  b.update(listRef(list.id), roleField(email), deleteField(), 'memberEmails', arrayRemove(email), 'leftEmails', arrayUnion(email));
  b.delete(inviteRef(list.id, email));
  notify(b, list, user, 'member-left');
  return send(b);
}

// The owner clearing someone from the "left the list" section without re-sharing
export const clearLeft = (id, email) => updateDoc(listRef(id), 'leftEmails', arrayRemove(email));

// ---------- private chat (two people, like WhatsApp) ----------
// chats/{a|b}: the two members' emails, sorted and joined, so there's one chat per pair and only those two
// can ever be in it. Messages live in chats/{id}/messages. firestore.rules keeps everyone else out.
export const chatIdFor = (a, b) => [a, b].map((e) => String(e).trim().toLowerCase()).sort().join('|');
const chatRef = (id) => doc(db(), 'chats', id);
const msgsCol = (id) => collection(db(), 'chats', id, 'messages');
export const MAX_MESSAGE = 4000;
// voice notes: recorded at ~32 kbps mono and stored base64 inside the message document,
// so a chat page downloads its audio with the snapshot. The caps keep the doc far under
// Firestore's 1 MiB limit; firestore.rules enforces the same base64 size.
export const MAX_VOICE_SECS = 90;
export const MAX_VOICE_B64 = 700000;
export const VOICE_PREVIEW = '🎤 Voice message';

// my chats (live). The app uses the one private chat: the first.
export function watchMyChats(email, onData, onError) {
  return onSnapshot(query(collection(db(), 'chats'), where('members', 'array-contains', email)), (s) => onData(withId(s)), onError);
}

export async function startChat(user, otherEmail) {
  const me = emailOf(user);
  const id = chatIdFor(me, otherEmail);
  await setDoc(chatRef(id), {
    members: id.split('|'), names: { [me]: nameOf(user).slice(0, 120) },
    createdBy: user.uid, createdAt: serverTimestamp(), readAt: {}, deliveredAt: {}, typing: {},
  });
  return id;
}

// the newest n messages, oldest first (live). pending: not saved on the server yet (the clock instead of a tick)
export function watchMessages(chatId, n, onData, onError) {
  return onSnapshot(query(msgsCol(chatId), orderBy('createdAt', 'desc'), limit(n)), { includeMetadataChanges: true },
    (s) => onData(s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites })).reverse(), s.size),
    onError);
}

// reply: { id, text, from } of the message being answered
export async function sendMessage(chatId, user, text, reply = null) {
  const me = emailOf(user);
  const ref = doc(msgsCol(chatId));
  const b = writeBatch(db());
  b.set(ref, { from: me, text, createdAt: serverTimestamp(), ...(reply ? { reply } : {}) });
  b.update(chatRef(chatId),
    'last', { text: text.slice(0, 200), from: me, at: serverTimestamp() },
    new FieldPath('readAt', me), serverTimestamp(),
    new FieldPath('deliveredAt', me), serverTimestamp(),
    new FieldPath('typing', me), deleteField(),
    new FieldPath('names', me), nameOf(user).slice(0, 120));
  await b.commit();
  pushChat(chatId, ref.id);
  return ref.id;
}

// a voice note: audio = { data: base64 (no "data:" prefix), mime, duration (seconds) }
export async function sendVoiceNote(chatId, user, audio, reply = null) {
  const me = emailOf(user);
  const ref = doc(msgsCol(chatId));
  const b = writeBatch(db());
  b.set(ref, { from: me, text: '', audio, createdAt: serverTimestamp(), ...(reply ? { reply } : {}) });
  b.update(chatRef(chatId),
    'last', { text: VOICE_PREVIEW, from: me, at: serverTimestamp() },
    new FieldPath('readAt', me), serverTimestamp(),
    new FieldPath('deliveredAt', me), serverTimestamp(),
    new FieldPath('typing', me), deleteField(),
    new FieldPath('names', me), nameOf(user).slice(0, 120));
  await b.commit();
  pushChat(chatId, ref.id);
  return ref.id;
}

// a device notification for the other person (and a reply box on it, where the system has one)
function pushChat(chatId, messageId) {
  const me = fb().auth.currentUser;
  if (!me) return;
  me.getIdToken()
    .then((token) => fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ chat: { chatId, messageId } }),
      keepalive: true,
    }))
    .catch(() => {});
}

export const editMessage = (chatId, id, text) =>
  updateDoc(doc(msgsCol(chatId), id), { text, editedAt: serverTimestamp() });
// for everyone: it stays in the chat as "This message was deleted"
export const deleteMessage = (chatId, id) =>
  updateDoc(doc(msgsCol(chatId), id), { text: '', deleted: true, reply: deleteField(), editedAt: deleteField(), audio: deleteField() });

// read (blue ticks) also counts as delivered
export const markChatRead = (chatId, user) =>
  updateDoc(chatRef(chatId), new FieldPath('readAt', emailOf(user)), serverTimestamp(), new FieldPath('deliveredAt', emailOf(user)), serverTimestamp());
// their messages reached me (grey double ticks for them): the app is open, on any page
export const markChatDelivered = (chatId, user) =>
  updateDoc(chatRef(chatId), new FieldPath('deliveredAt', emailOf(user)), serverTimestamp());
// "typing…": on while typing (refreshed every few seconds), off when sent or cleared
export const setTyping = (chatId, user, on) =>
  updateDoc(chatRef(chatId), new FieldPath('typing', emailOf(user)), on ? serverTimestamp() : deleteField());

// ---------- shared calendars ----------
// calendarShares/{ownerUid}_{email}: I share my whole calendar (every to-do list I own, now and later, not love
// letters) with someone, to see and change: tick off, add, edit, archive, delete. They see it on their Calendar.
const calShareRef = (uid, email) => doc(db(), 'calendarShares', `${uid}_${email}`);

export function shareCalendar(user, emails) {
  const b = writeBatch(db());
  for (const to of emails) {
    b.set(calShareRef(user.uid, to), {
      ownerUid: user.uid, ownerEmail: emailOf(user), ownerName: nameOf(user).slice(0, 120), to, seen: false, createdAt: serverTimestamp(),
    });
  }
  return b.commit();
}
// the owner stops sharing, or the person it was shared with removes it from their Calendar
export const unshareCalendar = (ownerUid, email) => writeBatch(db()).delete(calShareRef(ownerUid, email)).commit();
export const markCalendarSeen = (ownerUid, email) => updateDoc(calShareRef(ownerUid, email), { seen: true });

// who I've shared my calendar with / whose calendars are shared with me (live)
export const watchMyCalendarShares = (uid, onData, onError) =>
  onSnapshot(query(collection(db(), 'calendarShares'), where('ownerUid', '==', uid)), (s) => onData(withId(s)), onError);
export const watchCalendarsSharedWithMe = (email, onData, onError) =>
  onSnapshot(query(collection(db(), 'calendarShares'), where('to', '==', email)), (s) => onData(withId(s)), onError);

// someone's to-do lists, through their shared calendar (live)
export const watchCalendarLists = (ownerUid, onData, onError) =>
  onSnapshot(query(collection(db(), 'lists'), where('ownerId', '==', ownerUid), where('kind', '==', 'list')), (s) => onData(withId(s)), onError);

// Lists made before love letters existed have no kind; a shared calendar only finds lists marked 'list'
export function markListKinds(owned) {
  const old = owned.filter((l) => !l.kind);
  if (!old.length) return Promise.resolve();
  const b = writeBatch(db());
  old.forEach((l) => b.update(listRef(l.id), { kind: 'list' }));
  return b.commit();
}

// ---------- notifications ----------
export function watchInvites(email, onData, onError) {
  return onSnapshot(query(collection(db(), 'invites'), where('to', '==', email)), (s) => onData(withId(s)), onError);
}

export const markInviteSeen = (id, seen = true) => updateDoc(doc(db(), 'invites', id), { seen });

export const dismissInvite = (id) => writeBatch(db()).delete(doc(db(), 'invites', id)).commit();

// Optional: queue invitation emails for the "Trigger Email" Firebase extension
export async function queueInviteEmails(list, emails, inviter, link) {
  const from = nameOf(inviter);
  const what = list.kind === 'letter' ? 'a love letter' : 'the to-do list';
  await Promise.all(
    emails.map((to) =>
      addDoc(collection(db(), 'mail'), {
        to,
        listId: list.id,
        createdBy: inviter.uid,
        message: {
          subject: `${from} shared “${list.title}” with you`,
          text: `${from} shared ${what} “${list.title}” with you.\n\nOpen it: ${link}\n\nSign in or create an account with ${to} to see it.`,
          html: `<p>${escapeHtml(from)} shared ${what} <b>${escapeHtml(list.title)}</b> with you.</p>
<p><a href="${link}">Open it</a></p>
<p>Sign in or create an account with <b>${escapeHtml(to)}</b> to see it.</p>`,
        },
      }),
    ),
  );
}

// ---------- tasks ----------
export function watchTasks(listId, onData, onError) {
  return onSnapshot(query(tasksCol(listId), orderBy('createdAt', 'desc')), (s) => onData(withId(s)), onError);
}

const stamp = (user) => ({ updatedAt: serverTimestamp(), updatedBy: user.uid, updatedByName: nameOf(user) });

// due: optional 'YYYY-MM-DD' (see lib/dates.js); notes: optional details of what's going to be done;
// time: optional { start: 'HH:MM', mins } on that day (no time = all day)
// list: the list it goes in (just { id } for a list nobody else is on yet)
// extra (optional): { location, links: [{ url, title }], done }
export function addTask(list, user, text, due = null, notes = '', time = null, extra = {}) {
  const listId = list.id;
  const b = writeBatch(db());
  b.set(doc(tasksCol(listId)), {
    text,
    done: !!extra.done,
    archived: false,
    ...(due ? { due } : {}),
    ...(notes ? { notes } : {}),
    ...(due && time?.start ? { start: time.start, mins: time.mins || 60 } : {}),
    ...(extra.location ? { location: extra.location } : {}),
    ...(extra.links?.length ? { links: extra.links } : {}),
    createdBy: user.uid,
    createdByName: nameOf(user),
    createdAt: serverTimestamp(),
    ...stamp(user),
  });
  b.update(listRef(listId), { updatedAt: serverTimestamp() });
  notify(b, list, user, 'task-add', { text, detail: due || '' });
  return send(b);
}

// What a change to a task was, for the notification
function taskKind(task, patch) {
  if ('done' in patch) return patch.done ? 'task-done' : 'task-undone';
  if ('archived' in patch) return patch.archived ? 'task-archive' : 'task-restore';
  if ('text' in patch) return 'task-edit';
  if ('due' in patch || 'start' in patch || 'month' in patch) return 'task-due';
  if ('notes' in patch || 'location' in patch || 'steps' in patch) return 'task-notes'; // what's going to be done, and where
  return null;
}

// task: the task as it is now (its text goes in the notification). kind: say what this was, if the patch doesn't.
export function updateTask(list, task, user, patch, kind = taskKind(task, patch), detail = '') {
  const b = writeBatch(db());
  b.update(doc(tasksCol(list.id), task.id), { ...patch, ...stamp(user) });
  b.update(listRef(list.id), { updatedAt: serverTimestamp() });
  const due = patch.month || ('due' in patch ? patch.due || '' : '');
  if (kind) {
    notify(b, list, user, kind, {
      text: patch.text || task.text,
      detail: detail || (kind === 'task-edit' ? task.text : kind === 'task-due' ? (due && patch.start ? `${due} ${patch.start}` : due) : ''),
    });
  }
  return send(b);
}

// links: { url, title } (see lib/links.js). Union/remove, so two people adding at once don't overwrite each other
export const addTaskLink = (list, task, user, link) =>
  updateTask(list, task, user, { links: arrayUnion(link) }, 'task-link', link.title || link.url);
export const removeTaskLink = (list, task, user, link) =>
  updateTask(list, task, user, { links: arrayRemove(link) }, 'task-unlink', link.title || link.url);

// Move a task to another list (placing an Unplaced task): the same task in the new list, gone from the old one.
// Its comments-free fields come along as they are; it counts as added to the new list.
export function moveTask(from, task, to, user) {
  const { id, ...fields } = task;
  const b = writeBatch(db());
  b.set(doc(tasksCol(to.id)), { ...fields, createdBy: user.uid, createdByName: fields.createdByName || nameOf(user), ...stamp(user) });
  b.delete(doc(tasksCol(from.id), id));
  b.update(listRef(to.id), { updatedAt: serverTimestamp() });
  notify(b, to, user, 'task-add', { text: task.text, detail: task.due || '' });
  return send(b);
}

export function deleteTask(list, task, user) {
  const b = writeBatch(db());
  b.delete(doc(tasksCol(list.id), task.id));
  b.update(listRef(list.id), { updatedAt: serverTimestamp() });
  notify(b, list, user, 'task-delete', { text: task.text });
  return send(b);
}

// ---------- comments ----------
export function watchComments(listId, onData, onError) {
  return onSnapshot(query(commentsCol(listId), orderBy('createdAt', 'asc')), (s) => onData(withId(s)), onError);
}

// Each comment change also leaves a notification for everyone else on the list who can see the comments,
// in the same batch, so the two always go together
export function addComment(list, user, text) {
  const b = writeBatch(db());
  b.set(doc(commentsCol(list.id)), {
    text,
    userId: user.uid,
    userName: nameOf(user),
    userEmail: emailOf(user),
    createdAt: serverTimestamp(),
  });
  notify(b, list, user, 'comment', { text });
  return send(b);
}

// Only the person who wrote it can change it; it's marked as edited
export function editComment(list, id, user, text) {
  const b = writeBatch(db());
  b.update(doc(commentsCol(list.id), id), { text, editedAt: serverTimestamp() });
  notify(b, list, user, 'comment-edit', { text });
  return send(b);
}

// ♥ a comment, or take it back. likes is a list of the uids who liked it; each person can only add or
// remove themselves (firestore.rules). No notification: a like is quiet, like Instagram's.
export function likeComment(list, comment, user, on) {
  return updateDoc(doc(commentsCol(list.id), comment.id), { likes: on ? arrayUnion(user.uid) : arrayRemove(user.uid) });
}

export function deleteComment(list, comment, user) {
  const b = writeBatch(db());
  b.delete(doc(commentsCol(list.id), comment.id));
  notify(b, list, user, 'comment-delete', { text: comment.text });
  return send(b);
}

// ---------- activity: "X did something on a list you share" notifications ----------
// activity/{id}: one per person per event, written in the same batch as the change itself.
// Only the person it's for can read, mark or remove it. Kinds (firestore.rules checks who may send which):
//   comments           comment, comment-edit, comment-delete          (to people who can see the comments)
//   tasks and letters  task-add, task-edit, task-done, task-undone, task-due, task-notes, task-archive,
//                      task-restore, task-delete, task-link, task-unlink, letter-edit
//   the list itself    list-rename, list-archive, list-unarchive, list-delete,
//                      member-added, member-removed, access-changed, access-removed   (owner only)
//   leaving            member-left
const canSeeComments = (permission) => permission === 'comment' || permission === 'readwrite';

// My partner's email while we're linked (lib/partner.js keeps it current): changes to my lists tell them too
let myPartner = null;
export const setPartnerForNotify = (email) => { myPartner = email; };

// text: what it's about (a task, a comment); detail: the extra bit (old name, a date, someone's email)
// only: just these people; skip: everyone except these
// log: also note it in my own activity (off for the second half of a two-part change)
function notify(batch, list, user, kind, { text = '', detail = '', only = null, skip = [], log = true } = {}) {
  const me = emailOf(user);
  if (log) logSelf(batch, user, kind, { text, detail, target: (only || []).join(', '), list });
  const roles = list.roles || {};
  const members = kind.startsWith('comment') ? Object.keys(roles).filter((e) => canSeeComments(roles[e])) : Object.keys(roles);
  const partner = myPartner && list.ownerId === user.uid ? [myPartner] : [];
  const to = (only || [list.ownerEmail, ...members, ...partner]).filter((e) => e && e !== me && !skip.includes(e));
  for (const email of new Set(to)) {
    const ref = doc(collection(db(), 'activity'));
    pushLater(batch, 'activity', ref.id);
    batch.set(ref, {
      to: email,
      listId: list.id,
      listTitle: (list.title || '').slice(0, 120),
      ...(list.kind === 'letter' ? { letter: true } : {}),
      kind,
      text: String(text).slice(0, 200),
      detail: String(detail).slice(0, 200),
      fromName: nameOf(user).slice(0, 120),
      fromEmail: me,
      seen: false,
      createdAt: serverTimestamp(),
    });
  }
}

// ---------- my own activity: users/{uid}/log/{id} ----------
// "You created …", "You completed …", "You added a song …". Only I can see it; it shows in my
// Notifications next to everyone else's activity. Saved in the same batch as the change itself.
const logCol = (uid) => collection(db(), 'users', uid, 'log');

function logSelf(batch, user, kind, { text = '', detail = '', target = '', list = null } = {}) {
  batch.set(doc(logCol(user.uid)), {
    kind,
    text: String(text).slice(0, 200),
    detail: String(detail).slice(0, 200),
    target: String(target).slice(0, 200),
    ...(list ? { listId: list.id, listTitle: (list.title || '').slice(0, 120), letter: list.kind === 'letter' } : {}),
    seen: false,
    createdAt: serverTimestamp(),
  });
}

export function watchLog(uid, onData) {
  return onSnapshot(query(logCol(uid), orderBy('createdAt', 'desc'), limit(300)), (s) => onData(withId(s)), () => onData([]));
}

export const markLogSeen = (uid, id, seen = true) => updateDoc(doc(logCol(uid), id), { seen });

export const dismissLog = (uid, id) => writeBatch(db()).delete(doc(logCol(uid), id)).commit();

// ---------- device notifications (push) ----------
// After a batch that wrote notifications is saved, /api/push sends them to the devices of the people
// they're for. Fire and forget: a push that fails never undoes or holds up the change itself.
const toPush = new WeakMap(); // batch → { activity: [ids], invites: [ids] }

function pushLater(batch, kind, id) {
  const p = toPush.get(batch) || { activity: [], invites: [] };
  p[kind].push(id);
  toPush.set(batch, p);
}

async function send(batch) {
  await batch.commit();
  const p = toPush.get(batch);
  const me = fb().auth.currentUser;
  if (!p || !me || (!p.activity.length && !p.invites.length)) return;
  me.getIdToken()
    .then((token) => fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(p),
      keepalive: true, // still goes if the page is closed right after
    }))
    .catch(() => {});
}

// This device's push token, so /api/push can reach it. Only the server reads these.
export const savePushToken = (user, token, device) =>
  setDoc(doc(db(), 'pushTokens', token), {
    uid: user.uid,
    email: emailOf(user),
    device: String(device || '').slice(0, 200),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const removePushToken = (token) => writeBatch(db()).delete(doc(db(), 'pushTokens', token)).commit();

export function watchActivity(email, onData, onError) {
  return onSnapshot(query(collection(db(), 'activity'), where('to', '==', email)), (s) => onData(withId(s)), onError);
}

export const markActivitySeen = (id, seen = true) => updateDoc(doc(db(), 'activity', id), { seen });

export const dismissActivity = (id) => writeBatch(db()).delete(doc(db(), 'activity', id)).commit();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
