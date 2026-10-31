'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, registration } = require('./helpers');
const { paidFixture } = require('./paid-fixture');
const Recharge = require('../models/Recharge');
const request = { account: 'demo01', confirmed: true, reason: '违规核查' };
async function setup(t, paid = null) {
  const data = paidFixture(t);
  const web = await fixture(t, undefined, paid, null, data.reader, data.admin);
  const admin = web.client(); await admin.login('admin01');
  return { ...web, admin, paidData: data };
}

test('disable requires current administrator authorization, CSRF and same origin', async t => {
  const { admin, client, users, paidData } = await setup(t);
  const player = client(); await player.login();
  assert.equal((await client().request('/api/admin/users/disable', request)).code, 401);
  assert.equal((await player.request('/api/admin/users/disable', request)).code, 403);
  assert.equal((await admin.request('/api/admin/users/disable', request, { 'X-CSRF-Token': '' })).code, 403);
  assert.equal((await admin.request('/api/admin/users/disable', request, { Origin: 'https://invalid.example' })).code, 403);
  users.rows.get('admin01').id = 9;
  assert.equal((await admin.request('/api/admin/users/disable', request)).code, 403);
  assert.equal(paidData.db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 0);
});

test('only a confirmed existing canonical account can be disabled; no arbitrary mode or expiry edits', async t => {
  const { admin, paidData } = await setup(t);
  for (const body of [{ ...request, confirmed: false }, { ...request, confirmed: 'true' },
    { ...request, account: ['demo01'] }, { ...request, reason: [] }, { ...request, reason: 'x'.repeat(201) },
    { ...request, mode: '100' }, { ...request, enddate: '2040-01-01' }, { ...request, actor: 'someone' }]) {
    assert.equal((await admin.request('/api/admin/users/disable', body)).code, 400);
  }
  assert.equal((await admin.request('/api/admin/users/disable', { ...request, account: 'missing01' })).code, 404);
  assert.equal((await admin.request('/api/admin/users/disable', { ...request, account: 'DEMO01' })).code, 409);
  for (const url of ['/api/admin/users/enable', '/api/admin/users/delete', '/api/admin/paid-users', '/api/admin/paid-users/update']) {
    assert.equal((await admin.request(url, request)).code, 404);
  }
  assert.equal(paidData.db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 0);
});

test('a trial account can be disabled from users and is immediately listed as disabled in both lists', async t => {
  const { admin, paidData } = await setup(t);
  const first = (await admin.request('/api/admin/users')).data.records.find(row => row.account === 'demo01');
  assert.equal(first.paid.status, 'trial'); assert.equal(first.canDisable, true);
  const disabled = await admin.request('/api/admin/users/disable', request);
  assert.equal(disabled.code, 200); assert.equal(disabled.data.alreadyDisabled, false);
  assert.equal((await admin.request('/api/admin/users/disable', request)).data.alreadyDisabled, true);
  const row = (await admin.request('/api/admin/users')).data.records.find(row => row.account === 'demo01');
  assert.equal(row.paid.status, 'disabled'); assert.equal(row.canDisable, false);
  assert.equal((await admin.request('/api/admin/paid-users?status=disabled')).data.total, 1);
  assert.deepEqual(paidData.db.prepare('SELECT actor,reason FROM web_account_disables').all(), [{ actor: 'admin01', reason: '违规核查' }]);
});

test('missing configuration and writer failures cannot claim a successful disable or leak raw errors', async t => {
  for (const writer of [null, { disable() { throw new Error('private database path'); } }]) {
    const { client } = await fixture(t, undefined, null, null, null, writer);
    const admin = client(); await admin.login('admin01');
    const response = await admin.request('/api/admin/users/disable', request);
    assert.equal(response.code, 503); assert.doesNotMatch(response.data.message, /private/);
    assert.ok((await admin.request('/api/admin/users')).data.records.every(row => row.canDisable === false));
  }
});

test('disabled accounts cannot be approved for time recharge and pending status stays unchanged', async t => {
  let calls = 0;
  const { admin, client, db, paidData } = await setup(t, { credit() { calls++; throw new Error('must not run'); } });
  const player = client(); await player.login();
  const created = await player.request('/api/recharge/submit', registration());
  assert.equal(created.code, 201);
  await admin.request('/api/admin/users/disable', request);
  const response = await admin.request('/api/admin/update-status', { id: created.data.id, status: 'verified', expectedStatus: 'pending', note: '' });
  assert.equal(response.code, 409); assert.match(response.data.message, /已禁用/); assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT status FROM recharge_records').get().status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paid_recharges').get().n, 0);
  assert.equal(paidData.db.prepare('SELECT paymode FROM user_paid').get().paymode, '000');
});

test('a failed recharge cannot be retried after a ban; state and expiry are preserved', async t => {
  let calls = 0;
  const { admin, db, paidData } = await setup(t, { credit() { calls++; throw new Error('synthetic failure'); } });
  const store = new Recharge(db);
  const id = store.create(registration({ submitted_by: 'demo01', ip_address: '127.0.0.1' })).id;
  assert.equal((await admin.request('/api/admin/update-status', { id, status: 'verified', expectedStatus: 'pending', note: '' })).data.paidPending, true);
  await admin.request('/api/admin/users/disable', request);
  const before = paidData.db.prepare('SELECT * FROM user_paid').get();
  const result = await admin.request('/api/admin/retry-paid', { id });
  assert.equal(result.code, 409); assert.equal(calls, 1);
  assert.equal(store.paidJob(id).state, 'error');
  assert.deepEqual(paidData.db.prepare('SELECT * FROM user_paid').get(), before);
});

test('Paid read failure blocks approval before creating a recharge job', async t => {
  const reader = { forAccounts() { throw new Error('private path'); } };
  const { client, db } = await fixture(t, undefined, { credit() { throw new Error('must not run'); } }, null, reader);
  const admin = client(); await admin.login('admin01');
  const id = new Recharge(db).create(registration({ submitted_by: 'demo01', ip_address: '127.0.0.1' })).id;
  assert.equal((await admin.request('/api/admin/update-status', { id, status: 'verified', expectedStatus: 'pending', note: '' })).code, 503);
  assert.equal(db.prepare('SELECT status FROM recharge_records').get().status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paid_recharges').get().n, 0);
});
