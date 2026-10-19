'use strict';
const { randomUUID } = require('node:crypto');
const { paidPlan } = require('../lib/products');

const TRANSITIONS = {
  pending: ['verified', 'rejected'], verified: ['delivered', 'pending'],
  rejected: ['pending'], delivered: []
};
class Recharge {
  constructor(db) { this.db = db; }
  create(data) {
    return this.db.transaction(() => {
      // Six digits help human reconciliation; they are not globally unique payment IDs.
      const duplicate = this.db.prepare('SELECT id FROM recharge_records WHERE ' +
        'transaction_id = ? COLLATE NOCASE AND payment_time = ? AND amount = ? AND ' +
        "game_account = ? COLLATE NOCASE AND server = ? AND status <> 'rejected'")
        .get(data.transaction_id, data.payment_time, data.amount, data.game_account, data.server);
      if (duplicate) return { duplicate: true, id: duplicate.id };
      const result = this.db.prepare('INSERT INTO recharge_records ' +
        '(payment_time,transaction_id,amount,items,game_account,character_name,server,remark,ip_address,submitted_by,quantities)' +
        ' VALUES (@payment_time,@transaction_id,@amount,@items,@game_account,@character_name,@server,@remark,@ip_address,@submitted_by,@quantities)')
        .run({ ...data, items: JSON.stringify(data.items), quantities: JSON.stringify(data.quantities) });
      return { id: Number(result.lastInsertRowid), duplicate: false };
    })();
  }
  where(filters = {}, submittedBy) {
    const clauses = [], params = [];
    for (const key of ['status', 'server']) {
      if (filters[key]) { clauses.push(key + ' = ?'); params.push(filters[key]); }
    }
    if (filters.item) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(items) THEN items ELSE '[]' END) WHERE value = ?)");
      params.push(filters.item);
    }
    if (filters.search) {
      const term = '%' + filters.search.replace(/[\\%_]/g, '\\$&') + '%';
      clauses.push("(game_account LIKE ? ESCAPE '\\' OR character_name LIKE ? ESCAPE '\\' OR transaction_id LIKE ? ESCAPE '\\')");
      params.push(term, term, term);
    }
    if (submittedBy !== undefined) { clauses.push('submitted_by = ?'); params.push(submittedBy); }
    return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
  }
  parse(record) {
    let items = [], quantities = {};
    try { items = JSON.parse(record.items); } catch {}
    try { quantities = JSON.parse(record.quantities); } catch {}
    return { ...record, items: Array.isArray(items) ? items : [], quantities,
      paid: this.paidJob(record.id) || null };
  }
  list(filters = {}, submittedBy) {
    const { sql, params } = this.where(filters, submittedBy);
    const page = filters.page || 1, limit = filters.limit || 20;
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM recharge_records' + sql).get(...params).n;
    const records = this.db.prepare('SELECT * FROM recharge_records' + sql +
      ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(...params, limit, (page - 1) * limit).map(record => this.parse(record));
    return { records, total, page, pages: Math.ceil(total / limit), hasMore: page * limit < total };
  }
  stats() {
    const row = this.db.prepare('SELECT COUNT(*) total,' +
      "COALESCE(SUM(status='pending'),0) pending, COALESCE(SUM(status='verified'),0) verified," +
      "COALESCE(SUM(status='delivered'),0) delivered, COALESCE(SUM(status='rejected'),0) rejected," +
      "COALESCE(SUM(CASE WHEN status IN ('verified','delivered') THEN ROUND(amount*100) ELSE 0 END),0) cents," +
      "COALESCE(SUM(CASE WHEN status IN ('verified','delivered') AND server='神武奇章' THEN ROUND(amount*100) ELSE 0 END),0) shenwu," +
      "COALESCE(SUM(CASE WHEN status IN ('verified','delivered') AND server='炎黄新章' THEN ROUND(amount*100) ELSE 0 END),0) yanhuang" +
      ' FROM recharge_records').get();
    return { total: row.total, pending: row.pending, verified: row.verified, delivered: row.delivered,
      rejected: row.rejected, totalAmount: (row.cents / 100).toFixed(2),
      shenwuAmount: (row.shenwu / 100).toFixed(2), yanhuangAmount: (row.yanhuang / 100).toFixed(2) };
  }
  history(id) {
    return this.db.prepare('SELECT actor,from_status,to_status,note,created_at FROM recharge_history ' +
      'WHERE record_id = ? ORDER BY id').all(id);
  }
  paidJob(id) { return this.db.prepare('SELECT * FROM paid_recharges WHERE record_id=?').get(id); }
  updateStatus(id, status, expectedStatus, actor, note, paidEnabled = false) {
    return this.db.transaction(() => {
      const record = this.db.prepare('SELECT * FROM recharge_records WHERE id=?').get(id);
      if (!record) return { error: 404, message: '登记记录不存在' };
      if (record.status !== expectedStatus) return { error: 409, message: '此记录已被处理，请刷新后重试' };
      if (!TRANSITIONS[record.status]?.includes(status)) return { error: 409, message: '当前状态不能执行此操作' };
      const job = this.paidJob(id);
      if (job && status === 'pending') return { error: 409, message: '此记录已提交 Paid 充值，不能退回重审；请核对到账状态' };
      if (job && status === 'delivered' && job.state !== 'done') return { error: 409, message: '付费时长尚未确认到账，请先重试充值' };
      if (status === 'verified') {
        let plan;
        try { plan = paidPlan(this.parse(record)); }
        catch (error) { return { error: 400, message: error.message }; }
        if (plan) {
          if (!paidEnabled) return { error: 503, message: '尚未配置 Paid 自动充值，核款状态未改变，请先完成部署配置' };
          if (!record.submitted_by || record.submitted_by !== record.game_account) {
            return { error: 409, message: '登记账号未绑定登录身份，不能自动充值，请人工核对' };
          }
          this.db.prepare('INSERT INTO paid_recharges(record_id,order_id,loginid,days) VALUES (?,?,?,?)')
            .run(id, 'yh:' + randomUUID(), record.game_account, plan.days);
        }
      }
      this.db.prepare('UPDATE recharge_records SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
      this.db.prepare('INSERT INTO recharge_history(record_id,actor,from_status,to_status,note) VALUES (?,?,?,?,?)')
        .run(id, actor, record.status, status, note);
      return { success: true };
    })();
  }
  async fulfillPaid(id, paid, actor) {
    const job = this.paidJob(id);
    if (!job) return { error: 409, message: '此登记没有自动充值任务' };
    if (job.state === 'done') return { success: true, message: '付费时长已经到账，无需重复充值' };
    if (!paid) return { error: 503, message: '尚未配置 Paid 自动充值' };
    try {
      const receipt = await paid.credit({ order_id: job.order_id, loginid: job.loginid, days: job.days });
      this.db.transaction(() => {
        if (this.paidJob(id).state === 'done') return;
        this.db.prepare("UPDATE paid_recharges SET state='done',error=NULL,old_enddate=?,enddate=?,updated_at=CURRENT_TIMESTAMP WHERE record_id=?")
          .run(receipt.old_enddate, receipt.enddate, id);
        const record = this.parse(this.db.prepare('SELECT * FROM recharge_records WHERE id=?').get(id));
        const status = paidPlan(record).onlyCards ? 'delivered' : 'verified';
        this.db.prepare('UPDATE recharge_records SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
        this.db.prepare('INSERT INTO recharge_history(record_id,actor,from_status,to_status,note) VALUES (?,?,?,?,?)')
          .run(id, actor, record.status, status, `Paid 已到账 ${job.days} 天，到期时间 ${receipt.enddate}；游戏重登生效`);
      })();
      return { success: true, message: '付费时长已到账；如包含物品，仍须人工发放' };
    } catch {
      // The process may have committed before timing out. Keep the same order key on every retry.
      this.db.prepare("UPDATE paid_recharges SET state='error',error=?,updated_at=CURRENT_TIMESTAMP WHERE record_id=? AND state<>'done'")
        .run('未确认到账：请检查 Paid 配置、账号模式、大小写和数据库状态后重试', id);
      if (this.paidJob(id).state === 'done') return { success: true, message: '付费时长已到账' };
      return { success: true, paidPending: true, message: '核款已保存，但 Paid 尚未确认到账。请刷新详情检查并重试充值，不要手工重复续期' };
    }
  }
}
module.exports = Recharge;
