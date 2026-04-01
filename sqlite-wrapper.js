const { createClient } = require('@libsql/client');

const TURSO_URL = process.env.TURSO_URL || 'libsql://booking-log-ai-framan.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUwNTYxOTYsImlkIjoiMDE5ZDQ5OTYtZjIwMS03NmMyLWJhMzItODdmNzk1NTQ0YTg1IiwicmlkIjoiMjhkOWJjZjYtYjAzYi00MGIzLTk5YWUtZDU1MDFiYzU0ZWJhIn0.kYAT-iRlmtS0rBuonyMj5GNEi19rWIl68--DWrxn9xyFShQIlBmKLpo6aFV3Sdrni-c2GVkafqdIILTBbJ8WAw';

let db = null;

// ─── TIMEZONE HELPERS ─────────────────────────────────
// Returns current time in Hong Kong as SQLite DATETIME string (YYYY-MM-DD HH:mm:ss)
function nowHK() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).replace('T', ' ');
}

async function initDb() {
  const config = {
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN
  };
  
  db = createClient(config);
  
  // Create tables if not exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      slot TEXT NOT NULL,
      time TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      is_private_event INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_id TEXT,
      actor_id INTEGER,
      actor_name TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  
  // Create admin user if not exists
  const bcrypt = require('bcryptjs');
  const hashed = bcrypt.hashSync('admin123', 10);
  
  try {
    await db.execute({
      sql: "INSERT INTO users (email, password, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ['admin@bookinglog.com', hashed, 'Administrator', 'admin', 'active', nowHK()]
    });
    console.log('Admin created: admin@bookinglog.com / admin123');
  } catch (e) {
    // Admin already exists, ignore
  }
  
  return db;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function run(sql, params = []) {
  const result = db.execute({ sql, args: params });
  return {
    lastInsertRowid: result.lastInsertRowid || 0,
    changes: result.rowsAffected || 0
  };
}

function exec(sql) {
  db.execute(sql);
}

module.exports = { initDb, get, all, run, exec, nowHK };
