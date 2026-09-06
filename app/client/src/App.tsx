import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { User } from 'firebase/auth';
import { createApiClient, newSessionToken, type ApiClient } from './api.js';
import {
  currentToken,
  signIn,
  signOutUser,
  watchUser,
} from './firebase.js';
import type {
  GroundingSnapshot,
  HistoryFilter,
  HistoryRow,
  PlaceDetails,
  Prediction,
  Status,
  Turn,
} from './types.js';
import { dedupeSnapshots } from './types.js';
import { StatusLine } from './components/StatusLine.js';
import { Auth } from './components/Auth.js';
import { Write } from './components/Write.js';
import { Ground } from './components/Ground.js';
import { Reflect } from './components/Reflect.js';
import { History, type HistoryView } from './components/History.js';
import { MapPane } from './components/MapPane.js';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function App(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>({ message: '', tone: null });
  const [authBusy, setAuthBusy] = useState(false);

  const [entryText, setEntryText] = useState('');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [groundings, setGroundings] = useState<GroundingSnapshot[]>([]);
  const [picksToken, setPicksToken] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [snapshots, setSnapshots] = useState<GroundingSnapshot[]>([]);
  const [followup, setFollowup] = useState('');

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [historyView, setHistoryView] = useState<HistoryView>('list');

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  // The query a completed autocomplete round answered. The empty-result
  // message keys off this, never off the in-flight input (see Ground).
  const [resolvedQuery, setResolvedQuery] = useState('');
  const [details, setDetails] = useState<Record<string, PlaceDetails>>({});
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const announce = useCallback((message: string, tone: Status['tone']): void => {
    setStatus({ message, tone });
  }, []);

  const api: ApiClient | null = useMemo(() => {
    if (user === null) return null;
    const vaultId = user.uid;
    return createApiClient(vaultId, (forceRefresh: boolean) => currentToken(forceRefresh));
  }, [user]);

  const clearJournal = useCallback((): void => {
    setEntryText('');
    setEntryId(null);
    setGroundings([]);
    setPicksToken(null);
    setTurns([]);
    setSnapshots([]);
    setFollowup('');
    setHistory([]);
    setHistoryLoading(false);
    setFilter('all');
    setHistoryView('list');
    setPredictions([]);
    setResolvedQuery('');
    setDetails({});
    setDetailsLoading(null);
    setStatus({ message: '', tone: null });
  }, []);

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (api === null) return;
    setRefreshing(true);
    try {
      // Display reads are cache-only by design: revisiting history is free.
      setHistory(await api.listEntries(20));
    } catch {
      /* history is best-effort on first load */
    }
    setRefreshing(false);
  }, [api]);

  useEffect(() => watchUser((u) => setUser(u)), []);

  useEffect(() => {
    if (user === null) {
      clearJournal();
      return;
    }
    setHistoryLoading(true);
    void refreshHistory().finally(() => setHistoryLoading(false));
  }, [user, clearJournal, refreshHistory]);

  const loadSession = useCallback(
    async (id: string): Promise<void> => {
      if (api === null) return;
      const out = await api.getEntry(id);
      setTurns(out.entry.turns);
      setSnapshots(out.entry.groundingSnapshots ?? []);
    },
    [api],
  );

  async function handleSignIn(): Promise<void> {
    setAuthBusy(true);
    try {
      await signIn();
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      if (code.includes('requests-from-referer') || code.includes('unauthorized-domain')) {
        // Localhost is not an authorized domain for the restricted web key.
        announce(
          'Sign-in is blocked from this address — open the deployed app URL to sign in.',
          'error',
        );
      } else {
        announce(`Sign-in failed [${code}]: ${messageOf(err)}`, 'error');
      }
    }
    setAuthBusy(false);
  }

  async function handleSignOut(): Promise<void> {
    // The auth watcher wipes every journal surface (shared-machine safety).
    await signOutUser();
  }

  async function handleSave(): Promise<void> {
    if (api === null) return;
    const text = entryText.trim();
    if (text === '') {
      announce('Write something first — empty entries are not saved.', 'error');
      return;
    }
    setSaving(true);
    announce('Saving entry…', 'busy');
    try {
      const id = await api.saveEntry(text);
      setEntryId(id);
      setGroundings([]);
      setPicksToken(newSessionToken());
      setTurns([]);
      setSnapshots([]);
      setFollowup('');
      setPredictions([]);
      announce('Entry saved. Ground it in a place, or reflect ungrounded.', 'ok');
      await refreshHistory();
    } catch (err) {
      announce(`Save failed: ${messageOf(err)}`, 'error');
    }
    setSaving(false);
  }

  const handleSearch = useCallback(
    async (query: string): Promise<void> => {
      if (api === null || picksToken === null) return;
      if (query === '') {
        setPredictions([]);
        setResolvedQuery('');
        return;
      }
      try {
        setPredictions(await api.autocomplete(query, picksToken));
      } catch {
        setPredictions([]);
      }
      setResolvedQuery(query);
    },
    [api, picksToken],
  );

  async function handleGround(prediction: Prediction): Promise<void> {
    if (api === null || entryId === null || picksToken === null) return;
    announce(`Grounding ${prediction.text}…`, 'busy');
    try {
      const grounding = await api.groundPlace(entryId, prediction.placeId, picksToken);
      setGroundings((prev) => [...prev, grounding]);
      setPredictions([]);
      setResolvedQuery('');
      setPicksToken(newSessionToken());
      announce(`Grounded: ${grounding.name}`, 'ok');
    } catch (err) {
      announce(`Ground failed: ${messageOf(err)}`, 'error');
    }
  }

  async function handleRemove(placeId: string): Promise<void> {
    if (api === null || entryId === null) return;
    try {
      await api.removeGrounding(entryId, placeId);
      setGroundings((prev) => prev.filter((s) => s.placeId !== placeId));
      announce('Grounding removed.', 'ok');
      await refreshHistory();
    } catch (err) {
      announce(`Remove failed: ${messageOf(err)}`, 'error');
    }
  }

  async function handleToggleDetails(placeId: string): Promise<void> {
    if (api === null) return;
    if (details[placeId] !== undefined) {
      setDetails((prev) => {
        const next = { ...prev };
        delete next[placeId];
        return next;
      });
      return;
    }
    setDetailsLoading(placeId);
    try {
      const cached = await api.getPlaceDetails(placeId);
      setDetails((prev) => ({ ...prev, [placeId]: cached }));
    } catch (err) {
      announce(`Details failed: ${messageOf(err)}`, 'error');
    }
    setDetailsLoading(null);
  }

  // One guarded shape for both reflection paths: busy narration, reload the
  // Session, refresh history, then report. The two callers differ only in
  // the status copy and the model call they wrap.
  const runReflection = useCallback(
    async (work: {
      begin: () => void;
      finish: () => void;
      busyMessage: string;
      okMessage: string;
      errorLabel: string;
      act: () => Promise<void>;
    }): Promise<void> => {
      work.begin();
      announce(work.busyMessage, 'busy');
      try {
        await work.act();
        announce(work.okMessage, 'ok');
      } catch (err) {
        announce(`${work.errorLabel}: ${messageOf(err)}`, 'error');
      }
      work.finish();
    },
    [announce],
  );

  async function handleReflect(): Promise<void> {
    const client = api;
    const id = entryId;
    if (client === null || id === null) return;
    await runReflection({
      begin: () => setReflecting(true),
      finish: () => setReflecting(false),
      busyMessage: 'Asking Gemini for a reflection…',
      okMessage: 'Reflection ready.',
      errorLabel: 'Reflect failed',
      act: async () => {
        await client.reflect(id);
        await loadSession(id);
        await refreshHistory();
      },
    });
  }

  async function handleSendFollowup(): Promise<void> {
    const client = api;
    const id = entryId;
    if (client === null || id === null) return;
    const text = followup.trim();
    if (text === '') {
      announce('Write a follow-up first.', 'error');
      return;
    }
    await runReflection({
      begin: () => setSending(true),
      finish: () => setSending(false),
      busyMessage: 'Sending follow-up…',
      okMessage: 'Follow-up reflected.',
      errorLabel: 'Follow-up failed',
      act: async () => {
        await client.reflect(id, [{ by: 'user', text }]);
        setFollowup('');
        await loadSession(id);
        await refreshHistory();
      },
    });
  }

  async function handleOpen(id: string): Promise<void> {
    if (api === null) return;
    try {
      const out = await api.getEntry(id);
      setEntryId(id);
      setGroundings(
        (out.entry.groundingSnapshots ?? []).map((s) => ({
          placeId: s.placeId,
          name: s.name,
          address: s.address,
          attributions: s.attributions,
          fetchedAt: s.fetchedAt,
        })),
      );
      setPicksToken(newSessionToken());
      setEntryText(out.entry.text ?? '');
      setTurns(out.entry.turns);
      setSnapshots(out.entry.groundingSnapshots ?? []);
      setPredictions([]);
      announce('Entry loaded. Continue the session below.', 'ok');
    } catch (err) {
      announce(`Open failed: ${messageOf(err)}`, 'error');
    }
  }

  const visibleHistory = useMemo(() => {
    if (filter === 'all') return history;
    return history.filter((row) => {
      const snaps = row.entry.groundingSnapshots ?? [];
      return filter === 'grounded' ? snaps.length > 0 : snaps.length === 0;
    });
  }, [history, filter]);

  // Every distinct grounded place across history (for the map) + the
  // ungrounded count the map keeps aside. Locations resolve cache-only.
  const mapSnapshots = useMemo(() => {
    const all: GroundingSnapshot[] = [];
    for (const row of history) {
      all.push(...(row.entry.groundingSnapshots ?? []));
    }
    return dedupeSnapshots(all);
  }, [history]);

  const ungroundedCount = useMemo(
    () => history.filter((row) => (row.entry.groundingSnapshots ?? []).length === 0).length,
    [history],
  );

  const fetchPlaceDetails = useCallback(
    async (placeId: string): Promise<PlaceDetails | null> => {
      if (api === null) return null;
      try {
        return await api.getPlaceDetails(placeId);
      } catch {
        return null;
      }
    },
    [api],
  );

  const signedInName =
    user === null ? '' : (user.displayName ?? user.email ?? 'Signed in');

  return (
    <main className="page">
      <header className="masthead">
        <h1>Grounded Journal</h1>
        <p className="standfirst">Write. Ground in a real place. Reflect with Gemini.</p>
        <hr className="rule" />
      </header>

      <StatusLine status={status} />

      <Auth
        signedIn={user !== null}
        displayName={signedInName}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
        busy={authBusy}
      />

      {user !== null ? (
        <>
          <Write
            value={entryText}
            onChange={setEntryText}
            onSave={() => void handleSave()}
            saving={saving}
          />

          {entryId !== null ? (
            <>
              <Ground
                groundings={groundings}
                details={details}
                detailsLoading={detailsLoading}
                resolvedQuery={resolvedQuery}
                onSearch={(q) => void handleSearch(q)}
                predictions={predictions}
                onGround={(p) => void handleGround(p)}
                onRemove={(id) => void handleRemove(id)}
                onToggleDetails={(id) => void handleToggleDetails(id)}
              />
              <Reflect
                turns={turns}
                snapshots={snapshots}
                onReflect={() => void handleReflect()}
                reflecting={reflecting}
                followup={followup}
                onFollowupChange={setFollowup}
                onSendFollowup={() => void handleSendFollowup()}
                sendingFollowup={sending}
              />
            </>
          ) : null}

          <History
            rows={visibleHistory}
            total={history.length}
            loading={historyLoading}
            filter={filter}
            onFilter={setFilter}
            onRefresh={() => void refreshHistory()}
            refreshing={refreshing}
            view={historyView}
            onViewChange={setHistoryView}
            mapPane={
              <MapPane
                snapshots={mapSnapshots}
                ungroundedCount={ungroundedCount}
                fetchDetails={(id) => fetchPlaceDetails(id)}
              />
            }
            selectedId={entryId}
            onOpen={(id) => void handleOpen(id)}
          />
        </>
      ) : null}

      <footer className="colophon">
        Your entries live in your private vault — one vault per signed-in user.
      </footer>
    </main>
  );
}
