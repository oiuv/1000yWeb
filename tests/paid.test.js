'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fixture, registration } = require('./helpers');
const Recharge = require('../models/Recharge');
const { createPaidBridge } = require('../lib/paid');
const { paidPlan } = require('../lib/products');

function fakePaid() {
  const receipts = new Map();
  return { receipts, calls: 0, async credit(request) {
    this.calls++;
    if (!receipts.has(request.order_id)) receipts.set(request.order_id, { ...request, success:true,
      old_enddate:null, enddate:'2027-10-19 12:00:00' });
    return receipts.get(request.order_id);
  } };
}
async function order(t, change = {}, paid = fakePaid()) {
  const data = await fixture(t, undefined, paid), admin = data.client(), player = data.client();
  await player.login();
  const created = await player.request('/api/recharge/submit', registration(change));
  assert.equal(created.code, 201);
  await admin.login('admin01');
  const id = created.data.id;
  const approve = () => admin.request('/api/admin/update-status', {id,status:'verified',expectedStatus:'pending',note:'已核对到账及购买数量'});
  return {...data,admin,player,id,approve,paid};
}
test('fixed month/year pricing is independent from total payment, with underpayment rejection', () => {
  for (const [items,quantities,amount,days] of [
    [['月卡'],{月卡:1},10,30], [['年卡'],{年卡:1},100,365],
    [['月卡'],{月卡:10},100,300], [['月卡','年卡','宝石'],{月卡:2,年卡:1,宝石:3},150,425]
  ]) assert.equal(paidPlan(registration({items,quantities,amount})).days, days);
  assert.throws(()=>paidPlan(registration({items:['年卡'],quantities:{年卡:1},amount:99})),/不足/);
  assert.throws(()=>paidPlan(registration({quantities:{}})),/数量/);
  assert.equal(paidPlan(registration({server:'神武奇章'})),null);
});
test('approval credits fixed 365 days to locked account and completes a card-only order once', async t => {
  const {db,admin,id,approve,paid,player}=await order(t,{items:['年卡'],quantities:{年卡:1},amount:100});
  assert.equal((await approve()).code,200);
  assert.equal(db.prepare('SELECT status FROM recharge_records').get().status,'delivered');
  const job=db.prepare('SELECT * FROM paid_recharges').get();
  assert.equal(job.days,365);assert.equal(job.loginid,'demo01');assert.equal(job.state,'done');
  assert.equal((await approve()).code,409);
  assert.equal((await admin.request('/api/admin/retry-paid',{id})).code,200);
  assert.equal(paid.calls,1);
  const mine=(await player.request('/api/recharge/mine')).data.records[0];
  assert.equal(mine.paid.enddate,'2027-10-19 12:00:00');assert.equal(mine.history.length,2);
});
test('mixed orders credit only time and wait for manual goods delivery; no return-to-pending', async t => {
  const {db,admin,id,approve,paid}=await order(t,{items:['月卡','福袋','宝石'],quantities:{月卡:1,福袋:2,宝石:1},amount:50});
  await approve();assert.equal(db.prepare('SELECT status FROM recharge_records').get().status,'verified');
  assert.equal([...paid.receipts.values()][0].days,30);
  assert.equal((await admin.request('/api/admin/update-status',{id,status:'pending',expectedStatus:'verified',note:'退回'})).code,409);
  assert.equal((await admin.request('/api/admin/update-status',{id,status:'delivered',expectedStatus:'verified',note:'物品已发放'})).code,200);
  assert.equal(paid.calls,1);
});
test('failed/unknown outcome stays retryable across restart with the same receipt key', async t => {
  const paid=fakePaid(), original=paid.credit.bind(paid);
  paid.credit=async request=>{await original(request);throw new Error('synthetic lost response');};
  const {db,id,approve}=await order(t,{},paid);
  const result=await approve();assert.equal(result.code,200);assert.equal(result.data.paidPending,true);
  let store=new Recharge(db), job=store.paidJob(id);
  assert.equal(job.state,'error');assert.equal(db.prepare('SELECT status FROM recharge_records').get().status,'verified');
  assert.equal(store.updateStatus(id,'delivered','verified','admin01','',true).error,409);
  assert.equal(store.updateStatus(id,'pending','verified','admin01','退回',true).error,409);
  paid.credit=original;store=new Recharge(db);
  await Promise.all([store.fulfillPaid(id,paid,'admin01'),store.fulfillPaid(id,paid,'admin01')]);
  assert.equal(paid.receipts.size,1);assert.equal(store.paidJob(id).order_id,job.order_id);
  assert.equal(store.paidJob(id).state,'done');assert.equal(store.history(id).length,2);
});
test('website receipt transaction failure can be retried without re-crediting Paid',async t=>{
  const {db,id,approve,paid}=await order(t);
  db.exec("CREATE TRIGGER deny_receipt BEFORE UPDATE ON paid_recharges WHEN NEW.state='done' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.equal((await approve()).data.paidPending,true);
  db.exec('DROP TRIGGER deny_receipt');
  const store=new Recharge(db);await store.fulfillPaid(id,paid,'admin01');
  assert.equal(paid.receipts.size,1);assert.equal(store.paidJob(id).state,'done');
});
test('unconfigured bridge blocks card approval; Shenwu and item-only orders never call Paid',async t=>{
  const unconfigured=await order(t,{},null);
  assert.equal((await unconfigured.approve()).code,503);
  assert.equal(unconfigured.db.prepare('SELECT status FROM recharge_records').get().status,'pending');
  for(const change of [{server:'神武奇章'},{items:['福袋'],quantities:{福袋:1}}]) {
    const entry=await order(t,change);assert.equal((await entry.approve()).code,200);
    assert.equal(entry.paid.calls,0);assert.equal(entry.db.prepare('SELECT COUNT(*) n FROM paid_recharges').get().n,0);
  }
});
test('retry requires administrator, CSRF and an existing payment job',async t=>{
  const {id,admin,player}=await order(t);
  assert.equal((await player.request('/api/admin/retry-paid',{id})).code,403);
  assert.equal((await admin.request('/api/admin/retry-paid',{id},{'X-CSRF-Token':''})).code,403);
  assert.equal((await admin.request('/api/admin/retry-paid',{id})).code,409);
  assert.equal((await admin.request('/api/admin/retry-paid',{id:9999})).code,409);
  for (const badId of [[],[id],{},true,0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal((await admin.request('/api/admin/retry-paid',{id:badId})).code,400);
    assert.equal((await admin.request('/api/admin/update-status',{id:badId,status:'verified',expectedStatus:'pending',note:''})).code,400);
  }
});
test('legacy records do not auto-credit on startup or approve unbound accounts/unknown quantities',async t=>{
  const {db}=await fixture(t);const store=new Recharge(db);
  const base=registration({ip_address:'127.0.0.1',submitted_by:null});
  const one=store.create(base).id;
  assert.equal(store.updateStatus(one,'verified','pending','admin01','',true).error,409);
  const two=store.create({...base,transaction_id:'000002',submitted_by:'demo01',quantities:{}}).id;
  assert.equal(store.updateStatus(two,'verified','pending','admin01','',true).error,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paid_recharges').get().n,0);
});
test('actual local Python bridge integrates with approval and idempotent receipt replay',{
  skip: !process.env.TEST_PAID_PYTHON || !process.env.TEST_PAID_SCRIPT
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-paid-'));
  const filename=path.join(dir,'synthetic.db');
  const db=new Database(filename);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true});});
  db.exec('CREATE TABLE user_paid (id INTEGER PRIMARY KEY,loginid TEXT UNIQUE NOT NULL,paymode TEXT,enddate TEXT,created_time TEXT,updated_time TEXT)');
  const paid=createPaidBridge({python:process.env.TEST_PAID_PYTHON,script:process.env.TEST_PAID_SCRIPT,database:filename});
  const entry=await order(t,{items:['年卡'],quantities:{年卡:1},amount:100},paid);
  assert.equal((await entry.approve()).data.paidPending,undefined);
  const job=new Recharge(entry.db).paidJob(entry.id);
  assert.equal(job.state,'done');
  const receipt=await paid.credit({order_id:job.order_id,loginid:job.loginid,days:job.days});
  assert.equal(receipt.replayed,true);assert.equal(receipt.enddate,job.enddate);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paid_orders').get().n,1);
  assert.equal(db.prepare('SELECT paymode FROM user_paid').get().paymode,'100');
  assert.equal((new Date(receipt.enddate.replace(' ','T'))-new Date(receipt.created_at.replace(' ','T')))/86400000,365);
  await assert.rejects(paid.credit({order_id:job.order_id,loginid:job.loginid,days:30}),/Paid 拒绝/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paid_orders').get().n,1);
});
