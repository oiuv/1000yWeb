'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createPaidStatusReader } = require('../lib/paid-status');
const { createPaidAdmin } = require('../lib/paid-admin');

function paidFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-paid-disable-'));
  const filename = path.join(directory, 'synthetic.db');
  const db = new Database(filename);
  db.exec(`CREATE TABLE user_paid (id INTEGER PRIMARY KEY,loginid TEXT UNIQUE NOT NULL,
    paymode TEXT NOT NULL,enddate TEXT NOT NULL,created_time TEXT,updated_time TEXT)`);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const add = (account, mode = '100', enddate = '2040-01-01 00:00:00') => db.prepare(
    'INSERT INTO user_paid(loginid,paymode,enddate,created_time,updated_time) VALUES (?,?,?,?,?)'
  ).run(account, mode, enddate, '2020-01-01 00:00:00', '2020-01-02 00:00:00');
  return { db, filename, add, reader: createPaidStatusReader({ database: filename }),
    admin: createPaidAdmin({ database: filename, now: () => new Date(2030, 9, 31, 12) }) };
}
module.exports = { paidFixture };
