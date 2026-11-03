// Device notifications for Shared To-Do.
// /api/push sends each one through Firebase Cloud Messaging as data: { title, body, link, tag }.
// This shows it in the phone's notification bar / the Windows or Mac notification centre,
// and opens the app on that list when it is clicked (a comment link has &reply=1: it opens on the comments,
// ready to reply; its Reply button does the same, and Open opens the list without the reply box).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// "Also while I'm using the app": the page saves it in Cache Storage, which this worker can read
async function whileOpen() {
  try {
    const res = await (await caches.open('todo-prefs')).match('/__prefs/while-open');
    return !!res && (await res.text()) === '1';
  } catch {
    return false;
  }
}

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    const payload = event.data ? event.data.json() : {};
    msg = payload.data || payload;
  } catch {
    return;
  }
  if (!msg.title) return;

  event.waitUntil((async () => {
    // Someone looking at the app right now already sees it there (a pop-up in the app), so no double alert,
    // unless they turned on "Also while I'm using the app" in Notification settings
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some((c) => c.focused && c.visibilityState === 'visible') && !(await whileOpen())) return;
    await self.registration.showNotification(msg.title, {
      body: msg.body || '',
      icon: '/icons/emblem-192.png', // PNG: Windows doesn't show SVG icons
      badge: '/icons/badge-72.png', // Android's status bar: white on transparent
      tag: msg.tag || undefined, // list + type, so repeated ones replace each other instead of stacking
      renotify: !!msg.tag && msg.renotify === '1', // only comments alert again
      requireInteraction: false, // goes away by itself
      silent: false,
      // a comment: Reply and Open buttons (where the system shows buttons). With a reply pass, Reply is a text box
      // where the system has one (Windows, Android, ChromeOS…): the reply is sent from here, without opening the app.
      // Elsewhere Reply (or tapping the notification) opens the list on its comments with the box ready.
      actions: msg.reply === '1' ? [
        msg.replyToken
          ? { action: 'reply', type: 'text', title: 'Reply', placeholder: msg.replyTo ? `Reply to ${msg.replyTo}` : 'Reply' }
          : { action: 'reply', title: 'Reply' },
        { action: 'open', title: 'Open' },
      ] : [],
      data: { link: msg.link || '/', replyToken: msg.replyToken || '', replyUrl: msg.replyUrl || '', title: msg.title, tag: msg.tag || '' },
    });
  })());
});

// A reply typed into the notification: post it with the notification's reply pass (see /api/reply), then show
// the outcome in its place: "You: …" once sent, or why it didn't go (tapping that opens the app to try there).
async function sendReply(data, text) {
  const tag = data.tag || undefined;
  const base = { icon: '/icons/emblem-192.png', badge: '/icons/badge-72.png', tag, renotify: false, silent: true, data: { link: data.link } };
  let error = '';
  try {
    const res = await fetch(data.replyUrl || '/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.replyToken, text }),
    });
    if (!res.ok) error = (await res.json().catch(() => ({}))).error || 'Something went wrong.';
  } catch {
    error = 'No connection.';
  }
  if (!error) {
    await self.registration.showNotification(data.title || 'Reply sent', { ...base, body: `You: ${text}` });
    // it goes away by itself shortly after, like a chat app's does
    await new Promise((r) => setTimeout(r, 4000));
    const shown = await self.registration.getNotifications(tag ? { tag } : {});
    shown.filter((n) => n.body.startsWith('You: ')).forEach((n) => n.close());
    return;
  }
  await self.registration.showNotification("Your reply wasn't sent", { ...base, silent: false, body: `${error} Tap to open the app and reply there.` });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // typed into the notification's text box (where the system has one): send it from here
  const typed = event.action === 'reply' && typeof event.reply === 'string' ? event.reply.trim() : '';
  if (typed && data.replyToken) {
    event.waitUntil(sendReply(data, typed.slice(0, 2000)));
    return;
  }
  const link = new URL(data.link || '/', self.location.origin);
  if (event.action === 'open') link.searchParams.delete('reply'); // "Open": just the list, no reply box
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // an open tab of the app: bring it forward and go to the list
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      return tab.navigate(link.href).catch(() => {});
    }
    return self.clients.openWindow(link.href);
  })());
});
