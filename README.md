# Shared To-Do

A to-do list app where you can share any list with other people and choose what each person can do:

| Access | View tasks | Comment | Add / edit / complete / archive / delete |
|---|:-:|:-:|:-:|
| **Read only** | ✓ | | |
| **Comment only** | ✓ | ✓ | |
| **Write only** | ✓ | | ✓ |
| **Read & write** | ✓ | ✓ | ✓ |
| Owner | ✓ | ✓ | ✓, plus share, rename, delete list |

Everything is saved to **Firebase** the moment it happens. When you sign in on any device, the app reopens the list you were last on, with every task and comment as you left it. Changes from other people appear live. A copy is also kept in your browser, so the app opens instantly and keeps working offline; changes sync when you're back online.

A **Spotify player** sits in the sidebar and keeps playing while you move around the app. ⏮ and ⏭ move through your saved music, 🔁 repeats the song, and when a song ends the next one starts. On the **Music** page you type a song name, pick the right version from the list (song, artist, album, year), copy its link on Spotify and press Ctrl+V; it is kept there for next time. The song list comes from Apple's free iTunes Search, so no Spotify developer account or Premium is needed. Your music and what's playing are saved on your profile, so they follow you to every device. People signed in to Spotify in that browser hear full songs; everyone else gets 30-second previews.

Stack: **Next.js 15** (React 19), **Firebase Authentication** (email/password and Google) and **Cloud Firestore** (database, live updates, offline cache).

---

## Setup

You need:
- **Node.js 18.18 or newer** (run `node -v` to check)
- A **Google account** for the Firebase console

Everything below works on Firebase's free **Spark** plan. Only the optional invitation emails (step 9) need the pay-as-you-go **Blaze** plan.

### 1. Install the packages

Open a terminal (PowerShell or the VS Code terminal) in this folder:

```bash
npm install
```

### 2. Create a Firebase project

1. Go to https://console.firebase.google.com and sign in.
2. Click **Create a project** (or **Add project**).
3. Enter a name, for example `shared-todo`. Firebase gives it a **Project ID** such as `shared-todo-1a2b3`; note it down.
4. Google Analytics is optional; you can turn it off. Click **Create project** and wait for it to finish.

### 3. Register the web app and get your keys

1. On the project's home page, click the **Web** icon (`</>`) under "Get started by adding Firebase to your app".
2. Enter a nickname, for example `shared-todo-web`. Leave **Firebase Hosting** unticked. Click **Register app**.
3. Firebase shows a `firebaseConfig` block like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "shared-todo-1a2b3.firebaseapp.com",
     projectId: "shared-todo-1a2b3",
     storageBucket: "shared-todo-1a2b3.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123..."
   };
   ```
   Keep this page open. You can find it again later under ⚙️ **Project settings** → **General** → **Your apps**.
4. In this folder, copy `env.example` to a new file named **`.env.local`**:
   ```powershell
   copy env.example .env.local
   ```
5. Open `.env.local` and paste each value:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=shared-todo-1a2b3.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=shared-todo-1a2b3
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=shared-todo-1a2b3.firebasestorage.app
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
   NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123...
   ```

> These web keys are meant to be public: they identify your project, they don't unlock it. What protects your data is the security rules in step 6.

### 4. Turn on sign-in

1. In the Firebase console, open **Build → Authentication** and click **Get started**.
2. On the **Sign-in method** tab:
   - Click **Email/Password** → turn on **Email/Password** (leave "Email link" off) → **Save**.
   - Click **Add new provider** → **Google** → turn it on → pick a **support email** → **Save**.
3. On the **Settings** tab → **Authorized domains**: `localhost` is already listed. Add your live domain here later (see "Going live").
4. (Optional) **Templates** tab: edit the sender name and wording of the verification and password-reset emails.

### 5. Create the Firestore database

1. Open **Build → Firestore Database** → **Create database**.
2. **Location**: pick one close to your users, such as `europe-west1 (Belgium)` or `eur3 (Europe)` for Kenya. **This can't be changed later.**
3. Choose **Start in production mode** → **Create**.

You don't need to create any collections. The app creates them as you use it.

### 6. Publish the security rules (important)

The rules in `firestore.rules` **are** the permission system: they make sure a Read-only person really can't edit, that only comment roles see the thread, and so on. Until you publish them, production mode blocks everything and the app shows "permission denied" errors.

**Option A: copy and paste (easiest)**
1. In **Firestore Database**, open the **Rules** tab.
2. Delete what's there, paste the whole contents of `firestore.rules`, and click **Publish**.

**Option B: from the terminal**
```bash
npx firebase login
npx firebase use --add          # choose your project, alias "default"
npm run deploy:rules
```

Re-publish whenever you change `firestore.rules`.

> **This project also hosts the graduation site.** `firestore.rules` contains that site's rules too, unchanged, so publishing the file keeps both apps working. Firestore keeps only one set of rules per project, so never publish a file that leaves either section out.

### 7. Run the app

```bash
npm run dev
```

Open http://localhost:3000.

1. Click **Create account** (or **Continue with Google**).
2. Create a list, add tasks, and click **Share**.

**To test sharing on one computer:** open a private/incognito window, create a second account with a different email. Share a list from the first account to that email. The bell in the second window shows a notification; click it to open the list. It also appears under **Shared with me**. Change their access in the Share window and watch the other window update live.

### 8. Sharing with people who don't have an account yet

You can share with any email. The person sees the list, and a notification under the bell, as soon as they sign in **with that same email**. To tell them:
- after sharing, click **Email ... the link** in the Share window to open your email app with the invitation filled in, or copy the **link** and send it on WhatsApp or SMS. The link opens the sign-in screen first, then goes straight to the list, or
- turn on automatic invitation emails (step 9).

### 9. (Optional) Automatic invitation emails

Firebase doesn't send invitation emails on its own. The official **Trigger Email from Firestore** extension can do it:

1. Upgrade the project to the **Blaze** plan (⚙️ → **Usage and billing**). Light use like this usually stays within the free allowance, but a billing account is required. Set a budget alert to be safe.
2. Get SMTP details from an email provider, for example Brevo, SendGrid, Mailgun, or a Gmail account with an App Password (`smtps://you@gmail.com:APP_PASSWORD@smtp.gmail.com:465`).
3. Open **Build → Extensions** → find **Trigger Email from Firestore** → **Install**:
   - **Email documents collection**: `mail`
   - **SMTP connection URI**: from step 2
   - **Default FROM address**: for example `Shared To-Do <you@yourdomain.com>`
4. In `.env.local`, set `NEXT_PUBLIC_INVITE_EMAILS=true` and restart `npm run dev`.

Now, when you share, the app writes one document per person to `mail`, and the extension sends it. The rules only allow a list's **owner** to queue emails, and only to people already on that list.
The **Open the list** link in those emails points at your Vercel address (step 10). When you share while testing on localhost, it points at localhost.

### 10. Put it on Vercel, and keep email links off firebaseapp.com

Every link the app sends out (the shared-list link, invitation emails, the password-reset email) uses
`NEXT_PUBLIC_APP_URL` (default `https://todolist.vercel.app`). On `localhost` the app uses your localhost address
instead, so local trials stay local. The logic lives in `src/lib/appUrl.js`.

1. **Vercel → your project → Settings → Environment Variables**: add every line from `.env.local`, including
   `NEXT_PUBLIC_APP_URL=https://todolist.vercel.app` (use your real address if Vercel gives you a different one). Redeploy.
2. **Firebase console → Authentication → Settings → Authorized domains → Add domain**: `todolist.vercel.app`
   (`localhost` is already there). Without this, Google sign-in and the "back to the app" step in emails fail on Vercel.
3. **Firebase console → Authentication → Templates → Password reset → ✏️ → Customize action URL**:
   `https://todolist.vercel.app/auth/action` → Save.
   The reset link in the email now opens the app's own **Choose a new password** page instead of the
   `…firebaseapp.com` page. After saving, it signs you in and takes you to My List, or to the shared list you came from.
   If you asked for the reset while testing on localhost, the Vercel page passes the link back to localhost before
   using it, so the reset happens on localhost. Keep `npm run dev` running when you click the email link.

---

## How "pick up where you left off" works

| What | Where it's kept | Why |
|---|---|---|
| Lists, tasks, comments, who has access | Firestore | The same on every device, for everyone |
| Which list you had open | `users/{yourId}.lastListId` in Firestore | Reopens on any device you sign in from |
| Your login | Browser (handled by Firebase Auth) | You stay signed in |
| A copy of your data | Browser (Firestore offline cache) | Instant start, works offline, syncs later |
| Half-typed task or comment | Browser storage, per list | Survives an accidental refresh |

When the app opens it:
1. Restores your login, or shows the sign-in screen.
2. Listens live to **lists you own** (`ownerId == you`) **lists shared with you** (`memberEmails` contains your email).
3. Opens the list from the link (`?list=…`), otherwise the list you were last on, otherwise your most recently changed list.
4. Listens live to that list's tasks, and its comments if your access includes them.

Every action is saved straight away. Firestore shows the change on screen at once and syncs it in the background. If the rules refuse it, Firestore undoes it and the app shows why.

---

## Data structure (Firestore)

```
users/{uid}
  email, displayName, lastListId, favorites, listOrder, updatedAt
  spotify   what the sidebar player is playing
  music     [ { type, id, title, artist, album, ms, image, addedAt } ]   ← songs kept on the Music page (up to 100)

lists/{listId}
  title, ownerId, ownerEmail, ownerName, createdAt, updatedAt
  roles:        { "wanjiru@gmail.com": "readwrite", "brian@outlook.com": "comment" }
  memberEmails: [ "wanjiru@gmail.com", "brian@outlook.com" ]      ← same emails, for searching

  tasks/{taskId}
    text, done, archived, createdBy, createdByName, createdAt, updatedAt, updatedBy, updatedByName

  comments/{commentId}
    text, userId, userName, userEmail, createdAt

mail/{id}          (only with invitation emails turned on)
  to, listId, createdBy, message { subject, text, html }
```

Sharing works by email rather than user ID, so you can share with people before they have an account. `roles` says what each person can do; `memberEmails` lets the app ask "which lists are shared with me?" The rules check that the two always match.

No composite indexes are needed: every query uses a single field.

---

## Project structure

```
firestore.rules              Security rules = the permission system
firebase.json                Firebase CLI settings (rules file, emulator ports)
firestore.indexes.json       Indexes (none needed)
tests/rules.test.mjs         Automated checks for every access level
env.example                  Template for .env.local
src/app/page.js              Entry: sign-in screen or the app
src/app/layout.js            Page shell and fonts
src/app/globals.css          All styling (light and dark mode)
src/components/
  Login.js                   Email/password, Google, forgot password
  Workspace.js               Sidebar, restores your last list, notification bell, leaving a list
  Music.js                   Music page: find songs by name, keep them, play them
  MusicPlayer.js             Spotify player in the sidebar
  Notifications.js           Bell with "X shared a list with you"; click one to open the list
  ListView.js                Tasks, live updates, role-based buttons
  TaskItem.js                One task: tick, edit, archive, delete
  Comments.js                Shared comment thread
  ShareModal.js              Contacts, email + button, access levels, manage access
  Toast.js                   Small status messages
src/lib/
  firebase.js                Firebase setup, offline cache, friendly error messages
  data.js                    Every database read and write
  permissions.js             The four access levels
  people.js                  Names, avatars, times
  useDraft.js                Keeps unsent text in the browser
```

---

## Testing the rules on your computer (optional, recommended)

`tests/rules.test.mjs` checks every access level against `firestore.rules` using Firebase's local emulator. Examples: a reader can't edit, a writer can't comment, a member can't raise their own access, a stranger sees nothing.

1. Install **Java 21 or newer** (for example Temurin from https://adoptium.net, or `winget install EclipseAdoptium.Temurin.21.JDK`). Check with `java -version`.
2. Run:
   ```bash
   npm run test:rules
   ```
   The first run downloads the emulator. Every test should say `ok`.

You can also run the whole app against local emulators with fake accounts: set `NEXT_PUBLIC_USE_EMULATORS=true` in `.env.local`, run `npm run emulators` in one terminal and `npm run dev` in another. The emulator dashboard is at http://localhost:4000.

---

## Going live (Vercel)

1. Push this folder to a GitHub repository. `.env.local` is ignored, so your settings stay out of it.
2. On https://vercel.com, import the repository.
3. Under **Environment Variables**, add the same `NEXT_PUBLIC_FIREBASE_...` values as in `.env.local` (and `NEXT_PUBLIC_INVITE_EMAILS` if you use it).
4. Deploy.
5. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add your Vercel address, for example `your-app.vercel.app`. Without this, Google sign-in and email links won't work on the live site.

Firebase Hosting works too, but Vercel is the simplest option for Next.js.

---

## Desktop notifications

When someone else does something on a list you're on, you can get a notification on your computer or
phone (a Windows toast, a macOS banner, Android's notification bar), even with the app's tab closed.
You're never notified about your own changes. They also show while the app is open in front of you,
alongside the in-app toast; turn off **Also while I'm using the app** to get just the toast then.

**How it works**

- Turning them on (Notifications → **Settings** → **Device notifications**, or **Turn on** in the bell's
  banner) asks the browser for permission and saves this device's Firebase Cloud Messaging token to
  `pushTokens/{token}`. The browser only asks after that click, never on page load.
- After a change that notifies people, the app calls `/api/push` with the ids of the notifications it just
  wrote (`activity/{id}`, `invites/{id}`). The server checks your ID token, claims each one so it's sent
  only once, and sends only notifications **you** created in the last two minutes. Who receives what is
  decided when the notification is written, by the security rules (for example, comments only go to people
  with Comment only or Read & write access, and the owner).
- It respects each person's choices in **Notification settings**, sends at most one per sender, list and
  person every 10 seconds, and forgets devices that have gone away.
- `public/push-sw.js` shows the notification (the emblem as its icon, the list as its title) and opens
  that list when it's clicked.

**Setup**

1. **VAPID key:** Firebase console → ⚙ Project settings → **Cloud Messaging** → **Web Push certificates** →
   **Generate key pair**. Copy the key into `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
2. **Service account (server only):** Project settings → **Service accounts** → **Generate new private key**.
   Paste the whole downloaded JSON file as the value of `FIREBASE_SERVICE_ACCOUNT`. Never commit it.
3. On Vercel: **Settings → Environment Variables**, add both, then **Redeploy**. The project needs Node 22
   or newer (`package.json` pins 24.x).
4. Publish the rules: `npm run deploy:rules`.

**Testing**

- Notifications → **Settings** → turn on **Device notifications** → **Send a test notification**. If it
  doesn't arrive, the message says what's wrong (for example a missing or invalid service account).
- For the real thing, use a second account: share a list with it, then close its tab and add a comment from
  the first account. The second account's computer shows the notification; clicking it opens the list.
- On iPhone and iPad, notifications only work from the app added to the Home Screen.
- If notifications are blocked: click the padlock in the address bar → **Notifications** → **Allow**.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Connect Firebase" screen | `.env.local` is missing or still has placeholder values. Fix it, then stop and restart `npm run dev`. |
| "You don't have permission…" / `permission-denied` everywhere | The rules weren't published (step 6), or you published the default rules. |
| "Shared with me" is empty | Sign in with exactly the email the list was shared to. |
| Google sign-in: `unauthorized-domain` | Add the domain under Authentication → Settings → Authorized domains. |
| "This sign-in method is turned off" | Enable Email/Password or Google in Authentication → Sign-in method. |
| Reset email doesn't arrive | Check spam. Firebase's sender can be slow. |
| Changes don't sync | You're offline. Changes are kept on this device and sync when you reconnect. |
| Error about the offline cache / IndexedDB in a private window | Some browsers block it in private mode; the app falls back to online-only automatically. |





TO-Dp
The Marketplace's email option is Resend (resend/resend-email), so I'll build on that. Connecting it to your Vercel account needs your login and a browser step, which I can't do for you. Here's what to do; the ! at the start runs each command right here in this chat:

1. Log in to Vercel: ! npx vercel login
2. Link this folder to your Vercel project: ! npx vercel link. Pick the project behind sharedtodolist.vercel.app.
3. Add Resend: ! npx vercel integration add resend/resend-email. If it opens a browser to accept terms or create the Resend account, finish that there. It adds the Resend key to your Vercel project automatically.
4. Firebase admin key, so the daily job can read tasks on the server:
   - In the Firebase console, go to ⚙️ Project settings → Service accounts → Generate new private key. That downloads a JSON file.
   - In Vercel, go to your project → Settings → Environment Variables, add FIREBASE_SERVICE_ACCOUNT, and paste the whole JSON file's contents as the value.
   - Please don't paste that key into this chat. It gives full access to your database.

One thing to know about Resend: until you verify a domain you own with it, Resend only sends to the email address on your Resend account. That's enough for testing reminders on yourself. Reminding your other users needs your own domain (for example sharedtodo.app, which you could buy through Vercel) verified in Resend. You can't verify vercel.app because Vercel owns it. You can start testing without a domain and add one later.

Tell me when steps 1–4 are done, or if any step gives an error. Then I'll build:
- the Reminders setting in the account menu
- the daily /api/reminders job with a Vercel Cron schedule (once a day in the morning, Kenya time)
- the digest email itself
- the switch of all app links to https://sharedtodolist.vercel.app