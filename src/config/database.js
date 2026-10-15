const mysql = require('mysql2/promise');
const env = require('./env');

class Database {
  constructor(options = {}) {
    this.pool = mysql.createPool({
      host: options.host || env.dbHost,
      port: options.port || env.dbPort,
      user: options.user || env.dbUser,
      password: options.password ?? env.dbPassword,
      database: options.database || env.dbName,
      waitForConnections: true,
      connectionLimit: options.connectionLimit || env.dbConnectionLimit,
      queueLimit: options.queueLimit ?? env.dbQueueLimit,
      charset: 'utf8mb4',
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
    });
  }

  query(sql, parameters = []) {
    return this.pool.query(sql, parameters);
  }
  execute(sql, parameters = []) {
    return this.pool.execute(sql, parameters);
  }
  getConnection() {
    return this.pool.getConnection();
  }

  async ping() {
    await this.pool.query('SELECT 1 AS healthy');
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
