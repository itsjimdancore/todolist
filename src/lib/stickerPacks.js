// The built-in sticker packs. Each sticker's image is public/stickers/{pack}/{id}.svg, so a message only stores
// { pack, id }. Ids are lowercase letters, digits and dashes (firestore.rules checks the same).
export const PACKS = [
  {
    id: 'us',
    name: 'Us',
    icon: 'us',
    stickers: [
      ['us', 'Us'], ['good-morning', 'Good morning'], ['good-night', 'Good night'], ['on-it', 'On it!'],
      ['done', 'Done!'], ['miss-you', 'Miss you'], ['love-you', 'Love you'], ['hug', 'Hug!'],
      ['thank-you', 'Thank you'], ['sorry', 'Sorry'], ['proud-of-you', 'Proud of you'], ['haha', 'Haha'],
      ['coffee', 'Coffee?'], ['on-my-way', 'On my way'], ['five-more-mins', '5 more mins'], ['yay', 'Yay!'],
    ].map(([id, label]) => ({ pack: 'us', id, label })),
  },
];

const LABELS = new Map(PACKS.flatMap((p) => p.stickers.map((s) => [`${s.pack}-${s.id}`, s.label])));

// a sticker (from a message, a pack or my saved ones) → an image address
export const stickerSrc = (s) => (s?.pack ? `/stickers/${s.pack}/${s.id}.svg` : s?.data ? `data:${s.mime};base64,${s.data}` : '');
// its key: "pack-id" for a built-in one, the image's hash for a made one (users/{uid}/stickers/{key})
export const stickerKey = (s) => (s?.pack ? `${s.pack}-${s.id}` : s?.hash || '');
// what a screen reader says
export const stickerLabel = (s) => (s?.pack && LABELS.get(`${s.pack}-${s.id}`)) || 'Sticker';
// just what a message stores: { pack, id } or { data, mime, hash }
export const stickerOf = (s) => (s.pack ? { pack: s.pack, id: s.id } : { data: s.data, mime: s.mime, hash: s.hash });
