import type { JSX } from 'react';
import type { Status } from '../types.js';

export function StatusLine({ status }: { status: Status }): JSX.Element {
  return (
    <div className="status" role="status" aria-live="polite" data-tone={status.tone ?? undefined}>
      {status.message}
    </div>
  );
}
