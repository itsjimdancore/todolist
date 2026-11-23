'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { fb, firebaseConfigured } from '@/lib/firebase';
import { Splash } from '@/components/Loading';
import Login from '@/components/Login';
import Workspace from '@/components/Workspace';

export default function Home() {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    const f = fb();
    if (!f) return;
    // Firebase remembers the signed-in user, so returning visitors skip the login screen
    return onAuthStateChanged(f.auth, (u) => setUser(u));
  }, []);

  if (!firebaseConfigured) return <SetupNeeded />;
  if (user === undefined) return <Splash hint="Signing you in" />;
  if (!user) return <Login />;
  return <Workspace key={user.uid} user={user} />;
}

function SetupNeeded() {
  return (
    <div className="center">
      <div className="card narrow">
        <h1>Connect Firebase</h1>
        <p>
          This app needs a Firebase project. Copy <code>env.example</code> to <code>.env.local</code>, paste in
          your Firebase web app settings, then restart <code>npm run dev</code>.
        </p>
        <p className="muted">Full steps are in README.md.</p>
      </div>
    </div>
  );
}
