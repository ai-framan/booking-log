const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dhnje8LR9bEN@ep-crimson-mud-a158k597-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

let db = null;

// ─── TIMEZONE HELPERS ─────────────────────────────────
function nowHK() {
  // Use CURRENT_TIMESTAMP at database level for correct timezone
  return new Date().toISOString(); // Will be handled by NOW() at DB
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
      created_at TIMESTAMP DEFAULT NOW()
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
      created_at TIMESTAMP DEFAULT NOW()
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
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  // Create admin user if not exists
  const bcrypt = require('bcryptjs');
  const hashed = bcrypt.hashSync('admin123', 10);
  
  try {
    await db.query(
      "INSERT INTO users (email, password, display_name, role, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
      ['admin@bookinglog.com', hashed, 'Administrator', 'admin', 'active']
    );
    console.log('Admin initialized: admin@bookinglog.com / admin123');
  } catch (e) {
    console.log('Admin init error:', e.message);
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
  const result = db.query(sql + ' RETURNING id', params);
  return {
    lastInsertRowid: result.rows[0]?.id || 0,
    changes: result.rowCount || 0
  };
}

function exec(sql) {
  db.query(sql);
}

module.exports = { initDb, get, all, run, exec, nowHK };
