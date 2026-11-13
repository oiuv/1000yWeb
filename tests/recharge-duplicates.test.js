'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { fixture, registration } = require('./helpers');
const { openDatabase } = require('../storage/database');
const Recharge = require('../models/Recharge');

test('pending account and suffix identify duplicates despite changed fields or letter case', async t => {
  const { client, db } = await fixture(t);
  const player = client(); await player.login();
  const data = registration({ server: '神武奇章', transaction_id: 'abc123' });
  assert.equal((await player.request('/api/recharge/submit', data)).code, 201);
  for (const changes of [
    { payment_time: '2026-10-20T13:00' }, { amount: 20 },
    { character_name: '归舟' }, { items: ['福袋'], quantities: { 福袋: 2 } },
    { remark: '再次登记' }, { server: '炎黄新章' },
    { game_account: 'DEMO01', transaction_id: 'ABC123' }
  ]) {
    const result = await player.request('/api/recharge/submit', { ...data, ...changes });
    assert.equal(result.code, 409, JSON.stringify(changes));
    assert.match(result.data.message, /相同交易尾号的待审核订单/);
    assert.equal(result.data.success, false);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n, 1);
  // Other payment suffixes and other recipient accounts remain independent.
  assert.equal((await player.request('/api/recharge/submit', { ...data, transaction_id: 'abc124' })).code, 201);
  assert.equal((await player.request('/api/recharge/submit', { ...data, game_account: 'demo02' })).code, 201);
  const other = client(); await other.login('demo02');
  assert.equal((await other.request('/api/recharge/submit', data)).code, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n, 3);
});

test('only pending orders block the same suffix; different suffixes are always allowed', async t => {
  for (const status of ['pending', 'verified', 'delivered', 'rejected']) {
    await t.test(status, async t => {
      const { client, db } = await fixture(t);
      const player = client(); await player.login();
      const created = await player.request('/api/recharge/submit', registration());
      assert.equal(created.code, 201);
      db.prepare('UPDATE recharge_records SET status=? WHERE id=?').run(status, created.data.id);
      assert.equal((await player.request('/api/recharge/submit', registration())).code, status === 'pending' ? 409 : 201);
      assert.equal((await player.request('/api/recharge/submit', registration({ transaction_id: '000002' }))).code, 201);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n, status === 'pending' ? 2 : 3);
      assert.equal(db.prepare('SELECT status FROM recharge_records WHERE id=?').get(created.data.id).status, status);
    });
  }
});

test('GM rejection allows a corrected resubmission and keeps the original record and audit', async t => {
  const { client, db } = await fixture(t);
  const player = client(), admin = client();
  await player.login(); await admin.login('admin01');
  const created = await player.request('/api/recharge/submit', registration());
  assert.equal(created.code, 201);
  const corrected = registration({ payment_time: '2026-10-20T13:00', amount: 20 });
  assert.equal((await player.request('/api/recharge/submit', corrected)).code, 409);
  assert.equal((await player.request('/api/admin/update-status', {
    id: created.data.id, status: 'rejected', expectedStatus: 'pending', note: '付款信息填写错误，请更正后重新提交'
  })).code, 403);
  assert.equal((await player.request('/api/recharge/submit', corrected)).code, 409);
  assert.equal((await admin.request('/api/admin/update-status', {
    id: created.data.id, status: 'rejected', expectedStatus: 'pending', note: '付款信息填写错误，请更正后重新提交'
  })).code, 200);
  const resubmitted = await player.request('/api/recharge/submit', corrected);
  assert.equal(resubmitted.code, 201);
  assert.notEqual(resubmitted.data.id, created.data.id);
  assert.equal((await player.request('/api/recharge/submit', corrected)).code, 409);
  const store = new Recharge(db);
  assert.equal(store.get(created.data.id).status, 'rejected');
  assert.equal(store.history(created.data.id)[0].to_status, 'rejected');
  assert.equal(store.get(resubmitted.data.id).status, 'pending');
  assert.equal(store.get(resubmitted.data.id).amount, 20);
});

test('existing pending duplicates survive startup and continue to block new registrations', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-duplicates-'));
  const filename = path.join(directory, 'synthetic.db');
  let db = openDatabase(filename);
  t.after(() => { if (db.open) db.close(); fs.rmSync(directory, { recursive: true }); });
  const insert = db.prepare('INSERT INTO recharge_records ' +
    '(payment_time,transaction_id,amount,items,game_account,character_name,server,status) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('2026-10-19T12:00', 'abc123', 10, '["月卡"]', 'demo01', '听雨', '炎黄新章', 'pending');
  insert.run('2026-10-19T12:01', 'ABC123', 20, '["月卡"]', 'DEMO01', '归舟', '神武奇章', 'pending');
  const before = db.prepare('SELECT * FROM recharge_records ORDER BY id').all();
  db.close(); db = openDatabase(filename);
  const result = new Recharge(db).create(registration({ transaction_id: 'ABC123', amount: 30 }));
  assert.equal(result.duplicate, true);
  assert.deepEqual(db.prepare('SELECT * FROM recharge_records ORDER BY id').all(), before);
});

test('concurrent submissions from separate database connections create only one order', { timeout: 15000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-duplicate-race-'));
  const filename = path.join(directory, 'synthetic.db');
  const db = openDatabase(filename);
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.terminate()));
    db.close(); fs.rmSync(directory, { recursive: true });
  });
  for (let index = 0; index < 2; index++) {
    workers.push(new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const db = require(workerData.databaseModule).openDatabase(workerData.filename);
      const Recharge = require(workerData.rechargeModule);
      parentPort.once('message', () => {
        try { parentPort.postMessage(new Recharge(db).create(workerData.data)); }
        finally { db.close(); }
      });
      parentPort.postMessage('ready');
    `, { eval: true, workerData: {
      filename, databaseModule: require.resolve('../storage/database'), rechargeModule: require.resolve('../models/Recharge'),
      data: registration({ transaction_id: index ? 'ABC123' : 'abc123', game_account: index ? 'DEMO01' : 'demo01',
        amount: index ? 20 : 10, payment_time: index ? '2026-10-20T12:00' : '2026-10-19T12:00',
        submitted_by: 'demo01', ip_address: '127.0.0.1' })
    } }));
  }
  await Promise.all(workers.map(worker => once(worker, 'message')));
  const completed = workers.map(worker => once(worker, 'message'));
  for (const worker of workers) worker.postMessage('submit');
  const results = (await Promise.all(completed)).map(([result]) => result);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal(results[0].id, results[1].id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n, 1);
});
