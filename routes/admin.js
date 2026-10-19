'use strict';
const express = require('express');
const { body, validate, filters, STATUSES, asyncRoute } = require('../lib/validation');

module.exports = ({ recharge, security, paid }) => {
  const router = express.Router();
  router.use(security.requireUser, security.requireAdmin);
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
    const result = recharge.updateStatus(id, status, expectedStatus, req.user.account, note, !!paid);
    if (result.error) return res.status(result.error).json({ success: false, message: result.message });
    if (status === 'verified' && recharge.paidJob(id)) {
      return res.json(await recharge.fulfillPaid(id, paid, req.user.account));
    }
    res.json({ success: true, message: '处理结果已保存' });
  }));
  router.post('/retry-paid', [body('id').custom(value => Number.isSafeInteger(value) && value > 0).withMessage('登记编号无效')], validate, asyncRoute(async (req, res) => {
    const result = await recharge.fulfillPaid(req.body.id, paid, req.user.account);
    res.status(result.error || 200).json({ ...result, success: !result.error });
  }));
  return router;
};
