'use strict';
// The dashboard toolbar must wrap on a phone. It used to be a single nowrap row, which pushed Customize off the screen.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('dashboard toolbar wraps instead of running past the screen edge', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const bar = css.match(/\.dw-bar \{[^}]*\}/);
  assert.ok(bar && /flex-wrap:\s*wrap/.test(bar[0]), '.dw-bar wraps');
  const row = css.match(/\.dw-bar > \.row \{[^}]*\}/);
  assert.ok(row && /flex-wrap:\s*wrap/.test(row[0]), 'the buttons row wraps');
});
