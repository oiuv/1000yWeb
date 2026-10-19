'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Privileged local bridge. All paths come from deployment config, never HTTP input.
function createPaidBridge({ python, script, database }) {
  for (const value of [python, script, database]) {
    if (!value || !path.isAbsolute(value) || !fs.statSync(value).isFile()) {
      throw new Error('Paid 配置须为现有文件的绝对路径');
    }
  }
  return {
    credit(request) {
      return new Promise((resolve, reject) => {
        const child = execFile(python, ['-X', 'utf8', script, '--db-path', database], {
          windowsHide: true, timeout: 15000, maxBuffer: 65536, encoding: 'utf8'
        }, (error, stdout) => {
          let result;
          try { result = JSON.parse(stdout); } catch {}
          if (error || !result?.success) {
            return reject(new Error(result?.error === 'invalid_request_or_account'
              ? 'Paid 拒绝充值：请核对账号模式、大小写及订单信息'
              : 'Paid 未确认到账，请检查同机配置、权限及数据库后重试'));
          }
          if (result.order_id !== request.order_id || result.loginid !== request.loginid || result.days !== request.days ||
              !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result.enddate)) {
            return reject(new Error('Paid 收据不匹配，请核对后重试'));
          }
          resolve(result);
        });
        child.stdin.on('error', () => {}); // Spawn failure / early exit is reported by execFile.
        child.stdin.end(JSON.stringify(request));
      });
    }
  };
}
module.exports = { createPaidBridge };
