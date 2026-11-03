'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paidFixture } = require('./paid-fixture');
const { createPaidBridge } = require('../lib/paid');
const request = { account: 'demo01', actor: 'admin01', reason: '核实后解封' };

test('unban only changes 000 to 100 and update time; original expiry and creation time are preserved', t => {
  const { db, add, admin } = paidFixture(t);
  for (const [account, enddate, status] of [
    ['future01', '2040-01-01 00:00:00', 'active'], ['expired01', '2020-01-01 00:00:00', 'expired']
  ]) {
    add(account, '000', enddate);
    const before = db.prepare('SELECT * FROM user_paid WHERE loginid=?').get(account);
    assert.deepEqual(admin.unban({ ...request, account }), { account, mode: '100', status, enddate });
    assert.deepEqual(db.prepare('SELECT * FROM user_paid WHERE loginid=?').get(account),
      { ...before, paymode: '100', updated_time: '2030-10-31 12:00:00' });
    assert.deepEqual(db.prepare('SELECT loginid,actor,reason,previous_mode,previous_enddate FROM web_account_unbans WHERE loginid=?').get(account),
      { loginid: account, actor: 'admin01', reason: '核实后解封', previous_mode: '000', previous_enddate: enddate });
  }
});

test('unrecorded trial loses fallback eligibility: ban then unban retains an expired paid record', t => {
  const { db, admin } = paidFixture(t);
  admin.disable(request);
  const before = db.prepare('SELECT * FROM user_paid').get();
  const result = admin.unban(request);
  assert.equal(result.mode, '100'); assert.equal(result.status, 'expired');
  assert.equal(result.enddate, before.enddate);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 1);
  assert.deepEqual(db.prepare('SELECT * FROM user_paid').get(), { ...before, paymode: '100' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='paid_orders'").get().n, 0);
});

test('unban never restores old trial, IP or metered modes', t => {
  const { db, add, admin } = paidFixture(t);
  for (const mode of ['001', '100', '200', '400']) {
    const account = 'user' + mode; add(account, mode);
    admin.disable({ ...request, account }); admin.unban({ ...request, account });
    assert.deepEqual(db.prepare('SELECT paymode,enddate FROM user_paid WHERE loginid=?').get(account),
      { paymode: '100', enddate: '2040-01-01 00:00:00' });
  }
});

test('missing, non-disabled and repeated unbans neither create records nor overwrite history', t => {
  const { db, add, admin } = paidFixture(t);
  add('demo01', '000'); admin.unban(request);
  for (const account of ['missing01', 'demo01']) {
    assert.throws(() => admin.unban({ ...request, account }), { code: 'PAID_NOT_DISABLED' });
  }
  for (const mode of ['001', '200', '400', '999']) {
    const account = 'user' + mode; add(account, mode);
    assert.throws(() => admin.unban({ ...request, account }), { code: 'PAID_NOT_DISABLED' });
    assert.equal(db.prepare('SELECT paymode FROM user_paid WHERE loginid=?').get(account).paymode, mode);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM web_account_unbans').get().n, 1);
});

test('invalid input and ambiguous account casing cannot unban or create a record', t => {
  const { db, add, admin } = paidFixture(t);
  add('Demo01', '000');
  assert.throws(() => admin.unban(request), { code: 'PAID_CASE_MISMATCH' });
  add('demo01', '000');
  assert.throws(() => admin.unban(request), { code: 'PAID_CASE_MISMATCH' });
  for (const bad of [{ account: '' }, { account: 'x'.repeat(21) }, { actor: [] }, { actor: 'a\nb' },
    { reason: null }, { reason: 'x'.repeat(201) }]) {
    assert.throws(() => admin.unban({ ...request, ...bad }), /无效/);
  }
  assert.ok(db.prepare('SELECT paymode FROM user_paid').all().every(row => row.paymode === '000'));
});

test('audit failure rolls back unban and releases its write lock', t => {
  const { db, add, admin } = paidFixture(t);
  add('seed01', '000'); admin.unban({ ...request, account: 'seed01' });
  add('demo01', '000'); const before = db.prepare("SELECT * FROM user_paid WHERE loginid='demo01'").get();
  db.exec("CREATE TRIGGER fail_unban BEFORE INSERT ON web_account_unbans BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.throws(() => admin.unban(request), /synthetic/);
  assert.deepEqual(db.prepare("SELECT * FROM user_paid WHERE loginid='demo01'").get(), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM web_account_unbans').get().n, 1);
  db.exec('DROP TRIGGER fail_unban'); assert.equal(admin.unban(request).mode, '100');
});

test('a busy database cannot claim an unban or modify expiry', t => {
  const { db, add, admin } = paidFixture(t); add('demo01', '000');
  const before = db.prepare('SELECT * FROM user_paid').get(); db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => admin.unban(request), { code: 'SQLITE_BUSY' }); }
  finally { db.exec('ROLLBACK'); }
  assert.deepEqual(db.prepare('SELECT * FROM user_paid').get(), before);
  assert.equal(admin.unban(request).mode, '100');
});

test('real Paid recharge is available after unban and adds time only when explicitly credited',
  { skip: !process.env.TEST_PAID_PYTHON || !process.env.TEST_PAID_SCRIPT }, async t => {
    const { db, filename, add, admin } = paidFixture(t);
    const paid = createPaidBridge({ python: process.env.TEST_PAID_PYTHON, script: process.env.TEST_PAID_SCRIPT, database: filename });
    add('demo01', '000');
    await assert.rejects(paid.credit({ order_id: 'unban:blocked', loginid: 'demo01', days: 30 }), /Paid 拒绝/);
    assert.equal(admin.unban(request).enddate, '2040-01-01 00:00:00');
    const receipt = await paid.credit({ order_id: 'unban:credited', loginid: 'demo01', days: 30 });
    assert.equal(receipt.enddate, '2040-01-31 00:00:00');
    assert.deepEqual(db.prepare('SELECT paymode,enddate FROM user_paid').get(), { paymode: '100', enddate: receipt.enddate });
  });
