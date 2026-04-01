/**
 * API Module — handles HTTP communication with backend
 */
const API_BASE = '/api';

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const json = await res.json();
  if (!res.ok) throw new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Request failed');
  return json.data;
}

async function requestWithWake(method, path, body = null, token = null) {
  // Wake up server first
  for (let i = 0; i < 3; i++) {
    await fetch('/api/health').catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await fetch(API_BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token && { 'Authorization': `Bearer ${token}` }) },
        ...(body && { body: JSON.stringify(body) })
      });
      const json = await res.json();
      if (res.ok) return json.data;
      throw new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Request failed');
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}

const api = {
  authRegister: (email, password, displayName) =>
    request('POST', '/auth/register', { email, password, display_name: displayName }),

  authLogin: (email, password) =>
    request('POST', '/auth/login', { email, password }),

  authMe: (token) => request('GET', '/auth/me', null, token),

  getBookings: (token) => request('GET', '/bookings', null, token),

  getCalendar: (year, month, token) =>
    requestWithWake('GET', `/bookings/calendar/${year}/${month}`, null, token),

  createBooking: (booking, token) =>
    request('POST', '/bookings', booking, token),

  updateBooking: (id, data, token) =>
    request('PATCH', `/bookings/${id}`, data, token),

  confirmBooking: (id, token) =>
    request('PATCH', `/bookings/${id}/confirm`, null, token),

  deleteBooking: (id, token) =>
    request('DELETE', `/bookings/${id}`, null, token),

  getSlotCapacity: (date, slot, token) =>
    request('GET', `/slots/${date}/${slot}/capacity`, null, token),

  getSystemLogs: (params, token) => {
    const query = new URLSearchParams(params).toString();
    return request('GET', `/system-logs?${query}`, null, token);
  },

  getPendingUsers: (token) => request('GET', '/users/pending', null, token),

  approveUser: (id, token) => request('PATCH', `/users/${id}/approve`, null, token),

  rejectUser: (id, token) => request('PATCH', `/users/${id}/reject`, null, token),
};
