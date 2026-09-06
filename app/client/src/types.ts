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
}

export type StatusTone = 'ok' | 'error' | 'busy';

export interface Status {
  message: string;
  tone: StatusTone | null;
}

export type HistoryFilter = 'all' | 'grounded' | 'ungrounded';
