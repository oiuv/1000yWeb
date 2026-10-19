import { $, el, api, init, message, toast } from './auth.js';

const labels = { energy: '元气', age: '年龄', virtue: '浩然正气', inPower: '内功', outPower: '外功', magic: '武功', wealth: '财富值（钱币）', profession: '熟练度' };
let metric = 'energy', selectedDate, page = 1, job = '1', requestId = 0, controller;
const initial = new URLSearchParams(location.search);
if (initial.has('date')) selectedDate = initial.get('date');
if (Object.hasOwn(labels, initial.get('metric'))) metric = initial.get('metric');
if (/^[1-4]$/.test(initial.get('job'))) job = initial.get('job');
$('#board-job').value = job;

function render(data) {
  const selector = $('#board-date');
  selector.replaceChildren();
  for (const date of data.dates) {
    const option = el('option', '', date + (date === data.dates[0] ? ' · 最新' : ''));
    option.value = date; selector.append(option);
  }
  selectedDate = data.date || undefined;
  if (data.date) selector.value = data.date;
  else selector.append(el('option', '', '暂无每日存档'));
  selector.disabled = !data.dates.length;
  const isProfession = metric === 'profession';
  const title = isProfession ? '职业榜 · ' + $('#board-job').selectedOptions[0].textContent
    : metric === 'wealth' ? '富豪榜' : labels[metric] + '榜';
  $('#board-summary').textContent = data.date ? `${data.date} · ${title} · ${data.total} 位侠士` : '暂无可查看的每日存档';
  $('#board-value-title').textContent = labels[metric];
  $('#board-level-title').textContent = isProfession ? '职业等级' : '境界';
  const body = $('#board-rows'); body.replaceChildren();
  if (!data.rows.length) {
    const row = el('tr'), cell = el('td', 'empty-cell', '本期暂无参与排名的角色');
    cell.colSpan = 6; row.append(cell); body.append(row);
  }
  for (const record of data.rows) {
    const row = el('tr');
    const score = metric === 'wealth' ? record.wealth.toLocaleString('zh-CN')
      : (record[metric] / 100).toFixed(2) + (metric === 'age' ? ' 岁' : '');
    const cells = [['名次', String(record.rank)], ['江湖名号', record.name], ['门派', record.guild || '—'],
      ['职业', record.jobName || '—'], [isProfession ? '职业等级' : '境界', isProfession ? record.jobGrade : record.realm],
      [labels[metric], score]];
    for (const [index, [label, text]] of cells.entries()) {
      const cell = el('td'), value = el('span', 'cell-value', text);
      if (index === 0) value.classList.add('board-rank', ...(record.rank <= 3 ? ['board-leading'] : []));
      if (index === 1) { value.classList.add('board-name'); if (record.region) value.append(el('small', '', record.region)); }
      if (index === 5) value.classList.add('board-value');
      cell.append(el('span', 'cell-label', label), value); row.append(cell);
    }
    body.append(row);
  }
  $('#board-pagination').hidden = data.pages < 2;
  $('#board-page').textContent = `第 ${data.page} / ${data.pages} 页 · 每页 25 位`;
  $('#board-prev').disabled = data.page <= 1;
  $('#board-next').disabled = data.page >= data.pages;
  const params = new URLSearchParams();
  if (data.date) params.set('date', data.date);
  if (metric !== 'energy') params.set('metric', metric);
  if (isProfession) params.set('job', job);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
}
async function load() {
  controller?.abort(); controller = new AbortController();
  const id = ++requestId;
  $('#board-results').setAttribute('aria-busy', 'true');
  $('#board-summary').textContent = '正在读取每日存档…';
  $('#board-job-filter').hidden = metric !== 'profession';
  $('#board-rows').replaceChildren(); $('#board-pagination').hidden = true;
  message($('#board-error'), '');
  for (const button of document.querySelectorAll('[data-metric]')) {
    const active = button.dataset.metric === metric;
    button.classList.toggle('secondary', !active); button.setAttribute('aria-pressed', String(active));
  }
  const params = new URLSearchParams({ metric, page });
  if (metric === 'profession') params.set('job', job);
  if (selectedDate !== undefined) params.set('date', selectedDate);
  try {
    const data = await api('/api/leaderboard?' + params, { signal: controller.signal });
    if (id === requestId) render(data);
  } catch (error) {
    if (error.name === 'AbortError' || id !== requestId) return;
    $('#board-summary').textContent = '本次榜单未能加载';
    if ($('#board-date').disabled) $('#board-date').replaceChildren(el('option', '', '暂无可用日期'));
    message($('#board-error'), error.message);
    const retry = el('button', 'button secondary compact', '返回最新一期');
    retry.type = 'button'; retry.addEventListener('click', () => { selectedDate = undefined; page = 1; load(); });
    $('#board-error').append(' ', retry);
  } finally {
    if (id === requestId) $('#board-results').setAttribute('aria-busy', 'false');
  }
}
$('#board-date').addEventListener('change', event => { selectedDate = event.target.value; page = 1; load(); });
$('#board-job').addEventListener('change', event => { job = event.target.value; page = 1; load(); });
for (const button of document.querySelectorAll('[data-metric]')) {
  button.addEventListener('click', () => { metric = button.dataset.metric; page = 1; load(); });
}
$('#board-prev').addEventListener('click', () => { page--; load(); });
$('#board-next').addEventListener('click', () => { page++; load(); });
init().catch(error => toast(error.message, true));
load();
