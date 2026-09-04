// Behavior tests for firestore.rules (ADR-0001) — Vault isolation + retention backstop.
// Runs against the LOCAL Firestore emulator (auto-started, in-memory, wiped per file).
// Covers what the Rules REST `test` API cannot: document-body branches
// (resource.data / request.resource). Auth-matrix paths were ALSO verified
// live via the API; this suite is the committed, re-runnable record.
//
// Run:  npm install   (once; downloads the emulator jars on first test run)
//       npm test       (starts emulator, runs, shuts down)
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-grounded-journal';
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

const daysFromNow = (d) => Timestamp.fromDate(new Date(Date.now() + d * 864e5));

let testEnv;

before(async () => {
  // Host/port mirror firebase.json (emulator must be running: use
  // `firebase emulators:exec` or start it and set FIRESTORE_EMULATOR_HOST).
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8090 },
  });
});

after(async () => {
  await testEnv.cleanup();
});

// Seed helper: wipes the emulator, writes fixtures bypassing rules,
// returns authed contexts. Each test starts from identical state.
async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'vaults/v1'), { ownerUid: 'alice' });
    await setDoc(doc(db, 'vaults/v1/entries/e1'), {
      ownerUid: 'alice',
      text: 'seed',
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'vaults/v1/placeCache/p1'), {
      placeJson: { name: 'Seed Place' },
      fetchedAt: Timestamp.now(),
      expiresAt: daysFromNow(7),
    });
  });
  return {
    alice: testEnv.authenticatedContext('alice'),
    bob: testEnv.authenticatedContext('bob'),
    anon: testEnv.unauthenticatedContext(),
  };
}

const v = (ctx, path) => doc(ctx.firestore(), path);

// --- Vault isolation -------------------------------------------------

test('owner reads own vault', async () => {
  const { alice } = await seed();
  await assertSucceeds(getDoc(v(alice, 'vaults/v1')));
});

test('stranger cannot read another vault', async () => {
  const { bob } = await seed();
  await assertFails(getDoc(v(bob, 'vaults/v1')));
});

test('unauthenticated reads denied', async () => {
  const { anon } = await seed();
  await assertFails(getDoc(v(anon, 'vaults/v1')));
});

test('vault create stamped with self succeeds', async () => {
  const { alice } = await seed();
  await assertSucceeds(setDoc(v(alice, 'vaults/v9'), { ownerUid: 'alice' }));
});

test('vault create stamped with someone else fails', async () => {
  const { alice } = await seed();
  await assertFails(setDoc(v(alice, 'vaults/v9'), { ownerUid: 'bob' }));
});

// --- Entries: denormalized ownership ----------------------------------

test('owner creates own entry', async () => {
  const { alice } = await seed();
  await assertSucceeds(
    setDoc(v(alice, 'vaults/v1/entries/e2'), {
      ownerUid: 'alice',
      text: 'hello',
      createdAt: Timestamp.now(),
    }),
  );
});

test('forged entry ownership fails', async () => {
  const { alice } = await seed();
  await assertFails(
    setDoc(v(alice, 'vaults/v1/entries/e2'), {
      ownerUid: 'bob',
      text: 'forgery',
      createdAt: Timestamp.now(),
    }),
  );
});

test('owner reads own entry, stranger and anon cannot', async () => {
  const { alice, bob, anon } = await seed();
  await assertSucceeds(getDoc(v(alice, 'vaults/v1/entries/e1')));
  await assertFails(getDoc(v(bob, 'vaults/v1/entries/e1')));
  await assertFails(getDoc(v(anon, 'vaults/v1/entries/e1')));
});

test('owner deletes own entry, stranger cannot', async () => {
  const { alice, bob } = await seed();
  await assertFails(deleteDoc(v(bob, 'vaults/v1/entries/e1')));
  await assertSucceeds(deleteDoc(v(alice, 'vaults/v1/entries/e1')));
});

// --- Place cache: retention backstop -----------------------------------
// NOTE: v1 design permits ownership transfer on vault update (no transfer
// flow exists; Vaults are created once per user at signup). Locked as
// current contract; revisit only with an ADR if a transfer flow appears.

test('cache write inside retention window succeeds', async () => {
  const { alice } = await seed();
  await assertSucceeds(
    setDoc(v(alice, 'vaults/v1/placeCache/p2'), {
      placeJson: { name: 'X' },
      fetchedAt: Timestamp.now(),
      expiresAt: daysFromNow(10),
    }),
  );
});

test('cache write past the 30-day ceiling fails', async () => {
  const { alice } = await seed();
  await assertFails(
    setDoc(v(alice, 'vaults/v1/placeCache/p2'), {
      placeJson: { name: 'X' },
      fetchedAt: Timestamp.now(),
      expiresAt: daysFromNow(40),
    }),
  );
});

test('cache write with past expiry fails', async () => {
  const { alice } = await seed();
  await assertFails(
    setDoc(v(alice, 'vaults/v1/placeCache/p2'), {
      placeJson: { name: 'X' },
      fetchedAt: Timestamp.now(),
      expiresAt: daysFromNow(-1),
    }),
  );
});

test('cache write without expiresAt fails', async () => {
  const { alice } = await seed();
  await assertFails(
    setDoc(v(alice, 'vaults/v1/placeCache/p2'), {
      placeJson: { name: 'X' },
      fetchedAt: Timestamp.now(),
    }),
  );
});

test('extending expiry past the ceiling on update fails', async () => {
  const { alice } = await seed();
  await assertFails(updateDoc(v(alice, 'vaults/v1/placeCache/p1'), { expiresAt: daysFromNow(60) }));
});

test('stranger cannot read or write cache', async () => {
  const { bob } = await seed();
  await assertFails(getDoc(v(bob, 'vaults/v1/placeCache/p1')));
  await assertFails(
    setDoc(v(bob, 'vaults/v1/placeCache/p2'), {
      placeJson: { name: 'X' },
      fetchedAt: Timestamp.now(),
      expiresAt: daysFromNow(7),
    }),
  );
});
