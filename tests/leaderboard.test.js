'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./helpers');
const { gameLevel } = require('../lib/game-levels');
const { createLeaderboard, parsePowerLevels, parseSnapshot, realmFor, professionGrade } = require('../lib/leaderboard');

const power = Buffer.from('Name,ViewName,PowerValue,LimitEnergy,\r\n2,Second,8000,999999,\r\n1,First,4000,7999,\r\n3,Third,12000,13000,\r\n');
const slots = [['HaveItem',30],['HaveMaterialItem',5],['HaveMarketItem',10]]
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => prefix + i));
const fields = ['PrimaryKey','MasterName','Password','Guild','Light','Dark','Energy','Virtue','InPower','OutPower','Magic','JobKind','Talent','ExtJobKind','CurJobExp','X','Y','LastDate', ...slots];
// Fixed GBK fixture bytes, independent of host encoding or extra dependencies.
const currencyBytes = { 钱币:'c7aeb1d2', 银元:'d2f8d4aa', 银钞:'d2f8b3ae', 金钞:'bdf0b3ae', 金元:'bdf0d4aa' };
function encodeFixture(text) {
  return Buffer.concat(text.split(/(钱币|银元|银钞|金钞|金元)/).map(part =>
    Object.hasOwn(currencyBytes, part) ? Buffer.from(currencyBytes[part], 'hex') : Buffer.from(part)));
}
function record(name = 'Hero', changes = {}) {
  return { PrimaryKey: name + ':Region', MasterName: 'PRIVATE_ACCOUNT', Password: 'PRIVATE_PASSWORD',
    Guild: 'Guild', Light: '7954182', Dark: '0', Energy: '8000', Virtue: '7954182',
    InPower: '7954182', OutPower: '7954182', Magic: '7954182', JobKind: '0', Talent: '0', ExtJobKind: '0', CurJobExp: '0',
    X: '91', Y: '92', LastDate: '2026/09/01', ...changes };
}
function snapshot(records) { return encodeFixture(fields.join(',') + '\r\n' + records.map(row => fields.map(key => row[key]).join(',')).join('\r\n') + '\r\n'); }
async function source(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1000yh-board-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'Userdata'); await fs.mkdir(directory);
  const powerLevels = path.join(root, 'PowerLevel.sdb');
  async function write(file, data, stable = true) {
    await fs.writeFile(file, data);
    if (stable) await fs.utimes(file, new Date(0), new Date(0));
  }
  await write(powerLevels, power);
  return { directory, powerLevels, write, board: createLeaderboard({ directory, powerLevels, ...options }),
    put(date, rows, stable = true) { return write(path.join(directory, `UserData${date}.SDB`), snapshot(rows), stable); } };
}

test('realm uses ordered Name and PowerValue; equality enters realm, LimitEnergy does not cap it', () => {
  const levels = parsePowerLevels(power);
  for (const [value, name] of [[0,'未入境'],[3999,'未入境'],[4000,'First'],[7999,'First'],[8000,'Second'],[11999,'Second'],[12000,'Third'],[999999,'Third']]) {
    assert.equal(realmFor(value, levels), name);
  }
  // Explicit GBK bytes for 出入境: no dependency on machine code page.
  const gbk = Buffer.concat([Buffer.from('Name,ViewName,PowerValue\r\n1,'), Buffer.from('b3f6c8ebbeb3','hex'), Buffer.from(',4000\r\n')]);
  assert.equal(parsePowerLevels(gbk)[0].name, '出入境');
  assert.throws(() => parsePowerLevels(Buffer.from('Name,ViewName,PowerValue\n2,Gap,4000')), /境界配置/);
  assert.throws(() => parsePowerLevels(Buffer.from('Name,ViewName,PowerValue\n1,A,8000\n2,B,4000')), /境界配置/);
});

test('native level thresholds, high-experience integer truncation, age and three-power bonuses', () => {
  for (const [exp, level] of [[0,100],[105,199],[106,200],[107,200],[7954182,5000],[9181541,5100],[10576744,5200],[10589189,5200],[10592644,5201],[1085138171,10000],[1085138172,9999]]) {
    assert.equal(gameLevel(exp), level, String(exp));
  }
  const rows = parseSnapshot(snapshot([record()]), parsePowerLevels(power));
  assert.deepEqual(rows[0], { name:'Hero', region:'Region', guild:'Guild', energy:8000, realm:'Second',
    age:5000, virtue:5000, inPower:8500, outPower:8500, magic:8000, wealth:0,
    jobKind:0, jobName:'', profession:null, jobGrade:'' });
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  assert.equal(parseSnapshot(snapshot([record('Beginner', { Virtue: '-1' })]), parsePowerLevels(power))[0].virtue, 100);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['name','region','guild','energy','realm','age','virtue','inPower','outPower','magic','wealth','jobKind','jobName','profession','jobGrade'].sort());
});

test('manufacturing job names and grades follow Talent, including the 99.98/99.99 boundary', () => {
  for (const [skill, grade] of [[100,'初级工'],[1999,'初级工'],[2000,'技能工'],[3999,'技能工'],
    [4000,'熟练工'],[5999,'熟练工'],[6000,'达人'],[7999,'达人'],[8000,'名人'],[9998,'名人'],[9999,'神工'],[10000,'神工']]) {
    assert.equal(professionGrade(skill), grade, String(skill));
  }
  const levels = parsePowerLevels(power);
  const rows = parseSnapshot(snapshot([0,1,2,3,4,5].map(kind => record('Job'+kind, {
    JobKind: String(kind), Talent: '7954182', ExtJobKind: '5', CurJobExp: '1085138172'
  }))), levels);
  assert.deepEqual(rows.map(row => row.jobName), ['', '铸造师', '炼丹师', '裁缝', '工匠', '']);
  assert.deepEqual(rows.map(row => row.profession), [null, 5000, 5000, 5000, 5000, null]);
  assert.equal(rows[1].jobGrade, '熟练工');
  assert.equal(rows[0].jobGrade, '');
  assert.ok(!JSON.stringify(rows).includes('CurJobExp'));
  assert.equal(parseSnapshot(snapshot([record('Master', {JobKind:'2',Talent:'1085138172'})]), levels)[0].jobGrade, '神工');
  for (const changes of [{JobKind:'x'}, {JobKind:'1',Talent:'bad'}]) {
    assert.throws(() => parseSnapshot(snapshot([record('Invalid', changes)]), levels), /格式异常/);
  }
});

test('wealth sums five exact currencies across bag, crafting and market without exposing inventory', () => {
  const row = record('Hero', {
    HaveItem0:'钱币:99:7:0:0:0:0:0:0', HaveItem1:'银元:99:2:0:0:0:0:0:0',
    HaveItem2:'银钞:99:3:0:0:0:0:0:0', HaveItem3:'金钞:99:4:0:0:0:0:0:0',
    HaveItem4:'金元:99:5:0:0:0:0:0:0', HaveItem29:'金元:1:11:0:0:0:0:1:0',
    HaveMaterialItem0:'钱币:1:0:0:0:0:0:0:0', HaveMaterialItem4:'银钞:1:13:0:0:0:0:0:0',
    HaveMarketItem0:'钱币:1:17:0:0:0:0:0', HaveMarketItem9:'金钞:1:19:0:0:0:0:999999',
    HaveMarketItem1:'PRIVATE_ITEM:1:999:0:0:0:0:10000000', HaveItem5:'Gold:1:999:0:0:0:0:0:0'
  });
  const [result] = parseSnapshot(snapshot([row]), parsePowerLevels(power));
  assert.equal(result.wealth, 291224);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result).includes('HaveItem'));
  assert.ok(!JSON.stringify(result).includes('金元'));
  const maximum = record('Large', Object.fromEntries(slots.map(slot => [slot, '金元:1:2147483647:0:0:0:0:0:0'])));
  const large = parseSnapshot(snapshot([maximum]), parsePowerLevels(power))[0].wealth;
  assert.equal(large, 966367641150000); assert.ok(Number.isSafeInteger(large));
});

test('missing inventory columns and invalid currency counts fail instead of silently reporting zero', () => {
  const levels = parsePowerLevels(power);
  for (const count of ['-1','1.5','NaN','','2147483648']) {
    assert.throws(() => parseSnapshot(snapshot([record('Hero', { HaveItem0:`金元:1:${count}:0:0:0:0:0:0` })]), levels), /榜单数据格式/);
  }
  assert.throws(() => parseSnapshot(snapshot([record('Hero', { HaveItem0:'金元:1' })]), levels), /榜单数据格式/);
  const missing = Buffer.from(snapshot([record()]).toString().replace('HaveItem29', 'UnusedField'));
  assert.throws(() => parseSnapshot(missing, levels), /字段不完整/);
});

test('rejects broken structures, invalid bytes and duplicated roles without exposing private data', () => {
  const levels = parsePowerLevels(power);
  for (const input of [Buffer.from('PrimaryKey\nPRIVATE_PASSWORD'), Buffer.from([0x81]),
    snapshot([record(), record()]), snapshot([record('Hero', { Energy: '-1' })]),
    Buffer.concat([snapshot([record()]), Buffer.from('broken,PRIVATE_PASSWORD\r\n')])]) {
    assert.throws(() => parseSnapshot(input, levels), error => !error.message.includes('PRIVATE'));
  }
  const rows = parseSnapshot(snapshot([record('GM'), record('Tester'), record('Hero')]), levels, new Set(['GM','Tester:Region']));
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Hero');
});

test('latest and selected snapshots stay independent; only most recent configured dates available', async t => {
  const s = await source(t, { history: 2 });
  await s.put('2026-10-17', [record('Old')]);
  await s.put('2026-10-18', [record('Yesterday')]);
  await s.put('2026-10-19', [record('Today')]);
  await s.write(path.join(s.directory, 'Today.SDB'), snapshot([record('Unfinished')]));
  await s.write(path.join(s.directory, 'UserData2026-02-30.SDB'), snapshot([record('InvalidDate')]));
  const latest = await s.board.get();
  assert.equal(latest.date, '2026-10-19'); assert.equal(latest.rows[0].name, 'Today');
  assert.deepEqual(latest.dates, ['2026-10-19','2026-10-18']);
  assert.equal((await s.board.get({ date: '2026-10-18' })).rows[0].name, 'Yesterday');
  await assert.rejects(s.board.get({ date: '2026-10-17' }), { status: 404 });
  await assert.rejects(s.board.get({ date: '../../private' }), { status: 400 });
});

test('ties share competition ranks across pages and supported metric controls ordering', async t => {
  const s = await source(t);
  await s.put('2026-10-19', Array.from({length: 27}, (_, i) => record('Hero'+String(i).padStart(2,'0'), { Energy: i < 26 ? '8000' : '4000', Virtue: i === 26 ? '9181541' : '0' })));
  const first = await s.board.get(); const second = await s.board.get({ page: 2 });
  assert.equal(first.total, 27); assert.equal(first.rows.length, 25); assert.equal(first.pages, 2);
  assert.deepEqual(second.rows.map(row => row.rank), [1,27]);
  assert.equal((await s.board.get({ metric: 'virtue' })).rows[0].name, 'Hero26');
  await assert.rejects(s.board.get({ page: 3 }), { status: 400 });
  await assert.rejects(s.board.get({ metric: 'Password' }), { status: 400 });
});

test('wealth ranks converted amounts, preserves ties across pages and keeps daily snapshots separate', async t => {
  const s = await source(t);
  await s.put('2026-10-18', [record('Yesterday', { HaveItem0:'金元:1:1:0:0:0:0:0:0' })]);
  await s.put('2026-10-19', Array.from({length:27}, (_, i) => record('Hero'+String(i).padStart(2,'0'), {
    HaveItem0: i === 26 ? '钱币:1:99:0:0:0:0:0:0' : i % 2 ? '钱币:1:100:0:0:0:0:0:0' : '银元:1:1:0:0:0:0:0:0'
  })));
  const first = await s.board.get({ metric:'wealth' });
  assert.equal(first.rows.length, 25); assert.equal(first.rows[0].wealth, 100);
  const second = await s.board.get({ metric:'wealth', page:2 });
  assert.deepEqual(second.rows.map(row => [row.rank,row.wealth]), [[1,100],[27,99]]);
  assert.equal((await s.board.get({date:'2026-10-18',metric:'wealth'})).rows[0].wealth, 10000);
});

test('profession filters before ranking and pagination, excludes no-job roles and never fills from other dates', async t => {
  const s = await source(t, { excludeCharacters:['GM'] });
  await s.put('2026-10-18', [record('Previous', {JobKind:'4',Talent:'1085138172'})]);
  await s.put('2026-10-19', [
    ...Array.from({length:27}, (_, i) => record('Crafter'+String(i).padStart(2,'0'), {
      JobKind:'1', Talent:i < 26 ? '7954182' : '0'
    })),
    record('Alchemist', {JobKind:'2',Talent:'0'}), record('Tailor', {JobKind:'3',Talent:'9181541'}),
    record('NoJob', {Talent:'1085138172'}), record('Miner', {JobKind:'5',CurJobExp:'1085138172'}),
    record('GM', {JobKind:'1',Talent:'1085138172'})
  ]);
  const first = await s.board.get({metric:'profession'});
  assert.equal(first.job, 1); assert.equal(first.total, 27); assert.equal(first.pages, 2);
  assert.equal(first.rows.length, 25); assert.ok(first.rows.every(row => row.jobName === '铸造师'));
  assert.deepEqual((await s.board.get({metric:'profession',page:2})).rows.map(row => row.rank), [1,27]);
  assert.equal((await s.board.get({metric:'profession',job:2})).rows[0].profession, 100);
  assert.equal((await s.board.get({metric:'profession',job:3})).rows[0].jobGrade, '熟练工');
  const empty = await s.board.get({metric:'profession',job:4});
  assert.equal(empty.date, '2026-10-19'); assert.equal(empty.total, 0); assert.deepEqual(empty.rows, []);
  const previous = await s.board.get({metric:'profession',job:4,date:'2026-10-18'});
  assert.equal(previous.rows[0].name, 'Previous'); assert.equal(previous.rows[0].jobGrade, '神工');
  const normal = await s.board.get({metric:'wealth',page:2});
  assert.equal(normal.total, 31); assert.ok(normal.rows.some(row => row.name === 'NoJob' && row.jobName === ''));
  for (const query of [{metric:'profession',job:0},{metric:'profession',job:5},{metric:'profession',job:'1'},
    {metric:'wealth',job:1},{metric:'profession',job:4,page:2}]) {
    await assert.rejects(s.board.get(query), {status:400});
  }
});

test('empty directory, not-yet-written files, missing settings and public paths fail safely', async t => {
  assert.equal(createLeaderboard(), null);
  assert.throws(() => createLeaderboard({ directory:'relative', powerLevels:'relative' }));
  assert.throws(() => createLeaderboard({ directory:path.resolve('public'), powerLevels:path.resolve('private.sdb') }));
  const s = await source(t);
  assert.deepEqual((await s.board.get()).dates, []);
  await assert.rejects(s.board.get({date:'2026-10-19'}), {status:404});
  const fresh = createLeaderboard(s);
  await s.put('2026-10-19', [record()], false);
  await assert.rejects(fresh.get(), { status: 503 });
  await s.put('2026-10-19', [record()]);
  await fs.unlink(s.powerLevels);
  await assert.rejects(fresh.get(), error => error.status === 503 && !error.message.includes(s.directory));
});

test('directory and PowerLevel updates are read after cache expiry without restarting', async t => {
  const s = await source(t);
  await s.put('2026-10-18', [record()]);
  assert.equal((await s.board.get()).rows[0].realm, 'Second');
  await s.put('2026-10-19', [record('New')]);
  await s.write(s.powerLevels, Buffer.from('Name,ViewName,PowerValue\n1,Changed,4000\n'));
  const future = Date.now() + 31000;
  t.mock.method(Date, 'now', () => future);
  const latest = await s.board.get();
  assert.equal(latest.date, '2026-10-19'); assert.equal(latest.rows[0].realm, 'Changed');
  assert.equal((await s.board.get({date:'2026-10-18'})).rows[0].realm, 'Changed');
});

test('public HTTP endpoint exposes only ranks, rejects query injection and never serves raw SDB', async t => {
  const s = await source(t);
  await s.put('2026-10-19', [record('Hero', { JobKind:'3', Talent:'7954182', HaveItem0:'金钞:1:2:0:0:0:0:0:0', HaveItem1:'PRIVATE_ITEM:1:1:0:0:0:0:0:0' })]);
  const { client, base } = await fixture(t, undefined, null, s.board);
  const anonymous = client();
  const result = await anonymous.request('/api/leaderboard');
  assert.equal(result.code, 200); assert.equal(result.data.rows[0].realm, 'Second');
  assert.equal(result.data.rows[0].jobName, '裁缝');
  assert.ok(!JSON.stringify(result.data).includes('PRIVATE'));
  const rich = await anonymous.request('/api/leaderboard?metric=wealth');
  assert.equal(rich.code, 200); assert.equal(rich.data.metric, 'wealth');
  assert.equal(rich.data.rows[0].wealth, 10000);
  assert.ok(!JSON.stringify(rich.data).includes('PRIVATE'));
  assert.ok(!JSON.stringify(rich.data).includes('HaveItem'));
  const jobBoard = await anonymous.request('/api/leaderboard?metric=profession&job=3');
  assert.equal(jobBoard.code, 200); assert.equal(jobBoard.data.rows[0].profession, 5000);
  assert.equal(jobBoard.data.rows[0].jobGrade, '熟练工');
  assert.equal((await anonymous.request('/api/leaderboard?metric=profession')).data.total, 0);
  for (const query of ['date=../../secret','date=2026-02-30','date[]=2026-10-19','metric=Password','metric=__proto__','page=-1','page=1e2','page[]=1',
    'metric=profession&job[]=1','metric=profession&job=0','metric=profession&job=5','metric=profession&job=1e0','metric=wealth&job=1']) {
    assert.equal((await anonymous.request('/api/leaderboard?' + query)).code, 400, query);
  }
  assert.equal((await anonymous.request('/api/leaderboard?date=2026-10-18')).code, 404);
  assert.equal((await fetch(base + '/UserData2026-10-19.SDB')).status, 404);
  assert.equal((await fetch(base + '/leaderboard.html')).status, 200);
  await s.write(path.join(s.directory, 'UserData2026-10-19.SDB'), Buffer.from('bad,PRIVATE_PASSWORD\n'));
  t.mock.method(Date, 'now', () => new Date('2030-01-01').getTime());
  const invalid = await anonymous.request('/api/leaderboard');
  assert.equal(invalid.code, 503); assert.ok(!JSON.stringify(invalid.data).includes('PRIVATE'));
});

test('unconfigured leaderboard has useful public response without affecting other routes', async t => {
  const { client } = await fixture(t);
  const c = client();
  assert.equal((await c.request('/api/leaderboard')).code, 503);
  assert.equal((await c.request('/api/auth/session')).code, 200);
});
