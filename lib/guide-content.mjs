import { createHash } from 'node:crypto';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { categoryLabels } from '../public/js/guide-search.mjs';

const posix = path.posix;
export const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
export const articleFile = source => 'guide-' + createHash('sha256').update(source).digest('hex').slice(0, 12) + '.html';
const sourceUrl = source => 'https://github.com/oiuv/1000yDocs/blob/master/help/' +
  ['炎黄新章游戏资料', ...source.split('/')].map(encodeURIComponent).join('/');
export function categoryFor(source, title = '') {
  if (source.startsWith('职业技能/')) return 'craft';
  if (source.includes('/炎黄新章/')) {
    if (/装备/.test(source)) return 'equipment';
    if (/怪物/.test(source)) return 'monsters';
    if (/草药|药品/.test(source)) return 'items';
    if (/采集/.test(source)) return 'craft';
    if (/绿林峡谷|任务/.test(source)) return 'quests';
  }
  for (const [part, category] of [
    ['武功介绍', 'skills'], ['【装备】简介', 'equipment'], ['【物品】简介', 'items'],
    ['【怪物】简介', 'monsters'], ['【NPC】简介', 'npc'], ['任务介绍', 'quests'],
    ['地图介绍', 'quests'], ['【门派】简介', 'systems'], ['炎黄新章', 'systems']
  ]) if (source.includes('/' + part + '/')) return category;
  return /门派/.test(title) ? 'systems' : 'basics';
}
export function plainTitle(title) {
  return title.replace(/^【([^】]+)】简介$/, '$1入门')
    .replace(/^【([^】]+)】简介[：: ]?/, '$1：').replace(/：（(.+)）$/, '：$1')
    .replace(/^【炎黄新章】介绍——/, '').replace(/^官网装备资料：/, '官网装备：');
}
const slug = text => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

export function buildItemIcons(items, iconCount) {
  const displayNames = new Map(), internalNames = new Map();
  for (const item of items) {
    const value = String(item.Shape ?? '').trim();
    if (!/^\d+$/.test(value)) continue;
    const shape = Number(value);
    if (shape >= iconCount) throw new Error('物品图集缺少编号 ' + shape);
    for (const [names, raw] of [[displayNames, item.ViewName], [internalNames, item.Name]]) {
      const name = String(raw ?? '').trim();
      // A reference picture represents a name, not a unique item record.
      if (name && !names.has(name)) names.set(name, shape);
    }
  }
  // Public display names take precedence over internal identifiers.
  return Object.fromEntries([...internalNames, ...displayNames]);
}

export function renderArticle(source, markdown, sources, icons = {}) {
  const md = new MarkdownIt({ html: true });
  // Preserve source line breaks without executing embedded HTML.
  md.renderer.rules.html_inline = (tokens, i) => /^<br\s*\/?>$/i.test(tokens[i].content) ? '<br>' : escape(tokens[i].content);
  md.renderer.rules.html_block = (tokens, i) => escape(tokens[i].content);
  md.renderer.rules.table_open = () => '<div class="guide-table" tabindex="0" role="region" aria-label="资料表格"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  for (const type of ['th_open', 'td_open']) {
    md.renderer.rules[type] = (tokens, i, options, env, self) => {
      const token = tokens[i], alignment = token.attrGet('style')?.match(/^text-align:(left|right|center)$/)?.[1];
      if (alignment) {
        token.attrs = token.attrs.filter(([key]) => key !== 'style');
        token.attrJoin('class', 'text-' + alignment);
      }
      if (type === 'th_open') token.attrSet('scope', 'col');
      return self.renderToken(tokens, i, options);
    };
  }
  const tokens = md.parse(markdown, {});
  const firstHeading = tokens.findIndex(t => t.type === 'heading_open' && t.tag === 'h1');
  const title = firstHeading >= 0 ? tokens[firstHeading + 1].content : posix.basename(source, '.md');
  const toc = [], used = new Set();
  let inTable = false;
  const icon = name => {
    const shape = Object.hasOwn(icons, name.trim()) ? icons[name.trim()] : null;
    return Number.isInteger(shape) ? '<span class="item-icon icon-' + shape + '" aria-hidden="true"></span>' : '';
  };
  const rewriteLink = href => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
    const [pathname, fragment = ''] = href.split('#');
    const target = posix.normalize(posix.join(posix.dirname(source), decodeURIComponent(pathname)));
    if (sources.has(target)) return articleFile(target) + (fragment ? '#' + fragment : '');
    if (target === 'README.md') return 'guide.html';
    const publicPath = posix.normalize(posix.join('help/炎黄新章游戏资料', target));
    return 'https://github.com/oiuv/1000yDocs/blob/master/' +
      publicPath.split('/').map(encodeURIComponent).join('/') + (fragment ? '#' + fragment : '');
  };
  function prependIcon(token, name) {
    const picture = icon(name);
    if (!picture) return;
    const decoration = new token.constructor('html_inline', '', 0);
    decoration.content = picture; decoration.meta = { icon: true };
    token.children.unshift(decoration);
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const text = tokens[i + 1].content;
      const base = slug(text) || 'section';
      let id = base, suffix = 1;
      while (used.has(id)) id = base + '-' + suffix++;
      used.add(id); token.attrSet('id', id);
      if (token.tag === 'h2' || token.tag === 'h3') toc.push({ id, text, level: token.tag });
      prependIcon(tokens[i + 1], text);
    }
    if (token.type === 'table_open') inTable = true;
    if (token.type === 'table_close') inTable = false;
    if (inTable && token.type === 'inline' && tokens[i - 1]?.type === 'td_open') prependIcon(token, token.content);
    for (const child of token.children || []) {
      if (child.type === 'link_open') child.attrSet('href', rewriteLink(child.attrGet('href')));
    }
  }
  const safeHtml = md.renderer.rules.html_inline;
  md.renderer.rules.html_inline = (tokens, i, ...args) => tokens[i].meta?.icon ? tokens[i].content : safeHtml(tokens, i, ...args);
  if (firstHeading >= 0) tokens.splice(firstHeading, 3); // H1 is provided by the page shell.
  const text = tokens.filter(t => t.type === 'inline').map(t => t.content.replace(/<br\s*\/?>/gi, ' ')).join(' ');
  return { title, html: md.renderer.render(tokens, md.options, {}), toc, text, category: categoryFor(source, title), source };
}

function shell(title, description, body, script = 'js/home.js') {
  return [
    '<!DOCTYPE html>', '<html lang="zh-CN">', '<head>', '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="description" content="' + escape(description) + '">',
    '<title>' + escape(title) + ' · 云端千年游戏资料</title>',
    '<link rel="stylesheet" href="css/style.css">', '<link rel="stylesheet" href="css/guide.css">',
    '<link rel="stylesheet" href="css/item-icons.css">', '</head>', '<body data-nav="guide.html">',
    '<header class="site-header" id="site-header"></header>', '<main class="container" id="main">',
    body, '</main>', '<footer class="site-footer" id="site-footer"></footer>',
    '<script type="module" src="' + script + '"></script>', '</body>', '</html>', ''
  ].join('\n');
}
export function articlePage(article) {
  const { title, category, toc, html, source } = article;
  const nav = toc.length ? '<ol>' + toc.map(h => '<li class="' + h.level + '"><a href="#' +
    escape(h.id) + '">' + escape(h.text) + '</a></li>').join('') + '</ol>' : '<p class="muted small">本篇资料为完整表格或短文。</p>';
  return shell(plainTitle(title), '炎黄新章游戏参考资料：' + plainTitle(title), [
    '<div class="breadcrumb"><a href="index.html">首页</a> / <a href="guide.html">游戏资料</a> / <a href="guide.html?category=' + category + '">' + categoryLabels[category] + '</a></div>',
    '<div class="guide-heading"><div><span class="eyebrow">江湖藏书 · ' + categoryLabels[category] + '</span><h1>' + escape(title) + '</h1></div></div>',
    '<div class="guide-layout"><nav class="guide-toc" aria-label="本页目录"><h2>本页目录</h2>' + nav + '<a class="guide-back" href="guide.html?category=' + category + '">← 返回' + categoryLabels[category] + '</a></nav>',
    '<article class="guide-article">', html,
    '<div class="guide-source">游戏通用参考资料。本服特色与调整另行说明。<a href="' + sourceUrl(source) + '" target="_blank" rel="noopener noreferrer">查看资料原文</a></div>',
    '<div class="guide-related"><a class="button secondary" href="guide.html?category=' + category + '">同类资料</a><a class="button subtle" href="guide.html">全部资料</a></div>',
    '</article></div>'
  ].join('\n'));
}
export function indexPage(articles) {
  const filters = Object.entries(categoryLabels).map(([id, label]) => '<button type="button" data-guide-filter="' + id + '" aria-pressed="false">' + label + '</button>').join('\n');
  const groups = Object.entries(categoryLabels).map(([id, label]) => {
    const entries = articles.filter(a => a.category === id);
    if (!entries.length) return '';
    return '<section class="guide-category" data-guide-category="' + id + '" aria-labelledby="' + id + '-title">' +
      '<div class="guide-category-header"><h2 id="' + id + '-title">' + label + '</h2><span>' + entries.length + ' 篇资料</span></div>' +
      '<div class="guide-entry-grid">' + entries.map(a => '<article class="guide-entry" data-guide-entry="' + articleFile(a.source) + '"><a href="' + articleFile(a.source) + '"><h3>' + escape(plainTitle(a.title)) + '</h3><span class="guide-read">阅读资料 →</span></a></article>').join('\n') + '</div></section>';
  }).join('\n');
  return shell('游戏资料', '炎黄新章游戏参考资料，涵盖武功、装备、物品、怪物、NPC、地图任务、门派与职业技能。', [
    '<div class="breadcrumb"><a href="index.html">首页</a> / 游戏资料</div>',
    '<div class="guide-heading"><div><span class="eyebrow">炎黄新章 · 江湖藏书</span><h1>游戏资料</h1><p>查一件装备，寻一门武功，读一段江湖往事。' + articles.length + ' 篇资料，按主题随时翻阅。</p></div><span class="guide-mark" aria-hidden="true">知其道<br>行江湖</span></div>',
    '<form class="guide-filters" id="guide-filters" role="search" hidden>',
    '<div class="guide-search-row"><div class="field"><label for="guide-search">搜索资料标题</label><input type="search" id="guide-search" name="q" placeholder="例如：黄龙、掌风、铸造师" autocomplete="off"></div><button class="button secondary" type="button" data-guide-reset>重置筛选</button></div>',
    '<div class="guide-categories" role="group" aria-label="资料分类"><button type="button" data-guide-filter="" aria-pressed="true">全部资料</button>' + filters + '</div>',
    '<p class="guide-result-count" id="guide-count" role="status" aria-live="polite"></p></form>',
    '<noscript><p class="notice">可直接按分类阅读全部资料；启用 JavaScript 后可以搜索和筛选。</p></noscript>',
    '<div class="panel empty-state" id="guide-empty" hidden><strong>没有找到相关资料</strong><p>试试缩短关键词，或切换到全部分类。</p><button class="button secondary" type="button" data-guide-reset>查看全部资料</button></div>',
    groups, '<p class="muted small">本栏收录游戏通用参考资料，本服特色与调整另行说明。</p>'
  ].join('\n'), 'js/guide.js');
}
