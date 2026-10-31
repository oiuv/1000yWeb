'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fixture } = require('./helpers');
const root = path.join(__dirname, '../public');
const read = file => readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('data/guide-manifest.json'));
const index = JSON.parse(read('data/guide-search.json'));

test('all reference articles are public static pages, readable without client rendering', async t => {
  const { base } = await fixture(t);
  assert.equal(manifest.articles.length, 122);
  assert.equal(new Set(manifest.articles.map(a => a.file)).size, 122);
  assert.equal(index.length, 122);
  assert.deepEqual(readdirSync(root).filter(file => /^guide-.*\.html$/.test(file)).sort(),
    manifest.articles.map(a => a.file).sort());
  for (const file of ['guide.html', manifest.articles[0].file, 'css/guide.css', 'css/item-icons.css', 'images/item.png', 'data/guide-search.json']) {
    const response = await fetch(base + '/' + file);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    if (file.endsWith('.html')) assert.equal(await response.text(), read(file));
    else await response.arrayBuffer();
  }
  assert.match(read('guide.html'), /122 篇资料/);
  assert.equal([...read('guide.html').matchAll(/data-guide-entry=/g)].length, 122);
  for (const { file } of manifest.articles) {
    assert.match(read(file), /<article class="guide-article">[\s\S]+<\/article>/);
    assert.ok(index.some(a => a.id === file));
  }
});

test('all generated local article links, anchors, styles and scripts resolve', () => {
  for (const file of ['guide.html', ...manifest.articles.map(a => a.file)]) {
    const html = read(file);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, file + ' duplicate IDs');
    assert.doesNotMatch(html, /(?:onerror|onclick|onload|style)=|<script(?! type="module" src=)/i);
    for (const [, raw] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^https?:/.test(raw)) continue;
      const url = new URL(raw.replace(/&amp;/g, '&'), 'http://local/' + file);
      const target = decodeURIComponent(url.pathname.slice(1));
      assert.ok(existsSync(path.join(root, target)), file + ' -> ' + raw);
      if (url.hash && target.endsWith('.html')) {
        assert.ok(read(target).includes('id="' + decodeURIComponent(url.hash.slice(1)) + '"'), file + ' -> ' + raw);
      }
    }
  }
  assert.match(read('js/auth.js'), /href="guide.html">游戏资料/);
  assert.match(read('index.html'), /href="guide.html">翻阅江湖藏书/);
});

test('shared navigation puts guides after home and about after downloads', () => {
  const source = read('js/auth.js');
  const nav = source.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0];
  const footer = source.match(/<div class="footer-inner">[\s\S]*?<\/div>/)[0];
  const links = html => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links(nav), [
    'index.html', 'guide.html', 'leaderboard.html', 'recharge.html',
    'download.html', 'about.html', 'login.html', 'register.html'
  ]);
  assert.deepEqual(links(footer), ['guide.html', 'download.html', 'about.html']);
});

test('item icons prefer display names and retain a representative image for repeated names', async () => {
  const { buildItemIcons, renderArticle } = await import('../lib/guide-content.mjs');
  const icons = buildItemIcons([
    { Name: '明珠内部', ViewName: ' 太极明珠 ', Shape: '209' },
    { Name: '太极明珠', ViewName: '另一物品', Shape: '10' },
    { Name: '葫芦1', ViewName: '葫芦', Shape: '214' },
    { Name: '收了魂的葫芦1', ViewName: '葫芦', Shape: '216' },
    { Name: '葫芦2', ViewName: '葫芦', Shape: '214' },
    { Name: '仅内部名称', ViewName: '', Shape: '0' },
    { Name: '无图号', ViewName: '忽略项', Shape: '' },
    { Name: '无效图号', ViewName: '忽略项', Shape: '-1' }
  ], 736);
  assert.equal(icons['太极明珠'], 209);
  assert.equal(icons['明珠内部'], 209);
  assert.equal(icons['另一物品'], 10);
  assert.equal(icons['葫芦'], 214);
  assert.equal(icons['收了魂的葫芦1'], 216);
  assert.equal(icons['仅内部名称'], 0);
  assert.equal(Object.hasOwn(icons, '忽略项'), false);
  assert.equal(Object.hasOwn(icons, '未知物品'), false);
  assert.throws(() => buildItemIcons([{ Name: '越界', Shape: '736' }], 736), /缺少编号 736/);
  const rendered = renderArticle('示例.md',
    '# 示例\n\n## 太极明珠\n\n| 物品 |\n| --- |\n| 葫芦 |\n| 仅内部名称 |\n| 未知物品 |\n',
    new Set(['示例.md']), icons);
  assert.match(rendered.html, /icon-209/);
  assert.match(rendered.html, /icon-214/);
  assert.match(rendered.html, /icon-0/);
  assert.match(rendered.html, /<td>未知物品<\/td>/);
});

test('reference renderer retains facts and tables, rewrites internal links and decorates exact icon names', async () => {
  const { renderArticle, articleFile } = await import('../lib/guide-content.mjs');
  const source = '新手入门/【装备】简介/示例.md';
  const other = '新手入门/【装备】简介/另页.md';
  const markdown = '# 示例\n\n## 黄龙弓\n\n原始数值 80，不按本服改写。\n\n| 名称 | 属性 |\n| --- | ---: |\n| 黄龙弓 | 80<br>恢复 10 |\n| 未知物品 | — |\n\n[另页](另页.md)\n\n## 黄龙弓\n\n末尾正文仍保留。';
  const result = renderArticle(source, markdown, new Set([source, other]), { 黄龙弓: 134 });
  assert.match(result.html, /原始数值 80，不按本服改写/);
  assert.match(result.html, /80<br>恢复 10/);
  assert.match(result.html, /scope="col" class="text-right"|class="text-right" scope="col"/);
  assert.match(result.html, /class="item-icon icon-134"/);
  assert.ok(result.html.includes('href="' + articleFile(other) + '"'));
  assert.match(result.html, /id="黄龙弓-1"/);
  assert.match(result.html, /末尾正文仍保留/);
  assert.doesNotMatch(result.html, /<h1/);
  assert.equal(result.category, 'equipment');
  assert.equal(result.toc.length, 2);
  assert.match(result.text, /未知物品/);
});

test('equipment attributes and acquisition notes stay under their equipment, not in the contents', () => {
  const counts = {
    帝王陵: 13, 黑白龙系列: 10, 狐狸洞: 9, 黄龙系列: 13, 极乐洞: 14,
    技能武器: 50, 技能装备: 50, 普通武器: 10, 青铜系列: 5, 太极剑门: 12, 重返王陵: 29
  };
  const sectionsBySeries = new Map();
  for (const [series, count] of Object.entries(counts)) {
    const source = manifest.articles.find(a => a.source.endsWith('/【装备】简介：' + series + '.md'));
    assert.ok(source, series);
    const html = read(source.file);
    const body = html.match(/<article class="guide-article">([\s\S]*?)<\/article>/)[1];
    const sections = [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2 |<div class="guide-source">)/g)];
    assert.equal(sections.length, count, series);
    const toc = html.match(/<nav class="guide-toc"[\s\S]*?<\/nav>/)[0];
    assert.equal([...toc.matchAll(/<li class="h2">/g)].length, count, series);
    for (const [, id, heading, content] of sections) {
      assert.doesNotMatch(heading, /◎|(?:身体|头|手|腿)(?:破坏|防御)\(|名称 能力值/);
      assert.match(content, /<li><strong>◎属性<\/strong>/, series + '/' + id);
      assert.ok(toc.includes('href="#' + id + '"'), series + '/' + id);
    }
    sectionsBySeries.set(series, new Map(sections.map(([, id, , content]) => [id, content])));
  }
  const emperor = sectionsBySeries.get('帝王陵');
  assert.match(emperor.get('新罗宝剑'), /◎属性<\/strong> 恢复\(5\) 闪躲\(10\) 身体破坏\(100\)<\/li>/);
  assert.match(emperor.get('桂林竹枪'), /◎属性<\/strong> 速度\(5\) 身体破坏\(100\)<\/li>/);
  assert.match(emperor.get('磐龙斧'), /◎属性<\/strong> 速度\(5\) 恢复\(10\) 身体破坏\(100\)<\/li>/);
  assert.match(emperor.get('黄金铠甲'), /◎属性<\/strong> 闪躲\(10\) 身体防御\(80\)<\/li>/);
  assert.match(emperor.get('桂林竹枪'), /◎取得<\/strong> 放置于王冠盒子和桂林竹枪盒子内/);
  const revisited = sectionsBySeries.get('重返王陵');
  assert.match(revisited.get('百炼桂林竹枪'), /身体攻击:182 头攻击:72 手攻击:72 腿攻击:109 攻击速度:8 恢复:5 命中:10/);
  assert.match(revisited.get('百炼桂林竹枪'), /◎品系<\/strong> 3/);
  assert.doesNotMatch(revisited.get('桂林大斧'), /◎品系|◎取得/);
});

test('Taiji quest reference keeps eligibility, regions and stages in their correct hierarchy', () => {
  const source = manifest.articles.find(a => a.source === '新手入门/版本介绍/太极剑门介绍.md');
  assert.ok(source);
  const html = read(source.file);
  const body = html.match(/<article class="guide-article">([\s\S]*?)<\/article>/)[1];
  const headings = [...body.matchAll(/<(h[2-4]) id="[^"]+">([^<]+)<\/h[2-4]>/g)].map(([, level, title]) => [level, title]);
  assert.deepEqual(headings, [
    ['h2', '1、太极剑门入洞资格'], ['h2', '2、太极剑门的构成'],
    ['h3', '太极剑门外部（剑堂）'], ['h3', '太极剑门内部（石棺洞）'],
    ['h4', '1、陷阱地带'], ['h4', '2、太极广场'], ['h4', '3、机关区'], ['h4', '4、太极密室']
  ]);
  const eligibility = body.match(/<ol>([\s\S]*?)<\/ol>/)[1];
  assert.equal([...eligibility.matchAll(/<li>/g)].length, 2);
  assert.match(eligibility, /游戏中年龄到达40岁/);
  assert.match(eligibility, /点燃入口外的五个火炉/);
  assert.match(eligibility, /强度达到3\[指向同一火炉连射三箭\]/);
  assert.doesNotMatch(body, /<li>(?:[a-b]\.|[1-4]、)|<li><strong>说明/);
  assert.match(body, /两分钟的时间限制/);
});

test('Wangling introduction links to the complete crafting reference without duplicating it', () => {
  const articles = ['重返王陵材料加工', '重返王陵介绍'].map(title => {
    const source = manifest.articles.find(a => a.source === '新手入门/版本介绍/' + title + '.md');
    assert.ok(source, title);
    return source;
  });
  const [body, introduction] = articles.map(article =>
    read(article.file).match(/<article class="guide-article">([\s\S]*?)<\/article>/)[1]);
  assert.ok(body.includes('>（二）、添加物品属性</h2>'));
  assert.match(body, />1、道具说明<\/h3>\r?\n<p>除了王陵神器加工/);
  assert.match(body, />2、增加属性的方法说明<\/h3>\r?\n<p>增加物品属性/);
  assert.ok(body.includes('>3、各种装备品系划分</h3>'));
  assert.equal([...body.matchAll(/<blockquote>/g)].length, 2);
  assert.equal([...body.matchAll(/<th scope="col">等级<\/th>/g)].length, 4);
  assert.doesNotMatch(body, /<li>(?:（[一二三1-3]）|[1-6]、|三、)/);
  for (const title of ['（1）灵符', '（2）饰品', '（3）卷轴']) {
    assert.ok(body.includes('>' + title + '</h4>'));
  }
  assert.equal([...body.matchAll(/<table>/g)].length, 10);
  assert.match(body, />属性物品获取汇总<\/h2>/);
  for (const title of ['灵符', '饰品', '卷轴']) {
    assert.ok(body.includes('>' + title + '</h3>'));
  }
  assert.match(introduction, />三、全新的加工体系<\/h2>/);
  assert.ok(introduction.includes('href="' + articles[0].file + '">重返王陵材料加工</a>'));
  assert.doesNotMatch(introduction, /<table>/);
});

test('source HTML and unsafe URLs cannot become executable markup', async () => {
  const { renderArticle } = await import('../lib/guide-content.mjs');
  const result = renderArticle('测试.md',
    '# 测试\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[恶意](javascript:alert(3))\n\n文字<br>换行',
    new Set(['测试.md']));
  assert.doesNotMatch(result.html, /<script|<img|href="javascript:/i);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /文字<br>换行/);
});

test('guide structure validation catches broken headings, lists, encoding and table columns', async () => {
  const { validateGuideMarkdown: check } = await import('../lib/guide-validation.mjs');
  assert.deepEqual(check('# 测试\n\n## 章节\n\n### 小节\n\n- 正文\n\n| 名称 | 数值 |\n| --- | --- |\n| 转义\\|竖线 | 100 |\n'), []);
  for (const markdown of [
    '# 测试\n\n### 跳级', '# 测试\n\n# 第二个一级标题',
    '# 测试\n\n- 1、误排步骤', '# 测试\n\n-没有空格',
    '# 测试\n\n## 身体破坏(100)', '\uFEFF# 测试',
    '# 测试\r\n', '# 测试\n\n\uFFFD',
    '# 测试\n\n| 名称 | 数值 |\n| --- | --- |\n| 少了一列 |',
    '# 测试\n\n| 名称 | 数值 |\n| --- | --- |\n| 多了 | 一 | 列 |'
  ]) assert.ok(check(markdown).length, markdown);
  assert.deepEqual(check('# 测试\n\n~~~text\n-示例不是列表\n### 示例不是标题\n~~~\n\n## 正文\n'), []);
  assert.equal(check('# 测试\n\n### 跳级')[0].line, 3);
});

test('all article heading levels and rendered text retain a readable document structure', () => {
  for (const { file } of manifest.articles) {
    const body = read(file).match(/<article class="guide-article">([\s\S]*?)<\/article>/)[1];
    let previous = 1;
    for (const [, number] of body.matchAll(/<h([2-6])\b/g)) {
      assert.ok(Number(number) <= previous + 1, file + ' heading jump');
      previous = Number(number);
    }
    assert.doesNotMatch(body, /<li>(?:\d+\\?[、。]|[ivx]+\.)/);
    assert.doesNotMatch(body, /<h[2-6][^>]*>(?:◎|(?:身体|头|手|腿)(?:破坏|防御)\()/);
    assert.doesNotMatch(body, /\uFFFD/);
  }
});

test('skill levels, quest steps, profession groups and medicine recipes render separately', () => {
  const body = suffix => {
    const article = manifest.articles.find(a => a.source.endsWith(suffix));
    assert.ok(article, suffix);
    return read(article.file).match(/<article class="guide-article">([\s\S]*?)<\/article>/)[1];
  };
  for (const kind of ['拳法', '剑法', '刀法', '枪法', '槌法']) {
    const html = body('绝世武功介绍（' + kind + '）.md');
    for (const level of [1, 2, 3]) {
      assert.equal([...html.matchAll(new RegExp('>满' + level + '级</h3>', 'g'))].length, 2);
    }
    assert.equal([...html.matchAll(/<th scope="col">身体防御<\/th>/g)].length, 3);
    assert.equal([...html.matchAll(/<th scope="col">身体破坏<\/th>/g)].length, 3);
  }
  assert.match(body('绝世武功介绍（枪法）.md'), /元气:14 21/); // Ambiguous source value is not guessed.
  assert.match(body('绝世武功介绍（拳法）.md'), />未标注列<\/th>/);
  const quests = body('【炎黄新章】介绍——绿林峡谷任务.md');
  assert.equal([...quests.matchAll(/<h2 /g)].length, 3);
  assert.equal([...quests.matchAll(/>附加信息：<\/h3>/g)].length, 3);
  for (const name of ['疾速靴', '噬月刀', '九转金丹']) {
    assert.ok(quests.includes('<td>' + name + ' ×1</td>'), name + ' reward table');
    assert.ok(quests.includes('获得' + name + ' ×1。'), name + ' quest steps');
  }
  assert.doesNotMatch(quests, /噬月刀1把|九转金丹1个/);
  assert.equal([...body('神武奇章任务浅谈.md').matchAll(/<ol>/g)].length, 5);
  assert.equal([...body('【职业技能】简介：职业之工匠.md').matchAll(/<h2 /g)].length, 4);
  const medicine = body('【炎黄新章】介绍——新增草药和药品.md');
  assert.equal([...medicine.matchAll(/<table>/g)].length, 2);
  assert.equal([...medicine.matchAll(/<tbody>/g)].length, 2);
  for (const name of ['聚仙丹', '凝神丸', '石刁粉', '云术散', '金刚丹', '神力丸']) {
    assert.match(medicine, new RegExp(name + '</td>'));
  }
});

test('reference topics are grouped by content while original titles remain intact', async () => {
  const { categoryFor, plainTitle } = await import('../lib/guide-content.mjs');
  assert.equal(categoryFor('新手入门/炎黄新章/【炎黄新章】介绍——绿林峡谷装备.md'), 'equipment');
  assert.equal(categoryFor('新手入门/炎黄新章/【炎黄新章】介绍——采集技能介绍.md'), 'craft');
  assert.equal(categoryFor('新手入门/炎黄新章/【炎黄新章】介绍——新增草药和药品.md'), 'items');
  assert.equal(plainTitle('【职业技能】简介'), '职业技能入门');
  assert.equal(plainTitle('【怪物】简介（新手村）'), '怪物：新手村');
});

test('guild stone coordinates use a descriptive title and belong to gameplay systems', () => {
  const article = manifest.articles.find(a => a.source === '新手入门/【门派】简介/【门派】门派石坐标.md');
  assert.ok(article);
  const entry = index.find(a => a.id === article.file);
  assert.equal(entry.title, '【门派】门派石坐标');
  assert.equal(entry.category, 'systems');
  const html = read(article.file);
  assert.match(html, /<h1>【门派】门派石坐标<\/h1>/);
  assert.match(html, /guide.html\?category=systems">玩法系统/);
  assert.equal([...html.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)].length, 1);
  const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const cells = [...table.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, ''));
  assert.deepEqual(cells, [
    '河马石', '700，519', '巨象石', '662，246', '金鸡石', '653，757',
    '人龙石', '529，679', '花窟石', '821，626', '玉猿石', '652，704',
    '玉蟾石', '383，622', '玉犬石', '255，222', '血陵石', '570，312', '血狮石', '395，388'
  ]);
  assert.match(html, /<th scope="col">坐标<\/th>/);
  assert.match(html, /门主加入成员名单/);
  assert.doesNotMatch(html, /创建落点示例|建派后门石位置|创建时使用中间一列/);
  const basics = read('guide.html').match(/<section class="guide-category" data-guide-category="basics"[\s\S]*?<\/section>/)[0];
  assert.ok(!basics.includes(article.file));
});

test('cloud guide includes current beginner rewards, crafting and shops in pages and search', () => {
  const article = manifest.articles.find(a => a.source === '云端千年.md');
  assert.ok(article);
  const html = read(article.file);
  const entry = index.find(a => a.id === article.file);
  assert.ok(entry);
  assert.ok(read('guide.html').includes(article.file));
  for (const heading of ['新手挑战奖励', '墨铁衣服制造', '留香花卉', '门派守卫']) {
    assert.ok(html.includes('id="' + heading + '"'));
    assert.ok(html.includes('href="#' + heading + '"'));
    assert.ok(entry.text.includes(heading));
  }
  for (const text of ['男子天桃甲或女子天桃甲 ×1', '金元 ×1', '裁缝', '初级工', '100 万钱币', '留香蓝彼岸花']) {
    assert.ok(html.includes(text), text);
    assert.ok(entry.text.includes(text), text + ' searchable');
  }
  const crafting = html.match(/<h2 id="墨铁衣服制造">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1];
  const cells = [...crafting.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, ''));
  assert.deepEqual(cells, [
    '男子墨铁战斗服', '10 品', '犀牛王角 ×1、熊掌 ×1、白老虎指甲 ×1',
    '女子墨铁战斗服', '10 品', '犀牛王后角 ×1、熊掌 ×1、白老虎指甲 ×1',
    '男子墨铁弓服', '9 品', '男子墨铁战斗服 ×1、火心 ×1、龟甲 ×1',
    '女子墨铁弓服', '9 品', '女子墨铁战斗服 ×1、火心 ×1、龟甲 ×1'
  ]);
  const equipment = manifest.articles.find(a => a.source === '新手入门/【装备】简介/【装备】简介：新手村装备.md');
  assert.ok(equipment);
  const equipmentHtml = read(equipment.file);
  assert.match(equipmentHtml, /裁缝初级工/);
  assert.ok(equipmentHtml.includes('href="' + article.file + '#' + encodeURIComponent('墨铁衣服制造') + '"'));
  assert.doesNotMatch(equipmentHtml, /墨铁弓服属于7品|需要技能工才能制作/);
});

test('age guide retains all 100 rows, year conversions, contents and searchable text', () => {
  const article = manifest.articles.find(a => a.source === '新手入门/角色成长/年龄增长表.md');
  assert.ok(article);
  const html = read(article.file);
  const entry = index.find(a => a.id === article.file);
  assert.ok(entry);
  assert.equal(entry.category, 'basics');
  assert.ok(read('guide.html').includes(article.file));
  for (const heading of ['增长规则', '在线时间对照表']) {
    assert.ok(html.includes('id="' + heading + '"'));
    assert.ok(html.includes('href="#' + heading + '"'));
  }
  assert.match(html, /累计在线折合年/);
  assert.ok(entry.text.includes('累计在线折合年'));
  const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell));
  assert.equal(rows.length, 100);
  assert.ok(rows.every(row => row.length === 4));
  assert.deepEqual(rows.map(row => row[0]), [
    ...Array.from({ length: 99 }, (_, i) => String(i + 1)), '99.99'
  ]);
  assert.equal(rows[1][2], '&lt;0.01');
  for (const [age, time, years] of [
    ['70', '1120天 21:39:00', '3.07'], ['80', '2969天 11:08:04', '8.14'],
    ['90', '6628天 22:27:55', '18.16'], ['99.99', '12552天 13:07:13', '34.39']
  ]) {
    assert.deepEqual(rows.find(row => row[0] === age).slice(0, 3), [age, time, years]);
    assert.ok(entry.text.includes(time));
    assert.ok(entry.text.includes(years));
  }
});

test('cloud guide publishes ice and fire map rules and equipment lists in pages and search', () => {
  const article = manifest.articles.find(a => a.source === '云端千年.md');
  const html = read(article.file);
  const entry = index.find(a => a.id === article.file);
  const section = html.match(/<h2 id="冰火地图与装备属性">([\s\S]*?)(?=<h2 )/)[1];
  assert.ok(html.includes('href="#冰火地图与装备属性"'));
  for (const text of ['活力上限', '实际穿戴', '竹筒', '万毒门', '不属于冰火环境',
    '本馆', '黄金沙漠', '北海雪原', '黄龙溪谷', '血皇城', '血皇塔一层',
    '血皇塔二层', '血皇塔三层', '血皇塔顶', '护国神拳', '护国神剑', '百炼四季甲胄',
    '耀月拳套', '冷月剑', '圆月斧', '撼日刀', '追日枪', '女子月光护腕', '女子逐日靴', '男子披星帽']) {
    assert.ok(section.includes(text), text);
    assert.ok(entry.text.includes(text), text + ' searchable');
  }
  const tables = [...section.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(([, body]) =>
    [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
      [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, ''))));
  assert.deepEqual(tables.map(rows => rows.length), [2, 9, 7, 3]);
  assert.deepEqual(tables[1][0], ['本馆', '冰', '8 秒', '活力上限的 20%']);
  assert.deepEqual(tables[1][1], ['黄金沙漠', '火', '10 秒', '30.00 点']);
  for (const [column, count] of [[1, 19], [2, 20]]) {
    assert.equal(tables[2].flatMap(row => row[column].split('、')).length, count);
  }
  assert.deepEqual(tables[3], [
    ['女子月光护腕', '女', '冰，抗炎热'],
    ['女子逐日靴', '女', '火，抗严寒'],
    ['男子披星帽', '男', '火，抗严寒']
  ]);
  assert.match(section, /全系列仍有耐久，可与玩家交换，不可升段/);
  assert.doesNotMatch(section, /SpecialItemType|ARR_WEAPON|覆盖优先级|检查顺序/);
});

test('cloud guide keeps gem gift trading and reward restrictions concise in pages and search', () => {
  const article = manifest.articles.find(a => a.source === '云端千年.md');
  const html = read(article.file);
  const entry = index.find(a => a.id === article.file);
  const section = html.match(/<h2 id="宝石福袋">([\s\S]*?)(?=<h2 )/)[1];
  for (const text of ['珍珠、翡翠、水晶、琥珀各一颗', '四个物品栏空格',
    '宝石福袋可交易', '开启后获得的四种宝石仍不可交易']) {
    assert.ok(section.includes(text), text);
    assert.ok(entry.text.includes(text), text + ' searchable');
  }
  assert.doesNotMatch(section, /宝石福袋不可交易|用于交换装备或物品/);
});

test('search supports all categories, full text, multiple literal terms and empty results', async () => {
  const { filterGuides, categories } = await import('../public/js/guide-search.mjs');
  assert.equal(categories.length, 9);
  const entries = index.map(e => ({ ...e, text: e.title + ' ' + e.text }));
  assert.equal(filterGuides(entries).length, 122);
  assert.equal(filterGuides(entries, '  ', 'unknown').length, 122);
  const matches = filterGuides(entries, '英雄铠甲', 'equipment');
  assert.ok(matches.length >= 1);
  assert.ok(matches.every(e => e.category === 'equipment' && e.text.includes('英雄铠甲')));
  assert.ok(filterGuides(entries, '黄龙 弓').length > 0);
  assert.deepEqual(filterGuides(entries, '<script>不存在的文字'), []);
  assert.deepEqual(filterGuides(entries, '.*全匹配测试'), []);
  assert.equal(filterGuides([{ category: 'skills', text: 'F5 切换' }], 'f5').length, 1);
});

test('complete sprite is preserved and every displayed icon has a valid zero-based cell', () => {
  const png = readFileSync(path.join(root, 'images/item.png'));
  assert.equal(png.readUInt32BE(16), manifest.sprite.width);
  assert.equal(png.readUInt32BE(20), manifest.sprite.height);
  assert.equal(createHash('sha256').update(png).digest('hex'), manifest.sprite.sha256);
  assert.equal(manifest.sprite.columns, 8);
  assert.equal(manifest.sprite.cell, 120);
  assert.equal(manifest.sprite.cells, manifest.sprite.width * manifest.sprite.height / 120 ** 2);
  const css = read('css/item-icons.css');
  assert.equal([...css.matchAll(/\.icon-\d+ \{/g)].length, manifest.sprite.cells);
  let decorated = 0;
  for (const { file } of manifest.articles) {
    for (const [, id] of read(file).matchAll(/class="item-icon icon-(\d+)"/g)) {
      assert.ok(Number(id) < manifest.sprite.cells);
      assert.ok(css.includes('.icon-' + id + ' {'));
      decorated++;
    }
  }
  assert.ok(decorated > 200, 'expected icons across equipment and item reference pages');
  assert.match(css, /\.icon-0 \{ background-position:0px 0px;/);
  assert.match(css, /\.icon-8 \{ background-position:0px -72px;/);
});
