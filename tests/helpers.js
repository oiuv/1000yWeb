'use strict';
const { once } = require('node:events');
const { createApp } = require('../app');
const { openDatabase } = require('../storage/database');
const { sameSecret } = require('../lib/security');

function fakeUsers() {
  const rows = new Map([
    ['admin01', { id: 1, account: 'admin01', password: 'Admin!234', email: 'admin@example.invalid', characters: ['青山:云端'] }],
    ['demo01', { id: 2, account: 'demo01', password: 'Demo!234', email: 'demo@example.invalid', characters: ['听雨:云端', '归舟:云端'] }],
    ['demo02', { id: 3, account: 'demo02', password: 'Demo!234', email: 'other@example.invalid', characters: [] }]
  ]);
  return {
    rows,
    async findByAccount(account) { return rows.get(account.toLowerCase()) || null; },
    async authenticate(account, password) {
      const row = await this.findByAccount(account);
      return row && sameSecret(row.password, password) ? row : null;
    },
    async getProfile(account) {
      const row = await this.findByAccount(account);
      if (!row) return null;
      const { password, ...profile } = row;
      return profile;
    },
    async create(data) { rows.set(data.account, { ...data, id: rows.size + 10, characters: [] }); },
    async updateProfile(account, data) {
      const row = rows.get(account);
      for (const key of ['email','telephone','username','birth','address']) {
        if (Object.hasOwn(data, key)) row[key] = data[key];
      }
    },
    async changePassword(account, oldPassword, newPassword) {
      const row = await this.authenticate(account, oldPassword);
      if (!row) return false;
      row.password = newPassword;
      return true;
    }
  };
}
const registration = overrides => ({
  payment_time: '2026-10-19T12:00', transaction_id: '123456', amount: '10.00',
  items: ['月卡'], quantities: { 月卡: 1 }, game_account: 'demo01',
  character_name: '听雨', server: '炎黄新章', remark: '', ...overrides
});
async function fixture(t, config, paid = null) {
  const db = openDatabase(':memory:');
  const users = fakeUsers();
  const app = createApp({ db, users, config, paid });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  function client() {
    return {
      cookie: '', csrf: '',
      async request(url, body, headers = {}, method = body === undefined ? 'GET' : 'POST') {
        const response = await fetch(base + url, { method, headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.cookie ? { Cookie: this.cookie, 'X-CSRF-Token': this.csrf } : {}), ...headers
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) this.cookie = cookies.at(-1).split(';')[0];
        const data = await response.json();
        if (data.csrfToken) this.csrf = data.csrfToken;
        return { code: response.status, headers: response.headers, data };
      },
      login(account = 'demo01', password = account === 'admin01' ? 'Admin!234' : 'Demo!234') {
        return this.request('/api/auth/login', { account, password });
      }
    };
  }
  return { db, users, app, server, base, client };
}
module.exports = { fixture, registration, fakeUsers };
