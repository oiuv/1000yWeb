const Database = require('better-sqlite3');
const path = require('path');

// 数据库文件路径
const dbPath = path.join(__dirname, '../database/recharge.db');
const db = new Database(dbPath);

// 初始化数据库表
db.exec(`
    CREATE TABLE IF NOT EXISTS recharge_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_time DATETIME NOT NULL,
        transaction_id TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        items TEXT NOT NULL,
        game_account TEXT NOT NULL,
        character_name TEXT NOT NULL,
        server TEXT NOT NULL,
        remark TEXT,
        status TEXT DEFAULT 'pending',
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_id ON recharge_records(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_game_account ON recharge_records(game_account);
    CREATE INDEX IF NOT EXISTS idx_status ON recharge_records(status);
`);

class Recharge {
    /**
     * 创建充值记录
     * @param {Object} data - 充值数据
     * @param {string} data.payment_time - 付款时间
     * @param {string} data.transaction_id - 交易单号(后6位)
     * @param {number} data.amount - 付款金额
     * @param {Array} data.items - 付款项数组
     * @param {string} data.game_account - 游戏账号
     * @param {string} data.character_name - 角色名称
     * @param {string} data.server - 游戏分区
     * @param {string} data.remark - 备注说明
     * @param {string} data.ip_address - IP地址
     * @returns {Object} 创建的记录
     */
    static create(data) {
        const stmt = db.prepare(`
            INSERT INTO recharge_records
            (payment_time, transaction_id, amount, items, game_account, character_name, server, remark, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const itemsJson = JSON.stringify(data.items);
        // 确保金额精度：使用整数存储（分为单位），避免浮点数精度问题
        const amountInCents = Math.round(data.amount * 100);
        const formattedAmount = amountInCents / 100;

        try {
            const result = stmt.run(
                data.payment_time,
                data.transaction_id,
                formattedAmount,
                itemsJson,
                data.game_account,
                data.character_name,
                data.server,
                data.remark || '',
                data.ip_address || ''
            );

            console.log(`[Recharge] 充值记录创建成功: ID=${result.lastInsertRowid}, 账号=${data.game_account}, 金额=${formattedAmount}`);

            return {
                success: true,
                id: result.lastInsertRowid
            };
        } catch (error) {
            console.error('[Recharge] 创建充值记录失败:', error);
            throw error;
        }
    }

    /**
     * 检查交易单号是否已存在
     * @param {string} transactionId - 交易单号(后6位)
     * @returns {boolean} 是否存在
     */
    static existsByTransactionId(transactionId) {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM recharge_records WHERE transaction_id = ?');
        const result = stmt.get(transactionId);
        return result.count > 0;
    }

    /**
     * 获取所有充值记录
     * @param {number} limit - 限制数量
     * @param {number} offset - 偏移量
     * @returns {Array} 充值记录列表
     */
    static getAll(limit = 100, offset = 0) {
        const stmt = db.prepare(`
            SELECT * FROM recharge_records
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset);
    }

    /**
     * 根据游戏账号查询充值记录
     * @param {string} gameAccount - 游戏账号
     * @returns {Array} 充值记录列表
     */
    static getByAccount(gameAccount) {
        const stmt = db.prepare(`
            SELECT * FROM recharge_records
            WHERE game_account = ?
            ORDER BY created_at DESC
        `);
        return stmt.all(gameAccount);
    }

    /**
     * 更新充值记录状态
     * @param {number} id - 记录ID
     * @param {string} status - 新状态 (pending/verified/rejected)
     * @returns {boolean} 是否成功
     */
    static updateStatus(id, status) {
        const stmt = db.prepare(`
            UPDATE recharge_records
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        const result = stmt.run(status, id);
        return result.changes > 0;
    }

    /**
     * 根据ID获取充值记录
     * @param {number} id - 记录ID
     * @returns {Object|null} 充值记录
     */
    static getById(id) {
        const stmt = db.prepare('SELECT * FROM recharge_records WHERE id = ?');
        const record = stmt.get(id);
        if (record && record.items) {
            record.items = JSON.parse(record.items);
        }
        return record;
    }
}

module.exports = Recharge;
