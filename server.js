const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./sqlite-wrapper');
const { nowHK } = db;

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

async function logAction(action, targetId, actorId, actorName, details) {
  await db.run(
    'INSERT INTO system_logs (action, target_id, actor_id, actor_name, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [action, targetId, actorId, actorName, details ? JSON.stringify(details) : null, nowHK()]
  );
}

// ─── AUTH ─────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password || !display_name) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'All fields required' } });
    }
    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });
    }
    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.run('INSERT INTO users (email, password, display_name, status, created_at) VALUES ($1, $2, $3, $4, $5)', [email, hashed, display_name, 'pending', nowHK()]);
    const user = { id: result.lastInsertRowid, email, display_name, role: 'member', status: 'pending' };
    await logAction('user_registered', String(user.id), user.id, display_name, { email, display_name });
    res.json({ data: { message: 'Registration submitted. Awaiting admin approval.', user } });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Registration failed' } });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
    }
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
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
    await logAction('user_login', null, user.id, user.display_name, { email: user.email });
    res.json({ data: { user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }, token } });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Login failed' } });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await db.get('SELECT id, email, display_name, role FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    res.json({ data: user });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch user' } });
  }
});

// ─── BOOKINGS ────────────────────────────────────────────

app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    let bookings;
    if (req.user.role === 'admin') {
      bookings = await db.all(`
        SELECT b.*, u.email as user_email, u.display_name as user_display_name
        FROM bookings b JOIN users u ON b.user_id = u.id
        ORDER BY b.date DESC, b.slot DESC
      `);
    } else {
      bookings = await db.all('SELECT * FROM bookings WHERE user_id = $1 ORDER BY date DESC, slot DESC', [req.user.id]);
    }
    res.json({ data: bookings });
  } catch (err) {
    console.error('GET /api/bookings error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch bookings' } });
  }
});

app.get('/api/bookings/calendar/:year/:month', authenticate, async (req, res) => {
  try {
    const { year, month } = req.params;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    let bookings;
    if (req.user.role === 'admin') {
      bookings = await db.all(`
        SELECT b.*, u.email as user_email, u.display_name as user_display_name
        FROM bookings b JOIN users u ON b.user_id = u.id
        WHERE b.date >= $1 AND b.date <= $2
      `, [startDate, endDate]);
    } else {
      bookings = await db.all('SELECT * FROM bookings WHERE user_id = $1 AND date >= $2 AND date <= $3', [req.user.id, startDate, endDate]);
    }
    res.json({ data: bookings });
  } catch (err) {
    console.error('GET /api/bookings/calendar error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch calendar bookings' } });
  }
});

app.post('/api/bookings', authenticate, async (req, res) => {
  try {
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

    const privateEvent = await db.get(
      'SELECT id FROM bookings WHERE date = $1 AND slot = $2 AND is_private_event = 1 AND status != $3',
      [date, slot, 'cancelled']
    );

    if (privateEvent) {
      return res.status(409).json({ error: { code: 'SLOT_LOCKED', message: 'This session is locked (Private Event)' } });
    }

    const guests = await db.get(
      'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = $1 AND slot = $2 AND status != $3 AND is_private_event = 0',
      [date, slot, 'cancelled']
    );

    if (guests.total >= MAX_GUESTS_PER_SLOT) {
      return res.status(409).json({ error: { code: 'SLOT_LOCKED', message: `This session is fully booked (${MAX_GUESTS_PER_SLOT} guests limit reached)` } });
    }

    if (!isPrivate && guests.total + effectivePartySize > MAX_GUESTS_PER_SLOT) {
      return res.status(409).json({ error: { code: 'EXCEEDS_CAPACITY', message: `Only ${MAX_GUESTS_PER_SLOT - guests.total} seats remaining in this session` } });
    }

    const result = await db.run(`
      INSERT INTO bookings (user_id, date, slot, time, party_size, customer_name, customer_phone, notes, status, is_private_event, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
    `, [
      req.user.id, date, slot, isPrivate ? '00:00' : (time || '00:00'),
      effectivePartySize, customer_name, customer_phone || '', notes || '', isPrivate ? 1 : 0, nowHK()
    ]);

    // Return success immediately without fetching back (Railway filesystem workaround)
    res.json({ data: { id: result.lastInsertRowid, success: true } });

    // Log action in background (non-blocking, non-fatal)
    logAction(isPrivate ? 'slot_private_locked' : 'booking_created', String(result.lastInsertRowid), req.user.id, req.user.display_name, {
      customer_name, slot, date, is_private_event: isPrivate
    }).catch(err => console.error('logAction background error:', err));
  } catch (err) {
    console.error('POST /api/bookings error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create booking' } });
  }
});

app.patch('/api/bookings/:id/confirm', authenticate, async (req, res) => {
  try {
    const booking = await db.get('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admin can confirm bookings' } });
    }

    const oldStatus = booking.status;
    await db.run('UPDATE bookings SET status = $1 WHERE id = $2', ['confirmed', req.params.id]);
    const updated = await db.get(`
      SELECT b.*, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = $1`,
      [req.params.id]
    );

    await logAction('booking_confirmed', String(updated.id), req.user.id, req.user.display_name, {
      customer_name: updated.customer_name, slot: updated.slot, date: updated.date, time: updated.time,
      previous_status: oldStatus
    });

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /api/bookings/:id/confirm error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to confirm booking' } });
  }
});

app.patch('/api/bookings/:id', authenticate, async (req, res) => {
  try {
    const booking = await db.get('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    }
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot edit this booking' } });
    }

    const { customer_name, customer_phone, time, party_size, notes, status } = req.body;

    if (party_size && party_size !== booking.party_size) {
      const guests = await db.get(
        'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = $1 AND slot = $2 AND id != $3 AND status != $4',
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

    await db.run(`
      UPDATE bookings SET
        customer_name = COALESCE($1, customer_name),
        customer_phone = COALESCE($2, customer_phone),
        time = COALESCE($3, time),
        party_size = COALESCE($4, party_size),
        notes = COALESCE($5, notes),
        status = COALESCE($6, status)
      WHERE id = $7
    `, [
      customer_name || null,
      customer_phone || null,
      time || null,
      party_size || null,
      notes || null,
      status || null,
      req.params.id
    ]);

    const updated = await db.get(`
      SELECT b.*, u.display_name as user_display_name
      FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = $1`,
      [req.params.id]
    );

    await logAction('booking_modified', String(updated.id), req.user.id, req.user.display_name, {
      customer_name: updated.customer_name, date: updated.date, slot: updated.slot, changes
    });

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /api/bookings/:id error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update booking' } });
  }
});

app.delete('/api/bookings/:id', authenticate, async (req, res) => {
  try {
    const booking = await db.get('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    }
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot cancel this booking' } });
    }
    await db.run('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', req.params.id]);
    await logAction('booking_cancelled', String(booking.id), req.user.id, req.user.display_name, {
      customer_name: booking.customer_name, date: booking.date, slot: booking.slot,
      time: booking.time, party_size: booking.party_size
    });
    res.json({ data: { message: 'Booking cancelled' } });
  } catch (err) {
    console.error('DELETE /api/bookings/:id error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel booking' } });
  }
});

// ─── USER MANAGEMENT ────────────────────────────────────

app.get('/api/users/pending', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await db.all("SELECT id, email, display_name, role, status, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC");
    const count = users.length;
    res.json({ data: { users, count } });
  } catch (err) {
    console.error('GET /api/users/pending error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending users' } });
  }
});

app.patch('/api/users/:id/approve', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    if (user.status !== 'pending') {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
    }
    await db.run("UPDATE users SET status = 'active' WHERE id = $1", [req.params.id]);
    await logAction('user_approved', String(user.id), req.user.id, req.user.display_name, {
      email: user.email, display_name: user.display_name
    });
    res.json({ data: { message: 'User approved', user: { ...user, status: 'active' } } });
  } catch (err) {
    console.error('PATCH /api/users/:id/approve error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to approve user' } });
  }
});

app.patch('/api/users/:id/reject', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    if (user.status !== 'pending') {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'User is not pending' } });
    }
    await db.run("UPDATE users SET status = 'rejected' WHERE id = $1", [req.params.id]);
    await logAction('user_rejected', String(user.id), req.user.id, req.user.display_name, {
      email: user.email, display_name: user.display_name
    });
    res.json({ data: { message: 'User rejected' } });
  } catch (err) {
    console.error('PATCH /api/users/:id/reject error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reject user' } });
  }
});

// ─── USERS ───────────────────────────────────────────────

app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await db.all('SELECT id, email, display_name, role, status, created_at FROM users ORDER BY created_at DESC');
    res.json({ data: users });
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch users' } });
  }
});

// ─── SYSTEM LOGS ────────────────────────────────────────

app.get('/api/system-logs', authenticate, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (req.query.start_date) {
      where += ' AND created_at >= $1';
      // Use space separator (SQLite DATETIME format) so it's compared as HK local time
      params.push(req.query.start_date + ' 00:00:00');
    }
    if (req.query.end_date) {
      where += ' AND created_at <= $' + (params.length + 1);
      params.push(req.query.end_date + ' 23:59:59');
    }
    if (req.query.action) {
      where += ' AND action = $' + (params.length + 1);
      params.push(req.query.action);
    }

    const totalResult = await db.get(`SELECT COUNT(*) as cnt FROM system_logs WHERE ${where}`, params);
    const total = totalResult ? totalResult.cnt : 0;
    const logs = await db.all(`SELECT * FROM system_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);

    res.json({ data: { logs, total, page, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('GET /api/system-logs error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch system logs' } });
  }
});

// ─── SLOT CAPACITY ──────────────────────────────────────

app.get('/api/slots/:date/:slot/capacity', authenticate, async (req, res) => {
  try {
    const { date, slot } = req.params;
    const guests = await db.get(
      'SELECT COALESCE(SUM(party_size),0) as total FROM bookings WHERE date = $1 AND slot = $2 AND status != $3 AND is_private_event = 0',
      [date, slot, 'cancelled']
    );
    const privateEvent = await db.get(
      'SELECT id FROM bookings WHERE date = $1 AND slot = $2 AND is_private_event = 1 AND status != $3',
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
  } catch (err) {
    console.error('GET /api/slots/:date/:slot/capacity error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch slot capacity' } });
  }
});

// ─── CSV EXPORT (ADMIN) ─────────────────────────────────
app.get('/api/bookings/export/csv', authenticate, adminOnly, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT b.date, b.slot, b.time, b.customer_name,
             b.customer_phone, b.party_size, b.notes,
             b.status, u.display_name as booked_by
      FROM bookings b JOIN users u ON b.user_id = u.id
    `;
    let params = [];

    if (start_date && end_date) {
      query += ' WHERE b.date >= $1 AND b.date <= $2';
      params = [start_date, end_date];
    } else if (start_date) {
      query += ' WHERE b.date >= $1';
      params = [start_date];
    } else if (end_date) {
      query += ' WHERE b.date <= $1';
      params = [end_date];
    }

    query += ' ORDER BY b.date, b.slot, b.time';

    const bookings = await db.all(query, params);

    const header = 'Date,Slot,Time,Customer Name,Phone,Party Size,Notes,Status,Booked By';
    const rows = bookings.map(b => {
      const escape = (val) => (val || '').toString().replace(/"/g, '""');
      return `"${escape(b.date)}","${escape(b.slot)}","${escape(b.time)}","${escape(b.customer_name)}","${escape(b.customer_phone)}",${b.party_size},"${escape(b.notes)}","${escape(b.status)}","${escape(b.booked_by)}"`;
    });

    // UTF-8 BOM for Excel Chinese support
    const csv = '\uFEFF' + [header, ...rows].join('\n');

    const filename = start_date && end_date
      ? `bookings_${start_date}_to_${end_date}.csv`
      : `bookings_all_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('GET /api/bookings/export/csv error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to export CSV' } });
  }
});

// ─── STATIC FILES & HEALTH ──────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/api/health', (req, res) => {
  // Use Hong Kong timezone for timestamp
  const hkTime = new Date().toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong' });
  res.json({ status: 'ok', timestamp: hkTime, iso: new Date().toISOString() });
});

// ─── GLOBAL ERROR HANDLER ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal error occurred'
        : err.message
    }
  });
});

// ─── STARTUP ───────────────────────────────────────────

async function start() {
  await db.initDb();
  console.log('Database initialized');
  app.listen(PORT, () => {
    console.log(`Booking Log API running on http://localhost:${PORT}`);
    console.log(`Admin login: admin@bookinglog.com / admin123`);
  });
}

start();
