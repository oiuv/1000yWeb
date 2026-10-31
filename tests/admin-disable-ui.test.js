'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// A small DOM double for request/cancel behavior; this does not test browser layout.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = new Map(); this.handlers = {}; this.value = ''; this.textContent = ''; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  async emit(name) {
    const event = { currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await Promise.all((this.handlers[name] || []).map(handler => handler(event))); return event;
  }
  find(predicate) { for (const node of this.children) { if (predicate(node)) return node; const child = node.find(predicate); if (child) return child; } return null; }
  querySelector(selector) {
    return this.find(node => selector === '[type="submit"]' ? node.type === 'submit' :
      selector.startsWith('.') ? (node.className || '').split(' ').includes(selector.slice(1)) : node.tagName === selector);
  }
  querySelectorAll() { return []; }
  reset() { const reason = this.find(node => node.tagName === 'textarea'); if (reason) reason.value = ''; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}
const response = data => ({ ok: true, status: 200, json: async () => data });
const page = disabled => ({ records: [{ account: 'demo01', characters: [], registeredAt: null, lastGameAt: null,
  paid: disabled ? { mode: '000', status: 'disabled' } : { mode: '001', status: 'trial', enddate: null }, canDisable: !disabled }],
  total: 1, pages: 1, limit: 20, hasMore: false, paidAvailability: 'available' });
async function ui(t, fetch) {
  const nodes = new Map(), body = new Element('body');
  const node = (id, tag = 'div') => { const item = new Element(tag); nodes.set('#' + id, item); return item; };
  for (const kind of ['users', 'paid']) {
    for (const suffix of ['panel', 'state', 'page-info', 'prev', 'next', 'reset']) node(kind + '-' + suffix);
    node(kind + '-filter-form', 'form'); node(kind + '-table', 'table').append(new Element('tbody'));
  }
  node('users-paid-notice'); const dialog = node('disable-dialog', 'dialog');
  node('disable-account'); const form = node('disable-form', 'form');
  const feedback = node('disable-feedback'); feedback.className = 'form-feedback';
  const reason = node('disable-reason', 'textarea'), cancel = node('disable-cancel', 'button');
  const submit = new Element('button'); submit.type = 'submit'; submit.textContent = '确认禁用';
  form.append(feedback, reason, submit, cancel);
  const replacements = { document: { body, createElement: tag => new Element(tag),
    createTextNode: text => Object.assign(new Element('text'), { textContent: text }),
    querySelector: selector => nodes.get(selector) || body.querySelector(selector) },
  FormData: class { constructor() { return new Map([['limit', '20']]); } }, fetch };
  for (const [key, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args) => originalTimer(...args).unref());
  const { createAdminLists } = await import('../public/js/admin-lists.js');
  const lists = createAdminLists();
  const action = () => nodes.get('#users-table').find(element => element.tagName === 'button');
  return { lists, nodes, dialog, form, feedback, reason, cancel, submit, action };
}

test('cancel makes no write; duplicate submit and escape cannot interrupt an in-flight disable', async t => {
  let posts = 0, banned = false, complete, sent;
  const state = await ui(t, async (url, options) => {
    if (options.method !== 'POST') return response(page(banned));
    posts++; sent = JSON.parse(options.body);
    return new Promise(resolve => { complete = () => { banned = true; resolve(response({ success: true, message: '账号已禁用' })); }; });
  });
  await state.lists.load('users'); await state.action().emit('click');
  assert.equal(state.dialog.open, true); assert.equal(state.cancel.focused, true);
  await state.cancel.emit('click'); assert.equal(state.dialog.open, false); assert.equal(posts, 0);
  await state.action().emit('click'); state.reason.value = '违规核查';
  const pending = state.form.emit('submit');
  await state.form.emit('submit');
  assert.equal(posts, 1); assert.deepEqual(sent, { account: 'demo01', confirmed: true, reason: '违规核查' });
  assert.equal(state.cancel.disabled, true); assert.equal(state.submit.disabled, true);
  assert.equal((await state.dialog.emit('cancel')).defaultPrevented, true);
  complete(); await pending;
  assert.equal(state.dialog.open, false); assert.equal(state.action().disabled, true);
  assert.equal(state.action().textContent, '已禁用');
});

test('lost disable response refreshes status without claiming success or automatically sending again', async t => {
  let posts = 0, banned = false;
  const state = await ui(t, async (url, options) => {
    if (options.method !== 'POST') return response(page(banned));
    posts++; banned = true; throw new TypeError('synthetic lost response');
  });
  await state.lists.load('users'); await state.action().emit('click'); await state.form.emit('submit');
  assert.equal(posts, 1); assert.equal(state.dialog.open, true);
  assert.match(state.feedback.textContent, /结果未确认/);
  assert.equal(state.action().disabled, true); assert.equal(state.cancel.disabled, false);
});

test('late user-list response cannot replace a refreshed disabled account with a stale trial row', async t => {
  let calls = 0, release;
  const state = await ui(t, async () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : response(page(true)));
  const old = state.lists.load('users'); await state.lists.load('users');
  release(response(page(false))); await old;
  assert.equal(state.action().disabled, true); assert.equal(state.action().textContent, '已禁用');
});
