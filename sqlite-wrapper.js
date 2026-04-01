const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dhnje8LR9bEN@ep-crimson-mud-a158k597-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

let db = null;

// ─── TIMEZONE HELPERS ─────────────────────────────────
// Returns current time in Hong Kong as ISO string
function nowHK() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).replace('T', ' ');
}

async function initDb() {
  db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  await db.connect();
  
  // Create tables if not exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      slot TEXT NOT NULL,
      time TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      is_private_event INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      target_id TEXT,
      actor_id INTEGER,
      actor_name TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create admin user if not exists
  const bcrypt = require('bcryptjs');
  const hashed = bcrypt.hashSync('admin123', 10);
  
  try {
    await db.query(
      "INSERT INTO users (email, password, display_name, role, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      ['admin@bookinglog.com', hashed, 'Administrator', 'admin', 'active', nowHK()]
    );
    console.log('Admin created: admin@bookinglog.com / admin123');
  } catch (e) {
    // Admin already exists, ignore
  }
  
  return db;
}

function get(sql, params = []) {
  const result = db.query(sql, params);
  return result.rows[0] || null;
}

function all(sql, params = []) {
  const result = db.query(sql, params);
  return result.rows || [];
}

function run(sql, params = []) {
  const result = db.query(sql, params);
  return {
    lastInsertRowid: result.rows[0]?.id || 0,
    changes: result.rowCount || 0
  };
}

function exec(sql) {
  db.query(sql);
}

module.exports = { initDb, get, all, run, exec, nowHK };
