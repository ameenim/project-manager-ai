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
