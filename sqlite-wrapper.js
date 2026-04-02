const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dhnje8LR9bEN@ep-crimson-mud-a158k597-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&uselibpqcompat=true';

let db = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

// ─── TIMEZONE HELPERS ─────────────────────────────────
function nowHK() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).replace('T', ' ');
}

// ─── CONNECTION HANDLING ────────────────────────────────
async function connect() {
  if (db) {
    try {
      db.end();
    } catch (e) {
      // ignore
    }
  }
  
  db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 5
  });
  
  db.on('error', (err) => {
    console.error('Unexpected database error:', err.message);
  });
  
  db.on('end', () => {
    console.log('Database connection ended');
  });
  
  await db.connect();
  reconnectAttempts = 0;
  return db;
}

async function initDb() {
  await connectWithRetry();
  
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

async function connectWithRetry() {
  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    try {
      console.log(`Connecting to database (attempt ${reconnectAttempts + 1})...`);
      await connect();
      console.log('Database connected successfully');
      return;
    } catch (err) {
      reconnectAttempts++;
      const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1);
      console.error(`Database connection failed: ${err.message}`);
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        console.log(`Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error('Max reconnection attempts reached');
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── WRAPPER FOR POSTGRESQL (same interface as SQLite version) ────────

async function ensureConnection() {
  if (!db || db._ended) {
    await connectWithRetry();
  }
}

async function get(sql, params = []) {
  try {
    await ensureConnection();
    const result = await db.query(sql, params);
    return result.rows[0] || null;
  } catch (err) {
    if (isConnectionError(err)) {
      await connectWithRetry();
      const result = await db.query(sql, params);
      return result.rows[0] || null;
    }
    throw err;
  }
}

async function all(sql, params = []) {
  try {
    await ensureConnection();
    const result = await db.query(sql, params);
    return result.rows || [];
  } catch (err) {
    if (isConnectionError(err)) {
      await connectWithRetry();
      const result = await db.query(sql, params);
      return result.rows || [];
    }
    throw err;
  }
}

async function run(sql, params = []) {
  try {
    await ensureConnection();
    const hasReturning = sql.toUpperCase().includes('RETURNING');
    if (!hasReturning && (sql.toUpperCase().includes('INSERT') || sql.toUpperCase().includes('UPDATE') || sql.toUpperCase().includes('DELETE'))) {
      sql = sql + ' RETURNING id';
    }
    const result = await db.query(sql, params);
    return {
      lastInsertRowid: result.rows[0]?.id || 0,
      changes: result.rowCount || 0
    };
  } catch (err) {
    if (isConnectionError(err)) {
      await connectWithRetry();
      const hasReturning = sql.toUpperCase().includes('RETURNING');
      if (!hasReturning && (sql.toUpperCase().includes('INSERT') || sql.toUpperCase().includes('UPDATE') || sql.toUpperCase().includes('DELETE'))) {
        sql = sql + ' RETURNING id';
      }
      const result = await db.query(sql, params);
      return {
        lastInsertRowid: result.rows[0]?.id || 0,
        changes: result.rowCount || 0
      };
    }
    throw err;
  }
}

async function exec(sql) {
  try {
    await ensureConnection();
    await db.query(sql);
  } catch (err) {
    if (isConnectionError(err)) {
      await connectWithRetry();
      await db.query(sql);
      return;
    }
    throw err;
  }
}

function isConnectionError(err) {
  return err.code === 'ECONNREFUSED' || 
         err.code === 'ENOTFOUND' ||
         err.code === 'ECONNRESET' ||
         err.code === 'ETIMEDOUT' ||
         err.message.includes('Connection terminated') ||
         err.message.includes('connection') ||
         err.message.includes('Connection refused');
}

module.exports = { initDb, get, all, run, exec, nowHK };
