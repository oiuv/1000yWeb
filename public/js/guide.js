import { init, toast } from './auth.js';
import { categories, filterGuides } from './guide-search.mjs';

const search = document.getElementById('guide-search');
const controls = document.getElementById('guide-filters');
const buttons = [...document.querySelectorAll('[data-guide-filter]')];
const groups = [...document.querySelectorAll('[data-guide-category]')];
const entries = [...document.querySelectorAll('[data-guide-entry]')].map(node => ({
  node, category: node.closest('[data-guide-category]').dataset.guideCategory,
  text: node.textContent + ' ' + (node.dataset.keywords || '')
}));
let category = '';

function update(writeUrl = true) {
  const matched = new Set(filterGuides(entries, search.value, category));
  for (const entry of entries) entry.node.hidden = !matched.has(entry);
  for (const group of groups) group.hidden = !entries.some(entry => matched.has(entry) && group.contains(entry.node));
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.guideFilter === category));
  document.getElementById('guide-count').textContent = '找到 ' + matched.size + ' 条资料';
  document.getElementById('guide-empty').hidden = matched.size > 0;
  if (writeUrl) {
    const url = new URL(location.href);
    if (search.value.trim()) url.searchParams.set('q', search.value.trim()); else url.searchParams.delete('q');
    if (category) url.searchParams.set('category', category); else url.searchParams.delete('category');
    history.replaceState(null, '', url);
  }
}
function readUrl() {
  const params = new URLSearchParams(location.search);
  search.value = params.get('q') || '';
  category = categories.includes(params.get('category')) ? params.get('category') : '';
  update(false);
}
search.addEventListener('input', () => update());
controls.addEventListener('submit', event => { event.preventDefault(); update(); });
for (const button of buttons) button.addEventListener('click', () => {
  category = button.dataset.guideFilter;
  update();
});
for (const button of document.querySelectorAll('[data-guide-reset]')) button.addEventListener('click', () => {
  search.value = ''; category = ''; update(); search.focus();
});
window.addEventListener('popstate', readUrl);
readUrl();
controls.hidden = false;
fetch('data/guide-search.json')
  .then(response => {
    if (!response.ok) throw new Error('资料正文搜索暂不可用');
    return response.json();
  })
  .then(index => {
    const content = new Map(index.map(entry => [entry.id, entry.text]));
    for (const entry of entries) entry.text += ' ' + (content.get(entry.node.dataset.guideEntry) || '');
    document.querySelector('label[for="guide-search"]').textContent = '搜索资料标题或正文';
    update(false);
  })
  .catch(() => toast('资料正文搜索暂不可用，仍可按标题搜索或分类阅读'));
// Reading and searching remain available even if the optional account session fails.
init().catch(error => toast(error.message, true));
