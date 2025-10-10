# 云端千年-炎黄新章 - 账号注册系统

这是一个基于 Node.js 和 MSSQL 数据库的游戏账号注册登录系统，专为《云端千年-炎黄新章》游戏设计。

## 功能特点

- ✅ 用户注册功能
- ✅ 用户登录功能
- ✅ 表单验证（前端和后端）
- ✅ 密码强度检测
- ✅ 用户信息展示
- ✅ 响应式设计
- ✅ 错误处理和友好提示

## 技术栈

### 后端
- Node.js
- Express.js
- MSSQL (mssql包)
- express-validator (数据验证)
- bcryptjs (密码加密 - 当前版本使用明文存储，生产环境建议加密)

### 前端
- HTML5
- CSS3 (响应式设计)
- JavaScript (原生)
- Fetch API

### 数据库
- Microsoft SQL Server
- 数据库名: 1000y
- 数据表: dbo.account1000y

## 项目结构

```
1000yh/
├── config/
│   └── database.js          # 数据库配置
├── models/
│   └── User.js              # 用户数据模型
├── routes/
│   └── auth.js              # 认证路由
├── public/
│   ├── css/
│   │   └── style.css        # 样式文件
│   ├── js/
│   │   └── auth.js          # 前端通用函数
│   ├── index.html           # 主页
│   ├── login.html           # 登录页面
│   ├── register.html        # 注册页面
│   └── dashboard.html       # 用户中心
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

# 生产模式
npm start
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
    "username": "用户名(可选)",
    "email": "邮箱(可选)",
    "telephone": "手机号(可选)",
    "birth": "出生日期(可选)",
    "nativenumber": "身份证号(可选)",
    "address": "地址(可选)"
  }
  ```
- **响应**:
  ```json
  {
    "success": true,
    "message": "注册成功！"
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
      "account": "用户账号",
      "username": "用户名",
      "email": "邮箱",
      "lastdate": "最后登录时间"
    }
  }
  ```

## 数据库表结构

项目使用现有的 `dbo.account1000y` 表：

```sql
CREATE TABLE "account1000y" (
    "id" INT identity(1,1) PRIMARY KEY,
    "account" VARCHAR(20) NOT NULL,
    "password" VARCHAR(20) NOT NULL,
    "char1" VARCHAR(50) NULL DEFAULT NULL,
    "char2" VARCHAR(50) NULL DEFAULT NULL,
    "char3" VARCHAR(50) NULL DEFAULT NULL,
    "char4" VARCHAR(50) NULL DEFAULT NULL,
    "char5" VARCHAR(50) NULL DEFAULT NULL,
    "ipaddr" VARCHAR(20) NULL DEFAULT NULL,
    "username" VARCHAR(20) NULL DEFAULT NULL,
    "birth" VARCHAR(20) NULL DEFAULT NULL,
    "telephone" VARCHAR(20) NULL DEFAULT NULL,
    "makedate" VARCHAR(50) NULL DEFAULT NULL,
    "lastdate" VARCHAR(50) NULL DEFAULT NULL,
    "address" VARCHAR(50) NULL DEFAULT NULL,
    "email" VARCHAR(50) NULL DEFAULT NULL,
    "nativenumber" VARCHAR(20) NULL DEFAULT NULL,
    "masterkey" VARCHAR(20) NULL DEFAULT NULL,
    "ptname" VARCHAR(20) NULL DEFAULT NULL,
    "ptnativenumber" VARCHAR(20) NULL DEFAULT NULL,
    "avatar" VARCHAR(255) NULL DEFAULT NULL,
    "introduction" VARCHAR(255) NULL DEFAULT NULL,
    "notification_count" INT NULL DEFAULT NULL,
    "remember_token" VARCHAR(255) NULL DEFAULT NULL,
    "updated_at" DATETIME NULL DEFAULT NULL
);
```

## 页面说明

### 主页 (index.html)
- 游戏介绍和快速入口
- 检测登录状态
- 提供登录和注册入口

### 注册页面 (register.html)
- 必填字段：账号、密码、确认密码
- 可选字段：用户名、邮箱、手机号、出生日期、身份证号、地址
- 实时密码强度检测
- 客户端和服务端双重验证

### 登录页面 (login.html)
- 账号密码登录
- 记住登录状态
- 自动跳转到用户中心

### 用户中心 (dashboard.html)
- 显示用户基本信息
- 提供退出登录功能
- 游戏入口（预留）

## 安全考虑

⚠️ **重要安全提示**：

1. **密码存储**: 当前版本使用明文存储密码，生产环境强烈建议使用 bcrypt 进行密码加密
2. **输入验证**: 已实现前后端双重验证
3. **SQL注入**: 使用参数化查询防止SQL注入
4. **XSS防护**: 基础的XSS防护已实现
5. **CSRF防护**: 建议在生产环境中添加CSRF令牌

## 开发建议

### 密码加密升级
建议在 User.js 中添加密码加密：

```javascript
const bcrypt = require('bcryptjs');

// 注册时加密密码
const saltRounds = 10;
const hashedPassword = await bcrypt.hash(password, saltRounds);

// 登录时验证密码
const isValid = await bcrypt.compare(password, user.password);
```

### 添加Session管理
建议添加 express-session 来管理用户会话：

```javascript
const session = require('express-session');
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
```

## 许可证

MIT License

## 联系方式

如有问题或建议，请联系项目维护者。