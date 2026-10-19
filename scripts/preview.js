'use strict';
// Isolated UI preview: no .env, no MSSQL, no real SQLite file, loopback only.
const { openDatabase } = require('../storage/database');
const { createApp } = require('../app');
const Recharge = require('../models/Recharge');
const { fakeUsers, registration } = require('../tests/helpers');
const db = openDatabase(':memory:');
const users = fakeUsers();
const store = new Recharge(db);
for(let i=0;i<25;i++) {
  const record = registration({
    transaction_id:String(100000+i),payment_time:'2026-10-19T'+(10+Math.floor(i/60))+':'+String(i%60).padStart(2,'0'),
    character_name:['听雨','归舟','青山'][i%3], server:i%3===0?'神武奇章':'炎黄新章',
    items:i%2===0?['月卡','宝石']:['福袋'], quantities:i%2===0?{月卡:1,宝石:2}:{福袋:1},
    remark:i===24?'请核对角色后交付。':i===23?'安全显示测试：" <img src=x onerror=alert(1)>':'',
    submitted_by:'demo01',ip_address:'127.0.0.1'
  });
  const {id}=store.create(record);
  if(i%4===0)store.updateStatus(id,'verified','pending','admin01','付款时间、尾号及金额已核对');
  if(i%8===0)store.updateStatus(id,'delivered','verified','admin01','示例交付记录');
}
const port = Number(process.env.PREVIEW_PORT || 4318);
const server=createApp({db,users}).listen(port,'127.0.0.1',()=>{
  console.log('示例预览（仅内存数据）: http://127.0.0.1:'+port);
  console.log('玩家 demo01 / Demo!234；管理员 admin01 / Admin!234');
});
function stop(){server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
