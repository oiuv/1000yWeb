'use strict';
const sql = require('mssql');
let poolPromise;
function connectToDatabase() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool({
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
      port: Number(process.env.DB_PORT || 1433),
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERTIFICATE !== 'false',
        enableArithAbort: true
      },
      requestTimeout: 30000
    });
    pool.on('error', error => console.error('MSSQL connection error:', error.code || 'DB_ERROR'));
    poolPromise = pool.connect().catch(error => { poolPromise = null; throw error; });
  }
  return poolPromise;
}
async function executeQuery(query, params = {}) {
  const pool = await connectToDatabase();
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) request.input(key, value);
  return request.query(query);
}
async function closeDatabase() {
  if (poolPromise) { const pool = await poolPromise; poolPromise = null; await pool.close(); }
}
module.exports = { connectToDatabase, executeQuery, closeDatabase };
