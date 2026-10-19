'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, registration } = require('./helpers');

test('forged Base64/Bearer identities do not authenticate or grant admin', async t => {
  const { client } = await fixture(t);
  const agent = client();
  const forged = Buffer.from(encodeURIComponent(JSON.stringify({ id: 1, account: 'admin01' }))).toString('base64');
  for (const endpoint of ['/api/auth/profile','/api/admin/recharge-records','/api/admin/recharge-stats']) {
    assert.equal((await agent.request(endpoint, undefined, { Authorization: 'Bearer ' + forged })).code, 401);
  }
  assert.equal((await agent.request('/api/auth/update-profile', { email: 'bad@example.invalid' }, { 'x-auth-token': forged })).code, 401);
});
test('real login rotates opaque HttpOnly sessions; logout and expiry invalidate them', async t => {
  const { db, client } = await fixture(t);
  const agent = client();
  const login = await agent.login();
  assert.equal(login.code, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/);
  const old = agent.cookie;
  await agent.login();
  assert.notEqual(agent.cookie, old);
  assert.equal(db.prepare('SELECT count(*) n FROM web_sessions').get().n, 1);
  const impostor = client(); impostor.cookie = old;
  assert.equal((await impostor.request('/api/auth/profile')).code, 401);
  assert.equal((await agent.request('/api/auth/logout', {})).code, 200);
  assert.equal((await agent.request('/api/auth/profile')).code, 401);
  await agent.login();
  db.prepare('UPDATE web_sessions SET expires=0').run();
  assert.equal((await agent.request('/api/auth/profile')).code, 401);
});
test('role is loaded from database, not client state; normal users cannot administer', async t => {
  const { users, client } = await fixture(t);
  const user = client(); await user.login();
  assert.equal((await user.request('/api/admin/recharge-stats')).code, 403);
  const admin = client(); await admin.login('admin01');
  assert.equal((await admin.request('/api/admin/recharge-stats')).code, 200);
  users.rows.get('admin01').id = 9;
  assert.equal((await admin.request('/api/admin/recharge-stats')).code, 403);
});
test('CSRF, cross-origin posts, non-JSON forms and malformed input are rejected', async t => {
  const { client, base } = await fixture(t);
  const agent = client(); await agent.login();
  assert.equal((await agent.request('/api/auth/logout', {}, { 'X-CSRF-Token': '' })).code, 403);
  assert.equal((await agent.request('/api/auth/logout', {}, { Origin: 'https://example.invalid' })).code, 403);
  assert.equal((await agent.request('/api/auth/logout', {}, { 'Sec-Fetch-Site': 'cross-site' })).code, 403);
  assert.equal((await fetch(base + '/api/auth/login', { method:'POST', body:'account=demo01', headers:{'Content-Type':'application/x-www-form-urlencoded'} })).status, 415);
  assert.equal((await fetch(base + '/api/auth/login', { method:'POST', body:'{', headers:{'Content-Type':'application/json'} })).status, 400);
});
test('registration validates confirmation, creates ordinary users and never echoes passwords', async t => {
  const { users, client } = await fixture(t);
  const agent = client();
  const data = { account:'newuser', password:'Valid!234', confirmPassword:'different', telephone:'13800000000', email:'demo@example.invalid' };
  const bad = await agent.request('/api/auth/register', data);
  assert.equal(bad.code,400);
  assert.ok(!JSON.stringify(bad.data).includes(data.password));
  assert.equal((await agent.request('/api/auth/register', { ...data, confirmPassword:data.password })).code,201);
  assert.equal((await agent.login('newuser','Valid!234')).data.user.isAdmin,false);
  assert.ok(users.rows.has('newuser'));
  assert.equal((await agent.request('/api/auth/register', { ...data, confirmPassword:data.password })).code,409);
});
test('password changes require old password and confirmation, and revoke all sessions', async t => {
  const { client } = await fixture(t);
  const first=client(), second=client();
  await first.login(); await second.login();
  const data={oldPassword:'bad',newPassword:'Changed!2',confirmPassword:'Changed!2'};
  assert.equal((await first.request('/api/auth/change-password',data)).code,400);
  assert.equal((await first.request('/api/auth/change-password',{...data,oldPassword:'Demo!234',confirmPassword:'bad'})).code,400);
  assert.equal((await first.request('/api/auth/change-password',{...data,oldPassword:'Demo!234'})).code,200);
  assert.equal((await second.request('/api/auth/profile')).code,401);
  assert.equal((await first.login('demo01','Changed!2')).code,200);
});
test('six digit payment suffix stays usable; exact repeated submissions are blocked, other times allowed', async t => {
  const { client } = await fixture(t);
  const agent=client();await agent.login();
  assert.equal((await agent.request('/api/recharge/submit',registration())).code,201);
  assert.equal((await agent.request('/api/recharge/submit',registration())).code,409);
  assert.equal((await agent.request('/api/recharge/submit',registration({payment_time:'2026-10-19T12:01'}))).code,201);
});
test('recharge validates actual products, quantities, calendar times, amounts and page size', async t => {
  const { client } = await fixture(t); const agent=client();
  await agent.login();
  for (const change of [
    {items:['不存在']},{quantities:{月卡:0}},{quantities:{月卡:1.5}},{amount:'1.001'},
    {amount:'1e3'},{amount:'0'},{payment_time:'2026-02-30T12:00'},{transaction_id:'123'},
    {game_account:['demo01']},{character_name:[]},{server:'未知'}
  ]) assert.equal((await agent.request('/api/recharge/submit',registration(change))).code,400,JSON.stringify(change));
  await agent.login('admin01');
  for(const query of ['limit=-1','limit=101','page=0','status=bad','item=bad']) {
    assert.equal((await agent.request('/api/admin/recharge-records?'+query)).code,400);
  }
});
test('my records are bound to verified submitter, not arbitrary game account or old anonymous records', async t => {
  const { client, db } = await fixture(t); const anonymous=client(), one=client(), two=client();
  const Recharge = require('../models/Recharge');
  new Recharge(db).create(registration({submitted_by:null,ip_address:'127.0.0.1'}));
  await one.login(); await two.login('demo02');
  assert.equal((await one.request('/api/recharge/submit',registration({
    transaction_id:'000002',game_account:'demo02',server:'神武奇章',submitted_by:'demo02'
  }))).code,201);
  const mine=await one.request('/api/recharge/mine');
  assert.equal(mine.data.total,1);
  assert.equal(mine.data.records[0].game_account,'demo02');
  assert.equal(mine.data.records[0].ip_address,undefined);
  assert.equal((await two.request('/api/recharge/mine')).data.total,0);
  assert.equal((await anonymous.request('/api/recharge/mine')).code,401);
});
test('manual review, delivery and correction are audited; stale or invalid transitions fail', async t => {
  const { client, db }=await fixture(t);const player=client(),admin=client();
  await player.login();
  const id=(await player.request('/api/recharge/submit',registration({server:'神武奇章'}))).data.id;
  await admin.login('admin01');
  const action={id,status:'verified',expectedStatus:'pending',note:'已对照付款时间和尾号'};
  assert.equal((await admin.request('/api/admin/update-status',action)).code,200);
  assert.equal((await admin.request('/api/admin/update-status',action)).code,409);
  assert.equal((await admin.request('/api/admin/update-status',{...action,status:'pending',expectedStatus:'verified',note:''})).code,400);
  assert.equal((await admin.request('/api/admin/update-status',{...action,status:'delivered',expectedStatus:'verified'})).code,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_history').get().n,2);
  assert.equal(db.prepare('SELECT actor FROM recharge_history LIMIT 1').get().actor,'admin01');
  assert.equal((await admin.request('/api/admin/update-status',{...action,status:'pending',expectedStatus:'delivered',note:'改回'})).code,409);
  const stats=(await admin.request('/api/admin/recharge-stats')).data.stats;
  assert.equal(stats.totalAmount,'10.00'); assert.equal(stats.delivered,1);
});
test('rate limits cannot be bypassed with arbitrary forwarded headers on an untrusted connection',async t=>{
  const {client}=await fixture(t);const agent=client();
  for(let i=0;i<30;i++) assert.equal((await agent.login('demo01','wrong')).code,401);
  const response=await agent.request('/api/auth/login',{account:'demo01',password:'wrong'},{'X-Forwarded-For':'1.2.3.4','X-Real-IP':'5.6.7.8'});
  assert.equal(response.code,429);assert.ok(response.headers.get('retry-after'));
});
test('CSP disables inline script; authenticated API responses are not cached',async t=>{
  const {base,client}=await fixture(t);const agent=client();await agent.login();
  const profile=await agent.request('/api/auth/profile');
  assert.equal(profile.headers.get('cache-control'),'no-store');
  const response=await fetch(base+'/');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.ok(!response.headers.get('content-security-policy').includes("'unsafe-inline'"));
});

test('trusted HTTPS proxy uses secure cookies and the configured public origin',async t=>{
  const {client}=await fixture(t,{trustProxy:'loopback',secureCookies:true,appOrigin:'https://accounts.example.com'});
  const agent=client();
  const response=await agent.request('/api/auth/login',{account:'demo01',password:'Demo!234'},
    {Origin:'https://accounts.example.com','X-Forwarded-Proto':'https','X-Forwarded-For':'192.0.2.12'});
  assert.equal(response.code,200);
  assert.match(response.headers.getSetCookie().at(-1),/; Secure/);
  assert.match(response.headers.get('strict-transport-security'),/max-age=/);
  assert.equal((await agent.request('/api/auth/logout',{},
    {Origin:'https://wrong.example.com','X-Forwarded-Proto':'https'})).code,403);
  assert.equal((await agent.request('/api/auth/logout',{},
    {Origin:'https://accounts.example.com','X-Forwarded-Proto':'https'})).code,200);
});

test('rejected records can be reviewed again with a reason, and audit order is retained',async t=>{
  const {client}=await fixture(t);const agent=client();
  await agent.login();
  const id=(await agent.request('/api/recharge/submit',registration({server:'神武奇章'}))).data.id;
  await agent.login('admin01');
  for(const [from,to,note] of [
    ['pending','rejected','账单未匹配'],['rejected','pending','收到补充凭证'],
    ['pending','verified','人工核款完成'],['verified','pending','更正核款记录']
  ]) assert.equal((await agent.request('/api/admin/update-status',
    {id,expectedStatus:from,status:to,note})).code,200);
  const record=(await agent.request('/api/admin/recharge-records')).data.records[0];
  assert.deepEqual(record.history.map(entry=>entry.to_status),['rejected','pending','verified','pending']);
  assert.equal((await agent.request('/api/admin/recharge-stats')).data.stats.totalAmount,'0.00');
});

test('recharge submission requires a valid login, including after session expiry or logout',async t=>{
  const {client,db}=await fixture(t);const agent=client();
  assert.equal((await agent.request('/api/recharge/submit',registration())).code,401);
  await agent.login();
  db.prepare('UPDATE web_sessions SET expires=0').run();
  assert.equal((await agent.request('/api/recharge/submit',registration())).code,401);
  await agent.login();
  await agent.request('/api/auth/logout',{});
  assert.equal((await agent.request('/api/recharge/submit',registration())).code,401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n,0);
});

test('Yanhuang locks the account and validates an existing character at submission time',async t=>{
  const {client,users,db}=await fixture(t);const agent=client();await agent.login();
  assert.equal((await agent.request('/api/recharge/submit',registration({game_account:'demo02'}))).code,400);
  assert.equal((await agent.request('/api/recharge/submit',registration({character_name:'青山'}))).code,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n,0);
  assert.equal((await agent.request('/api/recharge/submit',registration({character_name:'归舟'}))).code,201);
  const record=db.prepare('SELECT game_account,character_name,submitted_by FROM recharge_records').get();
  assert.deepEqual(record,{game_account:'demo01',character_name:'归舟',submitted_by:'demo01'});
  users.rows.get('demo01').characters=[];
  assert.equal((await agent.request('/api/recharge/submit',registration({transaction_id:'000003'}))).code,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n,1);
});

test('Shenwu permits a different typed account and character without a Yanhuang character',async t=>{
  const {client,db}=await fixture(t);const agent=client();await agent.login('demo02');
  const data=registration({server:'神武奇章',game_account:'swuser01',character_name:'神武角色'});
  assert.equal((await agent.request('/api/recharge/submit',data)).code,201);
  const record=db.prepare('SELECT game_account,character_name,submitted_by FROM recharge_records').get();
  assert.deepEqual(record,{game_account:'swuser01',character_name:'神武角色',submitted_by:'demo02'});
  assert.equal((await agent.request('/api/recharge/submit',{...data,game_account:'!'})).code,400);
  assert.equal((await agent.request('/api/recharge/submit',{...data,character_name:''})).code,400);
});
