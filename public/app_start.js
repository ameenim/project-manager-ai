// Starts the app once every other script has loaded. It is a file, not an inline script, so the Content Security Policy
// can refuse all inline scripts.
// The session is an HttpOnly cookie, so the page only keeps a marker that says someone is signed in. A browser that signed in
// before cookies existed still holds the old token. It is traded for a cookie once and then deleted from storage.
(function () {
  var marker = null, legacy = null;
  try { marker = localStorage.getItem('pm_signed'); legacy = localStorage.getItem('pm_token'); } catch (e) { /* storage blocked */ }
  function go(ok) {
    if (!ok) { try { localStorage.removeItem('pm_signed'); localStorage.removeItem('pm_token'); } catch (e) { /* storage blocked */ } location.replace('login.html'); return; }
    PM.state.token = '1';
    PM.start();
  }
  if (legacy) {
    fetch('/api/auth/session', { method: 'POST', headers: { Authorization: 'Bearer ' + legacy, 'X-Session-Mode': 'cookie' }, credentials: 'same-origin' })
      .then(function (r) {
        try { localStorage.removeItem('pm_token'); if (r.ok) localStorage.setItem('pm_signed', '1'); } catch (e) { /* storage blocked */ }
        go(r.ok);
      })
      .catch(function () { go(false); });
    return;
  }
  go(!!marker);
})();
