'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { paidFixture } = require('./paid-fixture');
const { createPaidAdmin } = require('../lib/paid-admin');
const { createPaidBridge } = require('../lib/paid');

test('disabling an unrecorded trial creates only a disabled entry and an atomic audit record', t => {
  const { db, admin, reader } = paidFixture(t);
  assert.deepEqual(admin.disable({ account: 'demo01', actor: 'admin01', reason: '违规核查' }),
    { account: 'demo01', status: 'disabled', alreadyDisabled: false });
  assert.equal(reader.forAccounts(['demo01']).get('demo01').status, 'disabled');
  assert.deepEqual(db.prepare('SELECT loginid,actor,reason,previous_mode,previous_enddate FROM web_account_disables').get(),
    { loginid: 'demo01', actor: 'admin01', reason: '违规核查', previous_mode: null, previous_enddate: null });
  assert.equal(db.prepare('SELECT enddate FROM user_paid').get().enddate, '2030-10-31 12:00:00');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='paid_orders'").get().n, 0);
  assert.deepEqual(Object.keys(admin), ['disable']);
});

test('every existing mode preserves its expiry and creation date; repeated disables do not rewrite history', t => {
  const { db, add, admin } = paidFixture(t);
  for (const mode of ['001', '100', '200', '400', '000', '999']) {
    const account = 'user' + mode;
    add(account, mode);
    const before = db.prepare('SELECT * FROM user_paid WHERE loginid=?').get(account);
    const result = admin.disable({ account, actor: 'admin01' });
    assert.equal(result.alreadyDisabled, mode === '000');
    const after = db.prepare('SELECT * FROM user_paid WHERE loginid=?').get(account);
    assert.deepEqual(after, { ...before, paymode: '000', updated_time: mode === '000' ? before.updated_time : '2030-10-31 12:00:00' });
    assert.equal(admin.disable({ account, actor: 'admin01', reason: '重复点击' }).alreadyDisabled, true);
    assert.deepEqual(db.prepare('SELECT * FROM user_paid WHERE loginid=?').get(account), after);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM web_account_disables').get().n, 5);
});

test('invalid input, case collisions and missing database paths never create a new usable account', t => {
  const { db, filename, add, admin } = paidFixture(t);
  add('CaseExact');
  assert.throws(() => admin.disable({ account: 'caseexact', actor: 'admin01' }), { code: 'PAID_CASE_MISMATCH' });
  for (const account of ['', 'a'.repeat(21), ' padded', 'a\nb', [], null]) {
    assert.throws(() => admin.disable({ account, actor: 'admin01' }), /无效/);
  }
  assert.throws(() => admin.disable({ account: 'demo01', actor: 'admin01', reason: 'x'.repeat(201) }), /无效/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 1);
  assert.equal(db.prepare('SELECT paymode FROM user_paid').get().paymode, '100');
  const missing = path.join(path.dirname(filename), 'missing.db');
  assert.throws(() => createPaidAdmin({ database: missing }));
  assert.equal(fs.existsSync(missing), false);
  assert.throws(() => createPaidAdmin({ database: path.resolve(__dirname, '../public/admin.html') }), /公开目录/);
});

test('audit failure rolls back both new and existing bans and releases the connection', t => {
  const { db, add, admin } = paidFixture(t);
  admin.disable({ account: 'seed01', actor: 'admin01' });
  add('demo01');
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON web_account_disables BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  for (const account of ['demo01', 'new01']) assert.throws(() => admin.disable({ account, actor: 'admin01' }), /synthetic/);
  assert.equal(db.prepare("SELECT paymode FROM user_paid WHERE loginid='demo01'").get().paymode, '100');
  assert.equal(db.prepare("SELECT 1 FROM user_paid WHERE loginid='new01'").get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM web_account_disables').get().n, 1);
  db.exec('DROP TRIGGER fail_audit');
  assert.equal(admin.disable({ account: 'demo01', actor: 'admin01' }).status, 'disabled');
});

test('a busy Paid database cannot report a successful ban', t => {
  const { db, admin } = paidFixture(t);
  db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => admin.disable({ account: 'demo01', actor: 'admin01' }), { code: 'SQLITE_BUSY' }); }
  finally { db.exec('ROLLBACK'); }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_paid').get().n, 0);
  assert.equal(admin.disable({ account: 'demo01', actor: 'admin01' }).status, 'disabled');
});

const integration = { skip: !process.env.TEST_PAID_PYTHON || !process.env.TEST_PAID_SCRIPT };
function bridge(filename) {
  return createPaidBridge({ python: process.env.TEST_PAID_PYTHON, script: process.env.TEST_PAID_SCRIPT, database: filename });
}
test('real Paid recharge rejects disabled accounts and receipt replay never re-enables or extends them', integration, async t => {
  const { db, filename, admin } = paidFixture(t), paid = bridge(filename);
  admin.disable({ account: 'trial01', actor: 'admin01' });
  const before = db.prepare("SELECT * FROM user_paid WHERE loginid='trial01'").get();
  await assert.rejects(paid.credit({ order_id: 'disabled:1', loginid: 'trial01', days: 30 }), /Paid 拒绝/);
  assert.deepEqual(db.prepare("SELECT * FROM user_paid WHERE loginid='trial01'").get(), before);
  const request = { order_id: 'before-ban:1', loginid: 'paid01', days: 30 };
  const receipt = await paid.credit(request);
  admin.disable({ account: 'paid01', actor: 'admin01' });
  const banned = db.prepare("SELECT * FROM user_paid WHERE loginid='paid01'").get();
  assert.equal((await paid.credit(request)).replayed, true);
  await assert.rejects(paid.credit({ ...request, order_id: 'after-ban:1' }), /Paid 拒绝/);
  assert.deepEqual(db.prepare("SELECT * FROM user_paid WHERE loginid='paid01'").get(), banned);
  assert.equal(banned.paymode, '000'); assert.equal(banned.enddate, receipt.enddate);
});

test('concurrent real recharge and disable finish with mode 000 in either write order', integration, async t => {
  const { db, filename, add } = paidFixture(t), paid = bridge(filename);
  for (let index = 0; index < 3; index++) {
    const account = 'race0' + index; add(account);
    const credit = paid.credit({ order_id: 'race:' + index, loginid: account, days: 30 });
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
      try { parentPort.postMessage(require(workerData.module).createPaidAdmin({ database: workerData.filename })
        .disable({ account: workerData.account, actor: 'admin01' })); }
      catch (error) { throw error; }`, { eval: true, workerData: { account, filename, module: require.resolve('../lib/paid-admin') } });
    t.after(() => worker.terminate());
    const disable = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const [credited, disabled] = await Promise.allSettled([credit, disable]);
    assert.equal(disabled.status, 'fulfilled');
    const row = db.prepare('SELECT paymode,enddate FROM user_paid WHERE loginid=?').get(account);
    assert.equal(row.paymode, '000');
    assert.equal(row.enddate, credited.status === 'fulfilled' ? credited.value.enddate : '2040-01-01 00:00:00');
    assert.equal(db.prepare('SELECT previous_enddate FROM web_account_disables WHERE loginid=?').get(account).previous_enddate, row.enddate);
  }
});
