/* Real product screens for the landing page and the login page.
   An <img data-shot="name"> gets the file for the current language and theme (landing/en-light-name.webp and so on)
   and follows later changes of either one. */
(function () {
  'use strict';
  var root = document.documentElement;
  var V = '?v=1';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function theme() {
    var t = root.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return mq && mq.matches ? 'dark' : 'light';
  }
  function lang() { return root.lang === 'ar' ? 'ar' : 'en'; }
  function url(name) { return 'landing/' + lang() + '-' + theme() + '-' + name + '.webp' + V; }
  function apply() {
    var imgs = document.querySelectorAll('img[data-shot]');
    for (var i = 0; i < imgs.length; i++) {
      var u = url(imgs[i].getAttribute('data-shot'));
      if (imgs[i].getAttribute('src') !== u) imgs[i].setAttribute('src', u);
    }
  }
  if (window.MutationObserver) new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  apply();
  window.PMShots = { apply: apply, url: url };
})();
