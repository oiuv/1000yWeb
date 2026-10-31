'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createPaidStatusReader, paidState } = require('../lib/paid-status');

function synthetic(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-paid-read-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'paid.db');
  const db = new Database(filename);
  db.exec('CREATE TABLE user_paid (id INTEGER PRIMARY KEY,loginid TEXT UNIQUE NOT NULL,paymode TEXT,enddate TEXT,created_time TEXT,updated_time TEXT)');
  const insert = db.prepare('INSERT INTO user_paid VALUES (?,?,?,?,?,?)');
  for (const [id, account, mode, enddate] of [
    [1, 'active01', '100', '2030-11-01 00:00:00'], [2, 'expired01', '100', '2030-10-31 12:00:00'],
    [3, 'disabled01', '000', '2040-01-01 00:00:00'], [4, 'trial01', '001', '2030-10-31 13:00:00'],
    [5, 'badDate01', '100', 'broken'], [6, 'badMode01', '999', '2040-01-01 00:00:00'],
    [7, 'CaseExact', '200', '2040-01-01 00:00:00'], [8, 'literal%_', '400', '2040-01-01 00:00:00']
  ]) insert.run(id, account, mode, enddate, '2030-10-01 00:00:00', '2030-10-02 00:00:00');
  db.close();
  return { filename, reader: createPaidStatusReader({ database: filename, now: () => new Date(2030, 9, 31, 12) }) };
}

test('Paid status follows disabled precedence, local expiry and exact expiry boundary', () => {
  const now = new Date(2030, 9, 31, 12);
  assert.equal(paidState('000', 'broken', now), 'disabled');
  for (const mode of ['001', '100', '200', '400']) {
    assert.equal(paidState(mode, '2030-10-31 12:00:01', now), 'active');
    assert.equal(paidState(mode, '2030-10-31 12:00:00', now), 'expired');
    assert.equal(paidState(mode, '2030-10-30', now), 'expired');
  }
  for (const date of [null, '', 'invalid', '0000-01-01', '2030-02-30 00:00:00', '2030-13-01 00:00:00', '2030-10-31 24:00:00']) {
    assert.equal(paidState('100', date, now), 'unknown', String(date));
  }
  assert.equal(paidState('999', '2040-01-01 00:00:00', now), 'unknown');
  assert.equal(paidState('100', '2030-10-31 12:00:00.000001', now), 'active');
});

test('Paid lists paginate stably and filter literal accounts and mutually exclusive statuses', t => {
  const { reader } = synthetic(t);
  const first = reader.list({ page: 1, limit: 3 });
  assert.equal(first.total, 8); assert.equal(first.pages, 3); assert.equal(first.hasMore, true);
  assert.deepEqual(first.records.map(row => row.account), ['literal%_', 'CaseExact', 'badMode01']);
  assert.equal(reader.list({ page: 3, limit: 3 }).records.length, 2);
  assert.deepEqual(reader.list({ page: 4, limit: 3 }).records, []);
  for (const [status, count] of [['active', 4], ['expired', 1], ['disabled', 1], ['unknown', 2]]) {
    const result = reader.list({ status });
    assert.equal(result.total, count);
    assert.ok(result.records.every(row => row.status === status));
  }
  assert.equal(reader.list({ search: '%_' }).records[0].account, 'literal%_');
  assert.equal(reader.list({ search: 'ACTIVE' }).total, 1);
  assert.equal(reader.list({ search: "' OR 1=1 --" }).total, 0);
  assert.equal(reader.list({ search: 'none' }).total, 0);
});

test('batch account lookup preserves Paid case sensitivity and includes no unrelated accounts', t => {
  const { reader } = synthetic(t);
  const rows = reader.forAccounts(['active01', 'caseexact', 'CaseExact', 'missing01']);
  assert.deepEqual([...rows.keys()].sort(), ['CaseExact', 'active01']);
  assert.equal(rows.get('active01').status, 'active');
  assert.deepEqual(reader.forAccounts([]), new Map());
  assert.throws(() => reader.forAccounts(Array(101).fill('active01')), /过大/);
});

test('status reads neither change the Paid database nor create recharge receipt tables', t => {
  const { filename, reader } = synthetic(t);
  const before = fs.readFileSync(filename);
  reader.list(); reader.forAccounts(['active01']);
  assert.deepEqual(fs.readFileSync(filename), before);
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), [{ name: 'user_paid' }]);
  db.close();
});

test('missing, removed and malformed Paid databases fail instead of becoming empty lists', t => {
  const { filename, reader } = synthetic(t);
  const missing = path.join(path.dirname(filename), 'missing.db');
  assert.throws(() => createPaidStatusReader({ database: missing }));
  assert.equal(fs.existsSync(missing), false);
  assert.throws(() => createPaidStatusReader({ database: 'relative.db' }), /绝对路径/);
  assert.throws(() => createPaidStatusReader({ database: path.resolve(__dirname, '../public/admin.html') }), /公开目录/);
  fs.unlinkSync(filename);
  assert.throws(() => reader.list());
  assert.equal(fs.existsSync(filename), false);
  fs.writeFileSync(filename, 'not a database');
  assert.throws(() => reader.list());
});
