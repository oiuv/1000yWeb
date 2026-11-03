'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paidPlan } = require('../lib/products');
const { registration } = require('./helpers');

test('browser preview matches backend prices, normalization and rejection boundaries', async () => {
  const { previewPlan } = await import('../public/js/recharge-plan.js');
  const samples = [];
  for (const [item, price] of [['月卡',10],['年卡',100]]) {
    for (let quantity=1;quantity<=99;quantity++) {
      samples.push(registration({items:[item],amount:quantity*price,quantities:{[item]:1}}));
    }
    for (const amount of [0,price-0.01,price+0.01,price*1.5,price*100]) {
      samples.push(registration({items:[item],amount,quantities:{[item]:1}}));
    }
  }
  for (const server of ['炎黄新章','神武奇章']) {
    for (const quantities of [{月卡:2,年卡:1,福袋:1},{月卡:0,年卡:1,福袋:1},{月卡:1},{月卡:20,年卡:1,福袋:1}]) {
      samples.push(registration({server,items:['月卡','年卡','福袋'],amount:170,quantities}));
    }
  }
  samples.push(registration({items:['福袋'],quantities:{福袋:1}}));
  for (const sample of samples) {
    let expected;
    try { expected=paidPlan(sample); }
    catch { assert.throws(()=>previewPlan(sample)); continue; }
    assert.deepEqual(previewPlan(sample),expected && {
      days:expected.days,quantities:expected.quantities,amountBased:expected.amountBased
    });
  }
});

// Minimal DOM double: validates input/preview behavior, not visual layout.
class Element {
  constructor(tag='div') { this.tagName=tag;this.children=[];this.dataset={};this.handlers={};this.value='';this.textContent=''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  addEventListener(name,handler) { this.handlers[name]=handler; }
  setAttribute(name,value) { this[name]=String(value); }
}
function input(item,value) { const node=new Element('input');node.dataset.quantity=item;node.value=String(value);return node; }

test('form preview locks single-card quantity, restores manual mixed/Shenwu inputs and clears invalid results',async()=>{
  const { updateCardPreview }=await import('../public/js/recharge-plan.js');
  const month=input('月卡',1), bank=input('福袋',1), target=new Element();
  let record=registration({amount:20});
  assert.equal(updateCardPreview(record,[month,bank],target).plan.days,60);
  assert.equal(month.value,'2');assert.equal(month.readOnly,true);assert.equal(bank.readOnly,false);
  assert.match(target.textContent,/60 天.*自动计算/);
  record={...record,items:['月卡','福袋'],quantities:{月卡:1,福袋:1},amount:60};month.value='1';
  assert.equal(updateCardPreview(record,[month,bank],target).plan.days,30);
  assert.equal(month.readOnly,false);assert.equal(month.value,'1');assert.match(target.textContent,/混合购买/);
  record={...record,server:'神武奇章',items:['月卡']};
  assert.equal(updateCardPreview(record,[month,bank],target).plan,null);
  assert.equal(month.readOnly,false);assert.match(target.textContent,/人工交付/);
  record=registration({amount:25});
  assert.ok(updateCardPreview(record,[month,bank],target).error);
  assert.equal(month.value,'');assert.match(target.textContent,/整数倍/);
  assert.equal(target.className,'form-feedback');
  record.amount=30;assert.equal(updateCardPreview(record,[month,bank],target).plan.days,90);
  assert.equal(month.value,'3');assert.equal(target.className,'notice');
  updateCardPreview({...record,items:[]},[month,bank],target);assert.equal(target.hidden,true);
});

async function reviewUi(t) {
  const container=new Element(),preview=new Element();
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{
    querySelector:selector=>selector==='#review-quantities'?container:preview,
    createElement:tag=>new Element(tag)
  }});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const { createRechargeReview }=await import('../public/js/recharge-review.js');
  return {review:createRechargeReview(),container,preview,inputs:()=>container.children.map(field=>field.children[1])};
}

test('admin correction preview resets between records, hides on rejection and recalculates mixed quantities',async t=>{
  const {review,container,preview,inputs}=await reviewUi(t);
  review.open({...registration({amount:20}),status:'pending',paid:null},'verified');
  assert.deepEqual(review.quantities(),{月卡:2});assert.match(preview.textContent,/60 天/);
  assert.equal(inputs()[0].readOnly,true);assert.equal(inputs()[0].disabled,false);
  review.update('rejected');assert.equal(container.hidden,true);assert.equal(preview.hidden,true);
  assert.equal(inputs()[0].disabled,true);assert.equal(review.quantities(),undefined);
  review.update('verified');assert.equal(container.hidden,false);assert.deepEqual(review.quantities(),{月卡:2});
  review.open({...registration({amount:100,items:['月卡','福袋'],quantities:{月卡:1,福袋:1}}),status:'pending'},'verified');
  assert.equal(inputs().length,2);assert.equal(inputs()[0].readOnly,false);
  inputs()[0].value='2';inputs()[0].handlers.input();assert.match(preview.textContent,/60 天/);
  assert.deepEqual(review.quantities(),{月卡:2,福袋:1});
  inputs()[0].value='11';assert.throws(()=>review.quantities(),/不足/);
  inputs()[0].value='2';inputs()[1].value='';assert.throws(()=>review.quantities(),/所有付款项/);
  review.open({...registration({items:['年卡'],amount:100,quantities:{年卡:1}}),status:'pending'},'verified');
  assert.equal(inputs().length,1);assert.deepEqual(review.quantities(),{年卡:1});assert.match(preview.textContent,/365 天/);
});

test('admin retries and completed jobs show frozen days, never current amount-based calculation',async t=>{
  const {review,container,preview,inputs}=await reviewUi(t);
  for (const state of ['error','done']) {
    review.open({...registration({amount:25}),status:'verified',paid:{state,days:30}},state==='error'?'retry_paid':'delivered');
    assert.equal(container.hidden,true);assert.equal(inputs()[0].disabled,true);
    assert.equal(review.quantities(),undefined);assert.equal(preview.hidden,false);
    assert.match(preview.textContent,/30 天.*已锁定/);assert.doesNotMatch(preview.textContent,/整数倍/);
  }
  review.open({...registration(),status:'rejected'},'pending');
  assert.equal(container.hidden,true);assert.equal(preview.hidden,true);assert.equal(review.quantities(),undefined);
});
