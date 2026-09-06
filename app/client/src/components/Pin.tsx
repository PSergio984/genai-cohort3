import type { JSX } from 'react';

export function PinGlyph({ label }: { label?: string }): JSX.Element {
  return (
    <svg
      className="pin"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      <path d="M6 1.5a3.5 3.5 0 0 0-3.5 3.5C2.5 7.5 6 10.5 6 10.5s3.5-3 3.5-5.5A3.5 3.5 0 0 0 6 1.5Z" />
      <circle cx="6" cy="5" r="1.25" />
    </svg>
  );
}
