'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');

const readPublic = name => readFileSync(path.join(__dirname, '../public', name), 'utf8');
const yanhuangDownloads = [
  'https://setup-simplified-chinese.1000y.download/1000y_Setup_20250410.exe',
  'https://setup-traditional-chinese.1000y.download/1000y_patch_update.zip',
  'https://setup-traditional-chinese.1000y.download/1000y_patch_ChineseSimp.zip',
  'https://oiuv.oss-accelerate.aliyuncs.com/1000y/1000yHClientPatch.zip'
];
const shenwuDownload = 'https://oiuv.oss-accelerate.aliyuncs.com/1000y/1000yClientPatch.zip';
const externalLinks = html => [...html.matchAll(/<a\b[^>]*href="(https:\/\/[^\"]+)"[^>]*>/g)];

test('download page and assets are public, with instructions present before JavaScript runs', async t => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/download.html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.equal(html, readPublic('download.html'));
  assert.match(html, /<h1>客户端下载<\/h1>/);
  assert.match(html, /<ol class="download-steps"/);
  assert.equal([...html.matchAll(/class="download-step-number"/g)].length, 5);
  for (const asset of ['css/style.css', 'css/download.css', 'js/home.js', 'js/auth.js']) {
    assert.equal((await fetch(base + '/' + asset)).status, 200, asset);
  }
});

test('Yanhuang has the four approved downloads in installation order and its own registration', () => {
  const html = readPublic('download.html');
  const section = html.slice(html.indexOf('id="yanhuang"'), html.indexOf('id="shenwu"'));
  assert.deepEqual(externalLinks(section).map(match => match[1]), yanhuangDownloads);
  assert.match(section, /云端补丁一定最后覆盖/);
  assert.match(section, /cl1000\.exe/);
  assert.match(section, /桌面的“千年肆”快捷方式/);
  assert.match(section, /自动更新并启动游戏/);
  assert.match(section, /href="register\.html">注册炎黄账号/);
  assert.match(section, /同一个游戏安装目录/);
});

test('Yanhuang guide covers only the four cloud additions and distinguishes when settings take effect', () => {
  const html = readPublic('download.html');
  const guide = html.slice(html.indexOf('id="client-guide"'), html.indexOf('id="shenwu"'));
  assert.equal([...guide.matchAll(/class="client-guide-card"/g)].length, 4);
  assert.match(guide, /游戏聊天框中输入，按回车执行/);
  assert.match(guide, /<kbd>Ctrl<\/kbd> \+ <kbd>F12<\/kbd>/);
  assert.match(guide, /<code>@@<\/code> 打开或关闭/);
  assert.match(guide, /关闭面板不等于停止辅助/);
  assert.match(guide, /“保存挂机”只保存设置，不会开始/);
  assert.match(guide, /“停止挂机”/);
  for (const size of ['640x480', '800x600', '1024x768']) {
    assert.ok(guide.includes('<code>@resolution ' + size + '</code>'));
  }
  assert.match(guide, /退出并重新启动客户端才会生效/);
  assert.match(guide, /窗口模式下按 <kbd>Ctrl<\/kbd> \+ <kbd>F11<\/kbd>/);
  assert.match(guide, /200%.*150%/);
  assert.match(guide, /缩放只把画面变大，不增加地图视野/);
  for (const fps of [30, 60, 120, 144]) {
    assert.ok(guide.includes('<code>@fps ' + fps + '</code>'));
  }
  assert.match(guide, /立即切换并保存，无需重启/);
  assert.match(guide, /<code>@fps<\/code> 查看设置上限与当前实际帧率/);
  assert.match(guide, /不会加快移动、攻击或吃药/);
  assert.doesNotMatch(guide, /Alt\+Enter|福袋分页|账号注册/);
});

test('Shenwu offers only its patch and explains its separate launcher and account registration', () => {
  const html = readPublic('download.html');
  const section = html.slice(html.indexOf('id="shenwu"'));
  assert.deepEqual(externalLinks(section).map(match => match[1]), [shenwuDownload]);
  assert.match(section, /神武版客户端/);
  assert.match(section, /云端千年\.exe/);
  assert.match(section, /快手直接注册账号/);
  assert.match(section, /两版本补丁不能混用/);
  assert.doesNotMatch(section, /href="register\.html"/);
});

test('site entry points stay on the new download page and external downloads protect the opener', () => {
  for (const name of ['js/auth.js', 'index.html', 'register.html']) {
    const content = readPublic(name);
    assert.match(content, /href="download\.html"/, name);
    assert.doesNotMatch(content, /https:\/\/1000y\.gameivy\.com\//, name);
  }
  assert.doesNotMatch(readPublic('js/auth.js'), />游戏官网(?: ↗)?<\/a>/);
  const links = externalLinks(readPublic('download.html'));
  assert.equal(links.length, 5);
  for (const [tag] of links) {
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
});
