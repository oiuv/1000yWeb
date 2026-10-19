'use strict';
const express = require('express');

module.exports = function leaderboardRoutes({ leaderboard }) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    if (!leaderboard) return res.status(503).json({ success: false, message: '每日英雄榜尚未开放' });
    const { date, metric, page, job } = req.query;
    if ([date, metric, page, job].some(value => value !== undefined && typeof value !== 'string')
        || (page !== undefined && !/^[1-9]\d*$/.test(page))
        || (job !== undefined && !/^[1-4]$/.test(job))) {
      return res.status(400).json({ success: false, message: '榜单查询参数不正确' });
    }
    try {
      const data = await leaderboard.get({ date, metric, page: page === undefined ? 1 : Number(page),
        job: job === undefined ? undefined : Number(job) });
      res.json({ success: true, ...data });
    } catch (error) {
      res.status([400, 404, 503].includes(error.status) ? error.status : 503)
        .json({ success: false, message: error.status ? error.message : '英雄榜暂时不可用，请稍后重试' });
    }
  });
  return router;
};
