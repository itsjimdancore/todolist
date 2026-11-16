// Lets the app be installed (Add to Home Screen / Install app). On iPhone and iPad, device
// notifications only work once it's been added to the Home Screen and opened from there.
export default function manifest() {
  return {
    name: 'Shared To-Do',
    short_name: 'To-Do',
    description: 'To-do lists you can share with read, comment and write access.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f1514',
    theme_color: '#0f1514',
    // Android (installed app): "Share" stickers from the Files app (WhatsApp's sticker folder) straight into the app.
    // public/push-sw.js receives them and opens the chat, where they're added to Favourites.
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { files: [{ name: 'stickers', accept: ['image/webp', 'image/png', 'image/jpeg', 'image/gif', '.webp'] }] },
    },
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
