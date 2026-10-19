import { $, state, init, api, submit, message, el } from './auth.js';
function currentTime() {
  const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  return now.toISOString().slice(0,16);
}
async function setup() {
  if(!await init({auth:true}))return;
  $('#payment_time').value=currentTime();
  let characters=[], profileError=false;
  try {
    const {profile}=await api('/api/auth/profile');
    characters=[...new Set(profile.characters.map(entry=>entry.split(':')[0].trim()).filter(Boolean))];
  } catch { profileError=true; }
  const characterSelect=$('#character-select');
  characterSelect.replaceChildren(...(characters.length ? characters.map(name=>{
    const option=el('option','',name);option.value=name;return option;
  }) : [el('option','',profileError ? '角色读取失败，请刷新页面' : '暂无角色，请先在游戏中创建角色')]));
  if(!characters.length)characterSelect.options[0].value='';
  function updateSubmitAvailability() {
    $('#recharge-form [type="submit"]').disabled=$('#server').value==='炎黄新章' && !characters.length;
  }
  function updateServer() {
    const yanhuang=$('#server').value==='炎黄新章';
    $('#game_account').value=state.user.account;
    $('#game_account').readOnly=yanhuang;
    $('#account-notice').textContent=yanhuang
      ? '当前登录炎黄账号：'+state.user.account+'。账号不可修改，角色从此账号自动读取。'
      : '当前登录炎黄账号：'+state.user.account+'。请填写实际神武收货账号和角色，账号默认与登录账号相同。';
    $('#account-hint').textContent=yanhuang ? '固定使用当前登录的炎黄账号。' : '请核对神武奇章账号，可与登录账号不同。';
    characterSelect.hidden=!yanhuang;characterSelect.disabled=!yanhuang || !characters.length;
    characterSelect.selectedIndex=0;
    $('#character_name').hidden=yanhuang;$('#character_name').disabled=yanhuang;
    $('#character-label').htmlFor=yanhuang ? 'character-select' : 'character_name';
    $('#character-hint').textContent=yanhuang
      ? (profileError ? '角色读取失败，刷新页面成功后才可登记。' : characters.length ? '默认选择第一个角色，有多个时可下拉选择，不支持手填。' : '该炎黄账号没有角色，请先在游戏中创建角色，再刷新页面。')
      : '请手动填写神武奇章角色名称，不使用炎黄角色资料。';
    updateSubmitAvailability();
  }
  updateServer();
  $('#recharge-form').hidden=false;
  $('#server').addEventListener('change',()=>{
    $('#character_name').value='';
    updateServer();
  });
  $('#transaction_id').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase();});
  $('#remark').addEventListener('input',()=>{$('#remark-count').textContent=$('#remark').value.length;});
  for(const box of document.querySelectorAll('[name="items"]')) {
    box.addEventListener('change',()=>{box.closest('.product').querySelector('[data-quantity]').disabled=!box.checked;});
  }
  $('#recharge-form').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    submit(form,async()=>{
      const data=Object.fromEntries(new FormData(form));
      data.items=Array.from(document.querySelectorAll('[name="items"]:checked'),box=>box.value);
      data.quantities={};
      for(const quantity of document.querySelectorAll('[data-quantity]')) {
        if(!quantity.disabled)data.quantities[quantity.dataset.quantity]=Number(quantity.value);
      }
      if(!data.items.length)throw new Error('请至少选择一项付款项');
      const result=await api('/api/recharge/submit',{body:data});
      form.reset();$('#payment_time').value=currentTime();$('#remark-count').textContent='0';
      for(const quantity of document.querySelectorAll('[data-quantity]'))quantity.disabled=true;
      updateServer();
      message($('#recharge-feedback'),'登记 #'+result.id+' 已提交。GM 核款后 24 小时内交付，请保留支付凭证。',true);
      $('#recharge-feedback').scrollIntoView({block:'center',behavior:'smooth'});
    }).finally(updateSubmitAvailability);
  });
}
setup().catch(error=>message($('#recharge-load-feedback'),error.message));
