import type { JSX, ReactNode } from 'react';
import type { HistoryFilter, HistoryRow } from '../types.js';
import { formatTurn } from './Reflect.js';
import { PinGlyph } from './Pin.js';

export type HistoryView = 'list' | 'map';

interface HistoryProps {
  rows: HistoryRow[];
  total: number;
  loading: boolean;
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
  onRefresh: () => void;
  refreshing: boolean;
  view: HistoryView;
  onViewChange: (view: HistoryView) => void;
  mapPane: ReactNode;
  selectedId: string | null;
  onOpen: (id: string) => void;
}

export function History({
  rows,
  total,
  loading,
  filter,
  onFilter,
  onRefresh,
  refreshing,
  view,
  onViewChange,
  mapPane,
  selectedId,
  onOpen,
}: HistoryProps): JSX.Element {
  return (
    <section aria-labelledby="history-h" className="segment">
      <h2 id="history-h">History</h2>
      <div className="row" role="group" aria-label="History controls">
        <button type="button" className="quiet" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="row stack" role="group" aria-label="History controls">
        <span className="seg" role="group" aria-label="Filter entries">
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => onFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={filter === 'grounded'}
            onClick={() => onFilter('grounded')}
          >
            Grounded
          </button>
          <button
            type="button"
            aria-pressed={filter === 'ungrounded'}
            onClick={() => onFilter('ungrounded')}
          >
            Ungrounded
          </button>
        </span>
        <span className="seg" role="group" aria-label="History view">
          <button type="button" aria-pressed={view === 'list'} onClick={() => onViewChange('list')}>
            List
          </button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => onViewChange('map')}>
            Map
          </button>
        </span>
      </div>
      <p className="hint">Revisiting history is free — display reads are cache-only and never burn quota.</p>
      {view === 'map' ? (
        mapPane
      ) : loading ? (
        <div aria-label="Loading history">
          <div className="skeleton" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="skeleton" aria-hidden="true">
            <span />
            <span />
          </div>
        </div>
      ) : (
        <ul className="history">
          {rows.length === 0 ? (
            <li className="empty">
              {total === 0
                ? 'No entries yet — write your first entry above.'
                : 'Nothing under this filter — try All.'}
            </li>
          ) : (
            rows.map((row) => {
              const snaps = row.entry.groundingSnapshots ?? [];
              const grounded = snaps.length > 0;
              const when =
                row.entry.createdAt !== undefined && row.entry.createdAt !== ''
                  ? new Date(row.entry.createdAt).toLocaleString()
                  : '';
              const turnCount = (row.entry.turns ?? []).length;
              return (
                <li key={row.id} className={row.id === selectedId ? 'selected' : undefined}>
                  <div className="entry-text">{row.entry.text}</div>
                  <div className="meta">
                    {grounded ? (
                      <span className="state grounded">
                        <PinGlyph /> Grounded in: {snaps.map((s) => s.name).join(', ')}
                      </span>
                    ) : (
                      <span className="state">Ungrounded</span>
                    )}
                    {when !== '' ? ` · ${when}` : ''}
                    {turnCount > 0
                      ? ` · ${turnCount} turn${turnCount === 1 ? '' : 's'}`
                      : ''}
                  </div>
                  {row.entry.turns.length > 0 ? (
                    <div className="preview">
                      {row.entry.turns.slice(-2).map((t, i) => {
                        const txt = formatTurn(t);
                        return (
                          <div
                            key={i}
                            className={t.by === 'user' ? 'turn user' : 'turn model'}
                          >
                            {txt.length > 280 ? `${txt.slice(0, 280)}…` : txt}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="open">
                    <button
                      type="button"
                      className="linklike"
                      aria-label="Continue the session for this entry"
                      onClick={() => onOpen(row.id)}
                    >
                      Continue session
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </section>
  );
}
