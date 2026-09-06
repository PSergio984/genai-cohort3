import type { JSX } from 'react';

interface AuthProps {
  signedIn: boolean;
  displayName: string;
  onSignIn: () => void;
  onSignOut: () => void;
  busy: boolean;
}

export function Auth({ signedIn, displayName, onSignIn, onSignOut, busy }: AuthProps): JSX.Element {
  return (
    <section aria-label="Sign in">
      {signedIn ? (
        <div className="authline">
          <span className="display-name">{displayName}</span>
          <button type="button" className="quiet" onClick={onSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="authline">
          <button type="button" onClick={onSignIn} disabled={busy}>
            Sign in with Google
          </button>
        </div>
      )}
    </section>
  );
}
