'use strict';
const express = require('express');
const { body, validate, account, pageQuery, asyncRoute, ITEMS, SERVERS } = require('../lib/validation');
const { paidPlan } = require('../lib/products');

module.exports = ({ recharge, security, limits, users }) => {
  const router = express.Router();
  router.post('/submit', security.requireUser, limits.recharge, [
    body('payment_time').isString().bail().matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .isISO8601({ strict: true }).withMessage('请选择有效的付款时间'),
    body('transaction_id').isString().bail().trim().matches(/^[a-zA-Z0-9]{6}$/)
      .withMessage('请输入交易单号后 6 位').toUpperCase(),
    body('amount').custom(value => {
      const text = String(value);
      return /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(text) && Number(value) >= 0.01;
    }).withMessage('金额为 0.01–999999.99 元，最多两位小数').toFloat(),
    body('items').isArray({ min: 1, max: 4 }).bail()
      .custom(items => items.every(item => ITEMS.includes(item)) && new Set(items).size === items.length)
      .withMessage('请选择有效且不重复的付款项'),
    body('quantities').isObject({ strict: true }).bail().custom((values, { req }) =>
      Object.keys(values).every(key => ITEMS.includes(key) && req.body.items?.includes(key)) &&
      Array.isArray(req.body.items) && req.body.items.every(item => Number.isInteger(values[item]) && values[item] >= 1 && values[item] <= 99)
    ).withMessage('每个付款项的数量应为 1–99'),
    account('game_account').bail().custom((value, { req }) =>
      req.body.server !== '炎黄新章' || value === req.user.account
    ).withMessage('炎黄新章充值账号必须为当前登录账号'),
    body('character_name').isString().bail().trim().isLength({ min: 1, max: 20 }).withMessage('角色名为 1–20 个字符'),
    body('server').isIn(SERVERS).withMessage('请选择游戏分区'),
    body('remark').optional().isString().bail().isLength({ max: 200 }).withMessage('备注最多 200 个字符')
  ], validate, asyncRoute(async (req, res) => {
    const { payment_time, transaction_id, amount, items, quantities, game_account, character_name, server, remark = '' } = req.body;
    try { paidPlan({ server, items, quantities, amount }); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    if (server === '炎黄新章') {
      const profile = await users.getProfile(req.user.account);
      const names = (profile?.characters || []).map(entry => entry.split(':')[0].trim()).filter(Boolean);
      if (!names.includes(character_name)) {
        return res.status(400).json({ success: false, message: '请选择当前登录账号已有的炎黄角色；角色变化后请刷新页面' });
      }
    }
    const result = recharge.create({
      payment_time, transaction_id, amount, items, quantities,
      game_account: server === '炎黄新章' ? req.user.account : game_account,
      character_name, server, remark,
      ip_address: req.ip, submitted_by: req.user.account
    });
    if (result.duplicate) return res.status(409).json({ success: false, message: '相同付款信息已登记，请勿重复提交；如需更正请联系 GM' });
    res.status(201).json({ success: true, id: result.id, message: '登记成功，请等待 GM 核款与交付' });
  }));
  router.get('/mine', security.requireUser, pageQuery, validate, (req, res) => {
    const result = recharge.list(req.query, req.user.account);
    result.records = result.records.map(({ ip_address, submitted_by, ...record }) => ({
      ...record, history: recharge.history(record.id)
    }));
    res.json({ success: true, ...result });
  });
  return router;
};
