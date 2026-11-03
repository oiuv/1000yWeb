'use strict';
const CARDS = { 月卡: { cents: 1000, days: 30 }, 年卡: { cents: 10000, days: 365 } };
const isCard = item => Object.hasOwn(CARDS, item);
function validQuantities(items, values) {
  return values !== null && typeof values === 'object' && !Array.isArray(values) &&
    Object.keys(values).length === items.length &&
    items.every(item => Object.hasOwn(values, item) && Number.isInteger(values[item]) && values[item] >= 1 && values[item] <= 99);
}
function paidPlan(record) {
  if (record.server !== '炎黄新章') return null;
  const cards = record.items.filter(isCard);
  if (!cards.length) return null;
  const amount = Number(record.amount), paidCents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || paidCents < 1) throw new Error('请核对实付金额');
  const quantities = { ...record.quantities };
  const amountBased = record.items.length === 1;
  if (amountBased) {
    const item = cards[0], quantity = paidCents / CARDS[item].cents;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error(`单独购买${item}时，金额须为 ${CARDS[item].cents / 100} 元的整数倍，数量为 1–99`);
    }
    quantities[item] = quantity;
  }
  let days = 0, cents = 0;
  for (const item of cards) {
    const quantity = quantities[item];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('请核对月卡／年卡数量，未记录数量的历史登记不能自动充值');
    days += CARDS[item].days * quantity;
    cents += CARDS[item].cents * quantity;
  }
  if (paidCents < cents) throw new Error('实付金额不足以购买所选月卡／年卡');
  return { days, cents, onlyCards: cards.length === record.items.length, quantities, amountBased };
}
module.exports = { paidPlan, isCard, validQuantities };
