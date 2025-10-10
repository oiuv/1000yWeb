const { executeQuery } = require('../config/database');

class User {
  static async findByAccount(account) {
    try {
      const query = 'SELECT * FROM dbo.account1000y WHERE RTRIM(account) = @account';
      const result = await executeQuery(query, { account });
      return result.recordset[0] || null;
    } catch (error) {
      console.error('查找用户失败:', error);
      throw error;
    }
  }

  static async findByEmail(email) {
    try {
      const query = 'SELECT * FROM dbo.account1000y WHERE email = @email';
      const result = await executeQuery(query, { email });
      return result.recordset[0] || null;
    } catch (error) {
      console.error('通过邮箱查找用户失败:', error);
      throw error;
    }
  }

  static async create(userData) {
    try {
      const {
        account,
        password,
        username,
        telephone,
        email,
        ipaddr,
        makedate
      } = userData;

      const query = `
        INSERT INTO dbo.account1000y (
          account, password, username, telephone, email, ipaddr, makedate
        ) VALUES (
          @account, @password, @username, @telephone, @email, @ipaddr, @makedate
        )
      `;

      const params = {
        account,
        password,
        username,
        telephone,
        email,
        ipaddr,
        makedate
      };

      const result = await executeQuery(query, params);
      return result;
    } catch (error) {
      console.error('创建用户失败:', error);
      throw error;
    }
  }

  static async updateLastLogin(account, ipaddr) {
    try {
      const query = `
        UPDATE dbo.account1000y
        SET lastdate = @lastdate, ipaddr = @ipaddr
        WHERE RTRIM(account) = @account
      `;

      const params = {
        account,
        ipaddr,
        lastdate: new Date().toISOString()
      };

      const result = await executeQuery(query, params);
      return result;
    } catch (error) {
      console.error('更新最后登录时间失败:', error);
      throw error;
    }
  }

  static async validatePassword(account, password) {
    try {
      const user = await this.findByAccount(account);
      if (!user) {
        return false;
      }

      // 简单的密码比较（实际项目中应该使用bcrypt等加密方式）
      // 两个都需要去除右侧空格（因为数据库CHAR字段会自动填充）
      return user.password.trim() === password.trim();
    } catch (error) {
      console.error('密码验证失败:', error);
      throw error;
    }
  }

  static async updateProfile(account, updateData) {
    try {
      const {
        username,
        email,
        telephone,
        birth,
        address
      } = updateData;

      const query = `
        UPDATE dbo.account1000y
        SET username = @username,
            email = @email,
            telephone = @telephone,
            birth = @birth,
            address = @address,
            updated_at = GETDATE()
        WHERE RTRIM(account) = @account
      `;

      const params = {
        account,
        username,
        email,
        telephone,
        birth,
        address
      };

      const result = await executeQuery(query, params);
      return result;
    } catch (error) {
      console.error('更新用户资料失败:', error);
      throw error;
    }
  }
}

module.exports = User;