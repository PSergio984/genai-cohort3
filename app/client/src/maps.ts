// Maps JS API loader + browser-key plumbing. The key is a referrer-restricted
// public identifier (same delivery shape as the Firebase web config): the
// server renders window.__MAPS_CONFIG__ from MAPS_BROWSER_KEY env, and the
// loader injects the Maps script exactly once. Null key degrades to the list.
export interface Pin {
  placeId: string;
  name: string;
  address: string;
  attributions: string;
  rating?: number;
  hours?: string[];
  latitude: number;
  longitude: number;
}

declare global {
  interface Window {
    __MAPS_CONFIG__?: { browserKey?: string | null } | null;
    __groundedJournalMapsReady?: () => void;
    google?: {
      maps?: {
        Map?: new (el: Element, opts: Record<string, unknown>) => unknown;
        Marker?: new (opts: Record<string, unknown>) => {
          setMap(map: unknown): void;
          addListener(event: string, fn: () => void): void;
        };
        InfoWindow?: new (opts: Record<string, unknown>) => {
          open(opts: { map: unknown; anchor: unknown }): void;
        };
        LatLngBounds?: new () => { extend(pos: unknown): void };
      };
    };
  }
}

export async function browserKey(): Promise<string | null> {
  try {
    const res = await fetch('/maps-config.js');
    if (!res.ok) return null;
    const text = await res.text();
    const match = /"browserKey":(?:"([^"]*)"|null)/.exec(text);
    const key = match?.[1];
    return key !== undefined && key !== '' ? key : null;
  } catch {
    return null;
  }
}

let loading: Promise<void> | null = null;

export function loadMaps(key: string): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.maps !== undefined) {
    return Promise.resolve();
  }
  if (loading !== null) return loading;
  // Recommended bootstrap (loading=async + callback): the legacy direct load
  // logs a suboptimal-performance warning in the console.
  loading = new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (ok: boolean, err?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (ok) {
        resolve();
      } else {
        loading = null;
        reject(err ?? new Error('Maps library failed to load'));
      }
    };
    window.__groundedJournalMapsReady = () => done(true);
    const timer = window.setTimeout(() => done(false), 20000);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__groundedJournalMapsReady&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => done(false);
    document.head.appendChild(script);
  });
  return loading;
}
