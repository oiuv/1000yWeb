import { $, state, init, api, submit, message, el, renderTable, recordDetails } from './auth.js';
let page = 1, request;
async function loadRecords() {
  request?.abort(); request = new AbortController();
  $('#prev-page').disabled=true;$('#next-page').disabled=true;
  message($('#records-feedback'),'');
  try {
    const data = await api('/api/recharge/mine?page=' + page, { signal: request.signal });
    renderTable($('#records-table'),data.records,record=>{
      recordDetails($('#record-detail'),record);
      $('#record-dialog').showModal();
      $('#record-dialog').scrollTop=0;
    });
    $('#page-info').textContent='共 ' + data.total + ' 条 · 第 ' + page + ' / ' + Math.max(1,data.pages) + ' 页';
    $('#prev-page').disabled=page<=1;$('#next-page').disabled=!data.hasMore;
  } catch(error) {
    if(error.name!=='AbortError') message($('#records-feedback'),error.message);
  }
}
async function setup() {
  if(!await init({auth:true}))return;
  const {profile}=await api('/api/auth/profile');
  $('#profile-content').hidden=false;
  $('#welcome').textContent='欢迎回来，'+state.user.account+'。';
  $('#profile-account').textContent=profile.account;
  $('#profile-email').textContent=profile.email || '未填写';
  $('#profile-lastdate').textContent=profile.lastdate || '暂无游戏登录记录';
  $('#admin-link').hidden=!state.user.isAdmin;
  $('#character-list').replaceChildren(...(profile.characters.length ?
    profile.characters.map(name=>el('span','character-tag',name)) : [el('span','muted small','暂无角色，请在游戏客户端中创建。')]));
  $('#password-form').addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget;
    submit(form,async()=>{
      const data=Object.fromEntries(new FormData(form));
      if(data.newPassword!==data.confirmPassword)throw new Error('两次输入的新密码不一致');
      await api('/api/auth/change-password',{body:data});
      form.reset(); location.href='login.html?changed=1';
    });
  });
  $('#prev-page').addEventListener('click',()=>{page--;loadRecords();});
  $('#next-page').addEventListener('click',()=>{page++;loadRecords();});
  $('#refresh-records').addEventListener('click',()=>{page=1;loadRecords();});
  await loadRecords();
}
setup().catch(error=>message($('#dashboard-feedback'),error.message));
