'use strict';
const Database = require('better-sqlite3');
const { resolvePaidDatabase, paidState } = require('./paid-status');

function validAccount(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 20 &&
    value === value.trim() && !/[\x00-\x20\x7f]/.test(value);
}
function localTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Only disable and 000 -> 100 unban; no record deletion or arbitrary mode/expiry setter.
function createPaidAdmin({ database, now = () => new Date() }) {
  const filename = resolvePaidDatabase(database);
  return {
    disable({ account, actor, reason = '' }) {
      if (!validAccount(account) || !validAccount(actor) || typeof reason !== 'string' || reason.length > 200) {
        throw new TypeError('禁用参数无效');
      }
      const db = new Database(filename, { fileMustExist: true, timeout: 1500 });
      try {
        // Same SQLite write lock as Paid credit_order; concurrent credit cannot undo a ban.
        return db.transaction(() => {
          const previous = db.prepare('SELECT paymode,enddate FROM user_paid WHERE loginid=?').get(account);
          if (db.prepare('SELECT 1 FROM user_paid WHERE loginid=? COLLATE NOCASE AND loginid<>?').get(account, account)) {
            throw Object.assign(new Error('账号大小写与付费记录不一致，请通过 Paid 管理核对'), { code: 'PAID_CASE_MISMATCH' });
          }
          if (previous?.paymode === '000') return { account, status: 'disabled', alreadyDisabled: true };
          const timestamp = localTimestamp(now());
          db.exec(`CREATE TABLE IF NOT EXISTS web_account_disables (
            id INTEGER PRIMARY KEY, loginid TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
            previous_mode TEXT, previous_enddate TEXT, created_at TEXT NOT NULL
          )`);
          if (previous) {
            db.prepare("UPDATE user_paid SET paymode='000',updated_time=? WHERE loginid=?").run(timestamp, account);
          } else {
            // Paid requires a date even for disabled records; this grants no paid time.
            db.prepare("INSERT INTO user_paid(loginid,paymode,enddate,created_time,updated_time) VALUES (?,'000',?,?,?)")
              .run(account, timestamp, timestamp, timestamp);
          }
          db.prepare('INSERT INTO web_account_disables(loginid,actor,reason,previous_mode,previous_enddate,created_at) VALUES (?,?,?,?,?,?)')
            .run(account, actor, reason, previous?.paymode ?? null, previous?.enddate ?? null, timestamp);
          return { account, status: 'disabled', alreadyDisabled: false };
        }).immediate();
      } finally { db.close(); }
    },
    unban({ account, actor, reason = '' }) {
      if (!validAccount(account) || !validAccount(actor) || typeof reason !== 'string' || reason.length > 200) {
        throw new TypeError('解封参数无效');
      }
      const db = new Database(filename, { fileMustExist: true, timeout: 1500 });
      try {
        return db.transaction(() => {
          const previous = db.prepare('SELECT paymode,enddate FROM user_paid WHERE loginid=?').get(account);
          if (db.prepare('SELECT 1 FROM user_paid WHERE loginid=? COLLATE NOCASE AND loginid<>?').get(account, account)) {
            throw Object.assign(new Error('账号大小写与付费记录不一致，请通过 Paid 管理核对'), { code: 'PAID_CASE_MISMATCH' });
          }
          // Recheck under the same write lock as disable and recharge. Never create a trial record.
          if (previous?.paymode !== '000') {
            throw Object.assign(new Error('账号当前未封禁，请刷新列表'), { code: 'PAID_NOT_DISABLED' });
          }
          const time = now(), timestamp = localTimestamp(time);
          db.exec(`CREATE TABLE IF NOT EXISTS web_account_unbans (
            id INTEGER PRIMARY KEY, loginid TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
            previous_mode TEXT, previous_enddate TEXT, created_at TEXT NOT NULL
          )`);
          db.prepare("UPDATE user_paid SET paymode='100',updated_time=? WHERE loginid=? AND paymode='000'")
            .run(timestamp, account);
          db.prepare('INSERT INTO web_account_unbans(loginid,actor,reason,previous_mode,previous_enddate,created_at) VALUES (?,?,?,?,?,?)')
            .run(account, actor, reason, previous.paymode, previous.enddate, timestamp);
          return { account, mode: '100', status: paidState('100', previous.enddate, time), enddate: previous.enddate };
        }).immediate();
      } finally { db.close(); }
    }
  };
}
module.exports = { createPaidAdmin, validAccount };
