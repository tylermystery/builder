// In: components/calendarView.js
import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import * as ui from '../ui.js';

let fullEventList = []; // Stores all upcoming events fetched from the server
let calendarInstance = null;

// Calendar state
let currentView = 'month'; // 'month', 'week', 'list'
let currentDate = new Date(); // The date currently being viewed

async function fetchUpcomingEvents() {
    log('Calendar', 'Fetching all public events from state...');

    // Use the already-loaded records from the main app state
    if (!state.records.all || state.records.all.length === 0) {
        log('Calendar', 'Records not loaded yet.');
        return [];
    }

    const eventItems = state.records.all.filter(record => {
        if (record._planInstance) return false;
        const itemType = record.fields['Item Type'];
        const hasDate = record.fields.Date;
        const isEvent = itemType === 'Event';
        return isEvent && hasDate;
    });

    log('Calendar', `Found ${eventItems.length} public events.`);

    // Map to the format our calendar logic will use
    return eventItems.map(record => {
        return {
            recordId: record.id,
            name: record.fields.Name || 'Unnamed Event',
            date: new Date(record.fields.Date).toISOString().split('T')[0],
            record: record
        };
    });
}

function getEventsForDay(date) {
    const targetDateStr = date.toISOString().split('T')[0];
    return fullEventList.filter(event => event.date === targetDateStr);
}

// Get events for a week (array of 7 dates)
function getEventsForWeek(startDate) {
    const weekEvents = [];
    for (let i = 0; i < 7; i++) {
        const day = new Date(startDate);
        day.setDate(startDate.getDate() + i);
        weekEvents.push({
            date: day,
            events: getEventsForDay(day)
        });
    }
    return weekEvents;
}

// Helper to format date for display
function formatDate(date) {
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Get start of the week (Sunday)
function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Get month name and year
function getMonthYearString(date) {
    const options = { month: 'long', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Create an event item element
function createEventItem(event) {
    const eventEl = document.createElement('div');
    eventEl.className = 'calendar-event-item';
    eventEl.textContent = event.name;
    eventEl.dataset.recordId = event.recordId;

    if (state.session.user.rsvps.has(event.recordId)) {
        eventEl.classList.add('event-item-rsvpd');
    }

    eventEl.addEventListener('click', (e) => {
        e.stopPropagation();
        log('Calendar', `Event clicked: ${event.name}`);
        if (event.record) {
            ui.showDetailModal(event.record);
            hideCalendarModal();
        }
    });

    return eventEl;
}

// Render month view
function renderMonthView() {
    const calendarContent = document.getElementById('calendar-content');
    if (!calendarContent) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    calendarContent.innerHTML = `
        <div class="calendar-header-controls">
            <button id="calendar-prev" class="calendar-nav-btn">&#9664; Prev</button>
            <h2 class="calendar-title">${getMonthYearString(currentDate)}</h2>
            <button id="calendar-next" class="calendar-nav-btn">Next &#9654;</button>
        </div>
        <div class="calendar-grid">
            <div class="calendar-weekdays">
                <div class="calendar-weekday">Sun</div>
                <div class="calendar-weekday">Mon</div>
                <div class="calendar-weekday">Tue</div>
                <div class="calendar-weekday">Wed</div>
                <div class="calendar-weekday">Thu</div>
                <div class="calendar-weekday">Fri</div>
                <div class="calendar-weekday">Sat</div>
            </div>
            <div class="calendar-days" id="calendar-days"></div>
        </div>
    `;

    const calendarDays = document.getElementById('calendar-days');

    // Add empty cells for days before the first day of month
    for (let i = 0; i < startDayOfWeek; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty';
        calendarDays.appendChild(emptyDay);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month, day);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        const dayEvents = getEventsForDay(dayDate);

        // Check if this is today
        if (dayDate.getTime() === today.getTime()) {
            dayEl.classList.add('today');
        }

        // Check if this day has events
        if (dayEvents.length > 0) {
            dayEl.classList.add('has-events');
        }

        // Day number
        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        dayEl.appendChild(dayNumber);

        // Events for this day (show up to 3, then "+X more")
        if (dayEvents.length > 0) {
            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'calendar-day-events';

            const maxVisible = 3;
            dayEvents.slice(0, maxVisible).forEach(event => {
                eventsContainer.appendChild(createEventItem(event));
            });

            if (dayEvents.length > maxVisible) {
                const moreEl = document.createElement('div');
                moreEl.className = 'calendar-more-events';
                moreEl.textContent = `+${dayEvents.length - maxVisible} more`;
                eventsContainer.appendChild(moreEl);
            }

            dayEl.appendChild(eventsContainer);
        }

        calendarDays.appendChild(dayEl);
    }

    // Add navigation event listeners
    document.getElementById('calendar-prev')?.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('calendar-next')?.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
}

// Render week view
function renderWeekView() {
    const calendarContent = document.getElementById('calendar-content');
    if (!calendarContent) return;

    const startOfWeek = getStartOfWeek(currentDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekEvents = getEventsForWeek(startOfWeek);

    calendarContent.innerHTML = `
        <div class="calendar-header-controls">
            <button id="calendar-prev" class="calendar-nav-btn">&#9664; Prev</button>
            <h2 class="calendar-title">${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}</h2>
            <button id="calendar-next" class="calendar-nav-btn">Next &#9654;</button>
        </div>
        <div class="calendar-week-grid" id="calendar-week-grid"></div>
    `;

    const weekGrid = document.getElementById('calendar-week-grid');

    weekEvents.forEach(dayData => {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-week-day';

        const dayDate = dayData.date;
        dayDate.setHours(0, 0, 0, 0);

        if (dayDate.getTime() === today.getTime()) {
            dayEl.classList.add('today');
        }

        if (dayData.events.length > 0) {
            dayEl.classList.add('has-events');
        }

        const dayHeader = document.createElement('div');
        dayHeader.className = 'calendar-week-day-header';
        dayHeader.innerHTML = `
            <span class="day-name">${dayDate.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <span class="day-number">${dayDate.getDate()}</span>
        `;
        dayEl.appendChild(dayHeader);

        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'calendar-week-day-events';

        if (dayData.events.length === 0) {
            eventsContainer.innerHTML = '<div class="no-events">No events</div>';
        } else {
            dayData.events.forEach(event => {
                eventsContainer.appendChild(createEventItem(event));
            });
        }

        dayEl.appendChild(eventsContainer);
        weekGrid.appendChild(dayEl);
    });

    // Navigation
    document.getElementById('calendar-prev')?.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 7);
        renderCalendar();
    });

    document.getElementById('calendar-next')?.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 7);
        renderCalendar();
    });
}

// Render list view
function renderListView() {
    const calendarContent = document.getElementById('calendar-content');
    if (!calendarContent) return;

    // Sort events by date
    const sortedEvents = [...fullEventList].sort((a, b) => {
        return new Date(a.date) - new Date(b.date);
    });

    // Group events by month
    const eventsByMonth = {};
    sortedEvents.forEach(event => {
        const eventDate = new Date(event.date);
        const monthKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}`;
        const monthName = eventDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        if (!eventsByMonth[monthKey]) {
            eventsByMonth[monthKey] = {
                name: monthName,
                events: []
            };
        }
        eventsByMonth[monthKey].events.push(event);
    });

    calendarContent.innerHTML = `
        <div class="calendar-header-controls">
            <h2 class="calendar-title">All Upcoming Events</h2>
        </div>
        <div class="calendar-list-container" id="calendar-list-container"></div>
    `;

    const listContainer = document.getElementById('calendar-list-container');

    if (sortedEvents.length === 0) {
        listContainer.innerHTML = '<div class="no-events-message">No upcoming events found.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    Object.keys(eventsByMonth).sort().forEach(monthKey => {
        const monthData = eventsByMonth[monthKey];

        const monthSection = document.createElement('div');
        monthSection.className = 'calendar-list-month';

        const monthHeader = document.createElement('h3');
        monthHeader.className = 'calendar-list-month-header';
        monthHeader.textContent = monthData.name;
        monthSection.appendChild(monthHeader);

        const eventsList = document.createElement('div');
        eventsList.className = 'calendar-list-events';

        monthData.events.forEach(event => {
            const eventDate = new Date(event.date);
            eventDate.setHours(0, 0, 0, 0);

            const eventEl = document.createElement('div');
            eventEl.className = 'calendar-list-event';

            if (eventDate.getTime() === today.getTime()) {
                eventEl.classList.add('today');
            }

            if (state.session.user.rsvps.has(event.recordId)) {
                eventEl.classList.add('event-item-rsvpd');
            }

            eventEl.innerHTML = `
                <div class="event-date">${formatDate(eventDate)}</div>
                <div class="event-name">${event.name}</div>
            `;

            eventEl.addEventListener('click', () => {
                log('Calendar', `Event clicked: ${event.name}`);
                if (event.record) {
                    ui.showDetailModal(event.record);
                    hideCalendarModal();
                }
            });

            eventsList.appendChild(eventEl);
        });

        monthSection.appendChild(eventsList);
        listContainer.appendChild(monthSection);
    });
}

// Main render function that dispatches to the correct view
async function renderCalendar() {
    const calendarContent = document.getElementById('calendar-content');
    if (!calendarContent) return;

    // Show loading state
    calendarContent.innerHTML = '<div class="calendar-loading">Loading events...</div>';

    // Fetch events if not already loaded
    if (fullEventList.length === 0) {
        fullEventList = await fetchUpcomingEvents();
    }

    // Render based on current view
    switch (currentView) {
        case 'month':
            renderMonthView();
            break;
        case 'week':
            renderWeekView();
            break;
        case 'list':
            renderListView();
            break;
        default:
            renderMonthView();
    }
}

// Handle view switching
function switchView(newView) {
    currentView = newView;

    // Update button active states
    document.querySelectorAll('.calendar-view-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === newView) {
            btn.classList.add('active');
        }
    });

    renderCalendar();
}


export function setupCalendarEventListeners() {
    const calendarModal = document.getElementById('calendar-modal-overlay');
    const closeBtn = document.getElementById('calendar-close-btn');

    document.getElementById('calendar-view-btn')?.addEventListener('click', showCalendarModal);

    closeBtn?.addEventListener('click', hideCalendarModal);
    calendarModal?.addEventListener('click', (e) => {
        if (e.target === calendarModal) {
            hideCalendarModal();
        }
    });

    // Set up view switching buttons
    document.querySelectorAll('.calendar-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view) {
                switchView(view);
            }
        });
    });
}

export async function showCalendarModal() {
    const calendarModal = document.getElementById('calendar-modal-overlay');

    log('Calendar', 'Showing upcoming events calendar.');

    // Reset to current date and month view when opening
    currentDate = new Date();
    currentView = 'month';

    // Reset button active states
    document.querySelectorAll('.calendar-view-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === 'month') {
            btn.classList.add('active');
        }
    });

    // Clear cached events to get fresh data
    fullEventList = [];

    if (calendarModal) {
        calendarModal.classList.add('active');
        calendarModal.style.display = 'flex';
    }
    document.body.classList.add('modal-open');

    // Render the calendar
    await renderCalendar();
}

export function hideCalendarModal() {
    const calendarModal = document.getElementById('calendar-modal-overlay');

    log('Calendar', 'Hiding calendar modal.');

    if (calendarModal) {
        calendarModal.classList.remove('active');
        setTimeout(() => {
            calendarModal.style.display = 'none';
        }, 300);
    }
    document.body.classList.remove('modal-open');
}
