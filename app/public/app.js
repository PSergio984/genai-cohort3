/* Grounded Journal frontend — ES module, no build. Talks only to our API;
 * the browser never holds a Maps or Gemini key. Firebase Auth (Google
 * sign-in) proves identity; the ID token rides every API call as a Bearer
 * token and the server derives the Vault from it (one Vault per user). */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

initializeApp(firebaseConfig);
const auth = getAuth();
const provider = new GoogleAuthProvider();

var vaultId = null; // Firebase UID once signed in — the Vault id
var idToken = null; // refreshed silently by the SDK when needed
var sessionToken = null; // one UUID per picker session, closed server-side
var entryId = null;
var attached = []; // local Grounding list: the attach response is the source of truth

function byId(id) { return document.getElementById(id); }
function show(id) { byId(id).hidden = false; }
function hide(id) { byId(id).hidden = true; }
function newSessionToken() { return 'sess-' + Math.random().toString(36).slice(2, 12); }
function entriesPath() { return '/api/vaults/' + encodeURIComponent(vaultId) + '/entries'; }
function entryPath(id) { return entriesPath() + '/' + encodeURIComponent(id); }

async function api(path, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + idToken });
  var res = await fetch(path, options);
  if (res.status === 401) {
    // Token may have expired mid-session: force-refresh once and retry.
    idToken = await auth.currentUser.getIdToken(true);
    options.headers.Authorization = 'Bearer ' + idToken;
    res = await fetch(path, options);
  }
  var body = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    throw new Error((body && body.error) || ('HTTP ' + res.status));
  }
  return body;
}

function postJson(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

byId('signin').addEventListener('click', async function () {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) { alert('Sign-in failed: ' + err.message); }
});

byId('signout').addEventListener('click', async function () {
  await signOut(auth);
});

function clearJournalUi() {
  entryId = null;
  attached = [];
  sessionToken = null;
  byId('entry').value = '';
  byId('search').value = '';
  byId('suggestions').innerHTML = '';
  byId('attached').innerHTML = '';
  byId('reflections').innerHTML = '';
  byId('history').innerHTML = '';
  hide('ground-section');
  hide('reflect-section');
}

onAuthStateChanged(auth, async function (user) {
  if (!user) {
    vaultId = null;
    idToken = null;
    clearJournalUi();
    hide('journal');
    hide('signed-in');
    show('signed-out');
    return;
  }
  vaultId = user.uid;
  idToken = await user.getIdToken();
  byId('who').textContent = user.displayName || user.email || 'Signed in';
  hide('signed-out');
  show('signed-in');
  show('journal');
  await refreshHistory();
});

byId('save').addEventListener('click', async function () {
  var text = byId('entry').value.trim();
  if (!text) return;
  try {
    var out = await postJson(entriesPath(), { text: text });
    entryId = out.id;
    attached = [];
    sessionToken = newSessionToken();
    show('ground-section');
    show('reflect-section');
    renderAttached();
    await refreshHistory();
  } catch (err) { alert('Save failed: ' + err.message); }
});

var debounce = null;
byId('search').addEventListener('input', function () {
  clearTimeout(debounce);
  var query = byId('search').value.trim();
  if (query.length < 2) { renderSuggestions([]); return; }
  debounce = setTimeout(async function () {
    try {
      var out = await postJson('/api/places/autocomplete', { query: query, sessionToken: sessionToken });
      renderSuggestions(out.predictions || [], query);
    } catch (err) { renderSuggestions([], query); }
  }, 250);
});

function renderSuggestions(predictions, query) {
  var ul = byId('suggestions');
  ul.innerHTML = '';
  // Spec: an explicit message when search finds nothing — the entry simply
  // stays ungrounded instead of failing.
  if (predictions.length === 0 && query !== undefined && query.length >= 2) {
    var li = document.createElement('li');
    li.className = 'meta';
    li.textContent = 'No places found — your entry stays ungrounded.';
    ul.appendChild(li);
    return;
  }
  predictions.forEach(function (p) {
    var item = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.text;
    b.addEventListener('click', function () { attachPlace(p); });
    item.appendChild(b);
    ul.appendChild(item);
  });
}

async function attachPlace(p) {
  if (!entryId) return;
  try {
    var out = await postJson(entryPath(entryId) + '/groundings', {
      placeId: p.placeId,
      sessionToken: sessionToken,
    });
    byId('search').value = '';
    renderSuggestions([]);
    attached.push(out.grounding);
    renderAttached();
    sessionToken = newSessionToken();
  } catch (err) { alert('Attach failed: ' + err.message); }
}

function renderAttached() {
  var ul = byId('attached');
  ul.innerHTML = '';
  attached.forEach(function (s) {
    var li = document.createElement('li');
    li.appendChild(document.createTextNode(s.name + ' — ' + s.address));
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = s.attributions || '';
    li.appendChild(meta);
    ul.appendChild(li);
  });
}

byId('reflect').addEventListener('click', async function () {
  if (!entryId) return;
  try {
    var out = await postJson(entryPath(entryId) + '/reflections', {});
    renderReflections([out.reflection]);
    await refreshHistory();
  } catch (err) { alert('Reflect failed: ' + err.message); }
});

function renderReflections(reflections) {
  var div = byId('reflections');
  div.innerHTML = '';
  (reflections || []).forEach(function (t) {
    var p = document.createElement('div');
    p.className = 'reflection';
    p.textContent = t;
    div.appendChild(p);
  });
}

async function refreshHistory() {
  try {
    var out = await api(entriesPath() + '?limit=20');
    var ul = byId('history');
    ul.innerHTML = '';
    (out.entries || []).forEach(function (row) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(row.entry.text));
      var meta = document.createElement('div');
      meta.className = 'meta';
      var places = (row.entry.groundingSnapshots || []).map(function (s) { return s.name; }).join(', ');
      meta.textContent = places ? 'Grounded in: ' + places : 'Ungrounded';
      li.appendChild(meta);
      (row.entry.reflections || []).forEach(function (t) {
        var p = document.createElement('div');
        p.className = 'reflection';
        p.textContent = t;
        li.appendChild(p);
      });
      ul.appendChild(li);
    });
  } catch (err) { /* history is best-effort on first load */ }
}

byId('refresh').addEventListener('click', refreshHistory);
