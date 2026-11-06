'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');

test('update manifest is public JSON, uncached, and independent of account sessions', async t => {
  const { base } = await fixture(t);
  for (const suffix of ['', '?check=1']) {
    const response = await fetch(base + '/app-update.json' + suffix);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), JSON.parse(readFileSync(path.join(__dirname, '../public/app-update.json'), 'utf8')));
  }
});

test('published channels contain complete APK metadata and never mix package IDs', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '../public/app-update.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  for (const [channel, entry] of Object.entries(manifest.channels)) {
    assert.ok(['release', 'debug'].includes(channel));
    if (entry === null) continue;
    assert.equal(entry.package_name, 'com.gameivy.yanhuang' + (channel === 'debug' ? '.dev' : ''));
    assert.ok(Number.isSafeInteger(entry.version_code) && entry.version_code > 0);
    assert.match(entry.version_name, /^\d+\.\d+\.\d+$/);
    assert.equal(new URL(entry.url).protocol, 'https:');
    assert.ok(decodeURIComponent(new URL(entry.url).pathname).includes(entry.version_name), 'APP updates must use a versioned APK URL, not the mutable website download');
    assert.ok(Number.isSafeInteger(entry.size_bytes) && entry.size_bytes > 0 && entry.size_bytes <= 2147483647);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(entry.min_sdk) && entry.min_sdk >= 24);
    assert.ok(Array.isArray(entry.notes) && entry.notes.length <= 6);
    for (const note of entry.notes) assert.ok(typeof note === 'string' && note.length <= 100 && !/[\r\n]/.test(note));
  }
});
