'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, registration } = require('./helpers');

test('qi bundles preserve package quantities through registration, filtering, correction and manual delivery', async t => {
  const { client } = await fixture(t);
  const player = client(), admin = client();
  await player.login(); await admin.login('admin01');
  const data = registration({ items: ['真气珠'], quantities: { 真气珠: 1 }, amount: 200 });
  const created = await player.request('/api/recharge/submit', data);
  assert.equal(created.code, 201);
  assert.equal((await player.request('/api/recharge/submit', data)).code, 409);
  const id = created.data.id;
  const mine = (await player.request('/api/recharge/mine')).data.records[0];
  assert.deepEqual(mine.items, ['真气珠']);
  assert.deepEqual(mine.quantities, { 真气珠: 1 });
  assert.equal(mine.status, 'pending');
  const filtered = await admin.request('/api/admin/recharge-records?item=' + encodeURIComponent('真气珠'));
  assert.equal(filtered.code, 200);
  assert.deepEqual(filtered.data.records.map(record => record.id), [id]);
  assert.equal((await player.request('/api/admin/recharge-records?item=' + encodeURIComponent('真气珠'))).code, 403);
  const approval = { id, status: 'verified', expectedStatus: 'pending', note: '核对为两份，共200个真气珠', quantities: { 真气珠: 2 } };
  assert.equal((await player.request('/api/admin/update-status', approval)).code, 403);
  assert.equal((await admin.request('/api/admin/update-status', approval)).code, 200);
  const verified = (await player.request('/api/recharge/mine')).data.records[0];
  assert.deepEqual(verified.quantities, { 真气珠: 2 });
  assert.equal(verified.paid, null);
  assert.equal(verified.status, 'verified');
  assert.ok(verified.history.some(entry => entry.note.includes('真气珠：1 → 2')));
  assert.equal((await admin.request('/api/admin/update-status', { id, status: 'delivered', expectedStatus: 'verified', note: '已人工交付200个真气珠' })).code, 200);
  assert.equal((await player.request('/api/recharge/mine')).data.records[0].status, 'delivered');
});

test('qi bundle quantities reject invalid, duplicated and unknown items, and accept the 99-package limit', async t => {
  const { client, db } = await fixture(t);
  const player = client(); await player.login();
  const data = registration({ items: ['真气珠'], quantities: { 真气珠: 1 }, amount: 100 });
  for (const quantities of [{}, { 真气珠: 0 }, { 真气珠: -1 }, { 真气珠: 1.5 }, { 真气珠: 100 }, { 真气珠: '1' }, { 真气珠: 1, 福袋: 1 }]) {
    assert.equal((await player.request('/api/recharge/submit', { ...data, quantities })).code, 400);
  }
  for (const items of [['真气珠', '真气珠'], ['不存在'], ['月卡','年卡','福袋','宝石','真气珠','不存在']]) {
    assert.equal((await player.request('/api/recharge/submit', { ...data, items })).code, 400);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM recharge_records').get().n, 0);
  assert.equal((await player.request('/api/recharge/submit', { ...data, quantities: { 真气珠: 99 }, amount: 9900 })).code, 201);
  assert.deepEqual((await player.request('/api/recharge/mine')).data.records[0].quantities, { 真气珠: 99 });
});

test('record labels preserve legacy keys and distinguish qi package count from individual beads', async () => {
  const { itemText } = await import('../public/js/auth.js');
  assert.equal(itemText({ items: ['福袋', '宝石', '真气珠'], quantities: { 福袋: 5, 宝石: 1, 真气珠: 2 } }),
    '储物福袋 ×5、宝石福袋 ×1、真气珠（100 个／份） ×2');
  assert.equal(itemText({ items: ['福袋'] }), '储物福袋（数量未记录）');
  const { previewPlan } = await import('../public/js/recharge-plan.js');
  assert.equal(previewPlan(registration({ items: ['真气珠'], quantities: { 真气珠: 2 }, amount: 200 })), null);
  assert.equal(previewPlan(registration({ items: ['月卡', '真气珠'], quantities: { 月卡: 1, 真气珠: 2 }, amount: 210 })).days, 30);
});
