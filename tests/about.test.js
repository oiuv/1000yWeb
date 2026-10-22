'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');

const readPublic = name => readFileSync(path.join(__dirname, '../public', name), 'utf8');

test('about page and styles are public and its introduction does not require JavaScript', async t => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/about.html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.equal(html, readPublic('about.html'));
  assert.match(html, /<h1 id="about-title">关于云端千年<\/h1>/);
  assert.match(html, /唯一 GM 为<strong>秋林拾叶<\/strong>/);
  assert.match(html, /在保持原版玩法的基础上更新/);
  assert.match(html, /适合休闲游玩、追求长期稳定的玩家/);
  assert.match(html, /<dt>维护方向<\/dt><dd>休闲体验 · 长期稳定<\/dd>/);
  assert.doesNotMatch(html, /基本保持原版玩法|不魔改资源与玩法/);
  assert.equal((await fetch(base + '/css/about.css')).status, 200);
});

test('server timeline preserves the supplied dates and distinguishes reset from retained saves', () => {
  const html = readPublic('about.html');
  const history = html.slice(html.indexOf('class="about-timeline"'), html.indexOf('id="game-title"'));
  assert.deepEqual([...history.matchAll(/datetime="([^"]+)"/g)].map(match => match[1]), [
    '2013', '2014-10-10', '2016-06-27', '2017-05-01', '2022-02-25', '2023-07-28', '2025-10-10', '2026'
  ]);
  const entries = [...history.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1]);
  for (const entry of [entries[2], entries[5]]) {
    assert.match(entry, /临时停服，保留存档/);
    assert.match(entry, /服务器资源紧张/);
    assert.match(entry, /优先保障神武奇章稳定运营/);
  }
  assert.match(entries[3], /神武奇章清档重开/);
  assert.match(entries[3], /早期边测试边开放/);
  assert.match(entries[3], /利用 BUG 漏洞不当获取资源/);
  assert.match(entries[3], /待维护经验成熟、运营稳定后，应全体玩家要求/);
  assert.match(entries[3], /炎黄新章的停服存档仍然保留/);
  assert.match(entries[4], /炎黄新章恢复开放（保留存档）/);
  assert.match(entries[6], /炎黄新章再次恢复开放（保留存档）/);
  assert.doesNotMatch(html, /保留存档重开/);
  assert.match(entries[6], /经验由 1 倍调整为 10 倍/);
  assert.match(entries[7], /此前长期免费运营，虽有少量玩家捐助，但缺乏稳定收入支持服务器运维/);
  assert.match(entries[7], /可选择继续免费游玩/);
  assert.match(entries[7], /10 元\/月卡/);
  assert.match(entries[7], /适度收费支持服务器长期稳定运营/);
});

test('version guidance recommends Yanhuang and keeps gameplay overview short and player-facing', () => {
  const html = readPublic('about.html');
  const versions = html.slice(html.indexOf('class="panel about-versions"'), html.indexOf('class="panel about-history"'));
  assert.match(versions, /推荐选择 · 持续维护更新/);
  assert.match(versions, /2025 年 10 月 10 日恢复开放，保留原有存档/);
  assert.match(versions, /停止内容更新，仅维持服务器正常运行/);
  assert.match(versions, /href="register.html"/);
  assert.match(versions, /href="download.html#yanhuang"/);
  assert.match(versions, /href="download.html#shenwu"/);
  assert.equal([...html.matchAll(/<article>/g)].length, 3);
  assert.match(html, /武功与境界/);
  assert.match(html, /帝王陵、狐狸洞、极乐洞/);
  assert.match(html, /铸造师、炼丹师、工匠、裁缝/);
});

test('about page is discoverable and its local links and assets resolve', () => {
  assert.match(readPublic('index.html'), /href="about.html">了解云端千年/);
  assert.match(readPublic('index.html'), /在保持原版玩法的基础上更新，适合休闲游玩、追求长期稳定的玩家/);
  assert.match(readPublic('js/auth.js'), /href="about.html">关于云端/);
  const html = readPublic('about.html');
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const file = ref.split('#')[0];
    if (file) assert.ok(existsSync(path.join(__dirname, '../public', file)), ref);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
    assert.ok(ids.includes(id), id);
  }
});
