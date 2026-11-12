/* Refraction for the three floating phone controls (menu button, project tab pill, chat button).
   An SVG displacement map bends the page behind the glass near its edges, like a lens. It needs backdrop-filter with an SVG filter, which only Chromium draws,
   so every other browser, reduced transparency and data saver keep the plain frosted glass from glass.css. Colors here are map channels, not theme colors. */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var brands = navigator.userAgentData && navigator.userAgentData.brands;
  var chromium = brands ? brands.some(function (b) { return /Chromium/.test(b.brand); }) : (/Chrome\/\d+/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
  if (!chromium) return;
  if (window.matchMedia && (matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(prefers-contrast: more)').matches)) return;
  if (navigator.connection && navigator.connection.saveData) return;

  // edge map: neutral grey in the middle, the red channel pushes sideways and the green channel pushes up and down, only near the rim
  function edgeMap(edge) {
    var e = edge, f = 1 - edge;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" preserveAspectRatio="none">'
      + '<defs>'
      + '<linearGradient id="x" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(255,128,128)"/><stop offset="' + e + '" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="' + f + '" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="1" stop-color="rgb(0,128,128)"/></linearGradient>'
      + '<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(128,255,128)"/><stop offset="' + e + '" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="' + f + '" stop-color="rgb(128,128,128)" stop-opacity="0"/><stop offset="1" stop-color="rgb(128,0,128)"/></linearGradient>'
      + '</defs><rect width="200" height="200" fill="rgb(128,128,128)"/><rect width="200" height="200" fill="url(#x)"/><rect width="200" height="200" fill="url(#y)"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function filter(id, edge, scale) {
    return '<filter id="' + id + '" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">'
      + '<feImage href="' + edgeMap(edge) + '" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="m"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + scale + '" xChannelSelector="R" yChannelSelector="G"/></filter>';
  }
  var host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  host.innerHTML = '<svg width="0" height="0" focusable="false"><defs>' + filter('pm-rf-round', 0.34, 0.5) + filter('pm-rf-wide', 0.26, 0.4) + '</defs></svg>';
  document.body.appendChild(host);
  document.documentElement.classList.add('refract');
})();
