/* Grounded Journal frontend — vanilla JS, no build. Talks only to our API;
 * the browser never holds a Maps or Gemini key. Demo identity (localStorage)
 * stands in for Firebase Auth until the sign-in slice lands. */
(function () {
  'use strict';

  var vaultId = localStorage.getItem('gj-owner');
  if (!vaultId) {
    vaultId = 'demo-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('gj-owner', vaultId);
  }
  var sessionToken = null; // one UUID per picker session, closed server-side
  var entryId = null;
  var attached = []; // local Grounding list: the attach response is the source of truth

  function byId(id) { return document.getElementById(id); }
  function show(id) { byId(id).hidden = false; }
  function newSessionToken() { return 'sess-' + Math.random().toString(36).slice(2, 12); }
  function entriesPath() { return '/api/vaults/' + encodeURIComponent(vaultId) + '/entries'; }
  function entryPath(id) { return entriesPath() + '/' + encodeURIComponent(id); }

  async function api(path, options) {
    var res = await fetch(path, options);
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

  byId('save').addEventListener('click', async function () {
    var text = byId('entry').value.trim();
    if (!text) return;
    try {
      var out = await postJson(entriesPath(), { ownerUid: vaultId, text: text });
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
        ownerUid: vaultId,
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
      var out = await postJson(entryPath(entryId) + '/reflections', { ownerUid: vaultId });
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
      var out = await api(entriesPath() + '?ownerUid=' + encodeURIComponent(vaultId) + '&limit=20');
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
  refreshHistory();
})();
