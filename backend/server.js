const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'booking-log-secret-key-2024';
const MAX_GUESTS_PER_SLOT = 16;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const db = new Database(path.join(__dirname, 'booking.db'));

db.exec(`
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

const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@bookinglog.com');
if (!adminExists) {
  const hashed = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (email, password, display_name, role) VALUES (?, ?, ?, ?)').run(
    'admin@bookinglog.com', hashed, 'Administrator', 'admin'
  );
  console.log('Admin created: admin@bookinglog.com / admin123');
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

function logAction(action, targetId, actorId, actorName, details) {
  db.prepare(`
    INSERT INTO system_logs (action, target_id, actor_id, actor_name, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, targetId, actorId, actorName, details ? JSON.stringify(details) : null);
}

// ─── AUTH ─────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'All fields required' } });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (email, password, display_name, status) VALUES (?, ?, ?, ?)').run(email, hashed, display_name, 'pending');
  const user = { id: result.lastInsertRowid, email, display_name, role: 'member', status: 'pending' };
  logAction('user_registered', String(user.id), user.id, display_name, { email, display_name });
  res.json({
    data: {
      message: 'Registration submitted. Awaiting admin approval.',
      user
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: { code: 'NOT_APPROVED', message: 'Account pending approval. Please wait for admin to approve.' } });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: { code: 'REJECTED', message: 'Account rejected. Please contact administrator.' } });
  }
  const payload = { id: user.id, email: user.email, role: user.role, display_name: user.display_name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  logAction('user_login', null, user.id, user.display_name, { email: user.email });
  res.json({ data: { user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }, token } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json({ data: user });
});

// ─── BOOKINGS ────────────────────────────────────────────

app.get('/api/bookings', authenticate, (req, res) => {
  let bookings;
  if (req.user.role === 'admin') {
    bookings = db.prepare(`
      SELECT b.*, u.email as user_email, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id
      ORDER BY b.date DESC, b.slot DESC
    `).all();
  } else {
    bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC, slot DESC').all(req.user.id);
  }
  res.json({ data: bookings });
});

app.get('/api/bookings/calendar/:year/:month', authenticate, (req, res) => {
  const { year, month } = req.params;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  let bookings;
  if (req.user.role === 'admin') {
    bookings = db.prepare(`
      SELECT b.*, u.email as user_email, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id
      WHERE b.date >= ? AND b.date <= ?
    `).all(startDate, endDate);
  } else {
    bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? AND date >= ? AND date <= ?').all(req.user.id, startDate, endDate);
  }
  res.json({ data: bookings });
});

// Create booking - status starts as 'pending'
app.post('/api/bookings', authenticate, (req, res) => {
  const { date, slot, time, party_size, customer_name, customer_phone, notes, is_private_event } = req.body;

  if (!date || !slot || !customer_name) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } });
  }

  if (!['lunch', 'dinner'].includes(slot)) {
    return res.status(400).json({ error: { code: 'INVALID_SLOT', message: 'Slot must be lunch or dinner' } });
  }

  const isPrivate = is_private_event ? 1 : 0;
  const effectivePartySize = isPrivate ? 0 : (parseInt(party_size) || 2);

  if (!isPrivate && (effectivePartySize < 1 || effectivePartySize > 20)) {
    return res.status(400).json({ error: { code: 'INVALID_PARTY_SIZE', message: 'Party size must be 1-20' } });
  }

  // Check if slot has a private event
  const privateEvent = db.prepare(
    'SELECT id FROM bookings WHERE date = ? AND slot = ? AND is_private_event = 1 AND status != ?'
  ).get(date, slot, 'cancelled');

  if (privateEvent) {
    return res.status(409).json({
      error: { code: 'SLOT_LOCKED', message: 'This session is locked (Private Event)' }
    });
  }

  // Check total guests for this slot (exclude cancelled, exclude private events from count)
  const guests = db.prepare(
    'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND status != ? AND is_private_event = 0'
  ).get(date, slot, 'cancelled');

  if (guests.total >= MAX_GUESTS_PER_SLOT) {
    return res.status(409).json({
      error: { code: 'SLOT_LOCKED', message: `This session is fully booked (${MAX_GUESTS_PER_SLOT} guests limit reached)` }
    });
  }

  if (!isPrivate && guests.total + effectivePartySize > MAX_GUESTS_PER_SLOT) {
    return res.status(409).json({
      error: { code: 'EXCEEDS_CAPACITY', message: `Only ${MAX_GUESTS_PER_SLOT - guests.total} seats remaining in this session` }
    });
  }

  const result = db.prepare(`
    INSERT INTO bookings (user_id, date, slot, time, party_size, customer_name, customer_phone, notes, status, is_private_event)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    req.user.id, date, slot, isPrivate ? '00:00' : (time || '00:00'),
    effectivePartySize, customer_name, customer_phone || '', notes || '', isPrivate ? 1 : 0
  );

  const booking = db.prepare(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).get(result.lastInsertRowid);

  logAction(isPrivate ? 'slot_private_locked' : 'booking_created', String(booking.id), req.user.id, req.user.display_name, {
    customer_name, slot, date, is_private_event: isPrivate
  });

  res.json({ data: booking });
});

// Confirm a booking
app.patch('/api/bookings/:id/confirm', authenticate, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admin can confirm bookings' } });
  }

  const oldStatus = booking.status;
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('confirmed', req.params.id);
  const updated = db.prepare(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).get(req.params.id);

  logAction('booking_confirmed', String(updated.id), req.user.id, req.user.display_name, {
    customer_name: updated.customer_name, slot: updated.slot, date: updated.date, time: updated.time,
    previous_status: oldStatus
  });

  res.json({ data: updated });
});

// Update booking (edit)
app.patch('/api/bookings/:id', authenticate, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot edit this booking' } });
  }

  const { customer_name, customer_phone, time, party_size, notes, status } = req.body;

  // If changing party_size, check capacity
  if (party_size && party_size !== booking.party_size) {
    const guests = db.prepare(
      'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND id != ? AND status != ?'
    ).get(booking.date, booking.slot, booking.id, 'cancelled');
    if (guests.total + party_size > MAX_GUESTS_PER_SLOT) {
      return res.status(409).json({
        error: { code: 'EXCEEDS_CAPACITY', message: `Changing party size would exceed ${MAX_GUESTS_PER_SLOT} guest limit` }
      });
    }
  }

  const changes = {};
  if (customer_name !== undefined) changes.customer_name = { from: booking.customer_name, to: customer_name };
  if (customer_phone !== undefined) changes.customer_phone = { from: booking.customer_phone || '', to: customer_phone };
  if (time !== undefined) changes.time = { from: booking.time, to: time };
  if (party_size !== undefined) changes.party_size = { from: booking.party_size, to: party_size };
  if (notes !== undefined) changes.notes = { from: booking.notes || '', to: notes };
  if (status !== undefined) changes.status = { from: booking.status, to: status };

  db.prepare(`
    UPDATE bookings SET
      customer_name = COALESCE(?, customer_name),
      customer_phone = COALESCE(?, customer_phone),
      time = COALESCE(?, time),
      party_size = COALESCE(?, party_size),
      notes = COALESCE(?, notes),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(
    customer_name || null,
    customer_phone || null,
    time || null,
    party_size || null,
    notes || null,
    status || null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`
  ).get(req.params.id);

  logAction('booking_modified', String(updated.id), req.user.id, req.user.display_name, {
    customer_name: updated.customer_name, date: updated.date, slot: updated.slot,
    changes
  });

  res.json({ data: updated });
});

app.delete('/api/bookings/:id', authenticate, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot cancel this booking' } });
  }
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', req.params.id);
  logAction('booking_cancelled', String(booking.id), req.user.id, req.user.display_name, {
    customer_name: booking.customer_name, date: booking.date, slot: booking.slot,
    time: booking.time, party_size: booking.party_size
  });
  res.json({ data: { message: 'Booking cancelled' } });
});

// ─── USER MANAGEMENT ────────────────────────────────────

// Get pending users (admin only)
app.get('/api/users/pending', authenticate, adminOnly, (req, res) => {
  const users = db.prepare(
    "SELECT id, email, display_name, role, status, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC"
  ).all();
  const count = users.length;
  res.json({ data: { users, count } });
});

// Approve user (admin only)
app.patch('/api/users/:id/approve', authenticate, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (user.status !== 'pending') {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
  }
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  logAction('user_approved', String(user.id), req.user.id, req.user.display_name, {
    email: user.email, display_name: user.display_name
  });
  res.json({ data: { message: 'User approved', user: { ...user, status: 'active' } } });
});

// Reject user (admin only)
app.patch('/api/users/:id/reject', authenticate, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (user.status !== 'pending') {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
  }
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(req.params.id);
  logAction('user_rejected', String(user.id), req.user.id, req.user.display_name, {
    email: user.email, display_name: user.display_name
  });
  res.json({ data: { message: 'User rejected' } });
});

// ─── USERS ───────────────────────────────────────────────

app.get('/api/users', authenticate, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, role, status, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ data: users });
});

// ─── SYSTEM LOGS ────────────────────────────────────────

app.get('/api/system-logs', authenticate, adminOnly, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];

  if (req.query.start_date) {
    where += ' AND created_at >= ?';
    params.push(req.query.start_date + 'T00:00:00');
  }
  if (req.query.end_date) {
    where += ' AND created_at <= ?';
    params.push(req.query.end_date + 'T23:59:59');
  }
  if (req.query.action) {
    where += ' AND action = ?';
    params.push(req.query.action);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM system_logs WHERE ${where}`).get(...params).cnt;
  const logs = db.prepare(`
    SELECT * FROM system_logs WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ data: { logs, total, page, pages: Math.ceil(total / limit) } });
});

// ─── SLOT CAPACITY ──────────────────────────────────────

app.get('/api/slots/:date/:slot/capacity', authenticate, (req, res) => {
  const { date, slot } = req.params;
  const guests = db.prepare(
    'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND status != ? AND is_private_event = 0'
  ).get(date, slot, 'cancelled');
  const privateEvent = db.prepare(
    'SELECT id FROM bookings WHERE date = ? AND slot = ? AND is_private_event = 1 AND status != ?'
  ).get(date, slot, 'cancelled');
  const isLocked = guests.total >= MAX_GUESTS_PER_SLOT || !!privateEvent;
  res.json({
    data: {
      slot, date,
      total_guests: guests.total,
      max_guests: MAX_GUESTS_PER_SLOT,
      available: Math.max(0, MAX_GUESTS_PER_SLOT - guests.total),
      is_locked: isLocked,
      is_private: !!privateEvent
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Booking Log API running on http://localhost:${PORT}`);
  console.log(`Admin login: admin@bookinglog.com / admin123`);
});
