'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { fixture, fakeUsers, registration } = require('./helpers');
const { createSecurity } = require('../lib/security');
const { openDatabase } = require('../storage/database');
const { privateDatabasePath, isPrivateFilePath } = require('../lib/private-files');

function scratch(t, close = () => {}) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'yh-security-'));
  t.after(() => {
    close();
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('yh-security-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('external password changes invalidate every old session before reads or writes', async t => {
  const { users, client, db } = await fixture(t);
  const first = client(), second = client(), unrelated = client();
  await first.login(); await second.login(); await unrelated.login('demo02');
  users.rows.get('demo01').password = 'Changed!456';
  const denied = await first.request('/api/auth/profile');
  assert.equal(denied.code, 401);
  assert.match(denied.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await second.request('/api/recharge/submit', registration())).code, 401);
  assert.equal(db.prepare('SELECT count(*) n FROM recharge_records').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM web_sessions WHERE account='demo01'").get().n, 0);
  assert.equal((await unrelated.request('/api/auth/profile')).code, 200);
  assert.equal((await client().login('demo01', 'Demo!234')).code, 401);
  assert.equal((await client().login('demo01', 'Changed!456')).code, 200);
});

test('external administrator password changes revoke access to all administration', async t => {
  const { users, client } = await fixture(t);
  const admin = client(); await admin.login('admin01');
  users.rows.get('admin01').password = 'ChangedAdmin!456';
  assert.equal((await admin.request('/api/admin/recharge-stats')).code, 401);
  assert.equal((await admin.request('/api/auth/session')).data.user, null);
});

test('credential binding tolerates CHAR padding and profile edits but not leading password changes', async t => {
  const { users, client } = await fixture(t);
  const agent = client(); await agent.login();
  const row = users.rows.get('demo01');
  row.password += '   '; row.account += '   '; row.email = 'changed@example.invalid';
  const profile = await agent.request('/api/auth/profile');
  assert.equal(profile.code, 200);
  assert.equal(profile.data.profile.email, row.email);
  row.password = ' ' + row.password;
  assert.equal((await agent.request('/api/auth/profile')).code, 401);
});

test('session credentials are unique per cookie and never expose passwords or raw tokens', async t => {
  const { client, db } = await fixture(t);
  const first = client(), second = client();
  const result = await first.login(); await second.login();
  const rows = db.prepare('SELECT * FROM web_sessions').all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].credential_tag, rows[1].credential_tag);
  for (const row of rows) assert.match(row.credential_tag, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(rows).includes('Demo!234'));
  assert.ok(!JSON.stringify(rows).includes(first.cookie.split('=')[1]));
  assert.ok(!JSON.stringify(result.data).includes('credential_tag'));
  assert.ok(!JSON.stringify(result.data).includes('Demo!234'));
  db.prepare('UPDATE web_sessions SET credential_tag=NULL').run();
  assert.equal((await first.request('/api/auth/profile')).code, 401);
});

test('account deletion and replacement cannot inherit existing sessions', async t => {
  const { users, client } = await fixture(t);
  const deleted = client(); await deleted.login();
  users.rows.delete('demo01');
  assert.equal((await deleted.request('/api/auth/profile')).code, 401);
  const replaced = client(); await replaced.login('demo02');
  users.rows.get('demo02').id = 400;
  assert.equal((await replaced.request('/api/auth/profile')).code, 401);
});

test('session migration discards unbound legacy sessions and preserves new sessions across restart', async t => {
  let db;
  const directory = scratch(t, () => { if (db?.open) db.close(); });
  const filename = path.join(directory, 'sessions.db');
  db = new Database(filename);
  db.exec('CREATE TABLE web_sessions (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL)');
  db.prepare('INSERT INTO web_sessions VALUES (?,?,?,?)').run('legacy', 'demo01', 'legacy', Date.now() + 60000);
  db.close(); db = openDatabase(filename);
  assert.equal(db.prepare('SELECT count(*) n FROM web_sessions').get().n, 0);
  const users = fakeUsers();
  let token;
  const response = { cookie(name, value) { token = value; } };
  createSecurity(db, users).issue({ headers: {} }, response, users.rows.get('demo01'));
  const original = db.prepare('SELECT * FROM web_sessions').get();
  db.close(); db = openDatabase(filename);
  assert.deepEqual(db.prepare('SELECT * FROM web_sessions').get(), original);
  const request = { headers: { cookie: 'yh_session=' + token } };
  await createSecurity(db, users).load(request, response, error => { if (error) throw error; });
  assert.equal(request.user.account, 'demo01');
});

test('compressed JSON is rejected before authentication, including trailing compressed bytes', async t => {
  const { base, users, client } = await fixture(t);
  let attempts = 0;
  const authenticate = users.authenticate.bind(users);
  users.authenticate = (...args) => { attempts++; return authenticate(...args); };
  const body = Buffer.from(JSON.stringify({ account: 'demo01', password: 'Demo!234' }));
  for (const [encoding, data] of [
    ['gzip', zlib.gzipSync(body)], ['deflate', zlib.deflateSync(body)],
    ['br', zlib.brotliCompressSync(body)],
    ['gzip', Buffer.concat([zlib.gzipSync(body), Buffer.from('invalid trailing bytes')])]
  ]) {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding }, body: data
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).success, false);
  }
  assert.equal(attempts, 0);
  assert.equal((await client().login()).code, 200);
});

test('JSON size and syntax limits remain active without decompression', async t => {
  const { base } = await fixture(t);
  for (const [body, code] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(17000) }), 413]]) {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    assert.equal(response.status, code);
  }
});

test('database path guard rejects public paths before creating directories or opening files', t => {
  const target = path.resolve(__dirname, '../public', 'audit-' + crypto.randomUUID(), 'records.db');
  assert.throws(() => openDatabase(target), /公开目录/);
  assert.equal(fs.existsSync(path.dirname(target)), false);
  const directory = scratch(t), publicRoot = path.join(directory, 'public');
  fs.mkdirSync(publicRoot);
  for (const file of [publicRoot, path.join(publicRoot, 'sub', 'records.db')]) {
    assert.throws(() => privateDatabasePath(file, publicRoot), /公开目录/);
  }
  const allowed = path.join(directory, 'public-private', 'new', 'records.db');
  assert.equal(privateDatabasePath(allowed, publicRoot), allowed);
});

test('database path guard follows directory links and rejects dangling links', t => {
  const directory = scratch(t), publicRoot = path.join(directory, 'public');
  fs.mkdirSync(publicRoot);
  const link = path.join(directory, 'private-alias');
  fs.symlinkSync(publicRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => privateDatabasePath(path.join(link, 'new', 'records.db'), publicRoot), /公开目录/);
  const dangling = path.join(directory, 'dangling');
  fs.symlinkSync(path.join(directory, 'missing'), dangling, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => privateDatabasePath(path.join(dangling, 'records.db'), publicRoot));
});

test('database path guard recognizes a linked public root', t => {
  const directory = scratch(t), actual = path.join(directory, 'actual-public');
  fs.mkdirSync(actual);
  const publicRoot = path.join(directory, 'public');
  fs.symlinkSync(actual, publicRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => privateDatabasePath(path.join(actual, 'records.db'), publicRoot), /公开目录/);
});

test('static file guard covers encoded names, database sidecars and compressed backups', () => {
  for (const filename of ['/a.sql', '/a.DB-wal', '/a.db-shm', '/a.db-journal', '/a.sqlite3', '/a.sql.gz',
    '/a.db.bak', '/a.backup.zip', '/a.log', '/a%2Esql', '/a.sql/assets.txt', '/a.sql%20', '/a.db::$DATA']) {
    assert.equal(isPrivateFilePath(filename), true, filename);
  }
  for (const filename of ['/index.html', '/js/auth.js', '/css/style.css', '/client.zip', '/img/database.png']) {
    assert.equal(isPrivateFilePath(filename), false, filename);
  }
});

test('existing synthetic backups cannot be fetched through GET, HEAD or Range', async t => {
  const { base } = await fixture(t);
  const publicRoot = path.resolve(__dirname, '../public');
  const name = 'audit-' + crypto.randomUUID() + '.sql';
  const filename = path.join(publicRoot, name);
  fs.writeFileSync(filename, 'SYNTHETIC_BACKUP_MARKER', { flag: 'wx' });
  t.after(() => { assert.equal(path.dirname(filename), publicRoot); fs.unlinkSync(filename); });
  for (const [method, suffix, headers] of [['GET', name, {}], ['HEAD', name, {}],
    ['GET', name.replace('.sql', '%2esql'), { Range: 'bytes=0-15' }]]) {
    const response = await fetch(base + '/' + suffix, { method, headers });
    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes('SYNTHETIC_BACKUP_MARKER'));
  }
  assert.equal((await fetch(base + '/login.html')).status, 200);
});
