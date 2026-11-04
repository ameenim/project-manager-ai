/* The last page of a connection. It tells the window that started it how it went, then closes itself. */
(function () {
  var q = new URLSearchParams(location.search), ok = q.get('ok') === '1', kind = q.get('kind') || '', msg = q.get('msg') || '';
  var name = kind === 'jira' ? 'Jira' : kind === 'outlook' ? 'Outlook' : 'The service';
  document.getElementById('ic').className = 'ic ' + (ok ? 'ok' : 'bad');
  document.getElementById('ic').textContent = ok ? '✓' : '!';
  document.getElementById('h').textContent = ok ? name + ' is connected' : 'Not connected';
  document.getElementById('p').textContent = ok ? 'You can close this window and go back to the app.' : (msg || 'Something went wrong. Close this window and try again.');
  try { if (window.opener) window.opener.postMessage({ pmConnect: kind, ok: ok, msg: msg }, location.origin); } catch (e) { /* the app window was closed */ }
  if (ok && window.opener) setTimeout(function () { window.close(); }, 1200);
  else document.getElementById('go').hidden = false;
})();
