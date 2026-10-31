'use strict';
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

const PAY_MODES = new Set(['000', '001', '100', '200', '400']);
const PAID_STATUSES = ['active', 'expired', 'disabled', 'unknown'];

function paidState(mode, enddate, now) {
  // Keep the Paid service's disabled-first rule and local wall-clock dates.
  if (mode === '000') return 'disabled';
  if (!PAY_MODES.has(mode) || typeof enddate !== 'string') return 'unknown';
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?$/.exec(enddate);
  if (!parts) return 'unknown';
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(value => Number(value || 0));
  if (year < 1) return 'unknown';
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return 'unknown';
  return date.getTime() + Number('0.' + (parts[7] || '0')) * 1000 > now.getTime() ? 'active' : 'expired';
}

function resolvePaidDatabase(database) {
  if (!database || !path.isAbsolute(database) || !fs.statSync(database).isFile()) {
    throw new Error('付费查询须指定已有数据库的绝对路径');
  }
  const filename = fs.realpathSync(database);
  const publicRoot = fs.realpathSync(path.join(__dirname, '..', 'public'));
  const relative = path.relative(publicRoot, filename);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('付费数据库不能放在公开目录');
  }
  return filename;
}

function createPaidStatusReader({ database, now = () => new Date() }) {
  const filename = resolvePaidDatabase(database);
  function read(operation) {
    const db = new Database(filename, { readonly: true, fileMustExist: true, timeout: 1500 });
    try {
      db.pragma('query_only = ON');
      const time = now();
      db.function('web_paid_state', { deterministic: true }, (mode, enddate) => paidState(mode, enddate, time));
      return db.transaction(() => operation(db)).deferred();
    } finally { db.close(); }
  }
  const fields = 'loginid AS account,paymode AS mode,enddate,created_time AS createdAt,' +
    'updated_time AS updatedAt,web_paid_state(paymode,enddate) AS status';
  return {
    list({ page = 1, limit = 20, search = '', status = '' } = {}) {
      return read(db => {
        const clauses = [], params = { limit, offset: (page - 1) * limit };
        if (search) { clauses.push('instr(lower(loginid),lower(@search)) > 0'); params.search = search; }
        if (status) { clauses.push('web_paid_state(paymode,enddate) = @status'); params.status = status; }
        const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
        const countParams = Object.fromEntries(Object.entries(params).filter(([key]) => !['limit', 'offset'].includes(key)));
        const total = db.prepare('SELECT COUNT(*) AS total FROM user_paid' + where).get(countParams).total;
        const records = db.prepare('SELECT ' + fields + ' FROM user_paid' + where +
          ' ORDER BY created_time DESC,id DESC LIMIT @limit OFFSET @offset').all(params);
        return { records, total, page, limit, pages: Math.ceil(total / limit), hasMore: page * limit < total };
      });
    },
    forAccounts(accounts) {
      if (!accounts.length) return new Map();
      if (accounts.length > 100) throw new Error('付费查询批次过大');
      return read(db => new Map(db.prepare('SELECT ' + fields + ' FROM user_paid WHERE loginid IN (' +
        accounts.map(() => '?').join(',') + ')').all(...accounts).map(row => [row.account, row])));
    }
  };
}
module.exports = { createPaidStatusReader, resolvePaidDatabase, paidState, PAID_STATUSES };
