// Composition root: the only place that binds a port and wires production
// seams. Not imported by tests. Missing keys degrade visibly (health only),
// never crash the boot — the container must stay prob-able.
import { createApp } from './server.js';
import { resolveGeminiKey, resolveMapsKey } from './config.js';
import { createPlaceFetcher } from './places/places.js';
import { createSdkClient } from './gemini/client.js';
import { createDeps, createFirestoreStore } from './store/firestore.js';
import type { JournalDeps } from './routes/journal.js';

const port = Number(process.env.PORT ?? 8080);

function wireJournal(): JournalDeps | undefined {
  const projectId = process.env.PROJECT_ID;
  const mapsKey = resolveMapsKey();
  const geminiKey = resolveGeminiKey();
  if (projectId === undefined || mapsKey === undefined || geminiKey === undefined) {
    console.warn(
      'journal API disabled: missing ' +
        [
          projectId === undefined ? 'PROJECT_ID' : null,
          mapsKey === undefined ? 'MAPS_API_KEY' : null,
          geminiKey === undefined ? 'GEMINI_API_KEY' : null,
        ]
          .filter((s) => s !== null)
          .join(', '),
    );
    return undefined;
  }
  const store = createFirestoreStore(createDeps(projectId));
  return { store, fetchPlace: createPlaceFetcher(mapsKey), gemini: createSdkClient({ apiKey: geminiKey }) };
}

createApp(wireJournal()).listen(port, '0.0.0.0', () => {
  console.log(`grounded-journal listening on 0.0.0.0:${port}`);
});
