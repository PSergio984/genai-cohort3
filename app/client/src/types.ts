// Shared shapes between the UI and our API. Field-for-field compatible with
// the vanilla frontend this replaces; API contracts are frozen.

export interface GroundingSnapshot {
  placeId: string;
  name: string;
  address: string;
  attributions: string;
  fetchedAt: string;
}

export interface Turn {
  by: 'user' | 'model';
  text: string;
  placeIds?: string[];
}

export interface EntryRecord {
  text: string;
  placeIds: string[];
  groundingSnapshots: GroundingSnapshot[];
  turns: Turn[];
  createdAt: string;
}

export interface HistoryRow {
  id: string;
  entry: EntryRecord;
}

export interface Prediction {
  placeId: string;
  text: string;
}

export interface PlaceDetails extends GroundingSnapshot {
  rating?: number;
  hours?: string[];
  /** Present once a location-bearing fetch populated the cache. */
  location?: { latitude: number; longitude: number };
}

export type StatusTone = 'ok' | 'error' | 'busy';

export interface Status {
  message: string;
  tone: StatusTone | null;
}

export type HistoryFilter = 'all' | 'grounded' | 'ungrounded';

/** Distinct groundings by place, first-seen order (map pins + counts). */
export function dedupeSnapshots(snapshots: GroundingSnapshot[]): GroundingSnapshot[] {
  const seen = new Map<string, GroundingSnapshot>();
  for (const s of snapshots) {
    if (!seen.has(s.placeId)) seen.set(s.placeId, s);
  }
  return [...seen.values()];
}
