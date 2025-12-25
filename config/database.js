const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT) || 1433,
  encrypt: JSON.parse(process.env.DB_ENCRYPT || 'false'),
  trustServerCertificate: true,
  options: {
    enableArithAbort: true,
    trustServerCertificate: true,
    charset: 'GBK'
  },
  requestTimeout: 30000
};

let pool;

const connectToDatabase = async () => {
  try {
    if (pool && pool.connected) {
      return pool;
    }

    pool = await sql.connect(config);
    console.log('成功连接到数据库');
    return pool;
  } catch (error) {
    console.error('数据库连接失败:', error);
    throw error;
  }
};

const executeQuery = async (query, params = {}) => {
  try {
    const pool = await connectToDatabase();
    const request = pool.request();

    // 添加参数
    Object.keys(params).forEach(key => {
      request.input(key, params[key]);
    });

    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error('查询执行失败:', error);
    throw error;
  }
};

module.exports = {
  connectToDatabase,
  executeQuery,
  sql
};