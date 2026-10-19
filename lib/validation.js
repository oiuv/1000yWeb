'use strict';
const { body, query, validationResult } = require('express-validator');
const ITEMS = ['月卡', '年卡', '福袋', '宝石'];
const SERVERS = ['神武奇章', '炎黄新章'];
const STATUSES = ['pending', 'verified', 'delivered', 'rejected'];
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false, message: errors.array()[0].msg,
      errors: errors.array().map(({ path, msg }) => ({ path, msg }))
    });
  }
  next();
}
const account = field => body(field).isString().bail().trim().matches(/^[a-zA-Z0-9_]{5,12}$/)
  .withMessage('账号为 5–12 位字母、数字或下划线');
const password = field => body(field).isString().bail().matches(/^[\x21-\x2b\x2d-\x7e]{6,20}$/)
  .withMessage('密码为 6–20 位英文、数字或符号，不含空格和逗号');
const pageQuery = [
  query('page').optional().isInt({ min: 1, max: 1000000 }).withMessage('页码无效').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页应为 1–100 条').toInt()
];
const filters = [
  ...pageQuery,
  query('status').optional({ values: 'falsy' }).isIn(STATUSES).withMessage('状态无效'),
  query('server').optional({ values: 'falsy' }).isIn(SERVERS).withMessage('分区无效'),
  query('item').optional({ values: 'falsy' }).isIn(ITEMS).withMessage('付款项无效'),
  query('search').optional().isString().bail().isLength({ max: 100 }).withMessage('搜索词过长')
];
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
module.exports = { body, query, validate, account, password, pageQuery, filters, asyncRoute, ITEMS, SERVERS, STATUSES };
