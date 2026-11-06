import { $, el } from './auth.js';
import { updateCardPreview } from './recharge-plan.js';

export function createRechargeReview() {
  const container = $('#review-quantities'), preview = $('#review-plan');
  let record, inputs = [], action;
  function update(nextAction) {
    action = nextAction;
    const editable = record.status === 'pending' && !record.paid && action === 'verified';
    container.hidden = !editable;
    for (const input of inputs) input.disabled = !editable;
    if (record.paid) {
      preview.hidden = false; preview.className = 'notice';
      preview.textContent = `本次充值任务：${record.paid.days} 天，天数已锁定，重试不会重新计算或重复充值。`;
    } else if (editable) {
      return updateCardPreview({ ...record, quantities: values() }, inputs, preview);
    } else {
      preview.hidden = true; preview.textContent = '';
    }
    return {};
  }
  function values() {
    return Object.fromEntries(inputs.map(input => [input.dataset.quantity, Number(input.value)]));
  }
  return {
    open(nextRecord, nextAction) {
      record = nextRecord; inputs = []; container.replaceChildren();
      for (const [index, item] of record.items.entries()) {
        const field = el('div', 'field'), label = el('label', '', item === '真气珠' ? '真气珠份数（100 个／份）' : ({ 福袋: '储物福袋', 宝石: '宝石福袋' }[item] || item) + '数量');
        const input = el('input'); input.type = 'number'; input.min = '1'; input.max = '99'; input.step = '1'; input.required = true;
        input.id = 'review-quantity-' + index; label.htmlFor = input.id;
        input.dataset.quantity = item; input.value = record.quantities?.[item] ?? '';
        input.setAttribute('aria-describedby', 'review-plan');
        input.addEventListener('input', () => update(action));
        field.append(label, input); container.append(field); inputs.push(input);
      }
      update(nextAction);
    },
    update,
    quantities() {
      const { error } = update(action);
      if (error) throw error;
      if (container.hidden) return undefined;
      const result = values();
      if (Object.values(result).some(value => !Number.isInteger(value) || value < 1 || value > 99)) {
        throw new Error('请填写所有付款项的数量（1–99）');
      }
      return result;
    }
  };
}
