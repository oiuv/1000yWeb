export const categoryLabels = {
  basics: '入门与背景', skills: '武功修炼', equipment: '装备资料',
  items: '物品材料', monsters: '怪物图鉴', npc: 'NPC 指南',
  quests: '地图与任务', systems: '玩法系统', craft: '职业技能'
};
export const categories = Object.keys(categoryLabels);

// All terms must match; treat input literally rather than as a regular expression.
export function filterGuides(entries, query = '', category = '') {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  const selected = categories.includes(category) ? category : '';
  return entries.filter(entry => (!selected || entry.category === selected) &&
    terms.every(term => entry.text.toLocaleLowerCase('zh-CN').includes(term)));
}
