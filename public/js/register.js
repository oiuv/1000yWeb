import { $, init, api, submit, message } from './auth.js';
async function setup() {
  await init();
  $('#register-form').addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, async () => {
      const form=event.currentTarget;
      const data=Object.fromEntries(new FormData(form));
      if(data.password !== data.confirmPassword) throw new Error('两次输入的密码不一致');
      await api('/api/auth/register',{body:data});
      form.reset();
      message($('#register-feedback'),'注册成功！请登录账号中心，或下载客户端进入游戏。',true);
      $('#registered-actions').hidden=false;
      $('#registered-actions').focus();
    });
  });
}
setup().catch(error => message($('#register-feedback'),error.message));
