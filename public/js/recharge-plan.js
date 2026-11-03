// Display preview only. lib/products.js validates and calculates again on the server.
// Pricing parity is covered by tests/recharge-plan-ui.test.js.
const cards = { 月卡: { cents: 1000, days: 30 }, 年卡: { cents: 10000, days: 365 } };
export const amountBased = record => record.server === '炎黄新章' &&
  record.items.length === 1 && Object.hasOwn(cards, record.items[0]);

export function previewPlan(record) {
  if (record.server !== '炎黄新章') return null;
  const selected = record.items.filter(item => Object.hasOwn(cards, item));
  if (!selected.length) return null;
  const amount = Number(record.amount), cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents < 1) throw new Error('请填写实付金额');
  const quantities = { ...record.quantities }, automatic = amountBased(record);
  if (automatic) {
    const item = selected[0], quantity = cents / cards[item].cents;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error(`单独购买${item}时，金额须为 ${cards[item].cents / 100} 元的整数倍，数量为 1–99`);
    }
    quantities[item] = quantity;
  }
  let days = 0, cost = 0;
  for (const item of selected) {
    const quantity = quantities[item];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('请核对月卡／年卡数量（1–99）');
    days += cards[item].days * quantity;
    cost += cards[item].cents * quantity;
  }
  if (cents < cost) throw new Error('实付金额不足以购买所选月卡／年卡');
  return { days, quantities, amountBased: automatic };
}

export function updateCardPreview(record, inputs, target) {
  const automatic = amountBased(record);
  for (const input of inputs) input.readOnly = automatic && record.items.includes(input.dataset.quantity);
  target.hidden = !record.items.length;
  target.className = 'notice';
  try {
    const plan = previewPlan(record);
    if (plan?.amountBased) {
      for (const input of inputs) {
        if (record.items.includes(input.dataset.quantity)) input.value = String(plan.quantities[input.dataset.quantity]);
      }
    }
    target.textContent = plan
      ? `核款通过后预计充值 ${plan.days} 天。` + (plan.amountBased
        ? '数量按实付金额自动计算。' : '混合购买按所填数量计算，请核对各项数量和金额。')
      : '本订单由 GM 人工交付。';
    return { plan };
  } catch (error) {
    if (automatic) for (const input of inputs) if (input.readOnly) input.value = '';
    target.textContent = error.message;
    target.className = 'form-feedback';
    return { error };
  }
}
