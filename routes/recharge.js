const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Recharge = require('../models/Recharge');

// 提交充值登记
router.post('/submit', [
  body('payment_time')
    .notEmpty()
    .withMessage('请选择付款时间')
    .isISO8601()
    .withMessage('请输入有效的付款时间'),
  body('transaction_id')
    .notEmpty()
    .withMessage('请输入交易单号')
    .isLength({ min: 6, max: 6 })
    .withMessage('交易单号必须为6位')
    .matches(/^[a-zA-Z0-9]+$/)
    .withMessage('交易单号只能包含字母和数字'),
  body('amount')
    .notEmpty()
    .withMessage('请输入付款金额')
    .isFloat({ min: 0.01 })
    .withMessage('付款金额必须大于0'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('请至少选择一项付款项'),
  body('game_account')
    .notEmpty()
    .withMessage('请输入游戏账号')
    .isLength({ min: 5, max: 12 })
    .withMessage('游戏账号长度必须在5-12个字符之间'),
  body('character_name')
    .notEmpty()
    .withMessage('请输入角色名称')
    .isLength({ min: 1, max: 20 })
    .withMessage('角色名称长度必须在1-20个字符之间'),
  body('server')
    .notEmpty()
    .withMessage('请选择游戏分区')
    .isIn(['神武奇章', '炎黄新章'])
    .withMessage('请选择有效的游戏分区'),
  body('remark')
    .optional()
    .isLength({ max: 200 })
    .withMessage('备注说明不能超过200个字符')
], async (req, res) => {
  try {
    // 检查验证错误
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '输入验证失败',
        errors: errors.array()
      });
    }

    const {
      payment_time,
      transaction_id,
      amount,
      items,
      game_account,
      character_name,
      server,
      remark
    } = req.body;

    // 检查交易单号是否已存在
    const exists = Recharge.existsByTransactionId(transaction_id);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: '该交易单号已提交，请勿重复提交'
      });
    }

    // 获取客户端IP
    const getClientIP = () => {
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (xForwardedFor) {
        return xForwardedFor.split(',')[0].trim();
      }
      const xRealIP = req.headers['x-real-ip'];
      if (xRealIP) {
        return xRealIP;
      }
      const xClientIP = req.headers['x-client-ip'];
      if (xClientIP) {
        return xClientIP;
      }
      const cfConnectingIP = req.headers['cf-connecting-ip'];
      if (cfConnectingIP) {
        return cfConnectingIP;
      }
      return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || '127.0.0.1';
    };

    // 创建充值记录
    Recharge.create({
      payment_time,
      transaction_id,
      amount,
      items,
      game_account,
      character_name,
      server,
      remark,
      ip_address: getClientIP()
    });

    res.status(201).json({
      success: true,
      message: '充值登记提交成功！GM确认后24小时内完成交付，请耐心等待。'
    });

  } catch (error) {
    console.error('提交充值登记失败:', error);
    res.status(500).json({
      success: false,
      message: '提交失败，请稍后再试'
    });
  }
});

module.exports = router;
