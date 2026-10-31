'use strict';
const { executeQuery } = require('../config/database');
const { sameSecret } = require('../lib/security');

class User {
  static async listForAdmin({ page = 1, limit = 20, search = '' } = {}) {
    // Search is literal text; SQL LIKE metacharacters are not administrator filters.
    const params = { offset: (page - 1) * limit, limit };
    const columns = ['account', 'char1', 'char2', 'char3', 'char4', 'char5'];
    const where = search ? 'WHERE ' + columns.map(column =>
      column + " LIKE @search ESCAPE '~'").join(' OR ') : '';
    if (search) params.search = '%' + search.replace(/[~%_\[]/g, '~$&') + '%';
    const count = await executeQuery('SELECT COUNT(*) AS total FROM dbo.account1000y ' + where,
      search ? { search: params.search } : {});
    const total = Number(count.recordset[0].total);
    const result = await executeQuery('SELECT id,account,char1,char2,char3,char4,char5,makedate,lastdate FROM (' +
      'SELECT id,account,char1,char2,char3,char4,char5,makedate,lastdate,' +
      'ROW_NUMBER() OVER (ORDER BY id DESC) AS row_number FROM dbo.account1000y ' + where +
      ') AS accounts WHERE row_number > @offset AND row_number <= @offset + @limit ORDER BY row_number', params);
    const records = result.recordset.map(row => ({
      account: String(row.account || '').trimEnd(),
      characters: Array.from({ length: 5 }, (_, i) => String(row['char' + (i + 1)] || '').trim())
        .filter(value => value && value.toLowerCase() !== 'null' && value !== ':')
        .map(value => { const [name, ...region] = value.split(':'); return { name, region: region.join(':') }; })
        .filter(character => character.name),
      registeredAt: typeof row.makedate === 'string' ? row.makedate.trim() || null : row.makedate || null,
      lastGameAt: typeof row.lastdate === 'string' ? row.lastdate.trim() || null : row.lastdate || null
    }));
    return { records, total, page, limit, pages: Math.ceil(total / limit), hasMore: page * limit < total };
  }
  static async findByAccount(account) {
    const result = await executeQuery('SELECT * FROM dbo.account1000y WHERE RTRIM(account) = @account', { account });
    return result.recordset[0] || null;
  }
  static async authenticate(account, password) {
    const user = await this.findByAccount(account);
    // Native Login/Gate require the existing plaintext field. Trim CHAR padding only.
    return user && sameSecret(String(user.password || '').trimEnd(), password) ? user : null;
  }
  static async create({ account, password, telephone, email, ipaddr }) {
    return executeQuery('INSERT INTO dbo.account1000y ' +
      '(account,password,username,telephone,email,ipaddr,makedate) ' +
      'VALUES (@account,@password,@account,@telephone,@email,@ipaddr,CONVERT(varchar(19),GETDATE(),120))',
    { account, password, telephone, email, ipaddr });
  }
  static async updateProfile(account, data) {
    const fields = ['username', 'email', 'telephone', 'birth', 'address']
      .filter(key => Object.hasOwn(data, key));
    if (!fields.length) return;
    const params = { account };
    for (const key of fields) params[key] = data[key];
    await executeQuery('UPDATE dbo.account1000y SET ' +
      fields.map(key => key + '=@' + key).join(',') +
      ',updated_at=GETDATE() WHERE RTRIM(account)=@account', params);
  }
  static async getProfile(account) {
    const result = await executeQuery('SELECT account,username,email,char1,char2,char3,char4,char5,lastdate ' +
      'FROM dbo.account1000y WHERE RTRIM(account)=@account', { account });
    const row = result.recordset[0];
    if (!row) return null;
    const characters = [];
    for (let i = 1; i <= 5; i++) {
      const value = String(row['char' + i] || '').trim();
      if (value && value !== 'null' && value !== ':') characters.push(value);
    }
    return { account: row.account.trimEnd(), username: row.username?.trimEnd() || '',
      email: row.email?.trimEnd() || '', lastdate: row.lastdate, characters };
  }
  static async changePassword(account, oldPassword, newPassword, ipaddr) {
    if (!await this.authenticate(account, oldPassword)) return false;
    // Conditional update also prevents a concurrent password change from being overwritten.
    const result = await executeQuery('UPDATE dbo.account1000y SET password=@newPassword,ipaddr=@ipaddr,' +
      'updated_at=GETDATE() WHERE RTRIM(account)=@account AND password=@oldPassword',
    { account, oldPassword, newPassword, ipaddr });
    return result.rowsAffected[0] === 1;
  }
}
module.exports = User;
