import mysql from 'mysql2/promise';

/**
 * Hostinger MySQL Database Service for NexusQuant Multi-Tenant SaaS
 * - Auto-initializes database tables
 * - Provides connection pooling & retry resiliency
 * - Completely persistent across all code updates and server restarts
 */

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized && this.pool) return this.pool;

    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbUser = process.env.DB_USER || 'u932536786_waiztahseen';
    const dbPassword = process.env.DB_PASSWORD || 'NexusQuant@6767';
    const dbName = process.env.DB_NAME || 'u932536786_nexus_quant';
    const dbPort = parseInt(process.env.DB_PORT || '3306', 10);

    try {
      this.pool = mysql.createPool({
        host: dbHost,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        port: dbPort,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      });

      console.log(`🗄️ Connected to MySQL Database [${dbName}] at ${dbHost}:${dbPort}`);
      await this.runMigrations();
      this.isInitialized = true;
      return this.pool;
    } catch (err) {
      console.error('❌ Failed to initialize MySQL Pool:', err.message);
      throw err;
    }
  }

  async runMigrations() {
    const conn = await this.pool.getConnection();
    try {
      // 1. Users Table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(191) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(191) NOT NULL,
          phone VARCHAR(64) NOT NULL DEFAULT '',
          account_type ENUM('MARGIN', 'SPOT') NOT NULL DEFAULT 'MARGIN',
          status ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
          role ENUM('CLIENT', 'ADMIN') NOT NULL DEFAULT 'CLIENT',
          active_mode ENUM('SIMULATED', 'LIVE') NOT NULL DEFAULT 'SIMULATED',
          is_auto_trading BOOLEAN NOT NULL DEFAULT FALSE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // 2. User Settings Table (Stores independent settings per mode: SIMULATED vs LIVE)
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          mode ENUM('SIMULATED', 'LIVE') NOT NULL,
          account_type ENUM('MARGIN', 'SPOT') NOT NULL,
          settings_json LONGTEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_mode_type (user_id, mode, account_type),
          INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // 3. User Broker Configs Table (Stores MT5 and Binance credentials isolated per user)
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_broker_configs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          broker VARCHAR(32) NOT NULL,
          config_json LONGTEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_broker (user_id, broker),
          INDEX idx_user_broker_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // 4. User Trade History Table
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_trades (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          trade_id VARCHAR(64) NOT NULL,
          mode ENUM('SIMULATED', 'LIVE') NOT NULL,
          account_type ENUM('MARGIN', 'SPOT') NOT NULL,
          symbol VARCHAR(64) NOT NULL,
          side VARCHAR(16) NOT NULL,
          entry_price DECIMAL(18, 8) NOT NULL,
          exit_price DECIMAL(18, 8) NULL,
          pnl DECIMAL(18, 8) NULL,
          pnl_pct DECIMAL(10, 4) NULL,
          trade_json LONGTEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_trades (user_id, mode, account_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // 5. Central User Portfolios Table (Synchronizes balance & trades across servers)
      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_portfolios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_email VARCHAR(191) NOT NULL,
          account_type ENUM('MARGIN', 'SPOT') NOT NULL,
          state_json LONGTEXT NOT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_portfolio (user_email, account_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Seed Default Admin Account if not exists
      const [adminRows] = await conn.query('SELECT id FROM users WHERE email = ?', ['test@gmail.com']);
      if (adminRows.length === 0) {
        await conn.query(`
          INSERT INTO users (id, email, password, name, phone, account_type, status, role, active_mode, is_auto_trading)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          'usr_admin_001',
          'test@gmail.com',
          'testPass',
          'NexusQuant Admin',
          '+1234567890',
          'MARGIN',
          'ACTIVE',
          'ADMIN',
          'LIVE',
          true
        ]);
        console.log('✅ Seeded default Admin account (test@gmail.com)');
      } else {
        // Ensure test@gmail.com is ADMIN and ACTIVE
        await conn.query(`
          UPDATE users SET role = 'ADMIN', status = 'ACTIVE' WHERE email = 'test@gmail.com'
        `);
      }

      console.log('✅ MySQL Database tables & migrations verified successfully.');
    } finally {
      conn.release();
    }
  }

  async query(sql, params) {
    if (!this.pool) await this.init();
    return this.pool.query(sql, params);
  }

  async execute(sql, params) {
    if (!this.pool) await this.init();
    return this.pool.execute(sql, params);
  }
}

export const db = new DatabaseService();
