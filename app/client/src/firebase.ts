// Firebase Auth (Google sign-in) proves identity; the ID token rides every
// API call and the server derives the Vault from it (one Vault per user).
// The web config below is public by design (it ships to every browser — an
// identifier, not a secret) AND scanner-hostile, so it arrives via build-time
// env, never source: copy app/client/.env.example to app/client/.env locally;
// CI/CD provide the same VITE_ names from repo Variables; the Docker build
// takes them as build args (see Dockerfile + cmd.md section 4).
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

function webConfig(): { apiKey: string; authDomain: string; projectId: string; appId: string } {
  const env = import.meta.env;
  const missing = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].filter(
    (k) => typeof env[k] !== 'string' || (env[k] as string) === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web config (${missing.join(', ')}) — copy app/client/.env.example to app/client/.env (values: Firebase console → Project settings → Your apps).`,
    );
  }
  return {
    apiKey: env.VITE_FIREBASE_API_KEY as string,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string,
    appId: env.VITE_FIREBASE_APP_ID as string,
  };
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
