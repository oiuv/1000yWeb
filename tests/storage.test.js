'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {openDatabase}=require('../storage/database');
const Recharge=require('../models/Recharge');

test('all rows participate in SQL filtering and totals, including beyond old caps',t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());const store=new Recharge(db);
  const insert=db.prepare('INSERT INTO recharge_records(payment_time,transaction_id,amount,items,game_account,character_name,server,status) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(()=>{
    for(let i=0;i<10001;i++)insert.run('2026-10-19T12:00',String(i).padStart(6,'0'),0.01,'["月卡"]',i===0?'older_target':'demo01','测试角色','炎黄新章','verified');
  })();
  assert.equal(store.list({search:'older_target',item:'月卡'}).total,1);
  assert.equal(store.list({search:'%'}).total,0);
  assert.equal(store.stats().total,10001);
  assert.equal(store.stats().totalAmount,'100.01');
  assert.equal(store.list({page:101,limit:100}).records.length,1);
});
test('schema upgrade preserves legacy payment rows, statuses and order IDs without assigning owners',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-migration-'));
  const file=path.join(dir,'synthetic.db');let db=new Database(file);
  t.after(()=>{ if(db.open)db.close(); fs.rmSync(dir,{recursive:true}); });
  db.exec("CREATE TABLE recharge_records(id INTEGER PRIMARY KEY AUTOINCREMENT,payment_time TEXT,transaction_id TEXT,amount DECIMAL(10,2),items TEXT,game_account TEXT,character_name TEXT,server TEXT,remark TEXT,status TEXT,ip_address TEXT,created_at TEXT,updated_at TEXT)");
  db.prepare('INSERT INTO recharge_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(114,'2025-12-28T10:30','123456',30,'["月卡"]','demo01','听雨','炎黄新章','历史备注','verified','127.0.0.1','2025-12-28 02:30:00','2025-12-28 02:30:00');
  db.close();db=openDatabase(file);
  const row=db.prepare('SELECT * FROM recharge_records').get();
  assert.equal(row.id,114);assert.equal(row.status,'verified');assert.equal(row.amount,30);
  assert.equal(row.submitted_by,null);assert.equal(row.quantities,'{}');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_history').get().n,0);
  db.close();db=openDatabase(file);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_records').get().n,1);
  db.close();
});
