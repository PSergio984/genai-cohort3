import { useEffect, useRef, useState, type JSX } from 'react';
import type { GroundingSnapshot, PlaceDetails, Prediction } from '../types.js';
import { PinGlyph } from './Pin.js';

interface GroundProps {
  groundings: GroundingSnapshot[];
  details: Record<string, PlaceDetails>;
  detailsLoading: string | null;
  resolvedQuery: string;
  onSearch: (query: string) => void;
  predictions: Prediction[];
  onGround: (prediction: Prediction) => void;
  onRemove: (placeId: string) => void;
  onToggleDetails: (placeId: string) => void;
}

export function Ground({
  groundings,
  details,
  detailsLoading,
  resolvedQuery,
  onSearch,
  predictions,
  onGround,
  onRemove,
  onToggleDetails,
}: GroundProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      onSearch('');
      return;
    }
    timer.current = window.setTimeout(() => onSearch(q), 250);
    return () => window.clearTimeout(timer.current);
    // onSearch is stable (useCallback in App).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    setActive(-1);
    buttons.current = [];
  }, [predictions]);

  // The empty message answers only a completed search for the current query:
  // showing it mid-debounce would flash a false negative while typing.
  const showEmpty =
    query.trim() === resolvedQuery && resolvedQuery.length >= 2 && predictions.length === 0;

  function onInputKey(ev: React.KeyboardEvent): void {
    if (predictions.length === 0) {
      if (ev.key === 'Escape') setQuery('');
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next =
        ev.key === 'ArrowDown'
          ? (active + 1) % predictions.length
          : (active - 1 + predictions.length) % predictions.length;
      setActive(next);
      buttons.current[next]?.focus();
    } else if (ev.key === 'Escape') {
      setQuery('');
    }
  }

  function ground(prediction: Prediction): void {
    setQuery('');
    setActive(-1);
    onGround(prediction);
  }

  return (
    <section aria-labelledby="ground-h" className="segment">
      <h2 id="ground-h">Ground</h2>
      <label className="field-label" htmlFor="search">
        Find a place to ground this entry
      </label>
      <input
        id="search"
        type="text"
        maxLength={200}
        placeholder="Search a place…"
        autoComplete="off"
        role="combobox"
        aria-expanded={predictions.length > 0}
        aria-controls="suggestions"
        aria-autocomplete="list"
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        onKeyDown={onInputKey}
      />
      <ul id="suggestions" className="suggestions" role="listbox" aria-label="Place suggestions">
        {showEmpty ? (
          <li className="none">No places found — your entry stays ungrounded.</li>
        ) : (
          predictions.map((p, i) => (
            <li key={p.placeId} role="option" aria-selected={i === active}>
              <button
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                aria-selected={i === active}
                onClick={() => ground(p)}
              >
                {p.text}
              </button>
            </li>
          ))
        )}
      </ul>
      <ul className="ledger" aria-label="Groundings">
        {groundings.length === 0 ? (
          <li className="empty">No groundings yet — search above, or reflect ungrounded.</li>
        ) : (
          groundings.map((s) => {
            const cached = details[s.placeId];
            const open = cached !== undefined;
            const loading = detailsLoading === s.placeId;
            const facts: string[] = [];
            if (cached !== undefined) {
              if (typeof cached.rating === 'number') facts.push(`Rating: ${cached.rating}`);
              if (Array.isArray(cached.hours)) facts.push(`Hours: ${cached.hours.join('; ')}`);
              facts.push(cached.attributions);
            }
            return (
              <li key={s.placeId}>
                <div className="place">
                  <PinGlyph label="Grounded place" />
                  {s.name} — {s.address}
                </div>
                <div className="meta">{s.attributions}</div>
                {open ? <div className="meta details">{facts.join(' · ')}</div> : null}
                <div className="actions">
                  <button
                    type="button"
                    className="quiet"
                    disabled={loading}
                    aria-label={open ? `Hide cached details for ${s.name}` : `Show cached details for ${s.name}`}
                    onClick={() => onToggleDetails(s.placeId)}
                  >
                    {open ? 'Hide' : 'Details'}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove grounding ${s.name}`}
                    onClick={() => onRemove(s.placeId)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <p className="hint">Write first, ground when ready. Grounding freezes once the first reflection exists.</p>
    </section>
  );
}
