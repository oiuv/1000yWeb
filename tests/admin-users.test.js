'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');

test('account and paid lists require a current administrator session', async t => {
  const { client, users } = await fixture(t);
  const anonymous = client(), player = client(), admin = client();
  await player.login(); await admin.login('admin01');
  for (const endpoint of ['/api/admin/users', '/api/admin/paid-users']) {
    assert.equal((await anonymous.request(endpoint)).code, 401);
    assert.equal((await player.request(endpoint)).code, 403);
  }
  assert.equal((await admin.request('/api/admin/users')).code, 200);
  users.rows.get('admin01').id = 9;
  assert.equal((await admin.request('/api/admin/users')).code, 403);
  assert.equal((await admin.request('/api/admin/paid-users')).code, 403);
});

test('user pages search accounts and characters and never expose account secrets', async t => {
  const { client, users } = await fixture(t);
  const admin = client(); await admin.login('admin01');
  for (let i = 4; i <= 26; i++) users.rows.set('user' + i, {
    id: i, account: 'user' + i, characters: ['角色' + i + ':云端'], password: 'SECRET',
    telephone: 'private', email: 'private', masterkey: 'private', lastGameAt: '2026-10-30'
  });
  const first = await admin.request('/api/admin/users?limit=20');
  assert.equal(first.data.total, 26); assert.equal(first.data.records.length, 20);
  assert.equal(first.data.hasMore, true); assert.equal(first.data.pages, 2);
  assert.equal(first.data.records[0].account, 'user26');
  assert.equal(first.data.records[0].lastGameAt, '2026-10-30');
  assert.equal(first.data.paidAvailability, 'unconfigured');
  assert.equal(first.data.records[0].paid.status, 'unconfigured');
  assert.doesNotMatch(JSON.stringify(first.data), /SECRET|private|password|masterkey|telephone|email/);
  const second = (await admin.request('/api/admin/users?page=2&limit=20')).data;
  assert.equal(second.records.length, 6); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.data.records, ...second.records].map(row => row.account)).size, 26);
  const found = (await admin.request('/api/admin/users?search=' + encodeURIComponent('听雨'))).data;
  assert.deepEqual(found.records.map(row => row.account), ['demo01']);
  assert.deepEqual(found.records[0].characters[0], { name: '听雨', region: '云端' });
  assert.equal((await admin.request('/api/admin/users?search=absent')).data.total, 0);
  assert.deepEqual((await admin.request('/api/admin/users?page=99')).data.records, []);
  assert.equal(first.headers.get('cache-control'), 'no-store');
});

test('new list inputs reject malformed pages, arrays, long searches and invalid paid filters', async t => {
  const { client } = await fixture(t); const admin = client(); await admin.login('admin01');
  const invalid = ['page=0', 'page=-1', 'page=1.1', 'page=1000001', 'page=1&page=2',
    'limit=0', 'limit=101', 'limit[]=20', 'search[x]=bad', 'search=' + 'a'.repeat(101)];
  for (const endpoint of ['/api/admin/users', '/api/admin/paid-users']) {
    for (const query of invalid) assert.equal((await admin.request(endpoint + '?' + query)).code, 400, query);
  }
  assert.equal((await admin.request('/api/admin/paid-users?status=missing')).code, 400);
  assert.equal((await admin.request('/api/admin/paid-users?status[]=active')).code, 400);
});

test('missing Paid rows become default trial accounts without a fixed expiry', async t => {
  const calls = [];
  const paidStatus = {
    forAccounts(accounts) { calls.push(accounts); return new Map([
      ['demo01', { account: 'demo01', status: 'active', mode: '100', enddate: '2027-10-30 12:00:00' }],
      ['demo02', { account: 'demo02', status: 'disabled', mode: '000' }]
    ]); },
    list(options) { calls.push(options); return { records: [{ account: 'expired01', mode: '100', status: 'expired', enddate: '2020-01-01 00:00:00' }],
      total: 1, page: options.page, limit: options.limit, pages: 1, hasMore: false }; }
  };
  const { client } = await fixture(t, undefined, null, null, paidStatus);
  const admin = client(); await admin.login('admin01');
  const response = await admin.request('/api/admin/users');
  assert.equal(response.data.paidAvailability, 'available');
  assert.deepEqual(calls[0], ['demo02', 'demo01', 'admin01']);
  assert.deepEqual(response.data.records.map(row => row.paid.status), ['disabled', 'active', 'trial']);
  assert.deepEqual(response.data.records[2].paid, { status: 'trial', mode: '001', enddate: null });
  const paid = await admin.request('/api/admin/paid-users?search=expired&status=expired&limit=50');
  assert.equal(paid.code, 200); assert.equal(paid.data.records[0].status, 'expired');
  assert.deepEqual(calls[1], { page: 1, limit: 50, search: 'expired', status: 'expired' });
});

test('explicit 001, 200 and 400 records retain their real mode and expiry instead of becoming default trial', async t => {
  const stored = { account: 'admin01', status: 'expired', mode: '001', enddate: '2020-01-01 00:00:00' };
  const paidStatus = { forAccounts() { return new Map([['admin01', stored]]); } };
  const { client } = await fixture(t, undefined, null, null, paidStatus);
  const admin = client(); await admin.login('admin01');
  for (const mode of ['001', '200', '400']) {
    stored.mode = mode;
    const response = await admin.request('/api/admin/users');
    assert.equal(response.code, 200);
    assert.deepEqual(response.data.records.find(row => row.account === 'admin01').paid, stored);
    assert.equal(response.data.records.find(row => row.account === 'demo01').paid.status, 'trial');
  }
});

test('Paid failures preserve the account list and are never shown as default trial', async t => {
  const broken = { forAccounts() { throw new Error('private path'); }, list() { throw new Error('private path'); } };
  const { client, users, db } = await fixture(t, undefined, null, null, broken);
  const admin = client(); await admin.login('admin01');
  const usersBefore = JSON.stringify([...users.rows]);
  const result = await admin.request('/api/admin/users');
  assert.equal(result.code, 200); assert.equal(result.data.total, 3);
  assert.equal(result.data.paidAvailability, 'unavailable');
  assert.ok(result.data.records.every(row => row.paid.status === 'unavailable'));
  const paid = await admin.request('/api/admin/paid-users');
  assert.equal(paid.code, 503); assert.doesNotMatch(JSON.stringify(paid.data), /private path/);
  assert.equal(JSON.stringify([...users.rows]), usersBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n, 0);
  users.listForAdmin = async () => { throw new Error('private SQL'); };
  const failed = await admin.request('/api/admin/users');
  assert.equal(failed.code, 500); assert.doesNotMatch(JSON.stringify(failed.data), /private SQL/);
});

test('missing Paid configuration returns an explicit unavailable response', async t => {
  const { client } = await fixture(t); const admin = client(); await admin.login('admin01');
  const response = await admin.request('/api/admin/paid-users');
  assert.equal(response.code, 503); assert.match(response.data.message, /尚未配置/);
});
