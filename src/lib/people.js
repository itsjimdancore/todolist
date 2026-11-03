const COLORS = ['#0f6b5f', '#6a4bc4', '#b4531e', '#2b6cb0', '#a3336d', '#5a7a1f', '#8a5a00', '#4a5a8a'];

export function displayName(person) {
  if (!person) return 'Someone';
  return person.displayName || person.email || 'Someone';
}

export function initials(name = '') {
  if (name.includes('@')) return name[0].toUpperCase();
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

// Stable colour per person, so they look the same everywhere
// (null too: music notifications have no list)
export function colorFor(key) {
  const s = key ? String(key) : '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// The person's photo when we have one (Google sign-in), their initials otherwise, or if the photo won't load.
// title={false} leaves the hover tooltip off (when a card shows the name instead).
export function Avatar({ person, size = 28, title = true }) {
  const name = displayName(person);
  const photo = person?.photoURL;
  return (
    <span
      className={photo ? 'av has-photo' : 'av'}
      title={title ? name : undefined}
      style={{ background: colorFor(person?.email || name), width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      )}
    </span>
  );
}

// "Active now" (app open), then once they've left: "Active just now", "Active 12 min ago", "Active 3 h ago",
// "Last active today at 14:20", "Last active yesterday at 14:20", and from two days back "Last active 2026/November/01 at 14:20"
export function lastSeenLabel(ts, online = false) {
  if (!ts) return 'Not active here yet';
  const d = toDate(ts);
  const s = (Date.now() - d.getTime()) / 1000;
  // the app checks in every 5 minutes while it's open, so an "online" older than that means it was closed without saying so
  if (online && s < 6 * 60) return 'Active now';
  if (s < 60) return 'Active just now';
  if (s < 3600) return `Active ${Math.floor(s / 60)} min ago`;
  if (s < 6 * 3600) return `Active ${Math.floor(s / 3600)} h ago`;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((today - day) / 86400000);
  if (days === 0) return `Last active today at ${time}`;
  if (days === 1) return `Last active yesterday at ${time}`;
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  return `Last active ${d.getFullYear()}/${month}/${String(d.getDate()).padStart(2, '0')} at ${time}`;
}

// Accepts a Firestore Timestamp, a Date, or nothing (a write that hasn't synced yet)
export function toDate(ts) {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

export function timeAgo(ts) {
  const d = toDate(ts);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
