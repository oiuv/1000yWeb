import { $, api, el, submit, message, toast } from './auth.js';

const statusLabels = {
  active: '有效', expired: '已到期', disabled: '已禁用', unknown: '待核查',
  trial: '不限时试用', unconfigured: '未配置', unavailable: '读取失败'
};
const modeLabels = { '000': '禁用', '001': '试用', '100': '包时', '200': 'IP 包时', '400': 'ID 计时' };
const dateText = value => value ? String(value).replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC') : '—';

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
      if (user.paid.mode) paid.append(el('small', '', modeLabels[user.paid.mode] || '未知模式'));
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
  if (!records.length) return emptyTable(table, 6, '暂无符合条件的付费记录');
  for (const record of records) {
    const row = el('tr'), mode = el('div', '', modeLabels[record.mode] || '未知模式');
    mode.append(el('small', '', record.mode || '—'));
    addCell(row, '游戏账号', record.account); addCell(row, '付费模式', mode);
    addCell(row, '当前状态', paidBadge(record.status)); addCell(row, '到期时间', dateText(record.enddate));
    addCell(row, '建立记录时间', dateText(record.createdAt)); addCell(row, '最后更新时间', dateText(record.updatedAt));
    body.append(row);
  }
}

export function createAdminLists() {
  const lists = { users: { page: 1, version: 0 }, paid: { page: 1, version: 0 } };
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
  function cancel(kind) {
    const list = lists[kind]; if (!list) return;
    list.version++; list.request?.abort();
    $('#' + kind + '-panel').removeAttribute('aria-busy');
  }
  async function load(kind) {
    const list = lists[kind]; cancel(kind);
    const version = ++list.version, request = new AbortController(); list.request = request;
    const current = () => version === list.version && !request.signal.aborted;
    const prefix = '#' + kind;
    $(prefix + '-prev').disabled = true; $(prefix + '-next').disabled = true;
    $(prefix + '-panel').setAttribute('aria-busy', 'true');
    $(prefix + '-state').textContent = '正在读取' + (kind === 'users' ? '注册账号' : '付费记录') + '…';
    $(prefix + '-page-info').textContent = '正在读取…';
    emptyTable($(prefix + '-table'), 6, '正在读取…');
    if (kind === 'users') $('#users-paid-notice').hidden = true;
    const params = new URLSearchParams(new FormData($(prefix + '-filter-form'))); params.set('page', list.page);
    try {
      const data = await api('/api/admin/' + (kind === 'users' ? 'users' : 'paid-users') + '?' + params, { signal: request.signal });
      if (!current()) return;
      if (list.page > Math.max(1, data.pages)) { list.page = Math.max(1, data.pages); return load(kind); }
      if (kind === 'users') renderUsers(data.records, openDisable);
      else renderPaid(data.records);
      $(prefix + '-state').textContent = '共 ' + data.total + (kind === 'users' ? ' 个符合条件的账号' : ' 条符合条件的付费记录');
      $(prefix + '-page-info').textContent = '第 ' + list.page + ' / ' + Math.max(1, data.pages) + ' 页 · 每页 ' + data.limit + ' 条';
      $(prefix + '-prev').disabled = list.page <= 1; $(prefix + '-next').disabled = !data.hasMore;
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
      emptyTable($(prefix + '-table'), 6, '读取未完成，请点击“刷新数据”重试');
    } finally {
      if (current()) $(prefix + '-panel').removeAttribute('aria-busy');
    }
  }
  for (const kind of Object.keys(lists)) {
    const prefix = '#' + kind, form = $(prefix + '-filter-form');
    const search = () => { lists[kind].page = 1; load(kind); };
    form.addEventListener('submit', event => { event.preventDefault(); search(); });
    for (const select of form.querySelectorAll('select')) select.addEventListener('change', search);
    $(prefix + '-reset').addEventListener('click', () => { form.reset(); search(); });
    $(prefix + '-prev').addEventListener('click', () => { lists[kind].page--; load(kind); });
    $(prefix + '-next').addEventListener('click', () => { lists[kind].page++; load(kind); });
  }
  return { load, cancel };
}
