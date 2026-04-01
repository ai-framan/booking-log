const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./sqlite-wrapper');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'booking-log-secret-key-2024';
const MAX_GUESTS_PER_SLOT = 16;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── AUTH MIDDLEWARE ────────────────────────────────────

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
  db.run(
    'INSERT INTO system_logs (action, target_id, actor_id, actor_name, details) VALUES (?, ?, ?, ?, ?)',
    [action, targetId, actorId, actorName, details ? JSON.stringify(details) : null]
  );
}

// ─── AUTH ─────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'All fields required' } });
  }
  const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const result = db.run('INSERT INTO users (email, password, display_name, status) VALUES (?, ?, ?, ?)', [email, hashed, display_name, 'pending']);
  const user = { id: result.lastInsertRowid, email, display_name, role: 'member', status: 'pending' };
  logAction('user_registered', String(user.id), user.id, display_name, { email, display_name });
  res.json({ data: { message: 'Registration submitted. Awaiting admin approval.', user } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
  }
  const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
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
  const user = db.get('SELECT id, email, display_name, role FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json({ data: user });
});

// ─── BOOKINGS ────────────────────────────────────────────

app.get('/api/bookings', authenticate, (req, res) => {
  let bookings;
  if (req.user.role === 'admin') {
    bookings = db.all(`
      SELECT b.*, u.email as user_email, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id
      ORDER BY b.date DESC, b.slot DESC
    `);
  } else {
    bookings = db.all('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC, slot DESC', [req.user.id]);
  }
  res.json({ data: bookings });
});

app.get('/api/bookings/calendar/:year/:month', authenticate, (req, res) => {
  const { year, month } = req.params;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  let bookings;
  if (req.user.role === 'admin') {
    bookings = db.all(`
      SELECT b.*, u.email as user_email, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id
      WHERE b.date >= ? AND b.date <= ?
    `, [startDate, endDate]);
  } else {
    bookings = db.all('SELECT * FROM bookings WHERE user_id = ? AND date >= ? AND date <= ?', [req.user.id, startDate, endDate]);
  }
  res.json({ data: bookings });
});

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

  const privateEvent = db.get(
    'SELECT id FROM bookings WHERE date = ? AND slot = ? AND is_private_event = 1 AND status != ?',
    [date, slot, 'cancelled']
  );

  if (privateEvent) {
    return res.status(409).json({ error: { code: 'SLOT_LOCKED', message: 'This session is locked (Private Event)' } });
  }

  const guests = db.get(
    'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND status != ? AND is_private_event = 0',
    [date, slot, 'cancelled']
  );

  if (guests.total >= MAX_GUESTS_PER_SLOT) {
    return res.status(409).json({ error: { code: 'SLOT_LOCKED', message: `This session is fully booked (${MAX_GUESTS_PER_SLOT} guests limit reached)` } });
  }

  if (!isPrivate && guests.total + effectivePartySize > MAX_GUESTS_PER_SLOT) {
    return res.status(409).json({ error: { code: 'EXCEEDS_CAPACITY', message: `Only ${MAX_GUESTS_PER_SLOT - guests.total} seats remaining in this session` } });
  }

  const result = db.run(`
    INSERT INTO bookings (user_id, date, slot, time, party_size, customer_name, customer_phone, notes, status, is_private_event)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `, [
    req.user.id, date, slot, isPrivate ? '00:00' : (time || '00:00'),
    effectivePartySize, customer_name, customer_phone || '', notes || '', isPrivate ? 1 : 0
  ]);

  const booking = db.get(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`,
    [result.lastInsertRowid]
  );

  logAction(isPrivate ? 'slot_private_locked' : 'booking_created', String(booking.id), req.user.id, req.user.display_name, {
    customer_name, slot, date, is_private_event: isPrivate
  });

  res.json({ data: booking });
});

app.patch('/api/bookings/:id/confirm', authenticate, (req, res) => {
  const booking = db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admin can confirm bookings' } });
  }

  const oldStatus = booking.status;
  db.run('UPDATE bookings SET status = ? WHERE id = ?', ['confirmed', req.params.id]);
  const updated = db.get(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`,
    [req.params.id]
  );

  logAction('booking_confirmed', String(updated.id), req.user.id, req.user.display_name, {
    customer_name: updated.customer_name, slot: updated.slot, date: updated.date, time: updated.time,
    previous_status: oldStatus
  });

  res.json({ data: updated });
});

app.patch('/api/bookings/:id', authenticate, (req, res) => {
  const booking = db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot edit this booking' } });
  }

  const { customer_name, customer_phone, time, party_size, notes, status } = req.body;

  if (party_size && party_size !== booking.party_size) {
    const guests = db.get(
      'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND id != ? AND status != ?',
      [booking.date, booking.slot, booking.id, 'cancelled']
    );
    if (guests.total + party_size > MAX_GUESTS_PER_SLOT) {
      return res.status(409).json({ error: { code: 'EXCEEDS_CAPACITY', message: `Changing party size would exceed ${MAX_GUESTS_PER_SLOT} guest limit` } });
    }
  }

  const changes = {};
  if (customer_name !== undefined) changes.customer_name = { from: booking.customer_name, to: customer_name };
  if (customer_phone !== undefined) changes.customer_phone = { from: booking.customer_phone || '', to: customer_phone };
  if (time !== undefined) changes.time = { from: booking.time, to: time };
  if (party_size !== undefined) changes.party_size = { from: booking.party_size, to: party_size };
  if (notes !== undefined) changes.notes = { from: booking.notes || '', to: notes };
  if (status !== undefined) changes.status = { from: booking.status, to: status };

  db.run(`
    UPDATE bookings SET
      customer_name = COALESCE(?, customer_name),
      customer_phone = COALESCE(?, customer_phone),
      time = COALESCE(?, time),
      party_size = COALESCE(?, party_size),
      notes = COALESCE(?, notes),
      status = COALESCE(?, status)
    WHERE id = ?
  `, [
    customer_name || null,
    customer_phone || null,
    time || null,
    party_size || null,
    notes || null,
    status || null,
    req.params.id
  ]);

  const updated = db.get(`
    SELECT b.*, u.display_name as user_display_name
    FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ?`,
    [req.params.id]
  );

  logAction('booking_modified', String(updated.id), req.user.id, req.user.display_name, {
    customer_name: updated.customer_name, date: updated.date, slot: updated.slot, changes
  });

  res.json({ data: updated });
});

app.delete('/api/bookings/:id', authenticate, (req, res) => {
  const booking = db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
  }
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot cancel this booking' } });
  }
  db.run('UPDATE bookings SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
  logAction('booking_cancelled', String(booking.id), req.user.id, req.user.display_name, {
    customer_name: booking.customer_name, date: booking.date, slot: booking.slot,
    time: booking.time, party_size: booking.party_size
  });
  res.json({ data: { message: 'Booking cancelled' } });
});

// ─── USER MANAGEMENT ────────────────────────────────────

app.get('/api/users/pending', authenticate, adminOnly, (req, res) => {
  const users = db.all("SELECT id, email, display_name, role, status, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC");
  const count = users.length;
  res.json({ data: { users, count } });
});

app.patch('/api/users/:id/approve', authenticate, adminOnly, (req, res) => {
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (user.status !== 'pending') {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
  }
  db.run("UPDATE users SET status = 'active' WHERE id = ?", [req.params.id]);
  logAction('user_approved', String(user.id), req.user.id, req.user.display_name, {
    email: user.email, display_name: user.display_name
  });
  res.json({ data: { message: 'User approved', user: { ...user, status: 'active' } } });
});

app.patch('/api/users/:id/reject', authenticate, adminOnly, (req, res) => {
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (user.status !== 'pending') {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
  }
  db.run("UPDATE users SET status = 'rejected' WHERE id = ?", [req.params.id]);
  logAction('user_rejected', String(user.id), req.user.id, req.user.display_name, {
    email: user.email, display_name: user.display_name
  });
  res.json({ data: { message: 'User rejected' } });
});

// ─── USERS ───────────────────────────────────────────────

app.get('/api/users', authenticate, adminOnly, (req, res) => {
  const users = db.all('SELECT id, email, display_name, role, status, created_at FROM users ORDER BY created_at DESC');
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

  const totalResult = db.get(`SELECT COUNT(*) as cnt FROM system_logs WHERE ${where}`, params);
  const total = totalResult ? totalResult.cnt : 0;
  const logs = db.all(`SELECT * FROM system_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  res.json({ data: { logs, total, page, pages: Math.ceil(total / limit) } });
});

// ─── SLOT CAPACITY ──────────────────────────────────────

app.get('/api/slots/:date/:slot/capacity', authenticate, (req, res) => {
  const { date, slot } = req.params;
  const guests = db.get(
    'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = ? AND slot = ? AND status != ? AND is_private_event = 0',
    [date, slot, 'cancelled']
  );
  const privateEvent = db.get(
    'SELECT id FROM bookings WHERE date = ? AND slot = ? AND is_private_event = 1 AND status != ?',
    [date, slot, 'cancelled']
  );
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

// ─── STATIC FILES & HEALTH ──────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── STARTUP ────────────────────────────────────────────

async function start() {
  await db.initDb();
  console.log('Database initialized');
  app.listen(PORT, () => {
    console.log(`Booking Log API running on http://localhost:${PORT}`);
    console.log(`Admin login: admin@bookinglog.com / admin123`);
  });
}

start();
