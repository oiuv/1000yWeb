'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PUBLIC_ROOT = path.join(__dirname, '..', 'public');

function within(root, filename) {
  const relative = path.relative(root, filename);
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// Resolve existing ancestors too: the database and its parent directory may not exist yet.
function resolveFuturePath(filename) {
  try { return fs.realpathSync(filename); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      fs.lstatSync(filename);
      throw new Error('数据库路径包含无法解析的链接');
    } catch (statError) {
      if (statError.code !== 'ENOENT') throw statError;
    }
    const parent = path.dirname(filename);
    if (parent === filename) throw error;
    return path.join(resolveFuturePath(parent), path.basename(filename));
  }
}

function privateDatabasePath(filename, publicRoot = PUBLIC_ROOT) {
  const absolute = path.resolve(filename);
  const root = path.resolve(publicRoot);
  const resolved = resolveFuturePath(absolute);
  if (within(root, absolute) || within(resolveFuturePath(root), resolved)) {
    throw new Error('充值数据库不能放在公开目录内');
  }
  return resolved;
}

function isPrivateFilePath(urlPath) {
  // Also cover SQLite sidecars and backups such as accounts.sql.gz or recharge.db.bak.
  return decodeURIComponent(urlPath).split(/[\\/]/).some(part =>
    /\.(?:sql|db|sqlite\d*|bak|backup|log)(?:$|[.\s:-])/i.test(part));
}

module.exports = { privateDatabasePath, isPrivateFilePath };
