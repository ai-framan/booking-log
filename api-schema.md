# Booking Log — API Schema

## Base URL
```
/api/v1
```

## Authentication
All endpoints except `/auth/*` require a Bearer token:
```
Authorization: Bearer <jwt_token>
```

### Error Response Shape
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### Success Response Shape
```json
{
  "data": { ... }
}
```

---

## Endpoints

### Auth

#### `POST /auth/register`
Register a new member account.

**Request Body**
```json
{
  "email": "jane@example.com",
  "password": "securePassword123",
  "display_name": "Jane Smith"
}
```

**Validation**
- `email`: required, valid email format, unique
- `password`: required, min 8 characters
- `display_name`: required, 1–100 characters

**Response** `201 Created`
```json
{
  "data": {
    "user": {
      "id": "usr_a1b2c3d4",
      "email": "jane@example.com",
      "display_name": "Jane Smith",
      "role": "member",
      "created_at": "2026-03-31T10:00:00Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

---

#### `POST /auth/login`
Authenticate and receive a token.

**Request Body**
```json
{
  "email": "jane@example.com",
  "password": "securePassword123"
}
```

**Response** `200 OK`
```json
{
  "data": {
    "user": {
      "id": "usr_a1b2c3d4",
      "email": "jane@example.com",
      "display_name": "Jane Smith",
      "role": "member"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Error** `401 Unauthorized`
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect"
  }
}
```

---

#### `GET /auth/me`
Get the authenticated user's profile.

**Response** `200 OK`
```json
{
  "data": {
    "user": {
      "id": "usr_a1b2c3d4",
      "email": "jane@example.com",
      "display_name": "Jane Smith",
      "role": "member",
      "created_at": "2026-03-31T10:00:00Z"
    }
  }
}
```

---

### Bookings

#### `GET /bookings`
List bookings. Members see only their own; admins see all.

**Query Parameters**
| Parameter | Type    | Default | Description                          |
|-----------|---------|---------|--------------------------------------|
| `date`    | string  | —       | Filter by date (YYYY-MM-DD)          |
| `slot`    | string  | —       | Filter by slot: `lunch` or `dinner`  |
| `month`   | string  | —       | Month to fetch calendar data (YYYY-MM) |

**Response** `200 OK`
```json
{
  "data": {
    "bookings": [
      {
        "id": "bok_x1y2z3",
        "user_id": "usr_a1b2c3d4",
        "date": "2026-04-05",
        "slot": "lunch",
        "time": "12:30",
        "party_size": 4,
        "notes": "Anniversary dinner",
        "created_at": "2026-03-31T14:22:00Z",
        "user": {
          "display_name": "Jane S."
        }
      }
    ]
  }
}
```

**Admin only** — includes full `user` object:
```json
{
  "user": {
    "id": "usr_a1b2c3d4",
    "email": "jane@example.com",
    "display_name": "Jane Smith"
  }
}
```

---

#### `GET /bookings/:id`
Get a single booking by ID.

**Response** `200 OK`
```json
{
  "data": {
    "booking": {
      "id": "bok_x1y2z3",
      "user_id": "usr_a1b2c3d4",
      "date": "2026-04-05",
      "slot": "lunch",
      "time": "12:30",
      "party_size": 4,
      "notes": "Anniversary dinner",
      "created_at": "2026-03-31T14:22:00Z",
      "user": {
        "display_name": "Jane S."
      }
    }
  }
}
```

**Error** `404 Not Found`
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Booking not found"
  }
}
```

---

#### `GET /bookings/calendar/:year/:month`
Get calendar overview for a month (used by desktop calendar view).

**Response** `200 OK`
```json
{
  "data": {
    "year": 2026,
    "month": 4,
    "days": [
      {
        "date": "2026-04-01",
        "lunch_count": 2,
        "dinner_count": 4,
        "is_past": false,
        "is_today": false
      },
      {
        "date": "2026-04-02",
        "lunch_count": 6,
        "dinner_count": 2,
        "is_past": false,
        "is_today": true,
        "lunch_full": false,
        "dinner_full": false
      },
      {
        "date": "2026-04-03",
        "lunch_count": 6,
        "dinner_count": 6,
        "is_past": false,
        "is_today": false,
        "lunch_full": true,
        "dinner_full": true
      }
    ]
  }
}
```

---

#### `POST /bookings`
Create a new booking.

**Request Body**
```json
{
  "date": "2026-04-05",
  "slot": "lunch",
  "time": "12:30",
  "party_size": 4,
  "notes": "Anniversary dinner"
}
```

**Validation**
- `date`: required, YYYY-MM-DD format, today or future (max 60 days ahead), not in the past
- `slot`: required, one of `lunch`, `dinner`
- `time`: required, valid time within slot (lunch: 12:00–14:30, dinner: 19:00–20:30), 30-min increments
- `party_size`: required, integer 1–8
- `notes`: optional, max 500 characters

**Response** `201 Created`
```json
{
  "data": {
    "booking": {
      "id": "bok_x1y2z3",
      "user_id": "usr_a1b2c3d4",
      "date": "2026-04-05",
      "slot": "lunch",
      "time": "12:30",
      "party_size": 4,
      "notes": "Anniversary dinner",
      "created_at": "2026-03-31T14:22:00Z"
    }
  }
}
```

**Error** `409 Conflict` (slot full or time taken)
```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This time slot is no longer available"
  }
}
```

**Error** `400 Bad Request` (validation failure)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid booking data",
    "details": [
      { "field": "time", "message": "Time must be in 30-minute increments" }
    ]
  }
}
```

---

#### `DELETE /bookings/:id`
Cancel a booking.

**Authorization**
- Members: can only cancel their own bookings, and not within 2 hours of slot start
- Admins: can cancel any booking

**Response** `200 OK`
```json
{
  "data": {
    "booking": {
      "id": "bok_x1y2z3",
      "status": "cancelled"
    }
  }
}
```

**Error** `403 Forbidden`
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You can only cancel your own bookings"
  }
}
```

**Error** `409 Conflict` (within 2-hour window)
```json
{
  "error": {
    "code": "TOO_LATE_TO_CANCEL",
    "message": "Cancellations must be made at least 2 hours before the slot"
  }
}
```

---

### Users (Admin only)

#### `GET /users`
List all users (admin only).

**Response** `200 OK`
```json
{
  "data": {
    "users": [
      {
        "id": "usr_a1b2c3d4",
        "email": "jane@example.com",
        "display_name": "Jane Smith",
        "role": "member",
        "created_at": "2026-03-31T10:00:00Z"
      }
    ]
  }
}
```

---

#### `GET /users/:id`
Get a user by ID (admin only).

**Response** `200 OK`
```json
{
  "data": {
    "user": {
      "id": "usr_a1b2c3d4",
      "email": "jane@example.com",
      "display_name": "Jane Smith",
      "role": "member",
      "created_at": "2026-03-31T10:00:00Z"
    }
  }
}
```

---

## Data Models

### User
| Field         | Type   | Constraints                          |
|---------------|--------|--------------------------------------|
| `id`          | string | Primary key, `usr_` prefix, 12 chars |
| `email`       | string | Unique, max 255, valid email          |
| `password`    | string | Hashed (bcrypt), never returned      |
| `display_name`| string | Max 100 characters                   |
| `role`        | enum   | `member` (default) or `admin`         |
| `created_at`  | string | ISO 8601 timestamp                   |

### Booking
| Field       | Type   | Constraints                                          |
|-------------|--------|------------------------------------------------------|
| `id`        | string | Primary key, `bok_` prefix, 12 chars                 |
| `user_id`   | string | Foreign key → User.id                                |
| `date`      | string | YYYY-MM-DD format                                    |
| `slot`      | enum   | `lunch` or `dinner`                                  |
| `time`      | string | HH:MM format, 30-min increments                       |
| `party_size`| integer| 1–8                                                  |
| `notes`     | string | Max 500 characters, nullable                         |
| `created_at`| string | ISO 8601 timestamp                                   |

### Slot Time Ranges
| Slot   | Valid Times                        |
|--------|------------------------------------|
| Lunch  | 12:00, 12:30, 13:00, 13:30, 14:00, 14:30 |
| Dinner | 19:00, 19:30, 20:00, 20:30         |

**Maximum bookings per slot: 6**

---

## HTTP Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 200  | Success                              |
| 201  | Created                              |
| 400  | Bad Request / Validation Error      |
| 401  | Unauthorized (no/invalid token)     |
| 403  | Forbidden (insufficient permissions)|
| 404  | Not Found                            |
| 409  | Conflict (slot full, time taken)     |
| 500  | Internal Server Error                |

---

## Pagination
List endpoints support cursor-based pagination:

**Request**
```
GET /bookings?limit=20&cursor=bok_x1y2z3
```

**Response Headers**
```
X-Total-Count: 47
X-Has-More: true
X-Cursor: bok_a1b2c3
```

Default `limit` is 20, max 100.
