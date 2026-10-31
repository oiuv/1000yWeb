'use strict';
const path = require('node:path');
const { createApp } = require('./app');
const { openDatabase } = require('./storage/database');

function start() {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const users = require('./models/User');
  const database = require('./config/database');
  const trustProxy = process.env.TRUST_PROXY || 'loopback';
  if (trustProxy === 'true') throw new Error('TRUST_PROXY must name trusted proxy IPs/subnets, not true');
  const adminIds = (process.env.ADMIN_IDS || '1').split(',').map(value => Number(value.trim()));
  if (!adminIds.every(id => Number.isInteger(id) && id > 0)) throw new Error('Invalid ADMIN_IDS');
  const appOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : undefined;
  const dbPath = path.resolve(__dirname, process.env.SQLITE_PATH || 'database/recharge.db');
  const paidConfig = { python: process.env.PAID_PYTHON, script: process.env.PAID_RECHARGE_SCRIPT, database: process.env.PAID_DB_PATH };
  const paid = paidConfig.python || paidConfig.script ? require('./lib/paid').createPaidBridge(paidConfig) : null;
  const paidStatus = paidConfig.database ? require('./lib/paid-status').createPaidStatusReader({ database: paidConfig.database }) : null;
  const paidAdmin = paidConfig.database ? require('./lib/paid-admin').createPaidAdmin({ database: paidConfig.database }) : null;
  const leaderboard = require('./lib/leaderboard').createLeaderboard({
    directory: process.env.LEADERBOARD_DATA_DIR,
    powerLevels: process.env.LEADERBOARD_POWER_LEVEL_FILE,
    history: Number(process.env.LEADERBOARD_HISTORY || 30),
    excludeCharacters: (process.env.LEADERBOARD_EXCLUDE_CHARACTERS || '').split(',').map(value => value.trim()).filter(Boolean)
  });
  const db = openDatabase(dbPath);
  const app = createApp({ db, users, paid, paidStatus, paidAdmin, leaderboard, config: {
    trustProxy: trustProxy === 'false' ? false : trustProxy, adminIds, appOrigin,
    secureCookies: process.env.NODE_ENV === 'production'
  } });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => console.log('云端千年账号中心: http://' + host + ':' + port));
  function shutdown() {
    server.close(async () => {
      db.close();
      await database.closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
if (require.main === module) start();
module.exports = { start };
