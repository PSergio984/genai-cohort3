import type { JSX } from 'react';
import type { GroundingSnapshot, Turn } from '../types.js';
import { PinGlyph } from './Pin.js';

export function formatTurn(t: Turn): string {
  return `${t.by === 'user' ? 'You' : 'Gemini'}: ${t.text}`;
}

export function snapshotName(snapshots: GroundingSnapshot[], placeId: string): string {
  const found = snapshots.find((s) => s.placeId === placeId);
  return found === undefined ? placeId : found.name;
}

interface ReflectProps {
  turns: Turn[];
  snapshots: GroundingSnapshot[];
  onReflect: () => void;
  reflecting: boolean;
  followup: string;
  onFollowupChange: (value: string) => void;
  onSendFollowup: () => void;
  sendingFollowup: boolean;
}

export function Reflect({
  turns,
  snapshots,
  onReflect,
  reflecting,
  followup,
  onFollowupChange,
  onSendFollowup,
  sendingFollowup,
}: ReflectProps): JSX.Element {
  return (
    <section aria-labelledby="reflect-h" className="segment">
      <h2 id="reflect-h">Reflect</h2>
      <button type="button" onClick={onReflect} disabled={reflecting}>
        {reflecting ? 'Reflecting…' : 'Reflect with Gemini'}
      </button>
      <div className="session-turns" aria-label="Session reflections">
        {turns.map((t, i) => (
          <div key={i}>
            <div className={t.by === 'user' ? 'turn user' : 'turn model'}>{formatTurn(t)}</div>
            {t.by === 'model' && Array.isArray(t.placeIds) && t.placeIds.length > 0 ? (
              <div className="audit">
                <PinGlyph /> Grounded in:{' '}
                {t.placeIds.map((id) => snapshotName(snapshots, id)).join(', ')}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="followup">
        <label className="field-label" htmlFor="followup">
          Follow up in this session
        </label>
        <div className="row">
          <input
            id="followup"
            type="text"
            maxLength={5000}
            placeholder="Ask a follow-up about this entry…"
            autoComplete="off"
            value={followup}
            onChange={(ev) => onFollowupChange(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') onSendFollowup();
            }}
          />
          <button type="button" onClick={onSendFollowup} disabled={sendingFollowup}>
            {sendingFollowup ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="hint">
          Follow-ups see the entry grounding, so “the lake there” resolves without grounding again.
        </p>
      </div>
    </section>
  );
}
