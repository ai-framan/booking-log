# Booking Log — Restaurant Reservation System

## Overview
A clean, professional restaurant reservation web app for managing lunch and dinner seatings. Two time slots per day (lunch: 12–3pm, dinner: 7–9pm), max 16 guests per slot.

## User Roles
- **Member**: Register, login, create/view/cancel own bookings
- **Admin**: All member abilities + view all bookings, confirm bookings, cancel any booking, view system logs

## Features

### Core Booking
- Login & Registration with email/password
- Dashboard with calendar view (desktop) / modal view (mobile)
- Two time slots per day: Lunch (12–3pm) and Dinner (7–9pm)
- Max **16 guests** per slot (not 6 — allows repeat times)
- Times can repeat within the same slot (multiple bookings at same time allowed)
- **Pending → Confirmed workflow**: new bookings start as "pending", admin must confirm
- **Slot lock**: when total guests >= 16, all input forms for that slot are locked

### UI/UX
- **Click day → full-screen modal** (one tap input on tablet/desktop)
- Time chips showing booked vs available times
- Inline edit: edit booking name/phone/notes in-place
- Calendar shows: lunch/dinner guest totals per day, weekend colors (red=Sunday, blue=Saturday), holiday badges
- Prominent green **Confirm** button for pending bookings
- Pending badge (yellow) shows unconfirmed bookings

### HK Public Holidays
- Calendar marks HK 2026 public holidays with red badge and pink background
- Holiday data loaded from `/tmp/booking-v2/hk_holidays.json`

### System Log (Admin)
- Records: booking_created, booking_confirmed, booking_modified, booking_cancelled, user_login
- Shows: timestamp, action (color-coded), user who made the change, details
- Filterable by date range and action type

## Tech Stack
- **Backend**: Node.js + Express + SQLite (JWT auth)
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **API**: RESTful JSON API

## API Endpoints
- POST /api/auth/register
- POST /api/auth/login
- GET  /api/auth/me
- GET  /api/bookings
- POST /api/bookings
- PATCH /api/bookings/:id (edit)
- PATCH /api/bookings/:id/confirm (admin only)
- DELETE /api/bookings/:id
- GET  /api/bookings/calendar/:year/:month
- GET  /api/users (admin only)
- GET  /api/system-logs (admin only)
- GET  /api/slots/:date/:slot/capacity

## Default Admin
- Email: admin@bookinglog.com
- Password: admin123

## Booking Status Flow
```
new booking → status: pending (yellow badge)
admin clicks "✓ Confirm" → status: confirmed (green)
booking cancelled → status: cancelled
```

## Slot Capacity Logic
- Each slot (lunch/dinner) allows unlimited bookings by count
- BUT total guests (sum of party_size) capped at 16
- When total guests >= 16: all time inputs locked, banner shown
