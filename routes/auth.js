const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

// 用户注册
router.post('/register', [
  body('account')
    .isLength({ min: 5, max: 12 })
    .withMessage('账号长度必须在5-12个字符之间')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('账号只能包含字母、数字和下划线'),
  body('password')
    .isLength({ min: 6, max: 20 })
    .withMessage('密码长度必须在6-20个字符之间'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('确认密码与密码不匹配');
      }
      return true;
    }),
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('telephone')
    .matches(/^1[3-9]\d{9}$/)
    .withMessage('请输入有效的手机号码')
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
      account,
      password,
      telephone,
      email
    } = req.body;

    // 检查账号是否已存在
    const existingUser = await User.findByAccount(account);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '该账号已被注册'
      });
    }

    // 获取客户端IP (优先获取真实IP)
    const getClientIP = () => {
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (xForwardedFor) {
        // x-forwarded-for 可能包含多个IP，取第一个
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
      const cfConnectingIP = req.headers['cf-connecting-ip']; // Cloudflare
      if (cfConnectingIP) {
        return cfConnectingIP;
      }
      return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || '127.0.0.1';
    };

    const ipaddr = getClientIP();

    // 格式化注册时间
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    // 创建用户
    await User.create({
      account,
      password, // 实际项目中应该加密
      username: account, // 默认用户名为账号
      telephone,
      email,
      ipaddr,
      makedate: formatDate(new Date())
    });

    res.status(201).json({
      success: true,
      message: '注册成功！'
    });

  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({
      success: false,
      message: '注册失败，请稍后再试'
    });
  }
});

// 用户登录
router.post('/login', [
  body('account')
    .notEmpty()
    .withMessage('请输入账号'),
  body('password')
    .notEmpty()
    .withMessage('请输入密码')
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

    const { account, password } = req.body;

    // 验证用户密码
    const isValid = await User.validatePassword(account, password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: '账号或密码错误'
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

    const ipaddr = getClientIP();

    // 更新最后登录时间
    await User.updateLastLogin(account, ipaddr);

    // 获取用户信息
    const user = await User.findByAccount(account);
    const isAdmin = user.id === 1;

    res.json({
      success: true,
      message: isAdmin ? '登录成功！欢迎管理员' : '登录成功！',
      user: {
        id: user.id,
        account: user.account,
        username: user.username,
        email: user.email,
        isAdmin: isAdmin
      }
    });

  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({
      success: false,
      message: '登录失败，请稍后再试'
    });
  }
});

// 更新用户资料
router.post('/update-profile', [
  body('username')
    .optional()
    .isLength({ max: 20 })
    .withMessage('用户名长度不能超过20个字符'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('telephone')
    .optional()
    .matches(/^1[3-9]\d{9}$/)
    .withMessage('请输入有效的手机号码'),
  body('birth')
    .optional()
    .isDate()
    .withMessage('请输入有效的出生日期'),
  body('address')
    .optional()
    .isLength({ max: 50 })
    .withMessage('地址长度不能超过50个字符')
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

    const user = checkAuth(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '请先登录'
      });
    }

    const {
      username,
      email,
      telephone,
      birth,
      address
    } = req.body;

    // 更新用户信息
    await User.updateProfile(user.account, {
      username,
      email,
      telephone,
      birth,
      address
    });

    res.json({
      success: true,
      message: '资料更新成功！'
    });

  } catch (error) {
    console.error('更新资料失败:', error);
    res.status(500).json({
      success: false,
      message: '更新失败，请稍后再试'
    });
  }
});

// 获取用户详细信息
router.get('/profile', async (req, res) => {
  try {
    const user = checkAuth(req);
    if (!user) {
      console.log('[GET /api/auth/profile] 认证失败：无效的token');
      return res.status(401).json({
        success: false,
        message: '请先登录'
      });
    }

    console.log('[GET /api/auth/profile] 用户认证成功：', user.account);

    const profile = await User.getProfile(user.account);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      profile: {
        account: profile.account,
        username: profile.username,
        email: profile.email,
        characters: profile.characters,
        lastdate: profile.lastdate
      }
    });

  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取信息失败，请稍后再试'
    });
  }
});

// 修改密码
router.post('/change-password', [
  body('oldPassword')
    .notEmpty()
    .withMessage('请输入原密码'),
  body('newPassword')
    .isLength({ min: 6, max: 20 })
    .withMessage('新密码长度必须在6-20个字符之间')
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

    const user = checkAuth(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '请先登录'
      });
    }

    const { oldPassword, newPassword } = req.body;

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

    const ipaddr = getClientIP();

    // 修改密码
    const result = await User.changePassword(user.account, oldPassword, newPassword, ipaddr);

    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({
      success: false,
      message: '修改密码失败，请稍后再试'
    });
  }
});

// 检查用户认证状态
function checkAuth(req) {
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
  if (!authHeader) {
    return null;
  }

  try {
    // 移除 'Bearer ' 前缀（如果存在）
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    // Base64 解码
    const decoded = Buffer.from(token, 'base64').toString('utf-8');

    // URL 解码
    const urlDecoded = decodeURIComponent(decoded);

    // 解析 JSON
    const user = JSON.parse(urlDecoded);

    return user;
  } catch (error) {
    console.error('[checkAuth] Token 解析失败:', error.message);
    return null;
  }
}

module.exports = router;