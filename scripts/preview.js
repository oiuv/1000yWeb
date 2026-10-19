'use strict';
// Isolated UI preview: no .env, no MSSQL, no real SQLite file, loopback only.
const { openDatabase } = require('../storage/database');
const { createApp } = require('../app');
const { JOB_NAMES, professionGrade } = require('../lib/leaderboard');
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
// Public leaderboard UI fixtures only; never read live backups in preview.
const leaderboard = { async get({ date, metric = 'energy', page = 1, job = 1 } = {}) {
  const dates = ['2026-10-19','2026-10-18','2026-10-17'];
  date = date || dates[0];
  if (!dates.includes(date)) throw Object.assign(new Error('该日期暂无可查看的榜单'), { status: 404 });
  const names = ['听雨','归舟','青山','踏雪寻梅','长风万里','清风客'];
  const rows = Array.from({ length: date === dates[0] ? 28 : 12 }, (_, i) => ({
    name: names[i % names.length] + (i >= names.length ? String(i) : ''), region: '示例',
    guild: i % 3 ? '烟雨江南' : '', realm: 162300 - i * 300 >= 162000 ? '泰山北斗' : '空前绝后',
    energy: 162300 - i * 300, age: 6000 - i * 40, virtue: 9900 - i * 100,
    inPower: 12000 - i * 80, outPower: 11000 - i * 60, magic: 9000 - i * 35,
    wealth: i === 0 ? 12345678901 : (28 - i) * 12345,
    jobKind: i % 5, jobName: JOB_NAMES.get(i % 5) || '',
    profession: i % 5 ? 9999 - i * 170 : null,
    jobGrade: i % 5 ? professionGrade(9999 - i * 170) : ''
  })).filter(row => metric !== 'profession' || row.jobKind === job)
    .sort((a,b) => b[metric] - a[metric]).map((row,i) => ({rank:i+1,...row}));
  return { dates, date, metric, ...(metric === 'profession' ? { job } : {}), page, pages: Math.ceil(rows.length/25), total:rows.length,
    rows:rows.slice((page-1)*25,page*25) };
} };
const server=createApp({db,users,leaderboard}).listen(port,'127.0.0.1',()=>{
  console.log('示例预览（仅内存数据）: http://127.0.0.1:'+port);
  console.log('玩家 demo01 / Demo!234；管理员 admin01 / Admin!234');
});
function stop(){server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
