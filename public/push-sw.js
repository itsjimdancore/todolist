// Device notifications for Shared To-Do.
// /api/push sends each one through Firebase Cloud Messaging as data: { title, body, link, tag }.
// This shows it in the phone's notification bar / the Windows or Mac notification centre,
// and opens the app on that list when it is clicked (a comment link has &reply=1: it opens on the comments,
// ready to reply; its Reply button does the same, and Open opens the list without the reply box).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Stickers shared to the app from Android's share sheet (manifest.js share_target): keep the files where the app
// can take them (Cache Storage 'shared-stickers'), then open the chat, which adds them to Favourites.
// Only this one request is handled here; everything else goes to the network as usual.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith((async () => {
    try {
      const form = await req.formData();
      const files = form.getAll('stickers').filter((f) => f && typeof f !== 'string').slice(0, 300);
      await caches.delete('shared-stickers');
      const cache = await caches.open('shared-stickers');
      await Promise.all(files.map((f, i) => cache.put(`/__shared-stickers/${i}`, new Response(f, {
        headers: { 'Content-Type': f.type || 'image/webp', 'X-Name': encodeURIComponent(f.name || 'sticker.webp') },
      }))));
    } catch { /* nothing kept: the chat just opens */ }
    return Response.redirect('/?view=chat', 303);
  })());
});

// "Also while I'm using the app": the page saves it in Cache Storage, which this worker can read.
// On unless it was turned off ('0'), so notifications show even while the app is open.
async function whileOpen() {
  try {
    const res = await (await caches.open('todo-prefs')).match('/__prefs/while-open');
    return !res || (await res.text()) !== '0';
  } catch {
    return true;
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

  // a call ringing: it stays until answered or declined (where the system allows), with Answer and Decline buttons.
  // Someone looking at the app right now gets the app's own ringing screen instead.
  if (msg.type === 'call') {
    event.waitUntil((async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (open.some((c) => c.focused && c.visibilityState === 'visible')) return;
      await self.registration.showNotification(msg.title, {
        body: msg.body || 'Incoming call',
        icon: '/icons/emblem-192.png',
        badge: '/icons/badge-72.png',
        tag: msg.tag,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [600, 300, 600, 300, 600, 300, 600],
        actions: [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }],
        data: { type: 'call', link: msg.link || '/?chat=1', callId: msg.callId || '', declineToken: msg.declineToken || '', declineUrl: msg.declineUrl || '', tag: msg.tag },
      });
    })());
    return;
  }
  // the call stopped ringing (answered somewhere, declined, or they gave up): take it away, or say it was missed
  if (msg.type === 'call-end') {
    event.waitUntil((async () => {
      const shown = await self.registration.getNotifications({ tag: msg.tag });
      shown.forEach((n) => n.close());
      if (msg.missed === '1') {
        await self.registration.showNotification(msg.title, {
          body: msg.body || 'Missed call', icon: '/icons/emblem-192.png', badge: '/icons/badge-72.png', tag: msg.tag,
          renotify: false, silent: true, data: { link: msg.link || '/?chat=1' },
        });
      }
    })());
    return;
  }

  // a chat message reached this device: "delivered" (the sender sees grey double ticks), like WhatsApp
  if (msg.tag && msg.tag.startsWith('chat-') && msg.replyToken) {
    event.waitUntil(fetch((msg.replyUrl || '/api/reply').replace('/api/reply', '/api/delivered'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: msg.replyToken }),
    }).catch(() => {}));
  }

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

// A call's notification: Decline declines it from here (with the chat's pass, see /api/call-decline); Answer opens
// the app straight into the call; tapping the notification itself opens the app on its ringing screen.
function callClick(event, data) {
  if (event.action === 'decline') {
    if (data.declineToken) {
      event.waitUntil(fetch(data.declineUrl || '/api/call-decline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: data.declineToken, callId: data.callId }),
      }).catch(() => {}));
    }
    return;
  }
  const answer = event.action === 'answer';
  const link = new URL(data.link || '/?chat=1', self.location.origin);
  if (answer) link.searchParams.set('answer', '1');
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      // the app is open: tell it, without reloading it
      await tab.focus().catch(() => {});
      tab.postMessage({ type: 'call', callId: data.callId, answer });
      return;
    }
    await self.clients.openWindow(link.href);
  })());
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.type === 'call') { callClick(event, data); return; }
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
