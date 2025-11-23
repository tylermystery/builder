import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import * as ui from '../ui.js';
import { showUserModal } from '../auth.js';

let fullEventList = [];
let currentView = 'month';
let currentDate = new Date();

async function fetchUpcomingEvents() {
    log('Calendar', 'Fetching all public events and plans from state...');

    if (!state.records.all || state.records.all.length === 0) {
        log('Calendar', 'Records not loaded yet.');
        return [];
    }

    console.log(`[Calendar Debug] Checking ${state.records.all.length} total records from state.records.all.`);
    let checkedCount = 0;

    // Fetch event items from the Items table (existing behavior)
    const eventItems = state.records.all.filter(record => {
        checkedCount++;
        const itemType = record.fields['Item Type'];
        const hasDate = record.fields.Date;
        const isEvent = itemType === 'Event';

        const eventName = record.fields.Name || 'Unnamed Record';
        const isOneOfYourEvents = eventName.includes("EVENT_NAME_1") || eventName.includes("EVENT_NAME_2");

        if (checkedCount <= 25 || isOneOfYourEvents) {
            console.log(`[Calendar Debug] Checking: "${eventName}" | Item Type: "${itemType}" | Has Date: ${!!hasDate} | Is "Event": ${isEvent}`);
        }

        return isEvent && hasDate;
    });

    log('Calendar', `Found ${eventItems.length} public events after checking ${checkedCount} total records.`);

    // Map event items to calendar format
    const eventList = eventItems.map(record => {
        const dateStr = record.fields.Date;
        return {
            recordId: record.id,
            name: record.fields.Name || 'Unnamed Event',
            date: dateStr.split('T')[0],
            record: record,
            type: 'event'
        };
    });

    // Fetch sessions with dates for the current store
    let sessionList = [];
    console.log('[Calendar Debug] Checking for activeShopId:', state.ui.activeShopId);
    if (state.ui.activeShopId) {
        try {
            console.log('[Calendar Debug] Calling fetchSessionsWithDatesForStore with shopId:', state.ui.activeShopId);
            const sessionRecords = await api.fetchSessionsWithDatesForStore(state.ui.activeShopId);
            console.log('[Calendar Debug] Received sessionRecords:', sessionRecords);
            console.log('[Calendar Debug] Number of session records:', sessionRecords?.length || 0);

            sessionList = sessionRecords.map(record => {
                const dateStr = record.fields.Date;
                console.log('[Calendar Debug] Mapping session record:', {
                    id: record.id,
                    name: record.fields.Name,
                    dateStr: dateStr,
                    parsedDate: dateStr.split('T')[0]
                });
                return {
                    recordId: record.id,
                    name: record.fields.Name || 'Unnamed Plan',
                    date: dateStr.split('T')[0],
                    record: record,
                    type: 'session'
                };
            });
            console.log('[Calendar Debug] Created sessionList:', sessionList);
        } catch (error) {
            console.error('[Calendar Debug] Error fetching sessions for calendar:', error);
        }
    } else {
        console.log('[Calendar Debug] No active shop ID, skipping session fetch');
    }

    // Combine events and sessions
    const combinedList = [...eventList, ...sessionList];
    log('Calendar', `Total calendar entries: ${combinedList.length} (${eventList.length} events + ${sessionList.length} plans)`);

    return combinedList;
}

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
}

function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

function getEventsForDate(dateStr) {
    return fullEventList.filter(event => event.date === dateStr);
}

function getWeekDates(date) {
    const curr = new Date(date);
    const day = curr.getDay(); // 0 = Sunday, 6 = Saturday
    const dates = [];

    // Calculate the Sunday of the current week
    const sunday = new Date(curr);
    sunday.setDate(curr.getDate() - day);

    // Generate all 7 days starting from Sunday
    for (let i = 0; i < 7; i++) {
        const weekDay = new Date(sunday);
        weekDay.setDate(sunday.getDate() + i);
        dates.push(weekDay);
    }

    return dates;
}

function createEventCard(event, compact = false) {
    const card = document.createElement('div');
    card.classList.add('event-card');
    if (compact) card.classList.add('compact');
    card.dataset.recordId = event.recordId;

    const isSession = event.type === 'session';

    if (isSession) {
        // Check if user can access this session
        const isAuthenticated = state.session.user.isAuthenticated;
        const collaborators = event.record.fields.Collaborators || [];
        const isCollaborator = isAuthenticated && collaborators.includes(state.session.user.id);
        const isLocked = !isAuthenticated || !isCollaborator;

        // Render session/plan card
        const eventDate = new Date(event.record.fields.Date + 'T00:00:00');
        const dateStr = eventDate.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        const guestCount = event.record.fields['Guest Count'] || null;
        const goals = event.record.fields.Goals || '';

        if (compact) {
            card.innerHTML = `
                <div class="event-compact-content">
                    <div class="event-time">📅 Plan</div>
                    <div class="event-name">${event.name}${isLocked ? ' 🔒' : ''}</div>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="event-card-header">
                    <h4 class="event-card-title">📅 ${event.name}</h4>
                    <div class="event-card-date">${dateStr}</div>
                </div>
                <div class="event-card-body">
                    ${guestCount ? `<div class="event-card-location">👥 ${guestCount} guests</div>` : ''}
                    ${goals ? `<p class="event-card-description">${goals.substring(0, 150)}${goals.length > 150 ? '...' : ''}</p>` : ''}
                    <div class="event-price">Event Plan</div>
                </div>
                ${isLocked ? '<div class="event-lock-badge" title="Sign in as collaborator to edit">🔒</div>' : ''}
            `;
        }

        if (isLocked) {
            card.classList.add('locked');
        }

        card.addEventListener('click', (e) => {
            log('Calendar', `Session card clicked: ${event.name}`);

            // Prevent access to locked sessions
            if (isLocked) {
                e.preventDefault();
                log('Calendar', `Access denied: Session is locked. User must be authenticated as collaborator.`);

                // Show authentication modal if not authenticated
                if (!isAuthenticated) {
                    showUserModal();
                } else {
                    // User is authenticated but not a collaborator
                    alert('You must be a collaborator to access this plan.');
                }
                return;
            }

            // Load the session instead of showing detail modal
            if (event.recordId) {
                window.location.href = `?session=${event.recordId}${state.ui.activeShopId ? `&shopId=${state.ui.activeShopId}` : ''}`;
            }
        });

    } else {
        // Render event card (existing behavior)
        const userRsvps = event.record.fields.RSVPs || [];
        const hasRsvpd = state.session.user.isAuthenticated && userRsvps.includes(state.session.user.id);

        const eventDate = new Date(event.record.fields.Date + 'T00:00:00');
        const dateStr = eventDate.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        const timeStr = event.record.fields.Time || '';
        const description = event.record.fields.Description || '';
        const location = event.record.fields.Location || '';
        const price = event.record.fields.Price || 0;
        const pricingType = event.record.fields['Pricing Type'] || 'Per Person';

        let priceDisplay = '';
        if (price > 0) {
            priceDisplay = `<div class="event-price">$${price} ${pricingType}</div>`;
        } else {
            priceDisplay = '<div class="event-price">Free</div>';
        }

        if (compact) {
            card.innerHTML = `
                <div class="event-compact-content">
                    <div class="event-time">${timeStr || 'All Day'}</div>
                    <div class="event-name">${event.name} ${hasRsvpd ? '✅' : ''}</div>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="event-card-header">
                    <h4 class="event-card-title">${event.name} ${hasRsvpd ? '✅' : ''}</h4>
                    <div class="event-card-date">${dateStr}${timeStr ? ' • ' + timeStr : ''}</div>
                </div>
                <div class="event-card-body">
                    ${description ? `<p class="event-card-description">${description.substring(0, 150)}${description.length > 150 ? '...' : ''}</p>` : ''}
                    ${location ? `<div class="event-card-location">📍 ${location}</div>` : ''}
                    ${priceDisplay}
                </div>
            `;
        }

        card.addEventListener('click', () => {
            log('Calendar', `Event card clicked: ${event.name}`);
            ui.showDetailModal(event.record);
            hideCalendarModal();
        });
    }

    return card;
}

function renderMonthView() {
    console.log('[Calendar Debug] Rendering custom month view');
    const container = document.getElementById('calendar-content');
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    container.innerHTML = `
        <div class="calendar-header-controls">
            <button id="cal-prev-btn" class="cal-nav-btn">‹</button>
            <h2 class="calendar-title">${monthNames[month]} ${year}</h2>
            <button id="cal-next-btn" class="cal-nav-btn">›</button>
        </div>
        <div class="calendar-grid">
            <div class="calendar-weekdays">
                <div class="weekday">Sun</div>
                <div class="weekday">Mon</div>
                <div class="weekday">Tue</div>
                <div class="weekday">Wed</div>
                <div class="weekday">Thu</div>
                <div class="weekday">Fri</div>
                <div class="weekday">Sat</div>
            </div>
            <div class="calendar-days" id="calendar-days-grid"></div>
        </div>
    `;
    
    const daysGrid = document.getElementById('calendar-days-grid');
    
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.classList.add('calendar-day', 'empty');
        daysGrid.appendChild(emptyDay);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dayDiv = document.createElement('div');
        dayDiv.classList.add('calendar-day');

        const date = new Date(year, month, day);
        // Format date as YYYY-MM-DD in local timezone to avoid UTC conversion issues
        const dateYear = date.getFullYear();
        const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
        const dateDay = String(date.getDate()).padStart(2, '0');
        const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;
        const dayEvents = getEventsForDate(dateStr);
        const today = new Date();
        
        if (isSameDay(date, today)) {
            dayDiv.classList.add('today');
        }
        
        dayDiv.innerHTML = `<div class="day-number">${day}</div>`;
        
        if (dayEvents.length > 0) {
            dayDiv.classList.add('has-events');
            const eventsContainer = document.createElement('div');
            eventsContainer.classList.add('day-events');
            
            dayEvents.slice(0, 3).forEach(event => {
                const eventBadge = document.createElement('div');
                eventBadge.classList.add('event-badge');

                if (event.type === 'session') {
                    // Check if session is locked
                    const isAuthenticated = state.session.user.isAuthenticated;
                    const collaborators = event.record.fields.Collaborators || [];
                    const isCollaborator = isAuthenticated && collaborators.includes(state.session.user.id);
                    const isLocked = !isAuthenticated || !isCollaborator;

                    // Session/plan badge
                    eventBadge.textContent = `📅 ${event.name}${isLocked ? ' 🔒' : ''}`;
                    eventBadge.title = isLocked ? `Plan: ${event.name} (Sign in as collaborator to edit)` : `Plan: ${event.name}`;
                    if (isLocked) {
                        eventBadge.classList.add('locked');
                    }
                    eventBadge.addEventListener('click', (e) => {
                        e.stopPropagation();

                        // Prevent access to locked sessions
                        if (isLocked) {
                            log('Calendar', `Access denied: Session badge clicked but locked. User must be authenticated as collaborator.`);

                            // Show authentication modal if not authenticated
                            if (!isAuthenticated) {
                                showUserModal();
                            } else {
                                // User is authenticated but not a collaborator
                                alert('You must be a collaborator to access this plan.');
                            }
                            return;
                        }

                        window.location.href = `?session=${event.recordId}${state.ui.activeShopId ? `&shopId=${state.ui.activeShopId}` : ''}`;
                    });
                } else {
                    // Event badge (existing behavior)
                    const timeStr = event.record.fields.Time || '';
                    eventBadge.textContent = `${timeStr ? timeStr + ' ' : ''}${event.name}`;
                    eventBadge.title = event.name;
                    eventBadge.addEventListener('click', (e) => {
                        e.stopPropagation();
                        ui.showDetailModal(event.record);
                        hideCalendarModal();
                    });
                }

                eventsContainer.appendChild(eventBadge);
            });
            
            if (dayEvents.length > 3) {
                const moreSpan = document.createElement('div');
                moreSpan.classList.add('more-events');
                moreSpan.textContent = `+${dayEvents.length - 3} more`;
                eventsContainer.appendChild(moreSpan);
            }
            
            dayDiv.appendChild(eventsContainer);
        }
        
        daysGrid.appendChild(dayDiv);
    }
    
    document.getElementById('cal-prev-btn').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderMonthView();
    });
    
    document.getElementById('cal-next-btn').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderMonthView();
    });
}

function renderWeekView() {
    console.log('[Calendar Debug] Rendering week view');
    const container = document.getElementById('calendar-content');

    const weekDates = getWeekDates(currentDate);
    const startDate = weekDates[0];
    const endDate = weekDates[6];

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

    const dateRange = `${monthNames[startDate.getMonth()]} ${startDate.getDate()} - ${monthNames[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;

    container.innerHTML = `
        <div class="calendar-header-controls">
            <button id="cal-prev-btn" class="cal-nav-btn">‹</button>
            <h2 class="calendar-title">${dateRange}</h2>
            <button id="cal-next-btn" class="cal-nav-btn">›</button>
        </div>
        <div class="week-grid" id="week-grid"></div>
    `;

    const weekGrid = document.getElementById('week-grid');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();

    weekDates.forEach((date, index) => {
        const dayColumn = document.createElement('div');
        dayColumn.classList.add('week-day-column');

        if (isSameDay(date, today)) {
            dayColumn.classList.add('today');
        }

        // Format date as YYYY-MM-DD in local timezone to avoid UTC conversion issues
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayEvents = getEventsForDate(dateStr);
        
        dayColumn.innerHTML = `
            <div class="week-day-header">
                <div class="week-day-name">${dayNames[index]}</div>
                <div class="week-day-date">${date.getMonth() + 1}/${date.getDate()}</div>
            </div>
            <div class="week-day-events"></div>
        `;
        
        const eventsContainer = dayColumn.querySelector('.week-day-events');
        
        if (dayEvents.length === 0) {
            eventsContainer.innerHTML = '<div class="no-events">No events</div>';
        } else {
            dayEvents.forEach(event => {
                const card = createEventCard(event, true);
                eventsContainer.appendChild(card);
            });
        }
        
        weekGrid.appendChild(dayColumn);
    });
    
    document.getElementById('cal-prev-btn').addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 7);
        renderWeekView();
    });
    
    document.getElementById('cal-next-btn').addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 7);
        renderWeekView();
    });
}

function renderListView() {
    console.log('[Calendar Debug] Rendering list view');
    const container = document.getElementById('calendar-content');
    
    container.innerHTML = '<div id="events-list-container"></div>';
    const listContainer = document.getElementById('events-list-container');
    
    if (fullEventList.length === 0) {
        listContainer.innerHTML = '<div class="no-events-message">No upcoming events found.</div>';
        return;
    }
    
    const sortedEvents = [...fullEventList].sort((a, b) => {
        return new Date(a.record.fields.Date) - new Date(b.record.fields.Date);
    });
    
    sortedEvents.forEach(event => {
        const card = createEventCard(event, false);
        listContainer.appendChild(card);
    });
}

function switchView(view) {
    currentView = view;
    
    const monthBtn = document.getElementById('calendar-view-month');
    const weekBtn = document.getElementById('calendar-view-week');
    const listBtn = document.getElementById('calendar-view-list');
    
    monthBtn?.classList.remove('active');
    weekBtn?.classList.remove('active');
    listBtn?.classList.remove('active');
    
    if (view === 'month') {
        monthBtn?.classList.add('active');
        renderMonthView();
    } else if (view === 'week') {
        weekBtn?.classList.add('active');
        renderWeekView();
    } else {
        listBtn?.classList.add('active');
        renderListView();
    }
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
    
    document.getElementById('calendar-view-month')?.addEventListener('click', () => switchView('month'));
    document.getElementById('calendar-view-week')?.addEventListener('click', () => switchView('week'));
    document.getElementById('calendar-view-list')?.addEventListener('click', () => switchView('list'));
}

export async function showCalendarModal() {
    const calendarModal = document.getElementById('calendar-modal-overlay');

    log('Calendar', 'Showing upcoming events calendar.');
    
    fullEventList = await fetchUpcomingEvents();
    log('Calendar', `Loaded ${fullEventList.length} events for calendar view.`);
    console.log('[Calendar Debug] Full event list:', fullEventList);
    
    if (fullEventList.length === 0) {
        log('Calendar', 'No events found to display in calendar.');
    }
    
    currentDate = new Date();
    
    if (currentView === 'month') {
        renderMonthView();
    } else if (currentView === 'week') {
        renderWeekView();
    } else {
        renderListView();
    }

    if (calendarModal) {
        calendarModal.classList.add('active');
        calendarModal.style.display = 'flex';
    }
    document.body.classList.add('modal-open');
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
