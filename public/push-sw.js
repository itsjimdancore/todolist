// Device notifications for Shared To-Do.
// /api/push sends each one through Firebase Cloud Messaging as data: { title, body, link, tag }.
// This shows it in the phone's notification bar / the Windows or Mac notification centre,
// and opens the app on that list when it's clicked (a comment's link has &reply=1: it opens on the comments,
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
      // a comment: a Reply button (where the system shows buttons: Android, Windows, Mac). It opens the list on
      // its comments with the box ready to type, as does tapping the notification itself.
      actions: msg.reply === '1' ? [{ action: 'reply', title: 'Reply' }, { action: 'open', title: 'Open' }] : [],
      data: { link: msg.link || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = new URL(event.notification.data?.link || '/', self.location.origin);
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
