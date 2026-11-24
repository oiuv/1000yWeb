'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');

test('retired Android update manifest returns 404', async t => {
  const { base } = await fixture(t);
  for (const suffix of ['', '?check=1']) {
    const response = await fetch(base + '/app-update.json' + suffix);
    assert.equal(response.status, 404);
  }
});
