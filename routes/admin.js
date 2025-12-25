const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Recharge = require('../models/Recharge');
const User = require('../models/User');

// 检查管理员权限
function checkAdminAuth(req) {
  const token = req.headers.authorization || req.headers['x-auth-token'];
  if (!token) {
    return null;
  }

  try {
    const user = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    // 检查是否为管理员（id=1）
    if (user.id === 1) {
      return user;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 获取充值记录列表
router.get('/recharge-records', async (req, res) => {
  try {
    const user = checkAdminAuth(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        message: '没有管理员权限'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;

    let records;
    let hasMore = false;

    if (status || search) {
      // 使用过滤查询
      records = Recharge.getAll(1000, 0); // 获取所有记录，然后过滤

      if (status) {
        records = records.filter(r => r.status === status);
      }
      if (search) {
        const searchLower = search.toLowerCase();
        records = records.filter(r =>
          r.game_account.toLowerCase().includes(searchLower) ||
          r.character_name.toLowerCase().includes(searchLower)
        );
      }

      // 分页处理
      const totalFiltered = records.length;
      records = records.slice(offset, offset + limit);
      hasMore = offset + limit < totalFiltered;
    } else {
      records = Recharge.getAll(limit, offset);
      // 检查是否还有更多记录
      const nextRecords = Recharge.getAll(1, offset + limit);
      hasMore = nextRecords.length > 0;
    }

    // 解析 items JSON
    records = records.map(record => ({
      ...record,
      items: record.items
    }));

    res.json({
      success: true,
      records,
      hasMore
    });

  } catch (error) {
    console.error('获取充值记录失败:', error);
    res.status(500).json({
      success: false,
      message: '获取充值记录失败'
    });
  }
});

// 获取充值统计
router.get('/recharge-stats', async (req, res) => {
  try {
    const user = checkAdminAuth(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        message: '没有管理员权限'
      });
    }

    const allRecords = Recharge.getAll(10000, 0);

    const stats = {
      total: allRecords.length,
      pending: allRecords.filter(r => r.status === 'pending').length,
      verified: allRecords.filter(r => r.status === 'verified').length,
      rejected: allRecords.filter(r => r.status === 'rejected').length
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('获取充值统计失败:', error);
    res.status(500).json({
      success: false,
      message: '获取充值统计失败'
    });
  }
});

// 更新充值状态
router.post('/update-status', [
  body('id')
    .notEmpty()
    .withMessage('记录ID不能为空')
    .isInt()
    .withMessage('记录ID必须是整数'),
  body('status')
    .notEmpty()
    .withMessage('状态不能为空')
    .isIn(['pending', 'verified', 'rejected'])
    .withMessage('无效的状态')
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

    const user = checkAdminAuth(req);
    if (!user) {
      return res.status(403).json({
        success: false,
        message: '没有管理员权限'
      });
    }

    const { id, status } = req.body;

    const updated = Recharge.updateStatus(id, status);

    if (updated) {
      const statusText = {
        'pending': '待审核',
        'verified': '已通过',
        'rejected': '已拒绝'
      }[status];

      res.json({
        success: true,
        message: `充值记录已标记为${statusText}`
      });
    } else {
      res.status(404).json({
        success: false,
        message: '充值记录不存在'
      });
    }

  } catch (error) {
    console.error('更新充值状态失败:', error);
    res.status(500).json({
      success: false,
      message: '更新充值状态失败'
    });
  }
});

module.exports = router;
