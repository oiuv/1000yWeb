'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { paidFixture } = require('./paid-fixture');
const request = { account: 'demo01', confirmed: true, reason: '核实后解封' };
const endpoint = '/api/admin/users/unban';
async function setup(t) {
  const data = paidFixture(t); data.add('demo01', '000', '2020-01-01 00:00:00');
  const web = await fixture(t, undefined, null, null, data.reader, data.admin);
  const admin = web.client(); await admin.login('admin01');
  return { ...web, admin, paidData: data };
}

test('unban requires current administrator authorization, CSRF and same origin', async t => {
  const { admin, client, users, paidData } = await setup(t);
  const player = client(); await player.login();
  assert.equal((await client().request(endpoint, request)).code, 401);
  assert.equal((await player.request(endpoint, request)).code, 403);
  assert.equal((await admin.request(endpoint, request, { 'X-CSRF-Token': '' })).code, 403);
  assert.equal((await admin.request(endpoint, request, { Origin: 'https://invalid.example' })).code, 403);
  users.rows.get('admin01').id = 9;
  assert.equal((await admin.request(endpoint, request)).code, 401);
  assert.equal(paidData.db.prepare('SELECT paymode FROM user_paid').get().paymode, '000');
});

test('unban accepts only a confirmed canonical account and no arbitrary mode, actor or expiry', async t => {
  const { admin, paidData } = await setup(t);
  for (const body of [{ ...request, confirmed: false }, { ...request, confirmed: 'true' },
    { ...request, account: [] }, { ...request, reason: [] }, { ...request, reason: 'x'.repeat(201) },
    { ...request, mode: '001' }, { ...request, enddate: '2040-01-01' }, { ...request, actor: 'someone' }]) {
    assert.equal((await admin.request(endpoint, body)).code, 400);
  }
  assert.equal((await admin.request(endpoint, { ...request, account: 'missing01' })).code, 404);
  assert.equal((await admin.request(endpoint, { ...request, account: 'DEMO01' })).code, 409);
  assert.equal(paidData.db.prepare('SELECT paymode FROM user_paid').get().paymode, '000');
});

test('confirmed unban updates both lists, preserves expiry and audits the authenticated administrator', async t => {
  const { admin, paidData } = await setup(t);
  const row = async () => (await admin.request('/api/admin/users')).data.records.find(row => row.account === 'demo01');
  assert.equal((await row()).canUnban, true); assert.equal((await row()).canDisable, false);
  const result = await admin.request(endpoint, request);
  assert.equal(result.code, 200); assert.equal(result.data.mode, '100'); assert.equal(result.data.status, 'expired');
  assert.equal(result.data.enddate, '2020-01-01 00:00:00');
  const after = await row(); assert.equal(after.canUnban, false); assert.equal(after.canDisable, true);
  assert.equal(after.paid.mode, '100'); assert.equal(after.paid.status, 'expired');
  assert.equal((await admin.request('/api/admin/paid-users?status=disabled')).data.total, 0);
  assert.equal((await admin.request('/api/admin/paid-users?status=expired')).data.total, 1);
  assert.deepEqual(paidData.db.prepare('SELECT actor,reason FROM web_account_unbans').all(), [{ actor: 'admin01', reason: '核实后解封' }]);
  assert.equal((await admin.request(endpoint, request)).code, 409);
  assert.equal((await admin.request(endpoint, { ...request, account: 'demo02' })).code, 409);
  assert.equal(paidData.db.prepare('SELECT COUNT(*) n FROM web_account_unbans').get().n, 1);
  assert.equal(paidData.db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 1);
});

test('missing writer or database failure does not claim success or expose database paths', async t => {
  for (const writer of [null, { unban() { throw new Error('private database path'); } }]) {
    const { client } = await fixture(t, undefined, null, null, null, writer);
    const admin = client(); await admin.login('admin01');
    const result = await admin.request(endpoint, request);
    assert.equal(result.code, 503); assert.doesNotMatch(result.data.message, /private/);
    assert.ok((await admin.request('/api/admin/users')).data.records.every(row => row.canUnban === false));
  }
});
