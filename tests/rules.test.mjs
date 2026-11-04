// Checks every access level against firestore.rules using the Firebase emulator.
// Run with:  npm run test:rules   (needs Java 21+ installed)
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  FieldPath, addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  Timestamp, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';

let env;
const LIST = 'list1';
const people = {
  owner: { uid: 'owner', email: 'owner@test.com' },
  reader: { uid: 'reader', email: 'reader@test.com' },
  commenter: { uid: 'commenter', email: 'commenter@test.com' },
  writer: { uid: 'writer', email: 'writer@test.com' },
  rw: { uid: 'rw', email: 'rw@test.com' },
  stranger: { uid: 'stranger', email: 'stranger@test.com' },
};
const as = (who, verified = true) =>
  env.authenticatedContext(people[who].uid, { email: people[who].email, email_verified: verified }).firestore();

const task = (uid, extra = {}) => ({
  text: 'A task', done: false, archived: false, createdBy: uid, createdByName: uid,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid, ...extra,
});
const invite = (to) => ({
  to, listId: LIST, listTitle: 'Moving house', fromName: 'Owner', fromEmail: 'owner@test.com',
  permission: 'read', seen: false, createdAt: serverTimestamp(),
});
const stamp = (uid) => ({ updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-todo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'lists', LIST), {
      title: 'Moving house', ownerId: 'owner', ownerEmail: 'owner@test.com', ownerName: 'Owner',
      roles: { 'reader@test.com': 'read', 'commenter@test.com': 'comment', 'writer@test.com': 'write', 'rw@test.com': 'readwrite' },
      memberEmails: ['reader@test.com', 'commenter@test.com', 'writer@test.com', 'rw@test.com'],
      createdAt: new Date(), updatedAt: new Date(),
    });
    await setDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { ...task('owner'), createdAt: new Date(), updatedAt: new Date() });
    await setDoc(doc(db, 'lists', LIST, 'comments', 'c1'), {
      text: 'hello', userId: 'owner', userName: 'Owner', userEmail: 'owner@test.com', createdAt: new Date(),
    });
  });
});

describe('lists', () => {
  test('anyone signed in can create their own list', async () => {
    await assertSucceeds(addDoc(collection(as('stranger'), 'lists'), {
      title: 'Mine', ownerId: 'stranger', ownerEmail: 'stranger@test.com', ownerName: 'S',
      roles: {}, memberEmails: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  test('cannot create a list owned by someone else', async () => {
    await assertFails(addDoc(collection(as('stranger'), 'lists'), {
      title: 'Fake', ownerId: 'owner', ownerEmail: 'owner@test.com', roles: {}, memberEmails: [],
    }));
  });
  for (const who of ['owner', 'reader', 'commenter', 'writer', 'rw']) {
    test(`${who} can open the list`, () => assertSucceeds(getDoc(doc(as(who), 'lists', LIST))));
  }
  test('stranger cannot open the list', () => assertFails(getDoc(doc(as('stranger'), 'lists', LIST))));
  test('member with an unverified email can open the list', () => assertSucceeds(getDoc(doc(as('reader', false), 'lists', LIST))));
  test('unverified member can leave', () =>
    assertSucceeds(updateDoc(doc(as('reader', false), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com'))));
  test('"shared with me" query works', () =>
    assertSucceeds(getDocs(query(collection(as('reader'), 'lists'), where('memberEmails', 'array-contains', 'reader@test.com')))));
  test('"my lists" query works', () =>
    assertSucceeds(getDocs(query(collection(as('owner'), 'lists'), where('ownerId', '==', 'owner')))));
  test('owner shares with more people', () =>
    assertSucceeds(updateDoc(doc(as('owner'), 'lists', LIST), new FieldPath('roles', 'new@test.com'), 'comment',
      'memberEmails', arrayUnion('new@test.com'))));
  test('roles and memberEmails must match', () =>
    assertFails(updateDoc(doc(as('owner'), 'lists', LIST), new FieldPath('roles', 'new@test.com'), 'comment')));
  test('unknown permission rejected', () =>
    assertFails(updateDoc(doc(as('owner'), 'lists', LIST), new FieldPath('roles', 'new@test.com'), 'admin',
      'memberEmails', arrayUnion('new@test.com'))));
  test('owner changes access', () =>
    assertSucceeds(updateDoc(doc(as('owner'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), 'readwrite')));
  test('member cannot raise their own access', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), 'readwrite')));
  test('member cannot share with others', () =>
    assertFails(updateDoc(doc(as('rw'), 'lists', LIST), new FieldPath('roles', 'x@test.com'), 'read', 'memberEmails', arrayUnion('x@test.com'))));
  test('member cannot rename', () => assertFails(updateDoc(doc(as('rw'), 'lists', LIST), { title: 'Hacked' })));
  test('member can leave', () =>
    assertSucceeds(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com'))));
  test('member cannot remove someone else', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'rw@test.com'), deleteField(),
      'memberEmails', arrayRemove('rw@test.com'))));
  test('leaving must record that you left', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'))));
  test('cannot mark someone else as having left', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com', 'rw@test.com'))));
  test('owner shares again with someone who left, or clears them', async () => {
    await assertSucceeds(updateDoc(doc(as('reader'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com')));
    // still listed as left while having access again is rejected
    await assertFails(updateDoc(doc(as('owner'), 'lists', LIST), new FieldPath('roles', 'reader@test.com'), 'read',
      'memberEmails', arrayUnion('reader@test.com')));
    await assertSucceeds(updateDoc(doc(as('owner'), 'lists', LIST), 'leftEmails', arrayRemove('reader@test.com')));
  });
  test('owner can archive and unarchive', async () => {
    await assertSucceeds(updateDoc(doc(as('owner'), 'lists', LIST), { archived: true }));
    await assertSucceeds(updateDoc(doc(as('owner'), 'lists', LIST), { archived: false }));
  });
  test('members cannot archive', () => assertFails(updateDoc(doc(as('rw'), 'lists', LIST), { archived: true })));
  test('archived must be true or false', () => assertFails(updateDoc(doc(as('owner'), 'lists', LIST), { archived: 'yes' })));
  test('only owner can delete the list', async () => {
    await assertFails(deleteDoc(doc(as('rw'), 'lists', LIST)));
    await assertSucceeds(deleteDoc(doc(as('owner'), 'lists', LIST)));
  });
});

describe('tasks', () => {
  for (const who of ['owner', 'reader', 'commenter', 'writer', 'rw']) {
    test(`${who} can read tasks`, () => assertSucceeds(getDocs(collection(as(who), 'lists', LIST, 'tasks'))));
  }
  test('stranger cannot read tasks', () => assertFails(getDocs(collection(as('stranger'), 'lists', LIST, 'tasks'))));

  for (const who of ['reader', 'commenter', 'stranger']) {
    test(`${who} cannot add, edit, complete, archive or delete`, async () => {
      const db = as(who);
      await assertFails(addDoc(collection(db, 'lists', LIST, 'tasks'), task(people[who].uid)));
      await assertFails(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { text: 'x', ...stamp(people[who].uid) }));
      await assertFails(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { done: true, ...stamp(people[who].uid) }));
      await assertFails(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { archived: true, ...stamp(people[who].uid) }));
      await assertFails(deleteDoc(doc(db, 'lists', LIST, 'tasks', 't1')));
    });
  }
  for (const who of ['owner', 'writer', 'rw']) {
    test(`${who} can add (with list timestamp), edit, complete, archive and delete`, async () => {
      const db = as(who);
      const uid = people[who].uid;
      const b = writeBatch(db);
      const ref = doc(collection(db, 'lists', LIST, 'tasks'));
      b.set(ref, task(uid));
      b.update(doc(db, 'lists', LIST), { updatedAt: serverTimestamp() });
      await assertSucceeds(b.commit());
      await assertSucceeds(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { text: 'edited', ...stamp(uid) }));
      await assertSucceeds(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { done: true, ...stamp(uid) }));
      await assertSucceeds(updateDoc(doc(db, 'lists', LIST, 'tasks', 't1'), { archived: true, ...stamp(uid) }));
      await assertSucceeds(deleteDoc(ref));
    });
  }
  test('cannot fake who created a task', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('owner'))));
  test('cannot add unexpected fields', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { hacked: true }))));
  test('can give a task a due date', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: '2026-10-27' }))));
  test('can clear a due date', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: null }))));
  test('can give a task a time', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: '2026-10-27', start: '10:00', mins: 90 }))));
  test('time must be HH:MM', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: '2026-10-27', start: '25:00', mins: 60 }))));
  test('length must be 5 minutes to a day', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: '2026-10-27', start: '10:00', mins: 5000 }))));
  test('can add notes to a task', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { notes: 'Call ahead first' }))));
  test('notes must be text of at most 2000 characters', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { notes: 'x'.repeat(2001) }))));
  test('can add a location to a task', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { location: 'Westlands, Nairobi' }))));
  test('can set the location of an existing task', () =>
    assertSucceeds(updateDoc(doc(as('rw'), 'lists', LIST, 'tasks', 't1'), { location: 'Karura Forest', ...stamp('rw') })));
  test('location must be text of at most 200 characters', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { location: 'x'.repeat(201) }))));
  test('can set the steps of what is going to be done', () =>
    assertSucceeds(updateDoc(doc(as('rw'), 'lists', LIST, 'tasks', 't1'), { steps: [{ text: 'E bike riding', location: 'Tigoni', url: '' }], ...stamp('rw') })));
  test('at most 20 steps', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { steps: Array.from({ length: 21 }, () => ({ text: 'x', location: '', url: '' })) }))));
  test('reader cannot set a location', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST, 'tasks', 't1'), { location: 'Somewhere', ...stamp('reader') })));
  test('can add links to a task', () =>
    assertSucceeds(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { links: [{ url: 'https://example.com', title: 'Example' }] }))));
  test('can add a link to an existing task', () =>
    assertSucceeds(updateDoc(doc(as('rw'), 'lists', LIST, 'tasks', 't1'), { links: arrayUnion({ url: 'https://example.com', title: '' }), ...stamp('rw') })));
  test('reader cannot add a link', () =>
    assertFails(updateDoc(doc(as('reader'), 'lists', LIST, 'tasks', 't1'), { links: arrayUnion({ url: 'https://example.com', title: '' }), ...stamp('reader') })));
  test('at most 10 links', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'),
      task('writer', { links: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}`, title: '' })) }))));
  test('links must be a list', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { links: 'https://example.com' }))));
  test('due date must be YYYY-MM-DD', () =>
    assertFails(addDoc(collection(as('writer'), 'lists', LIST, 'tasks'), task('writer', { due: 'next tuesday' }))));
});

describe('comments', () => {
  const c = (who) => ({ text: 'hi', userId: people[who].uid, userName: who, userEmail: people[who].email, createdAt: serverTimestamp() });
  for (const who of ['owner', 'commenter', 'rw']) {
    test(`${who} can read and post comments`, async () => {
      await assertSucceeds(getDocs(collection(as(who), 'lists', LIST, 'comments')));
      await assertSucceeds(addDoc(collection(as(who), 'lists', LIST, 'comments'), c(who)));
    });
  }
  for (const who of ['reader', 'writer', 'stranger']) {
    test(`${who} cannot read or post comments`, async () => {
      await assertFails(getDocs(collection(as(who), 'lists', LIST, 'comments')));
      await assertFails(addDoc(collection(as(who), 'lists', LIST, 'comments'), c(who)));
    });
  }
  test('cannot post as someone else', () =>
    assertFails(addDoc(collection(as('commenter'), 'lists', LIST, 'comments'), { ...c('commenter'), userId: 'owner' })));
  test('cannot delete someone else\'s comment', () => assertFails(deleteDoc(doc(as('rw'), 'lists', LIST, 'comments', 'c1'))));
  test('owner can delete any comment', () => assertSucceeds(deleteDoc(doc(as('owner'), 'lists', LIST, 'comments', 'c1'))));

  // c1 is the owner's; c2 the commenter's; c3 one the reader wrote back when they could comment
  const seed = (id, who) => env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'lists', LIST, 'comments', id), { ...c(who), createdAt: new Date() }));
  const edit = (who, id, extra = {}) =>
    updateDoc(doc(as(who), 'lists', LIST, 'comments', id), { text: 'fixed', editedAt: serverTimestamp(), ...extra });
  test('author can edit their comment', async () => {
    await seed('c2', 'commenter');
    await assertSucceeds(edit('commenter', 'c2'));
  });
  test('owner can edit their own comment', () => assertSucceeds(edit('owner', 'c1')));
  test('cannot edit someone else\'s comment, not even the owner', async () => {
    await seed('c2', 'commenter');
    await assertFails(edit('owner', 'c2'));
    await assertFails(edit('rw', 'c2'));
  });
  test('editing cannot change who wrote it or when', async () => {
    await seed('c2', 'commenter');
    await assertFails(edit('commenter', 'c2', { userId: 'owner' }));
    await assertFails(edit('commenter', 'c2', { createdAt: new Date(0) }));
  });
  test('edited comment must be 1 to 2000 characters', async () => {
    await seed('c2', 'commenter');
    await assertFails(edit('commenter', 'c2', { text: '' }));
    await assertFails(edit('commenter', 'c2', { text: 'x'.repeat(2001) }));
  });
  // ♥ likes: a list of uids; each person adds or removes only themselves
  const like = (who, id, on = true) =>
    updateDoc(doc(as(who), 'lists', LIST, 'comments', id), { likes: on ? arrayUnion(people[who].uid) : arrayRemove(people[who].uid) });
  test('anyone who can comment can like and unlike any comment', async () => {
    await seed('c2', 'commenter');
    await assertSucceeds(like('owner', 'c2'));
    await assertSucceeds(like('rw', 'c2'));
    await assertSucceeds(like('commenter', 'c2')); // your own too
    await assertSucceeds(like('rw', 'c2', false));
  });
  test('people without comment access cannot like', async () => {
    await seed('c2', 'commenter');
    for (const who of ['reader', 'writer', 'stranger']) await assertFails(like(who, 'c2'));
  });
  test('cannot like for someone else, or take away their like', async () => {
    await seed('c2', 'commenter');
    await assertFails(updateDoc(doc(as('rw'), 'lists', LIST, 'comments', 'c2'), { likes: ['owner'] }));
    await assertSucceeds(like('owner', 'c2'));
    await assertFails(updateDoc(doc(as('rw'), 'lists', LIST, 'comments', 'c2'), { likes: arrayRemove('owner') }));
    await assertFails(updateDoc(doc(as('rw'), 'lists', LIST, 'comments', 'c2'), { likes: [] }));
  });
  test('a like cannot be counted twice or carry other changes', async () => {
    await seed('c2', 'commenter');
    await assertSucceeds(like('rw', 'c2'));
    await assertFails(updateDoc(doc(as('rw'), 'lists', LIST, 'comments', 'c2'), { likes: ['rw', 'rw'] }));
    await assertFails(updateDoc(doc(as('owner'), 'lists', LIST, 'comments', 'c2'), { likes: arrayUnion('owner'), text: 'sneaky' }));
  });

  test('edit must be stamped with the time', async () => {
    await seed('c2', 'commenter');
    await assertFails(updateDoc(doc(as('commenter'), 'lists', LIST, 'comments', 'c2'), { text: 'fixed' }));
  });
  test('cannot edit after losing comment access', async () => {
    await seed('c3', 'reader');
    await assertFails(edit('reader', 'c3'));
  });
});

describe('profiles and invitations', () => {
  test('save your own last opened list', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'), { lastListId: LIST, updatedAt: serverTimestamp() }, { merge: true })));
  test('save your own favourites', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'), { favorites: arrayUnion(LIST), updatedAt: serverTimestamp() }, { merge: true })));
  test('save your own list order', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'), { listOrder: [LIST, 'other'], updatedAt: serverTimestamp() }, { merge: true })));
  test('list order must be a list', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { listOrder: 'nope' }, { merge: true })));
  test('save your own Spotify player link', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'),
      { spotify: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', updatedAt: serverTimestamp() }, { merge: true })));
  test('Spotify link has a length limit', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { spotify: 'x'.repeat(201) }, { merge: true })));
  test('save your own music', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'),
      { music: [{ type: 'track', id: '11dFghVXANMlKmJXsNCbNl', title: 'A song', image: '', addedAt: 1 }], updatedAt: serverTimestamp() }, { merge: true })));
  test('music must be a list', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { music: 'nope' }, { merge: true })));
  test('music keeps at most 100', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { music: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) }, { merge: true })));
  test('save your own reminder read state', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'), { reminders: { read: ['due:l1/t1:2026-10-31'], gone: [] }, updatedAt: serverTimestamp() }, { merge: true })));
  test('reminder state only takes read and gone', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { reminders: { read: [], other: [] } }, { merge: true })));
  test('reminder state keeps at most 300', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { reminders: { read: Array.from({ length: 301 }, (_, i) => String(i)), gone: [] } }, { merge: true })));
  test("cannot change someone else's reminder state", () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'writer'), { reminders: { read: [], gone: [] } }, { merge: true })));
  test('save your own notification settings', () =>
    assertSucceeds(setDoc(doc(as('reader'), 'users', 'reader'), { notify: { comments: false, tasks: true }, updatedAt: serverTimestamp() }, { merge: true })));
  test('notification settings only take the known kinds', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { notify: { spam: true } }, { merge: true })));
  test('notification settings are on/off only', () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'reader'), { notify: { tasks: 'yes' } }, { merge: true })));
  test("cannot change someone else's notification settings", () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'writer'), { notify: { tasks: false } }, { merge: true })));
  test("cannot change someone else's music", () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'owner'), { music: [] }, { merge: true })));
  test("cannot change someone else's Spotify link", () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'owner'), { spotify: 'https://open.spotify.com/album/x' }, { merge: true })));
  test("cannot change someone else's favourites", () =>
    assertFails(setDoc(doc(as('reader'), 'users', 'owner'), { favorites: [LIST] }, { merge: true })));
  test('cannot read someone else\'s profile', () => assertFails(getDoc(doc(as('reader'), 'users', 'owner'))));
  test('owner can queue an invite to a member', () =>
    assertSucceeds(addDoc(collection(as('owner'), 'mail'), {
      to: 'reader@test.com', listId: LIST, createdBy: 'owner', message: { subject: 's', html: '<p>h</p>', text: 't' },
    })));
  test('cannot email someone who is not on the list', () =>
    assertFails(addDoc(collection(as('owner'), 'mail'), {
      to: 'stranger@test.com', listId: LIST, createdBy: 'owner', message: { subject: 's', html: 'h', text: 't' },
    })));
  test('owner shares and leaves a notification in one batch', () => {
    const db = as('owner');
    const b = writeBatch(db);
    b.update(doc(db, 'lists', LIST), new FieldPath('roles', 'new@test.com'), 'read', 'memberEmails', arrayUnion('new@test.com'));
    b.set(doc(db, 'invites', `${LIST}_new@test.com`), invite('new@test.com'));
    return assertSucceeds(b.commit());
  });
  test('cannot notify someone the list is not shared with', () =>
    assertFails(setDoc(doc(as('owner'), 'invites', `${LIST}_stranger@test.com`), invite('stranger@test.com'))));
  test('members cannot send notifications', () =>
    assertFails(setDoc(doc(as('rw'), 'invites', `${LIST}_reader@test.com`), { ...invite('reader@test.com'), fromEmail: 'rw@test.com' })));
  test('recipient reads, marks seen and dismisses their notification', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'invites', 'i1'), invite('reader@test.com')));
    const db = as('reader', false);
    await assertSucceeds(getDocs(query(collection(db, 'invites'), where('to', '==', 'reader@test.com'))));
    await assertSucceeds(updateDoc(doc(db, 'invites', 'i1'), { seen: true }));
    await assertSucceeds(updateDoc(doc(db, 'invites', 'i1'), { seen: false })); // mark as unread
    await assertFails(updateDoc(doc(db, 'invites', 'i1'), { seen: 'yes' }));
    await assertFails(updateDoc(doc(db, 'invites', 'i1'), { listTitle: 'Changed' }));
    await assertSucceeds(deleteDoc(doc(db, 'invites', 'i1')));
  });
  test("cannot read someone else's notifications", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'invites', 'i1'), invite('reader@test.com')));
    await assertFails(getDoc(doc(as('rw'), 'invites', 'i1')));
  });
  test('leaving clears your notification in the same batch', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'invites', 'i1'), invite('reader@test.com')));
    const db = as('reader');
    const b = writeBatch(db);
    b.update(doc(db, 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(), 'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com'));
    b.delete(doc(db, 'invites', 'i1'));
    await assertSucceeds(b.commit());
  });
  test('members cannot send invitation emails', () =>
    assertFails(addDoc(collection(as('rw'), 'mail'), {
      to: 'reader@test.com', listId: LIST, createdBy: 'rw', message: { subject: 's', html: 'h', text: 't' },
    })));
});

describe('love letters', () => {
  const LETTER = 'letter1';
  const letter = (extra = {}) => ({
    title: 'For you', kind: 'letter', body: 'Dear you', ownerId: 'owner', ownerEmail: 'owner@test.com', ownerName: 'Owner',
    roles: {}, memberEmails: [], leftEmails: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
  });
  // one letter per recipient role, each shared with just that person
  const shareTo = async (who) => env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'lists', LETTER), {
      ...letter({ roles: { [people[who].email]: who === 'rw' ? 'readwrite' : who === 'writer' ? 'write' : who === 'commenter' ? 'comment' : 'read' },
        memberEmails: [people[who].email] }),
      createdAt: new Date(), updatedAt: new Date(),
    }));

  test('owner can write a letter', () => assertSucceeds(setDoc(doc(as('owner'), 'lists', 'new'), letter())));
  test('a letter goes to one person only', async () => {
    await shareTo('reader');
    await assertFails(updateDoc(doc(as('owner'), 'lists', LETTER), new FieldPath('roles', 'writer@test.com'), 'write',
      'memberEmails', arrayUnion('writer@test.com')));
  });
  test('owner can share a letter with one person', async () => {
    await setDoc(doc(as('owner'), 'lists', 'new'), letter());
    await assertSucceeds(updateDoc(doc(as('owner'), 'lists', 'new'), new FieldPath('roles', 'reader@test.com'), 'read',
      'memberEmails', arrayUnion('reader@test.com')));
  });
  test('a letter cannot become a list', async () => {
    await shareTo('reader');
    await assertFails(updateDoc(doc(as('owner'), 'lists', LETTER), { kind: 'list' }));
  });
  test('a list cannot become a letter', () => assertFails(updateDoc(doc(as('owner'), 'lists', LIST), { kind: 'letter' })));
  for (const who of ['writer', 'rw']) {
    test(`${who} recipient can edit the letter`, async () => {
      await shareTo(who);
      await assertSucceeds(updateDoc(doc(as(who), 'lists', LETTER), { body: 'Dear you, always', updatedAt: serverTimestamp() }));
    });
  }
  for (const who of ['reader', 'commenter']) {
    test(`${who} recipient can read but not edit the letter`, async () => {
      await shareTo(who);
      await assertSucceeds(getDoc(doc(as(who), 'lists', LETTER)));
      await assertFails(updateDoc(doc(as(who), 'lists', LETTER), { body: 'Changed', updatedAt: serverTimestamp() }));
    });
  }
  test('nobody else can read the letter', async () => {
    await shareTo('reader');
    await assertFails(getDoc(doc(as('writer'), 'lists', LETTER)));
    await assertFails(getDoc(doc(as('stranger'), 'lists', LETTER)));
  });
  test('writers on a to-do list cannot give it a body', () =>
    assertFails(updateDoc(doc(as('writer'), 'lists', LIST), { body: 'hi', updatedAt: serverTimestamp() })));
  test('the letter body has a size limit', async () => {
    await shareTo('rw');
    await assertFails(updateDoc(doc(as('rw'), 'lists', LETTER), { body: 'x'.repeat(20001), updatedAt: serverTimestamp() }));
  });
  test('comment recipient can comment on the letter', async () => {
    await shareTo('commenter');
    await assertSucceeds(addDoc(collection(as('commenter'), 'lists', LETTER, 'comments'),
      { text: 'Aww', userId: 'commenter', userName: 'c', userEmail: 'commenter@test.com', createdAt: serverTimestamp() }));
  });
});

describe('comment notifications', () => {
  const note = (from, to, extra = {}) => ({
    to: people[to].email, listId: LIST, listTitle: 'Moving house', kind: 'comment', text: 'hi',
    fromName: from, fromEmail: people[from].email, seen: false, createdAt: serverTimestamp(), ...extra,
  });
  const send = (from, to, extra) => addDoc(collection(as(from), 'activity'), note(from, to, extra));

  test('commenter can notify the owner and others who see comments', async () => {
    await assertSucceeds(send('commenter', 'owner'));
    await assertSucceeds(send('commenter', 'rw'));
    await assertSucceeds(send('owner', 'commenter', { kind: 'comment-delete' }));
  });
  test('cannot notify people who cannot see the comments', async () => {
    await assertFails(send('commenter', 'reader'));
    await assertFails(send('commenter', 'writer'));
    await assertFails(send('commenter', 'stranger'));
  });
  test('people who cannot comment cannot send them', () => assertFails(send('writer', 'owner')));
  test('cannot pretend to be someone else', () =>
    assertFails(addDoc(collection(as('commenter'), 'activity'), { ...note('commenter', 'owner'), fromEmail: 'rw@test.com' })));
  test('cannot notify yourself', () => assertFails(send('commenter', 'commenter')));
  test('unknown kinds are refused', () => assertFails(send('commenter', 'owner', { kind: 'share' })));
  test('only the person it is for can read, mark or remove it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'activity', 'a1'), { ...note('commenter', 'owner'), createdAt: new Date() });
    });
    await assertSucceeds(getDoc(doc(as('owner'), 'activity', 'a1')));
    await assertFails(getDoc(doc(as('rw'), 'activity', 'a1')));
    await assertFails(updateDoc(doc(as('rw'), 'activity', 'a1'), { seen: true }));
    await assertFails(updateDoc(doc(as('owner'), 'activity', 'a1'), { text: 'changed' }));
    await assertSucceeds(updateDoc(doc(as('owner'), 'activity', 'a1'), { seen: true }));
    await assertFails(deleteDoc(doc(as('commenter'), 'activity', 'a1')));
    await assertSucceeds(deleteDoc(doc(as('owner'), 'activity', 'a1')));
  });
  test('"my notifications" query works', () =>
    assertSucceeds(getDocs(query(collection(as('owner'), 'activity'), where('to', '==', 'owner@test.com')))));
});

describe('activity notifications', () => {
  const note = (from, to, kind, extra = {}) => ({
    to: people[to].email, listId: LIST, listTitle: 'Moving house', kind, text: 'Pack boxes', detail: '',
    fromName: from, fromEmail: people[from].email, seen: false, createdAt: serverTimestamp(), ...extra,
  });
  const send = (from, to, kind, extra) => addDoc(collection(as(from), 'activity'), note(from, to, kind, extra));

  test('writers tell everyone on the list about task changes, read-only people too', async () => {
    await assertSucceeds(send('writer', 'reader', 'task-done'));
    await assertSucceeds(send('rw', 'owner', 'task-add', { detail: '2026-11-02' }));
    await assertSucceeds(send('owner', 'commenter', 'task-delete'));
  });
  test('people who cannot write cannot send task notifications', async () => {
    await assertFails(send('reader', 'owner', 'task-done'));
    await assertFails(send('commenter', 'owner', 'task-edit'));
  });
  test('task notifications only go to people on the list', () => assertFails(send('writer', 'stranger', 'task-add')));
  test('only the owner sends list notifications', async () => {
    await assertSucceeds(send('owner', 'reader', 'list-rename', { detail: 'Old name' }));
    await assertSucceeds(send('owner', 'writer', 'access-changed', { detail: 'read' }));
    await assertFails(send('rw', 'reader', 'list-rename'));
    await assertFails(send('writer', 'owner', 'list-delete'));
  });
  test('a member tells the others they left; the owner cannot "leave"', async () => {
    await assertSucceeds(send('reader', 'owner', 'member-left'));
    await assertFails(send('owner', 'reader', 'member-left'));
  });
  test('notification fields are checked', async () => {
    await assertFails(send('writer', 'owner', 'task-add', { detail: 'x'.repeat(201) }));
    await assertFails(send('writer', 'owner', 'task-add', { extra: true }));
    await assertFails(send('writer', 'owner', 'task-add', { letter: 'yes' }));
  });
  test('leaving tells the owner in the same batch', async () => {
    const db = as('reader');
    const b = writeBatch(db);
    b.update(doc(db, 'lists', LIST), new FieldPath('roles', 'reader@test.com'), deleteField(),
      'memberEmails', arrayRemove('reader@test.com'), 'leftEmails', arrayUnion('reader@test.com'));
    b.set(doc(collection(db, 'activity')), note('reader', 'owner', 'member-left'));
    await assertSucceeds(b.commit());
  });
});

describe('device notification tokens', () => {
  const tok = (who, extra = {}) => ({
    uid: people[who].uid, email: people[who].email, device: 'Chrome on Windows',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
  });
  test('you can save and remove this device\'s token', async () => {
    await assertSucceeds(setDoc(doc(as('reader'), 'pushTokens', 'tokenA'), tok('reader')));
    await assertSucceeds(deleteDoc(doc(as('reader'), 'pushTokens', 'tokenA')));
  });
  test('you cannot save a token in someone else\'s name', async () => {
    await assertFails(setDoc(doc(as('reader'), 'pushTokens', 'tokenB'), tok('reader', { email: 'owner@test.com' })));
    await assertFails(setDoc(doc(as('reader'), 'pushTokens', 'tokenB'), tok('reader', { uid: 'owner' })));
    await assertFails(setDoc(doc(as('reader'), 'pushTokens', 'tokenB'), tok('reader', { extra: 1 })));
  });
  test('nobody can read tokens from the app, not even their own', async () => {
    await setDoc(doc(as('reader'), 'pushTokens', 'tokenC'), tok('reader'));
    await assertFails(getDoc(doc(as('reader'), 'pushTokens', 'tokenC')));
    await assertFails(getDocs(collection(as('owner'), 'pushTokens')));
  });
  test('you cannot remove someone else\'s token', async () => {
    await setDoc(doc(as('reader'), 'pushTokens', 'tokenD'), tok('reader'));
    await assertFails(deleteDoc(doc(as('owner'), 'pushTokens', 'tokenD')));
  });
});

describe('my own activity log', () => {
  const entry = (extra = {}) => ({ kind: 'music-add', text: 'Blinding Lights · The Weeknd', detail: '', target: '',
    seen: false, createdAt: serverTimestamp(), ...extra });
  const logOf = (who, uid = people[who].uid) => collection(as(who), 'users', uid, 'log');

  test('I can note, read, mark and remove my own activity', async () => {
    const ref = await addDoc(logOf('reader'), entry());
    await assertSucceeds(getDocs(logOf('reader')));
    await assertSucceeds(updateDoc(ref, { seen: true }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('with a list it is about', () =>
    assertSucceeds(addDoc(logOf('owner'), entry({ kind: 'list-create', listId: LIST, listTitle: 'Moving house', letter: false }))));
  test('nobody else can read or write my activity', async () => {
    await assertFails(getDocs(logOf('owner', 'reader')));
    await assertFails(addDoc(logOf('owner', 'reader'), entry()));
  });
  test('entries are checked', async () => {
    await assertFails(addDoc(logOf('reader'), entry({ text: 'x'.repeat(201) })));
    await assertFails(addDoc(logOf('reader'), entry({ seen: true })));
    await assertFails(addDoc(logOf('reader'), entry({ hacked: 1 })));
    await assertFails(addDoc(logOf('reader'), entry({ kind: '' })));
  });
  test('only "seen" can change afterwards', async () => {
    const ref = await addDoc(logOf('reader'), entry());
    await assertFails(updateDoc(ref, { text: 'changed' }));
  });
});

describe('chat messages', () => {
  const CHAT = 'chat1';
  const msg = (id) => doc(as('writer'), 'chats', CHAT, 'messages', id);
  const seed = (id, hoursAgo, from = 'writer') => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'chats', CHAT), { members: [people.writer.email, people.reader.email] });
    await setDoc(doc(db, 'chats', CHAT, 'messages', id),
      { from: people[from].email, text: 'hi', createdAt: Timestamp.fromMillis(Date.now() - hoursAgo * 3600000) });
  });
  const edit = (ref) => updateDoc(ref, { text: 'fixed', editedAt: serverTimestamp() });

  test('can edit my message within 3 hours, even once it has been read', async () => {
    await seed('m1', 2.5);
    await assertSucceeds(edit(msg('m1')));
  });
  test('cannot edit my message after 3 hours', async () => {
    await seed('m2', 3.1);
    await assertFails(edit(msg('m2')));
  });
  test('can still delete my message for everyone after 3 hours', async () => {
    await seed('m3', 5);
    await assertSucceeds(updateDoc(msg('m3'), { text: '', deleted: true }));
  });
  test('cannot edit their message', async () => {
    await seed('m4', 0, 'reader');
    await assertFails(edit(msg('m4')));
  });
});
