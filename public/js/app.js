/**
 * App Module — calendar, booking management
 */

let currentYear, currentMonth;
let selectedDate = null;
let selectedSlot = null;
let allBookings = [];
let hkHolidays = {};

// System log state
let logPage = 1;
let logTotalPages = 1;

// ─── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!auth.requireAuth()) return;

  const user = auth.getUser();
  document.getElementById('user-badge').textContent =
    user.role === 'admin' ? 'Admin' : user.display_name;

  // Show admin nav if admin
  if (user.role === 'admin') {
    document.getElementById('admin-nav').classList.remove('hidden');
    loadPendingCount();
  }

  // Init settings panel
  initSettingsPanel();
  applySettings();

  // Private event checkbox listeners
  document.getElementById('dm-private-lunch')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const name = prompt('Private Event 名稱 (例如：包場、私人派對):');
      if (name) {
        document.getElementById('dm-name-lunch').value = name;
      } else {
        e.target.checked = false;
        return;
      }
    }
  });
  document.getElementById('dm-private-dinner')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const name = prompt('Private Event 名稱 (例如：包場、私人派對):');
      if (name) {
        document.getElementById('dm-name-dinner').value = name;
      } else {
        e.target.checked = false;
        return;
      }
    }
  });

  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth() + 1;
  selectedDate = formatDate(today);

  // Mobile date init
  document.getElementById('mobile-date').value = selectedDate;

  // Load HK holidays
  loadHkHolidays();

  setupEventListeners();
  loadBookings();
});

async function loadHkHolidays() {
  try {
    const res = await fetch('/hk_holidays.json');
    if (res.ok) {
      hkHolidays = await res.json();
    }
  } catch (e) {
    // fallback empty
  }
}

function setupEventListeners() {
  document.getElementById('btn-logout').addEventListener('click', auth.logout);
  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
  document.getElementById('today-btn').addEventListener('click', goToToday);

  // Month picker
  document.getElementById('current-month-year').addEventListener('click', openMonthPicker);
  document.getElementById('month-picker-close').addEventListener('click', closeMonthPicker);
  document.getElementById('picker-year-prev').addEventListener('click', () => changePickerYear(-1));
  document.getElementById('picker-year-next').addEventListener('click', () => changePickerYear(1));
  document.getElementById('picker-year-input').addEventListener('change', onPickerYearChange);

  document.getElementById('panel-close')?.addEventListener('click', closePanel);
  document.getElementById('day-modal-close')?.addEventListener('click', closeDayModal);
  document.getElementById('day-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'day-modal') closeDayModal();
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('booking-form').addEventListener('submit', handleBookingSubmit);
  document.getElementById('booking-slot').addEventListener('change', updateTimeOptions);

  // Mobile nav
  document.getElementById('mobile-prev').addEventListener('click', () => changeMobileDate(-1));
  document.getElementById('mobile-next').addEventListener('click', () => changeMobileDate(1));
  document.getElementById('mobile-date').addEventListener('change', (e) => {
    openDayModal(e.target.value);
  });

  // Responsive switch
  const checkMobile = () => {
    const isMobile = window.innerWidth < 769;
    document.getElementById('desktop-view').classList.toggle('hidden', isMobile);
    document.getElementById('mobile-view').classList.toggle('hidden', !isMobile);
  };
  window.addEventListener('resize', checkMobile);
  checkMobile();

  // Admin nav
  document.getElementById('nav-bookings').addEventListener('click', showBookingsView);
  document.getElementById('nav-users').addEventListener('click', showMembersView);
  document.getElementById('nav-logs').addEventListener('click', showLogsView);
  document.getElementById('nav-approvals').addEventListener('click', showMembersView);
  document.getElementById('btn-apply-filters').addEventListener('click', loadSystemLogs);
  document.getElementById('log-prev').addEventListener('click', () => { logPage--; loadSystemLogs(); });
  document.getElementById('log-next').addEventListener('click', () => { logPage++; loadSystemLogs(); });
}

// ─── Data Loading ────────────────────────────────────────
async function loadBookings(retryCount = 0) {
  try {
    const token = auth.getToken();
    allBookings = await api.getCalendar(currentYear, currentMonth, token);
    renderCalendar();
    renderMobileBookings();
  } catch (err) {
    if (retryCount < 3) {
      await new Promise(r => setTimeout(r, 500 * (retryCount + 1)));
      return loadBookings(retryCount + 1);
    }
    showToast('Failed to load bookings: ' + err.message, 'error');
  }
}

// ─── Calendar Rendering ───────────────────────────────────
function renderCalendar() {
  const monthNames = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  document.getElementById('current-month-year').textContent =
    `${monthNames[currentMonth - 1]} ${currentYear}`;

  const container = document.getElementById('calendar-days');
  container.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date();
  const todayStr = formatDate(today);

  // Get holidays for current year/month
  const holidays = getHolidaysForMonth(currentYear, currentMonth);

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day empty';
    container.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isPast = dateStr < todayStr;
    const isToday = dateStr === todayStr;
    const holiday = holidays.find(h => h.date === dateStr);
    const dayOfWeek = new Date(currentYear, currentMonth - 1, day).getDay();

    const cell = document.createElement('div');
    let cellClass = 'calendar-day';
    if (isPast) cellClass += ' past';
    if (isToday) cellClass += ' today';
    if (holiday) cellClass += ' holiday';
    if (dayOfWeek === 0) cellClass += ' weekend-sun';
    if (dayOfWeek === 6) cellClass += ' weekend-sat';
    cell.className = cellClass;
    cell.dataset.date = dateStr;

    const holidayBadge = holiday ? `<span class="holiday-badge">${escapeHtml(holiday.name_zh || holiday.name)}</span>` : '';

    cell.innerHTML = `
      <div class="day-header">
        <span class="day-num${isToday ? ' today' : ''}">${day}</span>
        ${holidayBadge}
        <div class="day-guest-summary" id="dgs-${dateStr.replace(/-/g,'')}"></div>
      </div>
      <div class="day-bookings" id="day-${dateStr.replace(/-/g,'')}"></div>
    `;

    if (!isPast) {
      cell.addEventListener('click', () => openDayModal(dateStr));
    }

    container.appendChild(cell);
  }

  // Populate booking summaries
  renderBookingSummaries();
}

function getHolidaysForMonth(year, month) {
  const key = String(year);
  if (!hkHolidays || !hkHolidays[key]) return [];
  return hkHolidays[key].filter(h => {
    const d = new Date(h.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
}

function renderBookingSummaries() {
  const grouped = groupByDate(allBookings);

  for (const [date, bookings] of Object.entries(grouped)) {
    const lunchBookings = bookings.filter(b => b.slot === 'lunch' && b.status !== 'cancelled');
    const dinnerBookings = bookings.filter(b => b.slot === 'dinner' && b.status !== 'cancelled');
    const lunchPrivate = lunchBookings.some(b => b.is_private_event);
    const dinnerPrivate = dinnerBookings.some(b => b.is_private_event);
    const lunchGuests = lunchBookings.reduce((sum, b) => sum + (b.party_size || 0), 0);
    const dinnerGuests = dinnerBookings.reduce((sum, b) => sum + (b.party_size || 0), 0);

    const dayId = 'day-' + date.replace(/-/g, '');
    const gssId = 'dgs-' + date.replace(/-/g, '');
    const el = document.getElementById(dayId);
    const gsEl = document.getElementById(gssId);
    if (!el) continue;

    // Guest summary in header
    if (gsEl) {
      gsEl.innerHTML = `
        ${lunchBookings.length > 0 || lunchPrivate ? `<span class="day-guest-l">${lunchPrivate ? '🔒L' : 'L:' + lunchGuests}</span>` : ''}
        ${dinnerBookings.length > 0 || dinnerPrivate ? `<span class="day-guest-d">${dinnerPrivate ? '🔒D' : 'D:' + dinnerGuests}</span>` : ''}
      `;
    }

    // Remove old slot blocks
    el.querySelectorAll('.day-slot-block').forEach(e => e.remove());

    // Lunch block
    const lunchPrivateBooking = lunchBookings.find(b => b.is_private_event);
    const lunchBlock = document.createElement('div');
    lunchBlock.className = 'day-slot-block lunch' + (lunchPrivate ? ' private-locked' : '');
    if (lunchPrivate && lunchPrivateBooking) {
      const nameShort = lunchPrivateBooking.customer_name;
      lunchBlock.innerHTML = `<div class="day-booking lunch private-name">🔒 ${escapeHtml(nameShort)}</div>`;
    } else if (lunchBookings.length > 0) {
      lunchBlock.innerHTML = lunchBookings.map(b => {
        const nameShort = b.customer_name.substring(0, 6);
        const cls = b.status === 'confirmed' ? 'confirmed-name' : 'pending-name';
        return `<div class="day-booking lunch ${cls}">${escapeHtml(nameShort)}/${b.party_size}</div>`;
      }).join('');
    }
    el.appendChild(lunchBlock);

    // Dinner block
    const dinnerPrivateBooking = dinnerBookings.find(b => b.is_private_event);
    const dinnerBlock = document.createElement('div');
    dinnerBlock.className = 'day-slot-block dinner' + (dinnerPrivate ? ' private-locked' : '');
    if (dinnerPrivate && dinnerPrivateBooking) {
      const nameShort = dinnerPrivateBooking.customer_name;
      dinnerBlock.innerHTML = `<div class="day-booking dinner private-name">🔒 ${escapeHtml(nameShort)}</div>`;
    } else if (dinnerBookings.length > 0) {
      dinnerBlock.innerHTML = dinnerBookings.map(b => {
        const nameShort = b.customer_name.substring(0, 6);
        const cls = b.status === 'confirmed' ? 'confirmed-name' : 'pending-name';
        return `<div class="day-booking dinner ${cls}">${escapeHtml(nameShort)}/${b.party_size}</div>`;
      }).join('');
    }
    el.appendChild(dinnerBlock);
  }
}

// ─── Day Modal ─────────────────────────────────────────────
// ─── Day Modal Scroll ─────────────────────────────────────
function scrollBookingList(slot, direction) {
  const list = document.getElementById(`dm-${slot}-bookings`);
  if (!list) return;
  const scrollAmount = 80;
  list.scrollBy({ top: direction === 'up' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
}

function updateScrollButtons(slot) {
  const list = document.getElementById(`dm-${slot}-bookings`);
  if (!list) return;
  const upBtn = document.getElementById(`dm-${slot}-up`);
  const downBtn = document.getElementById(`dm-${slot}-down`);
  if (!upBtn || !downBtn) return;
  const atTop = list.scrollTop <= 0;
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  upBtn.classList.toggle('hidden', atTop);
  downBtn.classList.toggle('hidden', atBottom);
}

function openDayModal(dateStr) {
  selectedDate = dateStr;
  document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
  document.querySelector(`[data-date="${dateStr}"]`)?.classList.add('selected');

  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate();
  const monthNames = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  document.getElementById('day-modal-date').textContent = `${monthNames[date.getMonth()]} ${day}`;
  document.getElementById('day-modal-weekday').textContent = weekdays[date.getDay()];

  const dayBookings = allBookings.filter(b => b.date === dateStr && b.status !== 'cancelled');
  const lunchBookings = dayBookings.filter(b => b.slot === 'lunch');
  const dinnerBookings = dayBookings.filter(b => b.slot === 'dinner');

  const lunchPrivate = lunchBookings.some(b => b.is_private_event);
  const dinnerPrivate = dinnerBookings.some(b => b.is_private_event);
  const lunchGuests = lunchBookings.reduce((sum, b) => sum + (b.party_size || 0), 0);
  const dinnerGuests = dinnerBookings.reduce((sum, b) => sum + (b.party_size || 0), 0);
  const lunchLocked = lunchGuests >= 16 || lunchPrivate;
  const dinnerLocked = dinnerGuests >= 16 || dinnerPrivate;

  document.getElementById('dm-lunch-count').textContent = lunchPrivate ? '🔒 Private' : `${lunchGuests}/16`;
  document.getElementById('dm-dinner-count').textContent = dinnerPrivate ? '🔒 Private' : `${dinnerGuests}/16`;

  // Private event checkboxes
  document.getElementById('dm-private-lunch').checked = lunchPrivate;
  document.getElementById('dm-private-dinner').checked = dinnerPrivate;

  // Private toggle label style
  const lunchPrivateLabel = document.querySelector('#dm-lunch-private-row label');
  const dinnerPrivateLabel = document.querySelector('#dm-dinner-private-row label');
  if (lunchPrivateLabel) lunchPrivateLabel.className = lunchPrivate ? 'private-active' : '';
  if (dinnerPrivateLabel) dinnerPrivateLabel.className = dinnerPrivate ? 'private-active' : '';

  // Time chips
  renderDayChips('lunch', lunchBookings, lunchLocked);
  renderDayChips('dinner', dinnerBookings, dinnerLocked);

  // Time select
  populateDayTimeSelect('lunch', lunchBookings, lunchLocked);
  populateDayTimeSelect('dinner', dinnerBookings, dinnerLocked);

  // Locked / private banner
  document.querySelectorAll('.slot-locked-banner').forEach(el => el.remove());
  document.querySelectorAll('.day-input-row').forEach(el => el.classList.remove('locked'));

  const lunchBlock = document.querySelector('#dm-lunch-bookings')?.parentElement;
  const dinnerBlock = document.querySelector('#dm-dinner-bookings')?.parentElement;

  if (lunchPrivate) {
    lunchBlock?.insertBefore(Object.assign(document.createElement('div'), {
      className: 'slot-locked-banner private',
      textContent: '🔒 Private Event — Slot Locked'
    }), lunchBlock.firstChild.nextSibling);
    document.getElementById('dm-lunch-input-row')?.classList.add('locked');
  } else if (lunchLocked) {
    lunchBlock?.insertBefore(Object.assign(document.createElement('div'), {
      className: 'slot-locked-banner',
      textContent: '🔴 Lunch Full (16 guests limit)'
    }), lunchBlock.firstChild.nextSibling);
    document.getElementById('dm-lunch-input-row')?.classList.add('locked');
  }

  if (dinnerPrivate) {
    dinnerBlock?.insertBefore(Object.assign(document.createElement('div'), {
      className: 'slot-locked-banner private',
      textContent: '🔒 Private Event — Slot Locked'
    }), dinnerBlock.firstChild.nextSibling);
    document.getElementById('dm-dinner-input-row')?.classList.add('locked');
  } else if (dinnerLocked) {
    dinnerBlock?.insertBefore(Object.assign(document.createElement('div'), {
      className: 'slot-locked-banner',
      textContent: '🔴 Dinner Full (16 guests limit)'
    }), dinnerBlock.firstChild.nextSibling);
    document.getElementById('dm-dinner-input-row')?.classList.add('locked');
  }

  // Clear inputs (only if not locked)
  if (!lunchLocked) {
    document.getElementById('dm-name-lunch').value = '';
    document.getElementById('dm-remark-lunch').value = '';
    document.getElementById('dm-pax-lunch').value = '2';
  }
  if (!dinnerLocked) {
    document.getElementById('dm-name-dinner').value = '';
    document.getElementById('dm-remark-dinner').value = '';
    document.getElementById('dm-pax-dinner').value = '2';
  }

  // Render bookings (excluding private events - shown separately)
  renderDayBookings('lunch', lunchBookings.filter(b => !b.is_private_event));
  renderDayBookings('dinner', dinnerBookings.filter(b => !b.is_private_event));

  // Show private event as removable entry in modal bookings list
  const lunchPrivateB = lunchBookings.find(b => b.is_private_event);
  const dinnerPrivateB = dinnerBookings.find(b => b.is_private_event);

  if (lunchPrivateB) {
    const lunchBookingsEl = document.getElementById('dm-lunch-bookings');
    lunchBookingsEl.innerHTML = `
      <div class="private-event-card" id="private-event-lunch">
        <span class="private-event-icon">🔒</span>
        <span class="private-event-name">${escapeHtml(lunchPrivateB.customer_name)}</span>
        <button class="btn-cancel" onclick="removePrivateEvent(${lunchPrivateB.id}, 'lunch')" title="Remove Private Event">×</button>
      </div>
    ` + lunchBookingsEl.innerHTML;
  }
  if (dinnerPrivateB) {
    const dinnerBookingsEl = document.getElementById('dm-dinner-bookings');
    dinnerBookingsEl.innerHTML = `
      <div class="private-event-card" id="private-event-dinner">
        <span class="private-event-icon">🔒</span>
        <span class="private-event-name">${escapeHtml(dinnerPrivateB.customer_name)}</span>
        <button class="btn-cancel" onclick="removePrivateEvent(${dinnerPrivateB.id}, 'dinner')" title="Remove Private Event">×</button>
      </div>
    ` + dinnerBookingsEl.innerHTML;
  }

  // Show modal
  document.getElementById('day-modal').classList.remove('hidden');

  // Update scroll buttons
  updateScrollButtons('lunch');
  updateScrollButtons('dinner');

  // Focus first name input
  if (!lunchLocked) setTimeout(() => document.getElementById('dm-name-lunch')?.focus(), 100);
}

function closeDayModal() {
  document.getElementById('day-modal').classList.add('hidden');
  document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
}

function closePanel() {
  document.getElementById('booking-panel')?.classList.add('hidden');
}

// Keep openDayPanel as alias
const openDayPanel = openDayModal;
const openMobilePanel = openDayModal;

function renderDayBookings(slot, bookings) {
  const container = document.getElementById(`dm-${slot}-bookings`);
  if (!container) return;
  // Save scroll buttons
  const upBtn = container.querySelector('.day-scroll-btn.up');
  const downBtn = container.querySelector('.day-scroll-btn.down');

  if (bookings.length === 0) {
    container.innerHTML = '';
    if (upBtn) container.appendChild(upBtn);
    if (downBtn) container.appendChild(downBtn);
    updateScrollButtons(slot);
    return;
  }
  const isAdmin = auth.isAdmin();
  const rows = bookings.map(b => `
    <div class="day-booking-row" id="day-booking-${b.id}">
      <span class="booking-time">${b.time}</span>
      ${b.status === 'pending' ? '<span class="booking-pending-badge">PENDING</span>' : ''}
      <span class="booking-name">${escapeHtml(b.customer_name)}</span>
      <span class="booking-pax">${b.party_size}p</span>
      ${b.notes ? `<span class="booking-remark">${escapeHtml(b.notes)}</span>` : ''}
      <div class="booking-actions">
        ${isAdmin && b.status === 'pending' ?
          `<button class="btn-confirm" onclick="confirmBooking(${b.id})">✓ Confirm</button>` : ''}
        ${isAdmin && b.status === 'confirmed' ?
          `<span class="btn-confirm confirmed" title="Confirmed">✓ OK</span>` : ''}
        ${(isAdmin || b.user_id === auth.getUser()?.id) ?
          `<button class="btn-icon" onclick="startInlineEdit(${b.id})" title="Edit">✏️</button>
           <button class="btn-cancel" onclick="cancelBooking(${b.id})">×</button>` : ''}
      </div>
    </div>
  `).join('');
  container.innerHTML = rows;
  if (upBtn) container.appendChild(upBtn);
  if (downBtn) container.appendChild(downBtn);
  updateScrollButtons(slot);
}

function renderBookingList(containerId, bookings) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (bookings.length === 0) {
    container.innerHTML = '<div class="slot-empty">No bookings</div>';
    return;
  }
  container.innerHTML = bookings.map(b => `
    <div class="booking-item" id="booking-item-${b.id}" data-booking-id="${b.id}">
      <div class="booking-info">
        <span class="booking-name">${escapeHtml(b.customer_name)}</span>
        <span class="booking-meta">${b.time} · ${b.party_size} pax</span>
        ${b.notes ? `<span class="booking-meta">${escapeHtml(b.notes)}</span>` : ''}
        ${auth.isAdmin() ? `<span class="booking-meta">${escapeHtml(b.user_display_name || '')}</span>` : ''}
      </div>
      <div class="booking-actions">
        ${(auth.isAdmin() || b.user_id === auth.getUser()?.id) ?
          `<button class="btn-icon" onclick="startInlineEdit(${b.id})" title="Edit">✏️</button>
           <button class="btn-cancel" onclick="cancelBooking(${b.id})">×</button>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── Mobile View ─────────────────────────────────────────
function renderMobileBookings() {
  const dateStr = document.getElementById('mobile-date').value;
  if (!dateStr) return;
  // On mobile, tapping the date in mobile view opens the day modal directly
  // But we also show a quick summary
  const dayBookings = allBookings.filter(b => b.date === dateStr && b.status !== 'cancelled');
  const lunchBookings = dayBookings.filter(b => b.slot === 'lunch');
  const dinnerBookings = dayBookings.filter(b => b.slot === 'dinner');

  const container = document.getElementById('mobile-bookings');
  container.innerHTML = `
    ${renderMobileSlot('lunch', '🍽️ Lunch', lunchBookings, 'btn-book-lunch-mobile')}
    ${renderMobileSlot('dinner', '🌙 Dinner', dinnerBookings, 'btn-book-dinner-mobile')}
  `;
}

function renderMobileSlot(slot, label, bookings, btnId) {
  const isFull = bookings.length >= 6;
  const totalGuests = bookings.reduce((sum, b) => sum + (b.party_size || 0), 0);
  const times = SLOT_TIMES[slot];
  const bookedTimes = bookings.map(b => b.time);

  const timeChipsHtml = times.map(t => {
    const taken = bookedTimes.includes(t);
    const count = bookings.filter(b => b.time === t).length;
    return `<span class="time-chip ${taken ? 'taken' : 'available'}">${taken ? t + `(${count})` : t}</span>`;
  }).join('');

  const firstAvailable = times.find(t => !bookedTimes.includes(t)) || times[0];

  return `
    <div class="mobile-slot ${slot}">
      <div class="mobile-slot-header">
        <span>${label}</span>
        <span>${bookings.length}/6 (${totalGuests}人)${isFull ? ' FULL' : ''}</span>
      </div>
      <div class="time-chips" style="padding:0.5rem 1rem">${timeChipsHtml}</div>
      ${!isFull ? `
        <div class="quick-form" style="padding:0 1rem">
          <input type="text" id="mq-name-${slot}" class="quick-input" placeholder="Name *" value="">
          <select id="mq-time-${slot}" class="quick-select">
            ${times.map(t => `<option value="${t}" ${t === firstAvailable ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <input type="number" id="mq-pax-${slot}" class="quick-pax" min="1" max="20" value="2">
          <button class="btn btn-primary btn-sm" onclick="handleMobileQuickAdd('${slot}')">Add</button>
        </div>
      ` : ''}
      ${bookings.length === 0 ?
        '<div class="mobile-slot-empty">No bookings yet</div>' :
        bookings.map(b => `
          <div class="mobile-booking-item" id="mobile-booking-item-${b.id}">
            <div class="mobile-booking-info">
              <span class="mobile-booking-name">${escapeHtml(b.customer_name)}</span>
              <span class="mobile-booking-meta">${b.time} · ${b.party_size} pax</span>
              ${b.notes ? `<span class="mobile-booking-meta">${escapeHtml(b.notes)}</span>` : ''}
              ${auth.isAdmin() ? `<span class="mobile-booking-meta">${escapeHtml(b.user_display_name || '')}</span>` : ''}
            </div>
            ${(auth.isAdmin() || b.user_id === auth.getUser()?.id) ?
              `<div style="display:flex;gap:0.25rem">
                <button class="btn-icon btn-sm" onclick="startInlineEditMobile(${b.id})" title="Edit">✏️</button>
                <button class="btn-cancel" onclick="cancelBooking(${b.id})">×</button>
              </div>` : ''}
          </div>
        `).join('')
      }
    </div>
  `;
}

function changeMobileDate(delta) {
  const input = document.getElementById('mobile-date');
  const date = new Date(input.value + 'T00:00:00');
  date.setDate(date.getDate() + delta);
  input.value = formatDate(date);
  openDayModal(input.value);  // Open day modal directly on mobile
}

// ─── Month Picker ─────────────────────────────────────────
function openMonthPicker() {
  const modal = document.getElementById('month-picker-modal');
  const yearInput = document.getElementById('picker-year-input');
  yearInput.value = currentYear;
  renderMonthGrid(currentYear, currentMonth);
  modal.classList.remove('hidden');
}

function closeMonthPicker() {
  document.getElementById('month-picker-modal').classList.add('hidden');
}

function renderMonthGrid(year, selectedMonth) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const grid = document.getElementById('month-grid');
  grid.innerHTML = monthNames.map((name, i) => {
    const m = i + 1;
    const selected = m === selectedMonth && year === currentYear ? ' selected' : '';
    return `<div class="month-cell${selected}" onclick="selectMonth(${m})">${name}</div>`;
  }).join('');
}

function changePickerYear(delta) {
  const input = document.getElementById('picker-year-input');
  input.value = parseInt(input.value) + delta;
  onPickerYearChange();
}

function onPickerYearChange() {
  const year = parseInt(document.getElementById('picker-year-input').value);
  renderMonthGrid(year, currentMonth);
}

function selectMonth(month) {
  currentMonth = month;
  currentYear = parseInt(document.getElementById('picker-year-input').value);
  closeMonthPicker();
  loadBookings();
}

// ─── Time Chips ───────────────────────────────────────────
const SLOT_TIMES = {
  lunch: ['12:00','12:30','13:00','13:30','14:00','14:30'],
  dinner: ['19:00','19:30','20:00','20:30','21:00']
};

function renderDayChips(slot, bookings, locked = false) {
  const container = document.getElementById(`dm-${slot}-chips`);
  const times = SLOT_TIMES[slot];
  const bookedTimes = bookings.map(b => b.time);
  if (!container) return;

  container.innerHTML = times.map(t => {
    const taken = bookedTimes.includes(t);
    const count = bookings.filter(b => b.time === t).length;
    return `<span class="day-chip ${taken ? 'taken' : 'available'}">${taken ? t + ` (${count})` : t}</span>`;
  }).join('');
}

function populateDayTimeSelect(slot, bookings, locked = false) {
  const select = document.getElementById(`dm-time-${slot}`);
  const times = SLOT_TIMES[slot];
  const bookedTimes = bookings.map(b => b.time);
  if (!select) return;
  select.innerHTML = times.map(t => {
    return `<option value="${t}">${t}</option>`;
  }).join('');
}

// ─── Day Modal Add ─────────────────────────────────────────
async function handleDayModalAdd(slot) {
  const nameInput = document.getElementById(`dm-name-${slot}`);
  const timeSelect = document.getElementById(`dm-time-${slot}`);
  const paxInput = document.getElementById(`dm-pax-${slot}`);
  const remarkInput = document.getElementById(`dm-remark-${slot}`);
  const privateCheckbox = document.getElementById(`dm-private-${slot}`);

  const isPrivate = privateCheckbox?.checked || false;
  const customer_name = nameInput.value.trim() || (isPrivate ? 'Private Event' : '');
  const time = timeSelect.value;
  const party_size = isPrivate ? 0 : (parseInt(paxInput.value) || 2);
  const notes = remarkInput.value.trim();

  if (!isPrivate && !customer_name) {
    showToast('Please enter name', 'error');
    nameInput.focus();
    return;
  }

  const dayBookings = allBookings.filter(b => b.date === selectedDate && b.slot === slot && b.status !== 'cancelled');
  const totalGuests = dayBookings.reduce((sum, b) => sum + (b.party_size || 0), 0);

  if (dayBookings.some(b => b.is_private_event)) {
    showToast('Slot is locked (Private Event)', 'error');
    return;
  }

  if (!isPrivate && totalGuests >= 16) {
    showToast('Session full! 16 guests limit reached.', 'error');
    return;
  }

  if (!isPrivate && totalGuests + party_size > 16) {
    showToast(`Only ${16 - totalGuests} seats remaining!`, 'error');
    return;
  }

  const submitBtn = document.querySelector('#booking-form button[type="submit"]');
  const originalText = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) {
    submitBtn.textContent = 'Reserving...';
    submitBtn.disabled = true;
  }

  try {
    await api.createBooking({
      date: selectedDate, slot, time, party_size, customer_name, notes, is_private_event: isPrivate
    }, auth.getToken());
    showToast(isPrivate ? 'Private Event set! Slot locked.' : '✅ Table Reserved!', 'success');
    // Refresh in background (don't wait)
    loadBookings().then(() => openDayModal(selectedDate));
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  }
}

// ─── Remove Private Event ────────────────────────────────
async function removePrivateEvent(bookingId, slot) {
  if (!confirm('Remove this Private Event?')) return;
  try {
    await api.deleteBooking(bookingId, auth.getToken());
    showToast('Private Event removed');
    await loadBookings();
    openDayModal(selectedDate);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Confirm Booking ──────────────────────────────────────
async function confirmBooking(id) {
  try {
    await api.confirmBooking(id, auth.getToken());
    showToast('Booking confirmed!');
    await loadBookings();
    openDayModal(selectedDate);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Also allow Enter key in quick form
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const panel = document.getElementById('booking-panel');
      if (!panel.classList.contains('hidden')) {
        const focused = document.activeElement;
        if (focused && focused.classList.contains('quick-input')) {
          const slot = focused.id.startsWith('q-name-lunch') ? 'lunch' : 'dinner';
          handleQuickAdd(slot);
        }
      }
    }
  });
});

async function handleMobileQuickAdd(slot) {
  const nameInput = document.getElementById(`mq-name-${slot}`);
  const timeSelect = document.getElementById(`mq-time-${slot}`);
  const paxInput = document.getElementById(`mq-pax-${slot}`);

  const customer_name = nameInput.value.trim();
  const time = timeSelect.value;
  const party_size = parseInt(paxInput.value) || 2;

  if (!customer_name) {
    showToast('Please enter customer name', 'error');
    nameInput.focus();
    return;
  }

  const dayBookings = allBookings.filter(b => b.date === selectedDate && b.slot === slot && b.status !== 'cancelled');
  if (dayBookings.length >= 6) {
    showToast('This slot is full!', 'error');
    return;
  }

  const bookedTimes = dayBookings.map(b => b.time);
  if (bookedTimes.includes(time)) {
    showToast(`Time ${time} is already booked! Choose another.`, 'error');
    return;
  }

  try {
    const token = auth.getToken();
    await api.createBooking({
      date: selectedDate,
      slot: slot,
      time: time,
      party_size: party_size,
      customer_name: customer_name
    }, token);
    nameInput.value = '';
    paxInput.value = '2';
    showToast('✅ Table Reserved!', 'success');
    loadBookings().then(() => renderMobileBookings());
  } catch (err) {
    showToast(err.message, 'error');
  }
}
function startInlineEdit(bookingId) {
  const booking = allBookings.find(b => b.id === bookingId);
  if (!booking) return;

  // Check both old panel ID and new day-modal ID
  let item = document.getElementById(`booking-item-${bookingId}`);
  if (!item) item = document.getElementById(`day-booking-${bookingId}`);
  if (!item) return;

  item.innerHTML = `
    <div class="inline-edit-row">
      <input type="text" class="inline-edit-input" id="edit-name-${bookingId}" value="${escapeHtml(booking.customer_name)}" placeholder="Name">
      <input type="tel" class="inline-edit-input" id="edit-phone-${bookingId}" value="${escapeHtml(booking.customer_phone || '')}" placeholder="Phone">
      <input type="text" class="inline-edit-input" id="edit-notes-${bookingId}" value="${escapeHtml(booking.notes || '')}" placeholder="Notes">
      <div class="edit-confirm-row">
        <button class="btn-confirm-edit" onclick="saveInlineEdit(${bookingId})">Save</button>
        <button class="btn btn-secondary btn-sm" onclick="cancelInlineEdit('${booking.date}', '${booking.slot}')">Cancel</button>
      </div>
    </div>
  `;
}

function startInlineEditMobile(bookingId) {
  startInlineEdit(bookingId);
}

async function saveInlineEdit(bookingId) {
  const name = document.getElementById(`edit-name-${bookingId}`).value.trim();
  const phone = document.getElementById(`edit-phone-${bookingId}`).value.trim();
  const notes = document.getElementById(`edit-notes-${bookingId}`).value.trim();

  if (!name) {
    showToast('Name is required', 'error');
    return;
  }

  try {
    const token = auth.getToken();
    await api.updateBooking(bookingId, {
      customer_name: name,
      customer_phone: phone,
      notes: notes
    }, token);
    showToast('Booking updated');
    await loadBookings();
    if (!document.getElementById('day-modal').classList.contains('hidden')) {
      openDayModal(selectedDate);
    } else if (window.innerWidth < 769) {
      renderMobileBookings();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function cancelInlineEdit(date, slot) {
  if (window.innerWidth < 769) {
    renderMobileBookings();
  } else {
    openMobilePanel(date);
  }
}

// ─── Month Navigation ─────────────────────────────────────
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  loadBookings();
}

function goToToday() {
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth() + 1;
  loadBookings();
}

// ─── Booking Modal ───────────────────────────────────────
function openModal(slot) {
  selectedSlot = slot;
  document.getElementById('booking-slot').value = slot;
  document.getElementById('modal-title').textContent = `New ${slot.charAt(0).toUpperCase() + slot.slice(1)} Booking`;
  document.getElementById('booking-form').reset();
  document.getElementById('booking-slot').value = slot;
  updateTimeOptions();
  document.getElementById('booking-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('booking-modal').classList.add('hidden');
}

function updateTimeOptions() {
  const slot = document.getElementById('booking-slot').value;
  const timeSelect = document.getElementById('booking-time');
  let times = [];

  if (slot === 'lunch') {
    times = ['12:00','12:30','13:00','13:30','14:00','14:30'];
  } else {
    times = ['19:00','19:30','20:00','20:30','21:00'];
  }

  timeSelect.innerHTML = times.map(t => `<option value="${t}">${t}</option>`).join('');
}

async function handleBookingSubmit(e) {
  e.preventDefault();

  const booking = {
    date: selectedDate,
    slot: document.getElementById('booking-slot').value,
    time: document.getElementById('booking-time').value,
    party_size: parseInt(document.getElementById('booking-size').value),
    customer_name: document.getElementById('booking-name').value,
    customer_phone: document.getElementById('booking-phone').value,
    notes: document.getElementById('booking-notes').value,
  };

  try {
    await api.createBooking(booking, auth.getToken());
    closeModal();
    showToast('✅ Table Reserved!', 'success');
    loadBookings().then(() => openMobilePanel(selectedDate));
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cancelBooking(id) {
  if (!confirm('Cancel this booking?')) return;
  try {
    await api.deleteBooking(id, auth.getToken());
    showToast('Booking cancelled');
    await loadBookings();
    if (document.getElementById('day-modal').classList.contains('hidden')) {
      if (window.innerWidth < 769) renderMobileBookings();
    } else {
      openDayModal(selectedDate);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Helpers ─────────────────────────────────────────────
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function groupByDate(bookings) {
  return bookings.reduce((acc, b) => {
    if (!acc[b.date]) acc[b.date] = [];
    acc[b.date].push(b);
    return acc;
  }, {});
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#059669' : '#1C1917';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ─── System Log View ─────────────────────────────────────
function showBookingsView() {
  document.getElementById('nav-bookings')?.classList.add('active');
  document.getElementById('nav-users')?.classList.remove('active');
  document.getElementById('nav-logs')?.classList.remove('active');
  document.getElementById('desktop-view').classList.remove('hidden');
  document.getElementById('mobile-view').classList.add('hidden');
  document.getElementById('system-log-view').classList.add('hidden');
  document.getElementById('members-view')?.classList.add('hidden');
}

function showMembersView() {
  document.getElementById('nav-bookings')?.classList.remove('active');
  document.getElementById('nav-users')?.classList.add('active');
  document.getElementById('nav-logs')?.classList.remove('active');
  document.getElementById('desktop-view').classList.add('hidden');
  document.getElementById('mobile-view').classList.add('hidden');
  document.getElementById('system-log-view').classList.add('hidden');
  document.getElementById('members-view')?.classList.remove('hidden');
  loadPendingUsers();
  loadAllUsers();
}

function showLogsView() {
  document.getElementById('nav-bookings')?.classList.remove('active');
  document.getElementById('nav-users')?.classList.remove('active');
  document.getElementById('nav-logs')?.classList.add('active');
  document.getElementById('desktop-view').classList.add('hidden');
  document.getElementById('mobile-view').classList.add('hidden');
  document.getElementById('system-log-view').classList.remove('hidden');
  document.getElementById('members-view')?.classList.add('hidden');
  logPage = 1;
  loadSystemLogs();
}

// ─── CSV Export ──────────────────────────────────────────
document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
  const startDate = document.getElementById('export-start-date')?.value;
  const endDate = document.getElementById('export-end-date')?.value;
  
  let url = '/api/bookings/export/csv';
  const params = [];
  if (startDate) params.push(`start_date=${startDate}`);
  if (endDate) params.push(`end_date=${endDate}`);
  if (params.length > 0) url += '?' + params.join('&');
  
  try {
    const token = auth.getToken();
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('Export failed');
    
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `bookings_${startDate || 'start'}_to_${endDate || 'end'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
    showToast('CSV downloaded!', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
});

// ─── Admin: Pending Users ────────────────────────────────
async function loadPendingCount() {
  if (!auth.isAdmin()) return;
  try {
    const data = await api.getPendingUsers(auth.getToken());
    const count = data?.count || 0;
    const badge = document.getElementById('pending-badge');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
  } catch(e) {}
}

async function loadPendingUsers() {
  try {
    const data = await api.getPendingUsers(auth.getToken());
    const users = data?.users || [];
    const container = document.getElementById('pending-users-list');
    const countBadge = document.getElementById('pending-count-badge');

    countBadge.textContent = users.length;
    countBadge.classList.toggle('hidden', users.length === 0);

    if (users.length === 0) {
      container.innerHTML = '<div style="color:#78716C;font-size:0.8rem;padding:0.5rem 0">No pending registrations</div>';
      return;
    }

    container.innerHTML = users.map(u => `
      <div class="pending-user-card">
        <div class="user-info">
          <span class="user-name">${escapeHtml(u.display_name)}</span>
          <span class="user-email">${escapeHtml(u.email)}</span>
          <span class="user-date">${formatLogDate(u.created_at)}</span>
        </div>
        <div class="user-actions">
          <button class="btn-approve" onclick="approveUser(${u.id})">✓ Approve</button>
          <button class="btn-reject" onclick="rejectUser(${u.id})">✕ Reject</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    document.getElementById('pending-users-list').innerHTML = '<div style="color:#DC2626">Failed to load</div>';
  }
}

async function loadAllUsers() {
  try {
    const res = await fetch('/api/users', {
      headers: { Authorization: `Bearer ${auth.getToken()}` }
    });
    const json = await res.json();
    const users = json?.data || [];
    const container = document.getElementById('all-users-list');

    container.innerHTML = users.map(u => `
      <div class="all-user-row">
        <div class="user-info">
          <span style="font-weight:600">${escapeHtml(u.display_name)}</span>
          <span style="color:#78716C;font-size:0.75rem">${escapeHtml(u.email)}</span>
        </div>
        <span class="user-status ${u.status}">${u.status.toUpperCase()}</span>
      </div>
    `).join('');
  } catch(e) {}
}

async function approveUser(id) {
  try {
    await api.approveUser(id, auth.getToken());
    showToast('User approved!');
    await loadPendingUsers();
    await loadPendingCount();
  } catch(err) { showToast(err.message, 'error'); }
}

async function rejectUser(id) {
  try {
    await api.rejectUser(id, auth.getToken());
    showToast('User rejected');
    await loadPendingUsers();
    await loadPendingCount();
  } catch(err) { showToast(err.message, 'error'); }
}

async function loadSystemLogs() {
  const params = {
    page: logPage,
    limit: 50
  };
  const startDate = document.getElementById('log-start-date').value;
  const endDate = document.getElementById('log-end-date').value;
  const action = document.getElementById('log-action-filter').value;

  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  if (action) params.action = action;

  try {
    const result = await api.getSystemLogs(params, auth.getToken());
    renderSystemLogs(result.logs);
    logTotalPages = result.pages;
    updateLogPagination(result);
  } catch (err) {
    showToast('Failed to load system logs: ' + err.message, 'error');
  }
}

function renderSystemLogs(logs) {
  const tbody = document.getElementById('log-tbody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="log-empty">No logs found</td></tr>';
    return;
  }

  const actionColors = {
    booking_created: '#059669',
    booking_confirmed: '#2563EB',
    booking_modified: '#D97706',
    booking_cancelled: '#DC2626',
    user_login: '#78716C',
    user_registered: '#7C3AED',
    user_approved: '#059669',
    user_rejected: '#DC2626'
  };

  const actionLabels = {
    booking_created: 'CREATE',
    booking_confirmed: 'CONFIRM',
    booking_modified: 'EDIT',
    booking_cancelled: 'CANCEL',
    user_login: 'LOGIN',
    user_registered: 'REGISTER',
    user_approved: 'APPROVE',
    user_rejected: 'REJECT'
  };

  tbody.innerHTML = logs.map(log => {
    let details = {};
    try { details = JSON.parse(log.details || '{}'); } catch(e) {}

    let detailsText = '';
    if (log.action === 'booking_created') {
      detailsText = `${details.customer_name} · ${details.slot} ${details.time} · ${details.party_size}pax`;
    } else if (log.action === 'booking_cancelled') {
      detailsText = `${details.customer_name} · ${details.date} ${details.slot}`;
    } else if (log.action === 'booking_confirmed') {
      detailsText = `${details.customer_name} · ${details.date} ${details.slot} ${details.time}`;
    } else if (log.action === 'booking_modified') {
      const changes = Object.entries(details.changes || {}).map(([k,v]) => `${k}: ${v.from}→${v.to}`).join(', ');
      detailsText = `${details.customer_name} · ${changes}`;
    } else if (log.action === 'user_login') {
      detailsText = details.email || '';
    } else if (log.action === 'user_registered') {
      detailsText = `${details.display_name} (${details.email})`;
    } else if (log.action === 'user_approved' || log.action === 'user_rejected') {
      detailsText = `${details.display_name} (${details.email})`;
    }

    const color = actionColors[log.action] || '#1C1917';
    const label = actionLabels[log.action] || log.action;

    return `
      <tr>
        <td style="white-space:nowrap">${formatLogDate(log.created_at)}</td>
        <td><span style="background:${color};color:white;padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700">${label}</span></td>
        <td style="font-weight:600;color:#1C1917">${escapeHtml(log.actor_name || '-')}</td>
        <td style="color:#444">${escapeHtml(detailsText)}</td>
      </tr>
    `;
  }).join('');
}

function formatLogDate(dateStr) {
  // Stored string is in HK time (YYYY-MM-DD HH:mm:ss from SQLite in Asia/Hong_Kong TZ).
  // new Date() interprets 'YYYY-MM-DD HH:mm:ss' as UTC → wrong.
  // Append GMT offset so it's parsed as HK local time.
  const d = new Date(dateStr + ' GMT+0800');
  return d.toLocaleString('en-HK', {
    timeZone: 'Asia/Hong_Kong',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
}

function updateLogPagination(result) {
  document.getElementById('log-prev').disabled = logPage <= 1;
  document.getElementById('log-next').disabled = logPage >= logTotalPages;
  document.getElementById('log-page-info').textContent =
    `Page ${result.page} of ${result.pages} (${result.total} total)`;
}

// ─── Settings Panel ────────────────────────────────────────
const DEFAULT_SETTINGS = {
  cellHeight: 160,
  cellPadding: 4,
  colorLunch: '#fef9c3',
  colorLunchConf: '#fde68a',
  colorDinner: '#d1fae5',
  colorDinnerConf: '#6ee7b7',
  fontDate: 11,
  fontBooking: 9,
  blockWidth: 90,
};

let settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('bookinglog_settings') || '{}') };

function saveSettings() {
  localStorage.setItem('bookinglog_settings', JSON.stringify(settings));
  applySettings();
}

function applySettings() {
  const root = document.documentElement;
  // Calendar cell
  document.querySelectorAll('.calendar-day').forEach(el => {
    el.style.minHeight = settings.cellHeight + 'px';
  });
  document.querySelectorAll('.day-slot-block').forEach(el => {
    el.style.width = settings.blockWidth + '%';
  });
  // Lunch colors
  document.querySelectorAll('.day-slot-block.lunch').forEach(el => {
    el.style.background = settings.colorLunch;
  });
  document.querySelectorAll('.day-booking.lunch.confirmed-name').forEach(el => {
    el.style.background = settings.colorLunchConf;
  });
  document.querySelectorAll('.day-booking.lunch.pending-name').forEach(el => {
    el.style.background = 'transparent';
  });
  // Dinner colors
  document.querySelectorAll('.day-slot-block.dinner').forEach(el => {
    el.style.background = settings.colorDinner;
  });
  document.querySelectorAll('.day-booking.dinner.confirmed-name').forEach(el => {
    el.style.background = settings.colorDinnerConf;
  });
  document.querySelectorAll('.day-booking.dinner.pending-name').forEach(el => {
    el.style.background = 'transparent';
  });
  // Font sizes
  document.querySelectorAll('.day-num').forEach(el => {
    el.style.fontSize = settings.fontDate + 'px';
  });
  document.querySelectorAll('.day-booking').forEach(el => {
    el.style.fontSize = settings.fontBooking + 'px';
  });
  // Padding
  document.querySelectorAll('.day-slot-block').forEach(el => {
    el.style.paddingTop = settings.cellPadding + 'px';
    el.style.paddingBottom = settings.cellPadding + 'px';
  });
}

function openSettingsPanel() {
  document.getElementById('settings-panel').classList.remove('hidden');
  loadSettingsToUI();
}

function closeSettingsPanel() {
  document.getElementById('settings-panel').classList.add('hidden');
}

function loadSettingsToUI() {
  const s = settings;
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
  const lbl = (id, val, unit) => { const el = document.getElementById(id); if(el) el.textContent = val + unit; };

  set('set-cell-height', s.cellHeight); lbl('lbl-cell-height', s.cellHeight, 'px');
  set('set-cell-padding', s.cellPadding); lbl('lbl-cell-padding', s.cellPadding, 'px');
  set('set-color-lunch', s.colorLunch); set('set-color-lunch-txt', s.colorLunch);
  set('set-color-lunch-conf', s.colorLunchConf); set('set-color-lunch-conf-txt', s.colorLunchConf);
  set('set-color-dinner', s.colorDinner); set('set-color-dinner-txt', s.colorDinner);
  set('set-color-dinner-conf', s.colorDinnerConf); set('set-color-dinner-conf-txt', s.colorDinnerConf);
  set('set-font-date', s.fontDate); lbl('lbl-font-date', s.fontDate, 'px');
  set('set-font-booking', s.fontBooking); lbl('lbl-font-booking', s.fontBooking, 'px');
  set('set-block-width', s.blockWidth); lbl('lbl-block-width', s.blockWidth, '%');
}

function bindSettingSlider(id, settingKey, labelId, unit, min, max, callback) {
  const slider = document.getElementById(id);
  const label = document.getElementById(labelId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    settings[settingKey] = val;
    if (label) label.textContent = val + unit;
    if (callback) callback(val);
    saveSettings();
  });
  slider.min = min;
  slider.max = max;
}

function bindColorPicker(colorId, txtId, settingKey, callback) {
  const picker = document.getElementById(colorId);
  const txt = document.getElementById(txtId);
  if (!picker) return;
  const sync = (hex) => {
    settings[settingKey] = hex;
    if (txt) txt.value = hex;
    if (callback) callback(hex);
    saveSettings();
  };
  picker.addEventListener('input', () => sync(picker.value));
  if (txt) txt.addEventListener('change', () => {
    const hex = txt.value;
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      picker.value = hex;
      sync(hex);
    }
  });
}

function initSettingsPanel() {
  document.getElementById('btn-settings')?.addEventListener('click', openSettingsPanel);
  document.getElementById('settings-close')?.addEventListener('click', closeSettingsPanel);
  document.getElementById('settings-panel')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-panel') closeSettingsPanel();
  });
  document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    localStorage.removeItem('bookinglog_settings');
    loadSettingsToUI();
    applySettings();
  });

  bindSettingSlider('set-cell-height', 'cellHeight', 'lbl-cell-height', 'px', 100, 220);
  bindSettingSlider('set-cell-padding', 'cellPadding', 'lbl-cell-padding', 'px', 2, 16);
  bindSettingSlider('set-font-date', 'fontDate', 'lbl-font-date', 'px', 9, 16);
  bindSettingSlider('set-font-booking', 'fontBooking', 'lbl-font-booking', 'px', 8, 14);
  bindSettingSlider('set-block-width', 'blockWidth', 'lbl-block-width', '%', 70, 100);

  bindColorPicker('set-color-lunch', 'set-color-lunch-txt', 'colorLunch');
  bindColorPicker('set-color-lunch-conf', 'set-color-lunch-conf-txt', 'colorLunchConf');
  bindColorPicker('set-color-dinner', 'set-color-dinner-txt', 'colorDinner');
  bindColorPicker('set-color-dinner-conf', 'set-color-dinner-conf-txt', 'colorDinnerConf');
}
