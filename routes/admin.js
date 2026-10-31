'use strict';
const express = require('express');
const { body, query, validate, filters, STATUSES, asyncRoute } = require('../lib/validation');
const { PAID_STATUSES } = require('../lib/paid-status');
const { validAccount } = require('../lib/paid-admin');
const { paidPlan } = require('../lib/products');

const listFilters = () => [
  query('page').optional().isString().bail().matches(/^[1-9]\d*$/).bail().isInt({ max: 1000000 }).withMessage('页码无效').toInt(),
  query('limit').optional().isString().bail().matches(/^[1-9]\d*$/).bail().isInt({ max: 100 }).withMessage('每页应为 1–100 条').toInt(),
  query('search').optional().isString().bail().trim().isLength({ max: 100 }).withMessage('搜索词最多 100 个字符')
];
const pageOptions = req => ({ page: req.query.page || 1, limit: req.query.limit || 20, search: req.query.search || '' });

module.exports = ({ recharge, security, paid, users, paidStatus, paidAdmin }) => {
  const router = express.Router();
  router.use(security.requireUser, security.requireAdmin);
  async function rechargeBlock(account) {
    if (!paidStatus) return null; // The actual Paid transaction remains the final guard.
    try {
      const row = (await paidStatus.forAccounts([account])).get(account);
      return row?.mode === '000' ? { error: 409, message: '账号已禁用，不能充值或通过充值解除禁用' } : null;
    } catch {
      return { error: 503, message: '无法核对付费状态，充值未执行，请稍后重试' };
    }
  }
  router.get('/users', listFilters(), validate, asyncRoute(async (req, res) => {
    const result = await users.listForAdmin(pageOptions(req));
    let availability = paidStatus ? 'available' : 'unconfigured';
    let paidRows = new Map();
    if (paidStatus) {
      try { paidRows = await paidStatus.forAccounts(result.records.map(row => row.account)); }
      catch (error) {
        availability = 'unavailable';
        console.error('Paid status query failed:', error.code || error.name);
      }
    }
    result.records = result.records.map(row => ({ ...row,
      canDisable: !!paidAdmin && availability === 'available' && paidRows.get(row.account)?.mode !== '000',
      paid: availability === 'available'
        ? paidRows.get(row.account) || { status: 'trial', mode: '001', enddate: null }
        : { status: availability }
    }));
    res.json({ success: true, ...result, paidAvailability: availability });
  }));
  router.post('/users/disable', [
    body().custom(value => value && !Array.isArray(value) &&
      Object.keys(value).every(key => ['account', 'confirmed', 'reason'].includes(key))).withMessage('禁用请求包含无效字段'),
    body('account').custom(validAccount).withMessage('账号格式无效'),
    body('confirmed').custom(value => value === true).withMessage('请确认禁用账号'),
    body('reason').optional().isString().bail().trim().isLength({ max: 200 }).withMessage('禁用原因最多 200 个字符')
  ], validate, asyncRoute(async (req, res) => {
    if (!paidAdmin) return res.status(503).json({ success: false, message: '尚未配置账号禁用功能' });
    const user = await users.findByAccount(req.body.account);
    if (!user) return res.status(404).json({ success: false, message: '注册账号不存在，请刷新列表' });
    const account = user.account.trimEnd();
    if (account !== req.body.account) return res.status(409).json({ success: false, message: '账号大小写不一致，请刷新列表后操作' });
    try {
      const result = await paidAdmin.disable({ account, actor: req.user.account, reason: req.body.reason || '' });
      res.json({ success: true, ...result, message: result.alreadyDisabled ? '该账号已禁用' : '账号已禁用，不能通过充值解除禁用' });
    } catch (error) {
      console.error('Paid disable failed:', error.code || error.name);
      const mismatch = error.code === 'PAID_CASE_MISMATCH';
      res.status(mismatch ? 409 : 503).json({ success: false, message: mismatch
        ? '账号大小写与付费记录不一致，请通过 Paid 管理核对'
        : '禁用结果未确认，请刷新账号状态后重试' });
    }
  }));
  router.get('/paid-users', [
    ...listFilters(),
    query('status').optional({ values: 'falsy' }).isString().bail().isIn(PAID_STATUSES).withMessage('付费状态无效')
  ], validate, asyncRoute(async (req, res) => {
    if (!paidStatus) return res.status(503).json({ success: false, message: '尚未配置付费数据来源' });
    try {
      const result = await paidStatus.list({ ...pageOptions(req), status: req.query.status || '' });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Paid status query failed:', error.code || error.name);
      res.status(503).json({ success: false, message: '付费数据暂时无法读取，请稍后刷新重试' });
    }
  }));
  router.get('/recharge-records', filters, validate, (req, res) => {
    const result = recharge.list(req.query);
    result.records = result.records.map(record => ({ ...record, history: recharge.history(record.id) }));
    res.json({ success: true, ...result });
  });
  router.get('/recharge-stats', (req, res) => {
    res.json({ success: true, stats: recharge.stats() });
  });
  router.post('/update-status', [
    body('id').custom(value => Number.isSafeInteger(value) && value > 0).withMessage('登记编号无效'),
    body('status').isString().bail().isIn(STATUSES),
    body('expectedStatus').isString().bail().isIn(STATUSES),
    body('note').isString().bail().trim().isLength({ max: 200 }).withMessage('处理备注最多 200 个字符')
      .custom((note, { req }) => !['rejected', 'pending'].includes(req.body.status) || note.length > 0)
      .withMessage('拒绝或重新审核时，请填写原因')
  ], validate, asyncRoute(async (req, res) => {
    const { id, status, expectedStatus, note } = req.body;
    if (status === 'verified') {
      const record = recharge.get(id);
      let plan;
      try { plan = record && paidPlan(record); }
      catch (error) { return res.status(400).json({ success: false, message: error.message }); }
      const blocked = plan && await rechargeBlock(record.game_account);
      if (blocked) return res.status(blocked.error).json({ success: false, message: blocked.message });
    }
    const result = recharge.updateStatus(id, status, expectedStatus, req.user.account, note, !!paid);
    if (result.error) return res.status(result.error).json({ success: false, message: result.message });
    if (status === 'verified' && recharge.paidJob(id)) {
      return res.json(await recharge.fulfillPaid(id, paid, req.user.account));
    }
    res.json({ success: true, message: '处理结果已保存' });
  }));
  router.post('/retry-paid', [body('id').custom(value => Number.isSafeInteger(value) && value > 0).withMessage('登记编号无效')], validate, asyncRoute(async (req, res) => {
    const job = recharge.paidJob(req.body.id);
    const blocked = job && job.state !== 'done' && await rechargeBlock(job.loginid);
    if (blocked) return res.status(blocked.error).json({ success: false, message: blocked.message });
    const result = await recharge.fulfillPaid(req.body.id, paid, req.user.account);
    res.status(result.error || 200).json({ ...result, success: !result.error });
  }));
  return router;
};
