const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'booking.db');

let db = null;

// ─── TIMEZONE HELPERS ─────────────────────────────────
// Returns current time in Hong Kong as SQLite DATETIME string (YYYY-MM-DD HH:mm:ss)
function nowHK() {
  // 'sv-SE' format gives YYYY-MM-DD HH:mm:ss — perfect for SQLite
  // Combined with timeZone: 'Asia/Hong_Kong' gives HK local time
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).replace('T', ' ');
}

async function initDb() {
  const SQL = await initSqlJs();
  
  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_id TEXT,
      actor_id INTEGER,
      actor_name TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adminExists = db.exec("SELECT id FROM users WHERE email = 'admin@bookinglog.com'");
  if (adminExists.length === 0 || adminExists[0].values.length === 0) {
    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync('admin123', 10);
    db.run(
      "INSERT INTO users (email, password, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ['admin@bookinglog.com', hashed, 'Administrator', 'admin', 'active', nowHK()]
    );
    console.log('Admin created: admin@bookinglog.com / admin123');
  }

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('Error saving database:', e);
  }
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
  db.run(sql, params);
  saveDb();
  return {
    lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0,
    changes: db.getRowsModified()
  };
}

function exec(sql) {
  db.run(sql);
  saveDb();
}

module.exports = { initDb, get, all, run, exec, saveDb, nowHK };
