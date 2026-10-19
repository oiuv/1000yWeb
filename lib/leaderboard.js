'use strict';

// Daily character snapshots are private DB exports; only project public fields.
const fs = require('node:fs/promises');
const path = require('node:path');
const { gameLevel } = require('./game-levels');

const METRICS = ['energy', 'age', 'virtue', 'inPower', 'outPower', 'magic', 'wealth'];
// Item.sdb internal names and face values, in 钱币. Never value other items by sale price.
const CURRENCY_VALUES = new Map([['钱币', 1], ['银元', 100], ['银钞', 1000], ['金钞', 5000], ['金元', 10000]]);
const MONEY_SLOTS = [['HaveItem', 30], ['HaveMaterialItem', 5], ['HaveMarketItem', 10]]
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => prefix + i));
const MAX_BYTES = 16 * 1024 * 1024;
const CATALOG_TTL = 30000;

class BoardError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function integer(value, signed = false) {
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(value) || Number(value) > 2147483647 || Number(value) < -2147483648) {
    throw new BoardError('榜单数据格式异常，请联系管理员');
  }
  return Number(value);
}
function table(buffer, required) {
  // Native export concatenates comma-separated fields without CSV quoting.
  let text;
  try { text = new TextDecoder('gbk', { fatal: true }).decode(buffer); }
  catch { throw new BoardError('榜单数据编码异常，请联系管理员'); }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new BoardError('榜单文件尚未准备完成');
  const headers = lines.shift().split(',');
  if (headers.at(-1) === '') headers.pop();
  if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) {
    throw new BoardError('榜单数据字段不完整，请联系管理员');
  }
  return lines.map(line => {
    const values = line.split(',');
    if (values.length === headers.length + 1 && values.at(-1) === '') values.pop();
    if (values.length !== headers.length) throw new BoardError('榜单文件不完整，请稍后重试');
    return Object.fromEntries(required.map(key => [key, values[headers.indexOf(key)]]));
  });
}
function parsePowerLevels(buffer) {
  const rows = table(buffer, ['Name', 'ViewName', 'PowerValue']);
  const levels = rows.map(row => ({ id: integer(row.Name), name: row.ViewName, threshold: integer(row.PowerValue) }))
    .sort((a, b) => a.id - b.id);
  // TGS indexes Name - 1 and stops at the first empty entry; reject ambiguous tables.
  if (!levels.length || levels.length >= 100 || levels.some((row, i) =>
    row.id !== i + 1 || !row.name || (i > 0 && row.threshold < levels[i - 1].threshold))) {
    throw new BoardError('境界配置不完整，请联系管理员');
  }
  return levels;
}
function realmFor(energy, levels) {
  // CalcPowerLevel + GetPowerLevelName: equality meets the threshold.
  let name = '未入境';
  for (const level of levels) {
    if (energy < level.threshold) break;
    name = level.name;
  }
  return name;
}
function parseSnapshot(buffer, levels, excluded = new Set()) {
  const fields = ['PrimaryKey', 'Guild', 'Light', 'Dark', 'Energy', 'Virtue', 'InPower', 'OutPower', 'Magic', ...MONEY_SLOTS];
  const seen = new Set();
  const rows = [];
  for (const row of table(buffer, fields)) {
    const key = row.PrimaryKey;
    if (!key || seen.has(key)) throw new BoardError('榜单角色记录异常，请联系管理员');
    seen.add(key);
    const separator = key.lastIndexOf(':');
    const name = separator < 0 ? key : key.slice(0, separator);
    if (excluded.has(key) || excluded.has(name)) continue;
    const age = gameLevel(integer(row.Light, true) + integer(row.Dark, true));
    const energy = integer(row.Energy);
    // uDBProvider.ChangeDataToStr: Name:Color:Count:...; market Cost is not currency.
    // All 45 slots at Int32 max and highest face value still fit a JS safe integer.
    let wealth = 0;
    for (const slot of MONEY_SLOTS) {
      const [item, , count] = row[slot].split(':');
      if (CURRENCY_VALUES.has(item)) wealth += CURRENCY_VALUES.get(item) * integer(count);
    }
    // Public whitelist only. Do not return or cache account/password/location/inventory.
    rows.push({ name, region: separator < 0 ? '' : key.slice(separator + 1), guild: row.Guild,
      energy, realm: realmFor(energy, levels), age, virtue: gameLevel(integer(row.Virtue, true)),
      inPower: gameLevel(integer(row.InPower, true)) + 1000 + Math.trunc(age / 2),
      outPower: gameLevel(integer(row.OutPower, true)) + 1000 + Math.trunc(age / 2),
      magic: gameLevel(integer(row.Magic, true)) + 500 + Math.trunc(age / 2), wealth });
  }
  return rows;
}
function outsidePublic(value) {
  const relative = path.relative(path.join(__dirname, '..', 'public'), value);
  return relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
}
function createLeaderboard({ directory, powerLevels, history = 30, excludeCharacters = [] } = {}) {
  if (!directory && !powerLevels) return null;
  if (!directory || !powerLevels || !path.isAbsolute(directory) || !path.isAbsolute(powerLevels)
      || !outsidePublic(directory) || !outsidePublic(powerLevels)) {
    throw new Error('Leaderboard requires absolute private directory and PowerLevel.sdb paths outside public/');
  }
  if (!Number.isInteger(history) || history < 1 || history > 366) throw new Error('Leaderboard history must be 1-366');
  const excluded = new Set(excludeCharacters);
  let catalog = [], catalogTime = 0, scanning = null;
  const cache = new Map();
  async function dates() {
    if (Date.now() - catalogTime < CATALOG_TTL) return catalog;
    if (scanning) return scanning;
    scanning = (async () => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      catalog = entries.filter(entry => entry.isFile() && /^UserData\d{4}-\d{2}-\d{2}\.sdb$/i.test(entry.name))
        .map(entry => ({ date: entry.name.slice(8, 18), file: entry.name }))
        .filter(entry => validDate(entry.date)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, history);
      catalogTime = Date.now();
      return catalog;
    })();
    try { return await scanning; } finally { scanning = null; }
  }
  async function readPrivate(file) {
    // Resolve symlinks too: raw backups must never be placed under the web root.
    const real = await fs.realpath(file);
    if (!outsidePublic(real)) throw new BoardError('榜单来源配置不安全，请联系管理员');
    const before = await fs.stat(real);
    if (!before.isFile() || !before.size || before.size > MAX_BYTES || Date.now() - before.mtimeMs < 5000) {
      throw new BoardError('榜单文件尚未准备完成，请稍后重试');
    }
    const buffer = await fs.readFile(real);
    const after = await fs.stat(real);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new BoardError('榜单正在更新，请稍后重试');
    return buffer;
  }
  async function snapshot(entry) {
    const cached = cache.get(entry.date);
    if (cached && Date.now() - cached.time < CATALOG_TTL) return cached.rows;
    const [data, power] = await Promise.all([
      readPrivate(path.join(directory, entry.file)), readPrivate(powerLevels)
    ]);
    const rows = parseSnapshot(data, parsePowerLevels(power), excluded);
    cache.delete(entry.date);
    cache.set(entry.date, { rows, time: Date.now() });
    while (cache.size > 3) cache.delete(cache.keys().next().value);
    return rows;
  }
  return {
    async get({ date, metric = 'energy', page = 1 } = {}) {
      if ((date !== undefined && !validDate(date)) || !METRICS.includes(metric)
          || !Number.isSafeInteger(page) || page < 1) throw new BoardError('榜单查询参数不正确', 400);
      try {
        const available = await dates();
        if (!available.length) {
          if (date !== undefined) throw new BoardError('该日期暂无可查看的榜单', 404);
          return { dates: [], date: null, metric, rows: [], total: 0, page: 1, pages: 0 };
        }
        const entry = date === undefined ? available[0] : available.find(item => item.date === date);
        if (!entry) throw new BoardError('该日期暂无可查看的榜单', 404);
        const rows = [...await snapshot(entry)].sort((a, b) => b[metric] - a[metric]
          || a.name.localeCompare(b.name, 'zh-CN') || a.region.localeCompare(b.region, 'zh-CN'));
        let rank = 0;
        const ranked = rows.map((row, i) => {
          if (i === 0 || row[metric] !== rows[i - 1][metric]) rank = i + 1;
          return { rank, ...row };
        });
        const pages = Math.ceil(rows.length / 25);
        if (page > Math.max(1, pages)) throw new BoardError('榜单页码超出范围', 400);
        return { dates: available.map(item => item.date), date: entry.date, metric,
          total: rows.length, page, pages, rows: ranked.slice((page - 1) * 25, page * 25) };
      } catch (error) {
        if (error instanceof BoardError) throw error;
        // Never forward file paths or raw source content to visitors or logs.
        throw new BoardError('英雄榜暂时不可用，请稍后重试');
      }
    }
  };
}
module.exports = { createLeaderboard, parsePowerLevels, parseSnapshot, realmFor, validDate, METRICS };
