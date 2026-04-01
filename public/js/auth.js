/**
 * Auth Module — session management
 */
const SESSION_KEY = 'bookinglog_session';

const auth = {
  getSession: () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  setSession: (session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  clearSession: () => localStorage.removeItem(SESSION_KEY),

  getToken: () => auth.getSession()?.token || null,

  getUser: () => auth.getSession()?.user || null,

  isAdmin: () => auth.getUser()?.role === 'admin',

  requireAuth: () => {
    if (!auth.getToken()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  logout: () => {
    auth.clearSession();
    window.location.href = 'index.html';
  }
};
