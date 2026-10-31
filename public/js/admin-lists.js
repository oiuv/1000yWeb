import { $, api, el, submit, message, toast } from './auth.js';

const statusLabels = {
  active: '有效', expired: '已到期', disabled: '已禁用', unknown: '待核查',
  trial: '不限时试用', unconfigured: '未配置', unavailable: '读取失败'
};
const modeLabels = { '000': '禁用', '001': '试用', '100': '包时', '200': 'IP 包时', '400': 'ID 计时' };
const dateText = value => value ? String(value).replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC') : '—';

export function expiryText(record) {
  if (record.status === 'disabled' || record.mode === '000') return '已禁用';
  if (record.status === 'trial') return '无固定到期日';
  if (!['active', 'expired'].includes(record.status)) return statusLabels[record.status] || '待核查';
  // Use the server's query-time duration, independent of the browser's clock and time zone.
  const seconds = record.remainingSeconds;
  if (!Number.isFinite(seconds)) return '—';
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds > 0 ? '即将到期' : '刚刚到期';
  const [unit, label] = [[365 * 86400, '年'], [86400, '天'], [3600, '小时'], [60, '分钟']]
    .find(([unit]) => absolute >= unit);
  const amount = label === '年' ? Math.round(absolute / unit * 10) / 10 : Math.floor(absolute / unit);
  const duration = (label === '年' ? '约' : '') + amount + label;
  return seconds > 0 ? duration + '后到期' : '已过期' + duration;
}

function paidBadge(status) {
  const known = Object.hasOwn(statusLabels, status) ? status : 'unknown';
  return el('span', 'badge paid-state ' + known, statusLabels[known]);
}
function addCell(row, label, content) {
  const cell = el('td'), value = el('div', 'cell-value');
  value.append(typeof content === 'string' ? document.createTextNode(content) : content);
  cell.append(el('span', 'cell-label', label), value); row.append(cell);
}
function emptyTable(table, columns, text) {
  const row = el('tr'), cell = el('td', 'empty-cell', text);
  cell.colSpan = columns; row.append(cell); table.querySelector('tbody').replaceChildren(row);
}
function renderUsers(records, onDisable) {
  const table = $('#users-table'), body = table.querySelector('tbody'); body.replaceChildren();
  if (!records.length) return emptyTable(table, 6, '暂无符合条件的注册账号');
  for (const user of records) {
    const row = el('tr'), characters = el('div', 'account-characters'), paid = el('div');
    addCell(row, '注册账号', user.account);
    for (const character of user.characters) {
      const entry = el('div', 'character-entry', character.name);
      if (character.region) entry.append(el('small', '', character.region));
      characters.append(entry);
    }
    if (!user.characters.length) characters.append(el('span', 'muted', '尚未创建角色'));
    addCell(row, '玩家角色', characters);
    addCell(row, '注册时间', dateText(user.registeredAt));
    addCell(row, '最后游戏时间', dateText(user.lastGameAt));
    paid.append(paidBadge(user.paid.status));
    if (user.paid.status === 'trial') paid.append(el('small', '', '无固定到期日'));
    else {
      const hint = ['active', 'expired'].includes(user.paid.status) ? '（' + expiryText(user.paid) + '）' : '';
      if (user.paid.mode) paid.append(el('small', hint ? 'expiry-hint' : '', (modeLabels[user.paid.mode] || '未知模式') + hint));
      if (user.paid.enddate) paid.append(el('small', '', dateText(user.paid.enddate)));
    }
    addCell(row, '付费状态 / 到期时间', paid);
    const button = el('button', 'button secondary compact', user.paid.status === 'disabled' ? '已禁用' : '禁用账号');
    button.type = 'button'; button.disabled = !user.canDisable;
    button.setAttribute('aria-label', '禁用账号 ' + user.account);
    if (!user.canDisable && user.paid.status !== 'disabled') button.title = '禁用功能暂不可用，请检查付费数据来源';
    button.addEventListener('click', () => onDisable(user.account));
    addCell(row, '操作', button); body.append(row);
  }
}
function renderPaid(records) {
  const table = $('#paid-table'), body = table.querySelector('tbody'); body.replaceChildren();
  if (!records.length) return emptyTable(table, 7, '暂无符合条件的付费记录');
  for (const record of records) {
    const row = el('tr'), mode = el('div', '', modeLabels[record.mode] || '未知模式');
    mode.append(el('small', '', record.mode || '—'));
    addCell(row, '游戏账号', record.account); addCell(row, '付费模式', mode);
    addCell(row, '当前状态', paidBadge(record.status)); addCell(row, '到期时间', dateText(record.enddate));
    addCell(row, '到期提示', el('span', 'expiry-hint', expiryText(record)));
    addCell(row, '建立记录时间', dateText(record.createdAt)); addCell(row, '最后更新时间', dateText(record.updatedAt));
    body.append(row);
  }
}

export function createAdminLists() {
  const lists = { users: { page: 1, pages: 1, ready: false, version: 0 }, paid: { page: 1, pages: 1, ready: false, version: 0 } };
  const dialog = $('#disable-dialog'), form = $('#disable-form'), cancelButton = $('#disable-cancel');
  let selectedAccount = null, disabling = false;
  function openDisable(account) {
    if (disabling) return;
    selectedAccount = account; form.reset(); message($('#disable-feedback'), '');
    $('#disable-account').textContent = account;
    dialog.showModal(); cancelButton.focus();
  }
  cancelButton.addEventListener('click', () => { if (!disabling) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (disabling) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!disabling) selectedAccount = null; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedAccount || disabling) return;
    const account = selectedAccount, reason = $('#disable-reason').value;
    disabling = true; cancelButton.disabled = true;
    try {
      await submit(form, async () => {
        let result;
        try { result = await api('/api/admin/users/disable', { body: { account, reason, confirmed: true } }); }
        catch (error) {
          await load('users');
          if (!error.status) error.message = '禁用结果未确认，请刷新账号状态后再决定是否重试';
          throw error;
        }
        selectedAccount = null; dialog.close(); toast(result.message);
        await load('users');
      });
    } finally { disabling = false; cancelButton.disabled = false; }
  });
  function updatePagination(kind, ready) {
    const list = lists[kind], prefix = '#' + kind;
    list.ready = ready;
    for (const action of ['first', 'prev']) $(prefix + '-' + action).disabled = !ready || list.page <= 1;
    for (const action of ['next', 'last']) $(prefix + '-' + action).disabled = !ready || list.page >= list.pages;
    const input = $(prefix + '-page-input');
    input.disabled = $(prefix + '-page-go').disabled = !ready || list.pages <= 1;
    if (ready) { input.value = String(list.page); input.max = String(list.pages); }
  }
  function goToPage(kind, page) {
    const list = lists[kind];
    if (!list.ready || !Number.isInteger(page) || page < 1 || page > list.pages || page === list.page) return;
    list.page = page;
    return load(kind);
  }
  function cancel(kind) {
    const list = lists[kind]; if (!list) return;
    list.version++; list.request?.abort();
    updatePagination(kind, false);
    $('#' + kind + '-panel').removeAttribute('aria-busy');
  }
  async function load(kind) {
    const list = lists[kind]; cancel(kind);
    const version = ++list.version, request = new AbortController(); list.request = request;
    const current = () => version === list.version && !request.signal.aborted;
    const prefix = '#' + kind;
    $(prefix + '-panel').setAttribute('aria-busy', 'true');
    $(prefix + '-state').textContent = '正在读取' + (kind === 'users' ? '注册账号' : '付费记录') + '…';
    $(prefix + '-page-info').textContent = '正在读取…';
    emptyTable($(prefix + '-table'), kind === 'paid' ? 7 : 6, '正在读取…');
    if (kind === 'users') $('#users-paid-notice').hidden = true;
    const params = new URLSearchParams(new FormData($(prefix + '-filter-form'))); params.set('page', list.page);
    try {
      const data = await api('/api/admin/' + (kind === 'users' ? 'users' : 'paid-users') + '?' + params, { signal: request.signal });
      if (!current()) return;
      list.pages = Math.max(1, data.pages);
      if (list.page > list.pages) { list.page = list.pages; return load(kind); }
      if (kind === 'users') renderUsers(data.records, openDisable);
      else renderPaid(data.records);
      $(prefix + '-state').textContent = '共 ' + data.total + (kind === 'users' ? ' 个符合条件的账号' : ' 条符合条件的付费记录');
      $(prefix + '-page-info').textContent = '第 ' + list.page + ' / ' + list.pages + ' 页 · 每页 ' + data.limit + ' 条';
      updatePagination(kind, true);
      if (kind === 'users' && data.paidAvailability !== 'available') {
        const notice = $('#users-paid-notice'); notice.hidden = false;
        notice.textContent = data.paidAvailability === 'unconfigured'
          ? '尚未配置付费数据来源，当前可查看账号和角色信息。'
          : '付费状态暂时无法读取，账号信息仍可查看；请稍后刷新重试。';
      }
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      $(prefix + '-state').textContent = error.message;
      $(prefix + '-page-info').textContent = '数据未加载';
      emptyTable($(prefix + '-table'), kind === 'paid' ? 7 : 6, '读取未完成，请点击“刷新数据”重试');
    } finally {
      if (current()) $(prefix + '-panel').removeAttribute('aria-busy');
    }
  }
  for (const kind of Object.keys(lists)) {
    const prefix = '#' + kind, form = $(prefix + '-filter-form');
    const search = () => { lists[kind].page = 1; return load(kind); };
    form.addEventListener('submit', event => { event.preventDefault(); return search(); });
    for (const select of form.querySelectorAll('select')) select.addEventListener('change', search);
    $(prefix + '-reset').addEventListener('click', () => { form.reset(); return search(); });
    $(prefix + '-first').addEventListener('click', () => goToPage(kind, 1));
    $(prefix + '-prev').addEventListener('click', () => goToPage(kind, lists[kind].page - 1));
    $(prefix + '-next').addEventListener('click', () => goToPage(kind, lists[kind].page + 1));
    $(prefix + '-last').addEventListener('click', () => goToPage(kind, lists[kind].pages));
    $(prefix + '-page-form').addEventListener('submit', event => {
      event.preventDefault();
      return goToPage(kind, Number($(prefix + '-page-input').value));
    });
  }
  return { load, cancel };
}
