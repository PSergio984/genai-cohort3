import type { JSX } from 'react';

interface WriteProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function Write({ value, onChange, onSave, saving }: WriteProps): JSX.Element {
  return (
    <section aria-labelledby="write-h" className="segment">
      <h2 id="write-h">Write</h2>
      <label className="field-label" htmlFor="entry">
        Entry text
      </label>
      <textarea
        id="entry"
        className="entry-field"
        rows={4}
        maxLength={5000}
        placeholder="I walked here today feeling stuck."
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
      />
      <div className="row between stack">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <span className="meta count" aria-live="polite">
          {value.length} / 5000
        </span>
      </div>
      <p className="hint">
        Saved entries are immutable — history stays an honest record. Ungrounded entries are
        first-class.
      </p>
    </section>
  );
}
