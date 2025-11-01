// In: components/calendarView.js
import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import * as ui from '../ui.js';

const calendarModal = document.getElementById('calendar-modal-overlay');
const calendarContainer = document.getElementById('event-calendar');
const dailyEventList = document.getElementById('daily-event-list');
const closeBtn = document.getElementById('calendar-close-btn');

let fullEventList = []; // Stores all upcoming events fetched from the server
let calendarInstance = null;

// --- DUMMY FUNCTION (To be replaced by serverless call) ---
async function fetchUpcomingEvents() {
    log('Calendar', 'Simulating fetch of upcoming events...');
    // In the next step, this function will call the actual Netlify function to parse events
    
    // For now, return an empty list to avoid breaking the UI
    return []; 
}
// --- END DUMMY FUNCTION ---

/**
 * Initializes the calendar widget with events and handles interaction.
 */
async function renderCalendar() {
    fullEventList = await fetchUpcomingEvents();
    
    // Destroy previous instance to re-render clean
    if (calendarInstance) {
        calendarInstance.destroy();
    }
    
    calendarInstance = window.flatpickr(calendarContainer, {
        inline: true,
        monthSelectorType: "static",
        minDate: "today",
        // Enable multiple dates for viewing, but not selecting
        mode: "multiple", 
        dateFormat: "Y-m-d",
        
        onDayCreate: function (dObj, dStr, fp, dayElem) {
            const dayEvents = getEventsForDay(dayElem.dateObj);
            
            if (dayEvents.length > 0) {
                // Add a visual indicator for days with events
                dayElem.classList.add('has-event'); 
                dayElem.setAttribute('title', `${dayEvents.length} event(s) scheduled.`);
                
                // Add highlight if user RSVP'd to any event that day
                const isUserRsvpd = dayEvents.some(event => state.session.user.rsvps.has(event.recordId));
                if (isUserRsvpd) {
                    dayElem.classList.add('rsvpd-event-day');
                }
            }
        },
        
        onChange: function(selectedDates) {
            if (selectedDates.length > 0) {
                const selectedDay = selectedDates[0];
                renderDailyEvents(selectedDay);
            } else {
                 dailyEventList.innerHTML = '<li>Select a date to see details.</li>';
            }
        }
    });
    
    // Select today's date by default if no date is already selected
    calendarInstance.setDate(new Date(), true);
}

function getEventsForDay(date) {
    const targetDateStr = date.toISOString().split('T')[0];
    // Filter logic based on the mock/future structure of fullEventList
    return fullEventList.filter(event => {
        // Simple check: This assumes event.date is an ISO string of the start date
        return event.date === targetDateStr;
    });
}

function renderDailyEvents(date) {
    const events = getEventsForDay(date);
    dailyEventList.innerHTML = '';
    
    if (events.length === 0) {
        dailyEventList.innerHTML = '<li>No events scheduled for this date.</li>';
        return;
    }
    
    events.forEach(event => {
        const listItem = document.createElement('li');
        listItem.textContent = event.name; 
        
        // Highlight if user has RSVP'd
        if (state.session.user.rsvps.has(event.recordId)) {
             listItem.classList.add('event-item-rsvpd');
             listItem.textContent += ' (RSVP\'d)';
        }
        
        dailyEventList.appendChild(listItem);
    });
}


export function setupCalendarEventListeners() {
    document.getElementById('calendar-view-btn')?.addEventListener('click', showCalendarModal);
    closeBtn.addEventListener('click', hideCalendarModal);
    calendarModal.addEventListener('click', (e) => {
        if (e.target === calendarModal) {
            hideCalendarModal();
        }
    });
}

export function showCalendarModal() {
    log('Calendar', 'Showing upcoming events calendar.');
    renderCalendar(); // Renders and fetches events
    calendarModal.classList.add('active');
    calendarModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideCalendarModal() {
    log('Calendar', 'Hiding calendar modal.');
    calendarModal.classList.remove('active');
    setTimeout(() => {
        calendarModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}
