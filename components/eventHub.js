// FILE: components/eventHub.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';

const modal = document.getElementById('event-hub-modal-overlay');
const closeBtn = document.getElementById('event-hub-close-btn');
const titleEl = document.getElementById('event-hub-title');
const dateEl = document.getElementById('event-hub-date');
const attendeeListEl = document.getElementById('attendee-list');
const mainContentEl = document.getElementById('event-hub-main');

function hideEventHub() {
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

export async function showEventHub(eventId) {
    log('EventHub', `Showing hub for Event ID: ${eventId}`);
    
    // In a real implementation, we would fetch event details from Airtable here.
    // For now, we'll use placeholder data.
    const eventName = "Community Meetup";
    const eventDate = new Date().toLocaleDateString();

    titleEl.textContent = eventName;
    dateEl.textContent = `Date: ${eventDate}`;
    
    // Placeholder for attendee list
    attendeeListEl.innerHTML = '<div class="attendee-avatar">TU</div><div class="attendee-avatar">G</div>';

    // Embed the Presentation and Chat components
    // This is a conceptual example of how you would merge the views.
    // A full implementation would require refactoring the presentation and chat
    // components to be embeddable.
    mainContentEl.innerHTML = `
        <div style="padding:20px; border-right: 1px solid #eee;">
            <h3>Event Content (Presentation View)</h3>
            <p>The presentation/carousel component for the event's catalog items would be embedded here.</p>
        </div>
        <div style="padding:20px;">
            <h3>Event Chat</h3>
            <p>The chat widget, connected to a channel for Event ID ${eventId}, would be embedded here.</p>
        </div>
    `;

    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function setupEventHubEventListeners() {
    closeBtn.addEventListener('click', hideEventHub);
}
