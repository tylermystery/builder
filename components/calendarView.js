import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import * as ui from '../ui.js';

let fullEventList = [];
let calendarInstance = null;
let currentView = 'month';

async function fetchUpcomingEvents() {
    log('Calendar', 'Fetching all public events from state...');
    
    if (!state.records.all || state.records.all.length === 0) {
        log('Calendar', 'Records not loaded yet.');
        return [];
    }

    console.log(`[Calendar Debug] Checking ${state.records.all.length} total records from state.records.all.`);
    let checkedCount = 0;
    
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
    console.log('[Calendar Debug] getEventsForDay - Looking for date:', targetDateStr);
    console.log('[Calendar Debug] getEventsForDay - fullEventList:', fullEventList);
    
    return fullEventList.filter(event => {
        const matches = event.date === targetDateStr;
        if (matches) {
            console.log('[Calendar Debug] getEventsForDay - Found matching event:', event);
        }
        return matches;
    });
}

function createEventCard(event) {
    const card = document.createElement('div');
    card.classList.add('event-card');
    card.dataset.recordId = event.recordId;
    
    const userRsvps = event.record.fields.RSVPs || [];
    const hasRsvpd = state.session.user.isAuthenticated && userRsvps.includes(state.session.user.id);
    
    const eventDate = new Date(event.record.fields.Date);
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
    
    card.addEventListener('click', () => {
        log('Calendar', `Event card clicked: ${event.name}`);
        ui.showDetailModal(event.record);
        hideCalendarModal();
    });
    
    return card;
}

function renderMonthView() {
    console.log('[Calendar Debug] Rendering month view');
    const calendarContainer = document.getElementById('event-calendar');
    
    if (calendarInstance) {
        calendarInstance.destroy();
    }
    
    const eventDates = fullEventList.map(e => e.date);
    
    calendarInstance = flatpickr(calendarContainer, {
        inline: true,
        onDayCreate: (dObj, dStr, fp, dayElem) => {
            const dateStr = dayElem.dateObj.toISOString().split('T')[0];
            const eventsOnDay = fullEventList.filter(e => e.date === dateStr);
            
            if (eventsOnDay.length > 0) {
                dayElem.classList.add('has-event');
                dayElem.style.position = 'relative';
                dayElem.style.cursor = 'default';
                
                const eventListDiv = document.createElement('div');
                eventListDiv.classList.add('day-event-list');
                
                eventsOnDay.forEach(event => {
                    const userRsvps = event.record.fields.RSVPs || [];
                    const hasRsvpd = state.session.user.isAuthenticated && userRsvps.includes(state.session.user.id);
                    
                    const eventItem = document.createElement('div');
                    eventItem.classList.add('day-event-item');
                    if (hasRsvpd) {
                        eventItem.classList.add('event-rsvpd');
                    }
                    
                    const timeStr = event.record.fields.Time || '';
                    const location = event.record.fields.Location || '';
                    const price = event.record.fields.Price || 0;
                    const description = event.record.fields.Description || '';
                    
                    // Build tooltip text
                    let tooltipText = event.name;
                    if (timeStr) tooltipText += `\n⏰ ${timeStr}`;
                    if (location) tooltipText += `\n📍 ${location}`;
                    if (price > 0) tooltipText += `\n💵 $${price}`;
                    else tooltipText += `\n💵 Free`;
                    if (description) {
                        const shortDesc = description.length > 100 ? description.substring(0, 100) + '...' : description;
                        tooltipText += `\n${shortDesc}`;
                    }
                    
                    eventItem.textContent = `${timeStr ? timeStr + ' ' : ''}${event.name}`;
                    eventItem.setAttribute('data-event-details', tooltipText);
                    eventItem.setAttribute('title', event.name);
                    
                    eventItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        console.log('[Calendar Debug] Event clicked:', event.name);
                        ui.showDetailModal(event.record);
                        hideCalendarModal();
                    });
                    
                    eventListDiv.appendChild(eventItem);
                });
                
                dayElem.appendChild(eventListDiv);
            }
        }
    });
}

function renderListView() {
    console.log('[Calendar Debug] Rendering list view');
    const listContainer = document.getElementById('events-list-container');
    listContainer.innerHTML = '';
    
    if (fullEventList.length === 0) {
        listContainer.innerHTML = '<div class="no-events-message">No upcoming events found.</div>';
        return;
    }
    
    const sortedEvents = [...fullEventList].sort((a, b) => {
        return new Date(a.record.fields.Date) - new Date(b.record.fields.Date);
    });
    
    sortedEvents.forEach(event => {
        const card = createEventCard(event);
        listContainer.appendChild(card);
    });
}

function switchView(view) {
    currentView = view;
    
    const monthBtn = document.getElementById('calendar-view-month');
    const listBtn = document.getElementById('calendar-view-list');
    const monthView = document.getElementById('calendar-month-view');
    const listView = document.getElementById('calendar-list-view');
    
    if (view === 'month') {
        monthBtn?.classList.add('active');
        listBtn?.classList.remove('active');
        monthView.style.display = 'block';
        listView.style.display = 'none';
        renderMonthView();
    } else {
        monthBtn?.classList.remove('active');
        listBtn?.classList.add('active');
        monthView.style.display = 'none';
        listView.style.display = 'block';
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
    
    if (currentView === 'month') {
        renderMonthView();
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
    
    if (calendarInstance) {
        calendarInstance.destroy();
        calendarInstance = null;
    }
    
    if (calendarModal) {
        calendarModal.classList.remove('active');
        setTimeout(() => {
            calendarModal.style.display = 'none';
        }, 300);
    }
    document.body.classList.remove('modal-open');
}
