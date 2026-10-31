'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { privateDatabasePath } = require('../lib/private-files');

// Importing modules never opens production data; only explicit startup does.
function openDatabase(filename) {
  if (filename !== ':memory:') {
    filename = privateDatabasePath(filename);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS recharge_records (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, payment_time TEXT NOT NULL,' +
      'transaction_id TEXT NOT NULL, amount DECIMAL(10,2) NOT NULL, items TEXT NOT NULL,' +
      'game_account TEXT NOT NULL, character_name TEXT NOT NULL, server TEXT NOT NULL,' +
      "remark TEXT, status TEXT DEFAULT 'pending', ip_address TEXT," +
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    const columns = new Set(db.pragma('table_info(recharge_records)').map(column => column.name));
    for (const [name, definition] of Object.entries({
      submitted_by: 'TEXT', quantities: "TEXT NOT NULL DEFAULT '{}'"
    })) {
      if (!columns.has(name)) db.exec('ALTER TABLE recharge_records ADD COLUMN ' + name + ' ' + definition);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_status ON recharge_records(status);' +
      'CREATE INDEX IF NOT EXISTS idx_submitted_by ON recharge_records(submitted_by);' +
      'CREATE INDEX IF NOT EXISTS idx_transaction_id ON recharge_records(transaction_id);' +
      'CREATE TABLE IF NOT EXISTS recharge_history (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL REFERENCES recharge_records(id),' +
      'actor TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,' +
      "note TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);" +
      'CREATE INDEX IF NOT EXISTS idx_history_record ON recharge_history(record_id);' +
      'CREATE TABLE IF NOT EXISTS paid_recharges (' +
      'record_id INTEGER PRIMARY KEY REFERENCES recharge_records(id), order_id TEXT NOT NULL UNIQUE,' +
      'loginid TEXT NOT NULL, days INTEGER NOT NULL, state TEXT NOT NULL DEFAULT \'pending\',' +
      'error TEXT, old_enddate TEXT, enddate TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,' +
      'updated_at TEXT DEFAULT CURRENT_TIMESTAMP);' +
      'CREATE TABLE IF NOT EXISTS web_sessions (' +
      'token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL, credential_tag TEXT);' +
      'CREATE INDEX IF NOT EXISTS idx_session_account ON web_sessions(account);' +
      'CREATE INDEX IF NOT EXISTS idx_session_expiry ON web_sessions(expires);');
    if (!db.pragma('table_info(web_sessions)').some(column => column.name === 'credential_tag')) {
      db.exec('ALTER TABLE web_sessions ADD COLUMN credential_tag TEXT');
    }
    // Older sessions cannot prove which credentials authenticated them; require a fresh login.
    db.exec('DELETE FROM web_sessions WHERE credential_tag IS NULL');
  })();
  return db;
}
module.exports = { openDatabase };
