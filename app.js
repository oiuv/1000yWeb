'use strict';
const express = require('express');
const path = require('node:path');
const helmet = require('helmet');
const Recharge = require('./models/Recharge');
const { createSecurity, sameOrigin, rateLimit } = require('./lib/security');
const { isPrivateFilePath } = require('./lib/private-files');

function createApp({ db, users, config = {}, paid = null, paidStatus = null, paidAdmin = null, leaderboard = null }) {
  if (!db || !users) throw new Error('Explicit database and account adapter are required');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: config.secureCookies ? [] : null
    } },
    strictTransportSecurity: config.secureCookies ? undefined : false
  }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', sameOrigin(config.appOrigin));
  app.use(express.json({ limit: '16kb', inflate: false }));
  const security = createSecurity(db, users, config);
  const limit = (scope, max, minutes) => rateLimit(db, scope, max, minutes * 60 * 1000);
  const limits = {
    login: limit('login', 30, 15), register: limit('register', 10, 60),
    password: limit('password', 10, 15), recharge: limit('recharge', 20, 15)
  };
  app.use('/api', limit('api', 300, 1), security.load);
  app.use('/api', (req, res, next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    security.csrf(req, res, next);
  });
  const dependencies = { users, security, limits, paid, paidStatus, paidAdmin, recharge: new Recharge(db) };
  app.use('/api/auth', require('./routes/auth')(dependencies));
  app.use('/api/recharge', require('./routes/recharge')(dependencies));
  app.use('/api/admin', require('./routes/admin')(dependencies));
  app.use('/api/leaderboard', require('./routes/leaderboard')({ leaderboard }));
  app.use('/api', (req, res) => res.status(404).json({ success: false, message: '接口不存在' }));
  app.use((req, res, next) => {
    try {
      if (isPrivateFilePath(req.path)) return res.status(404).send('页面不存在，请返回首页。');
    } catch { return res.status(400).send('请求格式不正确'); }
    next();
  });
  app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
  app.use((req, res) => res.status(404).send('页面不存在，请返回首页。'));
  app.use((error, req, res, next) => {
    const status = error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 :
      error.type === 'encoding.unsupported' || error.type === 'charset.unsupported' ? 415 : 500;
    // Never log request bodies, credentials, SQL statements, or raw database errors.
    if (status === 500) console.error('Request failed:', req.method, req.path, error.code || error.name);
    res.status(status).json({ success: false, message:
      status === 400 ? '请求格式不正确' : status === 413 ? '提交内容过大' :
        status === 415 ? '不支持该请求编码，请使用网站表单提交' : '服务暂时不可用，请稍后重试' });
  });
  return app;
}
module.exports = { createApp };
