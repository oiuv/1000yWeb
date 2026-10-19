'use strict';
const CARDS = { 月卡: { cents: 1000, days: 30 }, 年卡: { cents: 10000, days: 365 } };
function paidPlan(record) {
  if (record.server !== '炎黄新章') return null;
  const cards = record.items.filter(item => Object.hasOwn(CARDS, item));
  if (!cards.length) return null;
  let days = 0, cents = 0;
  for (const item of cards) {
    const quantity = record.quantities?.[item];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('请核对月卡／年卡数量，未记录数量的历史登记不能自动充值');
    days += CARDS[item].days * quantity;
    cents += CARDS[item].cents * quantity;
  }
  if (Math.round(Number(record.amount) * 100) < cents) throw new Error('实付金额不足以购买所选月卡／年卡');
  return { days, cents, onlyCards: cards.length === record.items.length };
}
module.exports = { paidPlan };
