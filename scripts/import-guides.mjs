import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { articleFile, renderArticle, articlePage, indexPage, buildItemIcons } from '../lib/guide-content.mjs';
import { validateGuideMarkdown } from '../lib/guide-validation.mjs';

// A maintenance command, not a deployment/build step. Source files are read-only.
const [sourceArg, spriteArg, itemsArg] = process.argv.slice(2);
if (!sourceArg || !spriteArg || !itemsArg) {
  console.error('用法: node scripts/import-guides.mjs <游戏资料目录> <item.png> <Item.sdb>');
  process.exit(1);
}
const root = path.resolve(sourceArg);
const output = fileURLToPath(new URL('../public/', import.meta.url));
function list(dir = '') {
  return readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? list(path.posix.join(dir, entry.name)) :
      entry.name.endsWith('.md') ? [path.posix.join(dir, entry.name)] : []);
}
function csv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (ch === '\n') { rows.push(row); row = []; }
    } else value += ch;
  }
  if (quoted) throw new Error('物品表中存在未闭合的 CSV 引号');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const headings = rows.shift();
  return rows.filter(r => r[0]).map(r => Object.fromEntries(headings.map((h, i) => [h, r[i] || ''])));
}
const sprite = readFileSync(spriteArg);
if (!sprite.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('图集必须是 PNG');
const width = sprite.readUInt32BE(16), height = sprite.readUInt32BE(20), cell = 120;
if (width !== cell * 8 || height % cell) throw new Error('需要 8 列、每格 120×120 的物品图集');
const iconCount = width / cell * height / cell;
const icons = buildItemIcons(csv(new TextDecoder('gbk', { fatal: true }).decode(readFileSync(itemsArg))), iconCount);
const documents = list().sort((a, b) => a.localeCompare(b, 'zh-CN'));
const contents = new Map(documents.map(source => [
  source, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path.join(root, source)))
]));
const issues = documents.flatMap(source => validateGuideMarkdown(contents.get(source))
  .map(issue => source + ':' + issue.line + ' ' + issue.message));
if (issues.length) throw new Error('资料格式校验失败：\n' + issues.join('\n'));
const sources = documents.filter(source => path.posix.basename(source) !== 'README.md');
const sourceSet = new Set(sources);
const articles = sources.map(source => {
  const markdown = contents.get(source);
  return { ...renderArticle(source, markdown, sourceSet, icons), digest: createHash('sha256').update(markdown).digest('hex') };
});
// Finish parsing and validation before writing generated content.
mkdirSync(path.join(output, 'data'), { recursive: true });
for (const article of articles) writeFileSync(path.join(output, articleFile(article.source)), articlePage(article), 'utf8');
writeFileSync(path.join(output, 'guide.html'), indexPage(articles), 'utf8');
writeFileSync(path.join(output, 'data/guide-search.json'), JSON.stringify(articles.map(a => ({
  id: articleFile(a.source), title: a.title, category: a.category, text: a.text
}))) + '\n', 'utf8');
writeFileSync(path.join(output, 'data/guide-manifest.json'), JSON.stringify({
  articles: articles.map(a => ({ source: a.source, file: articleFile(a.source), sha256: a.digest })),
  sprite: { width, height, cell, columns: 8, cells: iconCount, sha256: createHash('sha256').update(sprite).digest('hex') }
}, null, 2) + '\n', 'utf8');
copyFileSync(spriteArg, path.join(output, 'images/item.png'));
const shown = 72;
const css = ['/* Generated from the complete item.png sprite; Shape is zero-based. */',
  '.item-icon { display:inline-block;width:72px;height:72px;flex-shrink:0;vertical-align:middle;margin:0 10px 4px 0;border-radius:4px;background-color:#080808;background-image:url("../images/item.png");background-repeat:no-repeat;background-size:' + width * shown / cell + 'px ' + height * shown / cell + 'px; }',
  '.guide-table .item-icon { display:block; }'];
for (let i = 0; i < iconCount; i++) css.push('.icon-' + i + ' { background-position:' + -(i % 8) * shown + 'px ' + -Math.floor(i / 8) * shown + 'px; }');
writeFileSync(path.join(output, 'css/item-icons.css'), css.join('\n') + '\n', 'utf8');
console.log('已生成 ' + articles.length + ' 篇完整资料、全文检索索引及 ' + iconCount + ' 格物品图集样式。');
