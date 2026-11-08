'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareSchema } = require('../server/db');

test('production schema verification is read-only even without migration-history rows', async () => {
  const statements = [];
  await prepareSchema({
    async query(sql, params) {
      statements.push(sql);
      assert.ok(params[0].includes('schema_migrations'));
      assert.ok(params[0].includes('id_blocks'));
      return { rows: [] };
    },
    async tx() { assert.fail('Production must not open a migration transaction'); },
  }, { managedProduction: true });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT /);
  assert.doesNotMatch(statements[0], /\b(CREATE|ALTER|DROP|TRUNCATE|DELETE|INSERT)\b/i);
});

test('missing production objects fail clearly without attempting to create them', async () => {
  let calls = 0;
  await assert.rejects(prepareSchema({
    async query(sql) {
      calls++;
      assert.match(sql, /^SELECT /);
      return { rows: [{ name: 'users' }, { name: 'id_blocks' }] };
    },
    async tx() { assert.fail('Production must not run DDL'); },
  }, { managedProduction: true }), /Production database schema is missing: users, id_blocks/);
  assert.equal(calls, 1);
});

test('development retains existing migration behavior', async () => {
  const statements = [];
  await prepareSchema({
    async query(sql) {
      statements.push(sql);
      return { rows: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }] };
    },
    async tx() { assert.fail('Already applied migrations must not run again'); },
  });
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.equal(statements[1], 'SELECT version FROM schema_migrations');
});
