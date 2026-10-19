import { $, init, api, submit, message, el, toast, renderTable, recordDetails } from './auth.js';
let page=1, request, selected;
const actions={
  pending:[['verified','核款通过 · 等待交付'],['rejected','拒绝登记']],
  verified:[['delivered','确认已完成实际交付'],['pending','退回重新审核']],
  rejected:[['pending','重新审核']], delivered:[]
};
function openRecord(record) {
  selected=record;
  recordDetails($('#record-detail'),record,true);
  $('#review-form').reset();message($('#review-feedback'),'');
  let available=actions[record.status] || [];
  if(record.status==='pending' && record.server==='炎黄新章' && record.items.some(item=>['月卡','年卡'].includes(item))) {
    available=[['verified','核款通过并自动充值时长'],['rejected','拒绝登记']];
  }
  if(record.paid) available=record.paid.state==='done'
    ? available.filter(([action])=>action!=='pending')
    : [['retry_paid','重试付费时长到账（不会重复充值）']];
  $('#review-form').hidden=!available.length;$('#delivered-notice').hidden=!!available.length;
  $('#review-action').replaceChildren(...available.map(([value,label])=>{
    const option=el('option','',label);option.value=value;return option;
  }));
  updateNoteRequirement();$('#record-dialog').showModal();$('#record-dialog').scrollTop=0;
}
function updateNoteRequirement() {
  $('#review-note').required=['rejected','pending'].includes($('#review-action').value);
}
async function loadRecords() {
  request?.abort();request=new AbortController();
  $('#prev-page').disabled=true;$('#next-page').disabled=true;
  $('#list-state').textContent='正在读取登记记录…';
  const params=new URLSearchParams(new FormData($('#filter-form')));params.set('page',page);
  try {
    const data=await api('/api/admin/recharge-records?'+params,{signal:request.signal});
    if(page>Math.max(1,data.pages)){page=Math.max(1,data.pages);return loadRecords();}
    renderTable($('#records-table'),data.records,openRecord,true);
    $('#list-state').textContent=data.total+' 条符合当前条件的记录';
    $('#page-info').textContent='第 '+page+' / '+Math.max(1,data.pages)+' 页 · 每页 20 条';
    $('#prev-page').disabled=page<=1;$('#next-page').disabled=!data.hasMore;
  } catch(error) {
    if(error.name!=='AbortError'){$('#list-state').textContent='读取失败，请重试。';toast(error.message,true);}
  }
}
async function loadStats() {
  const {stats}=await api('/api/admin/recharge-stats');
  for(const [key,value] of Object.entries(stats)) {
    const target=$('#stat-'+key);if(target)target.textContent=value;
  }
}
async function refresh() {
  message($('#admin-feedback'),'');
  try {await Promise.all([loadRecords(),loadStats()]);}
  catch(error){message($('#admin-feedback'),error.message);}
}
async function setup() {
  if(!await init({auth:true,admin:true}))return;
  $('#admin-content').hidden=false;
  $('#filter-form').addEventListener('submit',event=>{event.preventDefault();page=1;loadRecords();});
  for(const select of document.querySelectorAll('#filter-form select'))select.addEventListener('change',()=>{page=1;loadRecords();});
  $('#reset-filters').addEventListener('click',()=>{$('#filter-form').reset();page=1;loadRecords();});
  $('#prev-page').addEventListener('click',()=>{page--;loadRecords();});
  $('#next-page').addEventListener('click',()=>{page++;loadRecords();});
  $('#refresh-all').addEventListener('click',refresh);
  $('#review-action').addEventListener('change',updateNoteRequirement);
  $('#review-form').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    submit(form,async()=>{
      const action=$('#review-action').value;
      const result=await api(action==='retry_paid' ? '/api/admin/retry-paid' : '/api/admin/update-status',{body:
        action==='retry_paid' ? {id:selected.id} : {
          id:selected.id,expectedStatus:selected.status,status:action,note:$('#review-note').value
        }
      });
      $('#record-dialog').close();toast(result.message,!!result.paidPending);await refresh();
    });
  });
  await refresh();
}
setup().catch(error=>message($('#admin-feedback'),error.message));
