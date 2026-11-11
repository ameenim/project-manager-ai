'use strict';
// Upload routes answer 400, never 500, when the request is not a form upload.
const { test } = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('upload routes reject a JSON or empty body with 400', async () => {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  try {
    const u = await s.user('Guard');
    for (const path of ['/api/me/avatar', '/api/templates', '/api/templates/client']) {
      for (const body of [{}, [], { name: 'x' }, '{not json']) {
        const r = await s.call('POST', path, body, u.token);
        assert.strictEqual(r.status, 400, `${path} with ${JSON.stringify(body)} gave ${r.status}`);
      }
    }
  } finally { await s.close(); }
});
