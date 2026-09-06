import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { GroundingSnapshot, PlaceDetails } from '../types.js';
import { dedupeSnapshots } from '../types.js';
import { browserKey, loadMaps, type Pin } from '../maps.js';
import { PinGlyph } from './Pin.js';

interface MapPaneProps {
  snapshots: GroundingSnapshot[];
  ungroundedCount: number;
  fetchDetails: (placeId: string) => Promise<PlaceDetails | null>;
}

type PaneState =
  | { kind: 'loading-key' }
  | { kind: 'no-key' }
  | { kind: 'loading-pins' }
  | { kind: 'load-error'; message: string }
  | { kind: 'ready'; pins: Pin[]; legacy: GroundingSnapshot[] };

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function MapPane({ snapshots, ungroundedCount, fetchDetails }: MapPaneProps): JSX.Element {
  const [state, setState] = useState<PaneState>({ kind: 'loading-key' });
  const el = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve(): Promise<void> {
      const key = await browserKey();
      if (cancelled) return;
      if (key === null) {
        setState({ kind: 'no-key' });
        return;
      }
      setState({ kind: 'loading-pins' });
      // Cache-only reads: zero Places quota on display views. Records cached
      // before location-bearing fetches simply resolve pin-less (see legacy).
      const settled = await Promise.all(
        dedupeSnapshots(snapshots).map(async (s): Promise<Pin | null> => {
          try {
            const d = await fetchDetails(s.placeId);
            if (
              d === null ||
              typeof d.location?.latitude !== 'number' ||
              typeof d.location?.longitude !== 'number'
            ) {
              return null;
            }
            return {
              placeId: s.placeId,
              name: s.name,
              address: s.address,
              attributions: s.attributions,
              ...(typeof d.rating === 'number' ? { rating: d.rating } : {}),
              ...(Array.isArray(d.hours) ? { hours: [...d.hours] } : {}),
              latitude: d.location.latitude,
              longitude: d.location.longitude,
            };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      try {
        await loadMaps(key);
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'load-error',
            message: err instanceof Error ? err.message : 'Maps library failed to load',
          });
        }
        return;
      }
      if (cancelled) return;
      const pins = settled.filter((p): p is Pin => p !== null);
      if (pins.length === 0) {
        setState({ kind: 'ready', pins, legacy: dedupeSnapshots(snapshots) });
        return;
      }
      // Cached without coordinates = grounded before pins shipped. Re-fetching
      // here would burn Places quota on a display view, so they stay listed.
      const legacy = dedupeSnapshots(snapshots).filter(
        (s) => !pins.some((p) => p.placeId === s.placeId),
      );
      setState({ kind: 'ready', pins, legacy });
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [snapshots, fetchDetails]);

  useEffect(() => {
    if (state.kind !== 'ready' || el.current === null || state.pins.length === 0) return;
    const maps = window.google?.maps;
    if (maps?.Map === undefined || maps.Marker === undefined) return;
    const host = el.current;
    const map = new maps.Map(host, {
      center: { lat: state.pins[0].latitude, lng: state.pins[0].longitude },
      zoom: state.pins.length === 1 ? 14 : 2,
      mapTypeControl: false,
      streetViewControl: false,
    }) as unknown as { fitBounds(bounds: unknown): void };
    const markers: Array<{ setMap(map: unknown): void }> = [];
    let bounds: { extend(pos: unknown): void } | undefined;
    if (maps.LatLngBounds !== undefined && state.pins.length > 1) {
      bounds = new maps.LatLngBounds();
    }
    for (const pin of state.pins) {
      const marker = new maps.Marker({
        map,
        position: { lat: pin.latitude, lng: pin.longitude },
        title: pin.name,
      });
      markers.push(marker);
      const InfoWindowCtor = maps.InfoWindow;
      if (InfoWindowCtor !== undefined) {
        marker.addListener('click', () => {
          // Attribution rides every pin, as the ground list does.
          const facts = [
            typeof pin.rating === 'number' ? `Rating ${pin.rating}` : '',
            pin.hours !== undefined ? pin.hours.join('; ') : '',
            pin.attributions,
          ]
            .filter((f) => f !== '')
            .join(' · ');
          const info = new InfoWindowCtor({
            content: `<div><strong>${escapeHtml(pin.name)}</strong><br>${escapeHtml(pin.address)}${facts !== '' ? `<br>${escapeHtml(facts)}` : ''}</div>`,
          });
          info.open({ map, anchor: marker });
        });
      }
      bounds?.extend({ lat: pin.latitude, lng: pin.longitude });
    }
    if (bounds !== undefined) map.fitBounds(bounds);
    return () => {
      for (const m of markers) m.setMap(null);
    };
  }, [state]);

  if (state.kind === 'loading-key' || state.kind === 'loading-pins') {
    return (
      <div aria-label="Loading map">
        <div className="skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (state.kind === 'no-key') {
    return (
      <p className="mapnote">
        Map view needs its browser key — the list below is the complete record, free to revisit
        (reads are cache-only, zero quota).
      </p>
    );
  }
  if (state.kind === 'load-error') {
    return (
      <p className="mapnote" role="alert">
        The map could not load ({state.message}) — the list below is the complete record.
      </p>
    );
  }
  if (state.pins.length === 0) {
    return (
      <p className="mapnote">
        Nothing pinnable yet — grounded places appear here once their cached locations resolve.
        {ungroundedCount > 0
          ? ` ${ungroundedCount} ungrounded ${ungroundedCount === 1 ? 'entry stays' : 'entries stay'} in the list, never faked onto a pin.`
          : ''}
      </p>
    );
  }
  return (
    <div>
      <div ref={el} className="mapview" role="application" aria-label="Grounded entries map" />
      <div className="meta">
        <span className="state grounded">
          <PinGlyph /> {state.pins.length} pinned
        </span>
        {state.legacy.length > 0
          ? ` · ${state.legacy.map((s) => s.name).join(', ')} grounded before pins shipped — listed below`
          : ''}
        {ungroundedCount > 0 ? ` · ${ungroundedCount} ungrounded aside` : ''}
      </div>
    </div>
  );
}
