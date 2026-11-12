'use strict';
// The glass layer: every page loads it after its own styles, colors live only in tokens.css, and the live background respects accessibility settings.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('app, admin, site and login pages load glass.css and live-bg.js', () => {
  for (const page of ['app.html', 'admin.html', 'index.html', 'login.html']) {
    const html = pub(page);
    assert.ok(/<link rel="stylesheet" href="glass\.css">/.test(html), page + ' links glass.css');
    assert.ok(/<script src="live-bg\.js" defer><\/script>/.test(html), page + ' loads live-bg.js');
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(styles[styles.length - 1], 'glass.css', page + ' loads glass.css last');
  }
});

test('glass.css and live-bg.js define no colors of their own', () => {
  const css = pub('glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'no hex colors in glass.css');
  assert.ok(!/rgba?\(\s*\d/.test(css), 'no rgb colors in glass.css');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(pub('live-bg.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'no hex colors in live-bg.js');
});

test('tokens.css has the glass and live tokens for light and dark', () => {
  const t = pub('tokens.css');
  for (const name of ['--glass-chrome', '--glass-card', '--glass-nest', '--glass-modal', '--glass-faint', '--lv-base', '--lv-1', '--lv-2', '--lv-3', '--lv-ink']) {
    assert.ok((t.match(new RegExp(name + ':', 'g')) || []).length >= 3, name + ' is set for light, system dark and chosen dark');
  }
});

test('glass has fallbacks and the live background honors accessibility settings', () => {
  const css = pub('glass.css');
  assert.ok(/@supports not/.test(css), 'fallback without backdrop-filter');
  assert.ok(/prefers-reduced-transparency/.test(css) && /prefers-contrast: more/.test(css), 'solid surfaces on request');
  const js = pub('live-bg.js');
  assert.ok(/prefers-reduced-motion/.test(js), 'reduced motion draws a still frame');
  assert.ok(/visibilitychange/.test(js), 'pauses when the tab is hidden');
});

test('text for lazy screens loads with the page so headers never show raw keys', () => {
  const html = pub('app.html');
  assert.ok(/<script src="i18n_lazy\.js"><\/script>/.test(html), 'app.html loads i18n_lazy.js');
  for (const f of ['app_closure.js', 'app_meetings.js', 'app_brand.js']) {
    assert.ok(!/Object\.assign\(PM\.I18N\.(en|ar),/.test(pub(f)), f + ' keeps no dictionary of its own');
  }
  const dict = pub('i18n_lazy.js');
  for (const k of ['tab_meetings', 'tab_closure', 'pc_closed', 'cl_banner_head', 'cl_banner_go']) assert.ok(new RegExp('\\b' + k + ':').test(dict), k + ' is defined up front');
});

test('phone glass layer: floating controls are frosted, touch targets are 44px, headers never squeeze, and solid fallbacks exist', () => {
  const css = pub('glass.css');
  const mobile = css.slice(css.indexOf('liquid glass navigation layer'));
  assert.ok(/\.nav-fab[^}]*backdrop-filter/.test(mobile) && /\.cht-fab[^}]*backdrop-filter/.test(mobile), 'menu and chat buttons are frosted');
  assert.ok(/\.proj-head \.tabs > \.ui-ind[^}]*var\(--glass-dense\)/.test(mobile), 'tabs use a sliding glass pill');
  assert.ok(/pointer: coarse[\s\S]*min-height: 44px/.test(mobile), 'touch targets are at least 44px');
  assert.ok(/\.lg-head > \.grow[^}]*flex: 1 1 100%/.test(mobile), 'the Logs title block gets the full line');
  assert.ok(/prefers-reduced-transparency[\s\S]*\.nav-fab[^}]*var\(--surface\)/.test(mobile), 'floating controls turn solid on request');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(mobile.replace(/\/\*[\s\S]*?\*\//g, '')), 'no hex colors in the phone layer');
});

test('project tabs center the active tab only when it changes, so a swipe is never undone', () => {
  const js = pub('ui.js');
  assert.ok(/dataset\.centered/.test(js) && /changed &&/.test(js), 'centering is skipped when the active tab is the same');
});

test('refraction is Chromium only, off for reduced transparency and data saver, and the plain glass stays underneath', () => {
  const js = pub('glass-refract.js'), css = pub('glass.css'), html = pub('app.html');
  assert.ok(/Chromium/.test(js) && /prefers-reduced-transparency/.test(js) && /saveData/.test(js), 'gated on browser and user settings');
  assert.ok(/html\.refract \.nav-fab/.test(css) && /html\.refract \.cht-fab/.test(css) && /html\.refract \.proj-head \.tabs > \.ui-ind/.test(css), 'only applied under the refract class');
  assert.ok(/glass-refract\.js/.test(html), 'app.html loads glass-refract.js');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no hex colors in glass.css');
});

test('phone layout: header collapses to the tab bar, tables become cards, Logs filters fold away, settings rows stack', () => {
  const css = pub('styles.css'), ui = pub('ui.js'), logs = pub('app_logs.js');
  assert.ok(/--ph-up/.test(css) && /ph-stuck/.test(ui) && /--ph-up/.test(ui), 'project header scrolls away above the pinned tabs');
  assert.ok(/function labelTables/.test(ui) && /data-label/.test(ui), 'table cells carry their column name');
  assert.ok(/td::before \{ content: attr\(data-label\)/.test(css), 'cells show the column name in card mode');
  assert.ok(/id="lgFt"/.test(logs) && /\.lg-filters:not\(\.open\)/.test(css), 'Logs filters open from a button on phones');
  assert.ok(/body\.chat-page \.proj-head/.test(css), 'the Thinking tab frees the room above the chat');
  assert.ok(/\[style\*="width:160px"\]/.test(css), 'settings logo block stacks above the form');
});
