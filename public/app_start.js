// Starts the app once every other script has loaded. It is a file, not an inline script, so the Content Security Policy
// can refuse all inline scripts.
(function () {
  var tk = null;
  try { tk = localStorage.getItem('pm_token'); } catch (e) { /* storage blocked */ }
  if (!tk) { location.replace('login.html'); return; }
  PM.state.token = tk;
  PM.start();
})();
