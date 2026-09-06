// Firebase Auth (Google sign-in) proves identity; the ID token rides every
// API call and the server derives the Vault from it (one Vault per user).
// The web config below is public by design (it ships to every browser — an
// identifier, not a secret) AND scanner-hostile, so it never lives in source:
// production reads the server-rendered window.__FIREBASE_CONFIG__ (served from
// FIREBASE_WEB_* env; see cmd.md section 4), local Vite builds fall back to
// app/client/.env (gitignored; see .env.example). CI/CD provide VITE_ names
// from repo Variables for the fallback path.
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

declare global {
  interface Window {
    __FIREBASE_CONFIG__?: Partial<WebConfig> | null;
  }
}

function webConfig(): WebConfig {
  const runtime = typeof window !== 'undefined' ? (window.__FIREBASE_CONFIG__ ?? {}) : {};
  const build = import.meta.env;
  const pick = (key: keyof WebConfig, viteKey: string): string | undefined => {
    const fromRoute = runtime[key];
    if (typeof fromRoute === 'string' && fromRoute !== '') return fromRoute;
    const fromBuild = build[viteKey];
    return typeof fromBuild === 'string' && fromBuild !== '' ? fromBuild : undefined;
  };
  const resolved: Partial<WebConfig> = {
    apiKey: pick('apiKey', 'VITE_FIREBASE_API_KEY'),
    authDomain: pick('authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: pick('projectId', 'VITE_FIREBASE_PROJECT_ID'),
    appId: pick('appId', 'VITE_FIREBASE_APP_ID'),
  };
  const missing = (Object.keys(resolved) as Array<keyof WebConfig>).filter(
    (k) => resolved[k] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web config (${missing.join(', ')}) — the server route /firebase-config.js came back empty (set FIREBASE_WEB_* env; see cmd.md section 4) and no VITE_ fallback was built in (copy app/client/.env.example to app/client/.env; values: Firebase console → Project settings → Your apps).`,
    );
  }
  return resolved as WebConfig;
}

const app = initializeApp(webConfig());

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export async function signIn(): Promise<void> {
  await signInWithPopup(auth, provider);
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function watchUser(next: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, next);
}

export async function currentToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (user === null) throw new Error('not signed in');
  return user.getIdToken(forceRefresh);
}
