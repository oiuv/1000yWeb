'use strict';
const { executeQuery } = require('../config/database');
const { sameSecret } = require('../lib/security');

class User {
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
