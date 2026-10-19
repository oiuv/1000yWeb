export const state = { user: null, csrfToken: null };
export const statuses = { pending: '待审核', verified: '已核款', delivered: '已交付', rejected: '已拒绝' };
export const $ = selector => document.querySelector(selector);
export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function message(target, text, success = false) {
  target.textContent = text;
  target.className = 'form-feedback' + (success ? ' success' : '');
  target.hidden = !text;
}
export function toast(text, error = false) {
  document.querySelector('.toast')?.remove();
  const node = el('div', 'toast' + (error ? ' error' : ''), text);
  node.setAttribute('role', 'status');
  document.body.append(node);
  setTimeout(() => node.remove(), 6000);
}
export async function api(path, { body, ...options } = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken || '' }),
      ...options.headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('服务响应异常，请稍后再试'); }
  if (!response.ok) {
    const error = new Error(data.message || '操作失败');
    error.status = response.status; error.fields = data.errors;
    throw error;
  }
  return data;
}
export async function submit(form, action) {
  if (form.getAttribute('aria-busy') === 'true') return;
  const button = form.querySelector('[type="submit"]');
  const original = button.textContent;
  const feedback = form.querySelector('.form-feedback');
  message(feedback, '');
  button.disabled = true; button.textContent = '正在处理…';
  form.setAttribute('aria-busy', 'true');
  try { await action(); }
  catch (error) {
    message(feedback, error.message);
    if (error.fields?.[0]?.path) {
      const field = form.elements.namedItem(error.fields[0].path);
      if (field?.focus) field.focus();
    }
  } finally {
    button.disabled = false; button.textContent = original;
    form.removeAttribute('aria-busy');
  }
}
export async function init({ auth = false, admin = false } = {}) {
  $('#site-header').innerHTML =
    '<a class="skip-link" href="#main">跳转到正文</a><div class="header-inner">' +
    '<a class="brand" href="index.html" aria-label="云端千年首页"><span class="seal" aria-hidden="true">云<br>端</span>' +
    '<span><strong>云端千年</strong><small>炎黄新章 · 江湖未远</small></span></a>' +
    '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">菜单</button>' +
    '<nav class="site-nav" id="site-nav" aria-label="主导航">' +
    '<a href="index.html">首页</a><a href="recharge.html">充值登记</a>' +
    '<a href="https://1000y.gameivy.com/download.html" target="_blank" rel="noopener noreferrer">客户端下载 ↗</a>' +
    '<a href="https://1000y.gameivy.com/" target="_blank" rel="noopener noreferrer">游戏官网 ↗</a>' +
    '<span class="nav-auth" id="nav-auth"><a href="login.html">登录</a><a class="button compact" href="register.html">注册账号</a></span></nav></div>';
  $('#site-footer').innerHTML = '<div class="footer-inner"><span>云端千年 · 炎黄新章<span class="muted">　武林霸业谈笑中，不胜千年一场醉。</span></span>' +
    '<span><a href="https://1000y.gameivy.com/" target="_blank" rel="noopener noreferrer">游戏官网</a><span>玩家 QQ 群 · 2887111</span></span></div>';
  $('.nav-toggle').addEventListener('click', event => {
    const open = $('#site-nav').classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  for (const link of document.querySelectorAll('#site-nav a')) {
    const url = new URL(link.href);
    if (url.origin === location.origin && (url.pathname === location.pathname ||
        (location.pathname === '/' && link.getAttribute('href') === 'index.html'))) {
      link.setAttribute('aria-current', 'page');
    }
  }
  for (const toggle of document.querySelectorAll('.password-toggle')) {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.for);
      const show = input.type === 'password'; input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隐藏' : '显示';
      toggle.setAttribute('aria-label', (show ? '隐藏' : '显示') + input.labels[0].textContent);
      toggle.setAttribute('aria-pressed', String(show));
    });
  }
  for (const button of document.querySelectorAll('[data-copy-qq]')) {
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText('2887111'); toast('QQ群号已复制：2887111'); }
      catch { toast('玩家 QQ 群：2887111'); }
    });
  }
  for (const close of document.querySelectorAll('[data-close-dialog]')) {
    close.addEventListener('click', () => close.closest('dialog').close());
  }
  const session = await api('/api/auth/session');
  Object.assign(state, { user: session.user, csrfToken: session.csrfToken });
  if (auth && !state.user) {
    location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop()));
    return false;
  }
  if (admin && !state.user?.isAdmin) {
    location.replace('dashboard.html');
    return false;
  }
  if (state.user) {
    const nav = $('#nav-auth'); nav.replaceChildren();
    const link = el('a', '', state.user.isAdmin ? '管理中心' : '用户中心');
    link.href = state.user.isAdmin ? 'admin.html' : 'dashboard.html';
    nav.append(link);
    const logout = el('button','button subtle compact','退出');
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try { await api('/api/auth/logout', { body: {} }); location.href = 'login.html'; }
      catch (error) { toast(error.message, true); logout.disabled = false; }
    });
    nav.append(logout);
  }
  return true;
}
export function badge(status) {
  return el('span', 'badge ' + (Object.hasOwn(statuses, status) ? status : 'pending'), statuses[status] || '未知状态');
}
export function money(value) { return '¥' + Number(value).toFixed(2); }
export function timestamp(value, utc = false) {
  if (!value) return '暂无记录';
  if (!utc) return String(value).replace('T', ' ').slice(0,16);
  const date = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}
export function itemText(record) {
  return record.items.map(item => item + (record.quantities?.[item] ? ' ×' + record.quantities[item] : '（数量未记录）')).join('、');
}
export function renderTable(table, records, onOpen, admin = false) {
  const body = table.querySelector('tbody'); body.replaceChildren();
  if (!records.length) {
    const row = el('tr'), cell = el('td', 'empty-cell');
    cell.colSpan = admin ? 8 : 7;
    cell.append(el('strong','','暂无符合条件的登记记录'));
    row.append(cell); body.append(row); return;
  }
  for (const record of records) {
    const row = el('tr');
    const cells = [
      ['登记编号', '#' + record.id],
      ['付款时间 / 尾号', timestamp(record.payment_time), record.transaction_id],
      ['账号 / 角色', record.game_account, record.character_name + ' · ' + record.server],
      ['付款项', itemText(record)],
      ['金额', money(record.amount)],
      ['状态', badge(record.status)]
    ];
    if (admin) cells.push(['备注', record.remark || '—']);
    for (const [label, value, secondary] of cells) {
      const cell = el('td'), content = el('div','cell-value');
      cell.append(el('span','cell-label',label));
      content.append(value instanceof Node ? value : el('span', label === '金额' ? 'money' : '', value));
      if (secondary) content.append(el('small','',secondary));
      if (label === '备注') { content.title = record.remark || ''; content.classList.add('record-remark'); }
      cell.append(content); row.append(cell);
    }
    const cell = el('td'), button = el('button','button secondary compact', admin ? '详情 / 处理' : '查看详情');
    button.type = 'button'; button.setAttribute('aria-label', '查看登记 #' + record.id);
    button.addEventListener('click', () => onOpen(record));
    cell.append(el('span','cell-label','操作'),button); row.append(cell); body.append(row);
  }
}
export function recordDetails(container, record, admin = false) {
  container.replaceChildren();
  const detail = el('dl','profile-details');
  const fields = [
    ['登记编号','#' + record.id], ['游戏分区',record.server], ['游戏账号',record.game_account],
    ['角色名称',record.character_name], ['付款时间',timestamp(record.payment_time)],
    ['订单尾号',record.transaction_id], ['金额',money(record.amount)], ['付款项',itemText(record)],
    ['状态',badge(record.status)], ['玩家备注',record.remark || '无']
  ];
  if (admin) fields.push(['登记来源',record.submitted_by ? '登录账号：' + record.submitted_by : '未登录登记'], ['登记 IP',record.ip_address || '未记录']);
  if (record.paid) {
    fields.push(['付费时长',record.paid.days+' 天'], ['时长到账',record.paid.state==='done' ? '已到账，重登游戏生效' : '待确认到账，请联系 GM']);
    if(record.paid.state==='done') fields.push(['原到期时间',record.paid.old_enddate || '首次开户'], ['充值后到期时间',record.paid.enddate]);
    else if(admin) fields.push(['充值处理提示',record.paid.error || '任务已保存，可重试确认到账']);
  }
  for (const [label,value] of fields) {
    const dd=el('dd','record-remark');dd.append(value instanceof Node ? value : el('span','',value));
    detail.append(el('dt','',label),dd);
  }
  container.append(detail,el('h3','section-gap','处理记录'));
  if (!record.history.length) { container.append(el('p','muted small','暂无处理记录。历史登记保留原状态。')); return; }
  const history=el('ol','history');
  for(const entry of record.history) {
    const li=el('li','',timestamp(entry.created_at,true)+' · '+(statuses[entry.to_status] || entry.to_status));
    li.append(el('p','',entry.actor + (entry.note ? '：' + entry.note : '')));
    history.append(li);
  }
  container.append(history);
}
