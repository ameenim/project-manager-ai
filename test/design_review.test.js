'use strict';
// Guards for the design review pass: glass is never applied to the app page wrapper, headings keep their levels, phones get 44px touch targets.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('the landing mock dash glass rule never hits the app page wrapper', () => {
  const glass = pub('glass.css');
  assert.ok(!/(^|[\s,])\.dash(\s*[,{])/m.test(glass), 'every .dash selector in glass.css is scoped with :not(.page)');
  assert.ok(/\.dash:not\(\.page\)/.test(glass));
});

test('inbox panes inside a glass card use the nested fill with no second blur', () => {
  assert.ok(/\.card :is\(\.ib-list, \.ib-detail\)[^}]*backdrop-filter: none/.test(pub('glass.css')));
});

test('headings balance their lines and paragraphs avoid a lone last word', () => {
  const css = pub('styles.css');
  assert.ok(/h1, h2, h3, h4 \{[^}]*text-wrap: balance/.test(css));
  assert.ok(/p, \.muted[^{]*\{ text-wrap: pretty/.test(css));
});

test('ui.js keeps heading levels in order and the Thinking Area title is the page h1', () => {
  assert.ok(/function fixHeadings/.test(pub('ui.js')) && /aria-level/.test(pub('ui.js')));
  assert.ok(/setAttribute\('data-level', '1'\)/.test(pub('app_chat.js')));
});

test('phones get 44px touch targets for small buttons and chips', () => {
  assert.ok(/@media \(max-width: 600px\) \{\s*\.btn\.sm[^}]*min-height: 44px/.test(pub('styles.css')));
});

test('chart labels inside bars are upright, solid and not faded by the segment opacity', () => {
  const css = pub('styles.css');
  assert.ok(/\.stackbar\.tall i \.cl-t \{ font-style: normal/.test(css));
  assert.ok(!/\.stackbar i\.idle \{[^}]*opacity/.test(css));
});

test('no purple to blue gradient token and no hover rotation on navigation icons', () => {
  assert.ok(!/--ai-grad/.test(pub('tokens.css')));
  assert.ok(!/\.nav a:hover svg \{[^}]*rotate/.test(pub('styles.css')));
});
