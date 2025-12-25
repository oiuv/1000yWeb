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
        lastdate: new Date().toLocaleString('zh-CN')
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

  /**
   * 获取用户详细信息（用于个人中心显示）
   * @param {string} account - 账号
   * @returns {Object|null} 用户信息
   */
  static async getProfile(account) {
    try {
      const query = `
        SELECT id, account, username, email, telephone,
               char1, char2, char3, char4, char5, lastdate
        FROM dbo.account1000y
        WHERE RTRIM(account) = @account
      `;
      const result = await executeQuery(query, { account });
      const user = result.recordset[0] || null;

      // 处理角色名称，去除空格和null值
      if (user) {
        user.characters = [];
        for (let i = 1; i <= 5; i++) {
          const char = user[`char${i}`];
          if (char && char.trim()) {
            user.characters.push(char.trim());
          }
        }
      }

      return user;
    } catch (error) {
      console.error('获取用户信息失败:', error);
      throw error;
    }
  }

  /**
   * 修改密码
   * @param {string} account - 账号
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @param {string} ipaddr - IP地址
   * @returns {boolean} 是否成功
   */
  static async changePassword(account, oldPassword, newPassword, ipaddr) {
    try {
      // 先验证旧密码
      const isValid = await this.validatePassword(account, oldPassword);
      if (!isValid) {
        return { success: false, message: '原密码错误' };
      }

      const query = `
        UPDATE dbo.account1000y
        SET password = @newPassword,
            ipaddr = @ipaddr,
            updated_at = GETDATE()
        WHERE RTRIM(account) = @account
      `;

      const params = {
        account,
        newPassword,
        ipaddr
      };

      await executeQuery(query, params);
      return { success: true, message: '密码修改成功' };
    } catch (error) {
      console.error('修改密码失败:', error);
      throw error;
    }
  }

  /**
   * 检查用户是否为管理员
   * @param {string} account - 账号
   * @returns {boolean} 是否为管理员
   */
  static async isAdmin(account) {
    try {
      const user = await this.findByAccount(account);
      return user && user.id === 1;
    } catch (error) {
      console.error('检查管理员权限失败:', error);
      return false;
    }
  }
}

module.exports = User;