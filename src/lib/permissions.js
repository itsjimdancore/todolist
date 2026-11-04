// The four access levels. These mirror firestore.rules; the rules are what
// actually enforce them. The UI just hides what you can't do.
export const PERMISSIONS = {
  read: {
    label: 'Read only',
    desc: 'Can view tasks. No changes, no comments.',
  },
  comment: {
    label: 'Comment only',
    desc: 'Can view tasks and join the comment thread.',
  },
  write: {
    label: 'Write only',
    desc: 'Can add, edit, complete, archive and delete tasks.',
  },
  readwrite: {
    label: 'Read & write',
    desc: 'Full editing rights plus the comment thread.',
  },
};

export const canWrite = (role) => role === 'owner' || role === 'write' || role === 'readwrite' || role === 'partner';
export const canComment = (role) => role === 'owner' || role === 'comment' || role === 'readwrite' || role === 'partner';
// 'partner': my partner's lists and letters (see lib/partner.js): edit and comment, but not delete, rename or share
export const roleLabel = (role) => (role === 'owner' ? 'Owner' : role === 'partner' ? 'Partner' : PERMISSIONS[role]?.label ?? 'No access');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
