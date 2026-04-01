# Booking Log — Restaurant Reservation System

A clean restaurant booking web app with login, calendar view, and booking management.

## Features

- **Login / Register** — JWT authentication, localStorage session
- **Two Time Slots** — Lunch (12–3pm) and Dinner (7–9pm)
- **Max 6 bookings per slot**
- **Member role** — create and cancel own bookings
- **Admin role** — view all users, cancel any booking
- **Desktop** — month calendar view with clickable day cells
- **Mobile** — date picker with vertical booking list
- **Color coded** — Lunch: light yellow, Dinner: light green

## Quick Start

### 1. Start the Backend
```bash
cd backend
npm install
node server.js
```
Server runs on http://localhost:3000

### 2. Open the App
Navigate to http://localhost:3000 in your browser.

### 3. Login
- **Admin**: admin@bookinglog.com / admin123
- **Register** a new member account to test member features

## Project Structure
```
booking-log/
├── backend/
│   ├── server.js        # Express API server
│   ├── package.json
│   └── booking.db       # SQLite database (auto-created)
├── frontend/
│   ├── index.html       # Login / Register
│   ├── dashboard.html   # Main calendar view
│   ├── css/styles.css   # Full stylesheet
│   └── js/
│       ├── api.js       # API client
│       ├── auth.js      # Session management
│       └── app.js       # Calendar & booking logic
└── SPEC.md              # Feature specification
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register new user |
| POST | /api/auth/login | — | Login |
| GET | /api/auth/me | JWT | Get current user |
| GET | /api/bookings | JWT | List bookings |
| GET | /api/bookings/calendar/:y/:m | JWT | Month calendar |
| POST | /api/bookings | JWT | Create booking |
| DELETE | /api/bookings/:id | JWT | Cancel booking |
| GET | /api/slots/:date/:slot/capacity | JWT | Slot capacity |

## Tech Stack
- **Backend**: Node.js, Express, SQLite (better-sqlite3), JWT, bcrypt
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
