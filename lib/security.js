'use strict';
const crypto = require('node:crypto');
const COOKIE = 'yh_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function cookieToken(req) {
  const part = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(COOKIE + '='));
  const value = part ? part.slice(COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function sameSecret(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    crypto.timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)));
}
function credentialTag(token, user) {
  // The random cookie is the HMAC key; neither it nor the plaintext password is stored in SQLite.
  // Match the native account adapter's CHAR-padding semantics, including leading password spaces.
  return crypto.createHmac('sha256', Buffer.from(token, 'hex'))
    .update(JSON.stringify([Number(user.id), user.account.trimEnd(), String(user.password || '').trimEnd()]))
    .digest('hex');
}
function createSecurity(db, users, { adminIds = [1], secureCookies = false } = {}) {
  function setCookie(req, res, token, maxAge = SESSION_MS) {
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: secureCookies || req.secure,
      path: '/', maxAge
    });
  }
  function destroy(req, res) {
    const token = cookieToken(req);
    if (token) db.prepare('DELETE FROM web_sessions WHERE token_hash = ?').run(hash(token));
    setCookie(req, res, '', 0);
  }
  function issue(req, res, user) {
    destroy(req, res);
    db.prepare('DELETE FROM web_sessions WHERE expires <= ?').run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO web_sessions (token_hash, account, csrf, expires, credential_tag) VALUES (?, ?, ?, ?, ?)')
      .run(hash(token), user.account.trimEnd(), csrf, Date.now() + SESSION_MS, credentialTag(token, user));
    setCookie(req, res, token);
    return csrf;
  }
  function publicUser(user) {
    return {
      id: user.id, account: user.account.trimEnd(), username: user.username?.trimEnd() || '',
      email: user.email?.trimEnd() || '', isAdmin: adminIds.includes(Number(user.id))
    };
  }
  async function load(req, res, next) {
    try {
      const token = cookieToken(req);
      const session = token && db.prepare('SELECT * FROM web_sessions WHERE token_hash = ? AND expires > ?')
        .get(hash(token), Date.now());
      if (session) {
        const user = await users.findByAccount(session.account);
        if (user && sameSecret(session.credential_tag, credentialTag(token, user))) {
          req.user = publicUser(user); req.session = session;
        }
        else destroy(req, res);
      }
      next();
    } catch (error) { next(error); }
  }
  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, message: '登录已失效，请重新登录' });
    next();
  }
  function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) return res.status(403).json({ success: false, message: '需要管理员权限' });
    next();
  }
  function csrf(req, res, next) {
    if (req.session && !sameSecret(req.get('X-CSRF-Token'), req.session.csrf)) {
      return res.status(403).json({ success: false, message: '页面验证已失效，请刷新后重试' });
    }
    next();
  }
  return {
    load, requireUser, requireAdmin, csrf, issue, destroy, publicUser,
    revokeAccount(account) { db.prepare('DELETE FROM web_sessions WHERE account = ?').run(account); }
  };
}
function sameOrigin(appOrigin) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const expected = appOrigin || req.protocol + '://' + req.get('host');
    if ((req.get('Origin') && req.get('Origin') !== expected) || req.get('Sec-Fetch-Site') === 'cross-site') {
      return res.status(403).json({ success: false, message: '不允许跨站提交' });
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, message: '请使用网站表单提交' });
    }
    next();
  };
}
function rateLimit(db, scope, maximum, windowMs) {
  db.exec('CREATE TABLE IF NOT EXISTS web_rate_limits (' +
    'scope TEXT, ip TEXT, count INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(scope, ip))');
  const take = db.transaction((ip, now) => {
    db.prepare('DELETE FROM web_rate_limits WHERE expires <= ?').run(now);
    db.prepare('INSERT INTO web_rate_limits VALUES (?, ?, 1, ?) ON CONFLICT(scope, ip) DO UPDATE SET count=count+1')
      .run(scope, ip, now + windowMs);
    return db.prepare('SELECT count, expires FROM web_rate_limits WHERE scope = ? AND ip = ?').get(scope, ip);
  });
  return (req, res, next) => {
    const now = Date.now();
    const row = take(req.ip, now);
    if (row.count > maximum) {
      res.set('Retry-After', String(Math.ceil((row.expires - now) / 1000)));
      return res.status(429).json({ success: false, message: '操作过于频繁，请稍后再试' });
    }
    next();
  };
}
module.exports = { createSecurity, sameOrigin, rateLimit, sameSecret };
