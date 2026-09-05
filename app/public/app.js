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

  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).hidden = false; }

  async function api(path, options) {
    var res = await fetch(path, options);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error((body && body.error) || ('HTTP ' + res.status));
    }
    return body;
  }

  $('save').addEventListener('click', async function () {
    var text = $('entry').value.trim();
    if (!text) return;
    try {
      var out = await api('/api/vaults/' + encodeURIComponent(vaultId) + '/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUid: vaultId, text: text }),
      });
      entryId = out.id;
      sessionToken = 'sess-' + Math.random().toString(36).slice(2, 12);
      show('ground-section');
      show('reflect-section');
      renderAttached([]);
      await refreshHistory();
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  var debounce = null;
  $('search').addEventListener('input', function () {
    clearTimeout(debounce);
    var q = $('search').value.trim();
    if (q.length < 2) { renderSuggestions([]); return; }
    debounce = setTimeout(async function () {
      try {
        var out = await api('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, sessionToken: sessionToken }),
        });
        renderSuggestions(out.predictions || []);
      } catch (e) { renderSuggestions([]); }
    }, 250);
  });

  function renderSuggestions(predictions) {
    var ul = $('suggestions');
    ul.innerHTML = '';
    predictions.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.text;
      b.addEventListener('click', function () { attachPlace(p); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  async function attachPlace(p) {
    if (!entryId) return;
    try {
      var out = await api(
        '/api/vaults/' + encodeURIComponent(vaultId) + '/entries/' + encodeURIComponent(entryId) + '/groundings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerUid: vaultId, placeId: p.placeId, sessionToken: sessionToken }),
        },
      );
      $('search').value = '';
      renderSuggestions([]);
      var current = await getEntry();
      renderAttached(current ? current.groundingSnapshots : [out.grounding]);
      sessionToken = 'sess-' + Math.random().toString(36).slice(2, 12);
    } catch (e) { alert('Attach failed: ' + e.message); }
  }

  function renderAttached(snapshots) {
    var ul = $('attached');
    ul.innerHTML = '';
    (snapshots || []).forEach(function (s) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="meta">Pinned:</span> ';
      li.appendChild(document.createTextNode(s.name + ' — ' + s.address));
      ul.appendChild(li);
    });
  }

  async function getEntry() {
    var out = await api('/api/vaults/' + encodeURIComponent(vaultId) + '/entries?ownerUid=' + encodeURIComponent(vaultId) + '&limit=100');
    var found = (out.entries || []).filter(function (e) { return e.id === entryId; })[0];
    return found ? found.entry : null;
  }

  $('reflect').addEventListener('click', async function () {
    if (!entryId) return;
    try {
      var out = await api(
        '/api/vaults/' + encodeURIComponent(vaultId) + '/entries/' + encodeURIComponent(entryId) + '/reflections',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerUid: vaultId }),
        },
      );
      renderReflections([out.reflection]);
      await refreshHistory();
    } catch (e) { alert('Reflect failed: ' + e.message); }
  });

  function renderReflections(reflections) {
    var div = $('reflections');
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
      var out = await api('/api/vaults/' + encodeURIComponent(vaultId) + '/entries?ownerUid=' + encodeURIComponent(vaultId) + '&limit=20');
      var ul = $('history');
      ul.innerHTML = '';
      (out.entries || []).forEach(function (row) {
        var li = document.createElement('li');
        var places = (row.entry.groundingSnapshots || []).map(function (s) { return s.name; }).join(', ');
        li.innerHTML = '';
        li.appendChild(document.createTextNode(row.entry.text));
        var meta = document.createElement('div');
        meta.className = 'meta';
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
    } catch (e) { /* history is best-effort on first load */ }
  }

  $('refresh').addEventListener('click', refreshHistory);
  refreshHistory();
})();
