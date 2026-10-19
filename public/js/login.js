import { $, state, init, api, submit, message } from './auth.js';

async function setup() {
  await init();
  const next = new URLSearchParams(location.search).get('next');
  const destination = ['dashboard.html','admin.html','recharge.html'].includes(next) ? next : null;
  if (state.user) { location.replace(destination || (state.user.isAdmin ? 'admin.html' : 'dashboard.html')); return; }
  if (new URLSearchParams(location.search).has('changed')) message($('#login-feedback'),'密码已修改，请重新登录。',true);
  $('#login-form').addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, async () => {
      const result = await api('/api/auth/login', { body: Object.fromEntries(new FormData(event.currentTarget)) });
      location.href = destination || (result.user.isAdmin ? 'admin.html' : 'dashboard.html');
    });
  });
}
setup().catch(error => message($('#login-feedback'),error.message));
