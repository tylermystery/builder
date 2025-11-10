// In: components/calendarView.js
import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import * as ui from '../ui.js';

// --- REMOVED: Top-level const declarations ---

let fullEventList = []; // Stores all upcoming events fetched from the server
let calendarInstance = null;

// In: components/calendarView.js
// Action: REPLACE the entire fetchUpcomingEvents function

async function fetchUpcomingEvents() {
    log('Calendar', 'Fetching all public events from state...');
    
    // Use the already-loaded records from the main app state
    if (!state.records.all || state.records.all.length === 0) {
        log('Calendar', 'Records not loaded yet.');
        return [];
    }

    // --- NEW DEBUGGING LOGS ---
    console.log(`[Calendar Debug] Checking ${state.records.all.length} total records from state.records.all.`);
    let checkedCount = 0;
    // --- END DEBUGGING LOGS ---
    const eventItems = state.records.all.filter(record => {
        checkedCount++;
        const itemType = record.fields['Item Type'];
        const hasDate = record.fields.Date; // This will be truthy if a date exists
        const isEvent = itemType === 'Event';
        
        // Log the first 25 items to avoid spamming the console
        // We'll also log YOUR specific event names if we find them.
        const eventName = record.fields.Name || 'Unnamed Record';
        const isOneOfYourEvents = eventName.includes("EVENT_NAME_1") || eventName.includes("EVENT_NAME_2"); // <-- REPLACE THESE

        if (checkedCount <= 25 || isOneOfYourEvents) {
            console.log(`[Calendar Debug] Checking: \"${eventName}\" | Item Type: \"${itemType}\" | Has Date: ${!!hasDate} | Is \"Event\": ${isEvent}`);
        }
        // --- END DEBUGGING LOGS ---
        
        return isEvent && hasDate;
    });

    // --- MODIFIED LOG ---
    log('Calendar', `Found ${eventItems.length} public events after checking ${checkedCount} total records.`);
    // --- END MODIFIED LOG ---
    
    // Map to the format our calendar logic will use
    return eventItems.map(record => {
        return {
            recordId: record.id,
            name: record.fields.Name || 'Unnamed Event',
            // Get the date (and make sure it's just the date part, not time)
            date: new Date(record.fields.Date).toISOString().split('T')[0], 
            record: record // Keep a reference to the full record
        };
    });
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
    // --- ADDED: Query inside function ---
    const dailyEventList = document.getElementById('daily-event-list');
    if (!dailyEventList) return; // Safety check
    // --- END ADD ---

    const events = getEventsForDay(date);
    dailyEventList.innerHTML = '';
    
    if (events.length === 0) {
        dailyEventList.innerHTML = '<li>No events scheduled for this date.</li>';
        return;
    }
    
    events.forEach(event => {
        const listItem = document.createElement('li');
        listItem.textContent = event.name; 
        listItem.dataset.recordId = event.recordId; // Store the ID
        listItem.classList.add('event-item-clickable'); // Add class for styling
        
        // Highlight if user has RSVP'd
        if (state.session.user.rsvps.has(event.recordId)) {
             listItem.classList.add('event-item-rsvpd');
             listItem.textContent += ' (RSVP\'d)';
        }

        // --- ADDED: On-click logic ---
        listItem.addEventListener('click', () => {
            log('Calendar', `Event item clicked: ${event.name}`);
            // Find the full record from our pre-fetched list
            const fullRecord = event.record;
            if (fullRecord) {
                // Show the modal for this event
                ui.showDetailModal(fullRecord);
                // Hide the calendar modal
                hideCalendarModal();
            } else {
                log('Calendar', 'Error: Could not find full record for this event.');
            }
        });
        // --- END ADDED ---
        
        dailyEventList.appendChild(listItem);
    });
}


export function setupCalendarEventListeners() {
    // --- ADDED: Queries inside function ---
    const calendarModal = document.getElementById('calendar-modal-overlay');
    const closeBtn = document.getElementById('calendar-close-btn');
    // --- END ADD ---

    document.getElementById('calendar-view-btn')?.addEventListener('click', showCalendarModal);
    
    // --- FIX: Add safety checks ---
    closeBtn?.addEventListener('click', hideCalendarModal);
    calendarModal?.addEventListener('click', (e) => {
        if (e.target === calendarModal) {
            hideCalendarModal();
        }
    });
    // --- END FIX ---
}

export function showCalendarModal() {
    // --- ADDED: Query inside function ---
    const calendarModal = document.getElementById('calendar-modal-overlay');
    // --- END ADD ---

    log('Calendar', 'Showing upcoming events calendar.');
    // renderCalendar(); // Renders and fetches events -> This function doesn't exist, commenting out
    log('Calendar', 'Warning: renderCalendar() function is missing.');

    // --- FIX: Add safety check ---
    if (calendarModal) {
        calendarModal.classList.add('active');
        calendarModal.style.display = 'flex';
    }
    // --- END FIX ---
    document.body.classList.add('modal-open');
}

export function hideCalendarModal() {
    // --- ADDED: Query inside function ---
    const calendarModal = document.getElementById('calendar-modal-overlay');
    // --- END ADD ---

    log('Calendar', 'Hiding calendar modal.');
    
    // --- FIX: Add safety check ---
    if (calendarModal) {
        calendarModal.classList.remove('active');
        setTimeout(() => {
            calendarModal.style.display = 'none';
        }, 300);
    }
    // --- END FIX ---
    document.body.classList.remove('modal-open');
}
