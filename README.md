# 云端千年-炎黄新章 - 账号注册系统

这是一个基于 Node.js 和 MSSQL 数据库的游戏账号注册登录系统，专为《云端千年-炎黄新章》游戏设计。

## 功能特点

### 用户功能
- ✅ 用户注册功能
- ✅ 用户登录功能
- ✅ 用户中心（查看资料、角色、修改密码）
- ✅ 游戏充值登记（扫码支付+手动登记）
- ✅ 表单验证（前端和后端）
- ✅ 密码强度检测
- ✅ 浮动通知提示
- ✅ 响应式设计（移动端适配）
- ✅ 错误处理和友好提示

### 管理功能
- ✅ 管理员登录识别（id=1）
- ✅ 充值记录管理
- ✅ 充值统计面板
- ✅ 充值审核功能（通过/拒绝）
- ✅ 分页和搜索筛选

## 技术栈

### 后端
- Node.js
- Express.js
- MSSQL (mssql包) - 用户账号数据库
- SQLite3 (better-sqlite3) - 充值记录数据库
- express-validator (数据验证)
- helmet (安全头)
- cors (跨域支持)

### 前端
- HTML5
- CSS3 (响应式设计)
- JavaScript (原生)
- Fetch API

### 数据库
- **Microsoft SQL Server** (用户数据)
  - 数据库名: 1000y
  - 数据表: dbo.account1000y
  - 编码: GBK

- **SQLite3** (充值记录)
  - 文件: database/recharge.db
  - 数据表: recharge_records

## 项目结构

```
1000yh/
├── config/
│   └── database.js          # MSSQL数据库配置
├── models/
│   ├── User.js              # 用户数据模型
│   └── Recharge.js          # 充值记录模型(SQLite)
├── routes/
│   ├── auth.js              # 认证路由
│   ├── recharge.js          # 充值登记路由
│   └── admin.js             # 管理员路由
├── database/
│   └── recharge.db          # SQLite3充值数据库
├── public/
│   ├── css/
│   │   └── style.css        # 样式文件
│   ├── js/
│   │   ├── auth.js          # 前端通用函数
│   │   └── recharge.js      # 充值页面脚本
│   ├── images/
│   │   └── wepay.jpg        # 收款二维码
│   ├── index.html           # 主页
│   ├── login.html           # 登录页面
│   ├── register.html        # 注册页面
│   ├── dashboard.html       # 用户中心
│   ├── recharge.html        # 充值页面
│   └── admin.html           # 管理中心
├── .env                     # 环境变量配置
├── .gitignore              # Git忽略文件
├── package.json            # 项目依赖
├── server.js               # 服务器入口文件
└── README.md               # 项目说明文档
```

## 安装和配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

编辑 `.env` 文件，设置数据库连接信息：

```env
# 数据库配置 - 云端千年-炎黄新章
DB_SERVER=1000y_sql
DB_DATABASE=1000y
DB_USER=sa
DB_PASSWORD=your_password_here
DB_ENCRYPT=false

# 服务器配置
PORT=3000
NODE_ENV=development
```

### 3. 启动项目

```bash
# 开发模式
npm run dev

# 生产模式 (PM2)
pm2 start server.js --name "1000yh"
pm2 restart 1000yh
pm2 stop 1000yh
```

## API 接口

### 用户注册
- **URL**: `POST /api/auth/register`
- **参数**:
  ```json
  {
    "account": "用户账号",
    "password": "密码",
    "confirmPassword": "确认密码",
    "email": "邮箱"
  }
  ```

### 用户登录
- **URL**: `POST /api/auth/login`
- **参数**:
  ```json
  {
    "account": "用户账号",
    "password": "密码"
  }
  ```
- **响应**:
  ```json
  {
    "success": true,
    "message": "登录成功！",
    "user": {
      "id": 1,
      "account": "用户账号",
      "email": "邮箱",
      "isAdmin": true
    }
  }
  ```

### 获取用户信息
- **URL**: `GET /api/auth/profile`
- **Headers**: `Authorization: Bearer <token>`

### 修改密码
- **URL**: `POST /api/auth/change-password`
- **Headers**: `Authorization: Bearer <token>`
- **参数**:
  ```json
  {
    "oldPassword": "原密码",
    "newPassword": "新密码"
  }
  ```

### 提交充值登记
- **URL**: `POST /api/recharge/submit`
- **参数**:
  ```json
  {
    "payment_time": "2024-01-01T12:00",
    "transaction_id": "ABC123",
    "amount": 10.00,
    "items": ["月卡"],
    "game_account": "账号",
    "character_name": "角色名",
    "server": "神武奇章",
    "remark": "备注"
  }
  ```

### 管理员 - 获取充值记录
- **URL**: `GET /api/admin/recharge-records?page=1&status=pending`
- **Headers**: `Authorization: Bearer <token>`

### 管理员 - 更新充值状态
- **URL**: `POST /api/admin/update-status`
- **参数**:
  ```json
  {
    "id": 1,
    "status": "verified"
  }
  ```

## 数据库表结构

### MSSQL - 用户表 (dbo.account1000y)

```sql
CREATE TABLE "account1000y" (
    "id" INT identity(1,1) PRIMARY KEY,
    "account" VARCHAR(20) NOT NULL,
    "password" VARCHAR(20) NOT NULL,
    "email" VARCHAR(50) NULL,
    "char1" VARCHAR(50) NULL,     -- 角色位1
    "char2" VARCHAR(50) NULL,     -- 角色位2
    "char3" VARCHAR(50) NULL,     -- 角色位3
    "char4" VARCHAR(50) NULL,     -- 角色位4
    "char5" VARCHAR(50) NULL,     -- 角色位5
    "ipaddr" VARCHAR(20) NULL,
    "makedate" VARCHAR(50) NULL,  -- 注册时间
    "lastdate" VARCHAR(50) NULL,  -- 游戏最后登录时间
    "updated_at" DATETIME NULL
);
```

### SQLite3 - 充值记录表 (recharge_records)

```sql
CREATE TABLE recharge_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_time DATETIME NOT NULL,
    transaction_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    items TEXT NOT NULL,           -- JSON数组
    game_account TEXT NOT NULL,
    character_name TEXT NOT NULL,
    server TEXT NOT NULL,
    remark TEXT,
    status TEXT DEFAULT 'pending', -- pending/verified/rejected
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 页面说明

### 主页 (index.html)
- 游戏诗句展示
- 快速导航入口
- 登录状态检测

### 注册页面 (register.html)
- 必填：账号、密码、确认密码、邮箱
- 实时密码强度检测
- 客户端和服务端双重验证

### 登录页面 (login.html)
- 账号密码登录
- 自动更新登录状态
- 区分普通用户和管理员

### 用户中心 (dashboard.html)
- 显示基本信息（账号、邮箱）
- 显示游戏角色（char1~char5）
- 修改密码功能
- 管理员入口（id=1）

### 充值页面 (recharge.html)
- 收款码展示
- 充值说明
- 充值登记表单
- 浮动通知提示

### 管理中心 (admin.html)
- 充值统计面板
- 充值记录列表
- 审核操作（通过/拒绝）
- 分页和搜索功能

## 字段更新规则

| 字段 | 注册 | 网页登录 | 修改密码 | 游戏登录 | 说明 |
|------|------|----------|----------|----------|------|
| makedate | ✅ | ❌ | ❌ | ❌ | 注册时间 |
| lastdate | ❌ | ❌ | ❌ | ✅ | 游戏最后登录时间（仅游戏客户端更新）|
| ipaddr | ✅ | ❌ | ✅ | ❌ | 操作IP |
| updated_at | ❌ | ❌ | ✅ | ❌ | 资料更新时间 |

## 移动端适配

- 响应式布局（768px、480px 断点）
- 导航栏自动折叠
- 表格横向滚动
- 触摸友好的交互

## 安全考虑

1. **输入验证**: 前后端双重验证（express-validator）
2. **SQL注入**: 参数化查询
3. **XSS防护**: textContent 防止 XSS
4. **CSRF**: 建议生产环境添加 CSRF 令牌
5. **密码加密**: 当前使用明文，建议生产环境使用 bcrypt
6. **IP记录**: 关键操作记录客户端IP

## 许可证

MIT License
