'use strict';
const express = require('express');
const { body, validate, account, password, asyncRoute } = require('../lib/validation');

module.exports = ({ users, security, limits }) => {
  const router = express.Router();
  router.get('/session', (req, res) => res.json({
    success: true, user: req.user || null, csrfToken: req.session?.csrf || null
  }));
  router.post('/register', limits.register, [
    account('account'), password('password'),
    body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('两次密码不一致'),
    body('email').isString().bail().trim().isEmail().withMessage('请输入有效的邮箱').isLength({ max: 50 }),
    body('telephone').isString().bail().matches(/^1[3-9]\d{9}$/).withMessage('请输入有效的手机号码')
  ], validate, asyncRoute(async (req, res) => {
    if (await users.findByAccount(req.body.account)) {
      return res.status(409).json({ success: false, message: '该账号已被注册' });
    }
    await users.create({
      account: req.body.account, password: req.body.password, telephone: req.body.telephone,
      email: req.body.email, ipaddr: req.ip
    });
    res.status(201).json({ success: true, message: '注册成功，可以登录游戏了' });
  }));
  router.post('/login', limits.login, [
    body('account').isString().bail().trim().isLength({ min: 1, max: 20 }).withMessage('请输入账号'),
    body('password').isString().bail().isLength({ min: 1, max: 100 }).withMessage('请输入密码')
  ], validate, asyncRoute(async (req, res) => {
    const user = await users.authenticate(req.body.account, req.body.password);
    if (!user) return res.status(401).json({ success: false, message: '账号或密码错误' });
    const identity = security.publicUser(user);
    const csrfToken = security.issue(req, res, identity.account);
    res.json({ success: true, user: identity, csrfToken });
  }));
  router.post('/logout', (req, res) => {
    security.destroy(req, res);
    res.json({ success: true });
  });
  router.get('/profile', security.requireUser, asyncRoute(async (req, res) => {
    const profile = await users.getProfile(req.user.account);
    if (!profile) return res.status(404).json({ success: false, message: '账号不存在' });
    res.json({ success: true, profile });
  }));
  router.post('/update-profile', security.requireUser, [
    body('username').optional().isString().bail().isLength({ max: 20 }),
    body('email').optional().isString().bail().trim().isEmail().isLength({ max: 50 }),
    body('telephone').optional().isString().bail().matches(/^1[3-9]\d{9}$/),
    body('birth').optional().isString().bail().isDate(),
    body('address').optional().isString().bail().isLength({ max: 50 })
  ], validate, asyncRoute(async (req, res) => {
    await users.updateProfile(req.user.account, req.body);
    res.json({ success: true, message: '资料已更新' });
  }));
  router.post('/change-password', security.requireUser, limits.password, [
    body('oldPassword').isString().bail().isLength({ min: 1, max: 100 }),
    password('newPassword'),
    body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('两次新密码不一致')
  ], validate, asyncRoute(async (req, res) => {
    const changed = await users.changePassword(req.user.account, req.body.oldPassword, req.body.newPassword, req.ip);
    if (!changed) return res.status(400).json({ success: false, message: '原密码错误，或密码已被修改' });
    security.revokeAccount(req.user.account);
    security.destroy(req, res);
    res.json({ success: true, message: '密码已修改，请使用新密码重新登录' });
  }));
  return router;
};
